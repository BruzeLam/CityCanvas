export type Point = { x: number; y: number };

export type RoadLevel = 'expressway' | 'arterial' | 'collector' | 'local';

export type FeatureKind = 'river' | 'coastline' | 'greenbelt' | 'road';

export type MapFeature = {
  id: string;
  kind: FeatureKind;
  points: Point[];
  closed: boolean;
  roadLevel?: RoadLevel;
};

export type Tool =
  | 'select'
  | 'pan'
  | 'river'
  | 'coastline'
  | 'greenbelt'
  | 'road';

export type MapStyle = 'navigation' | 'blueprint' | 'sketch';

export type Viewport = {
  x: number;
  y: number;
  zoom: number;
};

export type CityProject = {
  name: string;
  features: MapFeature[];
  viewport: Viewport;
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
  river: '河流',
  coastline: '海岸线',
  greenbelt: '绿带',
  road: '道路',
};

export function createId(): string {
  return crypto.randomUUID();
}

export function emptyProject(name = '未命名城市'): CityProject {
  return {
    name,
    features: [],
    viewport: { x: 0, y: 0, zoom: 1 },
  };
}
