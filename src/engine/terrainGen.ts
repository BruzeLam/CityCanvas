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
import { paintTerrainBitmapToCanvas } from './terrainDraw';

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

/** 地理原型结构 DNA（非 StylePreset；决定骨架，不靠自然语言） */
export type CoastBias =
  | 'none'
  | 'one_side'
  | 'bay_indent'
  | 'surround'
  | 'fjord'
  | 'peninsula';

export type ChannelStyle =
  | 'sparse'
  | 'dense_narrow'
  | 'wide_sparse'
  | 'delta_branch'
  | 'single_trunk';

export type GreenBias = 'uniform' | 'rim' | 'coastal_ridge' | 'high_ground';

export type LandformShape =
  | 'default'
  | 'basin'
  | 'harbor'
  | 'plain'
  | 'valley'
  | 'archipelago'
  | 'mountain_sea'
  | 'fjord'
  | 'peninsula'
  | 'delta'
  | 'lake_bowl';

export type FeatureDna = {
  landform: LandformShape;
  coastBias: CoastBias;
  channelStyle: ChannelStyle;
  greenBias: GreenBias;
  /** 陆块破碎感 0–1（群岛高） */
  landBreak: number;
  /** 湖相对河的偏好 0–1 */
  lakeBias: number;
  /** 盆地环山强度 0–1 */
  basinRing: number;
  /** 港湾凹入强度 0–1 */
  bayDepth: number;
};

export const DEFAULT_FEATURE_DNA: FeatureDna = {
  landform: 'default',
  coastBias: 'one_side',
  channelStyle: 'wide_sparse',
  greenBias: 'uniform',
  landBreak: 0.25,
  lakeBias: 0.35,
  basinRing: 0,
  bayDepth: 0.2,
};

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
  /** 岸线 / 地块破碎度 0–1（越高越碎、越不规则） */
  fragmentation?: number;
  /** 地理原型结构配方 */
  dna?: FeatureDna;
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

export const DEFAULT_FRAGMENTATION = 0.35;
export const FRAGMENTATION_MIN = 0.05;
export const FRAGMENTATION_MAX = 0.9;

export function clampFragmentation(r: number): number {
  if (!Number.isFinite(r)) return DEFAULT_FRAGMENTATION;
  return Math.max(FRAGMENTATION_MIN, Math.min(FRAGMENTATION_MAX, r));
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
    fragmentation: DEFAULT_FRAGMENTATION,
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

  const dna = params.dna ?? DEFAULT_FEATURE_DNA;
  const frag = clampFragmentation(params.fragmentation ?? DEFAULT_FRAGMENTATION);
  const field = buildHeightField(cols, rows, seed, frag, dna);
  cells.fill(TERRAIN_LAND);

  const smoothPasses = Math.max(1, Math.round(4 - frag * 3));

  if (params.oceanEnabled) {
    const oceanRatio = clampOceanRatio(params.oceanRatio);
    const threshold = percentileThreshold(field, oceanRatio);
    for (let i = 0; i < n; i++) {
      if (field[i] <= threshold) cells[i] = TERRAIN_WATER;
    }
    if (dna.bayDepth > 0.15 && (dna.coastBias === 'bay_indent' || dna.landform === 'harbor')) {
      carveHarborBay(cells, cols, rows, seed, dna.bayDepth, field);
    }
    if (dna.coastBias === 'fjord' || dna.landform === 'fjord') {
      carveFjords(cells, cols, rows, seed, 0.45 + dna.bayDepth * 0.4);
    }
    smoothWaterLand(cells, cols, rows, smoothPasses);
    // 只保留接边的海，内陆候选留给湖泊逻辑
    keepBorderWaterOnly(cells, cols, rows);
    const minSea = dna.landBreak > 0.55 ? 0.004 : 0.012;
    pruneSmallSeas(cells, cols, rows, minSea);
  }

  if (params.lakeEnabled) {
    paintLakes(
      cells,
      field,
      cols,
      rows,
      seed,
      clampLakeDensity(params.lakeDensity),
      dna,
    );
  }

  // 大水体先清理；河道稍后刻，避免多数票把窄河抹掉
  if (params.oceanEnabled || params.lakeEnabled) {
    const islandMin = dna.landBreak > 0.55 ? 0.002 : 0.008;
    cleanupIslands(cells, cols, rows, islandMin);
    despeckle(cells, cols, rows);
    smoothWaterLand(cells, cols, rows, Math.max(1, smoothPasses - 1));
  }

  if (params.riverEnabled) {
    const density = clampRiverDensity(params.riverDensity);
    const rivers = generateRiverNetwork(cells, cols, rows, seed, density, dna);
    carveRiverNetwork(cells, cols, rows, rivers, cellSizeM);
  }

  let waterPct = 0;
  let greenPct = 0;
  let water = 0;
  for (let i = 0; i < n; i++) if (cells[i] === TERRAIN_WATER) water++;
  waterPct = water / n;

  if (params.greenEnabled) {
    paintGreens(
      cells,
      cols,
      rows,
      field,
      seed,
      clampGreenDensity(params.greenDensity),
      dna,
    );
    smoothGreenLand(cells, cols, rows, 1);
    let green = 0;
    for (let i = 0; i < n; i++) if (cells[i] === TERRAIN_GREEN) green++;
    greenPct = green / n;
  }

  return { terrain: grid, waterPct, greenPct };
}

