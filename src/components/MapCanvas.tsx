import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CityProject,
  FeatureGrade,
  FeatureKind,
  MapFeature,
  PathDrawMode,
  Point,
  RoadLevel,
  Tool,
} from '../types';
import {
  PATH_GUIDED_TOOLS,
  POLYLINE_TOOLS,
  TERRAIN_BRUSH_TOOLS,
  clampGrade,
  clampToMap,
  createId,
  featureGrade,
  formatGrade,
} from '../types';
import {
  formatAngle,
  formatLength,
  formatRadius,
  lineMetrics,
  curveFromThreePoints,
  curveAdaptiveViaControl,
  curveFromTangent,
  headingFromPolyline,
  snapAnglePoint,
} from '../engine/curveMath';
import {
  findPathGuideSnap,
  headingAtPoint,
  screenToWorld,
  type GuideSnap,
  type SnapKind,
} from '../engine/geometry';
import { weaveSameGradeCrossings, reweaveAllCrossings } from '../engine/junctions';
import { dist } from '../engine/pathUtils';
import { findFeatureAt, findVertexIndex } from '../engine/hitTest';
import { fitViewport, renderMap, type PreviewGuide, type PreviewState } from '../engine/renderer';
import {
  TERRAIN_GREEN,
  TERRAIN_LAND,
  TERRAIN_WATER,
  cloneTerrain,
  ensureTerrain,
  stampBrush,
  type TerrainCell,
} from '../engine/terrain';

type Props = {
  project: CityProject;
  tool: Tool;
  roadLevel: RoadLevel;
  drawGrade: FeatureGrade;
  brushSizeM: number;
  brushThickness: number;
  pathDrawMode: PathDrawMode;
  selectedFeatureId: string | null;
  onSelectFeature: (id: string | null) => void;
  onDrawGradeChange: (grade: FeatureGrade) => void;
  onProjectChange: (project: CityProject, options?: { undoSnapshot?: CityProject }) => void;
};

function toolKind(tool: Tool): FeatureKind | null {
  if (tool === 'river') return 'river';
  if (tool === 'road') return 'road';
  if (tool === 'railway') return 'railway';
  if (tool === 'label') return 'label';
  return null;
}

function brushCellForTool(tool: Tool): TerrainCell | null {
  if (tool === 'land') return TERRAIN_LAND;
  if (tool === 'ocean') return TERRAIN_WATER;
  if (tool === 'mountain') return TERRAIN_GREEN;
  return null;
}

function brushPreviewKind(tool: Tool): 'land' | 'water' | 'green' | null {
  if (tool === 'land') return 'land';
  if (tool === 'ocean') return 'water';
  if (tool === 'mountain') return 'green';
  return null;
}

