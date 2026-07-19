import type { MapFeature, MapSettings, Point } from '../types';
import { createId } from '../types';
import { fbm2d, valueNoise2d } from './noise';
import {
  DEFAULT_TERRAIN_CELL_M,
  TERRAIN_GREEN,
  TERRAIN_LAND,
  TERRAIN_WATER,
  createTerrain,
  type TerrainGrid,
} from './terrain';

export const DEFAULT_OCEAN_RATIO = 0.28;
export const OCEAN_RATIO_MIN = 0.08;
export const OCEAN_RATIO_MAX = 0.65;

export const DEFAULT_RIVER_DENSITY = 0.45;
export const RIVER_DENSITY_MIN = 0.1;
export const RIVER_DENSITY_MAX = 1;

export const DEFAULT_GREEN_DENSITY = 0.28;
export const GREEN_DENSITY_MIN = 0.08;
export const GREEN_DENSITY_MAX = 0.7;

export type TerrainGenParams = {
  seed: number;
  oceanEnabled: boolean;
  /** 海洋占比 0..1；oceanEnabled=false 时忽略 */
  oceanRatio: number;
  riverEnabled: boolean;
  /** 河网密度 0..1；riverEnabled=false 时忽略 */
  riverDensity: number;
  greenEnabled: boolean;
  /** 绿地占陆地比例 0..1；greenEnabled=false 时忽略 */
  greenDensity: number;
};

export type LandscapeResult = {
  terrain: TerrainGrid;
  rivers: MapFeature[];
  /** 实际海洋格占比（勾选关闭时为 0） */
  oceanPct: number;
  /** 实际绿地格占比（勾选关闭时为 0） */
  greenPct: number;
};

export function clampOceanRatio(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_OCEAN_RATIO;
  return Math.max(OCEAN_RATIO_MIN, Math.min(OCEAN_RATIO_MAX, r));
}

export function clampRiverDensity(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_RIVER_DENSITY;
  return Math.max(RIVER_DENSITY_MIN, Math.min(RIVER_DENSITY_MAX, r));
}

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
    oceanEnabled: true,
    oceanRatio: DEFAULT_OCEAN_RATIO,
    riverEnabled: true,
    riverDensity: DEFAULT_RIVER_DENSITY,
    greenEnabled: true,
    greenDensity: DEFAULT_GREEN_DENSITY,
  };
}

/**
 * 架空地貌：连贯海陆 + 可选顺坡河流。
 * 粒度比 MVP 略细（岸线有褶皱），但仍保持大块结构。
 */
export function generateLandscape(
  settings: Pick<MapSettings, 'widthM' | 'heightM'>,
  params: TerrainGenParams,
  cellSizeM = DEFAULT_TERRAIN_CELL_M,
): LandscapeResult {
  const grid = createTerrain(settings, cellSizeM);
  const { cols, rows, cells } = grid;
  const seed = params.seed >>> 0;
  const n = cols * rows;
  if (n === 0) {
    return { terrain: grid, rivers: [], oceanPct: 0, greenPct: 0 };
  }

  const field = buildHeightField(cols, rows, seed);
  let oceanPct = 0;
  let greenPct = 0;

  if (params.oceanEnabled) {
    const oceanRatio = clampOceanRatio(params.oceanRatio);
    const threshold = percentileThreshold(field, oceanRatio);
    for (let i = 0; i < n; i++) {
      cells[i] = field[i] <= threshold ? TERRAIN_WATER : TERRAIN_LAND;
    }
    cleanupTerrain(cells, cols, rows);
    let water = 0;
    for (let i = 0; i < n; i++) if (cells[i] === TERRAIN_WATER) water++;
    oceanPct = water / n;
  } else {
    cells.fill(TERRAIN_LAND);
  }

  let rivers: MapFeature[] = [];
  if (params.riverEnabled) {
    const density = clampRiverDensity(params.riverDensity);
    const paths = generateRivers(
      cells,
      field,
      cols,
      rows,
      settings,
      cellSizeM,
      seed,
      density,
      params.oceanEnabled,
    );
    // 河口附近略拓宽水面（仅勾选海洋时）
    if (params.oceanEnabled) {
      carveRiverMouths(cells, cols, rows, paths, cellSizeM);
    }
    rivers = paths.map((points) => ({
      id: createId(),
      kind: 'river' as const,
      points,
      closed: false,
    }));
  }

  if (params.greenEnabled) {
    paintGreens(cells, cols, rows, field, seed, clampGreenDensity(params.greenDensity));
    let green = 0;
    for (let i = 0; i < n; i++) if (cells[i] === TERRAIN_GREEN) green++;
    greenPct = green / n;
  }

  return { terrain: grid, rivers, oceanPct, greenPct };
}

