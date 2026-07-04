export type Point = { x: number; y: number };

export type RoadLevel = 'expressway' | 'arterial' | 'collector' | 'local';

/** 地貌与人工要素 */
export type FeatureKind = 'ocean' | 'land' | 'mountain' | 'river' | 'road';

export type MapFeature = {
  id: string;
  kind: FeatureKind;
  points: Point[];
  closed: boolean;
  roadLevel?: RoadLevel;
};

export type Tool = 'pan' | 'ocean' | 'land' | 'mountain' | 'river' | 'road';

export type MapStyle = 'navigation' | 'blueprint' | 'sketch';

export type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

export type MapSettings = {
  /** 地图宽度（米） */
  widthM: number;
  /** 地图高度（米） */
  heightM: number;
  /** 比例尺分母，如 10000 表示 1:10000 */
  scale: number;
};

export type CityProject = {
  name: string;
  settings: MapSettings;
  features: MapFeature[];
  viewport: Viewport;
  mapStyle: MapStyle;
};

export const ROAD_STYLES: Record<
  RoadLevel,
  { label: string; width: number; color: string; casing: string }
> = {
  expressway: { label: '快速路', width: 14, color: '#f5a623', casing: '#c47d12' },
  arterial: { label: '主干路', width: 10, color: '#ffd966', casing: '#b8960f' },
  collector: { label: '次干路', width: 7, color: '#ffffff', casing: '#888888' },
  local: { label: '支路', width: 4, color: '#e8e8e8', casing: '#aaaaaa' },
};

export const LAYER_LABELS: Record<FeatureKind, string> = {
  ocean: '海洋',
  land: '陆地',
  mountain: '山地',
  river: '河流',
  road: '道路',
};

/** 矩形拖拽绘制（海洋 / 陆地 / 山地） */
export const RECTANGLE_TOOLS: Tool[] = ['ocean', 'land', 'mountain'];

/** 折线点击绘制（河流 / 道路） */
export const POLYLINE_TOOLS: Tool[] = ['river', 'road'];

export function createId(): string {
  return crypto.randomUUID();
}

export function createProject(
  name: string,
  settings: MapSettings,
  mapStyle: MapStyle = 'navigation',
): CityProject {
  return {
    name,
    settings,
    features: [],
    viewport: { x: 0, y: 0, zoom: 1 },
    mapStyle,
  };
}

/** 兼容旧版 feature kind */
export function normalizeFeatureKind(kind: string): FeatureKind {
  if (kind === 'coastline') return 'ocean';
  if (kind === 'greenbelt') return 'mountain';
  if (kind === 'ocean' || kind === 'land' || kind === 'mountain' || kind === 'river' || kind === 'road') {
    return kind;
  }
  return 'land';
}

export function clampToMap(p: Point, settings: MapSettings): Point {
  return {
    x: Math.min(settings.widthM, Math.max(0, p.x)),
    y: Math.min(settings.heightM, Math.max(0, p.y)),
  };
}

export function rectFromCorners(a: Point, b: Point): Point[] {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x, b.x);
  const y2 = Math.max(a.y, b.y);
  return [
    { x: x1, y: y1 },
    { x: x2, y: y1 },
    { x: x2, y: y2 },
    { x: x1, y: y2 },
  ];
}
