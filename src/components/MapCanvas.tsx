import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CityProject,
  FeatureKind,
  LandformDrawMode,
  MapFeature,
  PathDrawMode,
  Point,
  RoadLevel,
  Tool,
} from '../types';
import {
  LANDFORM_TOOLS,
  PATH_GUIDED_TOOLS,
  POLYLINE_TOOLS,
  clampToMap,
  createId,
  rectFromCorners,
} from '../types';
import {
  formatAngle,
  formatLength,
  formatRadius,
  lineMetrics,
  sampleArcThrough,
  snapAnglePoint,
} from '../engine/curveMath';
import { findSnapPoint, screenToWorld } from '../engine/geometry';
import { dist, polygonArea, prepareFreehandPath } from '../engine/pathUtils';
import { findFeatureAt, findVertexIndex } from '../engine/hitTest';
import { fitViewport, renderMap, type PreviewState } from '../engine/renderer';

type Props = {
  project: CityProject;
  tool: Tool;
  roadLevel: RoadLevel;
  landformDrawMode: LandformDrawMode;
  pathDrawMode: PathDrawMode;
  selectedFeatureId: string | null;
  onSelectFeature: (id: string | null) => void;
  onProjectChange: (project: CityProject, options?: { undoSnapshot?: CityProject }) => void;
};

function toolKind(tool: Tool): FeatureKind | null {
  if (tool === 'ocean') return 'ocean';
  if (tool === 'land') return 'land';
  if (tool === 'mountain') return 'mountain';
  if (tool === 'river') return 'river';
  if (tool === 'road') return 'road';
  if (tool === 'railway') return 'railway';
  if (tool === 'label') return 'label';
  return null;
}

const MIN_RECT_M = 20;
const MIN_REGION_AREA_M2 = 400;
const MIN_FREEHAND_SAMPLE_M = 18;
const CLOSE_THRESHOLD_M = 35;

