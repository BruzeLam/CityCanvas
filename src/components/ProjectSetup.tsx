import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { formatDistance } from '../constants/mapPresets';
import {
  LANDSCAPE_PRESETS,
  SIMPLE_MAP_SIZES,
  landscapePresetById,
  sampleLandscapeParams,
  type LandscapePresetId,
} from '../constants/landscapePresets';
import { useAuth } from '../context/AuthContext';
import {
  GREEN_DENSITY_MAX,
  GREEN_DENSITY_MIN,
  LAKE_DENSITY_MAX,
  LAKE_DENSITY_MIN,
  OCEAN_RATIO_MAX,
  OCEAN_RATIO_MIN,
  RIVER_DENSITY_MAX,
  RIVER_DENSITY_MIN,
  clampGreenDensity,
  clampLakeDensity,
  clampOceanRatio,
  clampRiverDensity,
  generateLandscape,
  paintTerrainPreview,
  randomTerrainSeed,
  type TerrainGenParams,
} from '../engine/terrainGen';
import { preferredTerrainCellSizeM } from '../engine/terrain';
import { randomCityName } from '../constants/cityNames';
import { api, type CloudMapSummary } from '../io/api';
import type { MapSettings } from '../types';
import { createProject } from '../types';

type Props = {
  onCreate: (project: ReturnType<typeof createProject>) => void;
  onOpenCloud: (mapId: string) => void;
  onOpenFile: () => void;
  localOnly?: boolean;
  onBack?: () => void;
};

type PreviewView = { zoom: number; panX: number; panY: number };

const DEFAULT_VIEW: PreviewView = { zoom: 1, panX: 0, panY: 0 };

