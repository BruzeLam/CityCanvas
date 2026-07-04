import type { LandformDrawMode, RoadLevel, Tool } from '../types';
import { LANDFORM_DRAW_MODES, LANDFORM_TOOLS, ROAD_STYLES } from '../types';

type Props = {
  tool: Tool;
  roadLevel: RoadLevel;
  landformDrawMode: LandformDrawMode;
  onToolChange: (tool: Tool) => void;
  onRoadLevelChange: (level: RoadLevel) => void;
  onLandformDrawModeChange: (mode: LandformDrawMode) => void;
};

const TERRAIN_ITEMS: { id: Tool; label: string; icon: string }[] = [
  { id: 'land', label: '陆地', icon: '🏝️' },
  { id: 'ocean', label: '海洋', icon: '🌊' },
  { id: 'mountain', label: '山地', icon: '⛰️' },
  { id: 'river', label: '河流', icon: '💧' },
];

const ROAD_LEVELS = Object.entries(ROAD_STYLES) as [
  RoadLevel,
  (typeof ROAD_STYLES)[RoadLevel],
][];

const isLandformTool = (t: Tool) => LANDFORM_TOOLS.includes(t);

export function Toolbar({
  tool,
  roadLevel,
  landformDrawMode,
  onToolChange,
  onRoadLevelChange,
  onLandformDrawModeChange,
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
        <button
          type="button"
          className={tool === 'select' ? 'active' : ''}
          onClick={() => onToolChange('select')}
        >
          🎯 选择
          <span className="tool-hint">编辑</span>
        </button>
        <button
          type="button"
          className={tool === 'eraser' ? 'active' : ''}
          onClick={() => onToolChange('eraser')}
        >
          🧹 橡皮擦
          <span className="tool-hint">删除</span>
        </button>
      </section>

      <section className="tool-section">
        <h3>步骤 2 · 地貌</h3>
        {TERRAIN_ITEMS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tool === t.id ? 'active' : ''}
            onClick={() => onToolChange(t.id)}
          >
            {t.icon} {t.label}
            <span className="tool-hint">{t.id === 'river' ? '折线' : '面状'}</span>
          </button>
        ))}

        {isLandformTool(tool) && (
          <div className="draw-modes">
            <p className="draw-modes-label">绘制方式</p>
            {LANDFORM_DRAW_MODES.map((mode) => (
              <button
                key={mode.id}
                type="button"
                className={landformDrawMode === mode.id ? 'active draw-mode-chip' : 'draw-mode-chip'}
                onClick={() => onLandformDrawModeChange(mode.id)}
                title={mode.desc}
              >
                {mode.label}
              </button>
            ))}
          </div>
        )}
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