export type LandscapeQuality = {
  buildablePct: number;
  waterPct: number;
  greenPct: number;
  /** 接边水域格占比（港口潜力代理） */
  coastWaterPct: number;
  portPotential: '低' | '中' | '高';
  expansionPotential: '低' | '中' | '高';
  waterBarrier: '低' | '中' | '高';
  terrainBarrier: '低' | '中' | '高';
};

function levelByPct(p: number, low: number, mid: number): '低' | '中' | '高' {
  if (p < low) return '低';
  if (p < mid) return '中';
  return '高';
}

/** 帮助玩家理解地图特点（不打分） */
export function analyzeLandscape(
  result: LandscapeResult,
  fragmentation = DEFAULT_FRAGMENTATION,
): LandscapeQuality {
  const { terrain, waterPct, greenPct } = result;
  const { cols, rows, cells } = terrain;
  const n = cols * rows || 1;
  let land = 0;
  let coastWater = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (cells[i] === TERRAIN_LAND) land++;
      if (cells[i] !== TERRAIN_WATER) continue;
      if (x === 0 || y === 0 || x === cols - 1 || y === rows - 1) coastWater++;
    }
  }
  const buildablePct = land / n;
  const coastWaterPct = coastWater / n;
  const frag = clampFragmentation(fragmentation);

  return {
    buildablePct,
    waterPct,
    greenPct,
    coastWaterPct,
    portPotential: levelByPct(coastWaterPct, 0.01, 0.035),
    expansionPotential: levelByPct(buildablePct, 0.35, 0.55),
    waterBarrier: levelByPct(waterPct, 0.18, 0.35),
    terrainBarrier: levelByPct(frag * 0.55 + greenPct * 0.45, 0.28, 0.48),
  };
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
  dna: FeatureDna = DEFAULT_FEATURE_DNA,
): void {
  const landIdx: number[] = [];
  for (let i = 0; i < cells.length; i++) {
    if (cells[i] === TERRAIN_LAND) landIdx.push(i);
  }
  if (landIdx.length === 0) return;

  const biasAngle = hashUnit(seed + 503) * Math.PI * 2;
  const ridgeX = Math.cos(biasAngle);
  const ridgeY = Math.sin(biasAngle);

  const stretchAngle = hashUnit(seed + 521) * Math.PI * 2;
  const sx = Math.cos(stretchAngle);
  const sy = Math.sin(stretchAngle);
  // 各向异性：拉长斑块，减少「圆形公园」感
  const stretch = 1.55 + hashUnit(seed + 533) * 0.55;

  const scores = new Float32Array(landIdx.length);
  for (let k = 0; k < landIdx.length; k++) {
    const i = landIdx[k];
    const x = i % cols;
    const y = (i / cols) | 0;
    const u = (x + 0.5) / cols;
    const v = (y + 0.5) / rows;
    const cu = u - 0.5;
    const cv = v - 0.5;
    const au = cu * sx + cv * sy;
    const av = (-cu * sy + cv * sx) * stretch;
    const uu = au + 0.5;
    const vv = av + 0.5;
    const patch = fbm2d(uu * 3.4, vv * 3.4, seed + 401, 3, 2.1, 0.5);
    const detail = fbm2d(uu * 7.5, vv * 7.5, seed + 419, 2, 2.0, 0.5);
    let s = patch * 0.55 + detail * 0.15 + height[i] * 0.12;

    const edge =
      Math.min(x, y, cols - 1 - x, rows - 1 - y) / Math.max(cols, rows);
    const radial = Math.hypot(u - 0.5, v - 0.5) * 2; // 0 center → ~1.4 corner

    if (dna.greenBias === 'rim' || dna.landform === 'basin') {
      s += Math.max(0, radial - 0.35) * (0.55 + dna.basinRing * 0.45);
      s -= Math.max(0, 0.4 - radial) * 0.35; // 中部少绿，留给建设
    } else if (dna.greenBias === 'coastal_ridge' || dna.landform === 'mountain_sea') {
      const side = (u - 0.5) * ridgeX + (v - 0.5) * ridgeY;
      s += Math.max(0, -side) * 0.55; // 靠山一侧
      s -= Math.max(0, side) * 0.2;
    } else if (dna.greenBias === 'high_ground') {
      s += height[i] * 0.45;
      s += (1 - edge) * 0.08;
    } else {
      s += height[i] * 0.08;
      // 水网平原：略压地图四角圆斑
      if (edge < 0.06) s -= (0.06 - edge) * 1.2;
    }

    scores[k] = s;
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

function buildHeightField(
  cols: number,
  rows: number,
  seed: number,
  fragmentation = DEFAULT_FRAGMENTATION,
  dna: FeatureDna = DEFAULT_FEATURE_DNA,
): Float32Array {
  const field = new Float32Array(cols * rows);
  const biasAngle = hashUnit(seed) * Math.PI * 2;
  const biasX = Math.cos(biasAngle);
  const biasY = Math.sin(biasAngle);
  const frag = clampFragmentation(fragmentation);
  const breakAmt = Math.max(0, Math.min(1, dna.landBreak));

  let continentFreq = 1.9 + hashUnit(seed + 7) * 0.7 + frag * 0.85;
  let warpAmt = 0.08 + hashUnit(seed + 13) * 0.08 + frag * 0.22;
  let rippleAmp = 0.04 + frag * 0.12;
  let sideOcean = 0.34;
  let sideLand = 0.06;
  const octaves = frag > 0.55 ? 6 : 5;

  // 原型骨架：改频率 / 侧向海陆 / 宏观形状
  switch (dna.landform) {
    case 'plain':
      continentFreq = 1.15 + frag * 0.35;
      warpAmt *= 0.55;
      rippleAmp *= 0.45;
      sideOcean = 0.06;
      sideLand = 0.02;
      break;
    case 'basin':
      continentFreq = 1.4 + frag * 0.4;
      warpAmt *= 0.7;
      sideOcean = 0.04;
      sideLand = 0.02;
      break;
    case 'harbor':
      continentFreq = 2.0 + frag * 0.55;
      sideOcean = 0.42;
      sideLand = 0.1;
      break;
    case 'mountain_sea':
      continentFreq = 1.85 + frag * 0.5;
      sideOcean = 0.48;
      sideLand = 0.18;
      break;
    case 'valley':
      continentFreq = 1.55 + frag * 0.4;
      sideOcean = 0.08;
      break;
    case 'archipelago':
      continentFreq = 2.6 + frag * 0.9 + breakAmt;
      warpAmt += 0.12 + breakAmt * 0.15;
      rippleAmp += 0.08;
      sideOcean = 0.28;
      break;
    case 'fjord':
      continentFreq = 2.1 + frag * 0.5;
      warpAmt *= 0.65;
      sideOcean = 0.38;
      break;
    case 'peninsula':
      continentFreq = 1.9 + frag * 0.45;
      sideOcean = 0.4;
      sideLand = 0.12;
      break;
    case 'delta':
      continentFreq = 1.7 + frag * 0.55;
      sideOcean = 0.36;
      warpAmt += 0.06;
      break;
    case 'lake_bowl':
      continentFreq = 1.5 + frag * 0.35;
      sideOcean = 0.05;
      break;
    default:
      break;
  }

  const valleyAngle = biasAngle + Math.PI * 0.5;
  const valleyX = Math.cos(valleyAngle);
  const valleyY = Math.sin(valleyAngle);

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

      let h = fbm2d(uu * continentFreq, vv * continentFreq, seed, octaves, 2.05, 0.48);
      const macro = fbm2d(uu * 0.72, vv * 0.72, seed + 33, 3, 2.0, 0.5);
      h = h * 0.56 + macro * 0.44;

      const side = (u - 0.5) * biasX + (v - 0.5) * biasY;
      if (dna.coastBias === 'surround') {
        const edge = Math.min(u, v, 1 - u, 1 - v);
        h -= Math.max(0, 0.22 - edge) * (0.55 + breakAmt * 0.35);
      } else if (dna.coastBias !== 'none') {
        h -= Math.max(0, side) * sideOcean;
        h += Math.max(0, -side) * sideLand;
      }

      // 盆地：边缘抬高、中心相对平坦可建
      if (dna.landform === 'basin' || dna.basinRing > 0.05) {
        const radial = Math.hypot(u - 0.5, v - 0.5) * 2;
        const ring = Math.max(0, radial - 0.28);
        h += ring * (0.28 + dna.basinRing * 0.5);
        h += (0.42 - Math.min(radial, 0.42)) * 0.08;
      }

      // 河谷：沿山谷轴压低一条走廊
      if (dna.landform === 'valley') {
        const along = (u - 0.5) * valleyX + (v - 0.5) * valleyY;
        const across = (u - 0.5) * -valleyY + (v - 0.5) * valleyX;
        h -= Math.max(0, 0.22 - Math.abs(across)) * 0.55;
        h += Math.abs(along) * 0.04;
      }

      // 半岛：中心脊向海洋侧伸出
      if (dna.landform === 'peninsula' || dna.coastBias === 'peninsula') {
        const along = (u - 0.5) * biasX + (v - 0.5) * biasY;
        const across = (u - 0.5) * -biasY + (v - 0.5) * biasX;
        h += Math.max(0, along) * 0.22;
        h -= Math.abs(across) * 0.18;
        h -= Math.max(0, -along) * 0.35;
      }

      // 三角洲：靠海一侧更低、更碎
      if (dna.landform === 'delta') {
        h -= Math.max(0, side) * 0.18;
        h += (valueNoise2d(u * 6, v * 6, seed + 55) - 0.5) * 0.12;
      }

      // 湖区：中心浅碗
      if (dna.landform === 'lake_bowl') {
        const radial = Math.hypot(u - 0.5, v - 0.5) * 2;
        h -= Math.max(0, 0.55 - radial) * 0.32;
      }

      // 群岛：高频碎斑
      if (dna.landform === 'archipelago' || breakAmt > 0.45) {
        const speck = fbm2d(u * 8, v * 8, seed + 88, 3, 2.2, 0.5);
        h += (speck - 0.5) * (0.1 + breakAmt * 0.22);
      }

      const ripples = fbm2d(u * (5.5 + frag * 4), v * (5.5 + frag * 4), seed + 77, 3, 2.1, 0.48);
      h += (ripples - 0.5) * rippleAmp;

      field[r * cols + c] = h;
    }
  }
  return field;
}

