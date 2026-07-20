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
  featureGrade,
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
import { collectJoinedCaps, collectJunctionNodes } from './junctions';
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
  /** 连续标高，用于 z-order；跨层匝道沿路径插值 */
  grade: number;
  /** 只画这一段折线边；null 表示整条 */
  segIndex: number | null;
};

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

/** 同层先画完所有路缘，再画路面；跨层匝道按连续标高拆段插入，两端接平无分层缝 */
function drawRoadsMerged(
  ctx: CanvasRenderingContext2D,
  roads: MapFeature[],
  viewport: Viewport,
  style: MapStyle,
  terrain: TerrainGrid | null,
  rivers: MapFeature[],
) {
  const joinedCaps = collectJoinedCaps(roads);
  const pieces: RoadDrawPiece[] = [];

  for (const feature of roads) {
    // 仅跨层匝道按段拆开做 z-order；同层渐变/普通匝道整段连续描边，避免「拼接断点」
    if (isRampFeature(feature) && feature.points.length >= 2) {
      const n = feature.points.length - 1;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        pieces.push({
          feature,
          grade: gradeAtPathT(feature, t),
          segIndex: i,
        });
      }
    } else if (isLevelBlendRoad(feature) && feature.points.length >= 2) {
      // 同层异色：分段变色，但用 round 重叠接缝（见 drawRoad*）
      const n = feature.points.length - 1;
      for (let i = 0; i < n; i++) {
        pieces.push({
          feature,
          grade: featureGrade(feature),
          segIndex: i,
        });
      }
    } else {
      pieces.push({
        feature,
        grade: featureGrade(feature),
        segIndex: null,
      });
    }
  }

  // 同层：匝道先画（压在主路下 → 挂接处呈同级汇入）；再按道路等级；高层整层在上
  pieces.sort((a, b) => {
    if (a.grade !== b.grade) return a.grade - b.grade;
    const rampFirst = (f: typeof a.feature) => (f.roadLevel === 'ramp' ? 0 : 1);
    const ra0 = rampFirst(a.feature);
    const rb0 = rampFirst(b.feature);
    if (ra0 !== rb0) return ra0 - rb0;
    const classOf = (f: typeof a.feature) => {
      if (f.roadLevel === 'ramp') {
        return rampSolidClass(f) ?? 'local';
      }
      return normalizeRoadClass(f.roadLevel);
    };
    const ra = ROAD_CLASS_RANK[classOf(a.feature)];
    const rb = ROAD_CLASS_RANK[classOf(b.feature)];
    if (ra !== rb) return ra - rb;
    return a.feature.id.localeCompare(b.feature.id);
  });

  const gradeBand = (g: number) => Math.floor(g + 1e-9);
  let i = 0;
  while (i < pieces.length) {
    const band = gradeBand(pieces[i].grade);
    let j = i + 1;
    while (j < pieces.length && gradeBand(pieces[j].grade) === band) j++;
    const batch = pieces.slice(i, j);
    for (const piece of batch) {
      drawRoadCasing(ctx, piece.feature, viewport, style, joinedCaps, piece.segIndex);
    }
    for (const piece of batch) {
      drawRoadFill(ctx, piece.feature, viewport, style, joinedCaps, piece.segIndex);
    }
    i = j;
  }

  // 穿水段：桥梁 / 隧道覆写样式 + 端口标记
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

/** 分段描边时略延长，避免 round cap 叠成毛毛虫 */
function extendedSegEnds(
  points: Point[],
  i: number,
  extendPx: number,
): { a: Point; b: Point } {
  const a = points[i];
  const b = points[i + 1];
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const back = i > 0 ? extendPx : 0;
  const fwd = i < points.length - 2 ? extendPx : 0;
  return {
    a: { x: a.x - ux * back, y: a.y - uy * back },
    b: { x: b.x + ux * fwd, y: b.y + uy * fwd },
  };
}

