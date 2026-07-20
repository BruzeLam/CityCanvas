import type { MapSettings, Point } from '../types';

/** 0 陆地 · 1 水域 · 2 绿地/山地（平面色块，非等高线） */
export type TerrainCell = 0 | 1 | 2;

export const TERRAIN_LAND: TerrainCell = 0;
export const TERRAIN_WATER: TerrainCell = 1;
export const TERRAIN_GREEN: TerrainCell = 2;

export const DEFAULT_TERRAIN_CELL_M = 10;

export type TerrainGrid = {
  cellSizeM: number;
  cols: number;
  rows: number;
  cells: Uint8Array;
};

/** 按地图尺寸选栅格：约 1400 格边长（5km≈3.5–4m/格）；岸线观感再靠一次高清烘焙 */
export function preferredTerrainCellSizeM(
  settings: Pick<MapSettings, 'widthM' | 'heightM'>,
): number {
  const maxDim = Math.max(settings.widthM, settings.heightM);
  const target = 1400;
  const raw = maxDim / target;
  if (raw <= 4) return 4;
  if (raw <= 5) return 5;
  if (raw <= 6) return 6;
  if (raw <= 8) return 8;
  if (raw <= 10) return 10;
  if (raw <= 12) return 12;
  if (raw <= 16) return 16;
  if (raw <= 20) return 20;
  if (raw <= 25) return 25;
  return 32;
}

/** 可 JSON 序列化的地形（cells 用 base64） */
export type TerrainGridJSON = {
  cellSizeM: number;
  cols: number;
  rows: number;
  cellsB64: string;
};

export function createTerrain(
  settings: Pick<MapSettings, 'widthM' | 'heightM'>,
  cellSizeM = preferredTerrainCellSizeM(settings),
): TerrainGrid {
  const cols = Math.max(8, Math.ceil(settings.widthM / cellSizeM));
  const rows = Math.max(8, Math.ceil(settings.heightM / cellSizeM));
  return {
    cellSizeM,
    cols,
    rows,
    cells: new Uint8Array(cols * rows), // 默认全陆地
  };
}

export function cloneTerrain(grid: TerrainGrid): TerrainGrid {
  return {
    cellSizeM: grid.cellSizeM,
    cols: grid.cols,
    rows: grid.rows,
    cells: new Uint8Array(grid.cells),
  };
}

export function terrainToJSON(grid: TerrainGrid): TerrainGridJSON {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < grid.cells.length; i += chunk) {
    binary += String.fromCharCode(...grid.cells.subarray(i, i + chunk));
  }
  return {
    cellSizeM: grid.cellSizeM,
    cols: grid.cols,
    rows: grid.rows,
    cellsB64: btoa(binary),
  };
}

export function terrainFromJSON(data: TerrainGridJSON | null | undefined): TerrainGrid | null {
  if (!data || !data.cols || !data.rows || !data.cellsB64) return null;
  const binary = atob(data.cellsB64);
  const cells = new Uint8Array(data.cols * data.rows);
  const n = Math.min(cells.length, binary.length);
  for (let i = 0; i < n; i++) cells[i] = binary.charCodeAt(i);
  return {
    cellSizeM: data.cellSizeM || DEFAULT_TERRAIN_CELL_M,
    cols: data.cols,
    rows: data.rows,
    cells,
  };
}

/** 栅格是否覆盖当前地图范围（允许与 preferred 粒度不同，避免把已生成地形抹成全陆地） */
function terrainCoversMap(
  settings: Pick<MapSettings, 'widthM' | 'heightM'>,
  grid: TerrainGrid,
): boolean {
  if (grid.cols < 8 || grid.rows < 8 || grid.cellSizeM <= 0) return false;
  if (grid.cells.length !== grid.cols * grid.rows) return false;
  const coverW = grid.cols * grid.cellSizeM;
  const coverH = grid.rows * grid.cellSizeM;
  return (
    coverW >= settings.widthM * 0.98 &&
    coverH >= settings.heightM * 0.98 &&
    coverW <= settings.widthM * 1.2 &&
    coverH <= settings.heightM * 1.2
  );
}

/** 保证工程有与地图尺寸匹配的地形；范围对不上才重建（全陆地） */
export function ensureTerrain(
  settings: Pick<MapSettings, 'widthM' | 'heightM'>,
  existing: TerrainGrid | null | undefined,
): TerrainGrid {
  if (existing && terrainCoversMap(settings, existing)) {
    return existing;
  }
  return createTerrain(settings, preferredTerrainCellSizeM(settings));
}

function hash2(ix: number, iy: number): number {
  let n = ix * 374761393 + iy * 668265263;
  n = (n ^ (n >> 13)) * 1274126177;
  return ((n ^ (n >> 16)) >>> 0) / 4294967296;
}

/**
 * 毛边刷 stamp：thickness 0–1 控制边缘起伏（偏平滑，细栅格下不再大锯齿）。
 */
export function stampBrush(
  grid: TerrainGrid,
  world: Point,
  radiusM: number,
  thickness: number,
  value: TerrainCell,
): void {
  const r = Math.max(grid.cellSizeM * 0.6, radiusM);
  const t = Math.max(0, Math.min(1, thickness));
  const { cellSizeM: cs, cols, rows, cells } = grid;

  const minC = Math.max(0, Math.floor((world.x - r * 1.25) / cs));
  const maxC = Math.min(cols - 1, Math.ceil((world.x + r * 1.25) / cs));
  const minR = Math.max(0, Math.floor((world.y - r * 1.25) / cs));
  const maxR = Math.min(rows - 1, Math.ceil((world.y + r * 1.25) / cs));

  for (let row = minR; row <= maxR; row++) {
    for (let col = minC; col <= maxC; col++) {
      const cx = (col + 0.5) * cs;
      const cy = (row + 0.5) * cs;
      const dx = cx - world.x;
      const dy = cy - world.y;
      const dist = Math.hypot(dx, dy);
      const ang = Math.atan2(dy, dx);

      const n1 = Math.sin(ang * 3.1 + hash2(col, row) * Math.PI * 2);
      const n2 = Math.sin(ang * 7.4 + hash2(col + 17, row - 9) * Math.PI * 2);
      const jagged = (n1 * 0.65 + n2 * 0.35) * t * r * 0.08;

      if (dist <= r + jagged) {
        cells[row * cols + col] = value;
      }
    }
  }
}
