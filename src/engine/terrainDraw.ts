import type { Point } from '../types';
import {
  TERRAIN_GREEN,
  TERRAIN_WATER,
  type TerrainCell,
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
  canvas: HTMLCanvasElement;
};

let terrainBitmapCache: TerrainBitmapCache | null = null;

/** 烘焙位图最长边：够细、又不会拖垮一次烘焙 */
const BAKE_MAX_EDGE = 1800;

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
 * draft：格点原样（刷子拖动快）
 * final：提取轮廓 → Chaikin → 烘焙到高分辨率位图（只算一次，平移只 drawImage）
 */
export function getTerrainBitmap(
  grid: TerrainGrid,
  waterCss: string,
  greenCss: string,
  quality: TerrainPaintQuality = 'final',
): HTMLCanvasElement {
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
    hit.greenKey === greenCss
  ) {
    return hit.canvas;
  }

  const canvas = buildContourBakedBitmap(grid, waterCss, greenCss);
  terrainBitmapCache = {
    cells,
    cols,
    rows,
    cellSizeM,
    waterKey: waterCss,
    greenKey: greenCss,
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

function bakeSize(cols: number, rows: number): { outW: number; outH: number; pxPerCell: number } {
  const maxSide = Math.max(cols, rows);
  // 每格至少 2.5 屏像素，上限 BAKE_MAX_EDGE
  const outEdge = Math.min(BAKE_MAX_EDGE, Math.max(960, Math.round(maxSide * 2.75)));
  const outW = Math.max(1, Math.round((outEdge * cols) / maxSide));
  const outH = Math.max(1, Math.round((outEdge * rows) / maxSide));
  return { outW, outH, pxPerCell: outW / cols };
}

/** 轮廓平滑后矢量填充到高清位图（一次烘焙） */
function buildContourBakedBitmap(
  grid: TerrainGrid,
  waterCss: string,
  greenCss: string,
): HTMLCanvasElement {
  const { cols, rows } = grid;
  const { outW, outH, pxPerCell } = bakeSize(cols, rows);
  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d')!;
  ctx.clearRect(0, 0, outW, outH);

  const waterRings = extractSmoothRings(grid, TERRAIN_WATER);
  const greenRings = extractSmoothRings(grid, TERRAIN_GREEN);

  // 只画平滑轮廓，避免底下最近邻楼梯透出来
  fillRingsOnBake(ctx, greenRings, pxPerCell, greenCss);
  fillRingsOnBake(ctx, waterRings, pxPerCell, waterCss);

  return canvas;
}

function fillRingsOnBake(
  ctx: CanvasRenderingContext2D,
  rings: Point[][],
  pxPerCell: number,
  fill: string,
): void {
  if (rings.length === 0) return;
  ctx.beginPath();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    // ring 坐标是「格点角」米制；此处 cellSize 已折进角点整数，用格坐标 * pxPerCell
    // extract 返回的是世界米；bake 用格角坐标更稳——见 extractSmoothRings
    const s0 = ring[0]!;
    ctx.moveTo(s0.x * pxPerCell, s0.y * pxPerCell);
    for (let i = 1; i < ring.length; i++) {
      const p = ring[i]!;
      ctx.lineTo(p.x * pxPerCell, p.y * pxPerCell);
    }
    ctx.closePath();
  }
  ctx.fillStyle = fill;
  ctx.fill('evenodd');
}

/** 返回格点角坐标（非米），方便烘焙 */
function extractSmoothRings(grid: TerrainGrid, target: TerrainCell): Point[][] {
  const { cols, rows } = grid;
  const loops = extractCornerLoops(grid, target);
  const out: Point[][] = [];
  for (const loop of loops) {
    if (loop.length < 4) continue;
    const pts = loop.map(([cx, cy]) => ({ x: cx, y: cy }));
    const simplified = simplifyCollinear(pts, 0.35);
    if (simplified.length < 4) continue;
    // 只轻量削台阶；贴地图外框的点钉死，避免角上被抹成圆弧
    out.push(chaikinClosedPinned(simplified, 1, cols, rows));
  }
  return out;
}

