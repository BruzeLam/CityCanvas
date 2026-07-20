import type { CityProject, MapFeature, Point } from '../types';
import { ROAD_STYLES, featureGrade, getLayers } from '../types';
import { detectBlocks } from './blockDetect';
import { collectJunctionNodes } from './junctions';
import { TERRAIN_GREEN, TERRAIN_WATER, ensureTerrain } from './terrain';

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function pathD(points: Point[], closed: boolean): string {
  if (points.length === 0) return '';
  const parts = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
  return parts.join(' ') + (closed ? ' Z' : '');
}

function byGradeAsc(a: MapFeature, b: MapFeature): number {
  return featureGrade(a) - featureGrade(b);
}

/**
 * 导出 SVG（世界坐标，单位米）。
 * 视觉参照 CSLMV：扁平色块 + 分级路网 + 铁路虚线 + 街区填充。
 */
export function exportToSvg(project: CityProject): string {
  const { widthM, heightM } = project.settings;
  const layers = getLayers(project);
  const features = project.features;
  const parts: string[] = [];

  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${widthM} ${heightM}" width="${widthM}" height="${heightM}">`,
  );
  parts.push(`<title>${esc(project.name)}</title>`);
  parts.push(`<rect width="100%" height="100%" fill="#f2efe9"/>`);

  if (layers.terrain) {
    const terrain = ensureTerrain(project.settings, project.terrain);
    const { cols, rows, cellSizeM, cells } = terrain;
    // 同行连续同色合并成一条 rect，避免高清栅格导出爆炸
    for (let row = 0; row < rows; row++) {
      let col = 0;
      while (col < cols) {
        const v = cells[row * cols + col]!;
        if (v !== TERRAIN_WATER && v !== TERRAIN_GREEN) {
          col++;
          continue;
        }
        let end = col + 1;
        while (end < cols && cells[row * cols + end] === v) end++;
        const fill = v === TERRAIN_WATER ? '#aad3df' : '#add19e';
        const w = (end - col) * cellSizeM;
        parts.push(
          `<rect x="${(col * cellSizeM).toFixed(1)}" y="${(row * cellSizeM).toFixed(1)}" width="${w.toFixed(1)}" height="${cellSizeM}" fill="${fill}"/>`,
        );
        col = end;
      }
    }
  }

  if (layers.blocks) {
    const blocks = detectBlocks(features, widthM, heightM);
    for (const b of blocks) {
      parts.push(
        `<path d="${pathD(b.points, true)}" fill="rgba(236,236,232,0.92)" stroke="rgba(180,180,170,0.5)" stroke-width="2"/>`,
      );
    }
  }

  if (layers.rivers) {
    for (const f of features.filter((x) => x.kind === 'river')) {
      parts.push(
        `<path d="${pathD(f.points, false)}" fill="none" stroke="#5a9fc4" stroke-width="18" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
    }
  }

  if (layers.roads) {
    const roads = features.filter((x) => x.kind === 'road').sort(byGradeAsc);
    // 同层：先全部路缘，再全部路面，避免后画道路盖住路口
    const byGrade = new Map<number, typeof roads>();
    for (const f of roads) {
      const g = featureGrade(f);
      const list = byGrade.get(g) ?? [];
      list.push(f);
      byGrade.set(g, list);
    }
    for (const g of [...byGrade.keys()].sort((a, b) => a - b)) {
      const group = byGrade.get(g)!;
      for (const f of group) {
        const style = ROAD_STYLES[f.roadLevel ?? 'local'];
        parts.push(
          `<path d="${pathD(f.points, false)}" fill="none" stroke="${style.casing}" stroke-width="${style.width + 8}" stroke-linecap="round" stroke-linejoin="round"/>`,
        );
      }
      for (const f of group) {
        const style = ROAD_STYLES[f.roadLevel ?? 'local'];
        parts.push(
          `<path d="${pathD(f.points, false)}" fill="none" stroke="${style.color}" stroke-width="${style.width}" stroke-linecap="round" stroke-linejoin="round"/>`,
        );
      }
    }
  }

  if (layers.railways) {
    for (const f of features.filter((x) => x.kind === 'railway').sort(byGradeAsc)) {
      parts.push(
        `<path d="${pathD(f.points, false)}" fill="none" stroke="#2a2a2a" stroke-width="14" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
      parts.push(
        `<path d="${pathD(f.points, false)}" fill="none" stroke="#ffffff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" stroke-dasharray="24 20"/>`,
      );
    }
  }

  // 路口节点（可在图层中关闭）
  if ((layers.roads || layers.railways) && layers.junctions !== false) {
    const paths = features.filter(
      (f) =>
        (layers.roads && f.kind === 'road') || (layers.railways && f.kind === 'railway'),
    );
    for (const node of collectJunctionNodes(paths)) {
      const p = node.point;
      parts.push(
        `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="6" fill="#ffffff" stroke="#888888" stroke-width="3"/>`,
      );
    }
  }

  if (layers.labels) {
    for (const f of features.filter((x) => x.kind === 'label')) {
      const p = f.points[0];
      if (!p) continue;
      const text = esc(f.labelText?.trim() || '标注');
      parts.push(
        `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-family="PingFang SC, Helvetica Neue, sans-serif" font-size="80" font-weight="600" fill="#1f2937" stroke="#ffffff" stroke-width="8" paint-order="stroke">${text}</text>`,
      );
    }
  }

  parts.push(`</svg>`);
  return parts.join('\n');
}

export function downloadSvg(project: CityProject) {
  const svg = exportToSvg(project);
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = `${project.name || 'city'}.svg`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export type { MapFeature };
