import type { Point } from '../types';
import { dist } from './geometry';

/** 方位角（度，数学坐标系：0° 向右，y 向下时顺时针为正） */
export function bearingDeg(from: Point, to: Point): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
}

export function bearingRad(from: Point, to: Point): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** 将角度规范到 (-180, 180] */
export function normalizeAngleDeg(deg: number): number {
  let a = deg % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return a;
}

/** 按步长吸附角度，保持长度不变 */
export function snapAnglePoint(from: Point, to: Point, stepDeg = 15): Point {
  const len = dist(from, to);
  if (len < 1e-6) return { ...to };
  const ang = Math.atan2(to.y - from.y, to.x - from.x);
  const step = (stepDeg * Math.PI) / 180;
  const snapped = Math.round(ang / step) * step;
  return {
    x: from.x + Math.cos(snapped) * len,
    y: from.y + Math.sin(snapped) * len,
  };
}

export function formatLength(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
  return `${Math.round(m)} m`;
}

export function formatAngle(deg: number): string {
  return `${normalizeAngleDeg(deg).toFixed(1)}°`;
}

export function formatRadius(m: number): string {
  if (m >= 1000) return `R ${(m / 1000).toFixed(2)} km`;
  return `R ${Math.round(m)} m`;
}

function sampleArcAngles(
  center: Point,
  radius: number,
  ang0: number,
  sweep: number,
  maxSegmentM: number,
): Point[] {
  const arcLen = Math.abs(sweep) * radius;
  const n = Math.max(4, Math.ceil(arcLen / maxSegmentM));
  const points: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ang = ang0 + sweep * t;
    points.push({
      x: center.x + Math.cos(ang) * radius,
      y: center.y + Math.sin(ang) * radius,
    });
  }
  return points;
}

/**
 * 天际线 / TF2 式弯道：从 start 出发，沿 heading 切线，画到 end 的圆弧。
 * 圆心在切线法向上，半径由终点几何唯一确定。
 */
export function curveFromTangent(
  start: Point,
  headingRad: number,
  end: Point,
  maxSegmentM = 36,
): { points: Point[]; radius: number; sweepDeg: number; endHeading: number } | null {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const chord = Math.hypot(dx, dy);
  if (chord < 2) return null;

  const hx = Math.cos(headingRad);
  const hy = Math.sin(headingRad);
  const nx = -hy;
  const ny = hx;

  const forward = dx * hx + dy * hy;
  const lateral = dx * nx + dy * ny;

  if (Math.abs(lateral) < 1.5) {
    return {
      points: [start, end],
      radius: Infinity,
      sweepDeg: 0,
      endHeading: bearingRad(start, end),
    };
  }

  const radius = (forward * forward + lateral * lateral) / (2 * Math.abs(lateral));
  if (!Number.isFinite(radius) || radius < 8) return null;

  const side = lateral > 0 ? 1 : -1;
  const center = {
    x: start.x + side * radius * nx,
    y: start.y + side * radius * ny,
  };

  const ang0 = Math.atan2(start.y - center.y, start.x - center.x);
  const ang1 = Math.atan2(end.y - center.y, end.x - center.x);

  let sweep = ang1 - ang0;
  if (side > 0) {
    while (sweep <= 0) sweep += Math.PI * 2;
    while (sweep > Math.PI * 2) sweep -= Math.PI * 2;
  } else {
    while (sweep >= 0) sweep -= Math.PI * 2;
    while (sweep < -Math.PI * 2) sweep += Math.PI * 2;
  }

  const maxSweep = (160 * Math.PI) / 180;
  if (Math.abs(sweep) > maxSweep) {
    sweep = Math.sign(sweep) * maxSweep;
  }

  const points = sampleArcAngles(center, radius, ang0, sweep, maxSegmentM);
  points[0] = { ...start };
  const endAng = ang0 + sweep;
  const endHeading = endAng + (side > 0 ? Math.PI / 2 : -Math.PI / 2);

  return {
    points,
    radius,
    sweepDeg: (Math.abs(sweep) * 180) / Math.PI,
    endHeading,
  };
}

/** 从已绘折线末段推算当前切线角；不足两点则返回 null */
export function headingFromPolyline(points: Point[]): number | null {
  if (points.length < 2) return null;
  const a = points[points.length - 2];
  const b = points[points.length - 1];
  if (dist(a, b) < 1e-3) return null;
  return bearingRad(a, b);
}

export type LineMetrics = {
  lengthM: number;
  angleDeg: number;
};

export function lineMetrics(from: Point, to: Point): LineMetrics {
  return {
    lengthM: dist(from, to),
    angleDeg: bearingDeg(from, to),
  };
}
