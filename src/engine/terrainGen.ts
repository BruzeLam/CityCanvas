import type { MapSettings, Point } from '../types';
import { fbm2d, valueNoise2d } from './noise';
import {
  TERRAIN_GREEN,
  TERRAIN_LAND,
  TERRAIN_WATER,
  createTerrain,
  preferredTerrainCellSizeM,
  type TerrainGrid,
} from './terrain';

/** 水域总占比（海/湖/河道统称，由形状区分） */
export const DEFAULT_WATER_RATIO = 0.28;
export const WATER_RATIO_MIN = 0.08;
export const WATER_RATIO_MAX = 0.65;

/** @deprecated 同 DEFAULT_WATER_RATIO */
export const DEFAULT_OCEAN_RATIO = DEFAULT_WATER_RATIO;
export const OCEAN_RATIO_MIN = WATER_RATIO_MIN;
export const OCEAN_RATIO_MAX = WATER_RATIO_MAX;

export const DEFAULT_GREEN_DENSITY = 0.28;
export const GREEN_DENSITY_MIN = 0.08;
export const GREEN_DENSITY_MAX = 0.7;

export type TerrainGenParams = {
  seed: number;
  waterEnabled: boolean;
  /** 水域占比 0..1；waterEnabled=false 时忽略 */
  waterRatio: number;
  greenEnabled: boolean;
  /** 绿地占陆地比例 0..1 */
  greenDensity: number;
};

export type LandscapeResult = {
  terrain: TerrainGrid;
  /** 实际水域格占比 */
  waterPct: number;
  /** 实际绿地格占比 */
  greenPct: number;
};

export function clampWaterRatio(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_WATER_RATIO;
  return Math.max(WATER_RATIO_MIN, Math.min(WATER_RATIO_MAX, r));
}

/** @deprecated 使用 clampWaterRatio */
export const clampOceanRatio = clampWaterRatio;

export function clampGreenDensity(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_GREEN_DENSITY;
  return Math.max(GREEN_DENSITY_MIN, Math.min(GREEN_DENSITY_MAX, r));
}

export function randomTerrainSeed(): number {
  return (Math.random() * 0xffffffff) >>> 0;
}

export function defaultTerrainGenParams(seed?: number): TerrainGenParams {
  return {
    seed: seed ?? randomTerrainSeed(),
    waterEnabled: true,
    waterRatio: DEFAULT_WATER_RATIO,
    greenEnabled: true,
    greenDensity: DEFAULT_GREEN_DENSITY,
  };
}

/**
 * 架空地貌：统一水域（海/湖/河同色，形状区分）+ 可选绿地。
 * 河道直接刻进栅格，不再生成独立河流折线。
 */
export function generateLandscape(
  settings: Pick<MapSettings, 'widthM' | 'heightM'>,
  params: TerrainGenParams,
  cellSizeM = preferredTerrainCellSizeM(settings),
): LandscapeResult {
  const grid = createTerrain(settings, cellSizeM);
  const { cols, rows, cells } = grid;
  const seed = params.seed >>> 0;
  const n = cols * rows;
  if (n === 0) {
    return { terrain: grid, waterPct: 0, greenPct: 0 };
  }

  const field = buildHeightField(cols, rows, seed);
  let waterPct = 0;
  let greenPct = 0;

  if (params.waterEnabled) {
    const waterRatio = clampWaterRatio(params.waterRatio);
    const threshold = percentileThreshold(field, waterRatio);
    for (let i = 0; i < n; i++) {
      cells[i] = field[i] <= threshold ? TERRAIN_WATER : TERRAIN_LAND;
    }
    smoothWaterLand(cells, cols, rows, 2);
    cleanupTerrain(cells, cols, rows);

    // 顺坡河道刻进水域栅格（宽窄由形状表现，不另做河流要素）
    const channelDensity = 0.35 + waterRatio * 0.55;
    const cellPaths = generateRiverCellPaths(
      cells,
      field,
      cols,
      rows,
      seed,
      channelDensity,
    );
    carveWaterChannels(cells, cols, rows, cellPaths);
    smoothWaterLand(cells, cols, rows, 1);

    let water = 0;
    for (let i = 0; i < n; i++) if (cells[i] === TERRAIN_WATER) water++;
    waterPct = water / n;
  } else {
    cells.fill(TERRAIN_LAND);
  }

  if (params.greenEnabled) {
    paintGreens(cells, cols, rows, field, seed, clampGreenDensity(params.greenDensity));
    let green = 0;
    for (let i = 0; i < n; i++) if (cells[i] === TERRAIN_GREEN) green++;
    greenPct = green / n;
  }

  return { terrain: grid, waterPct, greenPct };
}

