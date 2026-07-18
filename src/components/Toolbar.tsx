import { useEffect, useState } from 'react';
import type { FeatureGrade, LandformDrawMode, PathDrawMode, RoadLevel, Tool } from '../types';
import {
  FEATURE_GRADES,
  LANDFORM_DRAW_MODES,
  LANDFORM_TOOLS,
  PATH_DRAW_MODES,
  PATH_GUIDED_TOOLS,
  ROAD_STYLES,
  clampGrade,
  formatGrade,
} from '../types';

type Props = {
  tool: Tool;
  roadLevel: RoadLevel;
  drawGrade: FeatureGrade;
  landformDrawMode: LandformDrawMode;
  pathDrawMode: PathDrawMode;
  showJunctions: boolean;
  onToolChange: (tool: Tool) => void;
  onRoadLevelChange: (level: RoadLevel) => void;
  onDrawGradeChange: (grade: FeatureGrade) => void;
  onLandformDrawModeChange: (mode: LandformDrawMode) => void;
  onPathDrawModeChange: (mode: PathDrawMode) => void;
  onShowJunctionsChange: (show: boolean) => void;
};

const VIEW_TOOLS: { id: Tool; label: string; icon: string; hint: string }[] = [
  { id: 'eraser', label: '橡皮', icon: '🧹', hint: '点击删除要素' },
];

const TERRAIN_TOOLS: { id: Tool; label: string; icon: string }[] = [
  { id: 'land', label: '陆地', icon: '🏝️' },
  { id: 'ocean', label: '海洋', icon: '🌊' },
  { id: 'mountain', label: '山地', icon: '⛰️' },
  { id: 'river', label: '河流', icon: '💧' },
];

const LANDFORM_MODE_ICONS: Record<LandformDrawMode, string> = {
  freehand: '✍️',
  polygon: '⬡',
  rectangle: '▭',
};

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

const isLandformTool = (t: Tool) => LANDFORM_TOOLS.includes(t);
const isPathGuided = (t: Tool) => PATH_GUIDED_TOOLS.includes(t);

type SectionId = 'view' | 'terrain' | 'network' | 'label';

export function Toolbar({
  tool,
  roadLevel,
  drawGrade,
  landformDrawMode,
  pathDrawMode,
  showJunctions,
  onToolChange,
  onRoadLevelChange,
  onDrawGradeChange,
  onLandformDrawModeChange,
  onPathDrawModeChange,
  onShowJunctionsChange,
}: Props) {
  const [open, setOpen] = useState<Record<SectionId, boolean>>({
    view: true,
    terrain: true,
    network: true,
    label: true,
  });

  useEffect(() => {
    if (isLandformTool(tool) || tool === 'river') {
      setOpen((o) => ({ ...o, terrain: true }));
    }
    if (isPathGuided(tool)) {
      setOpen((o) => ({ ...o, network: true }));
    }
  }, [tool]);

  const toggle = (id: SectionId) => {
    setOpen((o) => ({ ...o, [id]: !o[id] }));
  };

  return (
    <aside className="toolbar">
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
          ? '左键 = 拖地图 · H'
          : tool === 'select'
            ? '左键 = 选中 / 改顶点 · V'
            : '绘制中 · 空格可临时拖图'}
      </p>

      <section className="tool-section">
        <button type="button" className="section-toggle" onClick={() => toggle('view')}>
          <span>工具</span>
          <span className="section-chevron">{open.view ? '−' : '+'}</span>
        </button>
        {open.view && (
          <div className="tool-grid">
            {VIEW_TOOLS.map((t) => (
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
                >
                  <span className="btn-emoji" aria-hidden>
                    {t.icon}
                  </span>
                  {t.label}
                </button>
              ))}
            </div>
            {isLandformTool(tool) && (
              <div className="option-block">
                <p className="option-label">画法</p>
                <div className="chip-row">
                  {LANDFORM_DRAW_MODES.map((mode) => (
                    <button
                      key={mode.id}
                      type="button"
                      className={landformDrawMode === mode.id ? 'chip active' : 'chip'}
                      onClick={() => onLandformDrawModeChange(mode.id)}
                      title={mode.desc}
                    >
                      <span className="btn-emoji" aria-hidden>
                        {LANDFORM_MODE_ICONS[mode.id]}
                      </span>
                      {mode.label}
                    </button>
                  ))}
                </div>
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
                  {ROAD_LEVELS.map(([level, style]) => (
                    <button
                      key={level}
                      type="button"
                      className={roadLevel === level ? 'chip active' : 'chip'}
                      onClick={() => onRoadLevelChange(level)}
                    >
                      <span className="btn-emoji" aria-hidden>
                        {ROAD_LEVEL_ICONS[level]}
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
          <>
            <div className="tool-grid">
              <button
                type="button"
                className={tool === 'label' ? 'tool-cell active' : 'tool-cell'}
                onClick={() => onToolChange('label')}
              >
                <span className="btn-emoji" aria-hidden>
                  🏷️
                </span>
                文字
              </button>
            </div>
            <p className="tool-note">街区由同层道路围合自动识别</p>
          </>
        )}
      </section>
    </aside>
  );
}
