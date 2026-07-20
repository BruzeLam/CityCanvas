import type { Point } from '../types';
import {
  TERRAIN_GREEN,
  TERRAIN_WATER,
  type TerrainCell,
  type TerrainGrid,
} from './terrain';

export type TerrainRings = {
  cells: Uint8Array;
  cols: number;
  rows: number;
  cellSizeM: number;
  water: Point[][];
  green: Point[][];
};

/** 从栅格提取水域/绿地外轮廓，Chaikin 平滑后供矢量填充（避免放大模糊） */
export function buildTerrainRings(grid: TerrainGrid): TerrainRings {
  return {
    cells: grid.cells,
    cols: grid.cols,
    rows: grid.rows,
    cellSizeM: grid.cellSizeM,
    water: extractSmoothRings(grid, TERRAIN_WATER),
    green: extractSmoothRings(grid, TERRAIN_GREEN),
  };
}

function extractSmoothRings(grid: TerrainGrid, target: TerrainCell): Point[][] {
  const loops = extractCornerLoops(grid, target);
  const { cellSizeM } = grid;
  const out: Point[][] = [];
  for (const loop of loops) {
    if (loop.length < 4) continue;
    const world = loop.map(([cx, cy]) => ({
      x: cx * cellSizeM,
      y: cy * cellSizeM,
    }));
    const simplified = simplifyCollinear(world, 0.35 * cellSizeM);
    if (simplified.length < 4) continue;
    // 细河道少平滑，避免塌缩；大面多平滑去锯齿
    const iters = simplified.length < 24 ? 1 : 2;
    out.push(chaikinClosed(simplified, iters));
  }
  return out;
}

/** 在格点角点上沿水域/绿地边界走封闭环 */
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

  /** undirected edge key → endpoints as corner ids */
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
        // 度>2 时优先未用边；若只剩回边则结束
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
    // 近乎共线且同向 → 丢掉中间点
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

export function fillTerrainRings(
  ctx: CanvasRenderingContext2D,
  rings: Point[][],
  toScreenPt: (p: Point) => Point,
  fill: string,
  stroke?: string,
): void {
  if (rings.length === 0) return;
  ctx.beginPath();
  for (const ring of rings) {
    if (ring.length < 3) continue;
    const s0 = toScreenPt(ring[0]!);
    ctx.moveTo(s0.x, s0.y);
    for (let i = 1; i < ring.length; i++) {
      const s = toScreenPt(ring[i]!);
      ctx.lineTo(s.x, s.y);
    }
    ctx.closePath();
  }
  ctx.fillStyle = fill;
  ctx.fill('evenodd');
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = 1;
    ctx.lineJoin = 'round';
    ctx.stroke();
  }
}
