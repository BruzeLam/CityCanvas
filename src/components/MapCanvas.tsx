import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CityProject,
  FeatureGrade,
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
  clampGrade,
  clampToMap,
  createId,
  featureGrade,
  formatGrade,
  rectFromCorners,
} from '../types';
import {
  formatAngle,
  formatLength,
  formatRadius,
  lineMetrics,
  curveFromThreePoints,
  curveAdaptiveViaControl,
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
import { dist, polygonArea, prepareFreehandPath } from '../engine/pathUtils';
import { findFeatureAt, findVertexIndex } from '../engine/hitTest';
import { fitViewport, renderMap, type PreviewGuide, type PreviewState } from '../engine/renderer';

type Props = {
  project: CityProject;
  tool: Tool;
  roadLevel: RoadLevel;
  drawGrade: FeatureGrade;
  landformDrawMode: LandformDrawMode;
  pathDrawMode: PathDrawMode;
  selectedFeatureId: string | null;
  onSelectFeature: (id: string | null) => void;
  onDrawGradeChange: (grade: FeatureGrade) => void;
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
  drawGrade,
  landformDrawMode,
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
  /** 三点弯中间点 B */
  const [curveControl, setCurveControl] = useState<Point | null>(null);
  const [lastSnapKind, setLastSnapKind] = useState<SnapKind>('none');
  const [activeGuide, setActiveGuide] = useState<PreviewGuide | null>(null);
  const [regionDraft, setRegionDraft] = useState<Point[]>([]);
  const [regionCursor, setRegionCursor] = useState<Point | null>(null);
  const [rectStart, setRectStart] = useState<Point | null>(null);
  const [rectEnd, setRectEnd] = useState<Point | null>(null);
  const [shiftSnap, setShiftSnap] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
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
  const pathSegments = project.features
    .filter((f) => f.kind === 'road' || f.kind === 'railway')
    .flatMap((f) => {
      const segs: { a: Point; b: Point }[] = [];
      for (let i = 1; i < f.points.length; i++) {
        segs.push({ a: f.points[i - 1], b: f.points[i] });
      }
      return segs;
    });
  const isLandform = LANDFORM_TOOLS.includes(tool);
  const isPathGuided = PATH_GUIDED_TOOLS.includes(tool);

  useEffect(() => {
    projectRef.current = project;
  }, [project]);

  useEffect(() => {
    setPolyDraft([]);
    setPolyCursor(null);
    setCurveControl(null);
    setLastSnapKind('none');
    setActiveGuide(null);
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
    if (isPathGuided && pathDrawMode === 'curve' && (polyDraft.length > 0 || polyCursor || curveControl)) {
      const startHeading = headingFromPolyline(polyDraft);
      const endHeading =
        polyCursor && lastSnapKind === 'endpoint'
          ? headingAtPoint(polyCursor, pathSegments, project.viewport.zoom)
          : null;
      return {
        mode: 'curve',
        points: polyDraft,
        control: curveControl,
        cursor: polyCursor,
        startHeading,
        endHeading,
        adaptivePreview: lastSnapKind === 'endpoint' && curveControl != null,
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
    setLastSnapKind('none');
    setActiveGuide(null);
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
    // 右键：打断当前绘制（禁用浏览器菜单）
    if (e.button === 2) {
      e.preventDefault();
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
      const from = polyDraft.length > 0 ? polyDraft[polyDraft.length - 1] : null;
      const pt = snapPoint(world, [], from);

      if (isPathGuided && pathDrawMode === 'straight') {
        setPolyDraft((prev) => {
          if (prev.length === 0) return [pt];
          const last = prev[prev.length - 1];
          const snapped = snapPoint(world, prev, last);
          const next = shiftDown.current ? snapAnglePoint(last, snapped) : snapped;
          return [...prev, next];
        });
        return;
      }

      if (isPathGuided && pathDrawMode === 'curve') {
        // 三点弯：A → B → C；完成后继续下一段从 C 再点 B
        if (polyDraft.length === 0) {
          setPolyDraft([pt]);
          setCurveControl(null);
          return;
        }

        if (!curveControl) {
          const a = polyDraft[polyDraft.length - 1];
          const hit = applyGuideSnap(world, polyDraft, a);
          setLastSnapKind(hit.kind);
          const next = shiftDown.current ? snapAnglePoint(a, hit.point) : hit.point;
          if (dist(a, next) < 4) return;
          setCurveControl(next);
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

        const a = polyDraft[polyDraft.length - 1];
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

    if (rectStart) {
      setRectEnd(world);
      return;
    }

    if (freehandDrawing.current) {
      const last = freehandPoints.current[freehandPoints.current.length - 1];
      if (!last || dist(last, world) >= MIN_FREEHAND_SAMPLE_M) {
        freehandPoints.current = [...freehandPoints.current, world];
        if (isLandform) setRegionDraft(freehandPoints.current);
        else setPolyDraft(freehandPoints.current);
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
        const base = snapPoint(world, polyDraft, last);
        setPolyCursor(shiftDown.current ? snapAnglePoint(last, base) : base);
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

    if (freehandDrawing.current) {
      freehandDrawing.current = false;
      const points = freehandPoints.current;
      freehandPoints.current = [];
      if (isLandform) {
        if (points.length >= 3) commitRegion(points);
        else resetDrafts();
      } else {
        resetDrafts();
      }
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
    const isTypingTarget = (el: EventTarget | null) => {
      if (!(el instanceof HTMLElement)) return false;
      const tag = el.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
    };

    const onKeyDown = (e: KeyboardEvent) => {
      // 顶栏改名等输入框：不要拦截退格 / 空格 / 字母
      if (isTypingTarget(e.target)) return;

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
      // Mac：加减号所在键（- / =）换标高
      if (e.key === '-' || e.key === '_') {
        e.preventDefault();
        nudgeGrade(-1);
      }
      if (e.key === '=' || e.key === '+') {
        e.preventDefault();
        nudgeGrade(1);
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
        } else if (curveControl) {
          setCurveControl(null);
        } else if (polyDraft.length > 0) {
          setPolyDraft((prev) => prev.slice(0, -1));
          setCurveControl(null);
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
    finishPolyline,
    finishPolygon,
    isLandform,
    landformDrawMode,
    nudgeGrade,
    polyDraft,
    regionDraft.length,
    resetDrafts,
    onSelectFeature,
    removeFeature,
    selectedFeatureId,
    tool,
  ]);

  const hint = (() => {
    if (tool === 'pan') return '拖动模式 · 左键拖地图 · 滚轮缩放 · 切到「编辑」可改顶点';
    if (tool === 'select') {
      return '编辑模式 · 点击选中 · 拖顶点 · -/= 换标高 · Delete 删除 · 右键取消';
    }
    if (tool === 'eraser') return '点击要素即可删除 · 空格临时拖图';
    if (tool === 'label') return '点击地图放置标注 · 空格临时拖图';
    if (isPathGuided) {
      const gradeHint = `标高 ${formatGrade(drawGrade)} · -/= 换层`;
      if (pathDrawMode === 'straight') {
        return `点击加点 · 中心线/垂直/平行吸附 · 双击完成 · Shift 角度 · ${gradeHint}`;
      }
      if (!polyDraft.length) {
        return `弯道：点起点 A（可吸中心线开岔）· ${gradeHint}`;
      }
      if (!curveControl) {
        return `弯道：点中间点 B · Backspace 撤销 · ${gradeHint}`;
      }
      return `弯道：点终点 C（定半径；接已有节点则变半径）· ${gradeHint}`;
    }
    if (isLandform) {
      if (landformDrawMode === 'freehand') {
        return '按住拖拽绘制轮廓 · 松开闭合 · 右键打断 · 空格拖图';
      }
      if (landformDrawMode === 'polygon') {
        return '点击加点 · 双击/Enter 闭合 · 右键打断 · 空格拖图';
      }
      return '拖拽框选矩形 · 松开完成 · 右键打断 · 空格拖图';
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
      return {
        lines: [
          `长度 ${formatLength(m.lengthM)}`,
          `方位 ${formatAngle(m.angleDeg)}${tagText}${shiftHint}`,
        ],
      };
    }

    if (isPathGuided && pathDrawMode === 'curve' && polyDraft.length > 0 && polyCursor) {
      const a = polyDraft[polyDraft.length - 1];
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

    if (isPathGuided && pathDrawMode === 'curve' && polyDraft.length === 0 && polyCursor && tag) {
      return { lines: [`吸附 ${tag}`] };
    }

    return null;
  })();

  return (
    <div className="canvas-wrap" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className="map-canvas"
        style={{ cursor: canvasCursor }}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onContextMenu={handleContextMenu}
        onDoubleClick={() => {
          if (isLandform && landformDrawMode === 'polygon') finishPolygon();
          else if (POLYLINE_TOOLS.includes(tool)) finishPolyline();
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
