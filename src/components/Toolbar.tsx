import { useState, type ReactNode } from 'react';
import type {
  EraserTarget,
  FeatureGrade,
  PathDrawMode,
  RailKind,
  RoadLevel,
  StationStyle,
  Tool,
} from '../types';
import {
  ERASER_TARGETS,
  FEATURE_GRADES,
  PATH_DRAW_MODES,
  PATH_GUIDED_TOOLS,
  RAIL_KINDS,
  ROAD_STYLES,
  TERRAIN_BRUSH_TOOLS,
  clampGrade,
  formatGrade,
} from '../types';
import {
  CHENGDU_METRO_PRESETS,
  CHENGDU_TRAM_PRESETS,
} from '../constants/metroPresets';
import {
  PARALLEL_SIDES,
  PARALLEL_SPACING_MAX_M,
  PARALLEL_SPACING_MIN_M,
  clampParallelSpacing,
  type ParallelSide,
} from '../engine/parallelOffset';
import {
  GlyphEraser,
  GlyphFacility,
  GlyphFerry,
  GlyphGreen,
  GlyphLabel,
  GlyphLand,
  GlyphPathCurve,
  GlyphPathStraight,
  GlyphRail,
  GlyphRiverLine,
  GlyphRoadLevel,
  GlyphStationDot,
  GlyphStationRect,
  GlyphStationRound,
  GlyphUndo,
  GlyphWater,
} from './ToolbarGlyphs';

