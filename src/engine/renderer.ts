import type {
  CityBlock,
  CityProject,
  LayerVisibility,
  MapFeature,
  MapStyle,
  Point,
  Viewport,
} from '../types';
import {
  ROAD_STYLES,
  RAIL_STYLES,
  ROAD_CLASS_RANK,
  DEFAULT_METRO_COLOR,
  featureGrade,
  featureGradeEnd,
  featureLineColor,
  getLayers,
  gradeAtPathT,
  isLevelBlendRoad,
  isRampFeature,
  normalizeRoadClass,
  rampSolidClass,
} from '../types';
import type { RoadLevel } from '../types';
import { detectBlocks } from './blockDetect';
import {
  curveFromThreePoints,
  curveFromBestTangent,
} from './curveMath';
import type { GuideSnap, Segment } from './geometry';
import { closestOnSegment, dist } from './geometry';
import {
  collectJoinedCaps,
  collectJunctionNodes,
  collectJoinMouths,
  collectCasingTrimM,
  ENDPOINT_MERGE_M,
  segmentIntersection,
  type JoinMouth,
} from './junctions';
import {
  ensureTerrain,
  type TerrainGrid,
} from './terrain';
import { getTerrainBitmap, type TerrainPaintQuality } from './terrainDraw';
import { findWaterSpans, type WaterSpan } from './waterCrossing';

function sortByGradeAsc(a: MapFeature, b: MapFeature): number {
  return featureGrade(a) - featureGrade(b);
}

type RoadDrawPiece = {
  feature: MapFeature;
  /** 连续标高，用于 z-order；匝道交叉处取子段中点插值 */
  grade: number;
  /** 创建顺序（features 下标）；标高相同时后创建的在上 */
  order: number;
  /** 只画这段世界坐标折线；缺省画整条 */
  subPoints?: Point[];
  /** 端点短截：与宿主同层，须压在主路下 */
  isTip?: boolean;
};

function isRampRoadFeature(f: MapFeature): boolean {
  return f.kind === 'road' && (f.roadLevel === 'ramp' || isRampFeature(f));
}

/** 折线累计弧长与总长 */
function polylineCumLen(points: Point[]): { cum: number[]; total: number } {
  const cum = [0];
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.y - a.y));
  }
  return { cum, total: cum[cum.length - 1] || 1 };
}

/** 沿折线截取 [s0, s1] 米处的子折线 */
function slicePolylineByArc(
  points: Point[],
  cum: number[],
  s0: number,
  s1: number,
): Point[] {
  const total = cum[cum.length - 1] || 1;
  const a = Math.max(0, Math.min(total, s0));
  const b = Math.max(0, Math.min(total, s1));
  if (b - a < 0.5 || points.length < 2) return [];

  const at = (s: number): Point => {
    for (let i = 0; i < points.length - 1; i++) {
      if (s <= cum[i + 1] + 1e-9) {
        const span = cum[i + 1] - cum[i] || 1;
        const u = (s - cum[i]) / span;
        return {
          x: points[i].x + (points[i + 1].x - points[i].x) * u,
          y: points[i].y + (points[i + 1].y - points[i].y) * u,
        };
      }
    }
    return { ...points[points.length - 1] };
  };

  const out: Point[] = [at(a)];
  for (let i = 1; i < points.length - 1; i++) {
    if (cum[i] > a + 1e-6 && cum[i] < b - 1e-6) out.push({ ...points[i] });
  }
  out.push(at(b));
  return out;
}

/** 从两端截断折线（米）；过短则返回 null */
function trimPolylineEnds(
  points: Point[],
  trimStartM: number,
  trimEndM: number,
): Point[] | null {
  const { cum, total } = polylineCumLen(points);
  const s0 = Math.max(0, trimStartM);
  const s1 = Math.max(0, trimEndM);
  if (total < s0 + s1 + 2) return null;
  const sliced = slicePolylineByArc(points, cum, s0, total - s1);
  return sliced.length >= 2 ? sliced : null;
}

/** 匝道端点短截：与宿主同层绘制，避免中段抬升后整条压在主路上 */
const RAMP_TIP_STUB_M = 14;

/** 端点若挂在主路上，用宿主标高画 tip stub（可压在宿主下，避免 +2 tip 叠在 0 层上） */
function hostGradeAtAttachment(
  tip: Point,
  selfId: string,
  peers: MapFeature[],
): number | null {
  let bestD = Infinity;
  let bestG: number | null = null;
  for (const host of peers) {
    if (host.id === selfId || host.kind !== 'road' || host.points.length < 2) continue;
    // 匝道互挂不算宿主层
    if (isRampRoadFeature(host)) continue;
    for (const p of host.points) {
      const d = dist(tip, p);
      if (d <= ENDPOINT_MERGE_M && d < bestD) {
        bestD = d;
        bestG = featureGrade(host);
      }
    }
    for (let i = 0; i < host.points.length - 1; i++) {
      const on = closestOnSegment(tip, {
        a: host.points[i],
        b: host.points[i + 1],
      });
      if (on.dist <= ENDPOINT_MERGE_M && on.dist < bestD) {
        bestD = on.dist;
        bestG = featureGrade(host);
      }
    }
  }
  return bestG;
}

/**
 * 匝道拆段：
 * 1) 两端 tip stub（宿主标高优先，先于同层主路）
 * 2) 中段按匝道交叉切开（插值标高）
 */
