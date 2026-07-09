import type { CityProject, MapFeature, MapStyle } from '../types';
import { createProject, normalizeFeatureKind } from '../types';

const FILE_VERSION = 1;

type MapFilePayload = {
  version: number;
  name: string;
  settings: CityProject['settings'];
  mapStyle: MapStyle;
  features: MapFeature[];
  layers?: CityProject['layers'];
};

function parseFrontmatter(md: string): Record<string, string> {
  const match = md.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return {};
  const result: Record<string, string> = {};
  for (const line of match[1].split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    result[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return result;
}

function extractJsonBlock(md: string): string | null {
  const match = md.match(/```json\r?\n([\s\S]*?)\r?\n```/);
  return match ? match[1] : null;
}

export function serializeMapToMd(project: CityProject): string {
  const payload: MapFilePayload = {
    version: FILE_VERSION,
    name: project.name,
    settings: project.settings,
    mapStyle: project.mapStyle,
    features: project.features,
    layers: project.layers,
  };

  const { widthM, heightM, scale } = project.settings;

  return `# ${project.name}

CityCanvas 地图存档 · 可用「打开存档」重新加载

| 属性 | 值 |
|------|-----|
| 地图宽度 | ${widthM / 1000} km |
| 地图高度 | ${heightM / 1000} km |
| 比例尺 | 1 : ${scale.toLocaleString()} |
| 要素数量 | ${project.features.length} |

---

\`\`\`yaml
citycanvas: ${FILE_VERSION}
name: ${project.name}
widthM: ${widthM}
heightM: ${heightM}
scale: ${scale}
mapStyle: ${project.mapStyle}
\`\`\`

## 地图数据

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`
`;
}

export function parseMapFromMd(text: string): CityProject {
  const yaml = parseFrontmatter(text);
  const jsonText = extractJsonBlock(text);

  if (jsonText) {
    const payload = JSON.parse(jsonText) as MapFilePayload;
    return {
      name: payload.name || yaml.name || '未命名城市',
      settings: payload.settings ?? {
        widthM: Number(yaml.widthM) || 5000,
        heightM: Number(yaml.heightM) || 5000,
        scale: Number(yaml.scale) || 10000,
      },
      mapStyle: payload.mapStyle ?? (yaml.mapStyle as MapStyle) ?? 'navigation',
      features: (payload.features ?? []).map((f) => ({
        ...f,
        kind: normalizeFeatureKind(f.kind as string),
      })),
      viewport: { x: 0, y: 0, zoom: 1 },
      layers: payload.layers,
    };
  }

  return createProject(yaml.name || '未命名城市', {
    widthM: Number(yaml.widthM) || 5000,
    heightM: Number(yaml.heightM) || 5000,
    scale: Number(yaml.scale) || 10000,
  });
}

export function downloadMapMd(project: CityProject) {
  const content = serializeMapToMd(project);
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.download = `${project.name || 'city'}.citymap.md`;
  link.href = url;
  link.click();
  URL.revokeObjectURL(url);
}

export async function loadMapFromFile(file: File): Promise<CityProject> {
  const text = await file.text();
  return parseMapFromMd(text);
}
