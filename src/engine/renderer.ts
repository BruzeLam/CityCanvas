import type { CityProject, MapFeature, MapStyle, Point, Viewport } from '../types';
import { ROAD_STYLES } from '../types';

type StylePalette = {
  background: string;
  water: string;
  waterStroke: string;
  land: string;
  green: string;
  greenStroke: string;
  grid: string;
  preview: string;
};

const PALETTES: Record<MapStyle, StylePalette> = {
  navigation: {
    background: '#f2efe8',
    water: '#9ec9e8',
    waterStroke: '#6ba3c7',
    land: '#f7f4ed',
    green: '#b8d4a8',
    greenStroke: '#8fb87a',
    grid: 'rgba(0,0,0,0.04)',
    preview: 'rgba(80,120,200,0.6)',
  },
  blueprint: {
    background: '#1a3a5c',
    water: 'rgba(100,180,255,0.25)',
    waterStroke: '#6eb5ff',
    land: '#1a3a5c',
    green: 'rgba(120,200,120,0.2)',
    greenStroke: '#7fd67f',
    grid: 'rgba(255,255,255,0.06)',
    preview: 'rgba(120,200,255,0.7)',
  },
  sketch: {
    background: '#fffef9',
    water: 'none',
    waterStroke: '#4a90c4',
    land: '#fffef9',
    green: 'none',
    greenStroke: '#6a9e5a',
    grid: 'rgba(0,0,0,0.03)',
    preview: 'rgba(100,100,100,0.5)',
  },
};

function drawGrid(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  viewport: Viewport,
  color: string,
) {
  const step = 100 * viewport.zoom;
  if (step < 20) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.beginPath();

  const startX = viewport.x % step;
  const startY = viewport.y % step;

  for (let x = startX; x < width; x += step) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
  }
  for (let y = startY; y < height; y += step) {
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
  }
  ctx.stroke();
}

function tracePath(ctx: CanvasRenderingContext2D, points: Point[], closed: boolean) {
  if (points.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  if (closed) ctx.closePath();
}

function drawNatural(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  palette: StylePalette,
  viewport: Viewport,
) {
  const points = feature.points.map((p) => ({
    x: p.x * viewport.zoom + viewport.x,
    y: p.y * viewport.zoom + viewport.y,
  }));

  if (points.length < 2) return;

  tracePath(ctx, points, feature.closed);

  if (feature.kind === 'river' || feature.kind === 'coastline') {
    if (feature.closed && palette.water !== 'none') {
      ctx.fillStyle = palette.water;
      ctx.fill();
    }
    ctx.strokeStyle = palette.waterStroke;
    ctx.lineWidth = Math.max(2, (feature.kind === 'coastline' ? 3 : 2) * viewport.zoom);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  } else if (feature.kind === 'greenbelt') {
    if (feature.closed && palette.green !== 'none') {
      ctx.fillStyle = palette.green;
      ctx.fill();
    }
    ctx.strokeStyle = palette.greenStroke;
    ctx.lineWidth = Math.max(1.5, 2 * viewport.zoom);
    ctx.setLineDash([6 * viewport.zoom, 4 * viewport.zoom]);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawRoad(
  ctx: CanvasRenderingContext2D,
  feature: MapFeature,
  viewport: Viewport,
  style: MapStyle,
) {
  const level = feature.roadLevel ?? 'local';
  const roadStyle = ROAD_STYLES[level];
  const points = feature.points.map((p) => ({
    x: p.x * viewport.zoom + viewport.x,
    y: p.y * viewport.zoom + viewport.y,
  }));

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

function drawPreview(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  closed: boolean,
  viewport: Viewport,
  palette: StylePalette,
) {
  if (points.length === 0) return;

  const screenPoints = points.map((p) => ({
    x: p.x * viewport.zoom + viewport.x,
    y: p.y * viewport.zoom + viewport.y,
  }));

  ctx.strokeStyle = palette.preview;
  ctx.fillStyle = palette.preview;
  ctx.lineWidth = 2;

  if (screenPoints.length >= 2) {
    tracePath(ctx, screenPoints, closed);
    ctx.stroke();
  }

  for (const p of screenPoints) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

export function renderMap(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  project: CityProject,
  mapStyle: MapStyle,
  previewPoints: Point[] | null,
  previewClosed: boolean,
) {
  const palette = PALETTES[mapStyle];
  const { viewport, features } = project;

  ctx.fillStyle = palette.background;
  ctx.fillRect(0, 0, width, height);

  drawGrid(ctx, width, height, viewport, palette.grid);

  const order: Array<MapFeature['kind']> = [
    'coastline',
    'river',
    'greenbelt',
    'road',
  ];

  for (const kind of order) {
    for (const feature of features) {
      if (feature.kind !== kind) continue;
      if (kind === 'road') {
        drawRoad(ctx, feature, viewport, mapStyle);
      } else {
        drawNatural(ctx, feature, palette, viewport);
      }
    }
  }

  if (previewPoints) {
    drawPreview(ctx, previewPoints, previewClosed, viewport, palette);
  }
}

export function exportToPng(
  project: CityProject,
  mapStyle: MapStyle,
  size = 2048,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const bounds = computeBounds(project.features);
  const padding = 80;
  const span = Math.max(bounds.width, bounds.height, 400);
  const scale = (size - padding * 2) / span;
  const cx = bounds.x + bounds.width / 2;
  const cy = bounds.y + bounds.height / 2;

  const exportProject: CityProject = {
    ...project,
    viewport: {
      x: size / 2 - cx * scale,
      y: size / 2 - cy * scale,
      zoom: scale,
    },
  };

  renderMap(ctx, size, size, exportProject, mapStyle, null, false);
  return canvas.toDataURL('image/png');
}

function computeBounds(features: MapFeature[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const f of features) {
    for (const p of f.points) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }

  if (!Number.isFinite(minX)) {
    return { x: -200, y: -200, width: 400, height: 400 };
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}
