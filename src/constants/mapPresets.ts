export const MIN_MAP_M = 1000;
export const MAX_MAP_M = 50000;

export const MAP_SIZE_PRESETS = [
  { label: '2 × 2 km', widthM: 2000, heightM: 2000 },
  { label: '5 × 5 km', widthM: 5000, heightM: 5000 },
  { label: '10 × 10 km', widthM: 10000, heightM: 10000 },
  { label: '20 × 20 km', widthM: 20000, heightM: 20000 },
] as const;

export const SCALE_PRESETS = [
  { label: '1 : 2,000', value: 2000 },
  { label: '1 : 5,000', value: 5000 },
  { label: '1 : 10,000', value: 10000 },
  { label: '1 : 25,000', value: 25000 },
  { label: '1 : 50,000', value: 50000 },
] as const;

export const MIN_SCALE = 500;
export const MAX_SCALE = 100000;

export function clampMapSize(m: number): number {
  return Math.min(MAX_MAP_M, Math.max(MIN_MAP_M, Math.round(m)));
}

export function clampScale(s: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(s)));
}

export function formatDistance(m: number): string {
  if (m >= 1000) return `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km`;
  return `${m} m`;
}
