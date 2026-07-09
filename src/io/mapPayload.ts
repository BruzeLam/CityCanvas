import type { CityProject, MapFeature, MapStyle } from '../types';
import { normalizeFeatureKind } from '../types';

export const MAP_PAYLOAD_VERSION = 1;

export type MapPayload = {
  version: number;
  name: string;
  settings: CityProject['settings'];
  mapStyle: MapStyle;
  features: MapFeature[];
  layers?: CityProject['layers'];
};

export function projectToPayload(project: CityProject): MapPayload {
  return {
    version: MAP_PAYLOAD_VERSION,
    name: project.name,
    settings: project.settings,
    mapStyle: project.mapStyle,
    features: project.features,
    layers: project.layers,
  };
}

export function payloadToProject(payload: MapPayload, cloudId?: string): CityProject {
  return {
    cloudId,
    name: payload.name || '未命名城市',
    settings: payload.settings,
    mapStyle: payload.mapStyle ?? 'navigation',
    features: (payload.features ?? []).map((f) => ({
      ...f,
      kind: normalizeFeatureKind(f.kind as string),
    })),
    viewport: { x: 0, y: 0, zoom: 1 },
    layers: payload.layers,
  };
}
