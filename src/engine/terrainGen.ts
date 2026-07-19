import type { MapSettings } from '../types';
import { fbm2d, valueNoise2d } from './noise';
import {
  DEFAULT_TERRAIN_CELL_M,
  TERRAIN_LAND,
  TERRAIN_WATER,
  createTerrain,
  type TerrainGrid,
} from './terrain';

export const DEFAULT_OCEAN_RATIO = 0.28;
export const OCEAN_RATIO_MIN = 0.05;
export const OCEAN_RATIO_MAX = 0.65;

export type TerrainGenParams = {
  seed: number;
  /** 海洋占比 0..1，默认约 28% */
  oceanRatio: number;
};

export function clampOceanRatio(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_OCEAN_RATIO;
  return Math.max(OCEAN_RATIO_MIN, Math.min(OCEAN_RATIO_MAX, r));
}

export function randomTerrainSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

/**
 * 架空海陆（自然尺度）：
 * 1. 在归一化 UV 上采低频大陆噪声（整图仅 1～3 个大块）
 * 2. 轻度域扭曲做出海湾/半岛，不加高频碎斑
 * 3. 外海偏一侧（大湾感）
 * 4. 分位数切海洋比例
 * 5. 清掉碎岛/碎湖，保留贴边的主水体
 */
export function generateTerrain(
  settings: Pick<MapSettings, 'widthM' | 'heightM'>,
  params: TerrainGenParams,
  cellSizeM = DEFAULT_TERRAIN_CELL_M,
): TerrainGrid {
  const grid = createTerrain(settings, cellSizeM);
  const { cols, rows, cells } = grid;
  const seed = params.seed >>> 0;
  const oceanRatio = clampOceanRatio(params.oceanRatio);
  const n = cols * rows;
  if (n === 0) return grid;

  const field = new Float32Array(n);

  // 外海方向由种子决定
  const biasAngle = (hashUnit(seed) * Math.PI * 2);
  const biasX = Math.cos(biasAngle);
  const biasY = Math.sin(biasAngle);

  // 大陆特征尺度：整图大约 1.4～2.2 个「大陆波」——越大越碎，越小越整块
  const continentFreq = 1.55 + hashUnit(seed + 7) * 0.55;
  // 扭曲强度（只扭低频，不引入盐胡椒）
  const warpAmt = 0.12 + hashUnit(seed + 13) * 0.1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = (c + 0.5) / cols;
      const v = (r + 0.5) / rows;

      // 低频扭曲 UV（扭曲场本身也是低频）
      const wu =
        (valueNoise2d(u * 1.1, v * 1.1, seed + 101) * 2 - 1) * warpAmt;
      const wv =
        (valueNoise2d(u * 1.1, v * 1.1, seed + 191) * 2 - 1) * warpAmt;
      const uu = u + wu;
      const vv = v + wv;

      // 主大陆场：少八度、高增益衰减 → 大块平滑
      let h = fbm2d(uu * continentFreq, vv * continentFreq, seed, 3, 2.0, 0.42);

      // 第二层极低频：拉开「主陆 vs 外海」对比，避免花斑阈值
      const macro = fbm2d(uu * 0.7, vv * 0.7, seed + 33, 2, 2.0, 0.5);
      h = h * 0.62 + macro * 0.38;

      // 外海偏置：一侧明显更低 → 连贯海湾/外洋
      const side = (u - 0.5) * biasX + (v - 0.5) * biasY;
      h -= Math.max(0, side) * 0.38;
      h += Math.max(0, -side) * 0.06; // 对侧略抬，形成「陆地在一侧、海在一侧」

      // 极弱岸线褶皱（只在最终高度上加一点，幅度很小）
      const ripples = valueNoise2d(u * 6.5, v * 6.5, seed + 77);
      h += (ripples - 0.5) * 0.04;

      field[r * cols + c] = h;
    }
  }

  const threshold = percentileThreshold(field, oceanRatio);
  for (let i = 0; i < n; i++) {
    cells[i] = field[i] <= threshold ? TERRAIN_WATER : TERRAIN_LAND;
  }

  // 后处理：去碎斑，保主海连通
  cleanupTerrain(cells, cols, rows);

  return grid;
}

/**
 * - 去掉不贴边的小水域（碎湖 → 陆地），保留贴地图边的主海
 * - 去掉海里的碎岛（小陆斑 → 水）
 */
