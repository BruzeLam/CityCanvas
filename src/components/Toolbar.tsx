import type { RoadLevel, Tool } from '../types';
import { ROAD_STYLES } from '../types';

type Props = {
  tool: Tool;
  roadLevel: RoadLevel;
  onToolChange: (tool: Tool) => void;
  onRoadLevelChange: (level: RoadLevel) => void;
};

const NATURAL_TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'coastline', label: '海岸线', icon: '🌊' },
  { id: 'river', label: '河流', icon: '💧' },
  { id: 'greenbelt', label: '绿带', icon: '🌿' },
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
        <h3>视图</h3>
        <button
          type="button"
          className={tool === 'pan' ? 'active' : ''}
          onClick={() => onToolChange('pan')}
        >
          ✋ 平移
        </button>
      </section>

      <section className="tool-section">
        <h3>自然层</h3>
        {NATURAL_TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tool === t.id ? 'active' : ''}
            onClick={() => onToolChange(t.id)}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </section>

      <section className="tool-section">
        <h3>路网层</h3>
        <button
          type="button"
          className={tool === 'road' ? 'active' : ''}
          onClick={() => onToolChange('road')}
        >
          🛣️ 道路
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