function extractCornerLoops(
  grid: TerrainGrid,
  target: TerrainCell,
): [number, number][][] {
  const { cols, rows, cells } = grid;
  const cols1 = cols + 1;

  const isInside = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return false;
    return cells[y * cols + x] === target;
  };

  const adj = new Map<number, number[]>();
  const addEdge = (a: number, b: number) => {
    if (a === b) return;
    let la = adj.get(a);
    if (!la) {
      la = [];
      adj.set(a, la);
    }
    let lb = adj.get(b);
    if (!lb) {
      lb = [];
      adj.set(b, lb);
    }
    if (!la.includes(b)) la.push(b);
    if (!lb.includes(a)) lb.push(a);
  };

  const id = (cx: number, cy: number) => cy * cols1 + cx;

  for (let y = -1; y < rows; y++) {
    for (let x = -1; x < cols; x++) {
      const a = isInside(x, y);
      const right = isInside(x + 1, y);
      const down = isInside(x, y + 1);
      if (a !== right) addEdge(id(x + 1, y), id(x + 1, y + 1));
      if (a !== down) addEdge(id(x, y + 1), id(x + 1, y + 1));
    }
  }

  const used = new Set<string>();
  const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);
  const loops: [number, number][][] = [];

  for (const [start, neighbors] of adj) {
    for (const first of neighbors) {
      const ek0 = edgeKey(start, first);
      if (used.has(ek0)) continue;

      const loop: [number, number][] = [];
      let prev = start;
      let cur = first;
      used.add(ek0);
      loop.push([start % cols1, (start / cols1) | 0]);

      let guard = 0;
      const maxGuard = (cols + 1) * (rows + 1) * 2;
      while (cur !== start && guard++ < maxGuard) {
        loop.push([cur % cols1, (cur / cols1) | 0]);
        const nexts = adj.get(cur);
        if (!nexts || nexts.length === 0) break;
        let next = -1;
        for (const cand of nexts) {
          if (cand === prev) continue;
          if (!used.has(edgeKey(cur, cand))) {
            next = cand;
            break;
          }
        }
        if (next < 0) {
          for (const cand of nexts) {
            if (cand === prev) continue;
            next = cand;
            break;
          }
        }
        if (next < 0) break;
        used.add(edgeKey(cur, next));
        prev = cur;
        cur = next;
      }

      if (loop.length >= 4) loops.push(loop);
    }
  }

  return loops;
}

function simplifyCollinear(points: Point[], eps: number): Point[] {
  if (points.length < 4) return points;
  const out: Point[] = [];
  const n = points.length;
  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n]!;
    const cur = points[i]!;
    const next = points[(i + 1) % n]!;
    const ax = cur.x - prev.x;
    const ay = cur.y - prev.y;
    const bx = next.x - cur.x;
    const by = next.y - cur.y;
    const cross = ax * by - ay * bx;
    const dot = ax * bx + ay * by;
    if (Math.abs(cross) <= eps * eps && dot > 0) continue;
    out.push(cur);
  }
  return out.length >= 4 ? out : points;
}

function chaikinClosed(points: Point[], iters: number): Point[] {
  let pts = points;
  for (let k = 0; k < iters; k++) {
    const next: Point[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      next.push({
        x: a.x * 0.75 + b.x * 0.25,
        y: a.y * 0.75 + b.y * 0.25,
      });
      next.push({
        x: a.x * 0.25 + b.x * 0.75,
        y: a.y * 0.25 + b.y * 0.75,
      });
    }
    pts = next;
  }
  return pts;
}

/** 点是否落在地图外框上（格角坐标系） */
function onMapFrame(p: Point, cols: number, rows: number): boolean {
  const e = 1e-4;
  return p.x <= e || p.y <= e || p.x >= cols - e || p.y >= rows - e;
}

/**
 * 闭包 Chaikin，但钉住贴地图边框的顶点。
 * 否则绿地/水域顶到画布角时，会被抹成「圆形边角」。
 */
function chaikinClosedPinned(
  points: Point[],
  iters: number,
  cols: number,
  rows: number,
): Point[] {
  let pts = points.map((p) => ({ x: p.x, y: p.y }));
  for (let k = 0; k < iters; k++) {
    const next: Point[] = [];
    const n = pts.length;
    for (let i = 0; i < n; i++) {
      const a = pts[i]!;
      const b = pts[(i + 1) % n]!;
      const aBorder = onMapFrame(a, cols, rows);
      const bBorder = onMapFrame(b, cols, rows);
      if (aBorder && bBorder) {
        next.push(a);
        continue;
      }
      if (aBorder) {
        next.push(a);
        next.push({
          x: a.x * 0.25 + b.x * 0.75,
          y: a.y * 0.25 + b.y * 0.75,
        });
        continue;
      }
      if (bBorder) {
        next.push({
          x: a.x * 0.75 + b.x * 0.25,
          y: a.y * 0.75 + b.y * 0.25,
        });
        continue;
      }
      next.push({
        x: a.x * 0.75 + b.x * 0.25,
        y: a.y * 0.75 + b.y * 0.25,
      });
      next.push({
        x: a.x * 0.25 + b.x * 0.75,
        y: a.y * 0.25 + b.y * 0.75,
      });
    }
    pts = next;
  }
  // 数值漂移时把边框点吸回边线
  for (const p of pts) {
    if (p.x < 0.5) p.x = 0;
    if (p.y < 0.5) p.y = 0;
    if (p.x > cols - 0.5) p.x = cols;
    if (p.y > rows - 0.5) p.y = rows;
  }
  return pts;
}

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
  // 预览多为缩小，开平滑；放大仍用邻近以免糊
  ctx.imageSmoothingEnabled = w <= bmp.width && h <= bmp.height;
  if (ctx.imageSmoothingEnabled) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bmp, 0, 0, w, h);
}
