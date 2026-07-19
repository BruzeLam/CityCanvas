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

/** 海洋占比（接边大水体） */
export const DEFAULT_OCEAN_RATIO = 0.26;
export const OCEAN_RATIO_MIN = 0.08;
export const OCEAN_RATIO_MAX = 0.6;

/** 湖泊密度（内陆封闭水体，相对陆地） */
export const DEFAULT_LAKE_DENSITY = 0.12;
export const LAKE_DENSITY_MIN = 0.04;
export const LAKE_DENSITY_MAX = 0.4;

/** 河网密度 */
export const DEFAULT_RIVER_DENSITY = 0.4;
export const RIVER_DENSITY_MIN = 0.1;
export const RIVER_DENSITY_MAX = 1;

/** @deprecated 兼容旧名 */
export const DEFAULT_WATER_RATIO = DEFAULT_OCEAN_RATIO;
export const WATER_RATIO_MIN = OCEAN_RATIO_MIN;
export const WATER_RATIO_MAX = OCEAN_RATIO_MAX;

export const DEFAULT_GREEN_DENSITY = 0.28;
export const GREEN_DENSITY_MIN = 0.08;
export const GREEN_DENSITY_MAX = 0.7;

export type TerrainGenParams = {
  seed: number;
  /** 海：接地图边界的大片水域 */
  oceanEnabled: boolean;
  oceanRatio: number;
  /** 湖：内陆封闭水域 */
  lakeEnabled: boolean;
  lakeDensity: number;
  /** 河：顺坡窄水道，刻进同一水色 */
  riverEnabled: boolean;
  riverDensity: number;
  greenEnabled: boolean;
  greenDensity: number;
};

export type LandscapeResult = {
  terrain: TerrainGrid;
  /** 实际水域格占比（海+湖+河合计） */
  waterPct: number;
  greenPct: number;
};

export function clampOceanRatio(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_OCEAN_RATIO;
  return Math.max(OCEAN_RATIO_MIN, Math.min(OCEAN_RATIO_MAX, r));
}

/** @deprecated */
export const clampWaterRatio = clampOceanRatio;

export function clampLakeDensity(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_LAKE_DENSITY;
  return Math.max(LAKE_DENSITY_MIN, Math.min(LAKE_DENSITY_MAX, r));
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
    lakeEnabled: true,
    lakeDensity: DEFAULT_LAKE_DENSITY,
    riverEnabled: true,
    riverDensity: DEFAULT_RIVER_DENSITY,
    greenEnabled: true,
    greenDensity: DEFAULT_GREEN_DENSITY,
  };
}

