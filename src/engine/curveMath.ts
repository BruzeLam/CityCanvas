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
  // 加密采样，避免弯道折线锯齿；长弧按弧长分段
  const step = Math.min(Math.max(3, maxSegmentM), 10);
  const n = Math.max(12, Math.ceil(arcLen / step));
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
 * 不再把优弧夹成 180° 再硬贴终点（那会造成末段折线锯齿）；环匝可超过 180°。
 */
export function curveFromTangent(
  start: Point,
  headingRad: number,
  end: Point,
  maxSegmentM = 8,
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

  // 接近整圆时略收，避免重合起终点采样异常；保留 >180° 环匝
  if (Math.abs(sweep) > Math.PI * 2 - 1e-3) {
    sweep = Math.sign(sweep) * (Math.PI * 2 - 1e-3);
  }

  const points = sampleArcAngles(center, radius, ang0, sweep, maxSegmentM);
  points[0] = { ...start };
  points[points.length - 1] = { ...end };
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

export type CurveResult = {
  points: Point[];
  radius: number;
  radius2?: number;
  sweepDeg: number;
  endHeading: number;
  adaptive: boolean;
};

function almostCollinear(a: Point, b: Point, c: Point): boolean {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const acx = c.x - a.x;
  const acy = c.y - a.y;
  const cross = abx * acy - aby * acx;
  const scale = Math.hypot(abx, aby) * Math.hypot(acx, acy);
  return scale < 1e-6 || Math.abs(cross) / scale < 0.02;
}

/**
 * 三点定半径劣弧：过 A、B、C 的外接圆，取 A→C 的劣弧（≤180°），
 * 且鼓包朝向 B 所在侧（匝道常用，避免绕远的优弧/S 形）。
 */
export function curveFromThreePoints(
  a: Point,
  b: Point,
  c: Point,
  maxSegmentM = 8,
): CurveResult | null {
  const chordAC = dist(a, c);
  if (chordAC < 2 || dist(a, b) < 2 || dist(b, c) < 2) return null;

  if (almostCollinear(a, b, c)) {
    return {
      points: [a, c],
      radius: Infinity,
      sweepDeg: 0,
      endHeading: bearingRad(a, c),
      adaptive: false,
    };
  }

  const d =
    2 *
    (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6) return null;

  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const center = { x: ux, y: uy };
  const radius = dist(center, a);
  if (!Number.isFinite(radius) || radius < 8 || radius > 1e7) return null;

  const angA = Math.atan2(a.y - center.y, a.x - center.x);
  const angC = Math.atan2(c.y - center.y, c.x - center.x);

  const norm = (x: number) => {
    let v = x;
    while (v <= -Math.PI) v += Math.PI * 2;
    while (v > Math.PI) v -= Math.PI * 2;
    return v;
  };

  let sweepCCW = norm(angC - angA);
  if (sweepCCW < 0) sweepCCW += Math.PI * 2;
  const sweepCW = sweepCCW - Math.PI * 2;

  // 弦 AC 的哪一侧有鼓包：与 B 同侧
  const sideOf = (sweep: number) => {
    const midAng = angA + sweep / 2;
    const mid = {
      x: center.x + Math.cos(midAng) * radius,
      y: center.y + Math.sin(midAng) * radius,
    };
    const cross =
      (c.x - a.x) * (mid.y - a.y) - (c.y - a.y) * (mid.x - a.x);
    const crossB =
      (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x);
    return cross * crossB >= 0;
  };

  const candidates = [sweepCCW, sweepCW].filter((s) => Math.abs(s) <= Math.PI + 1e-6);
  let sweep =
    candidates.find((s) => sideOf(s)) ??
    (Math.abs(sweepCCW) <= Math.abs(sweepCW) ? sweepCCW : sweepCW);

  // 仍超过 180° 则夹到劣弧
  if (Math.abs(sweep) > Math.PI) {
    sweep = Math.sign(sweep) * Math.PI;
  }

  const points = sampleArcAngles(center, radius, angA, sweep, maxSegmentM);
  points[0] = { ...a };
  points[points.length - 1] = { ...c };

  const endAng = angA + sweep;
  const endHeading = endAng + (sweep >= 0 ? Math.PI / 2 : -Math.PI / 2);

  return {
    points,
    radius,
    sweepDeg: (Math.abs(sweep) * 180) / Math.PI,
    endHeading,
    adaptive: false,
  };
}

/**
 * 自适应变半径：A→B、B→C 两段切线连续圆弧（接到已有节点时用）。
 * startHeading / endHeading 可选，用于贴合前后道路切线。
 */
export function curveAdaptiveViaControl(
  a: Point,
  b: Point,
  c: Point,
  startHeading: number | null,
  endHeading: number | null,
  maxSegmentM = 8,
): CurveResult | null {
  const h0 = startHeading ?? bearingRad(a, b);
  const arc1 = curveFromTangent(a, h0, b, maxSegmentM);
  if (!arc1) return curveFromThreePoints(a, b, c, maxSegmentM);

  let arc2: ReturnType<typeof curveFromTangent> = null;
  if (endHeading != null) {
    // 从 C 沿反向切线拉到 B，再反转，使终点切线贴近已有路
    const rev = curveFromTangent(c, endHeading + Math.PI, b, maxSegmentM);
    if (rev && rev.points.length >= 2) {
      const forward = [...rev.points].reverse();
      arc2 = {
        points: forward,
        radius: rev.radius,
        sweepDeg: rev.sweepDeg,
        endHeading,
      };
    }
  }
  if (!arc2) {
    arc2 = curveFromTangent(b, arc1.endHeading, c, maxSegmentM);
  }
  if (!arc2) return curveFromThreePoints(a, b, c, maxSegmentM);

  const points = [...arc1.points, ...arc2.points.slice(1)];
  const r1 = arc1.radius;
  const r2 = arc2.radius;
  const sweepDeg = arc1.sweepDeg + arc2.sweepDeg;

  return {
    points,
    radius: Number.isFinite(r1) ? r1 : r2,
    radius2: Number.isFinite(r1) && Number.isFinite(r2) && Math.abs(r1 - r2) > 1 ? r2 : undefined,
    sweepDeg,
    endHeading: arc2.endHeading,
    adaptive: true,
  };
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