/** @deprecated 使用 generateLandscape */
export function generateTerrain(
  settings: Pick<MapSettings, 'widthM' | 'heightM'>,
  params: Pick<TerrainGenParams, 'seed' | 'waterRatio'> & {
    oceanRatio?: number;
    waterEnabled?: boolean;
    oceanEnabled?: boolean;
  },
  cellSizeM = preferredTerrainCellSizeM(settings),
): TerrainGrid {
  return generateLandscape(
    settings,
    {
      seed: params.seed,
      waterEnabled: params.waterEnabled ?? params.oceanEnabled ?? true,
      waterRatio: params.waterRatio ?? params.oceanRatio ?? DEFAULT_WATER_RATIO,
      greenEnabled: false,
      greenDensity: DEFAULT_GREEN_DENSITY,
    },
    cellSizeM,
  ).terrain;
}

/** 在陆地上铺成片绿地（避开水域；密度相对陆地） */
function paintGreens(
  cells: Uint8Array,
  cols: number,
  rows: number,
  height: Float32Array,
  seed: number,
  density: number,
): void {
  const landIdx: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === TERRAIN_LAND) landIdx.push(i);
  }
  if (landIdx.length === 0) return;

  const scores = new Float32Array(landIdx.length);
  for (let k = 0; k < landIdx.length; k++) {
    const i = landIdx[k];
    const x = i % cols;
    const y = (i / cols) | 0;
    const u = (x + 0.5) / cols;
    const v = (y + 0.5) / rows;
    const patch = fbm2d(u * 3.4, v * 3.4, seed + 401, 3, 2.1, 0.5);
    const detail = fbm2d(u * 7.5, v * 7.5, seed + 419, 2, 2.0, 0.5);
    scores[k] = patch * 0.72 + detail * 0.18 + height[i] * 0.1;
  }

  const sorted = Float32Array.from(scores);
  sorted.sort();
  const keep = Math.max(1, Math.floor(landIdx.length * density));
  const thrIdx = Math.max(0, sorted.length - keep);
  const thr = sorted[thrIdx];

  for (let k = 0; k < landIdx.length; k++) {
    if (scores[k] >= thr) cells[landIdx[k]] = TERRAIN_GREEN;
  }

  const labels = labelComponents(cells, cols, rows, TERRAIN_GREEN);
  const minKeep = Math.max(18, Math.floor(landIdx.length * 0.004));
  for (const comp of labels.components) {
    if (comp.cells.length < minKeep) {
      for (const i of comp.cells) cells[i] = TERRAIN_LAND;
    }
  }
}

function buildHeightField(cols: number, rows: number, seed: number): Float32Array {
  const field = new Float32Array(cols * rows);
  const biasAngle = hashUnit(seed) * Math.PI * 2;
  const biasX = Math.cos(biasAngle);
  const biasY = Math.sin(biasAngle);

  const continentFreq = 1.9 + hashUnit(seed + 7) * 0.7;
  const warpAmt = 0.12 + hashUnit(seed + 13) * 0.1;

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = (c + 0.5) / cols;
      const v = (r + 0.5) / rows;

      const wu =
        (valueNoise2d(u * 1.35, v * 1.35, seed + 101) * 2 - 1) * warpAmt;
      const wv =
        (valueNoise2d(u * 1.35, v * 1.35, seed + 191) * 2 - 1) * warpAmt;
      const uu = u + wu;
      const vv = v + wv;

      let h = fbm2d(uu * continentFreq, vv * continentFreq, seed, 5, 2.05, 0.48);
      const macro = fbm2d(uu * 0.72, vv * 0.72, seed + 33, 3, 2.0, 0.5);
      h = h * 0.56 + macro * 0.44;

      const side = (u - 0.5) * biasX + (v - 0.5) * biasY;
      h -= Math.max(0, side) * 0.34;
      h += Math.max(0, -side) * 0.06;

      const ripples = fbm2d(u * 6.2, v * 6.2, seed + 77, 3, 2.1, 0.48);
      h += (ripples - 0.5) * 0.07;

      field[r * cols + c] = h;
    }
  }
  return field;
}

