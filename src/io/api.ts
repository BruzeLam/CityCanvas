import type { MapPayload } from './mapPayload';

const TOKEN_KEY = 'citycanvas_token';

export type AuthUser = {
  id: string;
  email: string;
  displayName: string | null;
};

export type CloudMapSummary = {
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  widthM: number;
  heightM: number;
  scale: number;
  featureCount: number;
};

export type CloudMap = {
  id: string;
  name: string;
  updatedAt: string;
  createdAt: string;
  payload: MapPayload;
};

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type') && init?.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...init, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError((data as { error?: string }).error || '请求失败', res.status);
  }
  return data as T;
}

export const api = {
  register(email: string, password: string, displayName?: string) {
    return request<{ token: string; user: AuthUser }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, displayName }),
    });
  },

  login(email: string, password: string) {
    return request<{ token: string; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
  },

  me() {
    return request<{ user: AuthUser }>('/api/auth/me');
  },

  listMaps() {
    return request<{ maps: CloudMapSummary[] }>('/api/maps');
  },

  getMap(id: string) {
    return request<{ map: CloudMap }>(`/api/maps/${id}`);
  },

  createMap(name: string, payload: MapPayload) {
    return request<{ map: CloudMap }>('/api/maps', {
      method: 'POST',
      body: JSON.stringify({ name, payload }),
    });
  },

  updateMap(id: string, name: string, payload: MapPayload) {
    return request<{ map: CloudMap }>(`/api/maps/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ name, payload }),
    });
  },

  deleteMap(id: string) {
    return request<{ ok: boolean }>(`/api/maps/${id}`, { method: 'DELETE' });
  },
};

export { ApiError };
