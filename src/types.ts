import type { TerrainGrid } from './engine/terrain';
import { createTerrain } from './engine/terrain';

export type Point = { x: number; y: number };

export type RoadLevel = 'expressway' | 'arterial' | 'collector' | 'local' | 'ramp';

/** 轨道线路细分（同属 kind=railway，用 railKind 区分画法） */
export type RailKind = 'railway' | 'hsr' | 'metro' | 'tram';

export const DEFAULT_RAIL_KIND: RailKind = 'railway';
export const DEFAULT_METRO_COLOR = '#e85d4c';

export const RAIL_KINDS: {
  id: RailKind;
  label: string;
  hint: string;
}[] = [
  { id: 'railway', label: '铁路', hint: '普速铁路 · 黑白轨枕线' },
  { id: 'hsr', label: '高铁', hint: '高速铁路 · 蓝白线' },
  { id: 'metro', label: '地铁', hint: '地铁 · 彩色实线' },
  { id: 'tram', label: '有轨', hint: '有轨电车 · 细实线' },
];

export const RAIL_STYLES: Record<
  RailKind,
  { width: number; color: string; dash?: number[]; stripe?: string }
> = {
  railway: { width: 3.5, color: '#2a2a2a', dash: [6, 5], stripe: '#fff' },
  hsr: { width: 4, color: '#2b6cb0', dash: [8, 4], stripe: '#fff' },
  metro: { width: 4.5, color: DEFAULT_METRO_COLOR },
  tram: { width: 2.8, color: '#5b8c5a' },
};

/**
 * 要素 kind。ocean/land/mountain 旧矢量面已弃用（改由 terrain 栅格表示），
 * 仍保留枚举以便加载旧档兼容；新绘制不再写入这三类面。
 */
export type FeatureKind =
  | 'ocean'
  | 'land'
  | 'mountain'
  | 'river'
  | 'road'
  | 'railway'
  | 'label';

/** 路网标高：同层交叉成路口，不同层上跨/下穿。陆地默认 0，范围 -3…+3 */
export type FeatureGrade = -3 | -2 | -1 | 0 | 1 | 2 | 3;

export const GRADE_MIN = -3 as const;
export const GRADE_MAX = 3 as const;
export const DEFAULT_GRADE: FeatureGrade = 0;

export const FEATURE_GRADES: FeatureGrade[] = [-3, -2, -1, 0, 1, 2, 3];

export type MapFeature = {
  id: string;
  kind: FeatureKind;
  points: Point[];
  closed: boolean;
  roadLevel?: RoadLevel;
  /** 匝道渐变起点色所取等级（接到的出发道路） */
  roadLevelFrom?: RoadLevel;
  /** 匝道终点道路等级（与起点不同时绘制配色渐变） */
  roadLevelEnd?: RoadLevel;
  /** 轨道细分；缺省视为普通铁路 */
  railKind?: RailKind;
  /** 地铁线路色（可选） */
  metroColor?: string;
  /** 路网标高（道路/铁路）；缺省视为 0。匝道时表示起点层 */
  grade?: FeatureGrade;
  /** 匝道终点层；与 grade 不同时表示跨层坡道 */
  gradeEnd?: FeatureGrade;
  /** 标注文字（kind === 'label'） */
  labelText?: string;
};

export function featureGrade(f: Pick<MapFeature, 'grade'>): FeatureGrade {
  const g = f.grade ?? DEFAULT_GRADE;
  if (g < GRADE_MIN) return GRADE_MIN;
  if (g > GRADE_MAX) return GRADE_MAX;
  return g as FeatureGrade;
}

/** 终点标高：匝道取 gradeEnd，否则同起点 */
export function featureGradeEnd(f: Pick<MapFeature, 'grade' | 'gradeEnd'>): FeatureGrade {
  if (f.gradeEnd == null) return featureGrade(f);
  return clampGrade(f.gradeEnd);
}

/** 跨层匝道（起终点标高不同）——挂接与绘制均用连续插值标高 */
export function isRampFeature(f: Pick<MapFeature, 'grade' | 'gradeEnd'>): boolean {
  return f.gradeEnd != null && featureGradeEnd(f) !== featureGrade(f);
}