/** 从开敞海一侧向内凹入港湾 */
function carveHarborBay(
  cells: Uint8Array,
  cols: number,
  rows: number,
  seed: number,
  bayDepth: number,
  field: Float32Array,
): void {
  const angle = hashUnit(seed + 211) * Math.PI * 2;
  const ox = Math.cos(angle);
  const oy = Math.sin(angle);
  const depth = 0.18 + bayDepth * 0.28;
  const width = 0.14 + bayDepth * 0.12;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const u = (x + 0.5) / cols - 0.5;
      const v = (y + 0.5) / rows - 0.5;
      const along = u * ox + v * oy;
      const across = u * -oy + v * ox;
      // 靠海半侧、窄通道向内陆
      if (along < 0.02) continue;
      const throat = Math.abs(across) / width;
      const reach = along / depth;
      if (throat + reach * reach > 1.15) continue;
      const i = y * cols + x;
      if (field[i] < 0.62) cells[i] = TERRAIN_WATER;
    }
  }
}

/** 狭长水道切入陆地 */
function carveFjords(
  cells: Uint8Array,
  cols: number,
  rows: number,
  seed: number,
  strength: number,
): void {
  const count = 2 + Math.round(strength * 2);
  const angle0 = hashUnit(seed + 307) * Math.PI * 2;
  for (let f = 0; f < count; f++) {
    const angle = angle0 + f * 0.55 + hashUnit(seed + 40 + f) * 0.35;
    const ox = Math.cos(angle);
    const oy = Math.sin(angle);
    const lateral = (hashUnit(seed + 90 + f) - 0.5) * 0.45;
    const px = -oy;
    const py = ox;
    const width = 0.035 + strength * 0.03;
    const length = 0.35 + strength * 0.35;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const u = (x + 0.5) / cols - 0.5;
        const v = (y + 0.5) / rows - 0.5;
        const cu = u - px * lateral;
        const cv = v - py * lateral;
        const along = cu * ox + cv * oy;
        const across = cu * -oy + cv * ox;
        if (along < 0.05 || along > length) continue;
        if (Math.abs(across) > width * (1.1 - along * 0.4)) continue;
        cells[y * cols + x] = TERRAIN_WATER;
      }
    }
  }
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