/** @deprecated 使用 generateLandscape */
export function generateTerrain(
  settings: Pick<MapSettings, 'widthM' | 'heightM'>,
  params: Pick<TerrainGenParams, 'seed' | 'oceanRatio'> & {
    oceanEnabled?: boolean;
  },
  cellSizeM = DEFAULT_TERRAIN_CELL_M,
): TerrainGrid {
  return generateLandscape(
    settings,
    {
      seed: params.seed,
      oceanEnabled: params.oceanEnabled ?? true,
      oceanRatio: params.oceanRatio,
      riverEnabled: false,
      riverDensity: DEFAULT_RIVER_DENSITY,
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
    // 中频斑块 + 略偏好较高地
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

  // 去掉过碎的绿地斑点
  const labels = labelComponents(cells, cols, rows, TERRAIN_GREEN);
  const minKeep = Math.max(12, Math.floor(landIdx.length * 0.004));
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

  // 略提高频率：岸线更细，但仍是大块大陆
  const continentFreq = 1.85 + hashUnit(seed + 7) * 0.65;
  const warpAmt = 0.14 + hashUnit(seed + 13) * 0.12;

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

      let h = fbm2d(uu * continentFreq, vv * continentFreq, seed, 4, 2.05, 0.45);
      const macro = fbm2d(uu * 0.75, vv * 0.75, seed + 33, 2, 2.0, 0.5);
      h = h * 0.58 + macro * 0.42;

      const side = (u - 0.5) * biasX + (v - 0.5) * biasY;
      h -= Math.max(0, side) * 0.36;
      h += Math.max(0, -side) * 0.07;

      // 中频岸线褶皱（比之前更明显一点）
      const ripples = fbm2d(u * 5.2, v * 5.2, seed + 77, 2, 2.1, 0.5);
      h += (ripples - 0.5) * 0.085;

      field[r * cols + c] = h;
    }
  }
  return field;
}

function generateRivers(
  cells: Uint8Array,
  field: Float32Array,
  cols: number,
  rows: number,
  settings: Pick<MapSettings, 'widthM' | 'heightM'>,
  cellSizeM: number,
  seed: number,
  density: number,
  hasOcean: boolean,
): Point[][] {
  const count = Math.max(1, Math.round(1 + density * 5));
  const paths: Point[][] = [];
  const used = new Uint8Array(cols * rows);

  for (let i = 0; i < count * 3 && paths.length < count; i++) {
    const source = pickSourceCell(cells, field, cols, rows, seed + i * 97, used, hasOcean);
    if (source == null) break;
    const cellPath = flowDownhill(cells, field, cols, rows, source, hasOcean);
    if (cellPath.length < 8) continue;

    // 标记走廊，避免河靠太近
    for (const idx of cellPath) {
      markCorridor(used, cols, rows, idx % cols, (idx / cols) | 0, 3);
    }

    const simplified = simplifyCellPath(cellPath, cols, 2);
    const world = simplified.map((idx) =>
      cellToWorld(idx % cols, (idx / cols) | 0, cellSizeM, settings),
    );
    if (polylineLength(world) < Math.min(settings.widthM, settings.heightM) * 0.12) {
      continue;
    }
    paths.push(world);
  }

  return paths;
}

