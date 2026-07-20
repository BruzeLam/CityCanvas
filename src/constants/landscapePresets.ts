/**
 * 新建地图「场景配方」→ TerrainGenParams。
 * 注意：不是暂缓的 StylePreset（江南水乡 / 大湾区等），仅地貌生成参数。
 */
import {
  clampGreenDensity,
  clampLakeDensity,
  clampOceanRatio,
  clampRiverDensity,
  type TerrainGenParams,
} from '../engine/terrainGen';

export type LandscapePresetId =
  | 'coastal'
  | 'river_network'
  | 'lake_city'
  | 'green_hills'
  | 'dry_plain'
  | 'random';

export type LandscapePreset = {
  id: LandscapePresetId;
  label: string;
  blurb: string;
  /** 固定落点；random 用区间采样 */
  recipe: Omit<TerrainGenParams, 'seed'> | 'roll';
};

export const LANDSCAPE_PRESETS: LandscapePreset[] = [
  {
    id: 'coastal',
    label: '沿海港湾',
    blurb: '接边大海 + 河口河网',
    recipe: {
      oceanEnabled: true,
      oceanRatio: 0.32,
      lakeEnabled: true,
      lakeDensity: 0.08,
      riverEnabled: true,
      riverDensity: 0.55,
      greenEnabled: true,
      greenDensity: 0.22,
    },
  },
  {
    id: 'river_network',
    label: '内陆河网',
    blurb: '少海、密河、带点湖',
    recipe: {
      oceanEnabled: false,
      oceanRatio: 0.12,
      lakeEnabled: true,
      lakeDensity: 0.14,
      riverEnabled: true,
      riverDensity: 0.78,
      greenEnabled: true,
      greenDensity: 0.26,
    },
  },
  {
    id: 'lake_city',
    label: '湖城',
    blurb: '大湖为主，河网点缀',
    recipe: {
      oceanEnabled: false,
      oceanRatio: 0.1,
      lakeEnabled: true,
      lakeDensity: 0.32,
      riverEnabled: true,
      riverDensity: 0.35,
      greenEnabled: true,
      greenDensity: 0.3,
    },
  },
  {
    id: 'green_hills',
    label: '绿地丘陵',
    blurb: '多绿地、水域克制',
    recipe: {
      oceanEnabled: false,
      oceanRatio: 0.1,
      lakeEnabled: true,
      lakeDensity: 0.1,
      riverEnabled: true,
      riverDensity: 0.28,
      greenEnabled: true,
      greenDensity: 0.52,
    },
  },
  {
    id: 'dry_plain',
    label: '少水平原',
    blurb: '大片陆地，便于先画路',
    recipe: {
      oceanEnabled: false,
      oceanRatio: 0.1,
      lakeEnabled: false,
      lakeDensity: 0.06,
      riverEnabled: true,
      riverDensity: 0.18,
      greenEnabled: true,
      greenDensity: 0.14,
    },
  },
  {
    id: 'random',
    label: '随机',
    blurb: '每次换种子都重新掷配方',
    recipe: 'roll',
  },
];

/** 新建页精简尺寸档（米） */
export const SIMPLE_MAP_SIZES = [
  { label: '3 × 3 km', widthM: 3000, heightM: 3000, scale: 5000 },
  { label: '5 × 5 km', widthM: 5000, heightM: 5000, scale: 10000 },
  { label: '8 × 8 km', widthM: 8000, heightM: 8000, scale: 25000 },
] as const;

function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

/** 按场景配方 + 种子生成落地参数 */
export function sampleLandscapeParams(
  presetId: LandscapePresetId,
  seed: number,
): TerrainGenParams {
  const preset =
    LANDSCAPE_PRESETS.find((p) => p.id === presetId) ?? LANDSCAPE_PRESETS[0];
  const rnd = mulberry32(seed ^ 0x9e3779b9);

  if (preset.recipe !== 'roll') {
    return { seed, ...preset.recipe };
  }

  const oceanEnabled = rnd() > 0.35;
  const lakeEnabled = rnd() > 0.25;
  const riverEnabled = rnd() > 0.15;
  const greenEnabled = rnd() > 0.1;
  return {
    seed,
    oceanEnabled,
    oceanRatio: clampOceanRatio(lerp(0.12, 0.42, rnd())),
    lakeEnabled,
    lakeDensity: clampLakeDensity(lerp(0.06, 0.3, rnd())),
    riverEnabled,
    riverDensity: clampRiverDensity(lerp(0.2, 0.85, rnd())),
    greenEnabled,
    greenDensity: clampGreenDensity(lerp(0.12, 0.55, rnd())),
  };
}

export function landscapePresetById(id: LandscapePresetId): LandscapePreset {
  return LANDSCAPE_PRESETS.find((p) => p.id === id) ?? LANDSCAPE_PRESETS[0];
}