/** 绿地边界多数票平滑（不侵染水域） */
function smoothGreenLand(
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
        if (cells[i] === TERRAIN_WATER) continue;
        let green = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            if (cells[(y + dy) * cols + (x + dx)] === TERRAIN_GREEN) green++;
          }
        }
        if (green >= 5) next[i] = TERRAIN_GREEN;
        else if (green <= 3 && cells[i] === TERRAIN_GREEN) next[i] = TERRAIN_LAND;
      }
    }
    cells.set(next);
  }
}

type RiverSegment = {
  cells: number[];
  /** 2 主干 · 1 较大支流 · 0 小溪 */
  order: number;
};

/**
 * 树状河网：先少而粗的主干入海，再让支流汇入主干（分支/汇合更清晰）。
 * 密度主要增加支流，而不是再铺一堆互不相关的平行河。
 */
function generateRiverNetwork(
  cells: Uint8Array,
  cols: number,
  rows: number,
  seed: number,
  density: number,
  dna: FeatureDna = DEFAULT_FEATURE_DNA,
): RiverSegment[] {
  const n = cols * rows;
  const seaDist = buildOutletDistance(cells, cols, rows);
  const riverMask = new Uint8Array(n);
  const sourceUsed = new Uint8Array(n);
  const rivers: RiverSegment[] = [];

  let trunkCount = Math.max(1, Math.min(2, Math.round(0.55 + density * 1.2)));
  let tribCount = Math.max(0, Math.round(density * 3.2));
  let trunkMin = Math.max(28, Math.floor(Math.max(cols, rows) * 0.3));
  let tribMin = Math.max(14, Math.floor(Math.max(cols, rows) * 0.14));

  switch (dna.channelStyle) {
    case 'dense_narrow':
      trunkCount = Math.max(2, Math.min(3, Math.round(1.2 + density * 1.6)));
      tribCount = Math.max(3, Math.round(density * 6.5));
      trunkMin = Math.max(22, Math.floor(Math.max(cols, rows) * 0.22));
      tribMin = Math.max(10, Math.floor(Math.max(cols, rows) * 0.1));
      break;
    case 'single_trunk':
      trunkCount = 1;
      tribCount = Math.max(1, Math.round(density * 2.2));
      trunkMin = Math.max(36, Math.floor(Math.max(cols, rows) * 0.38));
      break;
    case 'delta_branch':
      trunkCount = Math.max(1, Math.min(2, Math.round(0.8 + density)));
      tribCount = Math.max(2, Math.round(density * 5));
      tribMin = Math.max(12, Math.floor(Math.max(cols, rows) * 0.12));
      break;
    case 'sparse':
      trunkCount = Math.max(1, Math.round(0.4 + density * 0.8));
      tribCount = Math.max(0, Math.round(density * 1.5));
      break;
    default:
      break;
  }

  for (let i = 0; i < trunkCount * 6 && rivers.filter((r) => r.order === 2).length < trunkCount; i++) {
    const source = pickSourceCell(cells, cols, rows, seed + i * 97, sourceUsed, seaDist);
    if (source == null) break;
    const path = meanderToOutlet(cells, seaDist, cols, rows, source, seed + i * 131);
    if (!isValidRiverPath(path, cells, cols, rows, trunkMin)) continue;
    stampRiverMask(riverMask, path);
    markCorridor(sourceUsed, cols, rows, source % cols, (source / cols) | 0, 12);
    // 主干走廊加宽，减少平行「杂河」
    for (const cell of path) {
      markCorridor(sourceUsed, cols, rows, cell % cols, (cell / cols) | 0, 4);
    }
    rivers.push({ cells: path, order: 2 });
  }

  if (rivers.length === 0) return rivers;

  const joinDist = buildJoinDistance(cells, riverMask, cols, rows);

  for (let i = 0; i < tribCount * 6 && rivers.filter((r) => r.order < 2).length < tribCount; i++) {
    const source = pickSourceCell(
      cells,
      cols,
      rows,
      seed + 900 + i * 67,
      sourceUsed,
      joinDist,
    );
    if (source == null) break;
    const path = meanderToOutlet(cells, joinDist, cols, rows, source, seed + 400 + i * 151);
    if (!joinsNetwork(path, riverMask, cells, cols, rows, tribMin)) continue;
    const clipped = clipPathAtJoin(path, riverMask, cells, cols, rows);
    if (clipped.length < tribMin) continue;
    // 支流太短或几乎贴着主干平行 → 跳过
    if (avgDistToMask(clipped, riverMask, cols, rows) < 2.2) continue;
    const order = clipped.length >= trunkMin * 0.5 ? 1 : 0;
    stampRiverMask(riverMask, clipped);
    markCorridor(sourceUsed, cols, rows, source % cols, (source / cols) | 0, 7);
    for (const cell of clipped) {
      markCorridor(sourceUsed, cols, rows, cell % cols, (cell / cols) | 0, 3);
    }
    rivers.push({ cells: clipped, order });
  }

  return rivers;
}