/**
 * 路径参数 t∈[0,1] 处的连续标高（跨层匝道线性插值；同层为整段起点层）。
 * 系统内部可用 0.5 等中间值排序绘制；工具栏展示仍用整数层。
 */
export function gradeAtPathT(
  f: Pick<MapFeature, 'grade' | 'gradeEnd'>,
  t: number,
): number {
  const g0 = featureGrade(f);
  const g1 = featureGradeEnd(f);
  if (g0 === g1) return g0;
  const u = Math.max(0, Math.min(1, t));
  return g0 + (g1 - g0) * u;
}

/** 展示用：连续标高四舍五入到整数层 */
export function displayGrade(g: number): FeatureGrade {
  return clampGrade(Math.round(g));
}

/** 异级 / 匝道配色渐变 */
export function isLevelBlendRoad(
  f: Pick<MapFeature, 'kind' | 'roadLevel' | 'roadLevelFrom' | 'roadLevelEnd'>,
): boolean {
  if (f.kind !== 'road') return false;
  if (f.roadLevel === 'ramp' && (f.roadLevelFrom != null || f.roadLevelEnd != null)) {
    const from = f.roadLevelFrom ?? 'local';
    const to = f.roadLevelEnd ?? from;
    return from !== to;
  }
  return (
    f.roadLevelEnd != null &&
    f.roadLevelEnd !== (f.roadLevelFrom ?? f.roadLevel ?? 'local')
  );
}

export function isRampRoad(f: Pick<MapFeature, 'roadLevel'>): boolean {
  return f.roadLevel === 'ramp';
}

export function clampGrade(n: number): FeatureGrade {
  return Math.max(GRADE_MIN, Math.min(GRADE_MAX, Math.round(n))) as FeatureGrade;
}

export function formatGrade(g: FeatureGrade): string {
  if (g === 0) return '0 地面';
  if (g > 0) return `+${g} 上跨`;
  return `${g} 下穿`;
}

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
export type LayerKey =
  | 'terrain'
  | 'blocks'
  | 'roads'
  | 'railways'
  | 'rivers'
  | 'labels'
  | 'junctions'
  | 'grid';

export type LayerVisibility = Record<LayerKey, boolean>;

export const DEFAULT_LAYERS: LayerVisibility = {
  terrain: true,
  blocks: true,
  roads: true,
  railways: true,
  rivers: true,
  labels: true,
  junctions: false,
  grid: true,
};

export const LAYER_TOGGLE_LABELS: Record<LayerKey, string> = {
  terrain: '地貌',
  blocks: '街区',
  roads: '道路',
  railways: '铁路',
  rivers: '河流',
  labels: '标注',
  junctions: '路口节点',
  grid: '网格',
};

export type TerrainSeedMeta = {
  seed: number;
  oceanEnabled?: boolean;
  oceanRatio: number;
  lakeEnabled?: boolean;
  lakeDensity?: number;
  riverEnabled?: boolean;
  riverDensity?: number;
  /** @deprecated 旧「总水域」开关，读档时映射到 ocean */
  waterEnabled?: boolean;
  waterRatio?: number;
  greenEnabled?: boolean;
  greenDensity?: number;
};

export type CityProject = {
  /** 云端存档 ID（登录后自动关联） */
  cloudId?: string;
  name: string;
  settings: MapSettings;
  features: MapFeature[];
  /** 刷子地貌栅格：默认全陆地；水域/绿地叠色，无等高线 */
  terrain?: TerrainGrid;
  /**
   * 开局生成元数据（仅记录；编辑页不可整图重生）。
   * 刷子微调后地形会偏离种子，属预期。
   */
  terrainSeed?: TerrainSeedMeta;
  viewport: Viewport;
  mapStyle: MapStyle;
  layers?: LayerVisibility;
};

export const ROAD_STYLES: Record<
  RoadLevel,
  { label: string; width: number; color: string; casing: string }
