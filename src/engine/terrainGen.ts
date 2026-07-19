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
  /** 河：蜿蜒通往海/湖或地图边缘的窄水道（同水色，无关等高线） */
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

  // 大水体先清理；河道稍后刻，避免多数票把窄河抹掉
  if (params.oceanEnabled || params.lakeEnabled) {
    cleanupIslands(cells, cols, rows);
    despeckle(cells, cols, rows);
  }

  if (params.riverEnabled) {
    const density = clampRiverDensity(params.riverDensity);
    const cellPaths = generateRiverCellPaths(cells, field, cols, rows, seed, density);
    carveWaterChannels(cells, cols, rows, cellPaths);
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
  _field: Float32Array,
  cols: number,
  rows: number,
  seed: number,
  density: number,
): number[][] {
  const count = Math.max(1, Math.round(1 + density * 5));
  const paths: number[][] = [];
  const used = new Uint8Array(cols * rows);
  const minLen = Math.max(16, Math.floor(Math.max(cols, rows) * 0.18));
  const outletDist = buildOutletDistance(cells, cols, rows);

  for (let i = 0; i < count * 6 && paths.length < count; i++) {
    const source = pickSourceCell(cells, cols, rows, seed + i * 97, used, outletDist);
    if (source == null) break;
    const cellPath = meanderToOutlet(cells, outletDist, cols, rows, source, seed + i * 131);
    if (!isValidRiverPath(cellPath, cells, cols, rows, minLen)) continue;

    for (const idx of cellPath) {
      markCorridor(used, cols, rows, idx % cols, (idx / cols) | 0, 5);
    }
    paths.push(cellPath);
  }

  return paths;
}

/** 到出水口的距离：优先已有水域，否则地图边界（便于无海时贯穿） */
function buildOutletDistance(
  cells: Uint8Array,
  cols: number,
  rows: number,
): Float32Array {
  const n = cols * rows;
  const dist = new Float32Array(n);
  dist.fill(1e9);
  const queue: number[] = [];

  let hasWater = false;
  for (let i = 0; i < n; i++) {
    if (cells[i] === TERRAIN_WATER) {
      dist[i] = 0;
      queue.push(i);
      hasWater = true;
    }
  }
  if (!hasWater) {
    for (let x = 0; x < cols; x++) {
      const top = x;
      const bot = (rows - 1) * cols + x;
      dist[top] = 0;
      dist[bot] = 0;
      queue.push(top, bot);
    }
    for (let y = 1; y < rows - 1; y++) {
      const left = y * cols;
      const right = y * cols + (cols - 1);
      dist[left] = 0;
      dist[right] = 0;
      queue.push(left, right);
    }
  }

  let qh = 0;
  while (qh < queue.length) {
    const cur = queue[qh++]!;
    const x = cur % cols;
    const y = (cur / cols) | 0;
    const nd = dist[cur] + 1;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const j = ny * cols + nx;
      if (nd < dist[j]) {
        dist[j] = nd;
        queue.push(j);
      }
    }
  }
  return dist;
}

function isValidRiverPath(
  path: number[],
  cells: Uint8Array,
  cols: number,
  rows: number,
  minLen: number,
): boolean {
  if (path.length < minLen) return false;
  const end = path[path.length - 1]!;
  const x = end % cols;
  const y = (end / cols) | 0;
  if (cells[end] === TERRAIN_WATER) return true;
  // 邻接水域也算入海/入湖
  for (const [dx, dy] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ] as const) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
    if (cells[ny * cols + nx] === TERRAIN_WATER) return true;
  }
  // 无大水体时：贯穿到地图边缘
  return x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
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
      const idx = path[i]!;
      const x = idx % cols;
      const y = (idx / cols) | 0;
      // 全程至少 1 格宽，下游/河口加宽，避免「线断」
      const t = i / (n - 1);
      const radius = t > 0.78 ? 2 : 1;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (dx * dx + dy * dy > radius * radius + 0.35) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          cells[ny * cols + nx] = TERRAIN_WATER;
        }
      }
    }
  }
}

function pickSourceCell(
  cells: Uint8Array,
  cols: number,
  rows: number,
  seed: number,
  used: Uint8Array,
  outletDist: Float32Array,
): number | null {
  let best = -1;
  let bestScore = -Infinity;
  const attempts = 120;
  const minOutlet = Math.max(cols, rows) * 0.22;
  for (let a = 0; a < attempts; a++) {
    const x = Math.floor(hashUnit(seed + a * 3) * cols);
    const y = Math.floor(hashUnit(seed + a * 5 + 1) * rows);
    const i = y * cols + x;
    if (cells[i] !== TERRAIN_LAND || used[i]) continue;
    if (outletDist[i] < minOutlet) continue;
    const edge = Math.min(x, y, cols - 1 - x, rows - 1 - y) / Math.max(cols, rows);
    // 偏内陆、离出水口稍远，不看「海拔」
    const score = outletDist[i] * 0.02 + edge * 0.9 + hashUnit(seed + a) * 0.15;
    if (score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best >= 0 ? best : null;
}

/**
 * 平面蜿蜒水道：朝海/湖（或地图边缘）前进，用噪声左右摆动。
 * 不依赖等高线/高程——本产品无等高线。
 */
function meanderToOutlet(
  cells: Uint8Array,
  outletDist: Float32Array,
  cols: number,
  rows: number,
  start: number,
  seed: number,
): number[] {
  const path: number[] = [start];
  const visited = new Set<number>([start]);
  let cur = start;
  const maxSteps = Math.floor(Math.max(cols, rows) * 3);

  const neighbors = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
    [1, 1],
    [1, -1],
    [-1, 1],
    [-1, -1],
  ] as const;

  for (let step = 0; step < maxSteps; step++) {
    const x = cur % cols;
    const y = (cur / cols) | 0;

    let done = false;
    for (const [dx, dy] of neighbors) {
      if (Math.abs(dx) + Math.abs(dy) !== 1) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) {
        done = true;
        break;
      }
      if (cells[ny * cols + nx] === TERRAIN_WATER) {
        done = true;
        break;
      }
    }
    if (done) break;
    if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) break;

    let best = -1;
    let bestCost = Infinity;
    for (const [dx, dy] of neighbors) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const j = ny * cols + nx;
      if (visited.has(j)) continue;
      if (cells[j] === TERRAIN_WATER) {
        best = j;
        bestCost = -Infinity;
        break;
      }
      // 主目标：靠近出水口；噪声制造蜿蜒，不是顺坡
      const wander =
        (valueNoise2d(nx * 0.11, ny * 0.11, seed) - 0.5) * 2.4 +
        (valueNoise2d(nx * 0.04 + step * 0.02, ny * 0.04, seed + 17) - 0.5) * 1.2;
      const cost = outletDist[j] + wander;
      if (cost < bestCost) {
        bestCost = cost;
        best = j;
      }
    }

    if (best < 0) {
      let escape = -1;
      let escapeD = outletDist[cur];
      for (const [dx, dy] of neighbors) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const j = ny * cols + nx;
        if (visited.has(j)) continue;
        if (outletDist[j] < escapeD - 1e-6) {
          escapeD = outletDist[j];
          escape = j;
        }
      }
      if (escape < 0) break;
      best = escape;
    }

    if (cells[best] === TERRAIN_WATER) {
      path.push(best);
      break;
    }
    visited.add(best);
    path.push(best);
    cur = best;
    if (outletDist[cur] <= 0) break;
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
