import { useState } from 'react';
import {
  MAP_SIZE_PRESETS,
  SCALE_PRESETS,
  clampMapSize,
  clampScale,
  formatDistance,
} from '../constants/mapPresets';
import type { MapSettings } from '../types';
import { createProject } from '../types';

type Props = {
  onCreate: (project: ReturnType<typeof createProject>) => void;
  onOpenFile: () => void;
};

export function ProjectSetup({ onCreate, onOpenFile }: Props) {
  const [name, setName] = useState('未命名城市');
  const [presetIdx, setPresetIdx] = useState(1);
  const [customSize, setCustomSize] = useState(false);
  const [widthKm, setWidthKm] = useState(5);
  const [heightKm, setHeightKm] = useState(5);
  const [scalePresetIdx, setScalePresetIdx] = useState(2);
  const [customScale, setCustomScale] = useState(false);
  const [scaleValue, setScaleValue] = useState(10000);

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

  const handleCreate = () => {
    onCreate(createProject(name.trim() || '未命名城市', preview));
  };

  return (
    <div className="setup-overlay">
      <div className="setup-card">
        <header className="setup-header">
          <h1>CityCanvas</h1>
          <p>开始绘制前，先设定地图范围与比例尺</p>
        </header>

        <div className="setup-body">
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

          <div className="setup-preview">
            <strong>地图概览</strong>
            <p>
              {formatDistance(preview.widthM)} × {formatDistance(preview.heightM)} · 1 :
              {preview.scale.toLocaleString()}
            </p>
            <p className="muted">绘制范围固定在此矩形内 · 存档保存为本地 .md 文件</p>
          </div>
        </div>

        <footer className="setup-footer">
          <button type="button" className="secondary" onClick={onOpenFile}>
            打开存档…
          </button>
          <button type="button" className="primary" onClick={handleCreate}>
            开始绘制
          </button>
        </footer>
      </div>
    </div>
  );
}
