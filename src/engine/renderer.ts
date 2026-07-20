import type {
  CityBlock,
  CityProject,
  LayerVisibility,
  MapFeature,
  MapStyle,
  Point,
  Viewport,
} from '../types';
import { ROAD_STYLES, RAIL_STYLES, featureGrade, getLayers, isLevelBlendRoad, isRampRoad } from '../types';
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

function sortByGradeAsc(a: MapFeature, b: MapFeature): number {
  return renderGrade(a) - renderGrade(b);
}

/** 匝道按起点层参与 z-order（整段留在分支道路所在层，不抬到终点层） */
function renderGrade(f: MapFeature): number {
  return featureGrade(f);
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

/** 同层先画完所有路缘，再画路面，避免后画的路「盖住」路口 */
function drawRoadsMerged(
  ctx: CanvasRenderingContext2D,
  roads: MapFeature[],
  viewport: Viewport,
  style: MapStyle,
) {
  const joinedCaps = collectJoinedCaps(roads);
  const byGrade = new Map<number, MapFeature[]>();
  for (const road of roads) {
    const g = renderGrade(road);
    const list = byGrade.get(g) ?? [];
    list.push(road);
    byGrade.set(g, list);
  }
  const grades = [...byGrade.keys()].sort((a, b) => a - b);

  for (const g of grades) {
    const group = byGrade.get(g)!;
    for (const feature of group) {
      drawRoadCasing(ctx, feature, viewport, style, joinedCaps);
    }
    for (const feature of group) {
      drawRoadFill(ctx, feature, viewport, style, joinedCaps);
    }
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

/** 匝道两端加宽贴合主路，中段保持细宽 */
function rampWidthAt(
  t: number,
  baseW: number,
  fromRoadW: number,
  endRoadW: number,
): number {
  const flare = 0.2;
  const tipFrom = Math.max(baseW, Math.min(fromRoadW * 0.75, baseW * 2.6));
  const tipEnd = Math.max(baseW, Math.min(endRoadW * 0.75, baseW * 2.6));
  const smooth = (u: number) => u * u * (3 - 2 * u);
  if (t < flare) {
    const s = smooth(t / flare);
    return tipFrom + (baseW - tipFrom) * s;
  }
  if (t > 1 - flare) {
    const s = smooth((t - (1 - flare)) / flare);
    return baseW + (tipEnd - baseW) * s;
  }
  return baseW;
}

function shouldTaperRoad(feature: MapFeature): boolean {
  return isRampRoad(feature) || isLevelBlendRoad(feature);
}

function drawRoadCasing(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  viewport: Viewport,
  style: MapStyle,
  joinedCaps: Set<string>,
) {
  const level = (feature.roadLevel ?? 'local') as RoadLevel;
  const fromLevel = (feature.roadLevelFrom ?? (level === 'ramp' ? 'local' : level)) as RoadLevel;
  const levelEnd = (feature.roadLevelEnd ?? fromLevel) as RoadLevel;
  const bodyStyle = ROAD_STYLES[level === 'ramp' ? 'ramp' : level];
  const fromStyle = ROAD_STYLES[fromLevel === 'ramp' ? 'local' : fromLevel];
  const endStyle = ROAD_STYLES[levelEnd === 'ramp' ? 'local' : levelEnd];
  const points = feature.points.map((p) => toScreen(p, viewport));
  if (points.length < 2) return;

  const width = bodyStyle.width * viewport.zoom;
  const fromW = fromStyle.width * viewport.zoom;
  const endW = endStyle.width * viewport.zoom;
  const casingExtra = style === 'sketch' ? Math.max(1.5, 1.8 * viewport.zoom) : 2 * viewport.zoom;
  const { strokeCap, freeEnds } = strokeCapsForFeature(feature, joinedCaps);
  const casing0 =
    style === 'sketch' ? sketchRoadInk(fromStyle.casing) : fromStyle.casing;
  const casing1 =
    style === 'sketch' ? sketchRoadInk(endStyle.casing) : endStyle.casing;
  const casingMid = isLevelBlendRoad(feature)
    ? lerpColor(casing0, casing1, 0.5)
    : style === 'sketch'
      ? sketchRoadInk(bodyStyle.casing)
      : bodyStyle.casing;

  if (shouldTaperRoad(feature)) {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 0; i < points.length - 1; i++) {
      const t = (i + 0.5) / (points.length - 1);
      ctx.strokeStyle = isLevelBlendRoad(feature)
        ? lerpColor(casing0, casing1, t)
        : casingMid;
      ctx.lineWidth = rampWidthAt(t, width, fromW, endW) + casingExtra;
      ctx.beginPath();
      ctx.moveTo(points[i].x, points[i].y);
      ctx.lineTo(points[i + 1].x, points[i + 1].y);
      ctx.stroke();
    }
  } else {
    tracePath(ctx, points, false);
    ctx.strokeStyle = casingMid;
    ctx.lineWidth = width + casingExtra;
    ctx.lineJoin = 'round';
    ctx.lineCap = strokeCap;
    ctx.stroke();
  }
  drawFreeEndCaps(ctx, freeEnds, viewport, width + casingExtra, casingMid);
}

function drawRoadFill(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  viewport: Viewport,
  style: MapStyle,
  joinedCaps: Set<string>,
) {
  const level = (feature.roadLevel ?? 'local') as RoadLevel;
  const fromLevel = (feature.roadLevelFrom ?? (level === 'ramp' ? 'local' : level)) as RoadLevel;
  const levelEnd = (feature.roadLevelEnd ?? fromLevel) as RoadLevel;
  const bodyStyle = ROAD_STYLES[level === 'ramp' ? 'ramp' : level];
  const fromStyle = ROAD_STYLES[fromLevel === 'ramp' ? 'local' : fromLevel];
  const endStyle = ROAD_STYLES[levelEnd === 'ramp' ? 'local' : levelEnd];
  const points = feature.points.map((p) => toScreen(p, viewport));
  if (points.length < 2) return;

  const width = bodyStyle.width * viewport.zoom;
  const fromW = fromStyle.width * viewport.zoom;
  const endW = endStyle.width * viewport.zoom;
  const fillScale = style === 'sketch' ? 0.72 : 1;
  let fillColor = style === 'blueprint' ? '#e8f4ff' : fromStyle.color;
  let endColor = style === 'blueprint' ? '#e8f4ff' : endStyle.color;
  if (style === 'sketch') {
    fillColor = sketchRoadFill(fromStyle.color);
    endColor = sketchRoadFill(endStyle.color);
  }
  if (!isLevelBlendRoad(feature) && level !== 'ramp') {
    fillColor = style === 'blueprint' ? '#e8f4ff' : bodyStyle.color;
    if (style === 'sketch') fillColor = sketchRoadFill(bodyStyle.color);
  }
  const { strokeCap, freeEnds } = strokeCapsForFeature(feature, joinedCaps);
  const baseFillW = width * fillScale;

  if (shouldTaperRoad(feature) && style !== 'blueprint') {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 0; i < points.length - 1; i++) {
      const t = (i + 0.5) / (points.length - 1);
      ctx.strokeStyle = isLevelBlendRoad(feature)
        ? lerpColor(fillColor, endColor, t)
        : fillColor;
      ctx.lineWidth = rampWidthAt(t, baseFillW, fromW * fillScale, endW * fillScale);
      ctx.beginPath();
      ctx.moveTo(points[i].x, points[i].y);
      ctx.lineTo(points[i + 1].x, points[i + 1].y);
      ctx.stroke();
    }
  } else if (isLevelBlendRoad(feature) && style !== 'blueprint') {
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    for (let i = 0; i < points.length - 1; i++) {
      const t = (i + 0.5) / (points.length - 1);
      ctx.strokeStyle = lerpColor(fillColor, endColor, t);
      ctx.lineWidth = baseFillW;
      ctx.beginPath();
      ctx.moveTo(points[i].x, points[i].y);
      ctx.lineTo(points[i + 1].x, points[i + 1].y);
      ctx.stroke();
    }
  } else {
    tracePath(ctx, points, false);
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = baseFillW;
    ctx.lineJoin = 'round';
    ctx.lineCap = strokeCap;
    ctx.stroke();
  }
  drawFreeEndCaps(ctx, freeEnds, viewport, baseFillW, fillColor);
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
  const candidates = [100, 200, 500, 1000, 2000, 5000];
  let barM = 500;
  for (const c of candidates) {
    if (c * viewport.zoom >= 60 && c * viewport.zoom <= 180) {
      barM = c;
      break;
    }
  }

  const barPx = barM * viewport.zoom;
  const x = 16;
  const y = canvasH - 28;

  ctx.fillStyle = palette.scaleBar;
  ctx.fillRect(x, y, barPx, 4);
  ctx.fillRect(x, y - 4, 2, 12);
  ctx.fillRect(x + barPx - 2, y - 4, 2, 12);

  ctx.font = '11px system-ui, sans-serif';
  ctx.fillStyle = palette.scaleText;
  const label = barM >= 1000 ? `${barM / 1000} km` : `${barM} m`;
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
    drawRoadsMerged(ctx, roads, viewport, project.mapStyle);
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
