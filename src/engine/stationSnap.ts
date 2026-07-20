import type { FeatureGrade, MapFeature, Point, RailKind } from '../types';
import { featureGrade, featureLineColor } from '../types';
import { closestOnSegment, dist } from './geometry';

export type StationSnap = {
  point: Point;
  heading: number;
  color?: string;
  lineName?: string;
  grade: FeatureGrade;
  railId: string;
};

/**
 * 将站点吸附到最近的地铁/有轨中心线，并取切线朝向与线路色/名。
 */
export function snapStationToRail(
  features: MapFeature[],
  point: Point,
  preferKinds: RailKind[],
  maxDist = 32,
): StationSnap | null {
  let best: (StationSnap & { dist: number }) | null = null;

  for (const f of features) {
    if (f.kind !== 'railway' || f.points.length < 2) continue;
    const rk = f.railKind ?? 'railway';
    if (!preferKinds.includes(rk)) continue;

    for (let i = 0; i < f.points.length - 1; i++) {
      const a = f.points[i];
      const b = f.points[i + 1];
      const hit = closestOnSegment(point, { a, b });
      if (hit.dist > maxDist) continue;
      if (best && hit.dist >= best.dist) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const heading = Math.atan2(dy, dx);
      best = {
        point: hit.point,
        heading,
        color: featureLineColor(f),
        lineName: f.lineName,
        grade: featureGrade(f),
        railId: f.id,
        dist: hit.dist,
      };
    }
  }

  return best
    ? {
        point: best.point,
        heading: best.heading,
        color: best.color,
        lineName: best.lineName,
        grade: best.grade,
        railId: best.railId,
      }
    : null;
}

/** 未吸附时：若点击附近有同色线路，仍可继承色/名（可选） */
export function nearestLineMeta(
  features: MapFeature[],
  point: Point,
  preferKinds: RailKind[],
  maxDist = 80,
): { color?: string; lineName?: string } | null {
  let best: { color?: string; lineName?: string; dist: number } | null = null;
  for (const f of features) {
    if (f.kind !== 'railway' || f.points.length < 2) continue;
    const rk = f.railKind ?? 'railway';
    if (!preferKinds.includes(rk)) continue;
    for (let i = 0; i < f.points.length - 1; i++) {
      const hit = closestOnSegment(point, {
        a: f.points[i],
        b: f.points[i + 1],
      });
      if (hit.dist > maxDist) continue;
      if (!best || hit.dist < best.dist) {
        best = {
          color: featureLineColor(f),
          lineName: f.lineName,
          dist: hit.dist,
        };
      }
    }
  }
  return best ? { color: best.color, lineName: best.lineName } : null;
}

export function distToFeature(feature: MapFeature, p: Point): number {
  if (feature.points.length === 0) return Infinity;
  if (feature.points.length === 1) return dist(p, feature.points[0]);
  let best = Infinity;
  for (let i = 0; i < feature.points.length - 1; i++) {
    const hit = closestOnSegment(p, {
      a: feature.points[i],
      b: feature.points[i + 1],
    });
    if (hit.dist < best) best = hit.dist;
  }
  return best;
}
