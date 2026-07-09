import type { FeatureGrade, MapFeature, Point } from '../types';
import { featureGrade } from '../types';
import { dist } from './geometry';

const EPS = 1e-6;
/** 交点距已有顶点过近则合并到该顶点 */
const ENDPOINT_MERGE_M = 6;
const JUNCTION_SNAP_M = 10;

type SegHit = {
  featureId: string;
  segIndex: number;
  t: number;
  point: Point;
};

function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

function quantizeKey(p: Point, step = JUNCTION_SNAP_M): string {
  return `${Math.round(p.x / step) * step},${Math.round(p.y / step) * step}`;
}

/** 两开线段真交（不含端点）；返回参数 t∈(0,1)、u∈(0,1) 与交点 */
export function segmentIntersection(
  a1: Point,
  a2: Point,
  b1: Point,
  b2: Point,
): { t: number; u: number; point: Point } | null {
  const dxa = a2.x - a1.x;
  const dya = a2.y - a1.y;
  const dxb = b2.x - b1.x;
  const dyb = b2.y - b1.y;
  const den = cross(dxa, dya, dxb, dyb);
  if (Math.abs(den) < EPS) return null;

  const dx = b1.x - a1.x;
  const dy = b1.y - a1.y;
  const t = cross(dx, dy, dxb, dyb) / den;
  const u = cross(dx, dy, dxa, dya) / den;
  if (t <= EPS || t >= 1 - EPS || u <= EPS || u >= 1 - EPS) return null;

  return {
    t,
    u,
    point: { x: a1.x + t * dxa, y: a1.y + t * dya },
  };
}

function nearestExisting(points: Point[], p: Point, maxDist: number): Point | null {
  let best: Point | null = null;
  let bestD = maxDist;
  for (const q of points) {
    const d = dist(p, q);
    if (d < bestD) {
      bestD = d;
      best = q;
    }
  }
  return best;
}

function insertSorted(points: Point[], segIndex: number, point: Point): Point[] {
  const next = [...points];
  const a = next[segIndex];
  const b = next[segIndex + 1];
  if (!a || !b) return points;

  const merged = nearestExisting([a, b], point, ENDPOINT_MERGE_M);
  if (merged) return points;

  // 若整条折线上已有极近点，也跳过（避免重复节点）
  if (nearestExisting(next, point, ENDPOINT_MERGE_M)) return points;

  next.splice(segIndex + 1, 0, { ...point });
  return next;
}

function collectHitsAgainst(
  draft: Point[],
  others: MapFeature[],
): { draftHits: { segIndex: number; t: number; point: Point }[]; otherHits: SegHit[] } {
  const draftHits: { segIndex: number; t: number; point: Point }[] = [];
  const otherHits: SegHit[] = [];

  for (let i = 0; i < draft.length - 1; i++) {
    const a1 = draft[i];
    const a2 = draft[i + 1];
    for (const other of others) {
      for (let j = 0; j < other.points.length - 1; j++) {
        const hit = segmentIntersection(a1, a2, other.points[j], other.points[j + 1]);
        if (!hit) continue;
        draftHits.push({ segIndex: i, t: hit.t, point: hit.point });
        otherHits.push({
          featureId: other.id,
          segIndex: j,
          t: hit.u,
          point: hit.point,
        });
      }
    }
  }

  return { draftHits, otherHits };
}

function applyHitsToPolyline(
  points: Point[],
  hits: { segIndex: number; t: number; point: Point }[],
): Point[] {
  if (hits.length === 0) return points;
  const sorted = [...hits].sort((a, b) =>
    a.segIndex === b.segIndex ? b.t - a.t : b.segIndex - a.segIndex,
  );
  let next = points;
  for (const h of sorted) {
    next = insertSorted(next, h.segIndex, h.point);
  }
  return next;
}

function isPathKind(f: MapFeature): boolean {
  return f.kind === 'road' || f.kind === 'railway';
}

/**
 * 同层道路/铁路交叉时，在双方折线上插入共享交点（形成路口节点）。
 * 不同层不处理（上跨/下穿）。
 */
export function weaveSameGradeCrossings(
  features: MapFeature[],
  incoming: MapFeature,
): MapFeature[] {
  if (!isPathKind(incoming) || incoming.points.length < 2) {
    return [...features, incoming];
  }

  const grade = featureGrade(incoming);
  const peers = features.filter(
    (f) => isPathKind(f) && featureGrade(f) === grade && f.points.length >= 2,
  );

  const { draftHits, otherHits } = collectHitsAgainst(incoming.points, peers);

  // 交点坐标统一：优先吸附到已有顶点，保证双方共享同一坐标
  const unify = (p: Point, bases: Point[]): Point => nearestExisting(bases, p, ENDPOINT_MERGE_M) ?? p;

  const peerPoints = peers.flatMap((f) => f.points);
  const unifiedDraftHits = draftHits.map((h) => ({
    ...h,
    point: unify(h.point, [...incoming.points, ...peerPoints]),
  }));
  const unifiedOtherHits = otherHits.map((h) => ({
    ...h,
    point: unify(h.point, [...incoming.points, ...peerPoints]),
  }));

  const wovenIncoming: MapFeature = {
    ...incoming,
    points: applyHitsToPolyline(incoming.points, unifiedDraftHits),
  };

  const byFeature = new Map<string, { segIndex: number; t: number; point: Point }[]>();
  for (const h of unifiedOtherHits) {
    const list = byFeature.get(h.featureId) ?? [];
    list.push({ segIndex: h.segIndex, t: h.t, point: h.point });
    byFeature.set(h.featureId, list);
  }

  const nextFeatures = features.map((f) => {
    const hits = byFeature.get(f.id);
    if (!hits) return f;
    return { ...f, points: applyHitsToPolyline(f.points, hits) };
  });

  return [...nextFeatures, wovenIncoming];
}

/**
 * 对整张路网重算同层交叉节点（幂等：已有端点交不会重复插入）。
 * 用于加载旧图、拖拽顶点后修复。
 */
export function reweaveAllCrossings(features: MapFeature[]): MapFeature[] {
  const base = features.filter((f) => !isPathKind(f));
  const paths = features.filter(isPathKind);
  let acc = [...base];
  for (const path of paths) {
    // 用「尚未插入本条」的几何重织，避免带着旧交点顺序偏差
    acc = weaveSameGradeCrossings(acc, path);
  }
  return acc;
}

export type JunctionNode = {
  point: Point;
  grade: FeatureGrade;
  /** 汇入该点的路径条数 */
  degree: number;
};

/** 同层至少两条路径共享的顶点 → 路口节点 */
export function collectJunctionNodes(features: MapFeature[]): JunctionNode[] {
  type Bucket = { point: Point; grade: FeatureGrade; ids: Set<string> };
  const buckets = new Map<string, Bucket>();

  for (const f of features) {
    if (!isPathKind(f) || f.points.length < 2) continue;
    const grade = featureGrade(f);
    for (const p of f.points) {
      const key = `${grade}|${quantizeKey(p)}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.ids.add(f.id);
      } else {
        buckets.set(key, { point: { ...p }, grade, ids: new Set([f.id]) });
      }
    }
  }

  const nodes: JunctionNode[] = [];
  for (const b of buckets.values()) {
    if (b.ids.size >= 2) {
      nodes.push({ point: b.point, grade: b.grade, degree: b.ids.size });
    }
  }
  return nodes;
}
