/**
 * 地理原型配方 → TerrainGenParams（见 docs/map-generator-design.md）
 * 非暂缓的 StylePreset（江南水乡等）；参考库提取为后续阶段。
 */
import {
  clampFragmentation,
  clampGreenDensity,
  clampLakeDensity,
  clampOceanRatio,
  clampRiverDensity,
  type TerrainGenParams,
} from '../engine/terrainGen';

export type GeoPrototypeId =
  | 'water_plain'
  | 'estuary_delta'
  | 'natural_harbor'
  | 'basin'
  | 'mountain_sea'
  | 'valley_city'
  | 'archipelago'
  | 'lake_region'
  | 'inland_plain'
  | 'peninsula'
  | 'fjord';

export type CityScaleId = 'community' | 'town' | 'city' | 'metropolis' | 'custom';

/** 界面四核心参数（高级细节由配方展开） */
export type MapCoreParams = {
  oceanRatio: number;
  /** 内陆水网：河+湖综合密度 0–1 */
  waterNetwork: number;
  greenCover: number;
  /** 地形/岸线破碎度 0–1 */
  fragmentation: number;
};

export type GeoPrototype = {
  id: GeoPrototypeId;
  label: string;
  blurb: string;
  /** 现实参考（文档/UI 展示，不复制地图） */
  references: string[];
  defaults: MapCoreParams;
  /** 是否倾向接边海 */
  prefersOcean: boolean;
};

export const GEO_PROTOTYPES: GeoPrototype[] = [
  {
    id: 'water_plain',
    label: '水网平原',
    blurb: '密河密汊，适合水乡路网',
    references: ['苏州', '嘉兴', '湖州'],
    prefersOcean: false,
    defaults: {
      oceanRatio: 0.08,
      waterNetwork: 0.72,
      greenCover: 0.22,
      fragmentation: 0.28,
    },
  },
  {
    id: 'estuary_delta',
    label: '河口三角洲',
    blurb: '入海口分汊，河海交织',
    references: ['珠江口', '长江口', '湄公河三角洲'],
    prefersOcean: true,
    defaults: {
      oceanRatio: 0.28,
      waterNetwork: 0.65,
      greenCover: 0.2,
      fragmentation: 0.42,
    },
  },
  {
    id: 'natural_harbor',
    label: '天然港湾',
    blurb: '深水湾与岸线凹入',
    references: ['香港', '悉尼', '里约'],
    prefersOcean: true,
    defaults: {
      oceanRatio: 0.36,
      waterNetwork: 0.32,
      greenCover: 0.24,
      fragmentation: 0.48,
    },
  },
  {
    id: 'basin',
    label: '山水盆地',
    blurb: '四面围合，中部可建设',
    references: ['成都平原', '昆明坝子'],
    prefersOcean: false,
    defaults: {
      oceanRatio: 0.06,
      waterNetwork: 0.38,
      greenCover: 0.4,
      fragmentation: 0.35,
    },
  },
  {
    id: 'mountain_sea',
    label: '山海城市',
    blurb: '一面山、一面海',
    references: ['青岛', '热那亚', '里维埃拉'],
    prefersOcean: true,
    defaults: {
      oceanRatio: 0.3,
      waterNetwork: 0.28,
      greenCover: 0.38,
      fragmentation: 0.52,
    },
  },
  {
    id: 'valley_city',
    label: '河谷城市',
    blurb: '主河道穿城，两岸扩展',
    references: ['兰州', '布达佩斯', '里昂'],
    prefersOcean: false,
    defaults: {
      oceanRatio: 0.05,
      waterNetwork: 0.55,
      greenCover: 0.3,
      fragmentation: 0.32,
    },
  },
  {
    id: 'archipelago',
    label: '群岛海岸',
    blurb: '破碎岸线与岛链',
    references: ['斯德哥尔摩', '厦门周边', '濑户内'],
    prefersOcean: true,
    defaults: {
      oceanRatio: 0.42,
      waterNetwork: 0.22,
      greenCover: 0.26,
      fragmentation: 0.72,
    },
  },
  {
    id: 'lake_region',
    label: '湖区',
    blurb: '大湖主导，河网辅助',
    references: ['杭州西湖周边', '五大湖城', '日内瓦'],
    prefersOcean: false,
    defaults: {
      oceanRatio: 0.06,
      waterNetwork: 0.58,
      greenCover: 0.34,
      fragmentation: 0.3,
    },
  },
  {
    id: 'inland_plain',
    label: '内陆平原',
    blurb: '大片可建设用地',
    references: ['华北平原', '巴黎盆地'],
    prefersOcean: false,
    defaults: {
      oceanRatio: 0.04,
      waterNetwork: 0.22,
      greenCover: 0.18,
      fragmentation: 0.18,
    },
  },
  {
    id: 'peninsula',
    label: '半岛海岸',
    blurb: '三面环水的突出地形',
    references: ['大连', '伊斯坦布尔', '孟买'],
    prefersOcean: true,
    defaults: {
      oceanRatio: 0.38,
      waterNetwork: 0.3,
      greenCover: 0.22,
      fragmentation: 0.45,
    },
  },
  {
    id: 'fjord',
    label: '峡湾海岸',
    blurb: '深长水道切入陆地',
    references: ['卑尔根', '奥斯陆峡湾'],
    prefersOcean: true,
    defaults: {
      oceanRatio: 0.34,
      waterNetwork: 0.4,
      greenCover: 0.42,
      fragmentation: 0.62,
    },
  },
];

