import type { MapFeature, Point } from '../types';
import { featureGrade, gradeAtPathT, isRampFeature } from '../types';
import { closestOnSegment, dist } from './geometry';
import {
  TERRAIN_WATER,
  type TerrainGrid,
} from './terrain';

/** 河流半宽（米）：路心落在此带内视为穿河 */
const RIVER_HALF_WIDTH_M = 14;

export type WaterSpan = {
  /** 水域子路径（世界坐标，已加密） */
  points: Point[];
  /** 跨中点处连续标高 */
  grade: number;
  /** 入口切线（朝水域内） */
  entryHeading: number;
  /** 出口切线（朝水域外 / 沿路径前进） */
  exitHeading: number;
};

export function terrainCellAt(grid: TerrainGrid, p: Point): number | null {
  const col = Math.floor(p.x / grid.cellSizeM);
  const row = Math.floor(p.y / grid.cellSizeM);
  if (col < 0 || row < 0 || col >= grid.cols || row >= grid.rows) return null;
  return grid.cells[row * grid.cols + col] ?? null;
}

function distToRiver(p: Point, rivers: MapFeature[]): number {
  let best = Infinity;
  for (const r of rivers) {
    if (r.points.length < 2) continue;
    for (let i = 0; i < r.points.length - 1; i++) {
      const hit = closestOnSegment(p, { a: r.points[i], b: r.points[i + 1] });
      if (hit.dist < best) best = hit.dist;
    }
  }
  return best;
}

export function isWaterAt(
  p: Point,
  grid: TerrainGrid | null | undefined,
  rivers: MapFeature[],
): boolean {
  if (grid && terrainCellAt(grid, p) === TERRAIN_WATER) return true;
  if (rivers.length > 0 && distToRiver(p, rivers) <= RIVER_HALF_WIDTH_M) return true;
  return false;
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

function headingOf(a: Point, b: Point): number {
  return Math.atan2(b.y - a.y, b.x - a.x);
}

/**
 * 沿道路采样，找出连续穿水段。短于 minLenM 的碎段忽略。
 */
export function findWaterSpans(
  feature: MapFeature,
  grid: TerrainGrid | null | undefined,
  rivers: MapFeature[],
  sampleStepM = 8,
  minLenM = 18,
): WaterSpan[] {
  const pts = feature.points;
  if (pts.length < 2) return [];

  type Sample = { p: Point; water: boolean; pathT: number; heading: number };
  const samples: Sample[] = [];
  let traveled = 0;
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) total += dist(pts[i], pts[i + 1]);
  if (total < 1) return [];

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const segLen = dist(a, b);
    if (segLen < 1e-6) continue;
    const n = Math.max(1, Math.ceil(segLen / sampleStepM));
    for (let k = 0; k < n; k++) {
      const u = k / n;
      const p = lerpPoint(a, b, u);
      const pathT = (traveled + segLen * u) / total;
      samples.push({
        p,
        water: isWaterAt(p, grid, rivers),
        pathT,
        heading: headingOf(a, b),
      });
    }
    traveled += segLen;
  }
  // 终点
  samples.push({
    p: { ...pts[pts.length - 1] },
    water: isWaterAt(pts[pts.length - 1], grid, rivers),
    pathT: 1,
    heading: samples.length
      ? samples[samples.length - 1].heading
      : headingOf(pts[pts.length - 2], pts[pts.length - 1]),
  });

  const spans: WaterSpan[] = [];
  let i = 0;
  while (i < samples.length) {
    while (i < samples.length && !samples[i].water) i++;
    if (i >= samples.length) break;
    const start = i;
    while (i < samples.length && samples[i].water) i++;
    const end = i - 1;
    const run = samples.slice(start, end + 1);
    let len = 0;
    for (let k = 0; k < run.length - 1; k++) len += dist(run[k].p, run[k + 1].p);
    if (len < minLenM || run.length < 2) continue;

    const midT = run[Math.floor(run.length / 2)].pathT;
    const grade = isRampFeature(feature)
      ? gradeAtPathT(feature, midT)
      : featureGrade(feature);

    spans.push({
      points: run.map((s) => ({ ...s.p })),
      grade,
      entryHeading: run[0].heading,
      exitHeading: run[run.length - 1].heading,
    });
  }
  return spans;
}
