import type { CityProject, MapFeature, MapStyle } from '../types';
import { clampGrade, DEFAULT_GRADE, isLegacyLandformPolygon, normalizeFeatureKind } from '../types';
import { reweaveAllCrossings } from '../engine/junctions';
import {
  ensureTerrain,
  terrainFromJSON,
  terrainToJSON,
  type TerrainGridJSON,
} from '../engine/terrain';

export const MAP_PAYLOAD_VERSION = 2;

export type MapPayload = {
  version: number;
  name: string;
  settings: CityProject['settings'];
  mapStyle: MapStyle;
  features: MapFeature[];
  layers?: CityProject['layers'];
  terrain?: TerrainGridJSON;
};

export function projectToPayload(project: CityProject): MapPayload {
  const terrain = ensureTerrain(project.settings, project.terrain);
  return {
    version: MAP_PAYLOAD_VERSION,
    name: project.name,
    settings: project.settings,
    mapStyle: project.mapStyle,
    features: project.features.filter((f) => !isLegacyLandformPolygon(f.kind)),
    layers: project.layers,
    terrain: terrainToJSON(terrain),
  };
}

export function payloadToProject(payload: MapPayload, cloudId?: string): CityProject {
  const features = (payload.features ?? [])
    .map((f) => {
      const kind = normalizeFeatureKind(f.kind as string);
      const needsGrade = kind === 'road' || kind === 'railway';
      return {
        ...f,
        kind,
        grade: needsGrade
          ? clampGrade(typeof f.grade === 'number' ? f.grade : DEFAULT_GRADE)
          : undefined,
        gradeEnd:
          needsGrade && typeof f.gradeEnd === 'number' ? clampGrade(f.gradeEnd) : undefined,
      };
    })
    .filter((f) => !isLegacyLandformPolygon(f.kind));

  const terrain =
    terrainFromJSON(payload.terrain) ?? ensureTerrain(payload.settings, null);

  return {
    cloudId,
    name: payload.name || '未命名城市',
    settings: payload.settings,
    mapStyle: payload.mapStyle ?? 'navigation',
    features: reweaveAllCrossings(features),
    terrain: ensureTerrain(payload.settings, terrain),
    viewport: { x: 0, y: 0, zoom: 1 },
    layers: payload.layers,
  };
}
