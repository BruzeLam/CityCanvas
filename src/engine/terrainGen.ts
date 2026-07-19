import type { MapSettings } from '../types';
import { warpedFbm } from './noise';
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
 * 架空海陆 MVP：
 * - 扭曲噪声场 + 轻度「外海偏一侧」偏置
 * - 按分位数切出 oceanRatio 的水域，其余陆地
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

  // 噪声采样尺度：大地图用更低频率，保持海湾/半岛尺度
  const scale = Math.max(cols, rows) / 48;
  const field = new Float32Array(n);

  // 外海偏置方向由种子决定（架空，非真实方位）
  const biasAngle = (hashAngle(seed) * Math.PI) / 180;
  const biasX = Math.cos(biasAngle);
  const biasY = Math.sin(biasAngle);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const u = (c + 0.5) / cols;
      const v = (r + 0.5) / rows;
      const nx = (c / scale) * 0.85;
      const ny = (r / scale) * 0.85;
      let h = warpedFbm(nx, ny, seed, 0.45);

      // 向某一侧拉低 → 大片开敞水域感（大湾偏向，仍随种子变向）
      const cx = u - 0.5;
      const cy = v - 0.5;
      const side = cx * biasX + cy * biasY; // -0.7..0.7
      h -= Math.max(0, side) * 0.22;
      // 边缘略压低，减少「地图切边全是陆地」
      const edge = Math.min(u, v, 1 - u, 1 - v);
      if (edge < 0.08) h -= (0.08 - edge) * 1.2;

      field[r * cols + c] = h;
    }
  }

  const threshold = percentileThreshold(field, oceanRatio);
  for (let i = 0; i < n; i++) {
    cells[i] = field[i] <= threshold ? TERRAIN_WATER : TERRAIN_LAND;
  }

  return grid;
}

function hashAngle(seed: number): number {
  let x = seed | 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d);
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b);
  return ((x >>> 0) % 3600) / 10;
}

/** 使约 ratio 比例的样本 ≤ 阈值 */
function percentileThreshold(field: Float32Array, ratio: number): number {
  const sample = field.length > 12000 ? downsample(field, 12000) : Float32Array.from(field);
  sample.sort();
  const idx = Math.max(0, Math.min(sample.length - 1, Math.floor(sample.length * ratio)));
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
