export type Point = { x: number; y: number };

export type RoadLevel = 'expressway' | 'arterial' | 'collector' | 'local';

/** 地貌与人工要素（手绘，非 3D 导出） */
export type FeatureKind =
  | 'ocean'
  | 'land'
  | 'mountain'
  | 'river'
  | 'road'
  | 'railway'
  | 'label';

export type MapFeature = {
  id: string;
  kind: FeatureKind;
  points: Point[];
  closed: boolean;
  roadLevel?: RoadLevel;
  /** 标注文字（kind === 'label'） */
  labelText?: string;
};

/** 路网围合自动识别的街区（不单独存档，由道路实时推算） */
export type CityBlock = {
  id: string;
  points: Point[];
};

export type Tool =
  | 'pan'
  | 'select'
  | 'eraser'
  | 'ocean'
  | 'land'
  | 'mountain'
  | 'river'
  | 'road'
  | 'railway'
  | 'label';

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

/** 图层开关（参照 CSLMV 可开关图层） */
export type LayerKey = 'terrain' | 'blocks' | 'roads' | 'railways' | 'rivers' | 'labels' | 'grid';

export type LayerVisibility = Record<LayerKey, boolean>;

export const DEFAULT_LAYERS: LayerVisibility = {
  terrain: true,
  blocks: true,
  roads: true,
  railways: true,
  rivers: true,
  labels: true,
  grid: true,
};

export const LAYER_TOGGLE_LABELS: Record<LayerKey, string> = {
  terrain: '地貌',
  blocks: '街区',
  roads: '道路',
  railways: '铁路',
  rivers: '河流',
  labels: '标注',
  grid: '网格',
};

export type CityProject = {
  /** 云端存档 ID（登录后自动关联） */
  cloudId?: string;
  name: string;
  settings: MapSettings;
  features: MapFeature[];
  viewport: Viewport;
  mapStyle: MapStyle;
  layers?: LayerVisibility;
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
  railway: '铁路',
  label: '标注',
};

/** 地貌面状要素（海洋 / 陆地 / 山地） */
export const LANDFORM_TOOLS: Tool[] = ['ocean', 'land', 'mountain'];

/** 折线点击绘制（河流 / 道路 / 铁路） */
export const POLYLINE_TOOLS: Tool[] = ['river', 'road', 'railway'];

/** 地貌绘制方式 */
export type LandformDrawMode = 'freehand' | 'polygon' | 'rectangle';

export const LANDFORM_DRAW_MODES: { id: LandformDrawMode; label: string; desc: string }[] = [
  { id: 'freehand', label: '自由手绘', desc: '按住拖拽，适合海岸线' },
  { id: 'polygon', label: '多边形', desc: '逐点点击，Enter 完成' },
  { id: 'rectangle', label: '矩形', desc: '拖拽框选，快速占位' },
];

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
    layers: { ...DEFAULT_LAYERS },
  };
}

export function getLayers(project: CityProject): LayerVisibility {
  return { ...DEFAULT_LAYERS, ...project.layers };
}

/** 兼容旧版 feature kind */
export function normalizeFeatureKind(kind: string): FeatureKind {
  if (kind === 'coastline') return 'ocean';
  if (kind === 'greenbelt') return 'mountain';
  if (
    kind === 'ocean' ||
    kind === 'land' ||
    kind === 'mountain' ||
    kind === 'river' ||
    kind === 'road' ||
    kind === 'railway' ||
    kind === 'label'
  ) {
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