function stampRiverMask(mask: Uint8Array, path: number[]): void {
  for (const i of path) mask[i] = 1;
}

/** 路径中段相对已有河道的平均距离；过小说明平行贴着走而非汇入 */
function avgDistToMask(
  path: number[],
  riverMask: Uint8Array,
  cols: number,
  rows: number,
): number {
  if (path.length < 4) return 0;
  const midStart = Math.floor(path.length * 0.2);
  const midEnd = Math.floor(path.length * 0.7);
  let sum = 0;
  let count = 0;
  for (let k = midStart; k < midEnd; k++) {
    const i = path[k]!;
    const x = i % cols;
    const y = (i / cols) | 0;
    let best = 99;
    for (let r = 1; r <= 8 && best === 99; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          if (riverMask[ny * cols + nx]) best = r;
        }
      }
    }
    sum += best === 99 ? 8 : best;
    count++;
  }
  return count ? sum / count : 0;
}

/** 出水口 = 海/湖 ∪ 已有河道（支流汇入主干） */
function buildJoinDistance(
  cells: Uint8Array,
  riverMask: Uint8Array,
  cols: number,
  rows: number,
): Float32Array {
  const n = cols * rows;
  const dist = new Float32Array(n);
  dist.fill(1e9);
  const queue: number[] = [];
  for (let i = 0; i < n; i++) {
    if (cells[i] === TERRAIN_WATER || riverMask[i]) {
      dist[i] = 0;
      queue.push(i);
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

function joinsNetwork(
  path: number[],
  riverMask: Uint8Array,
  cells: Uint8Array,
  cols: number,
  rows: number,
  minLen: number,
): boolean {
  if (path.length < minLen) return false;
  for (let k = Math.max(0, path.length - 8); k < path.length; k++) {
    const i = path[k]!;
    if (riverMask[i] || cells[i] === TERRAIN_WATER) return true;
    const x = i % cols;
    const y = (i / cols) | 0;
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
      if (riverMask[j] || cells[j] === TERRAIN_WATER) return true;
    }
  }
  return false;
}

function clipPathAtJoin(
  path: number[],
  riverMask: Uint8Array,
  cells: Uint8Array,
  cols: number,
  rows: number,
): number[] {
  for (let k = 0; k < path.length; k++) {
    const i = path[k]!;
    if (riverMask[i] || cells[i] === TERRAIN_WATER) {
      return path.slice(0, k + 1);
    }
    const x = i % cols;
    const y = (i / cols) | 0;
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
      if (riverMask[j] || cells[j] === TERRAIN_WATER) {
        return path.slice(0, k + 1);
      }
    }
  }
  return path;
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
  return x === 0 || y === 0 || x === cols - 1 || y === rows - 1;
}

/** 按层级刻河：宽度按米换算成格，细栅格下物理尺度不变 */
function carveRiverNetwork(
  cells: Uint8Array,
  cols: number,
  rows: number,
  rivers: RiverSegment[],
  cellSizeM: number,
): void {
  const sorted = [...rivers].sort((a, b) => b.order - a.order);
  const cs = Math.max(1, cellSizeM);
  for (const river of sorted) {
    const path = river.cells;
    if (path.length < 2) continue;
    const n = path.length;
    // 半宽（米）：主干 / 次干 / 细支
    const baseHalfM = river.order >= 2 ? 14 : river.order >= 1 ? 9 : 5;
    for (let i = 0; i < n; i++) {
      const idx = path[i]!;
      const x = idx % cols;
      const y = (idx / cols) | 0;
      const t = i / (n - 1);
      let halfM = baseHalfM;
      if (t > 0.45) halfM += river.order >= 2 ? 4 : 2.5;
      if (t > 0.72) halfM += river.order >= 2 ? 5 : 3;
      if (t > 0.88) halfM += river.order >= 2 ? 5 : 3.5;
      // 支流汇合口加宽，形成「Y」形汇点
      if (river.order < 2 && t > 0.78) halfM = Math.max(halfM, 12);
      if (river.order < 2 && t > 0.9) halfM = Math.max(halfM, 15);
      const maxHalfM = river.order >= 2 ? 28 : river.order >= 1 ? 18 : 16;
      halfM = Math.min(halfM, maxHalfM);
      const radius = halfM / cs;
      const rCeil = Math.ceil(radius);

      for (let dy = -rCeil; dy <= rCeil; dy++) {
        for (let dx = -rCeil; dx <= rCeil; dx++) {
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
 * 沙盒常用做法：连续航向 + 惯性 + 横向蜿蜒噪声，再栅格化。
 * （参考 Fantasy Map / Red Blob 一类：朝出水口生长，用 meander 位移，而非格点折线寻路）
 */
function meanderToOutlet(
  cells: Uint8Array,
  outletDist: Float32Array,
  cols: number,
  rows: number,
  start: number,
  seed: number,
): number[] {
  let x = (start % cols) + 0.5;
  let y = ((start / cols) | 0) + 0.5;

  // 初始朝向：出水口距离场的下降方向
  let heading = outletHeading(outletDist, cols, rows, x, y);
  heading += (hashUnit(seed) - 0.5) * 0.9;

  const meanderAmp = 0.85 + hashUnit(seed + 3) * 0.55;
  const meanderFreq = 0.055 + hashUnit(seed + 5) * 0.05;
  const stepLen = 0.48;
  const maxSteps = Math.floor(Math.max(cols, rows) * 5);
  const samples: { x: number; y: number }[] = [{ x, y }];

  for (let step = 0; step < maxSteps; step++) {
    const cx = Math.floor(x);
    const cy = Math.floor(y);
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) break;
    if (cells[cy * cols + cx] === TERRAIN_WATER) break;
    if (touchesWaterOrBorder(cells, cols, rows, cx, cy)) {
      samples.push({ x, y });
      break;
    }

    const progress = step / maxSteps;
    // 靠近河口时减弱摆动，避免入海前乱甩
    const amp = meanderAmp * (0.45 + 0.55 * (1 - progress) ** 0.6);

    // 主航向缓缓对准出水口（惯性，不像格点贪心那样直角折）
    const target = outletHeading(outletDist, cols, rows, x, y);
    heading = lerpAngle(heading, target, 0.07 + progress * 0.06);

    // 横向蜿蜒：低频正弦 + 位置噪声（类似 Azgaar meander / curl noise）
    const phase = seed * 0.001 + step * meanderFreq;
    const sway =
      Math.sin(phase * Math.PI * 2) * amp * 0.85 +
      (valueNoise2d(x * 0.055, y * 0.055, seed + 11) - 0.5) * amp * 1.35 +
      (valueNoise2d(x * 0.025 + step * 0.008, y * 0.025, seed + 29) - 0.5) * amp * 0.7;
    heading += sway * 0.32;

    // 限速转向，保留弧线感
    const prev = samples.length >= 2 ? samples[samples.length - 2]! : null;
    if (prev) {
      const prevH = Math.atan2(y - prev.y, x - prev.x);
      heading = lerpAngle(prevH, heading, 0.42);
    }

    x += Math.cos(heading) * stepLen;
    y += Math.sin(heading) * stepLen;
    samples.push({ x, y });

    if (outletDist[cy * cols + cx] <= 1.5) break;
  }

  // Chaikin 平滑，去掉锯齿折角
  const smooth = chaikin(samples, 3);
  return rasterizePolyline(smooth, cols, rows);
}

function outletHeading(
  outletDist: Float32Array,
  cols: number,
  rows: number,
  x: number,
  y: number,
): number {
  const ix = Math.max(1, Math.min(cols - 2, Math.floor(x)));
  const iy = Math.max(1, Math.min(rows - 2, Math.floor(y)));
  const dx =
    outletDist[iy * cols + (ix + 1)] - outletDist[iy * cols + (ix - 1)];
  const dy =
    outletDist[(iy + 1) * cols + ix] - outletDist[(iy - 1) * cols + ix];
  // 朝距离减小的方向走
  if (Math.abs(dx) + Math.abs(dy) < 1e-6) {
    return hashUnit((ix * 73856093) ^ (iy * 19349663)) * Math.PI * 2;
  }
  return Math.atan2(-dy, -dx);
}

function touchesWaterOrBorder(
  cells: Uint8Array,
  cols: number,
  rows: number,
  cx: number,
  cy: number,
): boolean {
  if (cx <= 0 || cy <= 0 || cx >= cols - 1 || cy >= rows - 1) return true;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (cells[(cy + dy) * cols + (cx + dx)] === TERRAIN_WATER) return true;
    }
  }
  return false;
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.max(0, Math.min(1, t));
}

/** Chaikin corner-cutting：折线变圆滑 */
function chaikin(
  pts: { x: number; y: number }[],
  rounds: number,
): { x: number; y: number }[] {
  let cur = pts;
  for (let r = 0; r < rounds; r++) {
    if (cur.length < 3) break;
    const next: { x: number; y: number }[] = [cur[0]!];
    for (let i = 0; i < cur.length - 1; i++) {
      const p = cur[i]!;
      const q = cur[i + 1]!;
      next.push(
        { x: p.x * 0.75 + q.x * 0.25, y: p.y * 0.75 + q.y * 0.25 },
        { x: p.x * 0.25 + q.x * 0.75, y: p.y * 0.25 + q.y * 0.75 },
      );
    }
    next.push(cur[cur.length - 1]!);
    cur = next;
  }
  return cur;
}

function rasterizePolyline(
  pts: { x: number; y: number }[],
  cols: number,
  rows: number,
): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const push = (cx: number, cy: number) => {
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return;
    const i = cy * cols + cx;
    if (seen.has(i)) return;
    seen.add(i);
    out.push(i);
  };

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    const steps = Math.max(1, Math.ceil(dist * 2.2));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const x = a.x + (b.x - a.x) * t;
      const y = a.y + (b.y - a.y) * t;
      push(Math.floor(x), Math.floor(y));
      // 轻微加粗采样，减少断点
      push(Math.floor(x + 0.35), Math.floor(y));
      push(Math.floor(x), Math.floor(y + 0.35));
    }
  }
  return out;
}