> = {
  expressway: { label: '快速路', width: 9.5, color: '#f5a623', casing: '#c47d12' },
  arterial: { label: '主干路', width: 8.5, color: '#ffd966', casing: '#b8960f' },
  collector: { label: '次干路', width: 7.5, color: '#ffffff', casing: '#888888' },
  local: { label: '支路', width: 5, color: '#e8e8e8', casing: '#aaaaaa' },
  /** 细匝道：连接异级/异层；配色由 roadLevelFrom→End 渐变，接合处加宽过渡 */
  ramp: { label: '匝道', width: 4.5, color: '#ececec', casing: '#9a9a9a' },
};

export const LAYER_LABELS: Record<FeatureKind, string> = {
  ocean: '水域',
  land: '陆地',
  mountain: '绿地',
  river: '河流',
  road: '道路',
  railway: '铁路',
  label: '标注',
};

/** 地貌刷子工具：陆地 / 水域 / 绿地（山地平面色，非等高线） */
export const TERRAIN_BRUSH_TOOLS: Tool[] = ['land', 'ocean', 'mountain'];

/** 含橡皮：与地貌刷同样按住拖拽（橡皮按目标只擦一类） */
export const BRUSH_TOOLS: Tool[] = [...TERRAIN_BRUSH_TOOLS, 'eraser'];

/** 橡皮单选目标：一次只擦一类，避免地貌和路网一起没 */
export type EraserTarget = 'terrain' | 'road' | 'railway' | 'river' | 'label';

export const DEFAULT_ERASER_TARGET: EraserTarget = 'terrain';

export const ERASER_TARGETS: {
  id: EraserTarget;
  label: string;
  hint: string;
}[] = [
  { id: 'terrain', label: '地貌', hint: '只把水域/绿地刷回陆地' },
  { id: 'road', label: '道路', hint: '只删除刷区内道路' },
  { id: 'railway', label: '铁路', hint: '只删除刷区内铁路' },
  { id: 'river', label: '河道线', hint: '只删除刷区内河道中心线' },
  { id: 'label', label: '标注', hint: '只删除刷区内标注' },
];

export function eraserTargetLabel(target: EraserTarget): string {
  return ERASER_TARGETS.find((t) => t.id === target)?.label ?? target;
}

/** @deprecated 旧矢量面工具名，等同 TERRAIN_BRUSH_TOOLS */
export const LANDFORM_TOOLS: Tool[] = TERRAIN_BRUSH_TOOLS;

/** 折线点击绘制（河流 / 道路 / 铁路） */
export const POLYLINE_TOOLS: Tool[] = ['river', 'road', 'railway'];

/** 道路 / 铁路路径：直线 或 三点弯道 */
export type PathDrawMode = 'straight' | 'curve';

export const PATH_DRAW_MODES: { id: PathDrawMode; label: string; desc: string }[] = [
  { id: 'straight', label: '直线', desc: '自由角度 · 靠近时软吸正交 · Shift 关软吸' },
  { id: 'curve', label: '弯道', desc: '锁切线定半径劣弧 · 空白三点选侧' },
];

/** 支持直线/弯道模式的工具 */
export const PATH_GUIDED_TOOLS: Tool[] = ['road', 'railway'];

export const DEFAULT_BRUSH_SIZE_M = 120;
export const DEFAULT_BRUSH_THICKNESS = 0.45;

export function createId(): string {
  return crypto.randomUUID();
}

export function createProject(
  name: string,
  settings: MapSettings,
  mapStyle: MapStyle = 'navigation',
  options?: {
    terrain?: TerrainGrid;
    terrainSeed?: CityProject['terrainSeed'];
    features?: MapFeature[];
  },
): CityProject {
  return {
    name,
    settings,
    features: options?.features ?? [],
    terrain: options?.terrain ?? createTerrain(settings),
    terrainSeed: options?.terrainSeed,
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

/** 旧矢量地貌面：加载后不再参与绘制（已迁到 terrain） */
export function isLegacyLandformPolygon(kind: FeatureKind): boolean {
  return kind === 'ocean' || kind === 'land' || kind === 'mountain';
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
