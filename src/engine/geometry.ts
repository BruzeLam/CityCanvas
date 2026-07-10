import type { Point } from '../types';

const SNAP_BASE = 12;
/** 垂直吸附比端点吸附稍宽，便于对准路口 */
const PERP_SNAP_FACTOR = 2.2;

export function dist(a: Point, b: Point): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.hypot(dx, dy);
}

export function snapThreshold(zoom: number): number {
  return SNAP_BASE / zoom;
}

export function findSnapPoint(
  point: Point,
  candidates: Point[],
  zoom: number,
): Point | null {
  const threshold = snapThreshold(zoom);
  let best: Point | null = null;
  let bestDist = threshold;

  for (const candidate of candidates) {
    const d = dist(point, candidate);
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }

  return best;
}

export type Segment = { a: Point; b: Point };

/**
 * 从 from 向现有路段作垂足：优先垂直交汇（T 型 / 十字路口）。
 * 光标靠近垂足或垂线方向时吸附。
 */
export function findPerpendicularSnap(
  from: Point,
  cursor: Point,
  segments: Segment[],
  zoom: number,
): Point | null {
  const threshold = snapThreshold(zoom) * PERP_SNAP_FACTOR;
  let best: Point | null = null;
  let bestScore = threshold;

  for (const { a, b } of segments) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq < 4) continue;

    let t = ((from.x - a.x) * dx + (from.y - a.y) * dy) / lenSq;
    t = Math.max(-0.08, Math.min(1.08, t));
    const foot = { x: a.x + t * dx, y: a.y + t * dy };

    const nx = foot.x - from.x;
    const ny = foot.y - from.y;
    const nLen = Math.hypot(nx, ny);
    if (nLen < 12) continue;

    const dot = Math.abs(nx * dx + ny * dy) / (nLen * Math.sqrt(lenSq));
    if (dot > 0.08) continue;

    const dFoot = dist(cursor, foot);
    const along = ((cursor.x - from.x) * nx + (cursor.y - from.y) * ny) / (nLen * nLen);
    const onRay = along > 0.15 && along < 2.5;
    const proj = { x: from.x + along * nx, y: from.y + along * ny };
    const dRay = onRay ? dist(cursor, proj) + dist(proj, foot) * 0.25 : Infinity;

    const score = Math.min(dFoot, dRay);
    if (score < bestScore) {
      bestScore = score;
      best = foot;
    }
  }

  return best;
}

export function screenToWorld(
  screen: Point,
  viewport: { x: number; y: number; zoom: number },
): Point {
  return {
    x: (screen.x - viewport.x) / viewport.zoom,
    y: (screen.y - viewport.y) / viewport.zoom,
  };
}

export function worldToScreen(
  world: Point,
  viewport: { x: number; y: number; zoom: number },
): Point {
  return {
    x: world.x * viewport.zoom + viewport.x,
    y: world.y * viewport.zoom + viewport.y,
  };
}

export function collectEndpoints(points: Point[]): Point[] {
  return points;
}
