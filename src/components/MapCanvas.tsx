import { useCallback, useEffect, useRef, useState } from 'react';
import type { CityProject, FeatureKind, MapFeature, Point, RoadLevel, Tool } from '../types';
import {
  POLYLINE_TOOLS,
  RECTANGLE_TOOLS,
  clampToMap,
  createId,
  rectFromCorners,
} from '../types';
import { findSnapPoint, screenToWorld } from '../engine/geometry';
import { fitViewport, renderMap, type PreviewState } from '../engine/renderer';

type Props = {
  project: CityProject;
  tool: Tool;
  roadLevel: RoadLevel;
  onProjectChange: (project: CityProject) => void;
};

function toolKind(tool: Tool): FeatureKind | null {
  if (tool === 'ocean') return 'ocean';
  if (tool === 'land') return 'land';
  if (tool === 'mountain') return 'mountain';
  if (tool === 'river') return 'river';
  if (tool === 'road') return 'road';
  return null;
}

const MIN_RECT_M = 20;

export function MapCanvas({ project, tool, roadLevel, onProjectChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [polyDraft, setPolyDraft] = useState<Point[]>([]);
  const [polyCursor, setPolyCursor] = useState<Point | null>(null);
  const [rectStart, setRectStart] = useState<Point | null>(null);
  const [rectEnd, setRectEnd] = useState<Point | null>(null);
  const panning = useRef<{ start: Point; origin: Point } | null>(null);
  const spaceDown = useRef(false);
  const fitted = useRef(false);

  const allEndpoints = project.features.flatMap((f) => f.points);

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

  const preview: PreviewState = rectStart && rectEnd
    ? { mode: 'rect', from: rectStart, to: rectEnd }
    : polyDraft.length > 0 || polyCursor
      ? { mode: 'polyline', points: polyDraft, cursor: polyCursor }
      : { mode: 'none' };

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
    renderMap(ctx, width, height, project, preview);
  }, [project, preview]);

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

  const addFeature = useCallback(
    (feature: MapFeature) => {
      onProjectChange({
        ...project,
        features: [...project.features, feature],
      });
    },
    [onProjectChange, project],
  );

  const finishPolyline = useCallback(() => {
    const kind = toolKind(tool);
    if (!kind || polyDraft.length < 2) {
      setPolyDraft([]);
      setPolyCursor(null);
      return;
    }

    addFeature({
      id: createId(),
      kind,
      points: polyDraft,
      closed: false,
      roadLevel: kind === 'road' ? roadLevel : undefined,
    });
    setPolyDraft([]);
    setPolyCursor(null);
  }, [addFeature, polyDraft, roadLevel, tool]);

  const commitRect = useCallback(
    (from: Point, to: Point) => {
      const kind = toolKind(tool);
      if (!kind || !RECTANGLE_TOOLS.includes(tool)) return;

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

    if (RECTANGLE_TOOLS.includes(activeTool)) {
      setRectStart(world);
      setRectEnd(world);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (POLYLINE_TOOLS.includes(activeTool)) {
      let pt = world;
      const snap = findSnapPoint(pt, allEndpoints, project.viewport.zoom);
      if (snap) pt = snap;
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

    if (rectStart) {
      setRectEnd(world);
      return;
    }

    if (POLYLINE_TOOLS.includes(tool) && polyDraft.length > 0) {
      let pt = world;
      const snap = findSnapPoint(pt, allEndpoints, project.viewport.zoom);
      if (snap) pt = snap;
      setPolyCursor(pt);
    }
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (panning.current) {
      panning.current = null;
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
      if (e.key === 'Enter') finishPolyline();
      if (e.key === 'Escape') {
        setPolyDraft([]);
        setPolyCursor(null);
        setRectStart(null);
        setRectEnd(null);
      }
      if (e.key === 'Backspace' && polyDraft.length > 0) {
        setPolyDraft((prev) => prev.slice(0, -1));
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [finishPolyline, polyDraft.length]);

  const hint = (() => {
    if (tool === 'pan') return '拖拽平移 · 滚轮缩放 · 左下角比例尺';
    if (RECTANGLE_TOOLS.includes(tool)) {
      return '拖拽绘制矩形区域 · 松开完成';
    }
    if (POLYLINE_TOOLS.includes(tool)) {
      return '点击添加节点 · Enter 完成 · Esc 取消 · Backspace 撤销节点';
    }
    return '选择工具开始绘制';
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
        onDoubleClick={finishPolyline}
      />
      <div className="canvas-hint">{hint}</div>
    </div>
  );
}
