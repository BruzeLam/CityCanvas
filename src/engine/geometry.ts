import type { Point } from '../types';

const SNAP_BASE = 12;
/** 垂直吸附比端点吸附稍宽，便于对准路口 */
const PERP_SNAP_FACTOR = 2.2;
const CENTERLINE_SNAP_FACTOR = 1.8;
const PARALLEL_SNAP_FACTOR = 2.0;

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

export type SnapKind = 'endpoint' | 'centerline' | 'perpendicular' | 'parallel' | 'none';

export type GuideSnap = {
  point: Point;
  kind: SnapKind;
  /** 参照路段（中心线 / 垂直 / 平行） */
  ref?: Segment;
};

/** 点到线段最近点与参数 t∈[0,1] */
export function closestOnSegment(
  point: Point,
  seg: Segment,
): { point: Point; t: number; dist: number } {
  const dx = seg.b.x - seg.a.x;
  const dy = seg.b.y - seg.a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-8) {
    return { point: { ...seg.a }, t: 0, dist: dist(point, seg.a) };
  }
  let t = ((point.x - seg.a.x) * dx + (point.y - seg.a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const p = { x: seg.a.x + t * dx, y: seg.a.y + t * dy };
  return { point: p, t, dist: dist(point, p) };
}

/**
 * 道路中心线吸附：光标投影到最近路段（含中段，便于开岔）。
 * 首点 from 为空时同样可用。
 */
export function findCenterlineSnap(
  cursor: Point,
  segments: Segment[],
  zoom: number,
): GuideSnap | null {
  const threshold = snapThreshold(zoom) * CENTERLINE_SNAP_FACTOR;
  let best: GuideSnap | null = null;
  let bestDist = threshold;

  for (const seg of segments) {
    const hit = closestOnSegment(cursor, seg);
    if (hit.dist < bestDist) {
      bestDist = hit.dist;
      best = { point: hit.point, kind: 'centerline', ref: seg };
    }
  }
  return best;
}

/**
 * 从 from 向现有路段作垂足：优先垂直交汇（T 型 / 十字路口）。
 * 光标靠近垂足或垂线方向时吸附。
 */
export function findPerpendicularSnap(
  from: Point,
  cursor: Point,
  segments: Segment[],
  zoom: number,
): GuideSnap | null {
  const threshold = snapThreshold(zoom) * PERP_SNAP_FACTOR;
  let best: GuideSnap | null = null;
  let bestScore = threshold;

  for (const seg of segments) {
    const { a, b } = seg;
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
      best = { point: foot, kind: 'perpendicular', ref: seg };
    }
  }

  return best;
}

/**
 * 平行参照：过 from 作与邻近路段平行的直线，将光标投影上去。
 */
export function findParallelSnap(
  from: Point,
  cursor: Point,
  segments: Segment[],
  zoom: number,
): GuideSnap | null {
  const threshold = snapThreshold(zoom) * PARALLEL_SNAP_FACTOR;
  const moveDx = cursor.x - from.x;
  const moveDy = cursor.y - from.y;
  const moveLen = Math.hypot(moveDx, moveDy);
  if (moveLen < 8) return null;

  let best: GuideSnap | null = null;
  let bestScore = threshold;

  for (const seg of segments) {
    const sdx = seg.b.x - seg.a.x;
    const sdy = seg.b.y - seg.a.y;
    const slen = Math.hypot(sdx, sdy);
    if (slen < 8) continue;

    const ux = sdx / slen;
    const uy = sdy / slen;

    // 光标航向与路段平行程度
    const align = Math.abs(moveDx * ux + moveDy * uy) / moveLen;
    if (align < 0.92) continue;

    const t = moveDx * ux + moveDy * uy;
    const proj = { x: from.x + t * ux, y: from.y + t * uy };
    const d = dist(cursor, proj);
    // 略偏好更近的参照路
    const refDist = closestOnSegment(from, seg).dist;
    const score = d + Math.min(refDist, 400) * 0.002;
    if (score < bestScore) {
      bestScore = score;
      best = { point: proj, kind: 'parallel', ref: seg };
    }
  }

  return best;
}

/**
 * 路径绘制统一吸附：端点 > 垂直 > 平行 > 中心线。
 * from 为空时（首点）仅端点 + 中心线。
 */
export function findPathGuideSnap(
  cursor: Point,
  endpoints: Point[],
  segments: Segment[],
  zoom: number,
  from?: Point | null,
): GuideSnap {
  const endpoint = findSnapPoint(cursor, endpoints, zoom);
  if (endpoint) {
    return { point: endpoint, kind: 'endpoint' };
  }

  if (from) {
    const perp = findPerpendicularSnap(from, cursor, segments, zoom);
    if (perp) return perp;

    const parallel = findParallelSnap(from, cursor, segments, zoom);
    if (parallel) return parallel;
  }

  const center = findCenterlineSnap(cursor, segments, zoom);
  if (center) return center;

  return { point: cursor, kind: 'none' };
}

/**
 * 估算端点处「向外延伸」的切线方向（从路段指向端点外侧）。
 * 用于从已有道路端点继续画弯道时锁定锚点航向。
 */
export function headingAtPoint(
  point: Point,
  segments: Segment[],
  zoom: number,
): number | null {
  const threshold = snapThreshold(zoom) * 1.2;
  let bestDir: number | null = null;
  let bestDist = threshold;

  for (const seg of segments) {
    const da = dist(point, seg.a);
    const db = dist(point, seg.b);
    // 在 a 端：沿 b→a 向外；在 b 端：沿 a→b 向外
    if (da < bestDist) {
      bestDist = da;
      bestDir = Math.atan2(seg.a.y - seg.b.y, seg.a.x - seg.b.x);
    }
    if (db < bestDist) {
      bestDist = db;
      bestDir = Math.atan2(seg.b.y - seg.a.y, seg.b.x - seg.a.x);
    }
  }
  return bestDir;
}

/**
 * 中心线开岔：取最近路段方向（a→b）作为切线锚点。
 * 光标落在哪一侧决定劣弧鼓向。
 */
export function headingAlongSegment(
  point: Point,
  segments: Segment[],
  zoom: number,
): number | null {
  const threshold = snapThreshold(zoom) * CENTERLINE_SNAP_FACTOR;
  let best: Segment | null = null;
  let bestDist = threshold;
  for (const seg of segments) {
    const hit = closestOnSegment(point, seg);
    if (hit.dist < bestDist) {
      bestDist = hit.dist;
      best = seg;
    }
  }
  if (!best) return null;
  const dx = best.b.x - best.a.x;
  const dy = best.b.y - best.a.y;
  if (Math.hypot(dx, dy) < 1e-6) return null;
  return Math.atan2(dy, dx);
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
