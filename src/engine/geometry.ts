import type { Point } from '../types';

const SNAP_BASE = 12;

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