function drawRoadCasing(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  viewport: Viewport,
  style: MapStyle,
  joinedCaps: Set<string>,
  segIndex: number | null = null,
) {
  const level = (feature.roadLevel ?? 'local') as RoadLevel;
  const isRamp = level === 'ramp';
  const solid = isRamp ? rampSolidClass(feature) : normalizeRoadClass(level);
  const blend = isLevelBlendRoad(feature);
  const fromLevel = (feature.roadLevelFrom ?? solid ?? 'local') as RoadLevel;
  const levelEnd = (feature.roadLevelEnd ?? fromLevel) as RoadLevel;
  // 匝道线宽固定；未锚定用灰色，锚定后用对应等级色
  const bodyStyle = ROAD_STYLES[isRamp ? 'ramp' : (solid ?? 'local')];
  const colorStyle = ROAD_STYLES[solid ?? 'ramp'];
  const fromStyle = ROAD_STYLES[normalizeRoadClass(fromLevel)];
  const endStyle = ROAD_STYLES[normalizeRoadClass(levelEnd)];
  const points = feature.points.map((p) => toScreen(p, viewport));
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

  if (segIndex != null) {
    const n = points.length - 1;
    const t = (segIndex + 0.5) / n;
    // 圆帽 + 半宽重叠，消除分段拼接缝
    const { a, b } = extendedSegEnds(points, segIndex, Math.max(1.5, casingW * 0.55));
    ctx.strokeStyle = blend ? lerpColor(casing0, casing1, t) : casingMid;
    ctx.lineWidth = casingW;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const tipEnds: Point[] = [];
    if (segIndex === 0 && freeEnds.includes(feature.points[0])) {
      tipEnds.push(feature.points[0]);
    }
    if (segIndex === n - 1 && freeEnds.includes(feature.points[n])) {
      tipEnds.push(feature.points[n]);
    }
    if (tipEnds.length) {
      drawFreeEndCaps(ctx, tipEnds, viewport, casingW, casingMid);
    }
    return;
  }

  tracePath(ctx, points, false);
  ctx.strokeStyle = casingMid;
  ctx.lineWidth = casingW;
  ctx.lineJoin = 'round';
  ctx.lineCap = strokeCap;
  ctx.stroke();
  drawFreeEndCaps(ctx, freeEnds, viewport, casingW, casingMid);
}

function drawRoadFill(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  viewport: Viewport,
  style: MapStyle,
  joinedCaps: Set<string>,
  segIndex: number | null = null,
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
  const points = feature.points.map((p) => toScreen(p, viewport));
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
    // 未接路 → 灰色；单端/同级 → 对应等级色
    fillColor = style === 'blueprint' ? '#e8f4ff' : colorStyle.color;
    if (style === 'sketch') fillColor = sketchRoadFill(colorStyle.color);
    endColor = fillColor;
  } else if (!blend && !isRamp) {
    fillColor = style === 'blueprint' ? '#e8f4ff' : bodyStyle.color;
    if (style === 'sketch') fillColor = sketchRoadFill(bodyStyle.color);
  }
  const { strokeCap, freeEnds } = strokeCapsForFeature(feature, joinedCaps);
  const midFill = blend ? lerpColor(fillColor, endColor, 0.5) : fillColor;

  if (segIndex != null) {
    const n = points.length - 1;
    const t = (segIndex + 0.5) / n;
    const { a, b } = extendedSegEnds(points, segIndex, Math.max(1.5, baseFillW * 0.55));
    ctx.strokeStyle =
      style === 'blueprint'
        ? '#e8f4ff'
        : blend
          ? lerpColor(fillColor, endColor, t)
          : midFill;
    ctx.lineWidth = baseFillW;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    const tipEnds: Point[] = [];
    if (segIndex === 0 && freeEnds.includes(feature.points[0])) {
      tipEnds.push(feature.points[0]);
    }
    if (segIndex === n - 1 && freeEnds.includes(feature.points[n])) {
      tipEnds.push(feature.points[n]);
    }
    if (tipEnds.length) {
      drawFreeEndCaps(ctx, tipEnds, viewport, baseFillW, midFill);
    }
    return;
  }

  tracePath(ctx, points, false);
  ctx.strokeStyle = midFill;
  ctx.lineWidth = baseFillW;
  ctx.lineJoin = 'round';
  ctx.lineCap = strokeCap;
  ctx.stroke();
  drawFreeEndCaps(ctx, freeEnds, viewport, baseFillW, midFill);
}

function drawJunctionNodes(
  ctx: CanvasRenderingContext2D,
  features: MapFeature[],
  viewport: Viewport,
  style: MapStyle,
) {
  const nodes = collectJunctionNodes(features);
  for (const node of nodes) {
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
    kind === 'metro' && feature.metroColor ? feature.metroColor : style.color;
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

  if (feature.kind === 'label') {
    const p = points[0];
    ctx.beginPath();
    ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
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
