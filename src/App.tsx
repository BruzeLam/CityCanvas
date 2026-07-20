import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { MapCanvas } from './components/MapCanvas';
import { ProjectSetup } from './components/ProjectSetup';
import { SidePanel } from './components/SidePanel';
import { Toolbar } from './components/Toolbar';
import { useAuth } from './context/AuthContext';
import { api } from './io/api';
import {
  clearLocalSession,
  loadLocalSession,
  saveLocalSession,
} from './io/localStore';
import { downloadMapMd, loadMapFromFile } from './io/mapFile';
import { payloadToProject, projectToPayload } from './io/mapPayload';
import { exportToPng } from './engine/renderer';
import { downloadSvg } from './engine/svgExport';
import { randomCityName } from './constants/cityNames';
import {
  DEFAULT_PARALLEL_SPACING_M,
  type ParallelSide,
} from './engine/parallelOffset';
import type {
  CityProject,
  EraserTarget,
  FeatureGrade,
  LayerKey,
  MapStyle,
  PathDrawMode,
  RailKind,
  RoadLevel,
  Tool,
} from './types';
import {
  DEFAULT_BRUSH_SIZE_M,
  DEFAULT_BRUSH_THICKNESS,
  DEFAULT_ERASER_TARGET,
  DEFAULT_GRADE,
  DEFAULT_METRO_COLOR,
  DEFAULT_RAIL_KIND,
  ERASER_TARGETS,
  RAIL_KINDS,
  ROAD_STYLES,
  getLayers,
} from './types';
import './App.css';

type BootPhase = 'booting' | 'auth' | 'ready';

