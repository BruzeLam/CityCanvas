import type { FeatureGrade, MapFeature, Point } from '../types';
import { featureGrade, featureGradeEnd, isRampFeature } from '../types';
import { dist } from './geometry';

const EPS = 1e-6;
/** 交点距已有顶点过近则合并到该顶点 */
export const ENDPOINT_MERGE_M = 6;
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

export type PathTipHit = {
  feature: MapFeature;
  end: 'start' | 'end';
  point: Point;
};

/** 查找落在某条道路/铁路首尾端点上的命中 */
export function findPathTipAt(
  features: MapFeature[],
  point: Point,
  maxDist = ENDPOINT_MERGE_M,
  filter?: (f: MapFeature) => boolean,
): PathTipHit | null {
  let best: PathTipHit | null = null;
  let bestD = maxDist;
  for (const f of features) {
    if (!isPathKind(f) || f.points.length < 2) continue;
    if (filter && !filter(f)) continue;
    const start = f.points[0];
    const end = f.points[f.points.length - 1];
    const ds = dist(point, start);
    if (ds < bestD) {
      bestD = ds;
      best = { feature: f, end: 'start', point: start };
    }
    const de = dist(point, end);
    if (de < bestD) {
      bestD = de;
      best = { feature: f, end: 'end', point: end };
    }
  }
  return best;
}

/**
 * 同层首尾相接：把 draft 并入已有路径（消除端点圆帽）。
 * 仅同 kind / 同等级 / 同标高且非匝道时合并。
 */
export function tryMergeHeadToTail(
  features: MapFeature[],
  draft: MapFeature,
): MapFeature[] | null {
  if (!isPathKind(draft) || draft.points.length < 2) return null;
  if (isRampFeature(draft)) return null;

  const grade = featureGrade(draft);
  const tip = findPathTipAt(features, draft.points[0], ENDPOINT_MERGE_M, (f) => {
    if (f.kind !== draft.kind) return false;
    if (isRampFeature(f)) return false;
    if (featureGrade(f) !== grade) return false;
    if (draft.kind === 'road' && (f.roadLevel ?? 'local') !== (draft.roadLevel ?? 'local')) {
      return false;
    }
    return true;
  });
  if (!tip) return null;

  const extension = draft.points.slice(1);
  if (extension.length === 0) return null;

  const mergedPoints =
    tip.end === 'end'
      ? [...tip.feature.points, ...extension]
      : [...extension.reverse(), ...tip.feature.points];

  const merged: MapFeature = {
    ...tip.feature,
    points: mergedPoints,
  };

  const without = features.filter((f) => f.id !== tip.feature.id);
  return weaveSameGradeCrossings(without, merged);
}

/**
 * 同层道路/铁路交叉时，在双方折线上插入共享交点（形成路口节点）。
 * 不同层不处理（上跨/下穿）。跨层匝道整段跳过织网，避免在下层/上层误插路口。
 */
export function weaveSameGradeCrossings(
  features: MapFeature[],
  incoming: MapFeature,
): MapFeature[] {
  if (!isPathKind(incoming) || incoming.points.length < 2) {
    return [...features, incoming];
  }

  if (isRampFeature(incoming)) {
    return [...features, incoming];
  }

  const grade = featureGrade(incoming);
  const peers = features.filter(
    (f) =>
      isPathKind(f) &&
      !isRampFeature(f) &&
      featureGrade(f) === grade &&
      f.points.length >= 2,
  );

  const { draftHits, otherHits } = collectHitsAgainst(incoming.points, peers);

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

  const addTip = (f: MapFeature, p: Point, grade: FeatureGrade) => {
    const key = `${grade}|${quantizeKey(p)}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.ids.add(f.id);
    } else {
      buckets.set(key, { point: { ...p }, grade, ids: new Set([f.id]) });
    }
  };

  for (const f of features) {
    if (!isPathKind(f) || f.points.length < 2) continue;
    if (isRampFeature(f)) {
      addTip(f, f.points[0], featureGrade(f));
      addTip(f, f.points[f.points.length - 1], featureGradeEnd(f));
      continue;
    }
    const grade = featureGrade(f);
    for (const p of f.points) {
      addTip(f, p, grade);
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

/**
 * 首尾相接或路口共享的端点：渲染时用 butt cap，避免圆帽鼓包。
 * key = `${featureId}|start` / `${featureId}|end`
 */
export function collectJoinedCaps(features: MapFeature[]): Set<string> {
  type Tip = { featureId: string; end: 'start' | 'end'; point: Point };
  const tips: Tip[] = [];
  for (const f of features) {
    if (!isPathKind(f) || f.points.length < 2) continue;
    tips.push({ featureId: f.id, end: 'start', point: f.points[0] });
    tips.push({
      featureId: f.id,
      end: 'end',
      point: f.points[f.points.length - 1],
    });
  }

  const joined = new Set<string>();
  for (let i = 0; i < tips.length; i++) {
    for (let j = i + 1; j < tips.length; j++) {
      if (tips[i].featureId === tips[j].featureId) continue;
      if (dist(tips[i].point, tips[j].point) > ENDPOINT_MERGE_M) continue;
      joined.add(`${tips[i].featureId}|${tips[i].end}`);
      joined.add(`${tips[j].featureId}|${tips[j].end}`);
    }
  }
  return joined;
}