/**
 * 架空地貌：海/湖/河分控生成，但同色「水域」；形状自辨。
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
  cells.fill(TERRAIN_LAND);

  const anyWater = params.oceanEnabled || params.lakeEnabled || params.riverEnabled;

  if (params.oceanEnabled) {
    const oceanRatio = clampOceanRatio(params.oceanRatio);
    const threshold = percentileThreshold(field, oceanRatio);
    for (let i = 0; i < n; i++) {
      if (field[i] <= threshold) cells[i] = TERRAIN_WATER;
    }
    smoothWaterLand(cells, cols, rows, 2);
    // 只保留接边的海，内陆候选留给湖泊逻辑
    keepBorderWaterOnly(cells, cols, rows);
    pruneSmallSeas(cells, cols, rows);
  }

  if (params.lakeEnabled) {
    paintLakes(
      cells,
      field,
      cols,
      rows,
      seed,
      clampLakeDensity(params.lakeDensity),
    );
  }

  if (params.riverEnabled) {
    const density = clampRiverDensity(params.riverDensity);
    const cellPaths = generateRiverCellPaths(cells, field, cols, rows, seed, density);
    carveWaterChannels(cells, cols, rows, cellPaths);
  }

  if (anyWater) {
    smoothWaterLand(cells, cols, rows, 1);
    cleanupIslands(cells, cols, rows);
    despeckle(cells, cols, rows);
  }

  let waterPct = 0;
  let greenPct = 0;
  let water = 0;
  for (let i = 0; i < n; i++) if (cells[i] === TERRAIN_WATER) water++;
  waterPct = water / n;

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
  params: {
    seed: number;
    oceanRatio?: number;
    waterRatio?: number;
    oceanEnabled?: boolean;
    waterEnabled?: boolean;
  },
  cellSizeM = preferredTerrainCellSizeM(settings),
): TerrainGrid {
  const oceanOn = params.oceanEnabled ?? params.waterEnabled ?? true;
  return generateLandscape(
    settings,
    {
      ...defaultTerrainGenParams(params.seed),
      oceanEnabled: oceanOn,
      oceanRatio: params.oceanRatio ?? params.waterRatio ?? DEFAULT_OCEAN_RATIO,
      lakeEnabled: false,
      riverEnabled: false,
      greenEnabled: false,
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

/** 内陆湖泊：低洼盆地成封闭水塘（同水色） */
function paintLakes(
  cells: Uint8Array,
  field: Float32Array,
  cols: number,
  rows: number,
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
    const basin = fbm2d(u * 4.2, v * 4.2, seed + 701, 3, 2.1, 0.5);
    // 偏低 + 盆地噪声低 → 更易成湖；避开贴边（留给海）
    const edge = Math.min(x, y, cols - 1 - x, rows - 1 - y) / Math.max(cols, rows);
    scores[k] = (1 - field[i]) * 0.55 + (1 - basin) * 0.35 + edge * 0.25;
  }

  const sorted = Float32Array.from(scores);
  sorted.sort();
  const keep = Math.max(1, Math.floor(landIdx.length * density));
  const thr = sorted[Math.max(0, sorted.length - keep)];

  for (let k = 0; k < landIdx.length; k++) {
    if (scores[k] >= thr) cells[landIdx[k]] = TERRAIN_WATER;
  }

  smoothWaterLand(cells, cols, rows, 1);

  // 只保留内陆封闭水体；过小的去掉；误接边的并入海或抹掉
  const n = cols * rows;
  const minLake = Math.max(20, Math.floor(n * 0.0025));
  const labels = labelComponents(cells, cols, rows, TERRAIN_WATER);
  for (const comp of labels.components) {
    const touchesBorder = comp.cells.some((i) => {
      const x = i % cols;
      const y = (i / cols) | 0;
      return x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
    });
    if (touchesBorder) continue; // 海：不动
    if (comp.cells.length < minLake) {
      for (const i of comp.cells) cells[i] = TERRAIN_LAND;
    }
  }
}

/** 只保留接边水域（海），内陆水填回陆地 */
function keepBorderWaterOnly(cells: Uint8Array, cols: number, rows: number): void {
  const labels = labelComponents(cells, cols, rows, TERRAIN_WATER);
  for (const comp of labels.components) {
    const touchesBorder = comp.cells.some((i) => {
      const x = i % cols;
      const y = (i / cols) | 0;
      return x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
    });
    if (!touchesBorder) {
      for (const i of comp.cells) cells[i] = TERRAIN_LAND;
    }
  }
}

function pruneSmallSeas(cells: Uint8Array, cols: number, rows: number): void {
  const n = cols * rows;
  const minSea = Math.max(48, Math.floor(n * 0.01));
  const labels = labelComponents(cells, cols, rows, TERRAIN_WATER);
  for (const comp of labels.components) {
    const touchesBorder = comp.cells.some((i) => {
      const x = i % cols;
      const y = (i / cols) | 0;
      return x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
    });
    if (touchesBorder && comp.cells.length < minSea) {
      for (const i of comp.cells) cells[i] = TERRAIN_LAND;
    }
  }
}

function cleanupIslands(cells: Uint8Array, cols: number, rows: number): void {
  const n = cols * rows;
  const minIslandKeep = Math.max(28, Math.floor(n * 0.005));
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
