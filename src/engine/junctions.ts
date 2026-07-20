import type { FeatureGrade, MapFeature, Point, RoadLevel } from '../types';
import {
  clampGrade,
  featureGrade,
  featureGradeEnd,
  isLevelBlendRoad,
  isRampFeature,
  normalizeRoadClass,
} from '../types';
import { simplifyPolylineRdp, curveFromBestTangent } from './curveMath';
import { closestOnSegment, dist } from './geometry';

const EPS = 1e-6;
/** 交点距已有顶点过近则合并到该顶点 */
export const ENDPOINT_MERGE_M = 6;
const JUNCTION_SNAP_M = 10;
/** 匝道端点挂接到目标路（含中段）的搜索半径 */
export const RAMP_ATTACH_M = 36;
/** 超过此顶点数的折线在重织时做 RDP 简化（保留路口）；匝道更保守 */
const DENSE_PATH_SIMPLIFY_AT = 48;
const DENSE_PATH_SIMPLIFY_EPS_M = 0.35;
const DENSE_RAMP_SIMPLIFY_AT = 72;
const DENSE_RAMP_SIMPLIFY_EPS_M = 0.12;

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

/** 三点近似共线且同向（延伸合并后可删中间点） */
function isCollinearContinuation(a: Point, b: Point, c: Point): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const bcx = c.x - b.x;
  const bcy = c.y - b.y;
  const lab = Math.hypot(abx, aby);
  const lbc = Math.hypot(bcx, bcy);
  if (lab < EPS || lbc < EPS) return true;
  const crossAbs = Math.abs(abx * bcy - aby * bcx) / (lab * lbc);
  const dot = (abx * bcx + aby * bcy) / (lab * lbc);
  return crossAbs < 0.045 && dot > 0.95;
}

function otherFeatureTouchesPoint(
  features: MapFeature[],
  selfId: string,
  point: Point,
  grade: FeatureGrade,
  maxDist = ENDPOINT_MERGE_M,
): boolean {
  for (const f of features) {
    if (f.id === selfId || !isPathKind(f) || f.points.length < 2) continue;
    if (isRampFeature(f)) {
      if (featureGrade(f) === grade && dist(point, f.points[0]) <= maxDist) return true;
      if (featureGradeEnd(f) === grade && dist(point, f.points[f.points.length - 1]) <= maxDist) {
        return true;
      }
      continue;
    }
    if (featureGrade(f) !== grade) continue;
    for (const p of f.points) {
      if (dist(point, p) <= maxDist) return true;
    }
  }
  return false;
}

/**
 * 去掉「非交叉口」的共线中间点：延伸合并后原端点可消失，只留弯折与真正路口。
 */
export function simplifyPathKeepingJunctions(
  points: Point[],
  selfId: string,
  features: MapFeature[],
  grade: FeatureGrade,
): Point[] {
  if (points.length <= 2) return points.map((p) => ({ ...p }));
  const out: Point[] = [{ ...points[0] }];
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i];
    if (otherFeatureTouchesPoint(features, selfId, p, grade)) {
      out.push({ ...p });
      continue;
    }
    const prev = out[out.length - 1];
    const next = points[i + 1];
    if (!isCollinearContinuation(prev, p, next)) {
      out.push({ ...p });
    }
  }
  out.push({ ...points[points.length - 1] });
  return out;
}