/** 多数票平滑岸线，减轻锯齿 */
function smoothWaterLand(
  cells: Uint8Array,
  cols: number,
  rows: number,
  passes: number,
): void {
  for (let p = 0; p < passes; p++) {
    const next = new Uint8Array(cells);
    for (let y = 1; y < rows - 1; y++) {
      for (let x = 1; x < cols - 1; x++) {
        const i = y * cols + x;
        if (cells[i] === TERRAIN_GREEN) continue;
        let water = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (cells[(y + dy) * cols + (x + dx)] === TERRAIN_WATER) water++;
          }
        }
        if (water >= 5) next[i] = TERRAIN_WATER;
        else if (water <= 3) next[i] = TERRAIN_LAND;
      }
    }
    cells.set(next);
  }
}

function generateRiverCellPaths(
  cells: Uint8Array,
  field: Float32Array,
  cols: number,
  rows: number,
  seed: number,
  density: number,
): number[][] {
  const count = Math.max(1, Math.round(1 + density * 5));
  const paths: number[][] = [];
  const used = new Uint8Array(cols * rows);
  const minLen = Math.max(12, Math.floor(Math.max(cols, rows) * 0.08));

  for (let i = 0; i < count * 4 && paths.length < count; i++) {
    const source = pickSourceCell(cells, field, cols, rows, seed + i * 97, used);
    if (source == null) break;
    const cellPath = flowDownhill(cells, field, cols, rows, source);
    if (cellPath.length < minLen) continue;

    for (const idx of cellPath) {
      markCorridor(used, cols, rows, idx % cols, (idx / cols) | 0, 4);
    }
    paths.push(cellPath);
  }

  return paths;
}

function carveWaterChannels(
  cells: Uint8Array,
  cols: number,
  rows: number,
  paths: number[][],
): void {
  for (const path of paths) {
    if (path.length < 2) continue;
    const n = path.length;
    for (let i = 0; i < n; i++) {
      const idx = path[i];
      const x = idx % cols;
      const y = (idx / cols) | 0;
      // 上游窄、下游（近水体）略宽
      const t = i / (n - 1);
      const radius = t > 0.72 ? 2 : t > 0.4 ? 1 : 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius + 0.2) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const j = ny * cols + nx;
          if (cells[j] !== TERRAIN_WATER) cells[j] = TERRAIN_WATER;
        }
      }
    }
  }
}

function pickSourceCell(
  cells: Uint8Array,
  field: Float32Array,
  cols: number,
  rows: number,
  seed: number,
  used: Uint8Array,
): number | null {
  let best = -1;
  let bestScore = -Infinity;
  const attempts = 100;
  for (let a = 0; a < attempts; a++) {
    const x = Math.floor(hashUnit(seed + a * 3) * cols);
    const y = Math.floor(hashUnit(seed + a * 5 + 1) * rows);
    const i = y * cols + x;
    if (cells[i] !== TERRAIN_LAND || used[i]) continue;
    const edge = Math.min(x, y, cols - 1 - x, rows - 1 - y) / Math.max(cols, rows);
    let nearWater = false;
    for (let dy = -5; dy <= 5 && !nearWater; dy++) {
      for (let dx = -5; dx <= 5; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (cells[ny * cols + nx] === TERRAIN_WATER) nearWater = true;
      }
    }
    if (nearWater) continue;
    const score = field[i] * 2 + edge * 0.85 + hashUnit(seed + a) * 0.12;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best >= 0 ? best : null;
}

function flowDownhill(
  cells: Uint8Array,
  field: Float32Array,
  cols: number,
  rows: number,
  start: number,
): number[] {
  const path: number[] = [start];
  const visited = new Set<number>([start]);
  let cur = start;
  const maxSteps = Math.floor(Math.max(cols, rows) * 2);

  for (let step = 0; step < maxSteps; step++) {
    const x = cur % cols;
    const y = (cur / cols) | 0;

    let hitWater = false;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      if (cells[ny * cols + nx] === TERRAIN_WATER) {
        hitWater = true;
        break;
      }
    }
    if (hitWater) break;
    if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) break;

    let next = -1;
    let nextH = field[cur];
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
      [1, 1],
      [1, -1],
      [-1, 1],
      [-1, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const j = ny * cols + nx;
      if (visited.has(j)) continue;
      if (cells[j] === TERRAIN_WATER) {
        next = j;
        nextH = -Infinity;
        break;
      }
      if (field[j] < nextH - 1e-6) {
        nextH = field[j];
        next = j;
      }
    }

    if (next < 0) break;
    if (cells[next] === TERRAIN_WATER) {
      path.push(next);
      break;
    }
    visited.add(next);
    path.push(next);
    cur = next;
  }

  return path;
}

