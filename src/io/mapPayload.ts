import type { CityProject, MapFeature, MapStyle } from '../types';
import { clampGrade, DEFAULT_GRADE, normalizeFeatureKind } from '../types';
import { reweaveAllCrossings } from '../engine/junctions';

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
  const features = (payload.features ?? []).map((f) => {
    const kind = normalizeFeatureKind(f.kind as string);
    const needsGrade = kind === 'road' || kind === 'railway';
    return {
      ...f,
      kind,
      grade: needsGrade
        ? clampGrade(typeof f.grade === 'number' ? f.grade : DEFAULT_GRADE)
        : undefined,
    };
  });

  return {
    cloudId,
    name: payload.name || '未命名城市',
    settings: payload.settings,
    mapStyle: payload.mapStyle ?? 'navigation',
    features: reweaveAllCrossings(features),
    viewport: { x: 0, y: 0, zoom: 1 },
    layers: payload.layers,
  };
}
