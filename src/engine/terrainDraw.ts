import type { Point } from '../types';
import {
  TERRAIN_GREEN,
  TERRAIN_WATER,
  type TerrainGrid,
} from './terrain';

export type TerrainPaintQuality = 'draft' | 'final';

type TerrainBitmapCache = {
  cells: Uint8Array;
  cols: number;
  rows: number;
  cellSizeM: number;
  waterKey: string;
  greenKey: string;
  quality: TerrainPaintQuality;
  canvas: HTMLCanvasElement;
};

let terrainBitmapCache: TerrainBitmapCache | null = null;

function parseCssColor(css: string): [number, number, number, number] {
  if (css.startsWith('#') && (css.length === 7 || css.length === 4)) {
    const hex =
      css.length === 4
        ? `#${css[1]}${css[1]}${css[2]}${css[2]}${css[3]}${css[3]}`
        : css;
    return [
      parseInt(hex.slice(1, 3), 16),
      parseInt(hex.slice(3, 5), 16),
      parseInt(hex.slice(5, 7), 16),
      255,
    ];
  }
  const m = css.match(
    /rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/,
  );
  if (m) {
    return [
      Number(m[1]),
      Number(m[2]),
      Number(m[3]),
      m[4] != null ? Math.round(Number(m[4]) * 255) : 255,
    ];
  }
  return [170, 211, 223, 255];
}

/**
 * 中等栅格也能看起来顺：对 0/1 掩膜做双线性采样再硬阈值，
 * 岸线会沿格心对角线切开（比最近邻楼梯顺，又不会整图毛玻璃）。
 * draft=格点原样（刷子拖动时快）；final=2× 超采样缓存。
 */
export function getTerrainBitmap(
  grid: TerrainGrid,
  waterCss: string,
  greenCss: string,
  quality: TerrainPaintQuality = 'final',
): HTMLCanvasElement {
  // 草稿不走缓存：刷子原地改 cells，引用不变也会变脏
  if (quality === 'draft') {
    return buildNearestBitmap(grid, waterCss, greenCss);
  }

  const { cols, rows, cells, cellSizeM } = grid;
  const hit = terrainBitmapCache;
  if (
    hit &&
    hit.cells === cells &&
    hit.cols === cols &&
    hit.rows === rows &&
    hit.cellSizeM === cellSizeM &&
    hit.waterKey === waterCss &&
    hit.greenKey === greenCss &&
    hit.quality === 'final'
  ) {
    return hit.canvas;
  }

  const canvas = buildSmoothBitmap(grid, waterCss, greenCss);
  terrainBitmapCache = {
    cells,
    cols,
    rows,
    cellSizeM,
    waterKey: waterCss,
    greenKey: greenCss,
    quality: 'final',
    canvas,
  };
  return canvas;
}

export function invalidateTerrainBitmapCache(): void {
  terrainBitmapCache = null;
}

function buildNearestBitmap(
  grid: TerrainGrid,
  waterCss: string,
  greenCss: string,
): HTMLCanvasElement {
  const { cols, rows, cells } = grid;
  const canvas = document.createElement('canvas');
  canvas.width = cols;
  canvas.height = rows;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(cols, rows);
  const data = img.data;
  const water = parseCssColor(waterCss);
  const green = parseCssColor(greenCss);

  for (let i = 0; i < cells.length; i++) {
    const v = cells[i]!;
    const o = i * 4;
    if (v === TERRAIN_WATER) {
      data[o] = water[0];
      data[o + 1] = water[1];
      data[o + 2] = water[2];
      data[o + 3] = water[3];
    } else if (v === TERRAIN_GREEN) {
      data[o] = green[0];
      data[o + 1] = green[1];
      data[o + 2] = green[2];
      data[o + 3] = green[3];
    } else {
      data[o + 3] = 0;
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** 输出边长上限，避免超采样位图过大 */
const SMOOTH_MAX_EDGE = 1280;

function buildSmoothBitmap(
  grid: TerrainGrid,
  waterCss: string,
  greenCss: string,
): HTMLCanvasElement {
  const { cols, rows, cells } = grid;
  const maxSide = Math.max(cols, rows);
  const outEdge = Math.min(SMOOTH_MAX_EDGE, Math.max(640, Math.round(maxSide * 2)));
  const outW = Math.max(1, Math.round((outEdge * cols) / maxSide));
  const outH = Math.max(1, Math.round((outEdge * rows) / maxSide));

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(outW, outH);
  const data = img.data;
  const water = parseCssColor(waterCss);
  const green = parseCssColor(greenCss);

  const maskAt = (target: number, gx: number, gy: number): number => {
    const x = gx - 0.5;
    const y = gy - 0.5;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const v = (ix: number, iy: number) => {
      if (ix < 0 || iy < 0 || ix >= cols || iy >= rows) return 0;
      return cells[iy * cols + ix] === target ? 1 : 0;
    };
    const a = v(x0, y0);
    const b = v(x0 + 1, y0);
    const c = v(x0, y0 + 1);
    const d = v(x0 + 1, y0 + 1);
    return (
      a * (1 - tx) * (1 - ty) +
      b * tx * (1 - ty) +
      c * (1 - tx) * ty +
      d * tx * ty
    );
  };

  for (let py = 0; py < outH; py++) {
    const gy = ((py + 0.5) / outH) * rows;
    for (let px = 0; px < outW; px++) {
      const gx = ((px + 0.5) / outW) * cols;
      const ow = maskAt(TERRAIN_WATER, gx, gy);
      const og = maskAt(TERRAIN_GREEN, gx, gy);
      const o = (py * outW + px) * 4;
      if (ow >= 0.5) {
        data[o] = water[0];
        data[o + 1] = water[1];
        data[o + 2] = water[2];
        data[o + 3] = water[3];
      } else if (og >= 0.5) {
        data[o] = green[0];
        data[o + 1] = green[1];
        data[o + 2] = green[2];
        data[o + 3] = green[3];
      } else {
        data[o + 3] = 0;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** 设置页预览 */
export function paintTerrainBitmapToCanvas(
  canvas: HTMLCanvasElement,
  grid: TerrainGrid,
  landColor: string,
  waterColor: string,
  greenColor: string,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = landColor;
  ctx.fillRect(0, 0, w, h);
  const bmp = getTerrainBitmap(grid, waterColor, greenColor, 'final');
  ctx.imageSmoothingEnabled = w < bmp.width || h < bmp.height;
  if (ctx.imageSmoothingEnabled) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
}

/** @deprecated 保留空壳避免旧引用；请用 getTerrainBitmap */
export type TerrainRings = {
  cells: Uint8Array;
  cols: number;
  rows: number;
  cellSizeM: number;
  water: Point[][];
  green: Point[][];
};

export function buildTerrainRings(grid: TerrainGrid): TerrainRings {
  return {
    cells: grid.cells,
    cols: grid.cols,
    rows: grid.rows,
    cellSizeM: grid.cellSizeM,
    water: [],
    green: [],
  };
}

export function fillTerrainRings(): void {
  /* no-op */
}