function lerpPoint(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function MapCanvas({
  project,
  tool,
  roadLevel,
  drawGrade,
  brushSizeM,
  brushThickness,
  pathDrawMode,
  selectedFeatureId,
  onSelectFeature,
  onDrawGradeChange,
  onProjectChange,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [polyDraft, setPolyDraft] = useState<Point[]>([]);
  const [polyCursor, setPolyCursor] = useState<Point | null>(null);
  /** 三点弯中间点 B（自由模式）；有锚点切线时不用 */
  const [curveControl, setCurveControl] = useState<Point | null>(null);
  /** 从直线/已有端点延伸时的切线航向（弧度） */
  const [curveAnchorHeading, setCurveAnchorHeading] = useState<number | null>(null);
  const [lastSnapKind, setLastSnapKind] = useState<SnapKind>('none');
  const [activeGuide, setActiveGuide] = useState<PreviewGuide | null>(null);
  const [brushCursor, setBrushCursor] = useState<Point | null>(null);
  const [shiftSnap, setShiftSnap] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const panning = useRef<{ start: Point; origin: Point } | null>(null);
  const brushPainting = useRef(false);
  const lastBrushPoint = useRef<Point | null>(null);
  const draggingVertex = useRef<{ featureId: string; index: number; moved: boolean } | null>(null);
  const undoSnapshot = useRef<CityProject | null>(null);
  const projectRef = useRef(project);
  const spaceDown = useRef(false);
  const shiftDown = useRef(false);
  const fitted = useRef(false);

  const allEndpoints = project.features.flatMap((f) => f.points);
  const pathSegments = project.features
    .filter((f) => f.kind === 'road' || f.kind === 'railway')
    .flatMap((f) => {
      const segs: { a: Point; b: Point }[] = [];
      for (let i = 1; i < f.points.length; i++) {
        segs.push({ a: f.points[i - 1], b: f.points[i] });
      }
      return segs;
    });
  const isTerrainBrush = TERRAIN_BRUSH_TOOLS.includes(tool);
  const isPathGuided = PATH_GUIDED_TOOLS.includes(tool);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    setPolyDraft([]);
    setPolyCursor(null);
    setCurveControl(null);
    setCurveAnchorHeading(null);
    setLastSnapKind('none');
    setActiveGuide(null);
    setBrushCursor(null);
    brushPainting.current = false;
    lastBrushPoint.current = null;
    undoSnapshot.current = null;
  }, [tool, pathDrawMode]);

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
    if (isTerrainBrush && brushCursor) {
      const kind = brushPreviewKind(tool);
      if (kind) {
        return {
          mode: 'brush',
          center: brushCursor,
          radiusM: brushSizeM,
          thickness: brushThickness,
          kind,
        };
      }
    }
    if (isPathGuided && pathDrawMode === 'curve' && (polyDraft.length > 0 || polyCursor || curveControl)) {
      const startHeading =
        curveAnchorHeading ?? headingFromPolyline(polyDraft);
      const endHeading =
        polyCursor && lastSnapKind === 'endpoint'
          ? headingAtPoint(polyCursor, pathSegments, project.viewport.zoom)
          : null;
      return {
        mode: 'curve',
        points: polyDraft,
        control: curveAnchorHeading != null ? null : curveControl,
        cursor: polyCursor,
        startHeading,
        endHeading,
        adaptivePreview:
          curveAnchorHeading == null &&
          lastSnapKind === 'endpoint' &&
          curveControl != null,
        guide: activeGuide,
      };
    }
    if (isPathGuided && pathDrawMode === 'straight' && (polyDraft.length > 0 || polyCursor)) {
      return { mode: 'polyline', points: polyDraft, cursor: polyCursor, guide: activeGuide };
    }
    if (polyDraft.length > 0 || polyCursor) {
      return { mode: 'polyline', points: polyDraft, cursor: polyCursor, guide: activeGuide };
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
      let nextFeatures = current.features.map((f) =>
        f.id === featureId
          ? { ...f, points: f.points.map((p, i) => (i === index ? point : p)) }
          : f,
      );
      // 拖拽结束：同层交叉重新织路口节点
      if (commit) {
        nextFeatures = reweaveAllCrossings(nextFeatures);
      }
      const next = { ...current, features: nextFeatures };
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
      const nextFeatures =
        feature.kind === 'road' || feature.kind === 'railway'
          ? weaveSameGradeCrossings(project.features, feature)
          : [...project.features, feature];
      onProjectChange({
        ...project,
        features: nextFeatures,
      });
    },
    [onProjectChange, project],
  );

  const resetDrafts = useCallback(() => {
    setPolyDraft([]);
    setPolyCursor(null);
    setCurveControl(null);
    setCurveAnchorHeading(null);
    setLastSnapKind('none');
    setActiveGuide(null);
    brushPainting.current = false;
    lastBrushPoint.current = null;
  }, []);

  const stampBrushPoints = useCallback(
    (points: Point[], cell: TerrainCell) => {
      if (points.length === 0) return;
      const current = projectRef.current;
      const terrain = ensureTerrain(current.settings, current.terrain);
      for (const p of points) {
        stampBrush(terrain, p, brushSizeM, brushThickness, cell);
      }
      const next = { ...current, terrain };
      projectRef.current = next;
      onProjectChange(next);
    },
    [brushSizeM, brushThickness, onProjectChange],
  );

  const stampBrushStroke = useCallback(
    (from: Point, to: Point, cell: TerrainCell) => {
      const spacing = Math.max(1, brushSizeM * 0.35);
      const d = dist(from, to);
      if (d < spacing) {
        stampBrushPoints([to], cell);
        return;
      }
      const steps = Math.ceil(d / spacing);
      const points: Point[] = [];
      for (let i = 1; i <= steps; i++) {
        points.push(lerpPoint(from, to, i / steps));
      }
      stampBrushPoints(points, cell);
    },
    [brushSizeM, stampBrushPoints],
  );

  const finishPolyline = useCallback(() => {
    const kind = toolKind(tool);
    // 弯道未完成三点时不提交残缺控制点
    if (!kind || polyDraft.length < 2) {
      resetDrafts();
      return;
    }

    addFeature({
      id: createId(),
      kind,
      points: polyDraft,
      closed: false,
      roadLevel: kind === 'road' ? roadLevel : undefined,
      grade: kind === 'road' || kind === 'railway' ? drawGrade : undefined,
    });
    resetDrafts();
  }, [addFeature, drawGrade, polyDraft, resetDrafts, roadLevel, tool]);

  const applyGuideSnap = useCallback(
    (pt: Point, extraTargets: Point[] = [], from?: Point | null): GuideSnap => {
      if (!isPathGuided) {
        const targets = [...allEndpoints, ...extraTargets];
        const hit = findPathGuideSnap(pt, targets, [], project.viewport.zoom, from);
        return hit;
      }
      const targets = [...allEndpoints, ...extraTargets];
      return findPathGuideSnap(pt, targets, pathSegments, project.viewport.zoom, from);
    },
    [allEndpoints, isPathGuided, pathSegments, project.viewport.zoom],
  );

  const snapPoint = useCallback(
    (pt: Point, extraTargets: Point[] = [], from?: Point | null) => {
      const hit = applyGuideSnap(pt, extraTargets, from);
      setLastSnapKind(hit.kind);
      if (hit.kind !== 'none' && hit.kind !== 'endpoint' && from) {
        setActiveGuide({
          kind: hit.kind,
          from,
          to: hit.point,
          ref: hit.ref,
        });
      } else if (hit.kind === 'centerline' && hit.ref) {
        setActiveGuide({
          kind: 'centerline',
          from: hit.point,
          to: hit.point,
          ref: hit.ref,
        });
      } else {
        setActiveGuide(null);
      }
      return hit.point;
    },
    [applyGuideSnap],
  );

  const handleWheel = useCallback(
    (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const canvas = canvasRef.current;
      const current = projectRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;
      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      const newZoom = Math.min(8, Math.max(0.05, current.viewport.zoom * factor));

      onProjectChange({
        ...current,
        viewport: {
          zoom: newZoom,
          x: mouseX - (mouseX - current.viewport.x) * (newZoom / current.viewport.zoom),
          y: mouseY - (mouseY - current.viewport.y) * (newZoom / current.viewport.zoom),
        },
      });
    },
    [onProjectChange],
  );

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    // 必须非 passive，否则 preventDefault 无效，滚轮会带动左右栏滚动
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const nudgeGrade = useCallback(
    (delta: number) => {
      if (selectedFeatureId && tool === 'select') {
        const selected = projectRef.current.features.find((f) => f.id === selectedFeatureId);
        if (selected && (selected.kind === 'road' || selected.kind === 'railway')) {
          const nextGrade = clampGrade(featureGrade(selected) + delta);
          onProjectChange(
            {
              ...projectRef.current,
              features: projectRef.current.features.map((f) =>
                f.id === selectedFeatureId ? { ...f, grade: nextGrade } : f,
              ),
            },
            { undoSnapshot: projectRef.current },
          );
          onDrawGradeChange(nextGrade);
          return;
        }
      }
      onDrawGradeChange(clampGrade(drawGrade + delta));
    },
    [drawGrade, onDrawGradeChange, onProjectChange, selectedFeatureId, tool],
  );

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    // 焦点回到画布，避免空格/WASD 落到侧栏按钮上
    canvasRef.current?.focus({ preventScroll: true });

    // 右键：打断当前绘制（禁用浏览器菜单）
    if (e.button === 2) {
      e.preventDefault();
      if (brushPainting.current && undoSnapshot.current) {
        onProjectChange(undoSnapshot.current);
        undoSnapshot.current = null;
      }
      resetDrafts();
      if (tool === 'select') onSelectFeature(null);
      return;
    }

    const activeTool = spaceDown.current ? 'pan' : tool;

    if (activeTool === 'pan') {
      panning.current = {
        start: { x: e.clientX, y: e.clientY },
        origin: { x: project.viewport.x, y: project.viewport.y },
      };
      setIsPanning(true);
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
      if (hit && (hit.kind === 'road' || hit.kind === 'railway')) {
        onDrawGradeChange(featureGrade(hit));
      }
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

    const brushCell = brushCellForTool(activeTool);
    if (brushCell != null) {
      const current = projectRef.current;
      const terrain = ensureTerrain(current.settings, current.terrain);
      undoSnapshot.current = {
        ...current,
        terrain: cloneTerrain(terrain),
      };
      stampBrush(terrain, world, brushSizeM, brushThickness, brushCell);
      const next = { ...current, terrain };
      projectRef.current = next;
      onProjectChange(next);
      brushPainting.current = true;
      lastBrushPoint.current = world;
      setBrushCursor(world);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      return;
    }

    if (POLYLINE_TOOLS.includes(activeTool)) {
      const from = polyDraft.length > 0 ? polyDraft[polyDraft.length - 1] : null;
      const pt = snapPoint(world, [], from);

      if (isPathGuided && pathDrawMode === 'straight') {
        setPolyDraft((prev) => {
          if (prev.length === 0) return [pt];
          const last = prev[prev.length - 1];
          const snapped = snapPoint(world, prev, last);
          // 默认正交；按住 Shift 取消角度锁，可任意方向
          const next = shiftDown.current ? snapped : snapAnglePoint(last, snapped, 90);
          return [...prev, next];
        });
        return;
      }

      if (isPathGuided && pathDrawMode === 'curve') {
        // 有锚点切线（从直线端点延伸）：A 已定，再点终点即可
        // 无切线（空白/中段开岔）：自由三点 A → B → C
        if (polyDraft.length === 0) {
          const hit = applyGuideSnap(world, [], null);
          setLastSnapKind(hit.kind);
          const anchor =
            hit.kind === 'endpoint'
              ? headingAtPoint(hit.point, pathSegments, project.viewport.zoom)
              : null;
          setPolyDraft([hit.point]);
          setCurveControl(null);
          setCurveAnchorHeading(anchor);
          if (hit.kind === 'centerline' && hit.ref) {
            setActiveGuide({
              kind: 'centerline',
              from: hit.point,
              to: hit.point,
              ref: hit.ref,
            });
          } else {
            setActiveGuide(null);
          }
          return;
        }

        const a = polyDraft[polyDraft.length - 1];
        const tangentHeading =
          curveAnchorHeading ?? headingFromPolyline(polyDraft);

        // 切线锚点模式（从直线端点延伸 / 连续弯道）：点终点即可
        if (curveControl == null && tangentHeading != null) {
          const hit = applyGuideSnap(world, polyDraft, a);
          setLastSnapKind(hit.kind);
          const c = hit.point;
          if (dist(a, c) < 4) return;

          const curve = curveFromTangent(a, tangentHeading, c);
          if (curve && curve.points.length >= 2) {
            setPolyDraft([...polyDraft, ...curve.points.slice(1)]);
            setCurveControl(null);
            setCurveAnchorHeading(curve.endHeading);
            setActiveGuide(null);
          }
          return;
        }

        if (!curveControl) {
          const hit = applyGuideSnap(world, polyDraft, a);
          setLastSnapKind(hit.kind);
          const next = shiftDown.current ? snapAnglePoint(a, hit.point) : hit.point;
          if (dist(a, next) < 4) return;
          setCurveControl(next);
          setCurveAnchorHeading(null);
          if (hit.kind === 'centerline' && hit.ref) {
            setActiveGuide({
              kind: 'centerline',
              from: hit.point,
              to: hit.point,
              ref: hit.ref,
            });
          } else if (hit.kind === 'perpendicular' || hit.kind === 'parallel') {
            setActiveGuide({
              kind: hit.kind,
              from: a,
              to: hit.point,
              ref: hit.ref,
            });
          } else {
            setActiveGuide(null);
          }
          return;
        }

        const b = curveControl;
        const hit = applyGuideSnap(world, polyDraft, a);
        setLastSnapKind(hit.kind);
        const c = hit.point;
        if (dist(b, c) < 4) return;

        const startHeading = headingFromPolyline(polyDraft);
        const endHeading =
          hit.kind === 'endpoint'
            ? headingAtPoint(c, pathSegments, project.viewport.zoom)
            : null;
        const curve =
          hit.kind === 'endpoint'
            ? curveAdaptiveViaControl(a, b, c, startHeading, endHeading)
            : curveFromThreePoints(a, b, c);

        if (curve && curve.points.length >= 2) {
          setPolyDraft([...polyDraft, ...curve.points.slice(1)]);
          setCurveControl(null);
          setCurveAnchorHeading(curve.endHeading);
          setActiveGuide(null);
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

    if (brushPainting.current) {
      const cell = brushCellForTool(tool);
      if (cell != null) {
        const last = lastBrushPoint.current;
        const spacing = Math.max(1, brushSizeM * 0.35);
        if (!last || dist(last, world) >= spacing) {
          if (last) stampBrushStroke(last, world, cell);
          else stampBrushPoints([world], cell);
          lastBrushPoint.current = world;
        }
        setBrushCursor(world);
      }
      return;
    }

    if (isTerrainBrush) {
      setBrushCursor(world);
      return;
    }

    if (POLYLINE_TOOLS.includes(tool)) {
      if (isPathGuided && pathDrawMode === 'straight' && polyDraft.length > 0) {
        const last = polyDraft[polyDraft.length - 1];
        const base = snapPoint(world, polyDraft, last);
        setPolyCursor(shiftDown.current ? base : snapAnglePoint(last, base, 90));
        return;
      }
      if (isPathGuided && pathDrawMode === 'curve') {
        if (polyDraft.length === 0) {
          // 首点也可预览中心线吸附
          setPolyCursor(snapPoint(world));
          return;
        }
        const last = polyDraft[polyDraft.length - 1];
        const base = snapPoint(world, polyDraft, last);
        setPolyCursor(shiftDown.current && !curveControl ? snapAnglePoint(last, base) : base);
        return;
      }
      if (polyDraft.length > 0) {
        setPolyCursor(snapPoint(world, [], polyDraft[polyDraft.length - 1]));
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
      setIsPanning(false);
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
      return;
    }

    if (brushPainting.current) {
      brushPainting.current = false;
      lastBrushPoint.current = null;
      const snapshot = undoSnapshot.current;
      undoSnapshot.current = null;
      if (snapshot) {
        onProjectChange(projectRef.current, { undoSnapshot: snapshot });
      }
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    }
  };

  useEffect(() => {
    const isTypingTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      // 忽略浏览器组合键，避免和撤销等冲突
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      // 空格：只用于临时拖图，禁止激活侧栏按钮
      if (e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) spaceDown.current = true;
        return;
      }

      if (e.key === 'Shift') {
        shiftDown.current = true;
        setShiftSnap(true);
      }

      // WASD / 方向键平移（capture 阶段已 preventDefault，避免侧栏滚动）
      const panKey = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      const panStep = 56;
      let panDx = 0;
      let panDy = 0;
      if (panKey === 'a' || panKey === 'ArrowLeft') panDx = panStep;
      if (panKey === 'd' || panKey === 'ArrowRight') panDx = -panStep;
      if (panKey === 'w' || panKey === 'ArrowUp') panDy = panStep;
      if (panKey === 's' || panKey === 'ArrowDown') panDy = -panStep;
      if (panDx !== 0 || panDy !== 0) {
        e.preventDefault();
        const current = projectRef.current;
        onProjectChange({
          ...current,
          viewport: {
            ...current.viewport,
            x: current.viewport.x + panDx,
            y: current.viewport.y + panDy,
          },
        });
        return;
      }

      if (e.key === 'Enter') {
        finishPolyline();
      }
      if (e.key === 'Escape') {
        resetDrafts();
        if (tool === 'select') onSelectFeature(null);
      }
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        nudgeGrade(-1);
      }
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        nudgeGrade(1);
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedFeatureId && tool === 'select') {
        e.preventDefault();
        removeFeature(selectedFeatureId);
      }
      if (e.key === 'Backspace' && tool !== 'select') {
        e.preventDefault();
        if (curveControl) {
          setCurveControl(null);
        } else if (polyDraft.length > 0) {
          const next = polyDraft.slice(0, -1);
          setPolyDraft(next);
          setCurveControl(null);
          setCurveAnchorHeading(headingFromPolyline(next));
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        spaceDown.current = false;
      }
      if (e.key === 'Shift') {
        shiftDown.current = false;
        setShiftSnap(false);
      }
    };
    // capture：抢在侧栏滚动/按钮激活之前处理
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
    };
  }, [
    finishPolyline,
    nudgeGrade,
    onProjectChange,
    polyDraft,
    curveControl,
    resetDrafts,
    onSelectFeature,
    removeFeature,
    selectedFeatureId,
    tool,
  ]);

  const hint = (() => {
    if (tool === 'pan') return '拖动模式 · 左键拖图 · WASD/方向键平移 · 滚轮缩放';
    if (tool === 'select') {
      return '编辑模式 · 点击选中 · 拖顶点 · -/= 换标高 · Delete 删除 · 右键取消';
    }
    if (tool === 'eraser') return '点击要素即可删除 · 空格临时拖图';
    if (tool === 'label') return '点击地图放置标注 · 空格临时拖图';
    if (isTerrainBrush) {
      return '按住拖拽绘制地貌 · 调节大小/厚度 · 右键撤销本笔 · 空格拖图';
    }
    if (isPathGuided) {
      const gradeHint = `标高 ${formatGrade(drawGrade)} · -/= 换层`;
      if (pathDrawMode === 'straight') {
        return `直线默认水平/垂直 · Shift 自由角度 · 双击完成 · ${gradeHint}`;
      }
      if (!polyDraft.length) {
        return `弯道：点起点（吸到直线端点则锁定切线锚点）· ${gradeHint}`;
      }
      if (curveAnchorHeading != null || headingFromPolyline(polyDraft) != null) {
        return `弯道：锚点已锁定 · 点终点拉弧 · 双击完成 · ${gradeHint}`;
      }
      if (!curveControl) {
        return `弯道：自由三点 · 点中间点 B · ${gradeHint}`;
      }
      return `弯道：点终点 C · ${gradeHint}`;
    }
    if (POLYLINE_TOOLS.includes(tool)) {
      return '点击加点 · 双击完成 · 右键打断 · 空格拖图';
    }
    return '选择工具开始绘制';
  })();

  const canvasCursor =
    tool === 'pan' ? (isPanning ? 'grabbing' : 'grab') : tool === 'select' ? 'default' : tool === 'eraser' ? 'pointer' : 'crosshair';

  const snapLabel = (kind: SnapKind) => {
    if (kind === 'endpoint') return '端点';
    if (kind === 'centerline') return '中心线';
    if (kind === 'perpendicular') return '垂直';
    if (kind === 'parallel') return '平行';
    return null;
  };

  const metrics = (() => {
    const tag = snapLabel(lastSnapKind);
    const tagText = tag ? ` · ${tag}` : '';
    const shiftHint = shiftSnap ? ' · Shift' : '';

    if (isPathGuided && pathDrawMode === 'straight' && polyDraft.length > 0 && polyCursor) {
      const m = lineMetrics(polyDraft[polyDraft.length - 1], polyCursor);
      const angleLock = shiftSnap ? ' · 自由角度' : ' · 正交';
      return {
        lines: [
          `长度 ${formatLength(m.lengthM)}`,
          `方位 ${formatAngle(m.angleDeg)}${tagText}${angleLock}`,
        ],
      };
    }

    if (isPathGuided && pathDrawMode === 'curve' && polyDraft.length > 0 && polyCursor) {
      const a = polyDraft[polyDraft.length - 1];
      const tangentHeading = curveAnchorHeading ?? headingFromPolyline(polyDraft);

      if (!curveControl && tangentHeading != null) {
        const curve = curveFromTangent(a, tangentHeading, polyCursor);
        if (curve) {
          if (!Number.isFinite(curve.radius)) {
            const m = lineMetrics(a, polyCursor);
            return {
              lines: [
                `长度 ${formatLength(m.lengthM)}`,
                `锚点切线 · 直线${tagText}`,
              ],
            };
          }
          return {
            lines: [
              formatRadius(curve.radius),
              `弯曲 ${formatAngle(curve.sweepDeg)} · 锚点切线${tagText}`,
            ],
          };
        }
      }

      if (!curveControl) {
        const m = lineMetrics(a, polyCursor);
        return {
          lines: [
            `B 预览 ${formatLength(m.lengthM)}`,
            `方位 ${formatAngle(m.angleDeg)}${tagText}${shiftHint}`,
          ],
        };
      }

      const startHeading = headingFromPolyline(polyDraft);
      const endHeading =
        lastSnapKind === 'endpoint'
          ? headingAtPoint(polyCursor, pathSegments, project.viewport.zoom)
          : null;
      const curve =
        lastSnapKind === 'endpoint'
          ? curveAdaptiveViaControl(a, curveControl, polyCursor, startHeading, endHeading)
          : curveFromThreePoints(a, curveControl, polyCursor);
      if (curve) {
        if (!Number.isFinite(curve.radius)) {
          const m = lineMetrics(a, polyCursor);
          return { lines: [`直线 ${formatLength(m.lengthM)}${tagText}`] };
        }
        const rText =
          curve.radius2 != null
            ? `${formatRadius(curve.radius)} / ${formatRadius(curve.radius2)}`
            : formatRadius(curve.radius);
        return {
          lines: [
            curve.adaptive ? `变半径 ${rText}` : rText,
            `圆心角 ${formatAngle(curve.sweepDeg)}${tagText}`,
          ],
        };
      }
    }

    if (isPathGuided && pathDrawMode === 'curve' && polyDraft.length === 0 && polyCursor) {
      return {
        lines: [tag ? `吸附 ${tag}` : '移动以选择起点', '端点=切线锚点'],
      };
    }

    return null;
  })();

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        tabIndex={0}
        style={{ cursor: canvasCursor }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={handleContextMenu}
        onDoubleClick={() => {
          if (POLYLINE_TOOLS.includes(tool)) finishPolyline();
        }}
      />
      <div className="canvas-hint">{hint}</div>
      {metrics && (
        <div className="canvas-metrics canvas-metrics-hud">
          {metrics.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
    </div>
  );
}
