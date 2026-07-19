import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MAP_SIZE_PRESETS,
  SCALE_PRESETS,
  clampMapSize,
  clampScale,
  formatDistance,
} from '../constants/mapPresets';
import { useAuth } from '../context/AuthContext';
import {
  DEFAULT_OCEAN_RATIO,
  OCEAN_RATIO_MAX,
  OCEAN_RATIO_MIN,
  clampOceanRatio,
  generateTerrain,
  paintTerrainPreview,
  randomTerrainSeed,
} from '../engine/terrainGen';
import { api, type CloudMapSummary } from '../io/api';
import type { MapSettings } from '../types';
import { createProject } from '../types';

type Props = {
  onCreate: (project: ReturnType<typeof createProject>) => void;
  onOpenCloud: (mapId: string) => void;
  onOpenFile: () => void;
  localOnly?: boolean;
  /** 从编辑页进入「我的地图」时，可返回当前图 */
  onBack?: () => void;
};

export function ProjectSetup({
  onCreate,
  onOpenCloud,
  onOpenFile,
  localOnly = false,
  onBack,
}: Props) {
  const { user, logout } = useAuth();
  const [name, setName] = useState('未命名城市');
  const [presetIdx, setPresetIdx] = useState(1);
  const [customSize, setCustomSize] = useState(false);
  const [widthKm, setWidthKm] = useState(5);
  const [heightKm, setHeightKm] = useState(5);
  const [scalePresetIdx, setScalePresetIdx] = useState(2);
  const [customScale, setCustomScale] = useState(false);
  const [scaleValue, setScaleValue] = useState(10000);
  const [cloudMaps, setCloudMaps] = useState<CloudMapSummary[]>([]);
  const [loadingMaps, setLoadingMaps] = useState(false);

  const [terrainSeed, setTerrainSeed] = useState(() => randomTerrainSeed());
  const [oceanRatio, setOceanRatio] = useState(DEFAULT_OCEAN_RATIO);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

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

  const buildSettings = (): MapSettings => {
    if (customSize) {
      return {
        widthM: clampMapSize(widthKm * 1000),
        heightM: clampMapSize(heightKm * 1000),
        scale: customScale ? clampScale(scaleValue) : SCALE_PRESETS[scalePresetIdx].value,
      };
    }
    const preset = MAP_SIZE_PRESETS[presetIdx];
    return {
      widthM: preset.widthM,
      heightM: preset.heightM,
      scale: customScale ? clampScale(scaleValue) : SCALE_PRESETS[scalePresetIdx].value,
    };
  };

  const preview = buildSettings();

  const generatedTerrain = useMemo(() => {
    // 预览用稍粗格子加速；创建时再用标准 25m
    const previewCell =
      Math.max(preview.widthM, preview.heightM) > 12000 ? 50 : 35;
    return generateTerrain(
      preview,
      { seed: terrainSeed, oceanRatio: clampOceanRatio(oceanRatio) },
      previewCell,
    );
  }, [preview.widthM, preview.heightM, terrainSeed, oceanRatio]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const aspect = preview.widthM / preview.heightM;
    const maxW = 320;
    const maxH = 200;
    let w = maxW;
    let h = Math.round(maxW / aspect);
    if (h > maxH) {
      h = maxH;
      w = Math.round(maxH * aspect);
    }
    canvas.width = w;
    canvas.height = h;
    paintTerrainPreview(canvas, generatedTerrain);
  }, [generatedTerrain, preview.widthM, preview.heightM]);

  const handleCreate = () => {
    const settings = buildSettings();
    const ratio = clampOceanRatio(oceanRatio);
    const terrain = generateTerrain(settings, {
      seed: terrainSeed,
      oceanRatio: ratio,
    });
    onCreate(
      createProject(name.trim() || '未命名城市', settings, 'navigation', {
        terrain,
        terrainSeed: { seed: terrainSeed, oceanRatio: ratio },
      }),
    );
  };

  const handleDeleteCloud = async (id: string, mapName: string) => {
    if (!confirm(`删除云端地图「${mapName}」？此操作不可恢复。`)) return;
    await api.deleteMap(id);
    await loadCloudMaps();
  };

  if (!user && !localOnly) return null;

  const oceanPct = Math.round(clampOceanRatio(oceanRatio) * 100);
  const landPct = 100 - oceanPct;

  return (
    <div className="setup-overlay">
      <div className="setup-card setup-card-wide">
        <header className="setup-header setup-header-row">
          <div>
            <h1>CityCanvas</h1>
            <p>设定范围、比例尺，并生成架空海陆底图</p>
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

        <div className="setup-body">
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
                      <button type="button" className="cloud-map-open" onClick={() => onOpenCloud(m.id)}>
                        <span className="cloud-map-name">{m.name}</span>
                        <span className="cloud-map-meta">
                          {formatDistance(m.widthM)} × {formatDistance(m.heightM)} · {m.featureCount}{' '}
                          要素
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

          <label className="setup-field">
            <span>城市名称</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：湾城岛"
            />
          </label>

          <fieldset className="setup-field">
            <span>地图大小</span>
            <div className="preset-grid">
              {MAP_SIZE_PRESETS.map((p, i) => (
                <button
                  key={p.label}
                  type="button"
                  className={!customSize && presetIdx === i ? 'active' : ''}
                  onClick={() => {
                    setCustomSize(false);
                    setPresetIdx(i);
                  }}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                className={customSize ? 'active' : ''}
                onClick={() => setCustomSize(true)}
              >
                自定义
              </button>
            </div>
            {customSize && (
              <div className="custom-row">
                <label>
                  宽 (km)
                  <input
                    type="number"
                    min={1}
                    max={50}
                    step={0.5}
                    value={widthKm}
                    onChange={(e) => setWidthKm(Number(e.target.value))}
                  />
                </label>
                <label>
                  高 (km)
                  <input
                    type="number"
                    min={1}
                    max={50}
                    step={0.5}
                    value={heightKm}
                    onChange={(e) => setHeightKm(Number(e.target.value))}
                  />
                </label>
              </div>
            )}
          </fieldset>

          <fieldset className="setup-field">
            <span>比例尺</span>
            <div className="preset-grid">
              {SCALE_PRESETS.map((p, i) => (
                <button
                  key={p.value}
                  type="button"
                  className={!customScale && scalePresetIdx === i ? 'active' : ''}
                  onClick={() => {
                    setCustomScale(false);
                    setScalePresetIdx(i);
                  }}
                >
                  {p.label}
                </button>
              ))}
              <button
                type="button"
                className={customScale ? 'active' : ''}
                onClick={() => setCustomScale(true)}
              >
                自定义
              </button>
            </div>
            {customScale && (
              <label className="custom-scale">
                1 :
                <input
                  type="number"
                  min={500}
                  max={100000}
                  step={500}
                  value={scaleValue}
                  onChange={(e) => setScaleValue(Number(e.target.value))}
                />
              </label>
            )}
          </fieldset>

          <fieldset className="setup-field terrain-seed-field">
            <span>地貌种子 · 架空海陆</span>
            <div className="terrain-seed-layout">
              <div className="terrain-seed-preview">
                <canvas ref={previewCanvasRef} className="terrain-preview-canvas" />
                <p className="terrain-preview-legend">
                  <span className="swatch land" /> 陆地 {landPct}%
                  <span className="swatch water" /> 海洋 {oceanPct}%
                </p>
              </div>
              <div className="terrain-seed-controls">
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
                  <em>{oceanPct}%</em>
                </label>
                <div className="terrain-seed-row">
                  <span>种子</span>
                  <code className="terrain-seed-code">{terrainSeed.toString(16)}</code>
                  <button
                    type="button"
                    className="chip"
                    onClick={() => setTerrainSeed(randomTerrainSeed())}
                  >
                    刷新
                  </button>
                </div>
                <p className="tool-note">
                  创建后锁定底图，编辑页不可整图重生；可用刷子微调海陆。
                </p>
              </div>
            </div>
          </fieldset>

          <div className="setup-preview">
            <strong>地图概览</strong>
            <p>
              {formatDistance(preview.widthM)} × {formatDistance(preview.heightM)} · 1 :
              {preview.scale.toLocaleString()}
            </p>
            <p className="muted">
              {user && !localOnly
                ? '绘制范围固定在此矩形内 · 自动保存到云端 SQLite'
                : '绘制范围固定在此矩形内 · 自动写入浏览器本地缓存'}
            </p>
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
