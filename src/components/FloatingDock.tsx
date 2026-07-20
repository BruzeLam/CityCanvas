import type { EraserTarget, FeatureGrade, PathDrawMode, RoadLevel, Tool } from '../types';
import {
  ERASER_TARGETS,
  PATH_DRAW_MODES,
  ROAD_STYLES,
  clampGrade,
  formatGrade,
} from '../types';
import {
  DEFAULT_PARALLEL_SPACING_M,
  PARALLEL_SIDES,
  PARALLEL_SPACING_MAX_M,
  PARALLEL_SPACING_MIN_M,
  clampParallelSpacing,
  type ParallelSide,
} from '../engine/parallelOffset';

type Props = {
  tool: Tool;
  roadLevel: RoadLevel;
  drawGrade: FeatureGrade;
  pathDrawMode: PathDrawMode;
  parallelEnabled: boolean;
  parallelSpacingM: number;
  parallelSide: ParallelSide;
  eraserTarget: EraserTarget;
  canUndo: boolean;
  onToolChange: (tool: Tool) => void;
  onRoadLevelChange: (level: RoadLevel) => void;
  onDrawGradeChange: (grade: FeatureGrade) => void;
  onPathDrawModeChange: (mode: PathDrawMode) => void;
  onParallelEnabledChange: (on: boolean) => void;
  onParallelSpacingChange: (m: number) => void;
  onParallelSideChange: (side: ParallelSide) => void;
  onEraserTargetChange: (target: EraserTarget) => void;
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
  parallelEnabled,
  parallelSpacingM,
  parallelSide,
  eraserTarget,
  canUndo,
  onToolChange,
  onRoadLevelChange,
  onDrawGradeChange,
  onPathDrawModeChange,
  onParallelEnabledChange,
  onParallelSpacingChange,
  onParallelSideChange,
  onEraserTargetChange,
  onUndo,
}: Props) {
  const showPath = tool === 'road' || tool === 'railway';
  const showEraser = tool === 'eraser';

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

      {showEraser && (
        <div className="floating-dock-row floating-dock-sub" role="radiogroup" aria-label="橡皮目标">
          {ERASER_TARGETS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="radio"
              aria-checked={eraserTarget === t.id}
              className={eraserTarget === t.id ? 'dock-btn active' : 'dock-btn'}
              onClick={() => onEraserTargetChange(t.id)}
              title={t.hint}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {showPath && (
        <>
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
            <button
              type="button"
              className={parallelEnabled ? 'dock-btn active' : 'dock-btn'}
              onClick={() => onParallelEnabledChange(!parallelEnabled)}
              title="平行模式（独立于直线/弯道）"
            >
              平行
            </button>
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

          {parallelEnabled && (
            <div className="floating-dock-row floating-dock-sub">
              {PARALLEL_SIDES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={parallelSide === s.id ? 'dock-btn active' : 'dock-btn'}
                  onClick={() => onParallelSideChange(s.id)}
                  title={s.desc}
                >
                  {s.label}
                </button>
              ))}
              <button
                type="button"
                className="dock-btn"
                onClick={() =>
                  onParallelSpacingChange(clampParallelSpacing(parallelSpacingM - 2))
                }
              >
                −距
              </button>
              <label className="dock-spacing">
                <input
                  type="number"
                  min={PARALLEL_SPACING_MIN_M}
                  max={PARALLEL_SPACING_MAX_M}
                  step={2}
                  value={parallelSpacingM}
                  onChange={(e) =>
                    onParallelSpacingChange(clampParallelSpacing(Number(e.target.value)))
                  }
                  title={`默认 ${DEFAULT_PARALLEL_SPACING_M} m`}
                />
                <span>m</span>
              </label>
              <button
                type="button"
                className="dock-btn"
                onClick={() =>
                  onParallelSpacingChange(clampParallelSpacing(parallelSpacingM + 2))
                }
              >
                +距
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
