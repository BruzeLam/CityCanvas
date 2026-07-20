import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CityProject,
  EraserTarget,
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
  BRUSH_TOOLS,
  clampGrade,
  clampToMap,
  createId,
  eraserTargetLabel,
  featureGrade,
  formatGrade,
} from '../types';
import {
  formatAngle,
  formatLength,
  formatRadius,
  lineMetrics,
  curveFromThreePoints,
  curveFromTangent,
  headingFromPolyline,
  snapAnglePoint,
} from '../engine/curveMath';
import {
  findPathGuideSnap,
  headingAlongSegment,
  headingAtPoint,
  screenToWorld,
  type GuideSnap,
  type SnapKind,
} from '../engine/geometry';
import {
  findPathTipAt,
  findNearestAnyGradeAttachment,
  tryMergeHeadToTail,
  attachCrossGradeTips,
  reweaveAllCrossings,
  RAMP_ATTACH_M,
} from '../engine/junctions';
import { dist } from '../engine/pathUtils';
import { findFeatureAt, findFeaturesInRadius, findVertexIndex } from '../engine/hitTest';
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
import {
  buildParallelPaths,
  guideFromDraft,
  type ParallelSide,
} from '../engine/parallelOffset';
import { FloatingDock } from './FloatingDock';

type Props = {
  project: CityProject;
  tool: Tool;
  roadLevel: RoadLevel;
  drawGrade: FeatureGrade;
  brushSizeM: number;
  brushThickness: number;
  eraserTarget: EraserTarget;
  pathDrawMode: PathDrawMode;
  parallelEnabled: boolean;
  parallelSpacingM: number;
  parallelSide: ParallelSide;
  selectedFeatureId: string | null;
  canUndo: boolean;
  onSelectFeature: (id: string | null) => void;
  onDrawGradeChange: (grade: FeatureGrade) => void;
  onToolChange: (tool: Tool) => void;
  onRoadLevelChange: (level: RoadLevel) => void;
  onPathDrawModeChange: (mode: PathDrawMode) => void;
  onParallelEnabledChange: (on: boolean) => void;
  onParallelSpacingChange: (m: number) => void;
  onParallelSideChange: (side: ParallelSide) => void;
  onEraserTargetChange: (target: EraserTarget) => void;
  onUndo: () => void;
  onProjectChange: (
    project: CityProject,
    opts?: { undoSnapshot?: CityProject },
  ) => void;
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

function eraserFeatureKind(target: EraserTarget): FeatureKind | null {
  if (target === 'terrain') return null;
  return target;
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
  eraserTarget,
  pathDrawMode,
  parallelEnabled,
  parallelSpacingM,
  parallelSide,
  selectedFeatureId,
  canUndo,
  onSelectFeature,
  onDrawGradeChange,
  onToolChange,
  onRoadLevelChange,
  onPathDrawModeChange,
  onParallelEnabledChange,
  onParallelSpacingChange,
  onParallelSideChange,
  onEraserTargetChange,
  onUndo,
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
  /** 本笔路径起点标高（吸附到已有路时锁定） */
  const [draftStartGrade, setDraftStartGrade] = useState<FeatureGrade | null>(null);
  const [lastSnapKind, setLastSnapKind] = useState<SnapKind>('none');
  const [activeGuide, setActiveGuide] = useState<PreviewGuide | null>(null);
  const [brushCursor, setBrushCursor] = useState<Point | null>(null);
  const [shiftSnap, setShiftSnap] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  /** 光标相对画布容器的屏幕坐标（悬浮 HUD） */
  const [pointerScreen, setPointerScreen] = useState<{ x: number; y: number } | null>(null);
  const panning = useRef<{ start: Point; origin: Point } | null>(null);
  const brushPainting = useRef(false);
  const lastBrushPoint = useRef<Point | null>(null);
  const draggingVertex = useRef<{ featureId: string; index: number; moved: boolean } | null>(null);
  const undoSnapshot = useRef<CityProject | null>(null);
  const projectRef = useRef(project);
  const spaceDown = useRef(false);
  const shiftDown = useRef(false);
  const altDown = useRef(false);
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
  const isBrushTool = BRUSH_TOOLS.includes(tool);
  const isPathGuided = PATH_GUIDED_TOOLS.includes(tool);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    setPolyDraft([]);
    setPolyCursor(null);
    setCurveControl(null);
    setCurveAnchorHeading(null);
    setDraftStartGrade(null);
    setLastSnapKind('none');
    setActiveGuide(null);
    setBrushCursor(null);
    setPointerScreen(null);
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

  const parallelPreviewPaths = (guide: Point[]): Point[][] | undefined => {
    if (!parallelEnabled || !isPathGuided || guide.length < 2) return undefined;
    return buildParallelPaths(guide, parallelSpacingM, parallelSide);
  };

  const preview: PreviewState = (() => {
    if (isBrushTool && brushCursor) {
      const kind =
        tool === 'eraser'
          ? eraserTarget === 'terrain'
            ? 'land'
            : 'erase'
          : brushPreviewKind(tool);
      if (kind) {
        return {
          mode: 'brush',
          center: brushCursor,
          radiusM: brushSizeM,
          thickness: tool === 'eraser' && eraserTarget !== 'terrain' ? 0 : brushThickness,
          kind,
        };
      }
    }
    if (isPathGuided && pathDrawMode === 'curve' && (polyDraft.length > 0 || polyCursor || curveControl)) {
      const startHeading =
        curveAnchorHeading ?? headingFromPolyline(polyDraft);
      let parallelGuide: Point[] = polyDraft;
      if (polyDraft.length > 0 && polyCursor) {
        const a = polyDraft[polyDraft.length - 1];
        if (!curveControl && startHeading != null) {
          const curve = curveFromTangent(a, startHeading, polyCursor);
          if (curve) parallelGuide = [...polyDraft, ...curve.points.slice(1)];
          else parallelGuide = guideFromDraft(polyDraft, polyCursor);
        } else if (curveControl) {
          const curve = curveFromThreePoints(a, curveControl, polyCursor);
          if (curve) parallelGuide = [...polyDraft, ...curve.points.slice(1)];
          else parallelGuide = guideFromDraft(polyDraft, polyCursor);
        } else {
          parallelGuide = guideFromDraft(polyDraft, polyCursor);
        }
      }
      return {
        mode: 'curve',
        points: polyDraft,
        control: curveAnchorHeading != null ? null : curveControl,
        cursor: polyCursor,
        startHeading,
        endHeading: null,
        adaptivePreview: false,
        guide: activeGuide,
        parallelPaths: parallelPreviewPaths(parallelGuide),
      };
    }
    if (isPathGuided && pathDrawMode === 'straight' && (polyDraft.length > 0 || polyCursor)) {
      const guide = guideFromDraft(polyDraft, polyCursor);
      return {
        mode: 'polyline',
        points: polyDraft,
        cursor: polyCursor,
        guide: activeGuide,
        parallelPaths: parallelPreviewPaths(guide),
      };
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

  const commitPathFeatures = useCallback(
    (incoming: MapFeature[]) => {
      if (incoming.length === 0) return;
      const base = project.features;

      // 平行批量：姐妹路互不挂接 / 互不续接，否则间距小于吸附半径时两端会被吸成同一点
      if (incoming.length > 1) {
        onProjectChange({
          ...project,
          features: [...base, ...incoming],
        });
        return;
      }

      let feats = base;
      for (const feature of incoming) {
        if (feature.kind === 'road' || feature.kind === 'railway') {
          const merged = tryMergeHeadToTail(feats, feature);
          if (merged) {
            feats = merged;
            continue;
          }
          feats = attachCrossGradeTips(feats, feature);
        } else {
          feats = [...feats, feature];
        }
      }
      onProjectChange({ ...project, features: feats });
    },
    [onProjectChange, project],
  );

  const addFeature = useCallback(
    (feature: MapFeature) => {
      commitPathFeatures([feature]);
    },
    [commitPathFeatures],
  );

  const resetDrafts = useCallback(() => {
    setPolyDraft([]);
    setPolyCursor(null);
    setCurveControl(null);
    setCurveAnchorHeading(null);
    setDraftStartGrade(null);
    setLastSnapKind('none');
    setActiveGuide(null);
    brushPainting.current = false;
    lastBrushPoint.current = null;
  }, []);

  const stampBrushPoints = useCallback(
    (points: Point[], cell: TerrainCell) => {
      if (points.length === 0) return;
      const current = projectRef.current;
      const terrain = cloneTerrain(ensureTerrain(current.settings, current.terrain));
      for (const p of points) {
        stampBrush(terrain, p, brushSizeM, brushThickness, cell);
      }
      const next = { ...current, terrain };
      projectRef.current = next;
      onProjectChange(next);
    },
    [brushSizeM, brushThickness, onProjectChange],
  );

  const eraseFeaturePoints = useCallback(
    (points: Point[], kind: FeatureKind) => {
      if (points.length === 0) return;
      const current = projectRef.current;
      const removeIds = new Set<string>();
      for (const p of points) {
        for (const f of findFeaturesInRadius(current.features, p, brushSizeM, kind)) {
          removeIds.add(f.id);
        }
      }
      if (removeIds.size === 0) return;
      let features = current.features.filter((f) => !removeIds.has(f.id));
      if (kind === 'road' || kind === 'railway') {
        features = reweaveAllCrossings(features);
      }
      const next = { ...current, features };
      projectRef.current = next;
      onProjectChange(next);
    },
    [brushSizeM, onProjectChange],
  );

  const applyBrushPoints = useCallback(
    (points: Point[]) => {
      if (tool === 'eraser') {
        const kind = eraserFeatureKind(eraserTarget);
        if (kind) eraseFeaturePoints(points, kind);
        else stampBrushPoints(points, TERRAIN_LAND);
        return;
      }
      const cell = brushCellForTool(tool);
      if (cell != null) stampBrushPoints(points, cell);
    },
    [tool, eraserTarget, eraseFeaturePoints, stampBrushPoints],
  );

  const stampBrushStroke = useCallback(
    (from: Point, to: Point) => {
      const spacing = Math.max(1, brushSizeM * 0.35);
      const d = dist(from, to);
      if (d < spacing) {
        applyBrushPoints([to]);
        return;
      }
      const steps = Math.ceil(d / spacing);
      const points: Point[] = [];
      for (let i = 1; i <= steps; i++) {
        points.push(lerpPoint(from, to, i / steps));
      }
      applyBrushPoints(points);
    },
    [brushSizeM, applyBrushPoints],
  );

  const resolvePathGrades = useCallback(
    (points: Point[]): { grade: FeatureGrade; gradeEnd?: FeatureGrade } => {
      const startTip = findPathTipAt(projectRef.current.features, points[0]);
      const startNear = findNearestAnyGradeAttachment(
        projectRef.current.features,
        points[0],
        RAMP_ATTACH_M,
      );
      const startG =
        draftStartGrade ??
        (startTip
          ? featureGrade(startTip.feature)
          : startNear
            ? startNear.grade
            : drawGrade);

      const endTip = findPathTipAt(
        projectRef.current.features,
        points[points.length - 1],
      );
      const endNear = findNearestAnyGradeAttachment(
        projectRef.current.features,
        points[points.length - 1],
        RAMP_ATTACH_M,
      );

      let endG = drawGrade;
      if (endTip) {
        endG = featureGrade(endTip.feature);
      } else if (endNear) {
        endG = endNear.grade;
      }

      if (endG !== startG) {
        return { grade: startG, gradeEnd: endG };
      }
      return { grade: startG };
    },
    [draftStartGrade, drawGrade],
  );

  const finishPolyline = useCallback(() => {
    const kind = toolKind(tool);
    if (!kind || polyDraft.length < 2) {
      resetDrafts();
      return;
    }

    const grades: { grade?: FeatureGrade; gradeEnd?: FeatureGrade } =
      kind === 'road' || kind === 'railway'
        ? resolvePathGrades(polyDraft)
        : {};

    const pathList =
      parallelEnabled && (kind === 'road' || kind === 'railway')
        ? buildParallelPaths(polyDraft, parallelSpacingM, parallelSide)
        : [polyDraft];

    commitPathFeatures(
      pathList.map((points) => ({
        id: createId(),
        kind,
        points,
        closed: false,
        roadLevel: kind === 'road' ? roadLevel : undefined,
        grade: grades.grade,
        gradeEnd: grades.gradeEnd,
      })),
    );
    resetDrafts();
  }, [
    commitPathFeatures,
    parallelEnabled,
    parallelSide,
    parallelSpacingM,
    polyDraft,
    resetDrafts,
    resolvePathGrades,
    roadLevel,
    tool,
  ]);

  const applyGuideSnap = useCallback(
    (pt: Point, extraTargets: Point[] = [], from?: Point | null): GuideSnap => {
      const soft = !altDown.current;
      if (!isPathGuided) {
        const targets = [...allEndpoints, ...extraTargets];
        return findPathGuideSnap(pt, targets, [], project.viewport.zoom, from, soft);
      }
      const targets = [...allEndpoints, ...extraTargets];
      return findPathGuideSnap(pt, targets, pathSegments, project.viewport.zoom, from, soft);
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

    const isEraser = activeTool === 'eraser';
    const brushCell = brushCellForTool(activeTool);
    if (brushCell != null || isEraser) {
      const current = projectRef.current;
      undoSnapshot.current = {
        ...current,
        terrain: cloneTerrain(ensureTerrain(current.settings, current.terrain)),
        features: current.features.slice(),
      };
      applyBrushPoints([world]);
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
          if (prev.length === 0) {
            const hit = applyGuideSnap(world, [], null);
            const tip = findPathTipAt(projectRef.current.features, hit.point);
            if (tip) {
              const g = featureGrade(tip.feature);
              setDraftStartGrade(g);
              onDrawGradeChange(g);
            } else {
              setDraftStartGrade(drawGrade);
            }
            return [hit.point];
          }
          const last = prev[prev.length - 1];
          const snapped = snapPoint(world, prev, last);
          const next = shiftDown.current ? snapped : snapAnglePoint(last, snapped, 90);
          const endTip = findPathTipAt(projectRef.current.features, next);
          if (endTip) onDrawGradeChange(featureGrade(endTip.feature));
          return [...prev, next];
        });
        return;
      }

      if (isPathGuided && pathDrawMode === 'curve') {
        // 有锚点切线（端点 / 中心线 / 续弯）：A 已定，再点终点即可定半径劣弧
        // 无切线：自由三点 A → B → C（B 选侧，劣弧）
        if (polyDraft.length === 0) {
          const hit = applyGuideSnap(world, [], null);
          setLastSnapKind(hit.kind);
          let anchor: number | null = null;
          if (hit.kind === 'endpoint') {
            anchor = headingAtPoint(hit.point, pathSegments, project.viewport.zoom);
          } else if (hit.kind === 'centerline') {
            anchor =
              (hit.ref
                ? Math.atan2(hit.ref.b.y - hit.ref.a.y, hit.ref.b.x - hit.ref.a.x)
                : null) ??
              headingAlongSegment(hit.point, pathSegments, project.viewport.zoom);
          }
          const tip = findPathTipAt(projectRef.current.features, hit.point);
          if (tip) {
            const g = featureGrade(tip.feature);
            setDraftStartGrade(g);
            onDrawGradeChange(g);
          } else {
            const under = findFeatureAt(
              projectRef.current.features,
              hit.point,
              project.viewport.zoom,
            );
            if (under && (under.kind === 'road' || under.kind === 'railway')) {
              const g = featureGrade(under);
              setDraftStartGrade(g);
              onDrawGradeChange(g);
            } else {
              setDraftStartGrade(drawGrade);
            }
          }
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

        // 切线锚点模式：点终点即可（定半径劣弧）
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
            // 终点吸附到异层端点时，同步绘制层为终点层（形成匝道）
            const endTip = findPathTipAt(projectRef.current.features, c);
            if (endTip) {
              onDrawGradeChange(featureGrade(endTip.feature));
            }
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

        const curve = curveFromThreePoints(a, b, c);

        if (curve && curve.points.length >= 2) {
          setPolyDraft([...polyDraft, ...curve.points.slice(1)]);
          setCurveControl(null);
          setCurveAnchorHeading(curve.endHeading);
          setActiveGuide(null);
          const endTip = findPathTipAt(projectRef.current.features, c);
          if (endTip) {
            onDrawGradeChange(featureGrade(endTip.feature));
          }
        }
        return;
      }

      setPolyDraft((prev) => [...prev, pt]);
    }
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    const wrap = containerRef.current;
    if (wrap) {
      const rect = wrap.getBoundingClientRect();
      setPointerScreen({ x: e.clientX - rect.left, y: e.clientY - rect.top });
    }

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
      const last = lastBrushPoint.current;
      const spacing = Math.max(1, brushSizeM * 0.35);
      if (!last || dist(last, world) >= spacing) {
        if (last) stampBrushStroke(last, world);
        else applyBrushPoints([world]);
        lastBrushPoint.current = world;
      }
      setBrushCursor(world);
      return;
    }

    if (isBrushTool) {
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
      if (e.key === 'Alt') {
        e.preventDefault();
        altDown.current = true;
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
      if (e.key === 'Alt') {
        altDown.current = false;
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
    if (tool === 'eraser') {
      return `橡皮 · 只擦「${eraserTargetLabel(eraserTarget)}」· 调大小${
        eraserTarget === 'terrain' ? '/厚度' : ''
      } · 右键撤销本笔`;
    }
    if (tool === 'label') return '点击地图放置标注 · 空格临时拖图';
    if (isBrushTool) {
      return '按住拖拽绘制地貌 · 调节大小/厚度 · 右键撤销本笔 · 空格拖图';
    }
    if (isPathGuided) {
      const startLabel =
        draftStartGrade != null ? formatGrade(draftStartGrade) : formatGrade(drawGrade);
      const endLabel = formatGrade(drawGrade);
      const gradeHint =
        draftStartGrade != null && draftStartGrade !== drawGrade
          ? `匝道 ${startLabel} → ${endLabel} · -/= 换终点层`
          : `标高 ${endLabel} · -/= 换层`;
      const parallelHint = parallelEnabled
        ? ` · 平行 ${parallelSpacingM} m（${parallelSide === 'both' ? '双侧' : parallelSide === 'left' ? '左' : '右'}）`
        : '';
      if (pathDrawMode === 'straight') {
        return `直线默认水平/垂直 · Shift 自由角度 · Alt 关软吸附 · 双击完成${parallelHint} · ${gradeHint}`;
      }
      if (!polyDraft.length) {
        return `弯道：点起点（端点/中心线锁切线）${parallelHint} · ${gradeHint}`;
      }
      if (curveAnchorHeading != null || headingFromPolyline(polyDraft) != null) {
        return `弯道：切线已锁 · 点终点定半径劣弧 · 双击完成${parallelHint} · ${gradeHint}`;
      }
      if (!curveControl) {
        return `弯道：自由三点 · 点 B 选鼓包侧${parallelHint} · ${gradeHint}`;
      }
      return `弯道：点终点 C（劣弧）· 双击完成${parallelHint} · ${gradeHint}`;
    }
    if (POLYLINE_TOOLS.includes(tool)) {
      return '点击加点 · 双击完成 · 右键打断 · 空格拖图';
    }
    return '选择工具开始绘制';
  })();

  const canvasCursor =
    tool === 'pan' ? (isPanning ? 'grabbing' : 'grab') : tool === 'select' ? 'default' : 'crosshair';

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
    const gradeLine =
      draftStartGrade != null && draftStartGrade !== drawGrade
        ? `标高 ${formatGrade(draftStartGrade)} → ${formatGrade(drawGrade)}`
        : `标高 ${formatGrade(drawGrade)}`;

    if (isPathGuided && pathDrawMode === 'straight' && polyDraft.length > 0 && polyCursor) {
      const m = lineMetrics(polyDraft[polyDraft.length - 1], polyCursor);
      const angleLock = shiftSnap ? ' · 自由角度' : ' · 正交';
      return {
        lines: [
          formatLength(m.lengthM),
          `方位 ${formatAngle(m.angleDeg)}${tagText}${angleLock}`,
          gradeLine,
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
                formatLength(m.lengthM),
                `切线 · 直线${tagText}`,
                gradeLine,
              ],
            };
          }
          const len = Math.abs(curve.sweepDeg) * (Math.PI / 180) * curve.radius;
          return {
            lines: [
              formatLength(len),
              formatRadius(curve.radius),
              `圆心角 ${formatAngle(curve.sweepDeg)}${tagText}`,
              gradeLine,
            ],
          };
        }
      }

      if (!curveControl) {
        const m = lineMetrics(a, polyCursor);
        return {
          lines: [
            `B ${formatLength(m.lengthM)}`,
            `方位 ${formatAngle(m.angleDeg)}${tagText}${shiftHint}`,
            gradeLine,
          ],
        };
      }

      const curve = curveFromThreePoints(a, curveControl, polyCursor);
      if (curve) {
        if (!Number.isFinite(curve.radius)) {
          const m = lineMetrics(a, polyCursor);
          return { lines: [formatLength(m.lengthM), gradeLine] };
        }
        const len = Math.abs(curve.sweepDeg) * (Math.PI / 180) * curve.radius;
        return {
          lines: [
            formatLength(len),
            formatRadius(curve.radius),
            `圆心角 ${formatAngle(curve.sweepDeg)}${tagText}`,
            gradeLine,
          ],
        };
      }
    }

    if (isPathGuided && pathDrawMode === 'curve' && polyDraft.length === 0 && polyCursor) {
      return {
        lines: [tag ? `吸附 ${tag}` : '选择起点', '端点/中心线=切线锁'],
      };
    }

    return null;
  })();

  const metricsStyle =
    pointerScreen != null
      ? {
          left: Math.min(pointerScreen.x + 18, (containerRef.current?.clientWidth ?? 400) - 160),
          top: Math.min(pointerScreen.y + 18, (containerRef.current?.clientHeight ?? 400) - 120),
          bottom: 'auto' as const,
          right: 'auto' as const,
          transform: 'none' as const,
        }
      : undefined;

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
        <div className="canvas-metrics canvas-metrics-hud" style={metricsStyle}>
          {metrics.lines.map((line) => (
            <div key={line}>{line}</div>
          ))}
        </div>
      )}
      <FloatingDock
        tool={tool}
        roadLevel={roadLevel}
        drawGrade={drawGrade}
        pathDrawMode={pathDrawMode}
        parallelEnabled={parallelEnabled}
        parallelSpacingM={parallelSpacingM}
        parallelSide={parallelSide}
        eraserTarget={eraserTarget}
        canUndo={canUndo}
        onToolChange={onToolChange}
        onRoadLevelChange={onRoadLevelChange}
        onDrawGradeChange={onDrawGradeChange}
        onPathDrawModeChange={onPathDrawModeChange}
        onParallelEnabledChange={onParallelEnabledChange}
        onParallelSpacingChange={onParallelSpacingChange}
        onParallelSideChange={onParallelSideChange}
        onEraserTargetChange={onEraserTargetChange}
        onUndo={onUndo}
      />
    </div>
  );
}