function buildRampDrawPieces(
  feature: MapFeature,
  peers: MapFeature[],
  order: number,
): RoadDrawPiece[] {
  const pts = feature.points;
  if (pts.length < 2) return [];

  const { cum, total } = polylineCumLen(pts);
  const g0 = featureGrade(feature);
  const g1 = featureGradeEnd(feature);
  const tipM = Math.min(RAMP_TIP_STUB_M, total * 0.28);
  // 跨层必拆；同层若两端都挂主路也拆，保证 tip 压在宿主下再开口
  const attachedBoth =
    hostGradeAtAttachment(pts[0], feature.id, peers) != null &&
    hostGradeAtAttachment(pts[pts.length - 1], feature.id, peers) != null;
  const canStub =
    total > tipM * 2.4 && (Math.abs(g0 - g1) > 1e-6 || attachedBoth);

  type Split = { segIndex: number; t: number; point: Point };
  const splits: Split[] = [];

  const consider = (other: MapFeature, self: boolean) => {
    for (let i = 0; i < pts.length - 1; i++) {
      const a1 = pts[i];
      const a2 = pts[i + 1];
      for (let j = 0; j < other.points.length - 1; j++) {
        if (self && Math.abs(i - j) <= 1) continue;
        if (self && j <= i) continue;
        const hit = segmentIntersection(a1, a2, other.points[j], other.points[j + 1]);
        if (!hit) continue;
        splits.push({ segIndex: i, t: hit.t, point: hit.point });
        if (self) splits.push({ segIndex: j, t: hit.u, point: hit.point });
      }
    }
  };

  for (const other of peers) {
    if (!isRampRoadFeature(other)) continue;
    if (other.id === feature.id) consider(other, true);
    else consider(other, false);
  }

  const pathTAt = (p: Point): number => {
    let bestT = 0;
    let bestD = Infinity;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const lenSq = dx * dx + dy * dy || 1;
      const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
      const q = { x: a.x + u * dx, y: a.y + u * dy };
      const d = Math.hypot(p.x - q.x, p.y - q.y);
      if (d < bestD) {
        bestD = d;
        bestT = total > 0 ? (cum[i] + u * (cum[i + 1] - cum[i])) / total : 0;
      }
    }
    return bestT;
  };

  const pieces: RoadDrawPiece[] = [];

  if (canStub) {
    const startStub = slicePolylineByArc(pts, cum, 0, tipM);
    const endStub = slicePolylineByArc(pts, cum, total - tipM, total);
    const startHostG = hostGradeAtAttachment(pts[0], feature.id, peers);
    const endHostG = hostGradeAtAttachment(pts[pts.length - 1], feature.id, peers);
    if (startStub.length >= 2) {
      pieces.push({
        feature,
        grade: startHostG ?? g0,
        order,
        subPoints: startStub,
        isTip: true,
      });
    }
    if (endStub.length >= 2) {
      pieces.push({
        feature,
        grade: endHostG ?? g1,
        order,
        subPoints: endStub,
        isTip: true,
      });
    }
  }

  const midStart = canStub ? tipM : 0;
  const midEnd = canStub ? total - tipM : total;
  let midPts = canStub
    ? slicePolylineByArc(pts, cum, midStart, midEnd)
    : pts.map((p) => ({ ...p }));
  if (midPts.length < 2) {
    return pieces.length
      ? pieces
      : [{ feature, grade: (g0 + g1) / 2, order }];
  }

  if (splits.length > 0) {
    const crossKeys = new Set<string>();
    const withHits: Point[] = [{ ...midPts[0] }];
    for (let i = 0; i < midPts.length - 1; i++) {
      const a = midPts[i];
      const b = midPts[i + 1];
      const onSeg: { u: number; point: Point }[] = [];
      for (const s of splits) {
        const along =
          cum[s.segIndex] + s.t * (cum[s.segIndex + 1] - cum[s.segIndex]);
        if (along <= midStart + 0.5 || along >= midEnd - 0.5) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lenSq = dx * dx + dy * dy || 1;
        const u = ((s.point.x - a.x) * dx + (s.point.y - a.y) * dy) / lenSq;
        if (u <= 0.02 || u >= 0.98) continue;
        const proj = { x: a.x + u * dx, y: a.y + u * dy };
        if (Math.hypot(s.point.x - proj.x, s.point.y - proj.y) < 1.2) {
          onSeg.push({ u, point: { ...s.point } });
          crossKeys.add(
            `${Math.round(s.point.x * 10) / 10},${Math.round(s.point.y * 10) / 10}`,
          );
        }
      }
      onSeg.sort((p, q) => p.u - q.u);
      for (const h of onSeg) {
        const prev = withHits[withHits.length - 1];
        if (Math.hypot(h.point.x - prev.x, h.point.y - prev.y) > 0.4) {
          withHits.push(h.point);
        }
      }
      const prev = withHits[withHits.length - 1];
      if (Math.hypot(b.x - prev.x, b.y - prev.y) > 0.4) withHits.push({ ...b });
    }
    midPts = withHits;

    const isCross = (p: Point) =>
      crossKeys.has(`${Math.round(p.x * 10) / 10},${Math.round(p.y * 10) / 10}`);

    let cur: Point[] = [midPts[0]];
    for (let i = 1; i < midPts.length; i++) {
      cur.push(midPts[i]);
      if (i < midPts.length - 1 && isCross(midPts[i]) && cur.length >= 2) {
        const mid = cur[Math.floor(cur.length / 2)];
        pieces.push({
          feature,
          grade: gradeAtPathT(feature, pathTAt(mid)),
          order,
          subPoints: cur,
        });
        cur = [midPts[i]];
      }
    }
    if (cur.length >= 2) {
      const mid = cur[Math.floor(cur.length / 2)];
      pieces.push({
        feature,
        grade: gradeAtPathT(feature, pathTAt(mid)),
        order,
        subPoints: cur,
      });
    }
  } else if (canStub) {
    const mid = midPts[Math.floor(midPts.length / 2)];
    pieces.push({
      feature,
      grade: gradeAtPathT(feature, pathTAt(mid)),
      order,
      subPoints: midPts,
    });
  } else {
    pieces.push({ feature, grade: (g0 + g1) / 2, order });
  }

  return pieces.length ? pieces : [{ feature, grade: (g0 + g1) / 2, order }];
}

/**
 * 沿汇入方向撕开宿主侧路缘（destination-out）。
 * 只清 tip 宽度的一条缝，不沿主路拉矩形 → 无补丁。
 * 须在主路 casing 之后、fill 之前。
 */
