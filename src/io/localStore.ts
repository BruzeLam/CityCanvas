import type { CityProject } from '../types';
import { isLegacyLandformPolygon, normalizeFeatureKind } from '../types';
import { reweaveAllCrossings } from '../engine/junctions';
import {
  ensureTerrain,
  terrainFromJSON,
  terrainToJSON,
  type TerrainGridJSON,
} from '../engine/terrain';
import { MAP_PAYLOAD_VERSION, type MapPayload } from './mapPayload';

const SESSION_KEY = 'citycanvas_session_v1';
const LAST_MAP_KEY = 'citycanvas_last_map_id';

export type LocalSession = {
  version: number;
  savedAt: string;
  project: CityProject;
};

type StoredProject = Omit<CityProject, 'terrain'> & {
  terrain?: TerrainGridJSON | CityProject['terrain'];
};

function sanitizeProject(raw: StoredProject): CityProject {
  const features = (raw.features ?? [])
    .map((f) => ({
      ...f,
      kind: normalizeFeatureKind(f.kind as string),
    }))
    .filter((f) => !isLegacyLandformPolygon(f.kind));

  let terrain = raw.terrain;
  if (terrain && 'cellsB64' in (terrain as TerrainGridJSON)) {
    terrain = terrainFromJSON(terrain as TerrainGridJSON) ?? undefined;
  } else if (
    terrain &&
    'cells' in terrain &&
    terrain.cells &&
    !(terrain.cells instanceof Uint8Array)
  ) {
    const obj = terrain.cells as unknown as Record<string, number>;
    const cells = new Uint8Array(terrain.cols * terrain.rows);
    for (let i = 0; i < cells.length; i++) cells[i] = obj[i] ?? 0;
    terrain = { cellSizeM: terrain.cellSizeM, cols: terrain.cols, rows: terrain.rows, cells };
  }

  return {
    ...raw,
    features: reweaveAllCrossings(features),
    terrain: ensureTerrain(raw.settings, terrain as CityProject['terrain']),
    viewport: raw.viewport ?? { x: 0, y: 0, zoom: 1 },
  };
}

export function saveLocalSession(project: CityProject): void {
  try {
    const terrain = ensureTerrain(project.settings, project.terrain);
    const stored: StoredProject = {
      ...project,
      features: project.features.filter((f) => !isLegacyLandformPolygon(f.kind)),
      terrain: terrainToJSON(terrain),
    };
    const session = {
      version: MAP_PAYLOAD_VERSION,
      savedAt: new Date().toISOString(),
      project: stored,
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    if (project.cloudId) {
      localStorage.setItem(LAST_MAP_KEY, project.cloudId);
    }
  } catch {
    // quota / private mode — ignore
  }
}

export function loadLocalSession(): LocalSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      version: number;
      savedAt: string;
      project: StoredProject;
    };
    if (!parsed?.project?.settings || !Array.isArray(parsed.project.features)) {
      return null;
    }
    return {
      version: parsed.version,
      savedAt: parsed.savedAt,
      project: sanitizeProject(parsed.project),
    };
  } catch {
    return null;
  }
}

export function clearLocalSession(): void {
  localStorage.removeItem(SESSION_KEY);
}

export function getLastCloudMapId(): string | null {
  return localStorage.getItem(LAST_MAP_KEY);
}

export function clearLastCloudMapId(): void {
  localStorage.removeItem(LAST_MAP_KEY);
}

export function hasLocalSession(): boolean {
  try {
    return localStorage.getItem(SESSION_KEY) != null;
  } catch {
    return false;
  }
}

/** 从本地会话构造可上传的 payload */
export function sessionToPayload(project: CityProject): MapPayload {
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
