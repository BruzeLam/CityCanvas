import type { CityProject } from '../types';
import { normalizeFeatureKind } from '../types';
import { reweaveAllCrossings } from '../engine/junctions';
import { MAP_PAYLOAD_VERSION, type MapPayload } from './mapPayload';

const SESSION_KEY = 'citycanvas_session_v1';
const LAST_MAP_KEY = 'citycanvas_last_map_id';

export type LocalSession = {
  version: number;
  savedAt: string;
  project: CityProject;
};

function sanitizeProject(raw: CityProject): CityProject {
  const features = (raw.features ?? []).map((f) => ({
    ...f,
    kind: normalizeFeatureKind(f.kind as string),
  }));
  return {
    ...raw,
    features: reweaveAllCrossings(features),
    viewport: raw.viewport ?? { x: 0, y: 0, zoom: 1 },
  };
}

export function saveLocalSession(project: CityProject): void {
  try {
    const session: LocalSession = {
      version: MAP_PAYLOAD_VERSION,
      savedAt: new Date().toISOString(),
      project,
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
    const parsed = JSON.parse(raw) as LocalSession;
    if (!parsed?.project?.settings || !Array.isArray(parsed.project.features)) {
      return null;
    }
    return {
      ...parsed,
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

/** 从本地会话构造可上传的 payload */
export function sessionToPayload(project: CityProject): MapPayload {
  return {
    version: MAP_PAYLOAD_VERSION,
    name: project.name,
    settings: project.settings,
    mapStyle: project.mapStyle,
    features: project.features,
    layers: project.layers,
  };
}

export function hasLocalSession(): boolean {
  return Boolean(localStorage.getItem(SESSION_KEY));
}
