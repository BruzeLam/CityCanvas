import type { FeatureKind, MapFeature, Point } from '../types';
import { dist, snapThreshold } from './geometry';

function pointToSegmentDist(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return dist(p, { x: a.x + t * dx, y: a.y + t * dy });
}

export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersect =
      yi > p.y !== yj > p.y && p.x < ((xj - xi) * (p.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export function hitTestFeature(feature: MapFeature, p: Point, zoom: number): boolean {
  const lineThreshold = snapThreshold(zoom) * 2;

  if (feature.closed && feature.points.length >= 3) {
    return pointInPolygon(p, feature.points);
  }

  for (let i = 0; i < feature.points.length - 1; i++) {
    if (pointToSegmentDist(p, feature.points[i], feature.points[i + 1]) < lineThreshold) {
      return true;
    }
  }
  return false;
}

const HIT_ORDER: FeatureKind[] = ['road', 'river', 'mountain', 'land', 'ocean'];

export function findFeatureAt(
  features: MapFeature[],
  p: Point,
  zoom: number,
): MapFeature | null {
  for (const kind of HIT_ORDER) {
    for (let i = features.length - 1; i >= 0; i--) {
      const f = features[i];
      if (f.kind === kind && hitTestFeature(f, p, zoom)) return f;
    }
  }
  return null;
}

export function findVertexIndex(
  feature: MapFeature,
  p: Point,
  zoom: number,
): number | null {
  const threshold = snapThreshold(zoom) * 1.2;
  for (let i = 0; i < feature.points.length; i++) {
    if (dist(p, feature.points[i]) < threshold) return i;
  }
  return null;
}
