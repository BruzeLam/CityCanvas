import { useState } from 'react';
import type { EraserTarget, FeatureGrade, PathDrawMode, RoadLevel, Tool } from '../types';
import {
  ERASER_TARGETS,
  FEATURE_GRADES,
  PATH_DRAW_MODES,
  PATH_GUIDED_TOOLS,
  ROAD_STYLES,
  TERRAIN_BRUSH_TOOLS,
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
  brushSizeM: number;
  brushThickness: number;
  eraserTarget: EraserTarget;
  showJunctions: boolean;
  canUndo: boolean;
  onToolChange: (tool: Tool) => void;
  onRoadLevelChange: (level: RoadLevel) => void;
  onDrawGradeChange: (grade: FeatureGrade) => void;
  onPathDrawModeChange: (mode: PathDrawMode) => void;
  onParallelEnabledChange: (on: boolean) => void;
  onParallelSpacingChange: (m: number) => void;
  onParallelSideChange: (side: ParallelSide) => void;
  onBrushSizeChange: (m: number) => void;
  onBrushThicknessChange: (t: number) => void;
  onEraserTargetChange: (target: EraserTarget) => void;
  onShowJunctionsChange: (show: boolean) => void;
  onUndo: () => void;
};

const TERRAIN_TOOLS: { id: Tool; label: string; icon: string; hint: string }[] = [
  { id: 'land', label: '陆地', icon: '🏝️', hint: '陆地刷 · 擦回米白底图' },
  { id: 'ocean', label: '水域', icon: '🌊', hint: '水域刷 · 海/湖/河同色，形状自辨' },
  { id: 'mountain', label: '绿地', icon: '🌲', hint: '绿地/山地刷 · 平面绿色，无等高线' },
  { id: 'eraser', label: '橡皮', icon: '🧹', hint: '橡皮刷 · 单选目标，按类型擦除' },
  { id: 'river', label: '河道线', icon: '💧', hint: '可选中心线标注；面状水域请用水域刷' },
];

const PATH_MODE_ICONS: Record<PathDrawMode, string> = {
  straight: '／',
  curve: '⌒',
};

const ROAD_LEVEL_ICONS: Record<RoadLevel, string> = {
  expressway: '🛣️',
  arterial: '🛤️',
  collector: '➖',
  local: '┈',
};

const ROAD_LEVELS = Object.entries(ROAD_STYLES) as [
  RoadLevel,
  (typeof ROAD_STYLES)[RoadLevel],
][];

const isTerrainBrush = (t: Tool) => TERRAIN_BRUSH_TOOLS.includes(t) || t === 'eraser';
const isPathGuided = (t: Tool) => PATH_GUIDED_TOOLS.includes(t);

type SectionId = 'view' | 'terrain' | 'network' | 'label' | 'keys';