export function MapCanvas({
  project,
  tool,
  roadLevel,
  landformDrawMode,
  pathDrawMode,
  selectedFeatureId,
  onSelectFeature,
  onProjectChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [polyDraft, setPolyDraft] = useState<Point[]>([]);
  const [polyCursor, setPolyCursor] = useState<Point | null>(null);
  const [arcCommitted, setArcCommitted] = useState<Point[]>([]);
  const [arcStart, setArcStart] = useState<Point | null>(null);
  const [arcThrough, setArcThrough] = useState<Point | null>(null);
  const [arcCursor, setArcCursor] = useState<Point | null>(null);
  const [regionDraft, setRegionDraft] = useState<Point[]>([]);
  const [regionCursor, setRegionCursor] = useState<Point | null>(null);
  const [rectStart, setRectStart] = useState<Point | null>(null);
  const [rectEnd, setRectEnd] = useState<Point | null>(null);
  const [shiftSnap, setShiftSnap] = useState(false);
  const panning = useRef<{ start: Point; origin: Point } | null>(null);
  const freehandDrawing = useRef(false);
  const freehandPoints = useRef<Point[]>([]);
  const draggingVertex = useRef<{ featureId: string; index: number; moved: boolean } | null>(null);
  const undoSnapshot = useRef<CityProject | null>(null);
  const projectRef = useRef(project);
  const spaceDown = useRef(false);
  const shiftDown = useRef(false);
  const fitted = useRef(false);

  const allEndpoints = project.features.flatMap((f) => f.points);
  const isLandform = LANDFORM_TOOLS.includes(tool);
  const isPathGuided = PATH_GUIDED_TOOLS.includes(tool);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    setPolyDraft([]);
    setPolyCursor(null);
    setArcCommitted([]);
    setArcStart(null);
    setArcThrough(null);
    setArcCursor(null);
    setRegionDraft([]);
    setRegionCursor(null);
    setRectStart(null);
    setRectEnd(null);
    freehandDrawing.current = false;
    freehandPoints.current = [];
  }, [tool, landformDrawMode, pathDrawMode]);

  const getWorldPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = canvasRef.current!.getBoundingClientRect();
      const raw = screenToWorld(
        { x: clientX - rect.left, y: clientY - rect.top },
        project.viewport,
      );
      return clampToMap(raw, project.settings);
    },
    [project.viewport, project.settings],
  );

  const preview: PreviewState = (() => {
    if (rectStart && rectEnd) {
      return { mode: 'rect', from: rectStart, to: rectEnd };
    }
    if (isLandform && landformDrawMode !== 'rectangle') {
      if (regionDraft.length > 0 || regionCursor) {
        return {
          mode: 'region',
          points: regionDraft,
          cursor: regionCursor,
          closed: false,
        };
      }
    }
    if (isPathGuided && pathDrawMode === 'arc' && arcStart) {
      return {
        mode: 'arc',
        committed: arcCommitted,
        start: arcStart,
        through: arcThrough,
        cursor: arcCursor,
      };
    }
    if (isPathGuided && pathDrawMode === 'straight' && (polyDraft.length > 0 || polyCursor)) {
      return { mode: 'polyline', points: polyDraft, cursor: polyCursor };
    }
    if (polyDraft.length > 0 || polyCursor) {
      return { mode: 'polyline', points: polyDraft, cursor: polyCursor };
    }
    return { mode: 'none' };
  })();

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const { width, height } = container.getBoundingClientRect();
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    renderMap(ctx, width, height, project, preview, selectedFeatureId ? { featureId: selectedFeatureId } : null);
  }, [project, preview, selectedFeatureId]);

  useEffect(() => {
    paint();
  }, [paint]);

  useEffect(() => {
    const observer = new ResizeObserver(() => {
      if (!containerRef.current || fitted.current) return;
      const { width, height } = containerRef.current.getBoundingClientRect();
      if (width < 10 || height < 10) return;
      fitted.current = true;
      onProjectChange({
        ...project,
        viewport: fitViewport(width, height, project.settings.widthM, project.settings.heightM),
      });
    });
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [project, onProjectChange]);

  const removeFeature = useCallback(
    (id: string) => {
      onProjectChange(
        {
          ...projectRef.current,
          features: projectRef.current.features.filter((f) => f.id !== id),
        },
        { undoSnapshot: projectRef.current },
      );
      if (selectedFeatureId === id) onSelectFeature(null);
    },
    [onProjectChange, onSelectFeature, selectedFeatureId],
  );

  const updateFeaturePoint = useCallback(
    (featureId: string, index: number, point: Point, commit = false) => {
      const current = projectRef.current;
      const next = {
        ...current,
        features: current.features.map((f) =>
          f.id === featureId
            ? { ...f, points: f.points.map((p, i) => (i === index ? point : p)) }
            : f,
        ),
      };
      if (commit && undoSnapshot.current) {
        onProjectChange(next, { undoSnapshot: undoSnapshot.current });
        undoSnapshot.current = null;
      } else {
        onProjectChange(next);
      }
    },
    [onProjectChange],
  );

  const addFeature = useCallback(
    (feature: MapFeature) => {
      onProjectChange({
        ...project,
        features: [...project.features, feature],
      });
    },
    [onProjectChange, project],
  );

  const resetDrafts = useCallback(() => {
    setPolyDraft([]);
    setPolyCursor(null);
    setArcCommitted([]);
    setArcStart(null);
    setArcThrough(null);
    setArcCursor(null);
    setRegionDraft([]);
    setRegionCursor(null);
    setRectStart(null);
    setRectEnd(null);
    freehandDrawing.current = false;
    freehandPoints.current = [];
  }, []);

  const commitRegion = useCallback(
    (rawPoints: Point[]) => {
      const kind = toolKind(tool);
      if (!kind || !LANDFORM_TOOLS.includes(tool)) return;

      const points = prepareFreehandPath(rawPoints);
      if (points.length < 3) return;
      if (polygonArea(points) < MIN_REGION_AREA_M2) return;

      addFeature({
        id: createId(),
        kind,
        points,
        closed: true,
      });
      resetDrafts();
    },
    [addFeature, resetDrafts, tool],
  );

  const finishPolyline = useCallback(() => {
    const kind = toolKind(tool);
    const useArc = isPathGuided && pathDrawMode === 'arc';
    const points = useArc ? arcCommitted : polyDraft;
    if (!kind || points.length < 2) {
      resetDrafts();
      return;
    }

    addFeature({
      id: createId(),
      kind,
      points,
      closed: false,
      roadLevel: kind === 'road' ? roadLevel : undefined,
    });
    resetDrafts();
  }, [addFeature, arcCommitted, isPathGuided, pathDrawMode, polyDraft, resetDrafts, roadLevel, tool]);

  const finishPolygon = useCallback(() => {
    if (regionDraft.length < 3) return;
    commitRegion(regionDraft);
  }, [commitRegion, regionDraft]);

  const commitRect = useCallback(
    (from: Point, to: Point) => {
      const kind = toolKind(tool);
      if (!kind || !LANDFORM_TOOLS.includes(tool)) return;

      const points = rectFromCorners(from, to);
      const w = Math.abs(to.x - from.x);
      const h = Math.abs(to.y - from.y);
      if (w < MIN_RECT_M || h < MIN_RECT_M) return;

      addFeature({
        id: createId(),
        kind,
        points,
        closed: true,
      });
    },
    [addFeature, tool],
  );

  const snapPoint = useCallback(
    (pt: Point, extraTargets: Point[] = []): Point => {
      const targets = [...allEndpoints, ...extraTargets];
      return findSnapPoint(pt, targets, project.viewport.zoom) ?? pt;
    },
    [allEndpoints, project.viewport.zoom],
  );

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(8, Math.max(0.05, project.viewport.zoom * factor));

    onProjectChange({
      ...project,
      viewport: {
        zoom: newZoom,
        x: mouseX - (mouseX - project.viewport.x) * (newZoom / project.viewport.zoom),
        y: mouseY - (mouseY - project.viewport.y) * (newZoom / project.viewport.zoom),
      },
    });
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    const activeTool = spaceDown.current ? 'pan' : tool;

    if (activeTool === 'pan') {
      panning.current = {
        start: { x: e.clientX, y: e.clientY },
        origin: { x: project.viewport.x, y: project.viewport.y },
      };
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    const world = getWorldPoint(e.clientX, e.clientY);

    if (activeTool === 'eraser') {
      const hit = findFeatureAt(projectRef.current.features, world, projectRef.current.viewport.zoom);
      if (hit) removeFeature(hit.id);
      return;
    }

    if (activeTool === 'select') {
      const selected = selectedFeatureId
        ? projectRef.current.features.find((f) => f.id === selectedFeatureId)
        : null;
      if (selected) {
        const vi = findVertexIndex(selected, world, projectRef.current.viewport.zoom);
        if (vi !== null) {
          undoSnapshot.current = projectRef.current;
          draggingVertex.current = { featureId: selected.id, index: vi, moved: false };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          return;
        }
      }
      const hit = findFeatureAt(projectRef.current.features, world, projectRef.current.viewport.zoom);
      onSelectFeature(hit?.id ?? null);
      return;
    }

    if (activeTool === 'label') {
      const text = window.prompt('标注文字', '新区')?.trim();
      if (!text) return;
      addFeature({
        id: createId(),
        kind: 'label',
        points: [world],
        closed: false,
        labelText: text,
      });
      return;
    }

    if (LANDFORM_TOOLS.includes(activeTool)) {
      if (landformDrawMode === 'rectangle') {
        setRectStart(world);
        setRectEnd(world);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }

      if (landformDrawMode === 'freehand') {
        freehandDrawing.current = true;
        freehandPoints.current = [world];
        setRegionDraft([world]);
        setRegionCursor(null);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        return;
      }

      if (landformDrawMode === 'polygon') {
        if (regionDraft.length >= 3 && dist(world, regionDraft[0]) < CLOSE_THRESHOLD_M) {
          commitRegion(regionDraft);
          return;
        }
        const pt = snapPoint(world);
        setRegionDraft((prev) => [...prev, pt]);
        return;
      }
    }

    if (POLYLINE_TOOLS.includes(activeTool)) {
      const pt = snapPoint(world);

      if (isPathGuided && pathDrawMode === 'straight') {
        setPolyDraft((prev) => {
          if (prev.length === 0) return [pt];
          const last = prev[prev.length - 1];
          const next = shiftDown.current ? snapAnglePoint(last, snapPoint(world, prev)) : pt;
          return [...prev, next];
        });
        return;
      }

      if (isPathGuided && pathDrawMode === 'arc') {
        if (!arcStart) {
          setArcStart(pt);
        } else if (!arcThrough) {
          setArcThrough(pt);
        } else {
          const arc = sampleArcThrough(arcStart, arcThrough, pt);
          if (arc) {
            setArcCommitted((prev) => {
              const segment = prev.length > 0 ? arc.points.slice(1) : arc.points;
              return [...prev, ...segment];
            });
          }
          setArcThrough(null);
          setArcStart(pt);
          setArcCursor(null);
        }
        return;
      }

      setPolyDraft((prev) => [...prev, pt]);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (panning.current) {
      const dx = e.clientX - panning.current.start.x;
      const dy = e.clientY - panning.current.start.y;
      onProjectChange({
        ...project,
        viewport: {
          ...project.viewport,
          x: panning.current.origin.x + dx,
          y: panning.current.origin.y + dy,
        },
      });
      return;
    }

    const world = getWorldPoint(e.clientX, e.clientY);

    if (draggingVertex.current) {
      draggingVertex.current.moved = true;
      const { featureId, index } = draggingVertex.current;
      updateFeaturePoint(featureId, index, clampToMap(world, projectRef.current.settings), false);
      return;
    }

    if (rectStart) {
      setRectEnd(world);
      return;
    }

    if (freehandDrawing.current) {
      const last = freehandPoints.current[freehandPoints.current.length - 1];
      if (!last || dist(last, world) >= MIN_FREEHAND_SAMPLE_M) {
        freehandPoints.current = [...freehandPoints.current, world];
        setRegionDraft(freehandPoints.current);
      }
      return;
    }

    if (isLandform && landformDrawMode === 'polygon' && regionDraft.length > 0) {
      let pt = world;
      if (regionDraft.length >= 3 && dist(pt, regionDraft[0]) < CLOSE_THRESHOLD_M) {
        pt = regionDraft[0];
      } else {
        pt = snapPoint(world);
      }
      setRegionCursor(pt);
      return;
    }

    if (POLYLINE_TOOLS.includes(tool)) {
      if (isPathGuided && pathDrawMode === 'straight' && polyDraft.length > 0) {
        const last = polyDraft[polyDraft.length - 1];
        const base = snapPoint(world, polyDraft);
        setPolyCursor(shiftDown.current ? snapAnglePoint(last, base) : base);
        return;
      }
      if (isPathGuided && pathDrawMode === 'arc' && arcStart) {
        setArcCursor(snapPoint(world, arcCommitted));
        return;
      }
      if (polyDraft.length > 0) {
        setPolyCursor(snapPoint(world));
      }
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (draggingVertex.current) {
      const drag = draggingVertex.current;
      draggingVertex.current = null;
      if (drag.moved) {
        const world = getWorldPoint(e.clientX, e.clientY);
        updateFeaturePoint(
          drag.featureId,
          drag.index,
          clampToMap(world, projectRef.current.settings),
          true,
        );
      } else {
        undoSnapshot.current = null;
      }
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      return;
    }

    if (panning.current) {
      panning.current = null;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      return;
    }

    if (freehandDrawing.current) {
      freehandDrawing.current = false;
      const points = freehandPoints.current;
      freehandPoints.current = [];
      if (points.length >= 3) commitRegion(points);
      else resetDrafts();
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      return;
    }

    if (rectStart && rectEnd) {
      commitRect(rectStart, rectEnd);
      setRectStart(null);
      setRectEnd(null);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = true;
      if (e.key === 'Shift') {
        shiftDown.current = true;
        setShiftSnap(true);
      }
      if (e.key === 'Enter') {
        if (isLandform && landformDrawMode === 'polygon') finishPolygon();
        else finishPolyline();
      }
      if (e.key === 'Escape') {
        resetDrafts();
        if (tool === 'select') onSelectFeature(null);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFeatureId && tool === 'select') {
        if (!e.metaKey && !e.ctrlKey) {
          e.preventDefault();
          removeFeature(selectedFeatureId);
        }
      }
      if (e.key === 'Backspace' && tool !== 'select') {
        e.preventDefault();
        if (isLandform && landformDrawMode === 'polygon' && regionDraft.length > 0) {
          setRegionDraft((prev) => prev.slice(0, -1));
        } else if (isPathGuided && pathDrawMode === 'arc') {
          if (arcThrough) {
            setArcThrough(null);
          } else if (arcStart && arcCommitted.length === 0) {
            setArcStart(null);
            setArcCursor(null);
          } else if (arcCommitted.length > 0) {
            setArcCommitted((prev) => {
              const next = prev.slice(0, -1);
              setArcStart(next.length > 0 ? next[next.length - 1] : null);
              return next;
            });
            setArcCursor(null);
          }
        } else if (polyDraft.length > 0) {
          setPolyDraft((prev) => prev.slice(0, -1));
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
      if (e.key === 'Shift') {
        shiftDown.current = false;
        setShiftSnap(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [
    arcCommitted.length,
    arcStart,
    arcThrough,
    finishPolyline,
    finishPolygon,
    isLandform,
    isPathGuided,
    landformDrawMode,
    pathDrawMode,
    polyDraft.length,
    regionDraft.length,
    resetDrafts,
    onSelectFeature,
    removeFeature,
    selectedFeatureId,
    tool,
  ]);

  const hint = (() => {
    if (tool === 'pan') return '拖拽平移 · 滚轮缩放 · 左下角比例尺';
    if (tool === 'select') {
      return '点击选中 · 拖拽顶点编辑 · Delete 删除 · Esc 取消选中';
    }
    if (tool === 'eraser') return '点击要素即可删除';
    if (tool === 'label') return '点击地图放置标注 · 输入区名 / 车站名';
    if (isPathGuided) {
      if (pathDrawMode === 'straight') {
        return '点击添加节点 · Shift 吸附角度 · Enter 完成 · Esc 取消 · Backspace 撤销';
      }
      if (pathDrawMode === 'arc') {
        return '三点定弧 · 可连续多段 · Enter 完成 · Esc 取消 · Backspace 撤销';
      }
      return '点击添加节点 · Enter 完成 · Esc 取消 · Backspace 撤销节点';
    }
    if (isLandform) {
      if (landformDrawMode === 'freehand') {
        return '按住拖拽绘制轮廓 · 松开自动闭合 · Esc 取消';
      }
      if (landformDrawMode === 'polygon') {
        return '点击添加顶点 · 点击起点或 Enter 闭合 · Backspace 撤销 · Esc 取消';
      }
      return '拖拽框选矩形区域 · 松开完成';
    }
    if (POLYLINE_TOOLS.includes(tool)) {
      return '点击添加节点 · Enter 完成 · Esc 取消 · Backspace 撤销节点';
    }
    return '选择工具开始绘制';
  })();

  const metrics = (() => {
    if (isPathGuided && pathDrawMode === 'straight' && polyDraft.length > 0 && polyCursor) {
      const m = lineMetrics(polyDraft[polyDraft.length - 1], polyCursor);
      const shiftHint = shiftSnap ? ' · Shift 吸附' : '';
      return `长度 ${formatLength(m.lengthM)} · 角度 ${formatAngle(m.angleDeg)}${shiftHint}`;
    }
    if (isPathGuided && pathDrawMode === 'arc' && arcStart && arcThrough && arcCursor) {
      const arc = sampleArcThrough(arcStart, arcThrough, arcCursor);
      if (arc) {
        return `半径 ${formatRadius(arc.radius)} · 圆心角 ${formatAngle(arc.sweepDeg)}`;
      }
    }
    return null;
  })();

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={POLYLINE_TOOLS.includes(tool) ? finishPolyline : undefined}
      />
      <div className="canvas-hint">{hint}</div>
      {metrics && <div className="canvas-metrics">{metrics}</div>}
    </div>
  );
}
