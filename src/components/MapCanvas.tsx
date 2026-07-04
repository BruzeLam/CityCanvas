import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CityProject,
  FeatureKind,
  MapFeature,
  MapStyle,
  Point,
  RoadLevel,
  Tool,
} from '../types';
import { createId } from '../types';
import { findSnapPoint, screenToWorld } from '../engine/geometry';
import { renderMap } from '../engine/renderer';

type Props = {
  project: CityProject;
  tool: Tool;
  roadLevel: RoadLevel;
  mapStyle: MapStyle;
  onProjectChange: (project: CityProject) => void;
};

function toolKind(tool: Tool): FeatureKind | null {
  if (tool === 'river') return 'river';
  if (tool === 'coastline') return 'coastline';
  if (tool === 'greenbelt') return 'greenbelt';
  if (tool === 'road') return 'road';
  return null;
}

function isClosedKind(kind: FeatureKind): boolean {
  return kind === 'coastline' || kind === 'river' || kind === 'greenbelt';
}

export function MapCanvas({
  project,
  tool,
  roadLevel,
  mapStyle,
  onProjectChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Point[]>([]);
  const [draftClosed, setDraftClosed] = useState(false);
  const [cursor, setCursor] = useState<Point | null>(null);
  const panning = useRef<{ start: Point; origin: Point } | null>(null);
  const spaceDown = useRef(false);

  const allEndpoints = project.features.flatMap((f) => f.points);

  const getLocalPoint = useCallback(
    (clientX: number, clientY: number): Point => {
      const rect = canvasRef.current!.getBoundingClientRect();
      return screenToWorld(
        { x: clientX - rect.left, y: clientY - rect.top },
        project.viewport,
      );
    },
    [project.viewport],
  );

  const resize = useCallback(() => {
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
    renderMap(
      ctx,
      width,
      height,
      project,
      mapStyle,
      draft.length > 0 ? [...draft, ...(cursor ? [cursor] : [])] : null,
      draftClosed,
    );
  }, [project, mapStyle, draft, cursor, draftClosed]);

  useEffect(() => {
    resize();
  }, [resize]);

  useEffect(() => {
    const observer = new ResizeObserver(resize);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [resize]);

  const finishDraft = useCallback(
    (forceClosed = false) => {
      const kind = toolKind(tool);
      if (!kind || draft.length < 2) {
        setDraft([]);
        setDraftClosed(false);
        return;
      }

      const closed = (draftClosed || forceClosed) && isClosedKind(kind);
      const feature: MapFeature = {
        id: createId(),
        kind,
        points: draft,
        closed,
        roadLevel: kind === 'road' ? roadLevel : undefined,
      };

      onProjectChange({
        ...project,
        features: [...project.features, feature],
      });
      setDraft([]);
      setCursor(null);
      setDraftClosed(false);
    },
    [draft, draftClosed, onProjectChange, project, roadLevel, tool],
  );

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current!.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.min(4, Math.max(0.2, project.viewport.zoom * factor));

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

    const kind = toolKind(activeTool);
    if (!kind) return;

    let world = getLocalPoint(e.clientX, e.clientY);
    const snap = findSnapPoint(world, allEndpoints, project.viewport.zoom);
    if (snap) world = snap;

    if (draft.length >= 3 && dist(world, draft[0]) < 12 / project.viewport.zoom) {
      finishDraft(true);
      return;
    }

    setDraft((prev) => [...prev, world]);
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

    const kind = toolKind(tool);
    if (!kind || draft.length === 0) {
      setCursor(null);
      return;
    }

    let world = getLocalPoint(e.clientX, e.clientY);
    const snap = findSnapPoint(world, allEndpoints, project.viewport.zoom);
    if (snap) world = snap;
    setCursor(world);
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (panning.current) {
      panning.current = null;
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = true;
      if (e.key === 'Enter') finishDraft();
      if (e.key === 'Escape') {
        setDraft([]);
        setCursor(null);
        setDraftClosed(false);
      }
      if (e.key === 'Backspace' && draft.length > 0) {
        setDraft((prev) => prev.slice(0, -1));
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
  }, [draft.length, finishDraft]);

  const activeKind = toolKind(tool);
  const hint =
    tool === 'pan'
      ? '拖拽平移 · 滚轮缩放'
      : activeKind
        ? `点击添加节点 · Enter 完成 · Esc 取消 · 靠近首点闭合`
        : '选择绘制工具开始';

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onDoubleClick={() => finishDraft()}
      />
      <div className="canvas-hint">{hint}</div>
    </div>
  );
}

function dist(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