export function ProjectSetup({
  onCreate,
  onOpenCloud,
  onOpenFile,
  localOnly = false,
  onBack,
}: Props) {
  const { user, logout } = useAuth();
  const [name, setName] = useState('未命名城市');
  const [sizeIdx, setSizeIdx] = useState(1);
  const [cloudMaps, setCloudMaps] = useState<CloudMapSummary[]>([]);
  const [loadingMaps, setLoadingMaps] = useState(false);

  const [presetId, setPresetId] = useState<LandscapePresetId>('coastal');
  const [terrainSeed, setTerrainSeed] = useState(() => randomTerrainSeed());
  const [fineTuneOpen, setFineTuneOpen] = useState(false);

  const [oceanEnabled, setOceanEnabled] = useState(true);
  const [oceanRatio, setOceanRatio] = useState(0.32);
  const [lakeEnabled, setLakeEnabled] = useState(true);
  const [lakeDensity, setLakeDensity] = useState(0.08);
  const [riverEnabled, setRiverEnabled] = useState(true);
  const [riverDensity, setRiverDensity] = useState(0.55);
  const [greenEnabled, setGreenEnabled] = useState(true);
  const [greenDensity, setGreenDensity] = useState(0.22);

  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewWrapRef = useRef<HTMLDivElement>(null);
  const [previewView, setPreviewView] = useState<PreviewView>(DEFAULT_VIEW);
  const previewViewRef = useRef(previewView);
  previewViewRef.current = previewView;
  const dragRef = useRef<{
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);

  const applyParams = useCallback((params: TerrainGenParams) => {
    setOceanEnabled(params.oceanEnabled);
    setOceanRatio(params.oceanRatio);
    setLakeEnabled(params.lakeEnabled);
    setLakeDensity(params.lakeDensity);
    setRiverEnabled(params.riverEnabled);
    setRiverDensity(params.riverDensity);
    setGreenEnabled(params.greenEnabled);
    setGreenDensity(params.greenDensity);
  }, []);

  // 首次 / 换预设 / 换种子：按配方落参数（微调打开时换种子仍重掷 random）
  useEffect(() => {
    const sampled = sampleLandscapeParams(presetId, terrainSeed);
    applyParams(sampled);
    setPreviewView(DEFAULT_VIEW);
  }, [presetId, terrainSeed, applyParams]);

  useEffect(() => {
    if (!onBack) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onBack();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onBack]);

  const loadCloudMaps = useCallback(async () => {
    if (!user || localOnly) {
      setCloudMaps([]);
      setLoadingMaps(false);
      return;
    }
    setLoadingMaps(true);
    try {
      const { maps } = await api.listMaps();
      setCloudMaps(maps);
    } catch {
      setCloudMaps([]);
    } finally {
      setLoadingMaps(false);
    }
  }, [user, localOnly]);

  useEffect(() => {
    loadCloudMaps();
  }, [loadCloudMaps]);

  const size = SIMPLE_MAP_SIZES[sizeIdx] ?? SIMPLE_MAP_SIZES[1];
  const settings: MapSettings = useMemo(
    () => ({
      widthM: size.widthM,
      heightM: size.heightM,
      scale: size.scale,
    }),
    [size],
  );

  const genParams = useMemo((): TerrainGenParams => {
    return {
      seed: terrainSeed,
      oceanEnabled,
      oceanRatio: clampOceanRatio(oceanRatio),
      lakeEnabled,
      lakeDensity: clampLakeDensity(lakeDensity),
      riverEnabled,
      riverDensity: clampRiverDensity(riverDensity),
      greenEnabled,
      greenDensity: clampGreenDensity(greenDensity),
    };
  }, [
    terrainSeed,
    oceanEnabled,
    oceanRatio,
    lakeEnabled,
    lakeDensity,
    riverEnabled,
    riverDensity,
    greenEnabled,
    greenDensity,
  ]);

  const landscapePreview = useMemo(() => {
    return generateLandscape(
      settings,
      genParams,
      preferredTerrainCellSizeM(settings),
    );
  }, [settings, genParams]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    const wrap = previewWrapRef.current;
    if (!canvas || !wrap) return;

    const paint = () => {
      const aspect = settings.widthM / settings.heightM;
      const rect = wrap.getBoundingClientRect();
      const maxW = Math.max(280, Math.floor(rect.width - 8));
      const maxH = Math.max(220, Math.floor(rect.height - 28));
      let w = maxW;
      let h = Math.round(maxW / aspect);
      if (h > maxH) {
        h = maxH;
        w = Math.round(maxH * aspect);
      }
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      paintTerrainPreview(canvas, landscapePreview.terrain);
    };

    paint();
    window.addEventListener('resize', paint);
    return () => window.removeEventListener('resize', paint);
  }, [landscapePreview, settings.widthM, settings.heightM]);

  // 滚轮缩放需 non-passive，否则浏览器会拦截 preventDefault
  useEffect(() => {
    const wrap = previewWrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setPreviewView((v) => ({
        ...v,
        zoom: Math.max(1, Math.min(3.5, +(v.zoom + delta).toFixed(2))),
      }));
    };
    wrap.addEventListener('wheel', onWheel, { passive: false });
    return () => wrap.removeEventListener('wheel', onWheel);
  }, []);

  const clampPan = (panX: number, panY: number, zoom: number) => {
    const limit = 120 * zoom;
    return {
      panX: Math.max(-limit, Math.min(limit, panX)),
      panY: Math.max(-limit, Math.min(limit, panY)),
    };
  };

  const onPreviewPointerDown = (e: ReactPointerEvent) => {
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const v = previewViewRef.current;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: v.panX,
      originY: v.panY,
    };
  };

  const onPreviewPointerMove = (e: ReactPointerEvent) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    setPreviewView((v) => {
      const next = clampPan(
        dragRef.current!.originX + dx,
        dragRef.current!.originY + dy,
        v.zoom,
      );
      return { zoom: v.zoom, ...next };
    });
  };

  const onPreviewPointerUp = () => {
    dragRef.current = null;
  };

  const selectPreset = (id: LandscapePresetId) => {
    setPresetId(id);
    setTerrainSeed(randomTerrainSeed());
  };

  const reshuffleSeed = () => {
    setTerrainSeed(randomTerrainSeed());
  };

  const handleCreate = () => {
    const params = genParams;
    const { terrain } = generateLandscape(settings, params);
    onCreate(
      createProject(name.trim() || '未命名城市', settings, 'navigation', {
        terrain,
        terrainSeed: {
          seed: params.seed,
          oceanEnabled: params.oceanEnabled,
          oceanRatio: params.oceanRatio,
          lakeEnabled: params.lakeEnabled,
          lakeDensity: params.lakeDensity,
          riverEnabled: params.riverEnabled,
          riverDensity: params.riverDensity,
          greenEnabled: params.greenEnabled,
          greenDensity: params.greenDensity,
        },
      }),
    );
  };

  const handleDeleteCloud = async (id: string, mapName: string) => {
    if (!confirm(`删除云端地图「${mapName}」？此操作不可恢复。`)) return;
    await api.deleteMap(id);
    await loadCloudMaps();
  };

  if (!user && !localOnly) return null;

  const anyWater = oceanEnabled || lakeEnabled || riverEnabled;
  const waterPct = anyWater
    ? Math.round((landscapePreview.waterPct || 0) * 100)
    : 0;
  const greenPct = greenEnabled
    ? Math.round((landscapePreview.greenPct || 0) * 100)
    : 0;
  const landPct = Math.max(0, 100 - waterPct - greenPct);
  const activePreset = landscapePresetById(presetId);

  return (
    <div className="setup-overlay">
      <div className="setup-card setup-card-wide setup-card-gen">
        <header className="setup-header setup-header-row">
          <div>
            <h1>CityCanvas</h1>
            <p>选场景 → 看预览 → 开画（高级参数可微调）</p>
          </div>
          <div className="setup-user">
            {onBack && (
              <button type="button" className="link-btn overlay-back" onClick={onBack}>
                ← 返回地图
              </button>
            )}
            <span>{user && !localOnly ? user.displayName || user.email : '本地模式'}</span>
            {user && !localOnly ? (
              <button type="button" className="link-btn" onClick={logout}>
                退出
              </button>
            ) : null}
          </div>
        </header>

        <div className="setup-body setup-body-gen">
          {user && !localOnly ? (
            <section className="cloud-maps-section">
              <div className="cloud-maps-head">
                <strong>我的云端地图</strong>
                <button type="button" className="link-btn" onClick={loadCloudMaps}>
                  刷新
                </button>
              </div>
              {loadingMaps ? (
                <p className="muted">加载中…</p>
              ) : cloudMaps.length === 0 ? (
                <p className="muted">还没有云端地图，在下方创建第一张吧</p>
              ) : (
                <ul className="cloud-map-list">
                  {cloudMaps.map((m) => (
                    <li key={m.id} className="cloud-map-item">
                      <button
                        type="button"
                        className="cloud-map-open"
                        onClick={() => onOpenCloud(m.id)}
                      >
                        <span className="cloud-map-name">{m.name}</span>
                        <span className="cloud-map-meta">
                          {formatDistance(m.widthM)} × {formatDistance(m.heightM)} ·{' '}
                          {m.featureCount} 要素
                        </span>
                        <span className="cloud-map-date">
                          更新于 {new Date(m.updatedAt + 'Z').toLocaleString('zh-CN')}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="cloud-map-delete"
                        title="删除"
                        onClick={() => handleDeleteCloud(m.id, m.name)}
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ) : (
            <section className="cloud-maps-section">
              <p className="muted">本地模式：进度自动写入浏览器缓存，刷新后继续编辑</p>
            </section>
          )}

          <div className="gen-main">
            <div className="gen-left">
              <label className="setup-field">
                <span>城市名称</span>
                <div className="city-title-wrap setup-name-wrap">
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="例如：湾城岛"
                  />
                  <button
                    type="button"
                    className="city-title-dice"
                    title="随机架空城市名"
                    aria-label="随机生成城市名"
                    onClick={() => setName(randomCityName(name))}
                  >
                    🎲
                  </button>
                </div>
              </label>

              <fieldset className="setup-field">
                <span>地图大小</span>
                <div className="preset-grid gen-size-grid">
                  {SIMPLE_MAP_SIZES.map((p, i) => (
                    <button
                      key={p.label}
                      type="button"
                      className={sizeIdx === i ? 'active' : ''}
                      onClick={() => setSizeIdx(i)}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <p className="muted gen-size-hint">
                  {formatDistance(settings.widthM)} × {formatDistance(settings.heightM)} · 1 :
                  {settings.scale.toLocaleString()}
                </p>
              </fieldset>

              <fieldset className="setup-field">
                <span>场景</span>
                <div className="landscape-preset-grid">
                  {LANDSCAPE_PRESETS.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={
                        presetId === p.id
                          ? 'landscape-preset-card active'
                          : 'landscape-preset-card'
                      }
                      onClick={() => selectPreset(p.id)}
                    >
                      <strong>{p.label}</strong>
                      <em>{p.blurb}</em>
                    </button>
                  ))}
                </div>
              </fieldset>

              <button
                type="button"
                className="gen-fine-toggle"
                aria-expanded={fineTuneOpen}
                onClick={() => setFineTuneOpen((o) => !o)}
              >
                {fineTuneOpen ? '收起微调' : '微调海 / 湖 / 河 / 绿'}
                <span aria-hidden>{fineTuneOpen ? '▴' : '▾'}</span>
              </button>

              {fineTuneOpen && (
                <div className="gen-fine-panel">
                  <label className="terrain-seed-check">
                    <input
                      type="checkbox"
                      checked={oceanEnabled}
                      onChange={(e) => setOceanEnabled(e.target.checked)}
                    />
                    <span>有海洋</span>
                  </label>
                  {oceanEnabled && (
                    <label className="terrain-seed-row">
                      <span>海洋比例</span>
                      <input
                        type="range"
                        min={OCEAN_RATIO_MIN}
                        max={OCEAN_RATIO_MAX}
                        step={0.01}
                        value={oceanRatio}
                        onChange={(e) => setOceanRatio(Number(e.target.value))}
                      />
                      <em>{Math.round(clampOceanRatio(oceanRatio) * 100)}%</em>
                    </label>
                  )}
                  <label className="terrain-seed-check">
                    <input
                      type="checkbox"
                      checked={lakeEnabled}
                      onChange={(e) => setLakeEnabled(e.target.checked)}
                    />
                    <span>有湖泊</span>
                  </label>
                  {lakeEnabled && (
                    <label className="terrain-seed-row">
                      <span>湖泊密度</span>
                      <input
                        type="range"
                        min={LAKE_DENSITY_MIN}
                        max={LAKE_DENSITY_MAX}
                        step={0.01}
                        value={lakeDensity}
                        onChange={(e) => setLakeDensity(Number(e.target.value))}
                      />
                      <em>{Math.round(clampLakeDensity(lakeDensity) * 100)}%</em>
                    </label>
                  )}
                  <label className="terrain-seed-check">
                    <input
                      type="checkbox"
                      checked={riverEnabled}
                      onChange={(e) => setRiverEnabled(e.target.checked)}
                    />
                    <span>有河流</span>
                  </label>
                  {riverEnabled && (
                    <label className="terrain-seed-row">
                      <span>河网密度</span>
                      <input
                        type="range"
                        min={RIVER_DENSITY_MIN}
                        max={RIVER_DENSITY_MAX}
                        step={0.01}
                        value={riverDensity}
                        onChange={(e) => setRiverDensity(Number(e.target.value))}
                      />
                      <em>{Math.round(clampRiverDensity(riverDensity) * 100)}%</em>
                    </label>
                  )}
                  <label className="terrain-seed-check">
                    <input
                      type="checkbox"
                      checked={greenEnabled}
                      onChange={(e) => setGreenEnabled(e.target.checked)}
                    />
                    <span>有绿地</span>
                  </label>
                  {greenEnabled && (
                    <label className="terrain-seed-row">
                      <span>绿地密度</span>
                      <input
                        type="range"
                        min={GREEN_DENSITY_MIN}
                        max={GREEN_DENSITY_MAX}
                        step={0.01}
                        value={greenDensity}
                        onChange={(e) => setGreenDensity(Number(e.target.value))}
                      />
                      <em>{Math.round(clampGreenDensity(greenDensity) * 100)}%</em>
                    </label>
                  )}
                  <p className="tool-note">
                    微调会覆盖当前场景落点；换场景或「换一换」会重新套配方。
                  </p>
                </div>
              )}
            </div>

            <div className="gen-right">
              <div className="gen-preview-head">
                <div>
                  <strong>{activePreset.label}</strong>
                  <p className="muted">{activePreset.blurb}</p>
                </div>
                <div className="gen-preview-actions">
                  <code className="terrain-seed-code">{terrainSeed.toString(16)}</code>
                  <button type="button" className="chip" onClick={reshuffleSeed}>
                    换一换
                  </button>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => setPreviewView(DEFAULT_VIEW)}
                    title="重置预览视角"
                  >
                    复位
                  </button>
                </div>
              </div>
              <div
                ref={previewWrapRef}
                className="gen-preview-stage"
                onPointerDown={onPreviewPointerDown}
                onPointerMove={onPreviewPointerMove}
                onPointerUp={onPreviewPointerUp}
                onPointerCancel={onPreviewPointerUp}
              >
                <div
                  className="gen-preview-transform"
                  style={{
                    transform: `translate(${previewView.panX}px, ${previewView.panY}px) scale(${previewView.zoom})`,
                  }}
                >
                  <canvas
                    ref={previewCanvasRef}
                    className="terrain-preview-canvas gen-preview-canvas"
                  />
                </div>
                <p className="gen-preview-hint">拖拽平移 · 滚轮缩放</p>
              </div>
              <p className="terrain-preview-legend gen-preview-legend">
                <span className="swatch land" /> 陆地 {landPct}%
                {anyWater && (
                  <>
                    <span className="swatch water" /> 水域 {waterPct}%
                  </>
                )}
                {greenEnabled && (
                  <>
                    <span className="swatch green" /> 绿地 {greenPct}%
                  </>
                )}
              </p>
            </div>
          </div>
        </div>

        <footer className="setup-footer">
          {onBack ? (
            <button type="button" className="secondary" onClick={onBack}>
              取消，返回地图
            </button>
          ) : (
            <button type="button" className="secondary" onClick={onOpenFile}>
              导入本地 .md…
            </button>
          )}
          {onBack && (
            <button type="button" className="secondary" onClick={onOpenFile}>
              导入 .md…
            </button>
          )}
          <button type="button" className="primary" onClick={handleCreate}>
            新建并绘制
          </button>
        </footer>
      </div>
    </div>
  );
}