function openHostMouthAlongApproach(
  ctx: CanvasRenderingContext2D,
  mouths: JoinMouth[],
  band: number,
  viewport: Viewport,
  style: MapStyle,
) {
  const z = viewport.zoom;
  const casingExtra = style === 'sketch' ? Math.max(1.5, 1.8 * z) : 2 * z;
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  for (const m of mouths) {
    if (Math.floor(m.grade + 1e-9) !== band) continue;
    const p = toScreen(m.point, viewport);
    const hostBodyW = Math.max(2, m.hostWidth * z);
    const tipCasingW = Math.max(2, m.tipWidth * z) + casingExtra;
    const tipFillW = Math.max(2, m.tipWidth * z);
    // approach：路内 → tip；汇入从 tip 外侧扫向宿主中心
    const ax = m.approachX;
    const ay = m.approachY;
    const outer = hostBodyW * 0.5 + casingExtra + tipFillW * 0.15;
    const inner = Math.max(0, hostBodyW * 0.12);

    ctx.beginPath();
    ctx.moveTo(p.x - ax * outer, p.y - ay * outer);
    ctx.lineTo(p.x - ax * inner, p.y - ay * inner);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = tipCasingW + 1;
    ctx.lineCap = 'butt';
    ctx.lineJoin = 'miter';
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * tip → 宿主色渐变（匝道出入口 / 丁字尽头异色汇入）。
 * 仅 tip 路宽，不做加宽涂抹。
 */
function drawJoinBlends(
  ctx: CanvasRenderingContext2D,
  mouths: JoinMouth[],
  band: number,
  viewport: Viewport,
  style: MapStyle,
) {
  if (style === 'blueprint') return;
  const z = viewport.zoom;
  const fillScale = style === 'sketch' ? 0.72 : 1;
  for (const m of mouths) {
    if (Math.floor(m.grade + 1e-9) !== band) continue;
    if (m.tipColor === m.hostColor) continue;

    const p = toScreen(m.point, viewport);
    let hostFill = m.hostColor;
    let tipFill = m.tipColor;
    if (style === 'sketch') {
      hostFill = sketchRoadFill(m.hostColor);
      tipFill = sketchRoadFill(m.tipColor);
    }
    const tipFillW = Math.max(2, m.tipWidth * z * fillScale);
    const halfHost = (m.hostWidth * 0.5) * z;
    const ax = m.approachX;
    const ay = m.approachY;
    // 从宿主路缘外缘内侧 → 中心：tip 色淡入宿主色
    const a = {
      x: p.x - ax * (halfHost + tipFillW * 0.85),
      y: p.y - ay * (halfHost + tipFillW * 0.85),
    };
    const b = {
      x: p.x - ax * (tipFillW * 0.05),
      y: p.y - ay * (tipFillW * 0.05),
    };
    const g = ctx.createLinearGradient(a.x, a.y, b.x, b.y);
    g.addColorStop(0, tipFill);
    g.addColorStop(0.45, lerpColor(tipFill, hostFill, 0.35));
    g.addColorStop(1, hostFill);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = g;
    ctx.lineWidth = tipFillW;
    ctx.lineCap = 'butt';
    ctx.stroke();
  }
}

/** 同层：tip stub → 匝道 → 主路；tip 截路缘；汇入口撕侧边 + tip→宿主渐变 */
function drawRoadsMerged(
  ctx: CanvasRenderingContext2D,
  roads: MapFeature[],
  viewport: Viewport,
  style: MapStyle,
  terrain: TerrainGrid | null,
  rivers: MapFeature[],
) {
  const joinedCaps = collectJoinedCaps(roads);
  const casingTrim = collectCasingTrimM(roads);
  const mouths = collectJoinMouths(roads);
  const pieces: RoadDrawPiece[] = [];
  const orderOf = new Map(roads.map((f, i) => [f.id, i]));

  for (const feature of roads) {
    const order = orderOf.get(feature.id) ?? 0;
    if (isRampRoadFeature(feature)) {
      pieces.push(...buildRampDrawPieces(feature, roads, order));
    } else {
      pieces.push({
        feature,
        grade: featureGrade(feature),
        order,
      });
    }
  }

  pieces.sort((a, b) => {
    const bandA = Math.floor(a.grade + 1e-9);
    const bandB = Math.floor(b.grade + 1e-9);
    if (bandA !== bandB) return bandA - bandB;
    const tipA = a.isTip ? 0 : 1;
    const tipB = b.isTip ? 0 : 1;
    if (tipA !== tipB) return tipA - tipB;
    const rampA = isRampRoadFeature(a.feature) ? 0 : 1;
    const rampB = isRampRoadFeature(b.feature) ? 0 : 1;
    if (rampA !== rampB) return rampA - rampB;
    if (Math.abs(a.grade - b.grade) > 1e-5) return a.grade - b.grade;
    const classOf = (f: MapFeature) => {
      if (f.roadLevel === 'ramp') return rampSolidClass(f) ?? 'local';
      return normalizeRoadClass(f.roadLevel);
    };
    const ra = ROAD_CLASS_RANK[classOf(a.feature)];
    const rb = ROAD_CLASS_RANK[classOf(b.feature)];
    if (ra !== rb) return ra - rb;
    if (a.order !== b.order) return a.order - b.order;
    return a.feature.id.localeCompare(b.feature.id);
  });

  const gradeBand = (g: number) => Math.floor(g + 1e-9);
  let i = 0;
  while (i < pieces.length) {
    const band = gradeBand(pieces[i].grade);
    let j = i + 1;
    while (j < pieces.length && gradeBand(pieces[j].grade) === band) j++;
    const batch = pieces.slice(i, j);

    const tips = batch.filter((p) => p.isTip);
    const ramps = batch.filter(
      (p) => !p.isTip && isRampRoadFeature(p.feature),
    );
    const mains = batch.filter(
      (p) => !p.isTip && !isRampRoadFeature(p.feature),
    );

    for (const piece of tips) {
      drawRoadCasing(
        ctx,
        piece.feature,
        viewport,
        style,
        joinedCaps,
        casingTrim,
        piece.subPoints,
      );
      drawRoadFill(
        ctx,
        piece.feature,
        viewport,
        style,
        joinedCaps,
        casingTrim,
        piece.subPoints,
      );
    }
    for (const piece of ramps) {
      drawRoadCasing(
        ctx,
        piece.feature,
        viewport,
        style,
        joinedCaps,
        casingTrim,
        piece.subPoints,
      );
      drawRoadFill(
        ctx,
        piece.feature,
        viewport,
        style,
        joinedCaps,
        casingTrim,
        piece.subPoints,
      );
    }
    for (const piece of mains) {
      drawRoadCasing(
        ctx,
        piece.feature,
        viewport,
        style,
        joinedCaps,
        casingTrim,
        piece.subPoints,
      );
    }
    // 沿汇入方向撕开宿主侧路缘（tip 宽缝，无沿主路补丁）
    openHostMouthAlongApproach(ctx, mouths, band, viewport, style);
    for (const piece of mains) {
      drawRoadFill(
        ctx,
        piece.feature,
        viewport,
        style,
        joinedCaps,
        casingTrim,
        piece.subPoints,
      );
    }
    drawJoinBlends(ctx, mouths, band, viewport, style);
    i = j;
  }

  if (terrain || rivers.length > 0) {
    const spansByGrade: { feature: MapFeature; span: WaterSpan }[] = [];
    for (const feature of roads) {
      for (const span of findWaterSpans(feature, terrain, rivers)) {
        spansByGrade.push({ feature, span });
      }
    }
    spansByGrade.sort((a, b) => a.span.grade - b.span.grade);
    for (const { feature, span } of spansByGrade) {
      drawWaterCrossing(ctx, feature, span, viewport, style);
    }
  }
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = parseColor(a);
  const pb = parseColor(b);
  if (!pa || !pb) return t < 0.5 ? a : b;
  const u = Math.max(0, Math.min(1, t));
  const r = Math.round(pa.r + (pb.r - pa.r) * u);
  const g = Math.round(pa.g + (pb.g - pa.g) * u);
  const bl = Math.round(pa.b + (pb.b - pa.b) * u);
  return `rgb(${r},${g},${bl})`;
}

function parseColor(c: string): { r: number; g: number; b: number } | null {
  if (c.startsWith('#') && (c.length === 7 || c.length === 4)) {
    if (c.length === 4) {
      return {
        r: parseInt(c[1] + c[1], 16),
        g: parseInt(c[2] + c[2], 16),
        b: parseInt(c[3] + c[3], 16),
      };
    }
    return {
      r: parseInt(c.slice(1, 3), 16),
      g: parseInt(c.slice(3, 5), 16),
      b: parseInt(c.slice(5, 7), 16),
    };
  }
  const m = c.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
  if (!m) return null;
  return { r: Number(m[1]), g: Number(m[2]), b: Number(m[3]) };
}

/** 过河标记：浅细边线 + 岸口括号；桥=实线，隧=虚线。不加重描边/阴影 */
function drawWaterCrossing(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  span: WaterSpan,
  viewport: Viewport,
  style: MapStyle,
) {
  const screen = span.points.map((p) => toScreen(p, viewport));
  if (screen.length < 2) return;

  const level = (feature.roadLevel ?? 'local') as RoadLevel;
  const bodyStyle =
    ROAD_STYLES[level === 'ramp' ? 'ramp' : normalizeRoadClass(level)];
  const baseW = bodyStyle.width * viewport.zoom;
  const isBridge = span.grade >= 0;
  const halfW = baseW / 2;
  const zoom = viewport.zoom;

  // 比路缘更浅更细
  const ink =
    style === 'blueprint'
      ? 'rgba(120, 170, 210, 0.7)'
      : style === 'sketch'
        ? 'rgba(60, 60, 60, 0.45)'
        : 'rgba(90, 78, 68, 0.5)';
  const edgeW = Math.max(0.7, 0.85 * zoom);
  const portalW = Math.max(0.85, 1 * zoom);

  const leftRail = offsetPolyline(screen, halfW);
  const rightRail = offsetPolyline(screen, -halfW);

  ctx.save();
  ctx.strokeStyle = ink;
  ctx.lineWidth = edgeW;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'butt';
  if (isBridge) {
    ctx.setLineDash([]);
  } else {
    const dash = Math.max(3.5, 4.5 * zoom);
    ctx.setLineDash([dash, dash * 0.85]);
  }
  strokePolyline(ctx, leftRail);
  strokePolyline(ctx, rightRail);
  ctx.setLineDash([]);

  const n = screen.length;
  const entryH = Math.atan2(screen[1].y - screen[0].y, screen[1].x - screen[0].x);
  const exitH = Math.atan2(
    screen[n - 1].y - screen[n - 2].y,
    screen[n - 1].x - screen[n - 2].x,
  );
  drawCrossingPortal(ctx, screen[0], entryH, halfW, zoom, ink, portalW, -1);
  drawCrossingPortal(ctx, screen[n - 1], exitH, halfW, zoom, ink, portalW, 1);
  ctx.restore();
}

function strokePolyline(ctx: CanvasRenderingContext2D, pts: Point[]) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.stroke();
}

/** 沿路径法向偏移（左侧为正） */
function offsetPolyline(pts: Point[], dist: number): Point[] {
  if (pts.length < 2) return pts.map((p) => ({ ...p }));
  const out: Point[] = [];
  for (let i = 0; i < pts.length; i++) {
    let tx: number;
    let ty: number;
    if (i === 0) {
      tx = pts[1].x - pts[0].x;
      ty = pts[1].y - pts[0].y;
    } else if (i === pts.length - 1) {
      tx = pts[i].x - pts[i - 1].x;
      ty = pts[i].y - pts[i - 1].y;
    } else {
      tx = pts[i + 1].x - pts[i - 1].x;
      ty = pts[i + 1].y - pts[i - 1].y;
    }
    const len = Math.hypot(tx, ty) || 1;
    const nx = -ty / len;
    const ny = tx / len;
    out.push({ x: pts[i].x + nx * dist, y: pts[i].y + ny * dist });
  }
  return out;
}

/**
 * 岸口括号：左右各一道「」形，关于路中心轴镜像，开口朝陆地。
 * landSign: -1 入口，+1 出口。
 */
function drawCrossingPortal(
  ctx: CanvasRenderingContext2D,
  center: Point,
  heading: number,
  halfW: number,
  zoom: number,
  color: string,
  lineW: number,
  landSign: -1 | 1,
) {
  const nx = -Math.sin(heading);
  const ny = Math.cos(heading);
  const lx = Math.cos(heading) * landSign;
  const ly = Math.sin(heading) * landSign;
  const depth = Math.max(2.2, 2.8 * zoom);
  const flare = Math.max(1.6, 2 * zoom);

  ctx.strokeStyle = color;
  ctx.lineWidth = lineW;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.setLineDash([]);

  for (const side of [-1, 1] as const) {
    // 路缘交点
    const edge = {
      x: center.x + nx * halfW * side,
      y: center.y + ny * halfW * side,
    };
    // 朝陆再略外撇，形成对称括号
    const mid = {
      x: edge.x + lx * depth,
      y: edge.y + ly * depth,
    };
    const tip = {
      x: mid.x + nx * flare * side,
      y: mid.y + ny * flare * side,
    };
    ctx.beginPath();
    ctx.moveTo(edge.x, edge.y);
    ctx.lineTo(mid.x, mid.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
  }
}

type StylePalette = {
  outside: string;
  land: string;
  water: string;
  waterStroke: string;
  mountain: string;
  mountainStroke: string;
  border: string;
  grid: string;
  preview: string;
  previewFill: string;
  scaleBar: string;
  scaleText: string;
  blockFill: string;
  blockStroke: string;
  railway: string;
  label: string;
  labelHalo: string;
};

const PALETTES: Record<MapStyle, StylePalette> = {
  navigation: {
    outside: '#e7e5e4',
    land: '#f2efe9',
    water: '#aad3df',
    waterStroke: '#7eb8c9',
    mountain: '#add19e',
    mountainStroke: '#8fbc7a',
    border: '#888880',
    grid: 'rgba(0,0,0,0.05)',
    preview: 'rgba(60,100,200,0.8)',
    previewFill: 'rgba(60,100,200,0.15)',
    scaleBar: '#333',
    scaleText: '#555',
    blockFill: 'rgba(236, 236, 232, 0.55)',
    blockStroke: 'rgba(180, 180, 170, 0.45)',
    railway: '#2a2a2a',
    label: '#1f2937',
    labelHalo: 'rgba(255,255,255,0.85)',
  },
  blueprint: {
    outside: '#0f2035',
    land: '#1a3a5c',
    water: 'rgba(80,160,255,0.35)',
    waterStroke: '#6eb5ff',
    mountain: 'rgba(100,200,100,0.25)',
    mountainStroke: '#7fd67f',
    border: '#6eb5ff',
    grid: 'rgba(255,255,255,0.07)',
    preview: 'rgba(120,200,255,0.9)',
    previewFill: 'rgba(120,200,255,0.12)',
    scaleBar: '#8ec5ff',
    scaleText: '#a8d4ff',
    blockFill: 'rgba(40, 70, 100, 0.55)',
    blockStroke: 'rgba(110, 180, 255, 0.35)',
    railway: '#c8e0ff',
    label: '#e8f4ff',
    labelHalo: 'rgba(10,30,50,0.7)',
  },
  sketch: {
    outside: '#eee',
    land: '#fffef9',
    water: 'rgba(170, 211, 223, 0.55)',
    waterStroke: '#4a90c4',
    mountain: 'rgba(173, 209, 158, 0.55)',
    mountainStroke: '#6a9e5a',
    border: '#999',
    grid: 'rgba(0,0,0,0.04)',
    preview: 'rgba(80,80,80,0.7)',
    previewFill: 'rgba(80,80,80,0.08)',
    scaleBar: '#666',
    scaleText: '#666',
    blockFill: 'rgba(245, 245, 240, 0.9)',
    blockStroke: 'rgba(160, 160, 150, 0.45)',
    railway: '#333',
    label: '#333',
    labelHalo: 'rgba(255,255,255,0.9)',
  },
};

function toScreen(p: Point, viewport: Viewport): Point {
  return {
    x: p.x * viewport.zoom + viewport.x,
    y: p.y * viewport.zoom + viewport.y,
  };
}

function tracePath(ctx: CanvasRenderingContext2D, points: Point[], closed: boolean) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) ctx.lineTo(points[i].x, points[i].y);
  if (closed) ctx.closePath();
}

