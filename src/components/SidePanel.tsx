import { formatDistance } from '../constants/mapPresets';
import type { CityProject, MapStyle } from '../types';
import { LAYER_LABELS } from '../types';

type Props = {
  project: CityProject;
  mapStyle: MapStyle;
  onMapStyleChange: (style: MapStyle) => void;
  onSave: () => void;
  onExport: () => void;
  onUndo: () => void;
  onNewMap: () => void;
};

const STYLES: { id: MapStyle; label: string }[] = [
  { id: 'navigation', label: '导航图' },
  { id: 'blueprint', label: '蓝图' },
  { id: 'sketch', label: '线稿' },
];

export function SidePanel({
  project,
  mapStyle,
  onMapStyleChange,
  onSave,
  onExport,
  onUndo,
  onNewMap,
}: Props) {
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

  return (
    <aside className="side-panel">
      <section>
        <h3>地图信息</h3>
        <div className="map-info">
          <p className="map-title">{project.name}</p>
          <p>
            {formatDistance(widthM)} × {formatDistance(heightM)}
          </p>
          <p>比例尺 1 : {scale.toLocaleString()}</p>
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
          💾 保存存档 (.md)
        </button>
        <button type="button" onClick={onExport}>
          ⬇ 导出 PNG
        </button>
        <button type="button" onClick={onUndo} disabled={project.features.length === 0}>
          ↩ 撤销
        </button>
        <button type="button" className="secondary" onClick={onNewMap}>
          新建地图…
        </button>
      </section>

      <footer className="panel-footer">
        <p>绘制 → 保存 .md → 打开继续</p>
        <p className="muted">本地存档 · 暂不上云</p>
      </footer>
    </aside>
  );
}