function canMergeInto(
  host: MapFeature,
  draft: MapFeature,
  grade: FeatureGrade,
): boolean {
  if (host.kind !== draft.kind) return false;
  if (isRampFeature(host) || isLevelBlendRoad(host) || host.roadLevel === 'ramp') return false;
  if (featureGrade(host) !== grade) return false;
  if (draft.kind === 'road' && (host.roadLevel ?? 'local') !== (draft.roadLevel ?? 'local')) {
    return false;
  }
  return true;
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
 * 从某点推断所接「非匝道」道路等级；只接匝道或空白则返回 null。
 */
export function roadClassAtPoint(
  features: MapFeature[],
  point: Point,
  excludeId?: string,
  maxDist = RAMP_ATTACH_M,
): Exclude<RoadLevel, 'ramp'> | null {
  const classOf = (f: MapFeature): Exclude<RoadLevel, 'ramp'> | null => {
    if (f.kind !== 'road') return null;
    if (f.roadLevel === 'ramp') return null;
    return normalizeRoadClass(f.roadLevel);
  };

  const tip = findPathTipAt(
    features,
    point,
    ENDPOINT_MERGE_M,
    (f) => f.id !== excludeId && classOf(f) != null,
  );
  if (tip) {
    const c = classOf(tip.feature);
    if (c) return c;
  }

  let best: { dist: number; cls: Exclude<RoadLevel, 'ramp'> } | null = null;
  for (const f of features) {
    if (excludeId && f.id === excludeId) continue;
    const cls = classOf(f);
    if (!cls || f.points.length < 2) continue;
    for (let i = 0; i < f.points.length - 1; i++) {
      const hit = closestOnSegment(point, { a: f.points[i], b: f.points[i + 1] });
      if (hit.dist > maxDist) continue;
      if (!best || hit.dist < best.dist) best = { dist: hit.dist, cls };
    }
  }
  return best?.cls ?? null;
}

/**
 * 按匝道当前首尾端点重算 roadLevelFrom / End：
 * - 两端都接到非匝道路 → 写入对应等级（可渐变）
 * - 只接一端 → 两端都写成该等级（纯色）
 * - 都未接 → 清空（灰色默认匝道色）
 */
export function refreshRampRoadClasses(
  features: MapFeature[],
  rampId: string,
): MapFeature[] {
  const ramp = features.find((f) => f.id === rampId);
  if (!ramp || ramp.kind !== 'road' || ramp.roadLevel !== 'ramp' || ramp.points.length < 2) {
    return features;
  }
  const startCls = roadClassAtPoint(features, ramp.points[0], rampId);
  const endCls = roadClassAtPoint(
    features,
    ramp.points[ramp.points.length - 1],
    rampId,
  );

  let roadLevelFrom: typeof startCls | undefined;
  let roadLevelEnd: typeof endCls | undefined;
  if (startCls && endCls) {
    roadLevelFrom = startCls;
    roadLevelEnd = endCls;
  } else if (startCls || endCls) {
    const only = (startCls ?? endCls)!;
    roadLevelFrom = only;
    roadLevelEnd = only;
  } else {
    roadLevelFrom = undefined;
    roadLevelEnd = undefined;
  }

  if (ramp.roadLevelFrom === roadLevelFrom && ramp.roadLevelEnd === roadLevelEnd) {
    return features;
  }

  return features.map((f) =>
    f.id === rampId
      ? {
          ...f,
          roadLevelFrom,
          roadLevelEnd,
        }
      : f,
  );
}

/** 刷新图中全部匝道的起终点等级锚定 */
export function refreshAllRampRoadClasses(features: MapFeature[]): MapFeature[] {
  let next = features;
  for (const f of features) {
    if (f.kind === 'road' && f.roadLevel === 'ramp') {
      next = refreshRampRoadClasses(next, f.id);
    }
  }
  return next;
}

/**
 * 同层首尾相接：把 draft 并入已有路径（消除端点圆帽与延伸处多余节点）。
 * 普通路：同 kind / 同等级 / 同标高。
 * 匝道：可与另一条匝道首尾拉通，合并后按两端主路刷新配色。
 */
export function tryMergeHeadToTail(
  features: MapFeature[],
  draft: MapFeature,
): MapFeature[] | null {
  if (!isPathKind(draft) || draft.points.length < 2) return null;

  const draftIsRamp = draft.kind === 'road' && draft.roadLevel === 'ramp';
  if (!draftIsRamp && (isRampFeature(draft) || isLevelBlendRoad(draft))) return null;

  const grade = featureGrade(draft);
  const filter = draftIsRamp
    ? (f: MapFeature) =>
        f.kind === 'road' && f.roadLevel === 'ramp' && f.points.length >= 2
    : (f: MapFeature) => canMergeInto(f, draft, grade);

  type Merge = { host: MapFeature; points: Point[]; startG: FeatureGrade; endG: FeatureGrade };
  let best: Merge | null = null;

  const startTip = findPathTipAt(features, draft.points[0], ENDPOINT_MERGE_M, filter);
  if (startTip) {
    const extension = draft.points.slice(1);
    if (extension.length > 0) {
      const points =
        startTip.end === 'end'
          ? [...startTip.feature.points, ...extension]
          : [...extension.reverse(), ...startTip.feature.points];
      // 合并后：几何起点在 host 远端或 draft 远端
      const startG =
        startTip.end === 'end'
          ? featureGrade(startTip.feature)
          : featureGradeEnd(draft);
      const endG =
        startTip.end === 'end'
          ? featureGradeEnd(draft)
          : featureGradeEnd(startTip.feature);
      best = { host: startTip.feature, points, startG, endG };
    }
  }

  const endTip = findPathTipAt(
    features,
    draft.points[draft.points.length - 1],
    ENDPOINT_MERGE_M,
    filter,
  );
  if (endTip && (!best || endTip.feature.id !== best.host.id)) {
    const extension = draft.points.slice(0, -1);
    if (extension.length > 0) {
      const points =
        endTip.end === 'end'
          ? [...endTip.feature.points, ...extension.reverse()]
          : [...extension, ...endTip.feature.points];
      const startG =
        endTip.end === 'end'
          ? featureGrade(endTip.feature)
          : featureGrade(draft);
      const endG =
        endTip.end === 'end'
          ? featureGrade(draft)
          : featureGradeEnd(endTip.feature);
      if (!best || points.length > best.points.length) {
        best = { host: endTip.feature, points, startG, endG };
      }
    }
  }

  if (!best) return null;

  const without = features.filter((f) => f.id !== best!.host.id);
  const simplified = simplifyPathKeepingJunctions(
    best.points,
    best.host.id,
    without,
    draftIsRamp ? featureGrade(best.host) : grade,
  );
  let merged: MapFeature = {
    ...best.host,
    points: simplified,
    grade: best.startG,
    gradeEnd: best.endG !== best.startG ? best.endG : undefined,
  };

  if (draftIsRamp) {
    merged = refitRampAsSingleArc(merged);
    // 挂到主路端点（同级汇入）并刷新配色
    return attachCrossGradeTips(without, merged);
  }

  return weaveSameGradeCrossings(without, merged);
}

/**
 * 分段弯道拉通后，若整体近似单圆弧，重拟合为连续弧，去掉拼接折角。
 */
function refitRampAsSingleArc(ramp: MapFeature): MapFeature {
  if (ramp.points.length < 5) return ramp;
  const start = ramp.points[0];
  const end = ramp.points[ramp.points.length - 1];
  const h0 = Math.atan2(
    ramp.points[1].y - start.y,
    ramp.points[1].x - start.x,
  );
  const curve = curveFromBestTangent(start, h0, end);
  if (!curve || !Number.isFinite(curve.radius) || curve.points.length < 3) {
    return ramp;
  }
  // 与原折线中点偏差过大则保留原形（可能是故意的 S 弯）
  const midOld = ramp.points[Math.floor(ramp.points.length / 2)];
  const midNew = curve.points[Math.floor(curve.points.length / 2)];
  if (dist(midOld, midNew) > Math.max(18, curve.radius * 0.12)) {
    return ramp;
  }
  return { ...ramp, points: curve.points };
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
 * preferMain：优先非匝道主路（避免吸到另一条匝道上）。
 */
export function findGradeAttachment(
  features: MapFeature[],
  point: Point,
  grade: FeatureGrade,
  maxDist = RAMP_ATTACH_M,
  excludeId?: string,
  preferMain = false,
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
    if (preferMain && (f.roadLevel === 'ramp' || isRampFeature(f))) continue;
    // 普通路：整条同层；跨层匝道：两端各算一层
    const gradesOnPath = isRampFeature(f)
      ? [featureGrade(f), featureGradeEnd(f)]
      : [featureGrade(f)];
    if (!gradesOnPath.includes(grade)) continue;

    for (let i = 0; i < f.points.length - 1; i++) {
      const hit = closestOnSegment(point, { a: f.points[i], b: f.points[i + 1] });
      if (hit.dist > maxDist) continue;
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

/**
 * 在对向路上插入挂接节点（同级平面交叉的共享顶点）。
 * 靠近线段端点时只挪对应顶点，避免把整条路远端拽过来。
 */
function insertAttachmentOnPeer(
  peer: MapFeature,
  segIndex: number,
  t: number,
  point: Point,
): MapFeature {
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

/** 仅在非匝道主路上找最近中心线挂接点（任意标高） */
function findNearestMainAttachment(
  features: MapFeature[],
  point: Point,
  maxDist: number,
  excludeId?: string,
): {
  feature: MapFeature;
  point: Point;
  segIndex: number;
  t: number;
  grade: FeatureGrade;
} | null {
  let best: {
    feature: MapFeature;
    point: Point;
    segIndex: number;
    t: number;
    grade: FeatureGrade;
    dist: number;
  } | null = null;

  for (const f of features) {
    if (!isPathKind(f) || f.points.length < 2) continue;
    if (excludeId && f.id === excludeId) continue;
    if (f.roadLevel === 'ramp' || isRampFeature(f)) continue;
    for (let i = 0; i < f.points.length - 1; i++) {
      const hit = closestOnSegment(point, { a: f.points[i], b: f.points[i + 1] });
      if (hit.dist > maxDist) continue;
      if (!best || hit.dist < best.dist) {
        best = {
          feature: f,
          point: hit.point,
          segIndex: i,
          t: hit.t,
          grade: gradeAlongPath(f, hit.point),
          dist: hit.dist,
        };
      }
    }
  }
  return best
    ? {
        feature: best.feature,
        point: best.point,
        segIndex: best.segIndex,
        t: best.t,
        grade: best.grade,
      }
    : null;
}

/**
 * 匝道端点：就近吸到非匝道主路中心线（不强制预匹配标高），
 * 并按挂接处主路标高回写 grade / gradeEnd，保证同级平面汇入。
 *
 * 注意：端点拉通 + 连续标高后，tip 的「预设 grade」常与目标主路不一致，
 * 必须允许跨标高吸附到最近主路，再回写真实 grade。
 */
function snapRampTipsToMains(
  features: MapFeature[],
  incoming: MapFeature,
): { features: MapFeature[]; ramp: MapFeature } {
  let points = [...incoming.points];
  let nextFeatures = [...features];
  let startG = featureGrade(incoming);
  let endG = featureGradeEnd(incoming);

  const snapOne = (tipIndex: 0 | -1) => {
    const tip = tipIndex === 0 ? points[0] : points[points.length - 1];
    const preferredGrade = tipIndex === 0 ? startG : endG;

    // 1) 标高匹配的主路  2) 任意标高最近主路（跳过其它匝道）
    const hit:
      | { feature: MapFeature; point: Point; segIndex: number; t: number; grade?: FeatureGrade }
      | null =
      findGradeAttachment(
        nextFeatures,
        tip,
        preferredGrade,
        RAMP_ATTACH_M,
        incoming.id,
        true,
      ) ?? findNearestMainAttachment(nextFeatures, tip, RAMP_ATTACH_M, incoming.id);

    if (!hit) return;

    const g = hit.grade ?? gradeAlongPath(hit.feature, hit.point);
    if (tipIndex === 0) startG = g;
    else endG = g;

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

  snapOne(0);
  snapOne(-1);

  const ramp: MapFeature = {
    ...incoming,
    points,
    grade: startG,
    gradeEnd: endG !== startG ? endG : undefined,
  };
  return { features: nextFeatures, ramp };
}

/**
 * 跨层匝道 / 异层挂接：把起终点吸到对应标高的路上，并在目标路上插入共享节点。
 * 匝道：就近吸主路并回写两端标高（同级平面汇入）；中段不与异层织交叉。
 */
export function attachCrossGradeTips(
  features: MapFeature[],
  incoming: MapFeature,
): MapFeature[] {
  if (!isPathKind(incoming) || incoming.points.length < 2) {
    return [...features, incoming];
  }

  if (incoming.kind === 'road' && incoming.roadLevel === 'ramp') {
    const { features: next, ramp } = snapRampTipsToMains(features, incoming);
    return refreshRampRoadClasses([...next, ramp], ramp.id);
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
    const hit = findGradeAttachment(
      nextFeatures,
      tip,
      grade,
      RAMP_ATTACH_M,
      incoming.id,
      true,
    );
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

  if (isRampFeature(attached) || startG !== endG || isLevelBlendRoad(attached)) {
    return [...nextFeatures, attached];
  }

  return weaveSameGradeCrossings(nextFeatures, attached);
}

/**
 * 同层道路/铁路交叉时，在双方折线上插入共享交点（形成路口节点）。
 * 不同层不处理（上跨/下穿）。
 * 匝道（含跨层）：只做端点挂接/拉通，中段相交不织平面路口——
 * 绘制时按路径插值标高分段压盖（交点处谁高谁在上）。
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
      f.roadLevel !== 'ramp' &&
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

  const simplifiedIncoming: MapFeature = {
    ...wovenIncoming,
    points: simplifyPathKeepingJunctions(
      wovenIncoming.points,
      wovenIncoming.id,
      nextFeatures,
      grade,
    ),
  };

  return [...nextFeatures, simplifiedIncoming];
}

/**
 * 去掉「仅因曾同层织路」留下的共线中点：异层交叉不应共享路口顶点。
 * 弯折点、同层路口、匝道挂接点保留。
 */
export function stripObsoleteJunctionVertices(features: MapFeature[]): MapFeature[] {
  return features.map((f) => {
    if (!isPathKind(f) || f.points.length <= 2) return f;
    if (isRampFeature(f)) return f;
    const grade = featureGrade(f);
    const points: Point[] = [];
    for (let i = 0; i < f.points.length; i++) {
      const p = f.points[i];
      if (i === 0 || i === f.points.length - 1) {
        points.push({ ...p });
        continue;
      }
      if (otherFeatureTouchesPoint(features, f.id, p, grade)) {
        points.push({ ...p });
        continue;
      }
      const prev = f.points[i - 1];
      const next = f.points[i + 1];
      if (!isCollinearContinuation(prev, p, next)) {
        points.push({ ...p });
        continue;
      }
      // 共线且无同层他路共用 → 异层旧路口或延伸残留，丢弃
    }
    return points.length >= 2 ? { ...f, points } : f;
  });
}

/**
 * 过密折线（旧弯道密采样）RDP 简化，强制保留端点与同层路口 / 挂接顶点。
 * 加载旧图、改标高重织时自动瘦身。
 */
export function simplifyDensePath(
  feature: MapFeature,
  features: MapFeature[],
): MapFeature {
  const isRamp =
    feature.kind === 'road' &&
    (feature.roadLevel === 'ramp' || isRampFeature(feature));
  const threshold = isRamp ? DENSE_RAMP_SIMPLIFY_AT : DENSE_PATH_SIMPLIFY_AT;
  const eps = isRamp ? DENSE_RAMP_SIMPLIFY_EPS_M : DENSE_PATH_SIMPLIFY_EPS_M;
  if (!isPathKind(feature) || feature.points.length < threshold) {
    return feature;
  }
  const grade = featureGrade(feature);
  const keep = new Set<number>([0, feature.points.length - 1]);
  for (let i = 1; i < feature.points.length - 1; i++) {
    if (otherFeatureTouchesPoint(features, feature.id, feature.points[i], grade)) {
      keep.add(i);
      continue;
    }
    if (!isRamp) continue;
    for (const f of features) {
      if (f.id === feature.id || !isPathKind(f)) continue;
      for (let s = 0; s < f.points.length - 1; s++) {
        const hit = closestOnSegment(feature.points[i], {
          a: f.points[s],
          b: f.points[s + 1],
        });
        if (hit.dist <= ENDPOINT_MERGE_M) {
          keep.add(i);
          break;
        }
      }
      if (keep.has(i)) break;
    }
  }
  const points = simplifyPolylineRdp(feature.points, eps, keep);
  return points.length >= 2 ? { ...feature, points } : feature;
}

export function reweaveAllCrossings(features: MapFeature[]): MapFeature[] {
  // 先瘦身过密旧弯道，再清异层残留路口，最后按标高重织，并刷新匝道配色锚定
  const thinned = features.map((f) => simplifyDensePath(f, features));
  const cleaned = stripObsoleteJunctionVertices(thinned);
  const base = cleaned.filter((f) => !isPathKind(f));
  const paths = cleaned.filter(isPathKind);
  let acc = [...base];
  for (const path of paths) {
    acc = weaveSameGradeCrossings(acc, path);
  }
  return refreshAllRampRoadClasses(acc);
}

function pathHeading(f: MapFeature): number | null {
  const a = f.points[0];
  const b = f.points[f.points.length - 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (Math.hypot(dx, dy) < 1) return null;
  return Math.atan2(dy, dx);
}

function angleDelta(a: number, b: number): number {
  let d = Math.abs(a - b) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  return d;
}

function meanDistToPath(sample: Point[], path: MapFeature): number {
  let sum = 0;
  let n = 0;
  for (const p of sample) {
    let best = Infinity;
    for (let i = 0; i < path.points.length - 1; i++) {
      const hit = closestOnSegment(p, { a: path.points[i], b: path.points[i + 1] });
      if (hit.dist < best) best = hit.dist;
    }
    if (best < Infinity) {
      sum += best;
      n++;
    }
  }
  return n > 0 ? sum / n : Infinity;
}

/**
 * 找与目标路平行的「姐妹线」（双向分隔的另一幅），改标高时一起改，避免只抬一条仍与下层织路口。
 */
export function findParallelCompanions(
  features: MapFeature[],
  target: MapFeature,
  maxSpacingM = 28,
): MapFeature[] {
  if (!isPathKind(target) || target.points.length < 2) return [];
  if (isRampFeature(target) || target.roadLevel === 'ramp') return [];
  const grade = featureGrade(target);
  const heading = pathHeading(target);
  if (heading == null) return [];

  const sample: Point[] = [];
  const step = Math.max(1, Math.floor((target.points.length - 1) / 4));
  for (let i = 0; i < target.points.length; i += step) {
    sample.push(target.points[i]);
  }
  if (sample[sample.length - 1] !== target.points[target.points.length - 1]) {
    sample.push(target.points[target.points.length - 1]);
  }

  const out: MapFeature[] = [];
  for (const f of features) {
    if (f.id === target.id || !isPathKind(f) || f.points.length < 2) continue;
    if (isRampFeature(f) || f.roadLevel === 'ramp') continue;
    if (f.kind !== target.kind) continue;
    if (featureGrade(f) !== grade) continue;
    if (
      f.kind === 'road' &&
      (f.roadLevel ?? 'local') !== (target.roadLevel ?? 'local')
    ) {
      continue;
    }
    const h2 = pathHeading(f);
    if (h2 == null) continue;
    const dh = angleDelta(heading, h2);
    if (dh > (22 * Math.PI) / 180 && Math.abs(dh - Math.PI) > (22 * Math.PI) / 180) {
      continue;
    }
    const lat = meanDistToPath(sample, f);
    if (lat < 3 || lat > maxSpacingM) continue;
    out.push(f);
  }
  return out;
}

/** 改标高：目标路 + 平行姐妹线一起改，再重织路口 */
export function setFeaturesGrade(
  features: MapFeature[],
  targetId: string,
  grade: FeatureGrade,
): MapFeature[] {
  const target = features.find((f) => f.id === targetId);
  if (!target || (target.kind !== 'road' && target.kind !== 'railway')) {
    return features;
  }
  const ids = new Set<string>([
    targetId,
    ...findParallelCompanions(features, target).map((f) => f.id),
  ]);
  const next = features.map((f) =>
    ids.has(f.id) ? { ...f, grade, gradeEnd: undefined } : f,
  );
  return reweaveAllCrossings(next);
}

export type JunctionNode = {
  point: Point;
  grade: FeatureGrade;
  /** 汇入该点的路径条数 */
  degree: number;
};

/** 交叉口（≥2 条路）与路径端点；延伸合并后的共线中点不显示 */
export function collectJunctionNodes(features: MapFeature[]): JunctionNode[] {
  type Bucket = {
    point: Point;
    grade: FeatureGrade;
    ids: Set<string>;
    isEndpoint: boolean;
  };
  const buckets = new Map<string, Bucket>();

  const addPoint = (
    f: MapFeature,
    p: Point,
    grade: FeatureGrade,
    isEndpoint: boolean,
  ) => {
    const key = `${grade}|${quantizeKey(p)}`;
    const existing = buckets.get(key);
    if (existing) {
      existing.ids.add(f.id);
      if (isEndpoint) existing.isEndpoint = true;
    } else {
      buckets.set(key, {
        point: { ...p },
        grade,
        ids: new Set([f.id]),
        isEndpoint,
      });
    }
  };

  for (const f of features) {
    if (!isPathKind(f) || f.points.length < 2) continue;
    if (isRampFeature(f)) {
      addPoint(f, f.points[0], featureGrade(f), true);
      addPoint(f, f.points[f.points.length - 1], featureGradeEnd(f), true);
      continue;
    }
    const grade = featureGrade(f);
    const last = f.points.length - 1;
    for (let i = 0; i < f.points.length; i++) {
      // 端点始终登记；中间点只为检出交叉口（与他路共享时 degree≥2）
      addPoint(f, f.points[i], grade, i === 0 || i === last);
    }
  }

  const nodes: JunctionNode[] = [];
  for (const b of buckets.values()) {
    // 交叉口，或至少一条路的端点（死头/可续接点）
    if (b.ids.size >= 2 || b.isEndpoint) {
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

  // 匝道挂接到他路：端点落在他路顶点或中心线上都算接合（去掉鼓包圆帽）
  for (const tip of tips) {
    if (joined.has(`${tip.featureId}|${tip.end}`)) continue;
    for (const f of features) {
      if (!isPathKind(f) || f.id === tip.featureId) continue;
      let hit = false;
      for (const p of f.points) {
        if (dist(tip.point, p) <= ENDPOINT_MERGE_M) {
          hit = true;
          break;
        }
      }
      if (!hit) {
        for (let i = 0; i < f.points.length - 1; i++) {
          const on = closestOnSegment(tip.point, { a: f.points[i], b: f.points[i + 1] });
          if (on.dist <= ENDPOINT_MERGE_M) {
            hit = true;
            break;
          }
        }
      }
      if (hit) {
        joined.add(`${tip.featureId}|${tip.end}`);
        break;
      }
    }
  }

  return joined;
}
