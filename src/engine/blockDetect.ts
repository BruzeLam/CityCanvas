import type { CityBlock, MapFeature, Point } from '../types';
import { createId } from '../types';
import { dist } from './geometry';
import { polygonArea } from './pathUtils';

const SNAP_M = 28;
const SAMPLE_STEP_M = 80;
const MIN_BLOCK_AREA = 8_000;
const MAX_BLOCK_AREA_RATIO = 0.45;
const MAX_NODES = 2_500;

type Node = { id: number; x: number; y: number };
type HalfEdge = {
  id: number;
  from: number;
  to: number;
  twin: number;
  next: number;
  angle: number;
};

function quantize(p: Point, step = SNAP_M): string {
  return `${Math.round(p.x / step) * step},${Math.round(p.y / step) * step}`;
}

function samplePolyline(points: Point[], step: number): Point[] {
  if (points.length < 2) return points;
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const len = dist(a, b);
    if (len < 1) continue;
    const n = Math.max(1, Math.floor(len / step));
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}

function signedArea(poly: Point[]): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const j = (i + 1) % poly.length;
    a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
  }
  return a / 2;
}

/**
 * 从道路折线识别围合街区。
 * 手绘路网 → 吸附建图 → 左转走环找面。
 * 不是 CSLMV 的 3D 建筑投影，而是 2D 路网围合。
 */
export function detectBlocks(
  features: MapFeature[],
  mapWidthM: number,
  mapHeightM: number,
): CityBlock[] {
  const roads = features.filter((f) => f.kind === 'road' && f.points.length >= 2);
  if (roads.length === 0) return [];

  const nodeMap = new Map<string, number>();
  const nodes: Node[] = [];

  const getNode = (p: Point): number => {
    const key = quantize(p);
    const existing = nodeMap.get(key);
    if (existing !== undefined) return existing;
    const id = nodes.length;
    const [sx, sy] = key.split(',').map(Number);
    nodes.push({ id, x: sx, y: sy });
    nodeMap.set(key, id);
    return id;
  };

  const undirected = new Set<string>();
  for (const road of roads) {
    const sampled = samplePolyline(road.points, SAMPLE_STEP_M);
    for (let i = 1; i < sampled.length; i++) {
      const a = getNode(sampled[i - 1]);
      const b = getNode(sampled[i]);
      if (a === b) continue;
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      undirected.add(key);
    }
  }

  if (nodes.length < 3 || nodes.length > MAX_NODES) return [];

  const halfEdges: HalfEdge[] = [];
  const outEdges = new Map<number, number[]>();

  const addOut = (from: number, heId: number) => {
    const list = outEdges.get(from) ?? [];
    list.push(heId);
    outEdges.set(from, list);
  };

  for (const key of undirected) {
    const [a, b] = key.split('-').map(Number);
    const na = nodes[a];
    const nb = nodes[b];
    const idAb = halfEdges.length;
    const idBa = halfEdges.length + 1;
    halfEdges.push({
      id: idAb,
      from: a,
      to: b,
      twin: idBa,
      next: -1,
      angle: Math.atan2(nb.y - na.y, nb.x - na.x),
    });
    halfEdges.push({
      id: idBa,
      from: b,
      to: a,
      twin: idAb,
      next: -1,
      angle: Math.atan2(na.y - nb.y, na.x - nb.x),
    });
    addOut(a, idAb);
    addOut(b, idBa);
  }

  // 每个节点按出边角度排序，左转接边：当前边 twin 后，取顺时针下一条
  for (const [, heIds] of outEdges) {
    heIds.sort((i, j) => halfEdges[i].angle - halfEdges[j].angle);
  }

  for (const he of halfEdges) {
    const at = he.to;
    const outs = outEdges.get(at) ?? [];
    if (outs.length === 0) continue;
    const twin = halfEdges[he.twin];
    // 在 to 节点的出边中，找到 twin 的下一条（逆时针 = 左转）
    const idx = outs.indexOf(twin.id);
    if (idx === -1) {
      he.next = outs[0];
    } else {
      he.next = outs[(idx + 1) % outs.length];
    }
  }

  const visited = new Set<number>();
  const faces: Point[][] = [];
  const mapArea = mapWidthM * mapHeightM;
  const maxArea = mapArea * MAX_BLOCK_AREA_RATIO;

  for (const start of halfEdges) {
    if (visited.has(start.id)) continue;
    const cycle: number[] = [];
    let cur = start;
    let guard = 0;
    while (!visited.has(cur.id) && guard++ < halfEdges.length + 2) {
      visited.add(cur.id);
      cycle.push(cur.id);
      if (cur.next < 0) break;
      cur = halfEdges[cur.next];
      if (cur.id === start.id) break;
    }
    if (cycle.length < 3 || cur.id !== start.id) continue;

    const poly = cycle.map((heId) => {
      const n = nodes[halfEdges[heId].from];
      return { x: n.x, y: n.y };
    });

    // 去重连续点
    const cleaned: Point[] = [];
    for (const p of poly) {
      const last = cleaned[cleaned.length - 1];
      if (!last || dist(last, p) > 1) cleaned.push(p);
    }
    if (cleaned.length >= 3 && dist(cleaned[0], cleaned[cleaned.length - 1]) < 1) {
      cleaned.pop();
    }
    if (cleaned.length < 3) continue;

    const area = polygonArea(cleaned);
    const sArea = signedArea(cleaned);
    // 只保留顺时针（内环，屏幕 y 向下时符号可能反转；用面积过滤外轮廓）
    if (area < MIN_BLOCK_AREA || area > maxArea) continue;
    // 外轮廓通常面积最大且方向相反；再滤掉贴边超大面
    if (Math.abs(sArea) < MIN_BLOCK_AREA) continue;

    faces.push(cleaned);
  }

  // 去重近似相同的面（质心 + 面积）
  const unique: CityBlock[] = [];
  for (const face of faces) {
    const area = polygonArea(face);
    const cx = face.reduce((s, p) => s + p.x, 0) / face.length;
    const cy = face.reduce((s, p) => s + p.y, 0) / face.length;
    const dup = unique.some((b) => {
      const bx = b.points.reduce((s, p) => s + p.x, 0) / b.points.length;
      const by = b.points.reduce((s, p) => s + p.y, 0) / b.points.length;
      return Math.hypot(cx - bx, cy - by) < SNAP_M * 2 && Math.abs(polygonArea(b.points) - area) < area * 0.15;
    });
    if (!dup) {
      unique.push({ id: createId(), points: face });
    }
  }

  return unique.sort((a, b) => polygonArea(b.points) - polygonArea(a.points)).slice(0, 200);
}