function drawTerrainGrid(
  ctx: CanvasRenderingContext2D,
  grid: TerrainGrid,
  _project: CityProject,
  viewport: Viewport,
  palette: StylePalette,
  quality: TerrainPaintQuality = 'final',
) {
  const { cols, rows, cellSizeM } = grid;
  const bitmap = getTerrainBitmap(grid, palette.water, palette.mountain, quality);
  const tl = toScreen({ x: 0, y: 0 }, viewport);
  const br = toScreen(
    { x: cols * cellSizeM, y: rows * cellSizeM },
    viewport,
  );
  const dw = br.x - tl.x;
  const dh = br.y - tl.y;
  // 仅在缩小到屏幕时平滑；放大用邻近采样，避免毛玻璃
  const downscaling = dw < bitmap.width * 0.98 || dh < bitmap.height * 0.98;
  ctx.imageSmoothingEnabled = downscaling && quality === 'final';
  if (ctx.imageSmoothingEnabled) ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, tl.x, tl.y, dw, dh);
}

function drawMapBase(
  ctx: CanvasRenderingContext2D,
  project: CityProject,
  viewport: Viewport,
  palette: StylePalette,
  terrainQuality: TerrainPaintQuality = 'final',
) {
  const { widthM, heightM } = project.settings;
  const tl = toScreen({ x: 0, y: 0 }, viewport);
  const br = toScreen({ x: widthM, y: heightM }, viewport);
  const w = br.x - tl.x;
  const h = br.y - tl.y;

  ctx.fillStyle = palette.outside;
  ctx.fillRect(tl.x, tl.y, w, h);

  ctx.fillStyle = palette.land;
  ctx.fillRect(tl.x, tl.y, w, h);

  if (getLayers(project).terrain !== false) {
    const terrain = ensureTerrain(project.settings, project.terrain);
    drawTerrainGrid(ctx, terrain, project, viewport, palette, terrainQuality);
  }

  ctx.strokeStyle = palette.border;
  ctx.lineWidth = 2;
  ctx.strokeRect(tl.x + 0.5, tl.y + 0.5, w - 1, h - 1);
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  project: CityProject,
  viewport: Viewport,
  palette: StylePalette,
) {
  const { widthM, heightM, scale } = project.settings;
  const gridM = scale >= 10000 ? 1000 : scale >= 5000 ? 500 : 200;
  const stepPx = gridM * viewport.zoom;
  if (stepPx < 24) return;

  const tl = toScreen({ x: 0, y: 0 }, viewport);
  const br = toScreen({ x: widthM, y: heightM }, viewport);

  ctx.save();
  ctx.beginPath();
  ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.clip();

  ctx.strokeStyle = palette.grid;
  ctx.lineWidth = 1;

  for (let x = 0; x <= widthM; x += gridM) {
    const sx = toScreen({ x, y: 0 }, viewport).x;
    ctx.beginPath();
    ctx.moveTo(sx, tl.y);
    ctx.lineTo(sx, br.y);
    ctx.stroke();
  }
  for (let y = 0; y <= heightM; y += gridM) {
    const sy = toScreen({ x: 0, y }, viewport).y;
    ctx.beginPath();
    ctx.moveTo(tl.x, sy);
    ctx.lineTo(br.x, sy);
    ctx.stroke();
  }
  ctx.restore();
}

