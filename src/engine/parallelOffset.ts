import type { Point } from '../types';
import { PARALLEL_CLEAR_M } from './geometry';

/** 平行模式默认中心线间距（米） */
export const DEFAULT_PARALLEL_SPACING_M = PARALLEL_CLEAR_M;

export const PARALLEL_SPACING_MIN_M = 4;
export const PARALLEL_SPACING_MAX_M = 120;

export type ParallelSide = 'left' | 'right' | 'both';

export const PARALLEL_SIDES: { id: ParallelSide; label: string; desc: string }[] = [
  { id: 'both', label: '双侧', desc: '沿绘制轨迹左右各偏半间距，适合双向分隔' },
  { id: 'left', label: '左侧', desc: '保留绘制线，并在左侧再画一条' },
  { id: 'right', label: '右侧', desc: '保留绘制线，并在右侧再画一条' },
];

export function clampParallelSpacing(m: number): number {
  if (!Number.isFinite(m)) return DEFAULT_PARALLEL_SPACING_M;
  return Math.max(PARALLEL_SPACING_MIN_M, Math.min(PARALLEL_SPACING_MAX_M, Math.round(m)));
}

function unitNormal(ax: number, ay: number, bx: number, by: number): { nx: number; ny: number } | null {
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  // 左侧法向（屏幕 y 向下时，数学上的左）
  return { nx: -dy / len, ny: dx / len };
}

/**
 * 折线平行偏移（米）。offset>0 为左侧，offset<0 为右侧。
 * 转角用法向平均 + 斜接上限，端点严格按切线法向偏移（避免两端收束成一点）。
 */
export function offsetPolyline(points: Point[], offsetM: number): Point[] {
  if (points.length < 2 || Math.abs(offsetM) < 1e-6) {
    return points.map((p) => ({ ...p }));
  }

  const n = points.length;
  const result: Point[] = new Array(n);
  const MITER_LIMIT = 2.5;

  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)];
    const curr = points[i];
    const next = points[Math.min(n - 1, i + 1)];

    let nx = 0;
    let ny = 0;
    let count = 0;

    if (i > 0) {
      const n0 = unitNormal(prev.x, prev.y, curr.x, curr.y);
      if (n0) {
        nx += n0.nx;
        ny += n0.ny;
        count++;
      }
    }
    if (i < n - 1) {
      const n1 = unitNormal(curr.x, curr.y, next.x, next.y);
      if (n1) {
        nx += n1.nx;
        ny += n1.ny;
        count++;
      }
    }

    if (count === 0) {
      result[i] = { ...curr };
      continue;
    }

    let len = Math.hypot(nx, ny);
    if (len < 1e-6) {
      result[i] = { ...curr };
      continue;
    }
    nx /= len;
    ny /= len;

    // 斜接：两法向夹角大时放大偏移，但封顶，避免尖角爆炸
    let scale = 1;
    if (count === 2 && i > 0 && i < n - 1) {
      const a = unitNormal(prev.x, prev.y, curr.x, curr.y);
      const b = unitNormal(curr.x, curr.y, next.x, next.y);
      if (a && b) {
        const dot = Math.max(-1, Math.min(1, a.nx * b.nx + a.ny * b.ny));
        const cosHalf = Math.sqrt(Math.max(0, (1 + dot) / 2));
        if (cosHalf > 1e-3) {
          scale = Math.min(MITER_LIMIT, 1 / cosHalf);
        }
      }
    }

    result[i] = {
      x: curr.x + nx * offsetM * scale,
      y: curr.y + ny * offsetM * scale,
    };
  }

  return result;
}

/**
 * 根据平行侧向，从引导线生成实际要提交的路径列表。
 * - both：±spacing/2（引导线作中线，不落路）
 * - left/right：引导线 + 单侧整间距偏移
 *
 * 过短引导线相对间距过小时，平行端会视觉重叠；仍生成，但保持端点分离。
 */
export function buildParallelPaths(
  guide: Point[],
  spacingM: number,
  side: ParallelSide,
): Point[][] {
  if (guide.length < 2) return [];
  const spacing = clampParallelSpacing(spacingM);

  if (side === 'both') {
    const half = spacing / 2;
    return [offsetPolyline(guide, half), offsetPolyline(guide, -half)];
  }

  const offset = side === 'left' ? spacing : -spacing;
  return [guide.map((p) => ({ ...p })), offsetPolyline(guide, offset)];
}

/** 预览用：当前草稿 + 光标组成的引导线 */
export function guideFromDraft(points: Point[], cursor: Point | null): Point[] {
  if (points.length === 0) return cursor ? [cursor] : [];
  if (!cursor) return points;
  const last = points[points.length - 1];
  if (Math.hypot(cursor.x - last.x, cursor.y - last.y) < 1e-3) return points;
  return [...points, cursor];
}