function App() {
  const { user, loading: authLoading, logout } = useAuth();
  const [boot, setBoot] = useState<BootPhase>('booting');
  const [project, setProject] = useState<CityProject | null>(null);
  const [tool, setTool] = useState<Tool>('pan');
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [pathDrawMode, setPathDrawMode] = useState<PathDrawMode>('straight');
  const [parallelEnabled, setParallelEnabled] = useState(false);
  const [parallelSpacingM, setParallelSpacingM] = useState(DEFAULT_PARALLEL_SPACING_M);
  const [parallelSide, setParallelSide] = useState<ParallelSide>('both');
  const [brushSizeM, setBrushSizeM] = useState(DEFAULT_BRUSH_SIZE_M);
  const [brushThickness, setBrushThickness] = useState(DEFAULT_BRUSH_THICKNESS);
  const [eraserTarget, setEraserTarget] = useState<EraserTarget>(DEFAULT_ERASER_TARGET);
  const [roadLevel, setRoadLevel] = useState<RoadLevel>('arterial');
  const [railKind, setRailKind] = useState<RailKind>(DEFAULT_RAIL_KIND);
  const [metroColor, setMetroColor] = useState(DEFAULT_METRO_COLOR);
  const [drawGrade, setDrawGrade] = useState<FeatureGrade>(DEFAULT_GRADE);
  const [history, setHistory] = useState<CityProject[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [dirty, setDirty] = useState(false);
  const [localOnly, setLocalOnly] = useState(false);
  /** 从编辑页进入登录 / 我的地图时，可返回的上一张图 */
  const [resumeProject, setResumeProject] = useState<CityProject | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cloudSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredRef = useRef(false);

  const mapStyle = project?.mapStyle ?? 'navigation';

  const openProject = useCallback((p: CityProject, opts?: { dirty?: boolean; saved?: boolean }) => {
    setProject(p);
    setResumeProject(null);
    setTool('pan');
    setSelectedFeatureId(null);
    setHistory([]);
    setDirty(opts?.dirty ?? false);
    setSaveState(opts?.saved ? 'saved' : 'idle');
    saveLocalSession(p);
  }, []);

  // 启动：优先恢复本地存档，无需登录
  useEffect(() => {
    if (authLoading || restoredRef.current) return;
    restoredRef.current = true;

    const session = loadLocalSession();
    if (session) {
      setLocalOnly(!user);
      openProject(session.project, { saved: true });
      setBoot('ready');
      return;
    }

    if (user) {
      setBoot('ready');
      return;
    }

    setBoot('auth');
  }, [authLoading, user, openProject]);

  // 登录成功后进入 ready（若还在 auth）
  useEffect(() => {
    if (boot === 'auth' && user) {
      setLocalOnly(false);
      setBoot('ready');
    }
  }, [boot, user]);

  const persistLocal = useCallback((p: CityProject) => {
    if (localSaveTimer.current) clearTimeout(localSaveTimer.current);
    localSaveTimer.current = setTimeout(() => {
      saveLocalSession(p);
      if (localOnly || !user) {
        setSaveState('saved');
        setDirty(false);
      }
    }, 400);
  }, [localOnly, user]);

  const updateProject = useCallback(
    (next: CityProject, meta?: { undoSnapshot?: CityProject }) => {
      setDirty(true);
      setSaveState('idle');
      setProject((prev) => {
        if (meta?.undoSnapshot) {
          setHistory((h) => [...h, meta.undoSnapshot!]);
        } else if (prev && next.features.length > prev.features.length) {
          setHistory((h) => [...h, prev]);
        }
        persistLocal(next);
        return next;
      });
    },
    [persistLocal],
  );

  const saveToCloud = useCallback(async (target: CityProject) => {
    if (!user) {
      saveLocalSession(target);
      setDirty(false);
      setSaveState('saved');
      return;
    }
    setSaveState('saving');
    try {
      const payload = projectToPayload(target);
      if (target.cloudId) {
        await api.updateMap(target.cloudId, target.name, payload);
        saveLocalSession(target);
      } else {
        const { map } = await api.createMap(target.name, payload);
        const withId = { ...target, cloudId: map.id };
        setProject((p) => (p && p === target ? withId : p));
        saveLocalSession(withId);
      }
      setDirty(false);
      setSaveState('saved');
    } catch (err) {
      // 云端失败仍保留本地
      saveLocalSession(target);
      setSaveState('error');
      console.warn(err);
    }
  }, [user]);

  useEffect(() => {
    if (!project || !dirty || !user || localOnly) return;
    if (saveState === 'saving') return;
    if (cloudSaveTimer.current) clearTimeout(cloudSaveTimer.current);
    cloudSaveTimer.current = setTimeout(() => {
      saveToCloud(project);
    }, 3000);
    return () => {
      if (cloudSaveTimer.current) clearTimeout(cloudSaveTimer.current);
    };
  }, [project, dirty, saveState, saveToCloud, user, localOnly]);

  const handleSave = async () => {
    if (!project) return;
    if (cloudSaveTimer.current) clearTimeout(cloudSaveTimer.current);
    if (localSaveTimer.current) clearTimeout(localSaveTimer.current);
    saveLocalSession(project);
    if (user && !localOnly) {
      await saveToCloud(project);
    } else {
      setDirty(false);
      setSaveState('saved');
    }
  };

  const handleExport = () => {
    if (!project) return;
    const dataUrl = exportToPng(project);
    const link = document.createElement('a');
    link.download = `${project.name || 'city'}.png`;
    link.href = dataUrl;
    link.click();
  };

  const handleExportSvg = () => {
    if (!project) return;
    downloadSvg(project);
  };

  const handleExportMd = () => {
    if (!project) return;
    downloadMapMd(project);
  };

  const handleUndo = () => {
    setHistory((h) => {
      if (h.length === 0 || !project) return h;
      const prev = h[h.length - 1];
      setProject(prev);
      setDirty(true);
      persistLocal(prev);
      return h.slice(0, -1);
    });
  };

  const handleOpenFile = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const loaded = await loadMapFromFile(file);
      openProject(loaded, { dirty: true });
      setBoot('ready');
    } catch {
      alert('无法读取存档，请确认是 CityCanvas 的 .md 文件');
    }
    e.target.value = '';
  };

  const handleCreate = async (p: CityProject) => {
    if (user && !localOnly) {
      try {
        const { map } = await api.createMap(p.name, projectToPayload(p));
        openProject(payloadToProject(map.payload, map.id), { saved: true });
        return;
      } catch (err) {
        alert(err instanceof Error ? err.message : '云端创建失败，已改为本地存档');
      }
    }
    openProject(p, { dirty: true });
  };

  const handleOpenCloud = async (mapId: string) => {
    try {
      const { map } = await api.getMap(mapId);
      openProject(payloadToProject(map.payload, map.id), { saved: true });
    } catch (err) {
      alert(err instanceof Error ? err.message : '加载地图失败');
    }
  };

  const handleContinueLocal = () => {
    setLocalOnly(true);
    const session = loadLocalSession();
    if (session) {
      openProject(session.project, { saved: true });
    } else if (resumeProject) {
      openProject(resumeProject, { dirty: true });
    } else {
      setResumeProject(null);
    }
    setBoot('ready');
  };

  const handleBackFromOverlay = useCallback(() => {
    if (!resumeProject) return;
    setProject(resumeProject);
    setResumeProject(null);
    setBoot('ready');
  }, [resumeProject]);

  const handleLogout = () => {
    if (project) saveLocalSession(project);
    logout();
    setLocalOnly(true);
  };

  // H = 拖动，V = 编辑；数字键按当前工具切换子类型
  useEffect(() => {
    const roadLevels = Object.keys(ROAD_STYLES) as RoadLevel[];
    const terrainTools: Tool[] = ['land', 'ocean', 'mountain', 'eraser', 'river'];

    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const tag = el?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || el?.isContentEditable) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        setTool('pan');
        setSelectedFeatureId(null);
        return;
      }
      if (e.key === 'v' || e.key === 'V') {
        e.preventDefault();
        setTool('select');
        return;
      }

      if (e.key >= '1' && e.key <= '9') {
        const idx = Number(e.key) - 1;
        if (tool === 'road') {
          const level = roadLevels[idx];
          if (!level) return;
          e.preventDefault();
          setRoadLevel(level);
          return;
        }
        if (tool === 'railway') {
          const kind = RAIL_KINDS[idx];
          if (!kind) return;
          e.preventDefault();
          setRailKind(kind.id);
          return;
        }
        if (tool === 'eraser') {
          const target = ERASER_TARGETS[idx];
          if (!target) return;
          e.preventDefault();
          setEraserTarget(target.id);
          return;
        }
        if (terrainTools.includes(tool)) {
          const next = terrainTools[idx];
          if (!next) return;
          e.preventDefault();
          setTool(next);
          if (next !== 'select') setSelectedFeatureId(null);
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tool]);

  if (authLoading || boot === 'booting') {
    return (
      <div className="setup-overlay">
        <p className="loading-text">加载中…</p>
      </div>
    );
  }

  if (boot === 'auth' && !user) {
    return (
      <>
        <AuthScreen
          onContinueLocal={handleContinueLocal}
          onBack={resumeProject ? handleBackFromOverlay : undefined}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,text/markdown"
          hidden
          onChange={handleFileChange}
        />
      </>
    );
  }

  if (!project) {
    return (
      <>
        <ProjectSetup
          onCreate={handleCreate}
          onOpenCloud={handleOpenCloud}
          onOpenFile={handleOpenFile}
          localOnly={localOnly || !user}
          onBack={resumeProject ? handleBackFromOverlay : undefined}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,text/markdown"
          hidden
          onChange={handleFileChange}
        />
      </>
    );
  }

  const saveLabel =
    saveState === 'saving'
      ? '同步中…'
      : saveState === 'saved' && !dirty
        ? user && !localOnly
          ? '已保存'
          : '已缓存'
        : dirty
          ? '保存'
          : '保存';

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="logo">CityCanvas</span>
          <div className="city-title-wrap">
            <input
              className="city-title-input"
              type="text"
              value={project.name}
              maxLength={48}
              aria-label="城市名称"
              title="点击修改城市名称"
              placeholder="未命名城市"
              onChange={(e) => {
                const name = e.target.value;
                setDirty(true);
                setSaveState('idle');
                setProject((p) => {
                  if (!p) return p;
                  const next = { ...p, name };
                  persistLocal(next);
                  return next;
                });
              }}
              onBlur={(e) => {
                const trimmed = e.target.value.trim() || '未命名城市';
                if (trimmed === project.name) return;
                setDirty(true);
                setSaveState('idle');
                setProject((p) => {
                  if (!p) return p;
                  const next = { ...p, name: trimmed };
                  persistLocal(next);
                  return next;
                });
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === 'Escape') {
                  (e.target as HTMLInputElement).blur();
                }
              }}
            />
            <button
              type="button"
              className="city-title-dice"
              title="随机架空城市名"
              aria-label="随机生成城市名"
              onClick={() => {
                const name = randomCityName(project.name);
                setDirty(true);
                setSaveState('idle');
                setProject((p) => {
                  if (!p) return p;
                  const next = { ...p, name };
                  persistLocal(next);
                  return next;
                });
              }}
            >
              🎲
            </button>
            {dirty && <span className="dirty-dot" title="有未保存更改" />}
          </div>
        </div>
        <div className="header-actions">
          <span className="header-user">
            {user && !localOnly ? user.displayName || user.email : '本地模式'}
          </span>
          <button
            type="button"
            className={`header-btn ${saveState === 'saved' && !dirty ? 'saved' : ''}`}
            onClick={handleSave}
            disabled={saveState === 'saving'}
          >
            {saveLabel}
          </button>
          <button type="button" className="header-btn" onClick={handleOpenFile}>
            导入 .md
          </button>
          <button
            type="button"
            className="header-btn"
            onClick={() => {
              saveLocalSession(project);
              setResumeProject(project);
              setProject(null);
              setHistory([]);
              setDirty(false);
              setSaveState('idle');
            }}
          >
            我的地图
          </button>
          {user ? (
            <button type="button" className="header-btn" onClick={handleLogout}>
              退出登录
            </button>
          ) : (
            <button
              type="button"
              className="header-btn"
              onClick={() => {
                saveLocalSession(project);
                setResumeProject(project);
                setBoot('auth');
              }}
            >
              登录
            </button>
          )}
        </div>
      </header>
      <main className="workspace">
        <Toolbar
          tool={tool}
          roadLevel={roadLevel}
          railKind={railKind}
          metroColor={metroColor}
          drawGrade={drawGrade}
          pathDrawMode={pathDrawMode}
          parallelEnabled={parallelEnabled}
          parallelSpacingM={parallelSpacingM}
          parallelSide={parallelSide}
          brushSizeM={brushSizeM}
          brushThickness={brushThickness}
          eraserTarget={eraserTarget}
          showJunctions={getLayers(project).junctions !== false}
          canUndo={history.length > 0}
          onToolChange={(t) => {
            setTool(t);
            if (t !== 'select') setSelectedFeatureId(null);
          }}
          onRoadLevelChange={setRoadLevel}
          onRailKindChange={setRailKind}
          onMetroColorChange={setMetroColor}
          onDrawGradeChange={setDrawGrade}
          onPathDrawModeChange={setPathDrawMode}
          onParallelEnabledChange={setParallelEnabled}
          onParallelSpacingChange={setParallelSpacingM}
          onParallelSideChange={setParallelSide}
          onBrushSizeChange={setBrushSizeM}
          onBrushThicknessChange={setBrushThickness}
          onEraserTargetChange={setEraserTarget}
          onShowJunctionsChange={(show) => {
            updateProject({
              ...project,
              layers: { ...getLayers(project), junctions: show },
            });
          }}
          onUndo={handleUndo}
        />
        <MapCanvas
          key={`${project.cloudId ?? 'local'}-${project.settings.widthM}-${project.settings.heightM}`}
          project={project}
          tool={tool}
          roadLevel={roadLevel}
          railKind={railKind}
          metroColor={metroColor}
          drawGrade={drawGrade}
          pathDrawMode={pathDrawMode}
          parallelEnabled={parallelEnabled}
          parallelSpacingM={parallelSpacingM}
          parallelSide={parallelSide}
          brushSizeM={brushSizeM}
          brushThickness={brushThickness}
          eraserTarget={eraserTarget}
          selectedFeatureId={selectedFeatureId}
          onSelectFeature={setSelectedFeatureId}
          onDrawGradeChange={setDrawGrade}
          onProjectChange={updateProject}
        />
        <SidePanel
          project={project}
          mapStyle={mapStyle}
          selectedFeatureId={selectedFeatureId}
          cloudSaved={!dirty && saveState === 'saved'}
          localMode={localOnly || !user}
          onDeleteSelected={() => {
            if (!selectedFeatureId) return;
            updateProject(
              {
                ...project,
                features: project.features.filter((f) => f.id !== selectedFeatureId),
              },
              { undoSnapshot: project },
            );
            setSelectedFeatureId(null);
          }}
          onSelectedGradeChange={(grade: FeatureGrade) => {
            if (!selectedFeatureId) return;
            updateProject(
              {
                ...project,
                features: project.features.map((f) =>
                  f.id === selectedFeatureId ? { ...f, grade } : f,
                ),
              },
              { undoSnapshot: project },
            );
            setDrawGrade(grade);
          }}
          onMapStyleChange={(style: MapStyle) => {
            setDirty(true);
            setProject((p) => {
              if (!p) return p;
              const next = { ...p, mapStyle: style };
              persistLocal(next);
              return next;
            });
          }}
          onLayerToggle={(key: LayerKey) => {
            setDirty(true);
            setProject((p) => {
              if (!p) return p;
              const layers = getLayers(p);
              const next = { ...p, layers: { ...layers, [key]: !layers[key] } };
              persistLocal(next);
              return next;
            });
          }}
          onSave={handleSave}
          onExport={handleExport}
          onExportSvg={handleExportSvg}
          onExportMd={handleExportMd}
          onUndo={handleUndo}
          onNewMap={() => {
            if (dirty && !confirm('返回地图列表？当前进度已写入浏览器缓存')) return;
            saveLocalSession(project);
            setResumeProject(project);
            setProject(null);
            setHistory([]);
            setDirty(false);
            setSaveState('idle');
          }}
          onClearLocal={() => {
            if (!confirm('清除浏览器本地缓存？当前地图仍可继续编辑，但刷新后不会自动恢复。')) {
              return;
            }
            clearLocalSession();
            setSaveState('idle');
          }}
        />
      </main>
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,text/markdown"
        hidden
        onChange={handleFileChange}
      />
    </div>
  );
}

export default App;
