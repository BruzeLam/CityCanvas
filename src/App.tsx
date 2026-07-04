import { useCallback, useRef, useState } from 'react';
import { MapCanvas } from './components/MapCanvas';
import { ProjectSetup } from './components/ProjectSetup';
import { SidePanel } from './components/SidePanel';
import { Toolbar } from './components/Toolbar';
import { downloadMapMd, loadMapFromFile } from './io/mapFile';
import { exportToPng } from './engine/renderer';
import type { CityProject, MapStyle, RoadLevel, Tool } from './types';
import './App.css';

function App() {
  const [project, setProject] = useState<CityProject | null>(null);
  const [tool, setTool] = useState<Tool>('land');
  const [roadLevel, setRoadLevel] = useState<RoadLevel>('arterial');
  const [, setHistory] = useState<CityProject[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const mapStyle = project?.mapStyle ?? 'navigation';

  const updateProject = useCallback((next: CityProject) => {
    setProject((prev) => {
      if (prev && next.features.length > prev.features.length) {
        setHistory((h) => [...h, prev]);
      }
      return next;
    });
  }, []);

  const handleSave = () => {
    if (!project) return;
    downloadMapMd(project);
  };

  const handleExport = () => {
    if (!project) return;
    const dataUrl = exportToPng(project);
    const link = document.createElement('a');
    link.download = `${project.name || 'city'}.png`;
    link.href = dataUrl;
    link.click();
  };

  const handleUndo = () => {
    setHistory((h) => {
      if (h.length === 0 || !project) return h;
      const prev = h[h.length - 1];
      setProject(prev);
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
      setHistory([]);
    } catch {
      alert('无法读取存档，请确认是 CityCanvas 的 .md 文件');
    }
    e.target.value = '';
  };

  if (!project) {
    return (
      <>
        <ProjectSetup
          onCreate={(p) => {
            setProject(p);
            setHistory([]);
            setTool('land');
          }}
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

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="logo">CityCanvas</span>
          <span className="tagline">{project.name}</span>
        </div>
        <div className="header-actions">
          <button type="button" className="header-btn" onClick={handleSave}>
            保存
          </button>
          <button type="button" className="header-btn" onClick={handleOpenFile}>
            打开
          </button>
        </div>
      </header>
      <main className="workspace">
        <Toolbar
          tool={tool}
          roadLevel={roadLevel}
          onToolChange={setTool}
          onRoadLevelChange={setRoadLevel}
        />
        <MapCanvas
          key={`${project.settings.widthM}-${project.settings.heightM}-${project.name}`}
          project={project}
          tool={tool}
          roadLevel={roadLevel}
          onProjectChange={updateProject}
        />
        <SidePanel
          project={project}
          mapStyle={mapStyle}
          onMapStyleChange={(style: MapStyle) =>
            setProject((p) => (p ? { ...p, mapStyle: style } : p))
          }
          onSave={handleSave}
          onExport={handleExport}
          onUndo={handleUndo}
          onNewMap={() => {
            if (project.features.length > 0 && !confirm('新建地图？未保存的更改将丢失')) return;
            setProject(null);
            setHistory([]);
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