export type CityScale = {
  id: CityScaleId;
  label: string;
  blurb: string;
  widthM: number;
  heightM: number;
  scale: number;
};

export const CITY_SCALES: CityScale[] = [
  {
    id: 'community',
    label: '社区',
    blurb: '街区 / 片区尺度',
    widthM: 2000,
    heightM: 2000,
    scale: 2000,
  },
  {
    id: 'town',
    label: '小城市',
    blurb: '一座小城骨架',
    widthM: 3500,
    heightM: 3500,
    scale: 5000,
  },
  {
    id: 'city',
    label: '城市',
    blurb: '常规城市底图',
    widthM: 5000,
    heightM: 5000,
    scale: 10000,
  },
  {
    id: 'metropolis',
    label: '大都市',
    blurb: '都会区结构',
    widthM: 10000,
    heightM: 10000,
    scale: 25000,
  },
];

export function geoPrototypeById(id: GeoPrototypeId): GeoPrototype {
  return GEO_PROTOTYPES.find((p) => p.id === id) ?? GEO_PROTOTYPES[0];
}

export function cityScaleById(id: CityScaleId): CityScale | null {
  if (id === 'custom') return null;
  return CITY_SCALES.find((s) => s.id === id) ?? CITY_SCALES[2];
}

export const WATER_NETWORK_MIN = 0;
export const WATER_NETWORK_MAX = 1;

export function clampWaterNetwork(r: number): number {
  if (!Number.isFinite(r)) return 0.4;
  return Math.max(WATER_NETWORK_MIN, Math.min(WATER_NETWORK_MAX, r));
}

export function clampCoreParams(core: MapCoreParams): MapCoreParams {
  return {
    oceanRatio: clampOceanRatio(core.oceanRatio),
    waterNetwork: clampWaterNetwork(core.waterNetwork),
    greenCover: clampGreenDensity(core.greenCover),
    fragmentation: clampFragmentation(core.fragmentation),
  };
}

/**
 * 四核心参数 + 地理原型 → 完整生成参数。
 * 水网密度同时驱动河/湖；破碎度写入 fragmentation。
 */
export function expandCoreToTerrainParams(
  prototypeId: GeoPrototypeId,
  core: MapCoreParams,
  seed: number,
): TerrainGenParams {
  const proto = geoPrototypeById(prototypeId);
  const c = clampCoreParams(core);
  const wn = c.waterNetwork;
  const oceanEnabled = proto.prefersOcean ? c.oceanRatio >= 0.06 : c.oceanRatio >= 0.12;
  const lakeEnabled = wn >= 0.12;
  const riverEnabled = wn >= 0.08;
  const greenEnabled = c.greenCover >= 0.06;

  // 水网：低值偏河，高值河湖并重；湖区原型偏湖
  const lakeBias =
    prototypeId === 'lake_region' || prototypeId === 'water_plain' ? 0.55 : 0.35;
  const lakeDensity = clampLakeDensity(0.04 + wn * 0.36 * (0.5 + lakeBias));
  const riverDensity = clampRiverDensity(0.12 + wn * 0.88);

  return {
    seed,
    oceanEnabled,
    oceanRatio: c.oceanRatio,
    lakeEnabled,
    lakeDensity,
    riverEnabled,
    riverDensity,
    greenEnabled,
    greenDensity: c.greenCover,
    fragmentation: c.fragmentation,
  };
}

/** @deprecated 旧场景 id 兼容 */
export type LandscapePresetId = GeoPrototypeId;