type Props = {
  tool: Tool;
  roadLevel: RoadLevel;
  railKind: RailKind;
  metroColor: string;
  lineName: string;
  stationStyle: StationStyle;
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
  onRailKindChange: (kind: RailKind) => void;
  onMetroColorChange: (color: string) => void;
  onLineNameChange: (name: string) => void;
  onStationStyleChange: (style: StationStyle) => void;
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

type DrawerId = 'terrain' | 'transit' | 'mark' | 'facility';
type TransitDrawer = 'road' | 'rail' | 'water';

const ROAD_LEVELS = Object.entries(ROAD_STYLES) as [
  RoadLevel,
  (typeof ROAD_STYLES)[RoadLevel],
][];

const isTerrainBrush = (t: Tool) => TERRAIN_BRUSH_TOOLS.includes(t) || t === 'eraser';
const isPathGuided = (t: Tool) => PATH_GUIDED_TOOLS.includes(t);

function Drawer({
  id,
  title,
  open,
  onToggle,
  children,
  badge,
}: {
  id: DrawerId;
  title: string;
  open: boolean;
  onToggle: (id: DrawerId) => void;
  children: ReactNode;
  badge?: string;
}) {
  return (
    <section className={`tb-drawer ${open ? 'open' : ''}`}>
      <button type="button" className="tb-drawer-head" onClick={() => onToggle(id)}>
        <span className="tb-drawer-title">{title}</span>
        {badge ? <span className="tb-drawer-badge">{badge}</span> : null}
        <span className="tb-drawer-chevron" aria-hidden>
          {open ? '▾' : '▸'}
        </span>
      </button>
      {open ? <div className="tb-drawer-body">{children}</div> : null}
    </section>
  );
}

function Tile({
  label,
  active,
  disabled,
  soon,
  title,
  onClick,
  glyph,
  hotkey,
}: {
  label: string;
  active?: boolean;
  disabled?: boolean;
  soon?: boolean;
  title?: string;
  onClick?: () => void;
  glyph: ReactNode;
  hotkey?: string;
}) {
  return (
    <button
      type="button"
      className={`tb-tile${active ? ' active' : ''}${soon ? ' soon' : ''}`}
      disabled={disabled || soon}
      title={title ?? (soon ? '即将推出' : label)}
      onClick={onClick}
    >
      <span className="tb-tile-glyph">{glyph}</span>
      <span className="tb-tile-label">{label}</span>
      {hotkey ? <span className="tb-tile-hotkey">{hotkey}</span> : null}
      {soon ? <span className="tb-tile-soon">后</span> : null}
    </button>
  );
}

export function Toolbar({
  tool,
  roadLevel,
  railKind,
  metroColor,
  lineName,
  stationStyle,
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
  onRailKindChange,
  onMetroColorChange,
  onLineNameChange,
  onStationStyleChange,
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
  const [open, setOpen] = useState<Record<DrawerId, boolean>>({
    terrain: true,
    transit: true,
    mark: false,
    facility: false,
  });
  const [transitOpen, setTransitOpen] = useState<TransitDrawer>(
    tool === 'railway' ? 'rail' : 'road',
  );

  const toggle = (id: DrawerId) => {
    setOpen((o) => ({ ...o, [id]: !o[id] }));
  };

  const selectTransit = (panel: TransitDrawer) => {
    setTransitOpen(panel);
    setOpen((o) => ({ ...o, transit: true }));
  };

  return (
    <aside
      className="toolbar toolbar-game"
      onMouseDown={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest('button') && !t.closest('input')) e.preventDefault();
      }}
    >
      <div className="tb-sticky">
        <div className="tb-top">
          <p className="toolbar-kicker">图板</p>
          <button
            type="button"
            className="tb-undo"
            onClick={onUndo}
            disabled={!canUndo}
            title="撤销 · Ctrl/⌘ Z"
          >
            <GlyphUndo />
            <span>撤销</span>
          </button>
        </div>

        <div className="mode-switch mode-switch-compact" role="group" aria-label="鼠标左键模式">
          <button
            type="button"
            className={tool === 'pan' ? 'mode-btn active' : 'mode-btn'}
            onClick={() => onToolChange('pan')}
            title="拖图 · H"
          >
            <span className="mode-emoji" aria-hidden>
              ✋
            </span>
            <span className="mode-label">拖动</span>
            <kbd className="mode-kbd">H</kbd>
          </button>
          <button
            type="button"
            className={tool === 'select' ? 'mode-btn active' : 'mode-btn'}
            onClick={() => onToolChange('select')}
            title="编辑 · V"
          >
            <span className="mode-emoji" aria-hidden>
              ✏️
            </span>
            <span className="mode-label">编辑</span>
            <kbd className="mode-kbd">V</kbd>
          </button>
        </div>
        <p className="mode-hint">
          {tool === 'pan'
            ? '左键拖图 · WASD'
            : tool === 'select'
              ? '选中 / 改顶点'
              : '绘制中 · 空格拖图'}
        </p>
      </div>

      <div className="tb-scroll">
      <Drawer id="terrain" title="地貌" open={open.terrain} onToggle={toggle}>
        <div className="tb-tile-grid">
          <Tile
            label="陆地"
            hotkey="1"
            active={tool === 'land'}
            glyph={<GlyphLand active={tool === 'land'} />}
            title="陆地刷 · 1"
            onClick={() => onToolChange('land')}
          />
          <Tile
            label="水域"
            hotkey="2"
            active={tool === 'ocean'}
            glyph={<GlyphWater active={tool === 'ocean'} />}
            title="水域刷 · 2"
            onClick={() => onToolChange('ocean')}
          />
          <Tile
            label="绿地"
            hotkey="3"
            active={tool === 'mountain'}
            glyph={<GlyphGreen active={tool === 'mountain'} />}
            title="绿地刷 · 3"
            onClick={() => onToolChange('mountain')}
          />
          <Tile
            label="橡皮"
            hotkey="4"
            active={tool === 'eraser'}
            glyph={<GlyphEraser active={tool === 'eraser'} />}
            title="按类型擦除 · 4"
            onClick={() => onToolChange('eraser')}
          />
          <Tile
            label="河道线"
            hotkey="5"
            active={tool === 'river'}
            glyph={<GlyphRiverLine active={tool === 'river'} />}
            title="河道中心线 · 5"
            onClick={() => onToolChange('river')}
          />
        </div>

        {isTerrainBrush(tool) && (
          <div className="tb-options">
            {tool === 'eraser' && (
              <>
                <p className="option-label">
                  擦除目标 <span className="option-hint">1–5</span>
                </p>
                <div className="chip-row" role="radiogroup" aria-label="擦除目标">
                  {ERASER_TARGETS.map((t, i) => (
                    <button
                      key={t.id}
                      type="button"
                      role="radio"
                      aria-checked={eraserTarget === t.id}
                      className={eraserTarget === t.id ? 'chip active' : 'chip'}
                      onClick={() => onEraserTargetChange(t.id)}
                      title={`${t.hint} · ${i + 1}`}
                    >
                      <kbd className="chip-kbd">{i + 1}</kbd>
                      {t.label}
                    </button>
                  ))}
                </div>
              </>
            )}
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
          </div>
        )}
      </Drawer>

      <Drawer
        id="transit"
        title="交通"
        open={open.transit}
        onToggle={toggle}
        badge={tool === 'road' || tool === 'railway' ? '绘' : undefined}
      >
        <div className="tb-subtabs" role="tablist" aria-label="交通大类">
          {(
            [
              ['road', '道路'],
              ['rail', '轨道'],
              ['water', '航运'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={transitOpen === id}
              className={transitOpen === id ? 'tb-subtab active' : 'tb-subtab'}
              onClick={() => {
                selectTransit(id);
                if (id === 'road') onToolChange('road');
                if (id === 'rail') onToolChange('railway');
              }}
            >
              {label}
            </button>
          ))}
        </div>

        {transitOpen === 'road' && (
          <div className="tb-panel">
            <p className="option-label">
              等级 <span className="option-hint">1–5</span>
            </p>
            <div className="tb-tile-grid">
              {ROAD_LEVELS.map(([id, style], i) => (
                <Tile
                  key={id}
                  label={style.label}
                  hotkey={String(i + 1)}
                  active={tool === 'road' && roadLevel === id}
                  glyph={
                    <GlyphRoadLevel level={id} active={tool === 'road' && roadLevel === id} />
                  }
                  title={`${style.label} · ${i + 1}`}
                  onClick={() => {
                    selectTransit('road');
                    onRoadLevelChange(id);
                    onToolChange('road');
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {transitOpen === 'rail' && (
          <div className="tb-panel">
            <p className="option-label">
              线路 <span className="option-hint">1–4</span>
            </p>
            <div className="tb-tile-grid">
              {RAIL_KINDS.map((r, i) => (
                <Tile
                  key={r.id}
                  label={r.label}
                  hotkey={String(i + 1)}
                  active={tool === 'railway' && railKind === r.id}
                  glyph={<GlyphRail active={tool === 'railway' && railKind === r.id} kind={r.id} />}
                  title={`${r.hint} · ${i + 1}`}
                  onClick={() => {
                    selectTransit('rail');
                    onRailKindChange(r.id);
                    onToolChange('railway');
                  }}
                />
              ))}
            </div>
            {(tool === 'railway' || tool === 'station') &&
              (railKind === 'metro' || railKind === 'tram') && (
              <div className="tb-options">
                <p className="option-label">
                  线路名 <span className="option-hint">可自定义</span>
                </p>
                <input
                  className="tb-line-name"
                  type="text"
                  value={lineName}
                  placeholder={railKind === 'metro' ? '如 1号线' : '如 蓉2号线'}
                  maxLength={24}
                  onChange={(e) => onLineNameChange(e.target.value)}
                />
                <div className="chip-row metro-swatches">
                  {(railKind === 'metro' ? CHENGDU_METRO_PRESETS : CHENGDU_TRAM_PRESETS).map(
                    (p) => (
                      <button
                        key={p.id}
                        type="button"
                        className={metroColor === p.color ? 'swatch active' : 'swatch'}
                        style={{ background: p.color }}
                        title={p.label}
                        onClick={() => onMetroColorChange(p.color)}
                      />
                    ),
                  )}
                </div>
              </div>
            )}
            <p className="option-label">站点</p>
            <div className="tb-tile-grid">
              <Tile
                label="铁路站"
                soon
                glyph={<GlyphStationRect />}
                title="矩形站台 · 即将推出"
              />
              <Tile
                label="地铁站"
                active={tool === 'station' && stationStyle === 'pill'}
                glyph={
                  <GlyphStationRound
                    active={tool === 'station' && stationStyle === 'pill'}
                  />
                }
                title="白底黑边圆点 · 吸附地铁线"
                onClick={() => {
                  selectTransit('rail');
                  onRailKindChange('metro');
                  onStationStyleChange('pill');
                  onToolChange('station');
                }}
              />
              <Tile
                label="有轨站"
                active={tool === 'station' && stationStyle === 'dot'}
                glyph={
                  <GlyphStationDot
                    active={tool === 'station' && stationStyle === 'dot'}
                    color={metroColor}
                  />
                }
                title="小圆点 · 吸附有轨线"
                onClick={() => {
                  selectTransit('rail');
                  onRailKindChange('tram');
                  onStationStyleChange('dot');
                  onToolChange('station');
                }}
              />
            </div>
          </div>
        )}
        {transitOpen === 'water' && (
          <div className="tb-panel">
            <div className="tb-tile-grid">
              <Tile
                label="轮渡"
                soon
                glyph={<GlyphFerry />}
                title="蓝色虚线轮渡 · 即将推出"
              />
            </div>
            <p className="tool-note">航运目前预留轮渡线路</p>
          </div>
        )}

        {isPathGuided(tool) && (
          <div className="tb-options">
            <p className="option-label">画法</p>
            <div className="tb-tile-grid">
              {PATH_DRAW_MODES.map((m) => (
                <Tile
                  key={m.id}
                  label={m.id === 'curve' ? '弯道' : m.label}
                  active={pathDrawMode === m.id}
                  glyph={
                    m.id === 'curve' ? (
                      <GlyphPathCurve active={pathDrawMode === 'curve'} />
                    ) : (
                      <GlyphPathStraight active={pathDrawMode === 'straight'} />
                    )
                  }
                  title={m.desc}
                  onClick={() => onPathDrawModeChange(m.id)}
                />
              ))}
            </div>
            <p className="option-label">标高 {formatGrade(drawGrade)}</p>
            <div className="chip-row">
              {FEATURE_GRADES.map((g) => (
                <button
                  key={g}
                  type="button"
                  className={drawGrade === g ? 'chip active' : 'chip'}
                  onClick={() => onDrawGradeChange(clampGrade(g))}
                >
                  {g > 0 ? `+${g}` : `${g}`}
                </button>
              ))}
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={showJunctions}
                onChange={(e) => onShowJunctionsChange(e.target.checked)}
              />
              路口节点（选择时自动显示；勾选则始终显示）
            </label>
            {tool === 'road' && (
              <>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={parallelEnabled}
                    onChange={(e) => onParallelEnabledChange(e.target.checked)}
                  />
                  平行线
                </label>
                {parallelEnabled && (
                  <>
                    <label className="brush-slider">
                      <span>间距 {parallelSpacingM} m</span>
                      <input
                        type="range"
                        min={PARALLEL_SPACING_MIN_M}
                        max={PARALLEL_SPACING_MAX_M}
                        step={1}
                        value={parallelSpacingM}
                        onChange={(e) =>
                          onParallelSpacingChange(clampParallelSpacing(Number(e.target.value)))
                        }
                      />
                    </label>
                    <div className="chip-row">
                      {PARALLEL_SIDES.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          className={parallelSide === s.id ? 'chip active' : 'chip'}
                          onClick={() => onParallelSideChange(s.id)}
                        >
                          {s.label}
                        </button>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}
          </div>
        )}
      </Drawer>

      <Drawer id="mark" title="标记" open={open.mark} onToggle={toggle}>
        <div className="tb-tile-grid">
          <Tile
            label="标注"
            active={tool === 'label'}
            glyph={<GlyphLabel active={tool === 'label'} />}
            onClick={() => onToolChange('label')}
          />
          <Tile label="尺度" soon glyph={<GlyphLabel />} title="测距 / 尺度 · 即将推出" />
        </div>
      </Drawer>

      <Drawer id="facility" title="设施" open={open.facility} onToggle={toggle} badge="预留">
        <div className="tb-tile-grid">
          <Tile label="建筑" soon glyph={<GlyphFacility />} />
          <Tile label="服务" soon glyph={<GlyphFacility />} />
          <Tile label="枢纽" soon glyph={<GlyphFacility />} />
        </div>
        <p className="tool-note">设施玩法还在构思，先占位分类</p>
      </Drawer>
      </div>
    </aside>
  );
}
