import type { FeatureGrade, MapFeature, Point } from '../types';
import {
  clampGrade,
  featureGrade,
  featureGradeEnd,
  isLevelBlendRoad,
  isRampFeature,
} from '../types';
import { closestOnSegment, dist } from './geometry';

const EPS = 1e-6;
/** 交点距已有顶点过近则合并到该顶点 */
export const ENDPOINT_MERGE_M = 6;
const JUNCTION_SNAP_M = 10;
/** 匝道端点挂接到目标路（含中段）的搜索半径 */
export const RAMP_ATTACH_M = 22;

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

/** 路径上某点的标高（跨层匝道按弧长比例插值） */
export function gradeAlongPath(f: MapFeature, point: Point): FeatureGrade {
  const g0 = featureGrade(f);
  const g1 = featureGradeEnd(f);
  if (g0 === g1 || f.points.length < 2) return g0;

  let total = 0;
  const lens: number[] = [];
  for (let i = 0; i < f.points.length - 1; i++) {
    const d = dist(f.points[i], f.points[i + 1]);
    lens.push(d);
    total += d;
  }
  if (total < EPS) return g0;

  let bestDist = Infinity;
  let bestT = 0;
  let acc = 0;
  for (let i = 0; i < f.points.length - 1; i++) {
    const hit = closestOnSegment(point, { a: f.points[i], b: f.points[i + 1] });
    if (hit.dist < bestDist) {
      bestDist = hit.dist;
      bestT = (acc + lens[i] * hit.t) / total;
    }
    acc += lens[i];
  }
  return clampGrade(g0 + (g1 - g0) * bestT);
}

/** 顶点索引处的标高（跨层匝道按索引比例） */
export function gradeAtVertex(f: MapFeature, index: number): FeatureGrade {
  const g0 = featureGrade(f);
  const g1 = featureGradeEnd(f);
  if (g0 === g1 || f.points.length < 2) return g0;
  const t = Math.max(0, Math.min(1, index / (f.points.length - 1)));
  return clampGrade(g0 + (g1 - g0) * t);
}

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
  if (isRampFeature(draft) || isLevelBlendRoad(draft) || draft.roadLevel === 'ramp') return null;

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
 * 在任意标高路径上找最近挂接点（用于推断匝道终点层）。
 */
export function findNearestAnyGradeAttachment(
  features: MapFeature[],
  point: Point,
  maxDist = RAMP_ATTACH_M,
  excludeId?: string,
): { feature: MapFeature; point: Point; grade: FeatureGrade; segIndex: number; t: number } | null {
  let best: {
    feature: MapFeature;
    point: Point;
    grade: FeatureGrade;
    segIndex: number;
    t: number;
    dist: number;
  } | null = null;

  for (const f of features) {
    if (!isPathKind(f) || f.points.length < 2) continue;
    if (excludeId && f.id === excludeId) continue;
    for (let i = 0; i < f.points.length - 1; i++) {
      const hit = closestOnSegment(point, { a: f.points[i], b: f.points[i + 1] });
      if (hit.dist > maxDist) continue;
      if (!best || hit.dist < best.dist) {
        best = {
          feature: f,
          point: hit.point,
          grade: gradeAlongPath(f, hit.point),
          segIndex: i,
          t: hit.t,
          dist: hit.dist,
        };
      }
    }
  }
  return best
    ? {
        feature: best.feature,
        point: best.point,
        grade: best.grade,
        segIndex: best.segIndex,
        t: best.t,
      }
    : null;
}

/**
 * 在指定标高的路径上找最近点（端点优先，其次中心线），用于匝道挂接。
 */
