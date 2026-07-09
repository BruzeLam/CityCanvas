import type { Point } from '../types';
import { dist } from './geometry';

/** 方位角（度，数学坐标系：0° 向右，顺时针为正因 y 向下） */
export function bearingDeg(from: Point, to: Point): number {
  return (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;
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

/** 三点定圆；共线返回 null */
export function circleFrom3Points(
  a: Point,
  b: Point,
  c: Point,
): { center: Point; radius: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6) return null;

  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;

  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const center = { x: ux, y: uy };
  const radius = dist(center, a);
  if (!Number.isFinite(radius) || radius < 1) return null;
  return { center, radius };
}

function angleAt(center: Point, p: Point): number {
  return Math.atan2(p.y - center.y, p.x - center.x);
}

/** 判断从 a→b→c 的圆弧方向（ccw 为正） */
function arcOrientation(a: Point, b: Point, c: Point): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

/**
 * 三点圆弧采样：从 a 经 b 到 c。
 * 返回含 a…c 的折线点列（不含重复终点时可再拼接下一段）。
 */
export function sampleArcThrough(
  a: Point,
  b: Point,
  c: Point,
  maxSegmentM = 40,
): { points: Point[]; radius: number; sweepDeg: number } | null {
  const circle = circleFrom3Points(a, b, c);
  if (!circle) return null;

  const { center, radius } = circle;
  let angA = angleAt(center, a);
  let angB = angleAt(center, b);
  let angC = angleAt(center, c);

  // 展开到连续区间，使路径经过 B
  const ccw = arcOrientation(a, b, c) > 0;

  const norm = (x: number) => {
    while (x < 0) x += Math.PI * 2;
    while (x >= Math.PI * 2) x -= Math.PI * 2;
    return x;
  };

  angA = norm(angA);
  angB = norm(angB);
  angC = norm(angC);

  let sweep: number;
  if (ccw) {
    let toB = angB - angA;
    if (toB < 0) toB += Math.PI * 2;
    let toC = angC - angA;
    if (toC < 0) toC += Math.PI * 2;
    // 若 B 不在 A→C 的 ccw 弧上，走另一方向
    if (toB > toC + 1e-6) {
      toC -= Math.PI * 2;
    }
    sweep = toC;
  } else {
    let toB = angA - angB;
    if (toB < 0) toB += Math.PI * 2;
    let toC = angA - angC;
    if (toC < 0) toC += Math.PI * 2;
    if (toB > toC + 1e-6) {
      toC -= Math.PI * 2;
    }
    sweep = -toC;
  }

  const arcLen = Math.abs(sweep) * radius;
  const n = Math.max(4, Math.ceil(arcLen / maxSegmentM));
  const points: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const ang = angA + sweep * t;
    points.push({
      x: center.x + Math.cos(ang) * radius,
      y: center.y + Math.sin(ang) * radius,
    });
  }

  // 强制端点精确
  points[0] = { ...a };
  points[points.length - 1] = { ...c };

  return {
    points,
    radius,
    sweepDeg: (Math.abs(sweep) * 180) / Math.PI,
  };
}

export type LineMetrics = {
  lengthM: number;
  angleDeg: number;
};

export type ArcMetrics = {
  radiusM: number;
  sweepDeg: number;
  chordM: number;
};

export function lineMetrics(from: Point, to: Point): LineMetrics {
  return {
    lengthM: dist(from, to),
    angleDeg: bearingDeg(from, to),
  };
}
