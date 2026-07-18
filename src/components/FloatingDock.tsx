import type { FeatureGrade, PathDrawMode, RoadLevel, Tool } from '../types';
import {
  PATH_DRAW_MODES,
  ROAD_STYLES,
  clampGrade,
  formatGrade,
} from '../types';

type Props = {
  tool: Tool;
  roadLevel: RoadLevel;
  drawGrade: FeatureGrade;
  pathDrawMode: PathDrawMode;
  canUndo: boolean;
  onToolChange: (tool: Tool) => void;
  onRoadLevelChange: (level: RoadLevel) => void;
  onDrawGradeChange: (grade: FeatureGrade) => void;
  onPathDrawModeChange: (mode: PathDrawMode) => void;
  onUndo: () => void;
};

const DOCK_TOOLS: { id: Tool; label: string }[] = [
  { id: 'pan', label: '拖图' },
  { id: 'select', label: '编辑' },
  { id: 'road', label: '道路' },
  { id: 'railway', label: '铁路' },
  { id: 'ocean', label: '水域' },
  { id: 'mountain', label: '绿地' },
  { id: 'eraser', label: '橡皮' },
];

const ROAD_LEVELS = Object.entries(ROAD_STYLES) as [
  RoadLevel,
  (typeof ROAD_STYLES)[RoadLevel],
][];

export function FloatingDock({
  tool,
  roadLevel,
  drawGrade,
  pathDrawMode,
  canUndo,
  onToolChange,
  onRoadLevelChange,
  onDrawGradeChange,
  onPathDrawModeChange,
  onUndo,
}: Props) {
  const showPath = tool === 'road' || tool === 'railway';

  return (
    <div
      className="floating-dock"
      onMouseDown={(e) => {
        const t = e.target as HTMLElement;
        if (t.tagName === 'BUTTON') e.preventDefault();
      }}
    >
      <div className="floating-dock-row">
        {DOCK_TOOLS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={tool === t.id ? 'dock-btn active' : 'dock-btn'}
            onClick={() => onToolChange(t.id)}
            title={t.label}
          >
            {t.label}
          </button>
        ))}
        <button
          type="button"
          className="dock-btn"
          disabled={!canUndo}
          onClick={onUndo}
          title="撤销"
        >
          撤销
        </button>
      </div>

      {showPath && (
        <div className="floating-dock-row floating-dock-sub">
          {PATH_DRAW_MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={pathDrawMode === m.id ? 'dock-btn active' : 'dock-btn'}
              onClick={() => onPathDrawModeChange(m.id)}
            >
              {m.label}
            </button>
          ))}
          {tool === 'road' &&
            ROAD_LEVELS.map(([id, style]) => (
              <button
                key={id}
                type="button"
                className={roadLevel === id ? 'dock-btn active' : 'dock-btn'}
                onClick={() => onRoadLevelChange(id)}
                title={style.label}
              >
                {style.label}
              </button>
            ))}
          <button
            type="button"
            className="dock-btn"
            onClick={() => onDrawGradeChange(clampGrade(drawGrade - 1))}
          >
            −层
          </button>
          <span className="dock-grade">{formatGrade(drawGrade)}</span>
          <button
            type="button"
            className="dock-btn"
            onClick={() => onDrawGradeChange(clampGrade(drawGrade + 1))}
          >
            +层
          </button>
        </div>
      )}
    </div>
  );
}