/** 内陆湖泊：低洼盆地成封闭水塘（同水色） */
function paintLakes(
  cells: Uint8Array,
  field: Float32Array,
  cols: number,
  rows: number,
  seed: number,
  density: number,
  dna: FeatureDna = DEFAULT_FEATURE_DNA,
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
    let s = (1 - field[i]) * 0.55 + (1 - basin) * 0.35 + edge * 0.25;

    if (dna.landform === 'lake_bowl' || dna.lakeBias > 0.5) {
      const radial = Math.hypot(u - 0.5, v - 0.5) * 2;
      s += Math.max(0, 0.55 - radial) * (0.35 + dna.lakeBias * 0.35);
    }
    if (dna.landform === 'basin') {
      // 盆地中心可有浅湖，边缘少湖
      const radial = Math.hypot(u - 0.5, v - 0.5) * 2;
      s += Math.max(0, 0.4 - radial) * 0.25;
      s -= Math.max(0, radial - 0.55) * 0.4;
    }
    if (dna.landform === 'plain') {
      // 水网平原：多小湖塘
      s += (1 - basin) * 0.2;
    }

    scores[k] = s;
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

function pruneSmallSeas(
  cells: Uint8Array,
  cols: number,
  rows: number,
  minFrac = 0.01,
): void {
  const n = cols * rows;
  const minSea = Math.max(48, Math.floor(n * minFrac));
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

function cleanupIslands(
  cells: Uint8Array,
  cols: number,
  rows: number,
  minFrac = 0.005,
): void {
  const n = cols * rows;
  const minIslandKeep = Math.max(28, Math.floor(n * minFrac));
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

/** 预览：双线性超采样位图（清晰对角线岸，无毛玻璃） */
export function paintTerrainPreview(
  canvas: HTMLCanvasElement,
  grid: TerrainGrid,
  _rivers?: Point[][],
  _settings?: Pick<MapSettings, 'widthM' | 'heightM'>,
  landColor = '#f2efe9',
  waterColor = '#aad3df',
  greenColor = '#add19e',
): void {
  paintTerrainBitmapToCanvas(canvas, grid, landColor, waterColor, greenColor);
}