function cleanupTerrain(cells: Uint8Array, cols: number, rows: number): void {
  const n = cols * rows;
  const minOceanKeep = Math.max(40, Math.floor(n * 0.012));
  const minIslandKeep = Math.max(24, Math.floor(n * 0.006));

  // 1) 水域连通域：贴边的留下；不贴边且偏小的填成陆
  const waterLabels = labelComponents(cells, cols, rows, TERRAIN_WATER);
  for (const comp of waterLabels.components) {
    const touchesBorder = comp.cells.some((i) => {
      const x = i % cols;
      const y = (i / cols) | 0;
      return x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
    });
    if (!touchesBorder && comp.cells.length < minOceanKeep * 3) {
      for (const i of comp.cells) cells[i] = TERRAIN_LAND;
    } else if (touchesBorder && comp.cells.length < minOceanKeep) {
      // 贴边但极小的水斑也清掉
      for (const i of comp.cells) cells[i] = TERRAIN_LAND;
    }
  }

  // 2) 陆地连通域：被水包围的碎岛填成水（大岛保留）
  const landLabels = labelComponents(cells, cols, rows, TERRAIN_LAND);
  // 找最大陆块，其余小的若全被水围可填
  let largestLand = 0;
  for (const comp of landLabels.components) {
    largestLand = Math.max(largestLand, comp.cells.length);
  }
  for (const comp of landLabels.components) {
    if (comp.cells.length >= minIslandKeep) continue;
    if (comp.cells.length >= largestLand * 0.35) continue; // 第二大陆也留着
    const touchesBorder = comp.cells.some((i) => {
      const x = i % cols;
      const y = (i / cols) | 0;
      return x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
    });
    // 贴边的小陆岬保留；海里孤岛去掉
    if (!touchesBorder) {
      for (const i of comp.cells) cells[i] = TERRAIN_WATER;
    }
  }

  // 3) 一次轻量平滑：去掉 1 格毛刺（多数邻居不同则翻转）
  despeckle(cells, cols, rows);
}

type Component = { cells: number[] };

function labelComponents(
  cells: Uint8Array,
  cols: number,
  rows: number,
  target: number,
): { components: Component[] } {
  const n = cols * rows;
  const seen = new Uint8Array(n);
  const components: Component[] = [];
  const stack: number[] = [];

  for (let i = 0; i < n; i++) {
    if (cells[i] !== target || seen[i]) continue;
    const comp: number[] = [];
    stack.length = 0;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const cur = stack.pop()!;
      comp.push(cur);
      const x = cur % cols;
      const y = (cur / cols) | 0;
      const tryPush = (nx: number, ny: number) => {
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) return;
        const j = ny * cols + nx;
        if (seen[j] || cells[j] !== target) return;
        seen[j] = 1;
        stack.push(j);
      };
      tryPush(x - 1, y);
      tryPush(x + 1, y);
      tryPush(x, y - 1);
      tryPush(x, y + 1);
    }
    components.push({ cells: comp });
  }
  return { components };
}

function despeckle(cells: Uint8Array, cols: number, rows: number): void {
  const next = new Uint8Array(cells);
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      const i = y * cols + x;
      const me = cells[i];
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (cells[(y + dy) * cols + (x + dx)] === me) same++;
        }
      }
      // 8 邻域里少于 2 个同类 → 孤立毛刺，取多数
      if (same <= 1) {
        let water = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            if (cells[(y + dy) * cols + (x + dx)] === TERRAIN_WATER) water++;
          }
        }
        next[i] = water >= 4 ? TERRAIN_WATER : TERRAIN_LAND;
      }
    }
  }
  cells.set(next);
}

function hashUnit(seed: number): number {
  let x = seed | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** 使约 ratio 比例的样本 ≤ 阈值 */
function percentileThreshold(field: Float32Array, ratio: number): number {
  const sample =
    field.length > 16000 ? downsample(field, 16000) : Float32Array.from(field);
  sample.sort();
  const idx = Math.max(
    0,
    Math.min(sample.length - 1, Math.floor(sample.length * ratio)),
  );
  return sample[idx];
}

function downsample(field: Float32Array, maxN: number): Float32Array {
  const step = Math.ceil(field.length / maxN);
  const out = new Float32Array(Math.ceil(field.length / step));
  let j = 0;
  for (let i = 0; i < field.length; i += step) out[j++] = field[i];
  return out.subarray(0, j);
}

/** 小画布预览：把栅格画成海陆色块 */
export function paintTerrainPreview(
  canvas: HTMLCanvasElement,
  grid: TerrainGrid,
  landColor = '#f2efe9',
  waterColor = '#aad3df',
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { cols, rows, cells } = grid;
  const w = canvas.width;
  const h = canvas.height;
  const img = ctx.createImageData(w, h);
  const data = img.data;

  const parse = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  };
  const land = parse(landColor);
  const water = parse(waterColor);

  for (let y = 0; y < h; y++) {
    const gr = Math.min(rows - 1, Math.floor((y / h) * rows));
    for (let x = 0; x < w; x++) {
      const gc = Math.min(cols - 1, Math.floor((x / w) * cols));
      const cell = cells[gr * cols + gc];
      const [cr, cg, cb] = cell === TERRAIN_WATER ? water : land;
      const i = (y * w + x) * 4;
      data[i] = cr;
      data[i + 1] = cg;
      data[i + 2] = cb;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
}
