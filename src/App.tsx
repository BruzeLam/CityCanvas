import { useCallback, useState } from 'react';
import { MapCanvas } from './components/MapCanvas';
import { SidePanel } from './components/SidePanel';
import { Toolbar } from './components/Toolbar';
import { exportToPng } from './engine/renderer';
import type { CityProject, MapStyle, RoadLevel, Tool } from './types';
import { emptyProject } from './types';
import './App.css';

function App() {
  const [project, setProject] = useState<CityProject>(() => emptyProject('湾城岛'));
  const [tool, setTool] = useState<Tool>('coastline');
  const [roadLevel, setRoadLevel] = useState<RoadLevel>('arterial');
  const [mapStyle, setMapStyle] = useState<MapStyle>('navigation');
  const [, setHistory] = useState<CityProject[]>([]);

  const updateProject = useCallback((next: CityProject) => {
    setProject((prev) => {
      if (next.features.length > prev.features.length) {
        setHistory((h) => [...h, prev]);
      }
      return next;
    });
  }, []);

  const handleExport = () => {
    const dataUrl = exportToPng(project, mapStyle);
    const link = document.createElement('a');
    link.download = `${project.name || 'city'}.png`;
    link.href = dataUrl;
    link.click();
  };

  const handleUndo = () => {
    setHistory((h) => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setProject(prev);
      return h.slice(0, -1);
    });
  };

  const handleClear = () => {
    if (!confirm('确定清空当前画布？')) return;
    setHistory((h) => [...h, project]);
    setProject((p) => ({ ...p, features: [] }));
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="logo">CityCanvas</span>
          <span className="tagline">架空城市地图绘制器</span>
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
          project={project}
          tool={tool}
          roadLevel={roadLevel}
          mapStyle={mapStyle}
          onProjectChange={updateProject}
        />
        <SidePanel
          project={project}
          mapStyle={mapStyle}
          onMapStyleChange={setMapStyle}
          onNameChange={(name) => setProject((p) => ({ ...p, name }))}
          onClear={handleClear}
          onExport={handleExport}
          onUndo={handleUndo}
        />
      </main>
    </div>
  );
}

export default App;
