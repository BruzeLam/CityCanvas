import { formatDistance } from '../constants/mapPresets';
import { detectBlocks } from '../engine/blockDetect';
import type { CityProject, LayerKey, MapStyle } from '../types';
import {
  DEFAULT_LAYERS,
  LAYER_LABELS,
  LAYER_TOGGLE_LABELS,
  ROAD_STYLES,
  getLayers,
} from '../types';

type Props = {
  project: CityProject;
  mapStyle: MapStyle;
  selectedFeatureId: string | null;
  cloudSaved: boolean;
  onDeleteSelected: () => void;
  onMapStyleChange: (style: MapStyle) => void;
  onLayerToggle: (key: LayerKey) => void;
  onSave: () => void;
  onExport: () => void;
  onExportSvg: () => void;
  onExportMd: () => void;
  onUndo: () => void;
  onNewMap: () => void;
};

const STYLES: { id: MapStyle; label: string }[] = [
  { id: 'navigation', label: '导航图' },
  { id: 'blueprint', label: '蓝图' },
  { id: 'sketch', label: '线稿' },
];

const LAYER_KEYS = Object.keys(DEFAULT_LAYERS) as LayerKey[];

export function SidePanel({
  project,
  mapStyle,
  selectedFeatureId,
  cloudSaved,
  onDeleteSelected,
  onMapStyleChange,
  onLayerToggle,
  onSave,
  onExport,
  onExportSvg,
  onExportMd,
  onUndo,
  onNewMap,
}: Props) {
  const layers = getLayers(project);
  const blockCount = detectBlocks(
    project.features,
    project.settings.widthM,
    project.settings.heightM,
  ).length;

  const counts = project.features.reduce<Record<string, number>>((acc, f) => {
    const key = f.kind === 'road' ? `道路 (${f.roadLevel ?? 'local'})` : LAYER_LABELS[f.kind];
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const roadLengthM = project.features
    .filter((f) => f.kind === 'road')
    .reduce((sum, f) => {
      let len = 0;
      for (let i = 1; i < f.points.length; i++) {
        const a = f.points[i - 1];
        const b = f.points[i];
        len += Math.hypot(b.x - a.x, b.y - a.y);
      }
      return sum + len;
    }, 0);

  const { widthM, heightM, scale } = project.settings;
  const selected = selectedFeatureId
    ? project.features.find((f) => f.id === selectedFeatureId)
    : null;

  return (
    <aside className="side-panel">
      {selected && (
        <section className="selection-panel">
          <h3>已选中</h3>
          <p className="selection-kind">
            {selected.kind === 'road'
              ? `道路 · ${ROAD_STYLES[selected.roadLevel ?? 'local'].label}`
              : selected.kind === 'label'
                ? `标注 · ${selected.labelText || '未命名'}`
                : LAYER_LABELS[selected.kind]}
          </p>
          <p className="selection-meta">
            {selected.kind === 'label' ? '点击位置' : `${selected.points.length} 个顶点`}
          </p>
          <button type="button" className="danger-btn" onClick={onDeleteSelected}>
            删除此要素
          </button>
        </section>
      )}

      <section>
        <h3>地图信息</h3>
        <div className="map-info">
          <p className="map-title">{project.name}</p>
          <p>
            {formatDistance(widthM)} × {formatDistance(heightM)}
          </p>
          <p>比例尺 1 : {scale.toLocaleString()}</p>
          {project.cloudId && (
            <p className={cloudSaved ? 'cloud-status saved' : 'cloud-status'}>
              {cloudSaved ? '☁️ 已同步云端' : '☁️ 等待保存…'}
            </p>
          )}
        </div>
      </section>

      <section>
        <h3>图层（CSLMV 风格）</h3>
        <div className="layer-toggles">
          {LAYER_KEYS.map((key) => (
            <label key={key} className="layer-toggle">
              <input
                type="checkbox"
                checked={layers[key]}
                onChange={() => onLayerToggle(key)}
              />
              <span>{LAYER_TOGGLE_LABELS[key]}</span>
            </label>
          ))}
        </div>
      </section>

      <section>
        <h3>地图风格</h3>
        <div className="style-tabs">
          {STYLES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={mapStyle === s.id ? 'active' : ''}
              onClick={() => onMapStyleChange(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <h3>统计</h3>
        <ul className="stats">
          <li>要素数量：{project.features.length}</li>
          <li>识别街区：{blockCount}</li>
          <li>路网长度：{formatDistance(roadLengthM)}</li>
        </ul>
        {Object.keys(counts).length > 0 && (
          <ul className="stats detail">
            {Object.entries(counts).map(([k, v]) => (
              <li key={k}>
                {k} × {v}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="actions">
        <button type="button" className="primary" onClick={onSave}>
          ☁️ 保存到云端
        </button>
        <button type="button" onClick={onExport}>
          ⬇ 导出 PNG
        </button>
        <button type="button" onClick={onExportSvg}>
          ⬇ 导出 SVG
        </button>
        <button type="button" onClick={onExportMd}>
          💾 导出 .md 备份
        </button>
        <button type="button" onClick={onUndo} disabled={project.features.length === 0}>
          ↩ 撤销
        </button>
        <button type="button" className="secondary" onClick={onNewMap}>
          我的地图…
        </button>
      </section>

      <footer className="panel-footer">
        <p>手绘地图 · 参照 CSLMV 视觉</p>
        <p className="muted">街区由道路围合自动识别</p>
      </footer>
    </aside>
  );
}
