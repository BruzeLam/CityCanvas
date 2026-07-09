import { useCallback, useEffect, useRef, useState } from 'react';
import { AuthScreen } from './components/AuthScreen';
import { MapCanvas } from './components/MapCanvas';
import { ProjectSetup } from './components/ProjectSetup';
import { SidePanel } from './components/SidePanel';
import { Toolbar } from './components/Toolbar';
import { useAuth } from './context/AuthContext';
import { api } from './io/api';
import { downloadMapMd, loadMapFromFile } from './io/mapFile';
import { payloadToProject, projectToPayload } from './io/mapPayload';
import { exportToPng } from './engine/renderer';
import { downloadSvg } from './engine/svgExport';
import type { CityProject, LandformDrawMode, LayerKey, MapStyle, RoadLevel, Tool } from './types';
import { getLayers } from './types';
import './App.css';

function App() {
  const { user, loading: authLoading, logout } = useAuth();
  const [project, setProject] = useState<CityProject | null>(null);
  const [tool, setTool] = useState<Tool>('land');
  const [selectedFeatureId, setSelectedFeatureId] = useState<string | null>(null);
  const [landformDrawMode, setLandformDrawMode] = useState<LandformDrawMode>('freehand');
  const [roadLevel, setRoadLevel] = useState<RoadLevel>('arterial');
  const [, setHistory] = useState<CityProject[]>([]);
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [dirty, setDirty] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const mapStyle = project?.mapStyle ?? 'navigation';

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
        return next;
      });
    },
    [],
  );

  const saveToCloud = useCallback(async (target: CityProject) => {
    setSaveState('saving');
    try {
      const payload = projectToPayload(target);
      if (target.cloudId) {
        await api.updateMap(target.cloudId, target.name, payload);
      } else {
        const { map } = await api.createMap(target.name, payload);
        setProject((p) => (p && p === target ? { ...p, cloudId: map.id } : p));
      }
      setDirty(false);
      setSaveState('saved');
    } catch (err) {
      setSaveState('error');
      alert(err instanceof Error ? err.message : '云端保存失败');
    }
  }, []);

  useEffect(() => {
    if (!project || !dirty || saveState === 'saving') return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => {
      saveToCloud(project);
    }, 3000);
    return () => {
      if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    };
  }, [project, dirty, saveState, saveToCloud]);

  const handleSave = async () => {
    if (!project) return;
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    await saveToCloud(project);
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
      setProject(loaded);
      setTool('land');
      setSelectedFeatureId(null);
      setHistory([]);
      setDirty(true);
    } catch {
      alert('无法读取存档，请确认是 CityCanvas 的 .md 文件');
    }
    e.target.value = '';
  };

  const handleCreate = async (p: CityProject) => {
    try {
      const { map } = await api.createMap(p.name, projectToPayload(p));
      setProject(payloadToProject(map.payload, map.id));
      setHistory([]);
      setTool('land');
      setSelectedFeatureId(null);
      setDirty(false);
      setSaveState('saved');
    } catch (err) {
      alert(err instanceof Error ? err.message : '创建地图失败');
    }
  };

  const handleOpenCloud = async (mapId: string) => {
    try {
      const { map } = await api.getMap(mapId);
      setProject(payloadToProject(map.payload, map.id));
      setHistory([]);
      setTool('land');
      setSelectedFeatureId(null);
      setDirty(false);
      setSaveState('saved');
    } catch (err) {
      alert(err instanceof Error ? err.message : '加载地图失败');
    }
  };

  if (authLoading) {
    return (
      <div className="setup-overlay">
        <p className="loading-text">加载中…</p>
      </div>
    );
  }

  if (!user) {
    return <AuthScreen />;
  }

  if (!project) {
    return (
      <>
        <ProjectSetup
          onCreate={handleCreate}
          onOpenCloud={handleOpenCloud}
          onOpenFile={handleOpenFile}
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
      ? '保存中…'
      : saveState === 'saved' && !dirty
        ? '已保存'
        : dirty
          ? '保存'
          : '保存';

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="logo">CityCanvas</span>
          <span className="tagline">{project.name}</span>
          {dirty && <span className="dirty-dot" title="有未保存更改" />}
        </div>
        <div className="header-actions">
          <span className="header-user">{user.displayName || user.email}</span>
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
          <button type="button" className="header-btn" onClick={() => setProject(null)}>
            我的地图
          </button>
          <button type="button" className="header-btn" onClick={logout}>
            退出
          </button>
        </div>
      </header>
      <main className="workspace">
        <Toolbar
          tool={tool}
          roadLevel={roadLevel}
          landformDrawMode={landformDrawMode}
          onToolChange={(t) => {
            setTool(t);
            if (t !== 'select') setSelectedFeatureId(null);
          }}
          onRoadLevelChange={setRoadLevel}
          onLandformDrawModeChange={setLandformDrawMode}
        />
        <MapCanvas
          key={`${project.cloudId ?? 'local'}-${project.settings.widthM}-${project.settings.heightM}`}
          project={project}
          tool={tool}
          roadLevel={roadLevel}
          landformDrawMode={landformDrawMode}
          selectedFeatureId={selectedFeatureId}
          onSelectFeature={setSelectedFeatureId}
          onProjectChange={updateProject}
        />
        <SidePanel
          project={project}
          mapStyle={mapStyle}
          selectedFeatureId={selectedFeatureId}
          cloudSaved={!dirty && saveState === 'saved'}
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
          onMapStyleChange={(style: MapStyle) => {
            setDirty(true);
            setProject((p) => (p ? { ...p, mapStyle: style } : p));
          }}
          onLayerToggle={(key: LayerKey) => {
            setDirty(true);
            setProject((p) => {
              if (!p) return p;
              const layers = getLayers(p);
              return { ...p, layers: { ...layers, [key]: !layers[key] } };
            });
          }}
          onSave={handleSave}
          onExport={handleExport}
          onExportSvg={handleExportSvg}
          onExportMd={handleExportMd}
          onUndo={handleUndo}
          onNewMap={() => {
            if (dirty && !confirm('返回地图列表？未保存的更改将丢失')) return;
            setProject(null);
            setHistory([]);
            setDirty(false);
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