function pickSourceCell(
  cells: Uint8Array,
  field: Float32Array,
  cols: number,
  rows: number,
  seed: number,
  used: Uint8Array,
  hasOcean: boolean,
): number | null {
  let best = -1;
  let bestScore = -Infinity;
  const attempts = 80;
  for (let a = 0; a < attempts; a++) {
    const x = Math.floor(hashUnit(seed + a * 3) * cols);
    const y = Math.floor(hashUnit(seed + a * 5 + 1) * rows);
    const i = y * cols + x;
    if (cells[i] !== TERRAIN_LAND || used[i]) continue;
    // 偏高、偏内陆
    const edge = Math.min(x, y, cols - 1 - x, rows - 1 - y) / Math.max(cols, rows);
    let nearWater = false;
    for (let dy = -4; dy <= 4 && !nearWater; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (cells[ny * cols + nx] === TERRAIN_WATER) nearWater = true;
      }
    }
    if (hasOcean && nearWater) continue;
    const score = field[i] * 2 + edge * 0.8 + hashUnit(seed + a) * 0.15;
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
  hasOcean: boolean,
): number[] {
  const path: number[] = [start];
  const visited = new Set<number>([start]);
  let cur = start;
  const maxSteps = Math.floor(Math.max(cols, rows) * 1.8);

  for (let step = 0; step < maxSteps; step++) {
    const x = cur % cols;
    const y = (cur / cols) | 0;

    if (hasOcean) {
      // 邻接海洋则入海结束
      let hitSea = false;
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
          hitSea = true;
          break;
        }
      }
      if (hitSea) break;
    } else if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) {
      break;
    }

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

function carveRiverMouths(
  cells: Uint8Array,
  cols: number,
  rows: number,
  paths: Point[][],
  cellSizeM: number,
): void {
  for (const path of paths) {
    if (path.length < 2) continue;
    // 末端附近拓宽
    const tail = path.slice(-Math.min(6, path.length));
    for (const p of tail) {
      const cx = Math.floor(p.x / cellSizeM);
      const cy = Math.floor(p.y / cellSizeM);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
          // 仅把陆地刷成水，形成窄河口
          const i = y * cols + x;
          if (cells[i] === TERRAIN_LAND && Math.abs(dx) + Math.abs(dy) <= 1) {
            cells[i] = TERRAIN_WATER;
          }
        }
      }
    }
  }
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

function simplifyCellPath(path: number[], _cols: number, step: number): number[] {
  if (path.length <= 2) return path;
  const out: number[] = [path[0]];
  for (let i = step; i < path.length - 1; i += step) out.push(path[i]);
  out.push(path[path.length - 1]);
  return out;
}

function cellToWorld(
  c: number,
  r: number,
  cellSizeM: number,
  settings: Pick<MapSettings, 'widthM' | 'heightM'>,
): Point {
  return {
    x: Math.min(settings.widthM, Math.max(0, (c + 0.5) * cellSizeM)),
    y: Math.min(settings.heightM, Math.max(0, (r + 0.5) * cellSizeM)),
  };
}

function polylineLength(points: Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++) {
    len += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return len;
}

function cleanupTerrain(cells: Uint8Array, cols: number, rows: number): void {
  const n = cols * rows;
  const minOceanKeep = Math.max(40, Math.floor(n * 0.012));
  const minIslandKeep = Math.max(24, Math.floor(n * 0.006));

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

/** 预览：海陆绿地底图 + 河流折线 */
export function paintTerrainPreview(
  canvas: HTMLCanvasElement,
  grid: TerrainGrid,
  rivers: Point[][] = [],
  settings?: Pick<MapSettings, 'widthM' | 'heightM'>,
  landColor = '#f2efe9',
  waterColor = '#aad3df',
  greenColor = '#add19e',
  riverColor = '#5b9fb5',
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
  const green = parse(greenColor);

  for (let y = 0; y < h; y++) {
    const gr = Math.min(rows - 1, Math.floor((y / h) * rows));
    for (let x = 0; x < w; x++) {
      const gc = Math.min(cols - 1, Math.floor((x / w) * cols));
      const cell = cells[gr * cols + gc];
      const [cr, cg, cb] =
        cell === TERRAIN_WATER ? water : cell === TERRAIN_GREEN ? green : land;
      const i = (y * w + x) * 4;
      data[i] = cr;
      data[i + 1] = cg;
      data[i + 2] = cb;
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);

  if (!settings || rivers.length === 0) return;
  ctx.strokeStyle = riverColor;
  ctx.lineWidth = Math.max(1.5, Math.min(w, h) * 0.008);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const path of rivers) {
    if (path.length < 2) continue;
    ctx.beginPath();
    for (let i = 0; i < path.length; i++) {
      const px = (path[i].x / settings.widthM) * w;
      const py = (path[i].y / settings.heightM) * h;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }
}