export function findGradeAttachment(
  features: MapFeature[],
  point: Point,
  grade: FeatureGrade,
  maxDist = RAMP_ATTACH_M,
  excludeId?: string,
): { feature: MapFeature; point: Point; segIndex: number; t: number } | null {
  let best: {
    feature: MapFeature;
    point: Point;
    segIndex: number;
    t: number;
    score: number;
  } | null = null;

  for (const f of features) {
    if (!isPathKind(f) || f.points.length < 2) continue;
    if (excludeId && f.id === excludeId) continue;
    // 普通路：整条同层；匝道：两端各算一层
    const gradesOnPath = isRampFeature(f)
      ? [featureGrade(f), featureGradeEnd(f)]
      : [featureGrade(f)];
    if (!gradesOnPath.includes(grade)) continue;

    for (let i = 0; i < f.points.length - 1; i++) {
      const hit = closestOnSegment(point, { a: f.points[i], b: f.points[i + 1] });
      if (hit.dist > maxDist) continue;
      // 端点略优先，便于首尾相接
      const endBonus =
        hit.t < 0.02 || hit.t > 0.98 ? -2 : hit.t > 0.08 && hit.t < 0.92 ? 0 : -0.5;
      const score = hit.dist + endBonus;
      if (!best || score < best.score) {
        best = {
          feature: f,
          point: hit.point,
          segIndex: i,
          t: hit.t,
          score,
        };
      }
    }
  }

  if (!best) return null;
  return {
    feature: best.feature,
    point: best.point,
    segIndex: best.segIndex,
    t: best.t,
  };
}

function insertAttachmentOnPeer(
  peer: MapFeature,
  segIndex: number,
  t: number,
  point: Point,
): MapFeature {
  // 靠近该线段端点：只合并对应顶点（绝不能当成整条路的首/尾，否则会把远端点拽过来）
  if (t < 0.02 || t > 0.98) {
    const vi = t < 0.5 ? segIndex : segIndex + 1;
    if (vi < 0 || vi >= peer.points.length) return peer;
    return {
      ...peer,
      points: peer.points.map((p, i) => (i === vi ? { ...point } : p)),
    };
  }
  return {
    ...peer,
    points: applyHitsToPolyline(peer.points, [{ segIndex, t, point }]),
  };
}

/**
 * 跨层匝道 / 异层挂接：把起终点吸到对应标高的路上，并在目标路上插入共享节点。
 * 中段仍不与异层织交叉（立交下穿保持分离）。
 */
export function attachCrossGradeTips(
  features: MapFeature[],
  incoming: MapFeature,
): MapFeature[] {
  if (!isPathKind(incoming) || incoming.points.length < 2) {
    return [...features, incoming];
  }

  const startG = featureGrade(incoming);
  const endG = featureGradeEnd(incoming);
  let points = [...incoming.points];
  let nextFeatures = [...features];

  const attachEnd = (
    tipIndex: 0 | -1,
    grade: FeatureGrade,
  ) => {
    const tip = tipIndex === 0 ? points[0] : points[points.length - 1];
    const hit = findGradeAttachment(nextFeatures, tip, grade, RAMP_ATTACH_M, incoming.id);
    if (!hit) return;

    if (tipIndex === 0) {
      points = [{ ...hit.point }, ...points.slice(1)];
    } else {
      points = [...points.slice(0, -1), { ...hit.point }];
    }

    nextFeatures = nextFeatures.map((f) =>
      f.id === hit.feature.id
        ? insertAttachmentOnPeer(f, hit.segIndex, hit.t, hit.point)
        : f,
    );
  };

  attachEnd(0, startG);
  attachEnd(-1, endG);

  const attached: MapFeature = { ...incoming, points };

  // 跨层 / 异级 / 匝道：只挂端点，不与主路织交叉
  if (
    isRampFeature(attached) ||
    startG !== endG ||
    isLevelBlendRoad(attached) ||
    attached.roadLevel === 'ramp'
  ) {
    return [...nextFeatures, attached];
  }

  return weaveSameGradeCrossings(nextFeatures, attached);
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

  if (isRampFeature(incoming) || isLevelBlendRoad(incoming) || incoming.roadLevel === 'ramp') {
    return attachCrossGradeTips(features, incoming);
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
 * 首尾相接、路口共享、或端点落在他路顶点上：用 butt cap，避免圆帽鼓包。
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

  // 匝道挂接到他路中段：端点与他路任一顶点重合也算接合
  for (const tip of tips) {
    if (joined.has(`${tip.featureId}|${tip.end}`)) continue;
    for (const f of features) {
      if (!isPathKind(f) || f.id === tip.featureId) continue;
      for (const p of f.points) {
        if (dist(tip.point, p) <= ENDPOINT_MERGE_M) {
          joined.add(`${tip.featureId}|${tip.end}`);
          break;
        }
      }
      if (joined.has(`${tip.featureId}|${tip.end}`)) break;
    }
  }

  return joined;
}
