import type { CityProject, MapFeature, MapStyle, RoadLevel } from '../types';
import {
  clampGrade,
  DEFAULT_GRADE,
  isLegacyLandformPolygon,
  normalizeFeatureKind,
  ROAD_STYLES,
} from '../types';
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
  terrainSeed?: CityProject['terrainSeed'];
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
    terrainSeed: project.terrainSeed,
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
        roadLevel:
          kind === 'road' &&
          typeof f.roadLevel === 'string' &&
          f.roadLevel in ROAD_STYLES
            ? (f.roadLevel as RoadLevel)
            : kind === 'road'
              ? 'local'
              : undefined,
        roadLevelEnd:
          kind === 'road' &&
          typeof f.roadLevelEnd === 'string' &&
          f.roadLevelEnd in ROAD_STYLES &&
          f.roadLevelEnd !== 'ramp'
            ? (f.roadLevelEnd as RoadLevel)
            : undefined,
        roadLevelFrom:
          kind === 'road' &&
          typeof f.roadLevelFrom === 'string' &&
          f.roadLevelFrom in ROAD_STYLES &&
          f.roadLevelFrom !== 'ramp'
            ? (f.roadLevelFrom as RoadLevel)
            : undefined,
      };
    })
    .filter((f) => !isLegacyLandformPolygon(f.kind));

  const terrain =
    terrainFromJSON(payload.terrain) ?? ensureTerrain(payload.settings, null);

  const terrainSeed =
    payload.terrainSeed && typeof payload.terrainSeed.seed === 'number'
      ? (() => {
          const raw = payload.terrainSeed;
          const oceanRatio =
            typeof raw.oceanRatio === 'number'
              ? raw.oceanRatio
              : typeof raw.waterRatio === 'number'
                ? raw.waterRatio
                : undefined;
          if (oceanRatio == null) return undefined;
          const oceanEnabled =
            raw.oceanEnabled ?? raw.waterEnabled !== false;
          return {
            seed: raw.seed >>> 0,
            oceanEnabled,
            oceanRatio,
            lakeEnabled: raw.lakeEnabled === true,
            lakeDensity:
              typeof raw.lakeDensity === 'number' ? raw.lakeDensity : undefined,
            riverEnabled: raw.riverEnabled === true,
            riverDensity:
              typeof raw.riverDensity === 'number' ? raw.riverDensity : undefined,
            greenEnabled: raw.greenEnabled === true,
            greenDensity:
              typeof raw.greenDensity === 'number' ? raw.greenDensity : undefined,
          };
        })()
      : undefined;

  return {
    cloudId,
    name: payload.name || '未命名城市',
    settings: payload.settings,
    mapStyle: payload.mapStyle ?? 'navigation',
    features: reweaveAllCrossings(features),
    terrain: ensureTerrain(payload.settings, terrain),
    terrainSeed,
    viewport: { x: 0, y: 0, zoom: 1 },
    layers: payload.layers,
  };
}
