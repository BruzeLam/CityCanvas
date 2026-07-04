import type { CityProject, MapStyle } from '../types';
import { LAYER_LABELS } from '../types';

type Props = {
  project: CityProject;
  mapStyle: MapStyle;
  onMapStyleChange: (style: MapStyle) => void;
  onNameChange: (name: string) => void;
  onClear: () => void;
  onExport: () => void;
  onUndo: () => void;
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
  onNameChange,
  onClear,
  onExport,
  onUndo,
}: Props) {
  const counts = project.features.reduce<Record<string, number>>((acc, f) => {
    const key = f.kind === 'road' ? `道路 (${f.roadLevel ?? 'local'})` : LAYER_LABELS[f.kind];
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  const roadLength = project.features
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

  return (
    <aside className="side-panel">
      <section>
        <h3>城市档案</h3>
        <input
          className="city-name"
          value={project.name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="城市名称"
        />
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
          <li>路网长度：{(roadLength / 100).toFixed(1)} km</li>
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
        <button type="button" onClick={onUndo} disabled={project.features.length === 0}>
          ↩ 撤销
        </button>
        <button type="button" className="primary" onClick={onExport}>
          ⬇ 导出 PNG
        </button>
        <button type="button" className="danger" onClick={onClear}>
          清空画布
        </button>
      </section>

      <footer className="panel-footer">
        <p>CityCanvas · 城市尺度架空地图</p>
        <p className="muted">专注路网与自然地理，而非大陆级世界构建</p>
      </footer>
    </aside>
  );
}
