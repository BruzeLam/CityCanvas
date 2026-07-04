import type { RoadLevel, Tool } from '../types';
import { ROAD_STYLES } from '../types';

type Props = {
  tool: Tool;
  roadLevel: RoadLevel;
  onToolChange: (tool: Tool) => void;
  onRoadLevelChange: (level: RoadLevel) => void;
};

const LANDFORM_TOOLS: { id: Tool; label: string; icon: string; hint: string }[] = [
  { id: 'land', label: '陆地', icon: '🏝️', hint: '拖拽矩形' },
  { id: 'ocean', label: '海洋', icon: '🌊', hint: '拖拽矩形' },
  { id: 'mountain', label: '山地', icon: '⛰️', hint: '拖拽矩形' },
  { id: 'river', label: '河流', icon: '💧', hint: '折线' },
];

const ROAD_LEVELS = Object.entries(ROAD_STYLES) as [
  RoadLevel,
  (typeof ROAD_STYLES)[RoadLevel],
][];

export function Toolbar({
  tool,
  roadLevel,
  onToolChange,
  onRoadLevelChange,
}: Props) {
  return (
    <aside className="toolbar">
      <section className="tool-section">
        <h3>步骤 1 · 视图</h3>
        <button
          type="button"
          className={tool === 'pan' ? 'active' : ''}
          onClick={() => onToolChange('pan')}
        >
          ✋ 平移
        </button>
      </section>

      <section className="tool-section">
        <h3>步骤 2 · 地貌</h3>
        {LANDFORM_TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tool === t.id ? 'active' : ''}
            onClick={() => onToolChange(t.id)}
            title={t.hint}
          >
            {t.icon} {t.label}
            <span className="tool-hint">{t.hint}</span>
          </button>
        ))}
      </section>

      <section className="tool-section">
        <h3>步骤 3 · 路网</h3>
        <button
          type="button"
          className={tool === 'road' ? 'active' : ''}
          onClick={() => onToolChange('road')}
        >
          🛣️ 道路
          <span className="tool-hint">折线</span>
        </button>
        {tool === 'road' && (
          <div className="road-levels">
            {ROAD_LEVELS.map(([level, style]) => (
              <button
                key={level}
                type="button"
                className={roadLevel === level ? 'active road-chip' : 'road-chip'}
                onClick={() => onRoadLevelChange(level)}
              >
                <span
                  className="road-swatch"
                  style={{ background: style.color, borderColor: style.casing }}
                />
                {style.label}
              </button>
            ))}
          </div>
        )}
      </section>
    </aside>
  );
}