function markCorridor(
  used: Uint8Array,
  cols: number,
  rows: number,
  x: number,
  y: number,
  radius: number,
): void {
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      used[ny * cols + nx] = 1;
    }
  }
}

function cleanupTerrain(cells: Uint8Array, cols: number, rows: number): void {
  const n = cols * rows;
  const minSeaKeep = Math.max(48, Math.floor(n * 0.01));
  const minLakeKeep = Math.max(28, Math.floor(n * 0.004));
  const minIslandKeep = Math.max(28, Math.floor(n * 0.005));

  const waterLabels = labelComponents(cells, cols, rows, TERRAIN_WATER);
  for (const comp of waterLabels.components) {
    const touchesBorder = comp.cells.some((i) => {
      const x = i % cols;
      const y = (i / cols) | 0;
      return x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
    });
    if (touchesBorder) {
      if (comp.cells.length < minSeaKeep) {
        for (const i of comp.cells) cells[i] = TERRAIN_LAND;
      }
    } else if (comp.cells.length < minLakeKeep) {
      // 过小内陆水斑去掉；够大的保留为湖
      for (const i of comp.cells) cells[i] = TERRAIN_LAND;
    }
  }

  const landLabels = labelComponents(cells, cols, rows, TERRAIN_LAND);
  let largestLand = 0;
  for (const comp of landLabels.components) {
    largestLand = Math.max(largestLand, comp.cells.length);
  }
  for (const comp of landLabels.components) {
    if (comp.cells.length >= minIslandKeep) continue;
    if (comp.cells.length >= largestLand * 0.35) continue;
    const touchesBorder = comp.cells.some((i) => {
      const x = i % cols;
      const y = (i / cols) | 0;
      return x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
    });
    if (!touchesBorder) {
      for (const i of comp.cells) cells[i] = TERRAIN_WATER;
    }
  }

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
      if (cells[i] === TERRAIN_GREEN) continue;
      const me = cells[i];
      let same = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (cells[(y + dy) * cols + (x + dx)] === me) same++;
        }
      }
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

function percentileThreshold(field: Float32Array, ratio: number): number {
  const sample =
    field.length > 24000 ? downsample(field, 24000) : Float32Array.from(field);
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

/** 预览：陆地 / 水域 / 绿地（平滑缩放） */
export function paintTerrainPreview(
  canvas: HTMLCanvasElement,
  grid: TerrainGrid,
  _rivers?: Point[][],
  _settings?: Pick<MapSettings, 'widthM' | 'heightM'>,
  landColor = '#f2efe9',
  waterColor = '#aad3df',
  greenColor = '#add19e',
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { cols, rows, cells } = grid;
  const w = canvas.width;
  const h = canvas.height;

  const off = document.createElement('canvas');
  off.width = cols;
  off.height = rows;
  const octx = off.getContext('2d');
  if (!octx) return;
  const img = octx.createImageData(cols, rows);
  const data = img.data;

  const parse = (hex: string) => {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as const;
  };
  const land = parse(landColor);
  const water = parse(waterColor);
  const green = parse(greenColor);

  for (let i = 0; i < cells.length; i++) {
    const cell = cells[i];
    const [cr, cg, cb] =
      cell === TERRAIN_WATER ? water : cell === TERRAIN_GREEN ? green : land;
    const o = i * 4;
    data[o] = cr;
    data[o + 1] = cg;
    data[o + 2] = cb;
    data[o + 3] = 255;
  }
  octx.putImageData(img, 0, 0);

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.clearRect(0, 0, w, h);
  ctx.drawImage(off, 0, 0, w, h);
}