export function Toolbar({
  tool,
  roadLevel,
  drawGrade,
  pathDrawMode,
  parallelEnabled,
  parallelSpacingM,
  parallelSide,
  brushSizeM,
  brushThickness,
  eraserTarget,
  showJunctions,
  canUndo,
  onToolChange,
  onRoadLevelChange,
  onDrawGradeChange,
  onPathDrawModeChange,
  onParallelEnabledChange,
  onParallelSpacingChange,
  onParallelSideChange,
  onBrushSizeChange,
  onBrushThicknessChange,
  onEraserTargetChange,
  onShowJunctionsChange,
  onUndo,
}: Props) {
  const [open, setOpen] = useState<Record<SectionId, boolean>>({
    view: true,
    terrain: true,
    network: true,
    label: true,
    keys: true,
  });

  const toggle = (id: SectionId) => {
    setOpen((o) => ({ ...o, [id]: !o[id] }));
  };

  return (
    <aside
      className="toolbar"
      onMouseDown={(e) => {
        // 按钮点击不抢焦点，避免空格误触；滑条仍可聚焦
        const t = e.target as HTMLElement;
        if (t.closest('button')) e.preventDefault();
      }}
    >
      <p className="toolbar-kicker">图板</p>

      <div className="mode-switch" role="group" aria-label="鼠标左键模式">
        <button
          type="button"
          className={tool === 'pan' ? 'mode-btn active' : 'mode-btn'}
          onClick={() => onToolChange('pan')}
          title="左键拖动地图 · 快捷键 H · 空格也可临时拖动"
        >
          <span className="btn-emoji" aria-hidden>
            ✋
          </span>
          拖动
        </button>
        <button
          type="button"
          className={tool === 'select' ? 'mode-btn active' : 'mode-btn'}
          onClick={() => onToolChange('select')}
          title="左键选中要素、拖动顶点 · 快捷键 V"
        >
          <span className="btn-emoji" aria-hidden>
            ✏️
          </span>
          编辑
        </button>
      </div>
      <p className="mode-hint">
        {tool === 'pan'
          ? '左键拖图 · WASD 平移 · H'
          : tool === 'select'
            ? '左键选中 / 改顶点 · V'
            : '绘制中 · 空格临时拖图 · WASD 平移'}
      </p>

      <section className="tool-section">
        <button type="button" className="section-toggle" onClick={() => toggle('view')}>
          <span>工具</span>
          <span className="section-chevron">{open.view ? '−' : '+'}</span>
        </button>
        {open.view && (
          <div className="tool-grid">
            <button
              type="button"
              className="tool-cell"
              onClick={onUndo}
              disabled={!canUndo}
              title="撤销上一步 · Ctrl/⌘ Z"
            >
              <span className="btn-emoji" aria-hidden>
                ↩️
              </span>
              撤销
            </button>
            <button type="button" className="tool-cell soon" disabled title="即将推出">
              <span className="btn-emoji" aria-hidden>
                🏢
              </span>
              建筑
            </button>
            <button type="button" className="tool-cell soon" disabled title="即将推出">
              <span className="btn-emoji" aria-hidden>
                🚌
              </span>
              公交
            </button>
          </div>
        )}
      </section>

      <section className="tool-section">
        <button type="button" className="section-toggle" onClick={() => toggle('terrain')}>
          <span>地貌</span>
          <span className="section-chevron">{open.terrain ? '−' : '+'}</span>
        </button>
        {open.terrain && (
          <>
            <div className="tool-grid">
              {TERRAIN_TOOLS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={tool === t.id ? 'tool-cell active' : 'tool-cell'}
                  onClick={() => onToolChange(t.id)}
                  title={t.hint}
                >
                  <span className="btn-emoji" aria-hidden>
                    {t.icon}
                  </span>
                  {t.label}
                </button>
              ))}
            </div>
            {isTerrainBrush(tool) && (
              <div className="option-block">
                {tool === 'eraser' && (
                  <>
                    <p className="option-label">擦除目标</p>
                    <div className="tool-grid tool-grid-compact" role="radiogroup" aria-label="擦除目标">
                      {ERASER_TARGETS.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          role="radio"
                          aria-checked={eraserTarget === t.id}
                          className={
                            eraserTarget === t.id ? 'tool-cell active' : 'tool-cell'
                          }
                          onClick={() => onEraserTargetChange(t.id)}
                          title={t.hint}
                        >
                          {t.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                <p className="option-label">毛边刷</p>
                <label className="brush-slider">
                  <span>大小 {Math.round(brushSizeM)} m</span>
                  <input
                    type="range"
                    min={40}
                    max={400}
                    step={10}
                    value={brushSizeM}
                    onChange={(e) => onBrushSizeChange(Number(e.target.value))}
                  />
                </label>
                {(tool !== 'eraser' || eraserTarget === 'terrain') && (
                  <label className="brush-slider">
                    <span>厚度 {brushThickness.toFixed(2)}</span>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={brushThickness}
                      onChange={(e) => onBrushThicknessChange(Number(e.target.value))}
                    />
                  </label>
                )}
                <p className="tool-note">
                  {tool === 'eraser'
                    ? ERASER_TARGETS.find((t) => t.id === eraserTarget)?.hint ??
                      '单选一类擦除，不会误伤其他图层'
                    : '底图默认全陆地 · 绿地为平面色块，无等高线'}
                </p>
              </div>
            )}
          </>
        )}
      </section>

      <section className="tool-section">
        <button type="button" className="section-toggle" onClick={() => toggle('network')}>
          <span>路网</span>
          <span className="section-chevron">{open.network ? '−' : '+'}</span>
        </button>
        {open.network && (
          <>
            <div className="tool-grid">
              <button
                type="button"
                className={tool === 'road' ? 'tool-cell active' : 'tool-cell'}
                onClick={() => onToolChange('road')}
              >
                <span className="btn-emoji" aria-hidden>
                  🛣️
                </span>
                道路
              </button>
              <button
                type="button"
                className={tool === 'railway' ? 'tool-cell active' : 'tool-cell'}
                onClick={() => onToolChange('railway')}
              >
                <span className="btn-emoji" aria-hidden>
                  🚆
                </span>
                铁路
              </button>
            </div>

            {tool === 'road' && (
              <div className="option-block">
                <p className="option-label">等级</p>
                <div className="chip-row">
                  {ROAD_LEVELS.map(([id, style]) => (
                    <button
                      key={id}
                      type="button"
                      className={roadLevel === id ? 'chip active' : 'chip'}
                      onClick={() => onRoadLevelChange(id)}
                    >
                      <span className="btn-emoji" aria-hidden>
                        {ROAD_LEVEL_ICONS[id]}
                      </span>
                      <span
                        className="road-swatch"
                        style={{ background: style.color, borderColor: style.casing }}
                      />
                      {style.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {isPathGuided(tool) && (
              <>
                <div className="option-block">
                  <p className="option-label">路径</p>
                  <div className="chip-row">
                    {PATH_DRAW_MODES.map((mode) => (
                      <button
                        key={mode.id}
                        type="button"
                        className={pathDrawMode === mode.id ? 'chip active' : 'chip'}
                        onClick={() => onPathDrawModeChange(mode.id)}
                        title={mode.desc}
                      >
                        <span className="btn-emoji" aria-hidden>
                          {PATH_MODE_ICONS[mode.id]}
                        </span>
                        {mode.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="option-block">
                  <p className="option-label">平行 · 独立开关</p>
                  <div className="chip-row">
                    <button
                      type="button"
                      className={parallelEnabled ? 'chip active' : 'chip'}
                      onClick={() => onParallelEnabledChange(!parallelEnabled)}
                      title="开启后，完成绘制时同时生成平行路（直线/弯道均可用）"
                    >
                      {parallelEnabled ? '平行 · 开' : '平行 · 关'}
                    </button>
                  </div>
                  {parallelEnabled && (
                    <>
                      <div className="chip-row" style={{ marginTop: 6 }}>
                        {PARALLEL_SIDES.map((s) => (
                          <button
                            key={s.id}
                            type="button"
                            className={parallelSide === s.id ? 'chip active' : 'chip'}
                            onClick={() => onParallelSideChange(s.id)}
                            title={s.desc}
                          >
                            {s.label}
                          </button>
                        ))}
                      </div>
                      <div className="parallel-spacing-row">
                        <label className="parallel-spacing-label">
                          间距
                          <input
                            type="number"
                            min={PARALLEL_SPACING_MIN_M}
                            max={PARALLEL_SPACING_MAX_M}
                            step={2}
                            value={parallelSpacingM}
                            onChange={(e) =>
                              onParallelSpacingChange(
                                clampParallelSpacing(Number(e.target.value)),
                              )
                            }
                          />
                          <span>m</span>
                        </label>
                        <button
                          type="button"
                          className="chip"
                          onClick={() =>
                            onParallelSpacingChange(DEFAULT_PARALLEL_SPACING_M)
                          }
                          title="恢复默认间距"
                        >
                          默认 {DEFAULT_PARALLEL_SPACING_M}
                        </button>
                      </div>
                      <p className="tool-note">
                        双侧：轨迹为中线，左右各偏半间距。单侧：保留轨迹并再画一条。
                      </p>
                    </>
                  )}
                </div>
                <div className="option-block">
                  <p className="option-label">标高 · -/=</p>
                  <div className="grade-row">
                    <button
                      type="button"
                      className="grade-step"
                      onClick={() => onDrawGradeChange(clampGrade(drawGrade - 1))}
                      title="降低一层 -"
                    >
                      −
                    </button>
                    <span className="grade-current">{formatGrade(drawGrade)}</span>
                    <button
                      type="button"
                      className="grade-step"
                      onClick={() => onDrawGradeChange(clampGrade(drawGrade + 1))}
                      title="升高一层 ="
                    >
                      +
                    </button>
                  </div>
                  <div className="chip-row grade-chips">
                    {FEATURE_GRADES.map((g) => (
                      <button
                        key={g}
                        type="button"
                        className={drawGrade === g ? 'chip active' : 'chip'}
                        onClick={() => onDrawGradeChange(g)}
                        title={formatGrade(g)}
                      >
                        {g > 0 ? `+${g}` : `${g}`}
                      </button>
                    ))}
                  </div>
                  <p className="tool-note">同层成路口 · 异层上跨/下穿</p>
                </div>
                <div className="option-block">
                  <p className="option-label">显示</p>
                  <div className="chip-row">
                    <button
                      type="button"
                      className={showJunctions ? 'chip active' : 'chip'}
                      onClick={() => onShowJunctionsChange(!showJunctions)}
                      title="路口节点圆点显隐"
                    >
                      <span className="btn-emoji" aria-hidden>
                        ◎
                      </span>
                      路口
                    </button>
                  </div>
                </div>
              </>
            )}
          </>
        )}
      </section>

      <section className="tool-section">
        <button type="button" className="section-toggle" onClick={() => toggle('label')}>
          <span>标注</span>
          <span className="section-chevron">{open.label ? '−' : '+'}</span>
        </button>
        {open.label && (
          <div className="tool-grid">
            <button
              type="button"
              className={tool === 'label' ? 'tool-cell active' : 'tool-cell'}
              onClick={() => onToolChange('label')}
            >
              <span className="btn-emoji" aria-hidden>
                🏷️
              </span>
              标注
            </button>
            <button type="button" className="tool-cell soon" disabled title="即将推出">
              <span className="btn-emoji" aria-hidden>
                📏
              </span>
              尺规
            </button>
          </div>
        )}
      </section>

      <section className="tool-section">
        <button type="button" className="section-toggle" onClick={() => toggle('keys')}>
          <span>快捷键</span>
          <span className="section-chevron">{open.keys ? '−' : '+'}</span>
        </button>
        {open.keys && (
          <div className="option-block">
            <ul className="shortcut-list">
              <li>
                <span>平移地图</span>
                <span>
                  <kbd>W</kbd> <kbd>A</kbd> <kbd>S</kbd> <kbd>D</kbd>
                </span>
              </li>
              <li>
                <span>拖动 / 编辑</span>
                <span>
                  <kbd>H</kbd> / <kbd>V</kbd>
                </span>
              </li>
              <li>
                <span>临时拖图</span>
                <kbd>Space</kbd>
              </li>
              <li>
                <span>路网标高</span>
                <span>
                  <kbd>-</kbd> / <kbd>=</kbd>
                </span>
              </li>
              <li>
                <span>关软吸附</span>
                <kbd>Alt</kbd>
              </li>
              <li>
                <span>平行间距</span>
                <span className="shortcut-note">默认 {DEFAULT_PARALLEL_SPACING_M} m</span>
              </li>
              <li>
                <span>完成折线</span>
                <kbd>Enter</kbd>
              </li>
            </ul>
          </div>
        )}
      </section>
    </aside>
  );
}
