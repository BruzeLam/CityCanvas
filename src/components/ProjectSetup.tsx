import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { clampMapSize, clampScale, formatDistance } from '../constants/mapPresets';
import {
  CITY_SCALES,
  GEO_PROTOTYPES,
  WATER_NETWORK_MAX,
  WATER_NETWORK_MIN,
  clampCoreParams,
  clampWaterNetwork,
  cityScaleById,
  expandCoreToTerrainParams,
  geoPrototypeById,
  type CityScaleId,
  type GeoPrototypeId,
  type MapCoreParams,
} from '../constants/landscapePresets';
import { useAuth } from '../context/AuthContext';
import {
  FRAGMENTATION_MAX,
  FRAGMENTATION_MIN,
  GREEN_DENSITY_MAX,
  GREEN_DENSITY_MIN,
  OCEAN_RATIO_MAX,
  OCEAN_RATIO_MIN,
  analyzeLandscape,
  clampFragmentation,
  clampGreenDensity,
  clampOceanRatio,
  generateLandscape,
  paintTerrainPreview,
  randomTerrainSeed,
  type LandscapeQuality,
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

/**
 * 预览格网：略粗于正式图以保滑条跟手（约 1.5×），上限 12m/格，
 * 不再强制 48m 大方块。
 */
function previewCellSizeM(settings: Pick<MapSettings, 'widthM' | 'heightM'>): number {
  const fine = preferredTerrainCellSizeM(settings);
  return Math.min(Math.max(Math.round(fine * 1.5), fine), 12);
}

export function ProjectSetup({
  onCreate,
  onOpenCloud,
  onOpenFile,
  localOnly = false,
  onBack,
}: Props) {
  const { user, logout } = useAuth();
  const [name, setName] = useState('未命名城市');
  const [cloudMaps, setCloudMaps] = useState<CloudMapSummary[]>([]);
  const [loadingMaps, setLoadingMaps] = useState(false);

  const [prototypeId, setPrototypeId] = useState<GeoPrototypeId>('natural_harbor');
  const [scaleId, setScaleId] = useState<CityScaleId>('city');
  const [customWkm, setCustomWkm] = useState(5);
  const [customHkm, setCustomHkm] = useState(5);
  const [terrainSeed, setTerrainSeed] = useState(() => randomTerrainSeed());
  const [core, setCore] = useState<MapCoreParams>(() =>
    clampCoreParams(geoPrototypeById('natural_harbor').defaults),
  );
  const [quality, setQuality] = useState<LandscapeQuality | null>(null);

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

  const settings: MapSettings = useMemo(() => {
    if (scaleId === 'custom') {
      return {
        widthM: clampMapSize(customWkm * 1000),
        heightM: clampMapSize(customHkm * 1000),
        scale: clampScale(
          Math.round(
            Math.max(customWkm, customHkm) >= 8
              ? 25000
              : Math.max(customWkm, customHkm) >= 4
                ? 10000
                : 5000,
          ),
        ),
      };
    }
    const s = cityScaleById(scaleId)!;
    return { widthM: s.widthM, heightM: s.heightM, scale: s.scale };
  }, [scaleId, customWkm, customHkm]);

  const genParams = useMemo(
    () => expandCoreToTerrainParams(prototypeId, core, terrainSeed),
    [prototypeId, core, terrainSeed],
  );

  const landscapePreview = useMemo(() => {
    return generateLandscape(settings, genParams, previewCellSizeM(settings));
  }, [settings, genParams]);

  useEffect(() => {
    setQuality(
      analyzeLandscape(landscapePreview, genParams.fragmentation ?? 0.35),
    );
  }, [landscapePreview, genParams.fragmentation]);

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

  const selectPrototype = (id: GeoPrototypeId) => {
    setPrototypeId(id);
    setCore(clampCoreParams(geoPrototypeById(id).defaults));
    setTerrainSeed(randomTerrainSeed());
    setPreviewView(DEFAULT_VIEW);
  };

  const patchCore = (patch: Partial<MapCoreParams>) => {
    setCore((c) => clampCoreParams({ ...c, ...patch }));
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
          fragmentation: params.fragmentation,
          geoPrototypeId: prototypeId,
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

  const proto = geoPrototypeById(prototypeId);
  const landPct = Math.max(
    0,
    100 -
      Math.round((landscapePreview.waterPct || 0) * 100) -
      Math.round((landscapePreview.greenPct || 0) * 100),
  );
  const waterPct = Math.round((landscapePreview.waterPct || 0) * 100);
  const greenPct = Math.round((landscapePreview.greenPct || 0) * 100);

  return (
    <div className="setup-overlay">
      <div className="setup-card setup-card-wide setup-card-gen">
        <header className="setup-header setup-header-row">
          <div>
            <h1>CityCanvas</h1>
            <p className="gen-slogan">
              Every Great City Begins with a Map.
              <br />
              <span className="gen-slogan-cn">每一座伟大的城市，都始于一张地图。</span>
            </p>
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
              <p className="muted">本地模式：进度自动写入浏览器缓存</p>
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
                    onClick={() => setName(randomCityName(name))}
                  >
                    🎲
                  </button>
                </div>
              </label>

              {/* Step 1 */}
              <fieldset className="setup-field">
                <span>1 · 地理原型</span>
                <div className="landscape-preset-grid">
                  {GEO_PROTOTYPES.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={
                        prototypeId === p.id
                          ? 'landscape-preset-card active'
                          : 'landscape-preset-card'
                      }
                      onClick={() => selectPrototype(p.id)}
                    >
                      <strong>{p.label}</strong>
                      <em>{p.blurb}</em>
                    </button>
                  ))}
                </div>
                <p className="muted gen-ref-hint">
                  参考气质：{proto.references.join('、')}（相似风格，非复制）
                </p>
              </fieldset>

              {/* Step 2 */}
              <fieldset className="setup-field">
                <span>2 · 城市尺度</span>
                <div className="preset-grid gen-size-grid gen-scale-grid">
                  {CITY_SCALES.map((s) => (
                    <button
                      key={s.id}
                      type="button"
                      className={scaleId === s.id ? 'active' : ''}
                      onClick={() => setScaleId(s.id)}
                      title={s.blurb}
                    >
                      {s.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    className={scaleId === 'custom' ? 'active' : ''}
                    onClick={() => setScaleId('custom')}
                  >
                    自定义
                  </button>
                </div>
                {scaleId === 'custom' ? (
                  <div className="custom-row">
                    <label>
                      宽 (km)
                      <input
                        type="number"
                        min={1}
                        max={50}
                        step={0.5}
                        value={customWkm}
                        onChange={(e) => setCustomWkm(Number(e.target.value))}
                      />
                    </label>
                    <label>
                      高 (km)
                      <input
                        type="number"
                        min={1}
                        max={50}
                        step={0.5}
                        value={customHkm}
                        onChange={(e) => setCustomHkm(Number(e.target.value))}
                      />
                    </label>
                  </div>
                ) : (
                  <p className="muted gen-size-hint">
                    {formatDistance(settings.widthM)} × {formatDistance(settings.heightM)}
                    · 推荐比例尺 1:{settings.scale.toLocaleString()}
                  </p>
                )}
              </fieldset>

              {/* Step 3 */}
              <fieldset className="setup-field gen-core-params">
                <span>3 · 微调参数</span>
                <label className="terrain-seed-row">
                  <span>海洋比例</span>
                  <input
                    type="range"
                    min={OCEAN_RATIO_MIN}
                    max={OCEAN_RATIO_MAX}
                    step={0.01}
                    value={core.oceanRatio}
                    onChange={(e) =>
                      patchCore({ oceanRatio: clampOceanRatio(Number(e.target.value)) })
                    }
                  />
                  <em>{Math.round(clampOceanRatio(core.oceanRatio) * 100)}%</em>
                </label>
                <label className="terrain-seed-row">
                  <span>水网密度</span>
                  <input
                    type="range"
                    min={WATER_NETWORK_MIN}
                    max={WATER_NETWORK_MAX}
                    step={0.01}
                    value={core.waterNetwork}
                    onChange={(e) =>
                      patchCore({ waterNetwork: clampWaterNetwork(Number(e.target.value)) })
                    }
                  />
                  <em>{Math.round(clampWaterNetwork(core.waterNetwork) * 100)}%</em>
                </label>
                <label className="terrain-seed-row">
                  <span>绿地覆盖</span>
                  <input
                    type="range"
                    min={GREEN_DENSITY_MIN}
                    max={GREEN_DENSITY_MAX}
                    step={0.01}
                    value={core.greenCover}
                    onChange={(e) =>
                      patchCore({ greenCover: clampGreenDensity(Number(e.target.value)) })
                    }
                  />
                  <em>{Math.round(clampGreenDensity(core.greenCover) * 100)}%</em>
                </label>
                <label className="terrain-seed-row">
                  <span>地形破碎度</span>
                  <input
                    type="range"
                    min={FRAGMENTATION_MIN}
                    max={FRAGMENTATION_MAX}
                    step={0.01}
                    value={core.fragmentation}
                    onChange={(e) =>
                      patchCore({
                        fragmentation: clampFragmentation(Number(e.target.value)),
                      })
                    }
                  />
                  <em>{Math.round(clampFragmentation(core.fragmentation) * 100)}%</em>
                </label>
              </fieldset>
            </div>

            {/* Step 4 preview */}
            <div className="gen-right">
              <div className="gen-preview-head">
                <div>
                  <strong>4 · 实时预览</strong>
                  <p className="muted">
                    {proto.label} · 低分辨率预览，生成时出完整地图
                  </p>
                </div>
                <div className="gen-preview-actions">
                  <code className="terrain-seed-code">{terrainSeed.toString(16)}</code>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => {
                      setTerrainSeed(randomTerrainSeed());
                      setPreviewView(DEFAULT_VIEW);
                    }}
                  >
                    换一换
                  </button>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => setPreviewView(DEFAULT_VIEW)}
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
                <span className="swatch water" /> 水域 {waterPct}%
                <span className="swatch green" /> 绿地 {greenPct}%
              </p>

              {quality && (
                <div className="gen-quality">
                  <strong>地图特点</strong>
                  <ul>
                    <li>
                      可建设面积{' '}
                      <em>{Math.round(quality.buildablePct * 100)}%</em>
                    </li>
                    <li>
                      港口潜力 <em>{quality.portPotential}</em>
                    </li>
                    <li>
                      扩展潜力 <em>{quality.expansionPotential}</em>
                    </li>
                    <li>
                      水系阻隔 <em>{quality.waterBarrier}</em>
                    </li>
                    <li>
                      地形阻隔 <em>{quality.terrainBarrier}</em>
                    </li>
                  </ul>
                  <p className="muted">帮助理解地图，不是打分。</p>
                </div>
              )}
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
            生成地图
          </button>
        </footer>
      </div>
    </div>
  );
}
