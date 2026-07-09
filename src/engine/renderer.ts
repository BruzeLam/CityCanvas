import type {
  CityBlock,
  CityProject,
  LayerVisibility,
  MapFeature,
  MapStyle,
  Point,
  Viewport,
} from '../types';
import { ROAD_STYLES, getLayers } from '../types';
import { detectBlocks } from './blockDetect';

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
    outside: '#2a2a2e',
    land: '#e8f0d8',
    water: '#8ec4e8',
    waterStroke: '#5a9fc4',
    mountain: '#c5d9a8',
    mountainStroke: '#7aa862',
    border: '#888880',
    grid: 'rgba(0,0,0,0.05)',
    preview: 'rgba(60,100,200,0.8)',
    previewFill: 'rgba(60,100,200,0.15)',
    scaleBar: '#333',
    scaleText: '#555',
    blockFill: 'rgba(236, 236, 232, 0.92)',
    blockStroke: 'rgba(180, 180, 170, 0.5)',
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
    water: 'rgba(100,160,220,0.2)',
    waterStroke: '#4a90c4',
    mountain: 'rgba(120,180,100,0.15)',
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

function drawMapBase(
  ctx: CanvasRenderingContext2D,
  project: CityProject,
  viewport: Viewport,
  palette: StylePalette,
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

function drawRegion(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  viewport: Viewport,
  palette: StylePalette,
) {
  const points = feature.points.map((p) => toScreen(p, viewport));
  if (points.length < 3) return;

  tracePath(ctx, points, true);

  if (feature.kind === 'ocean') {
    ctx.fillStyle = palette.water;
    ctx.fill();
    ctx.strokeStyle = palette.waterStroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  } else if (feature.kind === 'land') {
    ctx.fillStyle = palette.land;
    ctx.fill();
    ctx.strokeStyle = palette.border;
    ctx.lineWidth = 1;
    ctx.stroke();
  } else if (feature.kind === 'mountain') {
    ctx.fillStyle = palette.mountain;
    ctx.fill();
    ctx.strokeStyle = palette.mountainStroke;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
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

function drawRoad(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  viewport: Viewport,
  style: MapStyle,
) {
  const level = feature.roadLevel ?? 'local';
  const roadStyle = ROAD_STYLES[level];
  const points = feature.points.map((p) => toScreen(p, viewport));

  if (points.length < 2) return;

  const width = roadStyle.width * viewport.zoom;
  tracePath(ctx, points, false);

  if (style !== 'sketch') {
    ctx.strokeStyle = roadStyle.casing;
    ctx.lineWidth = width + 2 * viewport.zoom;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  ctx.strokeStyle = style === 'blueprint' ? '#e8f4ff' : roadStyle.color;
  ctx.lineWidth = style === 'sketch' ? Math.max(1, width * 0.5) : width;
  ctx.stroke();
}

function drawRailway(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  viewport: Viewport,
  palette: StylePalette,
) {
  const points = feature.points.map((p) => toScreen(p, viewport));
  if (points.length < 2) return;

  const w = Math.max(2, 3.5 * viewport.zoom);

  tracePath(ctx, points, false);
  ctx.strokeStyle = palette.railway;
  ctx.lineWidth = w;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();

  // CSLMV 风格：黑白虚线轨枕感
  ctx.setLineDash([Math.max(4, 6 * viewport.zoom), Math.max(4, 5 * viewport.zoom)]);
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = Math.max(1, w * 0.45);
  ctx.stroke();
  ctx.setLineDash([]);
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
) {
  if (points.length === 0) return;
  const screen = points.map((p) => toScreen(p, viewport));

  ctx.strokeStyle = palette.preview;
  ctx.fillStyle = palette.preview;
  if (screen.length >= 2) {
    tracePath(ctx, screen, false);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  for (const p of screen) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
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

export type PreviewState =
  | { mode: 'none' }
  | { mode: 'rect'; from: Point; to: Point }
  | { mode: 'region'; points: Point[]; cursor: Point | null; closed: boolean }
  | { mode: 'polyline'; points: Point[]; cursor: Point | null }
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
) {
  const palette = PALETTES[project.mapStyle];
  const { viewport, features } = project;
  const layers = getLayers(project);

  ctx.fillStyle = '#0a0b0e';
  ctx.fillRect(0, 0, canvasW, canvasH);

  drawMapBase(ctx, project, viewport, palette);
  if (layers.grid) drawGrid(ctx, project, viewport, palette);

  const tl = toScreen({ x: 0, y: 0 }, viewport);
  const br = toScreen({ x: project.settings.widthM, y: project.settings.heightM }, viewport);
  ctx.save();
  ctx.beginPath();
  ctx.rect(tl.x, tl.y, br.x - tl.x, br.y - tl.y);
  ctx.clip();

  if (layers.terrain) {
    for (const kind of ['ocean', 'land', 'mountain'] as const) {
      for (const feature of features) {
        if (feature.kind === kind) drawRegion(ctx, feature, viewport, palette);
      }
    }
  }

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
    for (const feature of features) {
      if (feature.kind === 'road') drawRoad(ctx, feature, viewport, project.mapStyle);
    }
  }

  if (layers.railways) {
    for (const feature of features) {
      if (feature.kind === 'railway') drawRailway(ctx, feature, viewport, palette);
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
    const pts = preview.cursor ? [...preview.points, preview.cursor] : preview.points;
    drawPreviewPolyline(ctx, pts, viewport, palette);
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