function drawBlocks(
  ctx: CanvasRenderingContext2D,
  blocks: CityBlock[],
  viewport: Viewport,
  palette: StylePalette,
) {
  for (const block of blocks) {
    const pts = block.points.map((p) => toScreen(p, viewport));
    if (pts.length < 3) continue;
    tracePath(ctx, pts, true);
    ctx.fillStyle = palette.blockFill;
    ctx.fill();
    ctx.strokeStyle = palette.blockStroke;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

function drawRiver(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  viewport: Viewport,
  palette: StylePalette,
) {
  const points = feature.points.map((p) => toScreen(p, viewport));
  if (points.length < 2) return;

  tracePath(ctx, points, feature.closed);
  ctx.strokeStyle = palette.waterStroke;
  ctx.lineWidth = Math.max(2, 3 * viewport.zoom);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

/**
 * 首尾 cap 可能不同：任一端已接合则整段 butt，再在自由端补圆盘。
 */
function strokeCapsForFeature(
  feature: MapFeature,
  joinedCaps: Set<string>,
): { strokeCap: CanvasLineCap; freeEnds: Point[] } {
  const startJoined = joinedCaps.has(`${feature.id}|start`);
  const endJoined = joinedCaps.has(`${feature.id}|end`);
  if (!startJoined && !endJoined) {
    return { strokeCap: 'round', freeEnds: [] };
  }
  if (startJoined && endJoined) {
    return { strokeCap: 'butt', freeEnds: [] };
  }
  const freeEnds: Point[] = [];
  if (!startJoined) freeEnds.push(feature.points[0]);
  if (!endJoined) freeEnds.push(feature.points[feature.points.length - 1]);
  return { strokeCap: 'butt', freeEnds };
}

function drawFreeEndCaps(
  ctx: CanvasRenderingContext2D,
  freeEnds: Point[],
  viewport: Viewport,
  radius: number,
  color: string,
) {
  if (freeEnds.length === 0) return;
  ctx.fillStyle = color;
  for (const p of freeEnds) {
    const s = toScreen(p, viewport);
    ctx.beginPath();
    ctx.arc(s.x, s.y, radius / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

function sketchRoadInk(casing: string): string {
  // 线稿统一用深色轮廓，避免白/浅黄路缘在浅底上消失
  const p = parseColor(casing);
  if (!p) return '#3a3a3a';
  const lum = (p.r * 299 + p.g * 587 + p.b * 114) / 1000;
  if (lum > 140) return '#3a3a3a';
  return casing;
}

function sketchRoadFill(color: string): string {
  const p = parseColor(color);
  if (!p) return '#fafaf8';
  // 保留一点等级色相，但压亮，主要靠深色轮廓认路
  return `rgb(${Math.round(p.r * 0.15 + 240)},${Math.round(p.g * 0.15 + 240)},${Math.round(p.b * 0.15 + 240)})`;
}

/** 路缘：汇入端按宿主半宽截断，边线在主路边开口，不封死路口 */
function drawRoadCasing(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  viewport: Viewport,
  style: MapStyle,
  joinedCaps: Set<string>,
  casingTrim: Map<string, number>,
  subPoints?: Point[],
) {
  const level = (feature.roadLevel ?? 'local') as RoadLevel;
  const isRamp = level === 'ramp';
  const solid = isRamp ? rampSolidClass(feature) : normalizeRoadClass(level);
  const blend = isLevelBlendRoad(feature);
  const fromLevel = (feature.roadLevelFrom ?? solid ?? 'local') as RoadLevel;
  const levelEnd = (feature.roadLevelEnd ?? fromLevel) as RoadLevel;
  const bodyStyle = ROAD_STYLES[isRamp ? 'ramp' : (solid ?? 'local')];
  const colorStyle = ROAD_STYLES[solid ?? 'ramp'];
  const fromStyle = ROAD_STYLES[normalizeRoadClass(fromLevel)];
  const endStyle = ROAD_STYLES[normalizeRoadClass(levelEnd)];

  let world = subPoints && subPoints.length >= 2 ? subPoints : feature.points;
  if (world.length < 2) return;

  const tipEps = 0.75;
  const startsAtTip =
    Math.hypot(world[0].x - feature.points[0].x, world[0].y - feature.points[0].y) <
    tipEps;
  const endsAtTip =
    Math.hypot(
      world[world.length - 1].x - feature.points[feature.points.length - 1].x,
      world[world.length - 1].y - feature.points[feature.points.length - 1].y,
    ) < tipEps;

  // 整条路端点接合：路缘在宿主半宽处截断 → 边线开口
  let trimStart = 0;
  let trimEnd = 0;
  if (startsAtTip) trimStart = casingTrim.get(`${feature.id}|start`) ?? 0;
  if (endsAtTip) trimEnd = casingTrim.get(`${feature.id}|end`) ?? 0;
  if (trimStart > 0 || trimEnd > 0) {
    const trimmed = trimPolylineEnds(world, trimStart, trimEnd);
    if (!trimmed) return; // 过短：不画封死的路缘 stub
    world = trimmed;
  }

  const points = world.map((p) => toScreen(p, viewport));
  if (points.length < 2) return;

  const width = bodyStyle.width * viewport.zoom;
  const casingExtra = style === 'sketch' ? Math.max(1.5, 1.8 * viewport.zoom) : 2 * viewport.zoom;
  const casingW = width + casingExtra;
  const { strokeCap, freeEnds } = strokeCapsForFeature(feature, joinedCaps);
  const casing0 =
    style === 'sketch' ? sketchRoadInk(fromStyle.casing) : fromStyle.casing;
  const casing1 =
    style === 'sketch' ? sketchRoadInk(endStyle.casing) : endStyle.casing;
  const casingMid = blend
    ? lerpColor(casing0, casing1, 0.5)
    : style === 'sketch'
      ? sketchRoadInk(colorStyle.casing)
      : colorStyle.casing;

  const splitInterior = Boolean(subPoints) && !(startsAtTip && endsAtTip);
  // 截断后的汇入端一律 butt，避免圆帽又把口封上
  const opened = trimStart > 0 || trimEnd > 0;
  const cap: CanvasLineCap = opened || splitInterior
    ? startsAtTip || endsAtTip || opened
      ? opened
        ? 'butt'
        : strokeCap
      : 'butt'
    : strokeCap;

  if (blend) {
    const g = ctx.createLinearGradient(
      points[0].x,
      points[0].y,
      points[points.length - 1].x,
      points[points.length - 1].y,
    );
    g.addColorStop(0, casing0);
    g.addColorStop(1, casing1);
    ctx.strokeStyle = g;
  } else {
    ctx.strokeStyle = casingMid;
  }
  tracePath(ctx, points, false);
  ctx.lineWidth = casingW;
  ctx.lineJoin = 'round';
  ctx.lineCap = cap;
  ctx.stroke();

  // 已开口的端不补自由端圆盘
  const tips: Point[] = [];
  if (
    startsAtTip &&
    trimStart <= 0 &&
    freeEnds.includes(feature.points[0])
  ) {
    tips.push(feature.points[0]);
  }
  if (
    endsAtTip &&
    trimEnd <= 0 &&
    freeEnds.includes(feature.points[feature.points.length - 1])
  ) {
    tips.push(feature.points[feature.points.length - 1]);
  }
  if (tips.length) drawFreeEndCaps(ctx, tips, viewport, casingW, casingMid);
}

function drawRoadFill(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  viewport: Viewport,
  style: MapStyle,
  joinedCaps: Set<string>,
  _casingTrim: Map<string, number>,
  subPoints?: Point[],
) {
  const level = (feature.roadLevel ?? 'local') as RoadLevel;
  const isRamp = level === 'ramp';
  const solid = isRamp ? rampSolidClass(feature) : normalizeRoadClass(level);
  const blend = isLevelBlendRoad(feature);
  const fromLevel = (feature.roadLevelFrom ?? solid ?? 'local') as RoadLevel;
  const levelEnd = (feature.roadLevelEnd ?? fromLevel) as RoadLevel;
  const bodyStyle = ROAD_STYLES[isRamp ? 'ramp' : (solid ?? 'local')];
  const colorStyle = ROAD_STYLES[solid ?? 'ramp'];
  const fromStyle = ROAD_STYLES[normalizeRoadClass(fromLevel)];
  const endStyle = ROAD_STYLES[normalizeRoadClass(levelEnd)];

  let world = subPoints && subPoints.length >= 2 ? subPoints : feature.points;
  if (world.length < 2) return;

  const tipEps = 0.75;
  const startsAtTip =
    Math.hypot(world[0].x - feature.points[0].x, world[0].y - feature.points[0].y) <
    tipEps;
  const endsAtTip =
    Math.hypot(
      world[world.length - 1].x - feature.points[feature.points.length - 1].x,
      world[world.length - 1].y - feature.points[feature.points.length - 1].y,
    ) < tipEps;
  // 路面不截断：画到中心线，由宿主路面盖住；只有路缘截断开口
  const joinedStart = startsAtTip && joinedCaps.has(`${feature.id}|start`);
  const joinedEnd = endsAtTip && joinedCaps.has(`${feature.id}|end`);

  const points = world.map((p) => toScreen(p, viewport));
  if (points.length < 2) return;

  const width = bodyStyle.width * viewport.zoom;
  const fillScale = style === 'sketch' ? 0.72 : 1;
  const baseFillW = width * fillScale;
  let fillColor = style === 'blueprint' ? '#e8f4ff' : fromStyle.color;
  let endColor = style === 'blueprint' ? '#e8f4ff' : endStyle.color;
  if (style === 'sketch') {
    fillColor = sketchRoadFill(fromStyle.color);
    endColor = sketchRoadFill(endStyle.color);
  }
  if (isRamp && !blend) {
    fillColor = style === 'blueprint' ? '#e8f4ff' : colorStyle.color;
    if (style === 'sketch') fillColor = sketchRoadFill(colorStyle.color);
    endColor = fillColor;
  } else if (!blend && !isRamp) {
    fillColor = style === 'blueprint' ? '#e8f4ff' : bodyStyle.color;
    if (style === 'sketch') fillColor = sketchRoadFill(bodyStyle.color);
  }
  const { strokeCap, freeEnds } = strokeCapsForFeature(feature, joinedCaps);
  const midFill = blend ? lerpColor(fillColor, endColor, 0.5) : fillColor;

  const splitInterior = Boolean(subPoints) && !(startsAtTip && endsAtTip);
  const opened = joinedStart || joinedEnd;
  const cap: CanvasLineCap = opened
    ? 'butt'
    : splitInterior
      ? startsAtTip || endsAtTip
        ? strokeCap
        : 'butt'
      : strokeCap;

  if (blend && style !== 'blueprint') {
    const g = ctx.createLinearGradient(
      points[0].x,
      points[0].y,
      points[points.length - 1].x,
      points[points.length - 1].y,
    );
    g.addColorStop(0, fillColor);
    g.addColorStop(1, endColor);
    ctx.strokeStyle = g;
  } else {
    ctx.strokeStyle = style === 'blueprint' ? '#e8f4ff' : midFill;
  }
  tracePath(ctx, points, false);
  ctx.lineWidth = baseFillW;
  ctx.lineJoin = 'round';
  ctx.lineCap = cap;
  ctx.stroke();

  const tips: Point[] = [];
  if (startsAtTip && freeEnds.includes(feature.points[0])) tips.push(feature.points[0]);
  if (
    endsAtTip &&
    freeEnds.includes(feature.points[feature.points.length - 1])
  ) {
    tips.push(feature.points[feature.points.length - 1]);
  }
  if (tips.length) drawFreeEndCaps(ctx, tips, viewport, baseFillW, midFill);
}

function drawJunctionNodes(
  ctx: CanvasRenderingContext2D,
  features: MapFeature[],
  viewport: Viewport,
  style: MapStyle,
) {
  const mouths = collectJoinMouths(features.filter((f) => f.kind === 'road'));
  const hideNearMouth = (pt: { x: number; y: number }) =>
    mouths.some(
      (m) =>
        Math.hypot(m.point.x - pt.x, m.point.y - pt.y) <= ENDPOINT_MERGE_M,
    );

  const nodes = collectJunctionNodes(features);
  for (const node of nodes) {
    // 匝道/支路汇入点不当「路口节点」画出来
    if (hideNearMouth(node.point)) continue;
    const p = toScreen(node.point, viewport);
    const r = Math.max(1.4, 1.6 * viewport.zoom);
    ctx.beginPath();
    ctx.arc(p.x, p.y, r + 0.7 * viewport.zoom, 0, Math.PI * 2);
    ctx.fillStyle = style === 'blueprint' ? '#0b1e33' : '#9a9a9a';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
    ctx.fillStyle = style === 'blueprint' ? '#e8f4ff' : '#ffffff';
    ctx.fill();
  }
}

function drawRailway(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  viewport: Viewport,
  _palette: StylePalette,
) {
  const points = feature.points.map((p) => toScreen(p, viewport));
  if (points.length < 2) return;

  const kind = feature.railKind ?? 'railway';
  const style = RAIL_STYLES[kind];
  const color =
    (kind === 'metro' || kind === 'tram') && feature.metroColor
      ? feature.metroColor
      : style.color;
  const w = Math.max(2, style.width * viewport.zoom);

  tracePath(ctx, points, false);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.setLineDash([]);
  ctx.stroke();

  // 普铁 / 高铁：白虚线轨枕感；地铁/有轨为彩色实线
  if (style.stripe && style.dash) {
    const dash = style.dash.map((d) => Math.max(2, d * viewport.zoom));
    ctx.setLineDash(dash);
    ctx.strokeStyle = style.stripe;
    ctx.lineWidth = Math.max(1, w * 0.45);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // 有线路名时在中点旁画小标签（缩放过小则跳过）
  const name = feature.lineName?.trim();
  if (name && (kind === 'metro' || kind === 'tram') && viewport.zoom >= 0.35) {
    const mid = points[Math.floor(points.length / 2)];
    const fontSize = Math.max(9, Math.min(14, 11 * Math.sqrt(viewport.zoom)));
    ctx.font = `600 ${fontSize}px "PingFang SC", "Helvetica Neue", sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    const pad = 3;
    const tw = ctx.measureText(name).width;
    const bx = mid.x + w * 0.7;
    const by = mid.y - fontSize * 0.9;
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.fillRect(bx - pad, by - fontSize * 0.55, tw + pad * 2, fontSize * 1.15);
    ctx.fillStyle = color;
    ctx.fillText(name, bx, by);
  }
}

function drawStation(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  viewport: Viewport,
) {
  if (!feature.points[0]) return;
  const p = toScreen(feature.points[0], viewport);
  const style = feature.stationStyle ?? 'pill';
  const color = featureLineColor(feature) ?? DEFAULT_METRO_COLOR;
  const z = viewport.zoom;
  const heading = feature.stationHeading ?? 0;

  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(heading);

  if (style === 'dot') {
    const r = Math.max(3.5, 4.2 * z);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.lineWidth = Math.max(1.2, 1.5 * z);
    ctx.strokeStyle = '#fff';
    ctx.stroke();
  } else {
    // 地铁站：白底黑边圆
    const r = Math.max(4.2, 5 * z);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.lineWidth = Math.max(1.6, 1.9 * z);
    ctx.strokeStyle = '#111';
    ctx.stroke();
  }

  ctx.restore();

  const name = feature.labelText?.trim();
  if (name && viewport.zoom >= 0.4) {
    const fontSize = Math.max(9, Math.min(13, 10 * Math.sqrt(z)));
    ctx.font = `500 ${fontSize}px "PingFang SC", "Helvetica Neue", sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = 'rgba(255,255,255,0.9)';
    ctx.strokeText(name, p.x, p.y + Math.max(8, 9 * z));
    ctx.fillStyle = '#222';
    ctx.fillText(name, p.x, p.y + Math.max(8, 9 * z));
  }
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  viewport: Viewport,
  palette: StylePalette,
) {
  if (feature.points.length === 0) return;
  const text = feature.labelText?.trim() || '标注';
  const p = toScreen(feature.points[0], viewport);
  const fontSize = Math.max(11, Math.min(22, 14 * Math.sqrt(viewport.zoom)));

  ctx.font = `600 ${fontSize}px "PingFang SC", "Helvetica Neue", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.lineWidth = 3;
  ctx.strokeStyle = palette.labelHalo;
  ctx.strokeText(text, p.x, p.y);
  ctx.fillStyle = palette.label;
  ctx.fillText(text, p.x, p.y);

  // 小圆点锚点
  ctx.beginPath();
  ctx.arc(p.x, p.y + fontSize * 0.85, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = palette.label;
  ctx.fill();
}

function drawPreviewRect(
  ctx: CanvasRenderingContext2D,
  a: Point,
  b: Point,
  viewport: Viewport,
  palette: StylePalette,
) {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x, b.x);
  const y2 = Math.max(a.y, b.y);
  const tl = toScreen({ x: x1, y: y1 }, viewport);
  const br = toScreen({ x: x2, y: y2 }, viewport);

  ctx.fillStyle = palette.previewFill;
  ctx.fillRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.strokeStyle = palette.preview;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 4]);
  ctx.strokeRect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.setLineDash([]);
}

function drawPreviewRegion(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  closed: boolean,
  viewport: Viewport,
  palette: StylePalette,
) {
  if (points.length === 0) return;
  const screen = points.map((p) => toScreen(p, viewport));

  if (screen.length >= 2) {
    tracePath(ctx, screen, closed);
    if (closed && screen.length >= 3) {
      ctx.fillStyle = palette.previewFill;
      ctx.fill();
    }
    ctx.strokeStyle = palette.preview;
    ctx.lineWidth = 2;
    ctx.setLineDash(closed ? [] : [6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  if (!closed) {
    for (const p of screen) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
      ctx.fillStyle = palette.preview;
      ctx.fill();
    }
  }
}

function drawPreviewPolyline(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  viewport: Viewport,
  palette: StylePalette,
  style: 'solid' | 'parallel' = 'solid',
) {
  if (points.length === 0) return;
  const screen = points.map((p) => toScreen(p, viewport));

  ctx.strokeStyle = style === 'parallel' ? 'rgba(60,100,200,0.55)' : palette.preview;
  ctx.fillStyle = style === 'parallel' ? 'rgba(60,100,200,0.55)' : palette.preview;
  if (screen.length >= 2) {
    tracePath(ctx, screen, false);
    ctx.lineWidth = style === 'parallel' ? 2.5 : 2;
    if (style === 'parallel') ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
  for (const p of screen) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, style === 'parallel' ? 3 : 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawParallelPreviews(
  ctx: CanvasRenderingContext2D,
  paths: Point[][] | undefined,
  viewport: Viewport,
  palette: StylePalette,
) {
  if (!paths || paths.length === 0) return;
  for (const path of paths) {
    if (path.length < 2) continue;
    drawPreviewPolyline(ctx, path, viewport, palette, 'parallel');
  }
}

function drawScaleBar(
  ctx: CanvasRenderingContext2D,
  project: CityProject,
  viewport: Viewport,
  canvasH: number,
  palette: StylePalette,
) {
  const { scale } = project.settings;
  // 高德式 1–2–5 序列：按目标像素宽度选最接近的「好看」长度
  const targetPx = 110;
  const rawM = targetPx / Math.max(viewport.zoom, 1e-6);
  const exp = Math.floor(Math.log10(Math.max(rawM, 1e-6)));
  const base = Math.pow(10, exp);
  const nice = [1, 2, 5, 10];
  let best = nice[0] * base;
  let bestDiff = Infinity;
  for (const e of [exp - 1, exp, exp + 1]) {
    const b = Math.pow(10, e);
    for (const n of nice) {
      const cand = n * b;
      if (cand < 1) continue;
      const px = cand * viewport.zoom;
      // 允许 48–200 px，优先贴近 targetPx
      if (px < 48 || px > 200) continue;
      const diff = Math.abs(px - targetPx);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = cand;
      }
    }
  }
  // 极端缩放兜底
  if (bestDiff === Infinity) {
    best = Math.max(1, Math.round(rawM));
  }

  const barM = best;
  const barPx = Math.max(2, barM * viewport.zoom);
  const x = 16;
  const y = canvasH - 28;

  ctx.fillStyle = palette.scaleBar;
  ctx.fillRect(x, y, barPx, 3);
  ctx.fillRect(x, y - 4, 2, 11);
  ctx.fillRect(x + barPx - 2, y - 4, 2, 11);

  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = palette.scaleText;
  let label: string;
  if (barM >= 1000) label = `${+(barM / 1000).toPrecision(3)} km`;
  else if (barM >= 1) label = `${Math.round(barM)} m`;
  else label = `${Math.round(barM * 100)} cm`;
  ctx.fillText(`${label} · 1:${scale.toLocaleString()}`, x, y - 8);
}

export type PreviewGuide = {
  kind: GuideSnap['kind'];
  from: Point;
  to: Point;
  ref?: Segment;
};

export type PreviewState =
  | { mode: 'none' }
  | { mode: 'rect'; from: Point; to: Point }
  | { mode: 'region'; points: Point[]; cursor: Point | null; closed: boolean }
  | {
      mode: 'polyline';
      points: Point[];
      cursor: Point | null;
      guide?: PreviewGuide | null;
      /** 平行模式预览路径（不含引导中线） */
      parallelPaths?: Point[][];
    }
  | {
      mode: 'curve';
      points: Point[];
      /** 三点弯中间点 B；未定时为 null */
      control: Point | null;
      cursor: Point | null;
      startHeading: number | null;
      endHeading: number | null;
      adaptivePreview: boolean;
      guide?: PreviewGuide | null;
      parallelPaths?: Point[][];
    }
  | { mode: 'brush'; center: Point; radiusM: number; thickness: number; kind: 'land' | 'water' | 'green' | 'erase' }
  | { mode: 'label'; point: Point; text: string };

export type SelectionState = {
  featureId: string;
} | null;

function drawSelection(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  viewport: Viewport,
) {
  const points = feature.points.map((p) => toScreen(p, viewport));
  if (points.length === 0) return;

  if (feature.kind === 'label' || feature.kind === 'station') {
    const p = points[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, feature.kind === 'station' ? 12 : 10, 0, Math.PI * 2);
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    return;
  }

  if (points.length < 2) return;

  tracePath(ctx, points, feature.closed);

  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 3]);
  ctx.stroke();
  ctx.setLineDash([]);

  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#fff';
    ctx.fill();
    ctx.strokeStyle = '#f59e0b';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}

function drawGuideLines(
  ctx: CanvasRenderingContext2D,
  guide: PreviewGuide | null | undefined,
  viewport: Viewport,
) {
  if (!guide || guide.kind === 'none' || guide.kind === 'endpoint') return;

  const from = toScreen(guide.from, viewport);
  const to = toScreen(guide.to, viewport);

  ctx.save();
  ctx.setLineDash([5, 5]);
  ctx.strokeStyle =
    guide.kind === 'parallel'
      ? 'rgba(37, 99, 235, 0.45)'
      : guide.kind === 'perpendicular'
        ? 'rgba(15, 23, 42, 0.35)'
        : 'rgba(14, 116, 144, 0.4)';
  ctx.lineWidth = 1;

  if (guide.kind === 'centerline' && guide.ref) {
    const a = toScreen(guide.ref.a, viewport);
    const b = toScreen(guide.ref.b, viewport);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  } else {
    // 延伸参照虚线
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const extend = 80;
    ctx.beginPath();
    ctx.moveTo(from.x - ux * extend, from.y - uy * extend);
    ctx.lineTo(to.x + ux * extend, to.y + uy * extend);
    ctx.stroke();
  }

  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.arc(to.x, to.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = ctx.strokeStyle;
  ctx.fill();
  ctx.restore();
}

function drawPreviewCurve(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  control: Point | null,
  cursor: Point | null,
  startHeading: number | null,
  _endHeading: number | null,
  _adaptivePreview: boolean,
  guide: PreviewGuide | null | undefined,
  viewport: Viewport,
  palette: StylePalette,
) {
  drawGuideLines(ctx, guide, viewport);

  if (points.length >= 2) {
    drawPreviewPolyline(ctx, points, viewport, palette);
  } else if (points.length === 1) {
    const p = toScreen(points[0], viewport);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = palette.preview;
    ctx.fill();
  }

  if (!cursor || points.length === 0) return;

  const a = points[points.length - 1];

  // 锚点切线模式：从已有直线/路段端点延伸（TF 式单半径弧）
  if (!control && startHeading != null) {
    const hx = Math.cos(startHeading);
    const hy = Math.sin(startHeading);
    const origin = toScreen(a, viewport);
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.strokeStyle = 'rgba(15, 23, 42, 0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(origin.x - hx * 90, origin.y - hy * 90);
    ctx.lineTo(origin.x + hx * 140, origin.y + hy * 140);
    ctx.stroke();
    ctx.restore();

    const curve = curveFromBestTangent(a, startHeading, cursor);
    if (curve && curve.points.length >= 2) {
      const screen = curve.points.map((p) => toScreen(p, viewport));
      tracePath(ctx, screen, false);
      ctx.strokeStyle = palette.preview;
      ctx.lineWidth = 2.25;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.setLineDash([5, 4]);
      ctx.stroke();
      ctx.setLineDash([]);

      const tip = toScreen(curve.points[curve.points.length - 1], viewport);
      const ex = Math.cos(curve.endHeading) * 18;
      const ey = Math.sin(curve.endHeading) * 18;
      ctx.beginPath();
      ctx.moveTo(tip.x, tip.y);
      ctx.lineTo(tip.x + ex, tip.y + ey);
      ctx.strokeStyle = palette.preview;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    } else {
      drawPreviewPolyline(ctx, [a, cursor], viewport, palette);
    }
    return;
  }

  // 自由三点：尚未点 B
  if (!control) {
    drawPreviewPolyline(ctx, [a, cursor], viewport, palette);
    return;
  }

  // 已有 B：预览 A-B-C 弧
  const b = control;
  const c = cursor;
  const bp = toScreen(b, viewport);
  ctx.beginPath();
  ctx.arc(bp.x, bp.y, 4, 0, Math.PI * 2);
  ctx.fillStyle = palette.preview;
  ctx.fill();

  const curve = curveFromThreePoints(a, b, c);

  if (curve && curve.points.length >= 2) {
    const screen = curve.points.map((p) => toScreen(p, viewport));
    tracePath(ctx, screen, false);
    ctx.strokeStyle = palette.preview;
    ctx.lineWidth = 2.25;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.setLineDash([5, 4]);
    ctx.stroke();
    ctx.setLineDash([]);

    const tip = toScreen(curve.points[curve.points.length - 1], viewport);
    const ex = Math.cos(curve.endHeading) * 18;
    const ey = Math.sin(curve.endHeading) * 18;
    ctx.beginPath();
    ctx.moveTo(tip.x, tip.y);
    ctx.lineTo(tip.x + ex, tip.y + ey);
    ctx.strokeStyle = palette.preview;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else {
    drawPreviewPolyline(ctx, [a, b, c], viewport, palette);
  }
}

function drawPreviewBrush(
  ctx: CanvasRenderingContext2D,
  center: Point,
  radiusM: number,
  thickness: number,
  kind: 'land' | 'water' | 'green' | 'erase',
  viewport: Viewport,
) {
  const c = toScreen(center, viewport);
  const r = radiusM * viewport.zoom;
  const jag = 1 + thickness * 0.18;
  ctx.save();
  ctx.beginPath();
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * Math.PI * 2;
    const n = Math.sin(a * 5.3) * 0.35 + Math.sin(a * 11) * 0.2;
    const rr = r * (1 + n * thickness * 0.35) * jag;
    const x = c.x + Math.cos(a) * rr;
    const y = c.y + Math.sin(a) * rr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  if (kind === 'erase') {
    ctx.fillStyle = 'rgba(180, 80, 70, 0.12)';
    ctx.fill();
    ctx.strokeStyle = '#c45c4a';
  } else {
    ctx.fillStyle =
      kind === 'water'
        ? 'rgba(170, 211, 223, 0.35)'
        : kind === 'green'
          ? 'rgba(173, 209, 158, 0.35)'
          : 'rgba(242, 239, 233, 0.45)';
    ctx.fill();
    ctx.strokeStyle =
      kind === 'water' ? '#7eb8c9' : kind === 'green' ? '#8fbc7a' : '#a8a29e';
  }
  ctx.lineWidth = 1.5;
  ctx.setLineDash([4, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.restore();
}

function drawPreviewLabel(
  ctx: CanvasRenderingContext2D,
  point: Point,
  text: string,
  viewport: Viewport,
  palette: StylePalette,
) {
  drawLabel(
    ctx,
    { id: 'preview', kind: 'label', points: [point], closed: false, labelText: text || '标注' },
    viewport,
    palette,
  );
}

export function renderMap(
  ctx: CanvasRenderingContext2D,
  canvasW: number,
  canvasH: number,
  project: CityProject,
  preview: PreviewState,
  selection: SelectionState = null,
  opts?: { terrainDraft?: boolean; showJunctionNodes?: boolean },
) {
  const palette = PALETTES[project.mapStyle];
  const { viewport, features } = project;
  const layers = getLayers(project);
  const terrainQuality: TerrainPaintQuality = opts?.terrainDraft ? 'draft' : 'final';
  const showJunctions =
    opts?.showJunctionNodes === true || layers.junctions === true;

  ctx.fillStyle = '#e7e5e4';
  ctx.fillRect(0, 0, canvasW, canvasH);

  drawMapBase(ctx, project, viewport, palette, terrainQuality);
  if (layers.grid) drawGrid(ctx, project, viewport, palette);

  const tl = toScreen({ x: 0, y: 0 }, viewport);
  const br = toScreen({ x: project.settings.widthM, y: project.settings.heightM }, viewport);
  ctx.save();
  ctx.beginPath();
  ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.clip();

  // 地貌由 drawMapBase 中的 terrain 栅格绘制（无等高线）

  if (layers.blocks) {
    const blocks = detectBlocks(
      features,
      project.settings.widthM,
      project.settings.heightM,
    );
    drawBlocks(ctx, blocks, viewport, palette);
  }

  if (layers.rivers) {
    for (const feature of features) {
      if (feature.kind === 'river') drawRiver(ctx, feature, viewport, palette);
    }
  }

  if (layers.roads) {
    const roads = features.filter((f) => f.kind === 'road').sort(sortByGradeAsc);
    const rivers = features.filter((f) => f.kind === 'river');
    const terrain = ensureTerrain(project.settings, project.terrain);
    drawRoadsMerged(ctx, roads, viewport, project.mapStyle, terrain, rivers);
  }

  if (layers.railways) {
    const rails = features.filter((f) => f.kind === 'railway').sort(sortByGradeAsc);
    for (const feature of rails) {
      drawRailway(ctx, feature, viewport, palette);
    }
    for (const feature of features) {
      if (feature.kind === 'station') drawStation(ctx, feature, viewport);
    }
  }

  if (layers.roads || layers.railways) {
    if (showJunctions) {
      const paths = features.filter(
        (f) =>
          (layers.roads && f.kind === 'road') || (layers.railways && f.kind === 'railway'),
      );
      drawJunctionNodes(ctx, paths, viewport, project.mapStyle);
    }
  }

  if (layers.labels) {
    for (const feature of features) {
      if (feature.kind === 'label') drawLabel(ctx, feature, viewport, palette);
    }
  }

  if (preview.mode === 'rect') {
    drawPreviewRect(ctx, preview.from, preview.to, viewport, palette);
  } else if (preview.mode === 'region') {
    const pts = preview.cursor ? [...preview.points, preview.cursor] : preview.points;
    drawPreviewRegion(ctx, pts, preview.closed, viewport, palette);
  } else if (preview.mode === 'polyline') {
    drawGuideLines(ctx, preview.guide, viewport);
    const pts = preview.cursor ? [...preview.points, preview.cursor] : preview.points;
    // 双侧平行时引导中线淡化，突出两条实路预览
    if (preview.parallelPaths && preview.parallelPaths.length >= 2) {
      drawPreviewPolyline(ctx, pts, viewport, palette, 'parallel');
      drawParallelPreviews(ctx, preview.parallelPaths, viewport, palette);
    } else {
      drawPreviewPolyline(ctx, pts, viewport, palette);
      drawParallelPreviews(ctx, preview.parallelPaths, viewport, palette);
    }
  } else if (preview.mode === 'curve') {
    drawPreviewCurve(
      ctx,
      preview.points,
      preview.control,
      preview.cursor,
      preview.startHeading,
      preview.endHeading,
      preview.adaptivePreview,
      preview.guide,
      viewport,
      palette,
    );
    drawParallelPreviews(ctx, preview.parallelPaths, viewport, palette);
  } else if (preview.mode === 'brush') {
    drawPreviewBrush(
      ctx,
      preview.center,
      preview.radiusM,
      preview.thickness,
      preview.kind,
      viewport,
    );
  } else if (preview.mode === 'label') {
    drawPreviewLabel(ctx, preview.point, preview.text, viewport, palette);
  }

  if (selection) {
    const selected = features.find((f) => f.id === selection.featureId);
    if (selected) drawSelection(ctx, selected, viewport);
  }

  ctx.restore();

  drawScaleBar(ctx, project, viewport, canvasH, palette);
}

export function exportToPng(project: CityProject, size = 2048): string {
  const canvas = document.createElement('canvas');
  const { widthM, heightM } = project.settings;
  const aspect = widthM / heightM;
  canvas.width = aspect >= 1 ? size : Math.round(size * aspect);
  canvas.height = aspect >= 1 ? Math.round(size / aspect) : size;

  const ctx = canvas.getContext('2d')!;
  const zoom = Math.min(canvas.width / widthM, canvas.height / heightM);

  const exportProject: CityProject = {
    ...project,
    viewport: {
      x: (canvas.width - widthM * zoom) / 2,
      y: (canvas.height - heightM * zoom) / 2,
      zoom,
    },
  };

  renderMap(ctx, canvas.width, canvas.height, exportProject, { mode: 'none' });
  return canvas.toDataURL('image/png');
}

export function fitViewport(
  containerW: number,
  containerH: number,
  widthM: number,
  heightM: number,
): Viewport {
  const padding = 48;
  const zoom = Math.min(
    (containerW - padding * 2) / widthM,
    (containerH - padding * 2) / heightM,
  );
  return {
    x: (containerW - widthM * zoom) / 2,
    y: (containerH - heightM * zoom) / 2,
    zoom: Math.max(0.01, zoom),
  };
}

export type { LayerVisibility };
