import { useEffect, useRef } from 'react';
import type { PointerEvent, RefObject } from 'react';
import type { ControlledFailureSettings, FourierPath, Point, ViewMode } from '../types';
import { calculateEpicycles, drawEpicycles } from '../utils/epicycle';
import { distortFourierComponents } from '../utils/distortion';

type DrawingCanvasProps = {
  paths: FourierPath[];
  selectedPathId: string | null;
  draftPoints: Point[];
  playbackT: number;
  isDrawing: boolean;
  viewMode: ViewMode;
  showEpicycles: boolean;
  showOriginal: boolean;
  frequencyCount: number;
  phaseDistortion: number;
  amplitudeDistortion: number;
  curveColor: string;
  controlledFailure: ControlledFailureSettings;
  canvasRef: RefObject<HTMLCanvasElement>;
  onDrawingStart: (point: Point) => void;
  onDrawingMove: (point: Point) => void;
  onDrawingEnd: () => void;
  onPathSelect: (pathId: string) => void;
};

type CanvasMetrics = {
  width: number;
  height: number;
  scale: number;
};

type SceneSnapshot = Omit<
  DrawingCanvasProps,
  'canvasRef' | 'onDrawingStart' | 'onDrawingMove' | 'onDrawingEnd' | 'onPathSelect'
>;

function getCanvasPoint(canvas: HTMLCanvasElement, event: PointerEvent<HTMLCanvasElement>): Point {
  const rect = canvas.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function syncCanvasSize(
  canvas: HTMLCanvasElement,
): { context: CanvasRenderingContext2D; metrics: CanvasMetrics } | null {
  const context = canvas.getContext('2d');

  if (!context) {
    return null;
  }

  const rect = canvas.getBoundingClientRect();
  const devicePixelRatio = window.devicePixelRatio || 1;
  const width = Math.max(1, Math.floor(rect.width * devicePixelRatio));
  const height = Math.max(1, Math.floor(rect.height * devicePixelRatio));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
  context.clearRect(0, 0, rect.width, rect.height);

  return {
    context,
    metrics: {
      width: rect.width,
      height: rect.height,
      scale: Math.max(1, Math.min(rect.width, rect.height) * 0.38),
    },
  };
}

function getCanvasMetrics(canvas: HTMLCanvasElement): CanvasMetrics {
  const rect = canvas.getBoundingClientRect();

  return {
    width: rect.width,
    height: rect.height,
    scale: Math.max(1, Math.min(rect.width, rect.height) * 0.38),
  };
}

function toCanvasPoint(point: Point, isNormalized: boolean, metrics: CanvasMetrics): Point {
  if (!isNormalized) {
    return point;
  }

  return {
    x: metrics.width / 2 + point.x * metrics.scale,
    y: metrics.height / 2 + point.y * metrics.scale,
  };
}

function hexToRgba(hexColor: string, alpha: number): string {
  const normalizedHex = hexColor.replace('#', '');

  if (!/^[\da-f]{6}$/i.test(normalizedHex)) {
    return `rgba(133, 255, 216, ${alpha})`;
  }

  const red = Number.parseInt(normalizedHex.slice(0, 2), 16);
  const green = Number.parseInt(normalizedHex.slice(2, 4), 16);
  const blue = Number.parseInt(normalizedHex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function getComplementColor(hexColor: string): string {
  const normalizedHex = hexColor.replace('#', '');

  if (!/^[\da-f]{6}$/i.test(normalizedHex)) {
    return '#ff85ac';
  }

  const red = 255 - Number.parseInt(normalizedHex.slice(0, 2), 16);
  const green = 255 - Number.parseInt(normalizedHex.slice(2, 4), 16);
  const blue = 255 - Number.parseInt(normalizedHex.slice(4, 6), 16);

  return `#${[red, green, blue].map((value) => value.toString(16).padStart(2, '0')).join('')}`;
}

function getEpicycleTime(playbackT: number, sampleCount: number, isClosed: boolean): number {
  if (isClosed || sampleCount <= 1) {
    return playbackT;
  }

  return playbackT * ((sampleCount - 1) / sampleCount);
}

function getPathFrequencyCount(path: FourierPath, globalFrequencyCount: number): number {
  return Math.min(path.frequencyCountOverride ?? globalFrequencyCount, path.fourierComponents.length);
}

function strokePath(
  context: CanvasRenderingContext2D,
  metrics: CanvasMetrics,
  points: Point[],
  options: {
    isNormalized: boolean;
    strokeStyle: string;
    lineWidth: number;
    shadowColor: string;
    shadowBlur: number;
    closePath?: boolean;
  },
) {
  if (points.length === 0) {
    return;
  }

  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.lineWidth = options.lineWidth;
  context.strokeStyle = options.strokeStyle;
  context.shadowColor = options.shadowColor;
  context.shadowBlur = options.shadowBlur;

  const firstPoint = toCanvasPoint(points[0], options.isNormalized, metrics);
  context.beginPath();
  context.moveTo(firstPoint.x, firstPoint.y);

  for (let index = 1; index < points.length; index += 1) {
    const canvasPoint = toCanvasPoint(points[index], options.isNormalized, metrics);
    context.lineTo(canvasPoint.x, canvasPoint.y);
  }

  if (options.closePath) {
    context.closePath();
  }

  context.stroke();

  if (points.length === 1) {
    context.fillStyle = options.strokeStyle;
    context.beginPath();
    context.arc(firstPoint.x, firstPoint.y, 2.5, 0, Math.PI * 2);
    context.fill();
  }
}

function drawEndpointMarkers(
  context: CanvasRenderingContext2D,
  metrics: CanvasMetrics,
  points: Point[],
  isNormalized: boolean,
  curveColor: string,
) {
  if (points.length < 2) {
    return;
  }

  const startPoint = toCanvasPoint(points[0], isNormalized, metrics);
  const endPoint = toCanvasPoint(points[points.length - 1], isNormalized, metrics);

  context.save();

  context.shadowBlur = 8;
  context.shadowColor = hexToRgba(curveColor, 0.45);
  context.fillStyle = curveColor;
  context.beginPath();
  context.arc(startPoint.x, startPoint.y, 3.8, 0, Math.PI * 2);
  context.fill();

  context.shadowColor = 'rgba(255, 119, 119, 0.45)';
  context.fillStyle = '#ff7777';
  context.beginPath();
  context.arc(endPoint.x, endPoint.y, 3.8, 0, Math.PI * 2);
  context.fill();

  context.restore();
}

function drawErrorViewPlaceholder(context: CanvasRenderingContext2D, metrics: CanvasMetrics) {
  context.save();
  context.fillStyle = 'rgba(243, 246, 255, 0.58)';
  context.font = '600 14px Inter, ui-sans-serif, system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('Error View placeholder', metrics.width / 2, metrics.height / 2);
  context.restore();
}

function drawScene(
  canvas: HTMLCanvasElement,
  paths: FourierPath[],
  selectedPathId: string | null,
  draftPoints: Point[],
  playbackT: number,
  isDrawing: boolean,
  viewMode: ViewMode,
  showEpicycles: boolean,
  showOriginal: boolean,
  frequencyCount: number,
  phaseDistortion: number,
  amplitudeDistortion: number,
  curveColor: string,
  controlledFailure: ControlledFailureSettings,
) {
  const canvasState = syncCanvasSize(canvas);

  if (!canvasState) {
    return;
  }

  const { context, metrics } = canvasState;
  const selectedPath = paths.find((path) => path.id === selectedPathId) ?? null;
  const activeColor = getComplementColor(curveColor);

  if (isDrawing) {
    strokePath(context, metrics, draftPoints, {
      isNormalized: false,
      strokeStyle: curveColor,
      lineWidth: 2.4,
      shadowColor: hexToRgba(curveColor, 0.52),
      shadowBlur: 12,
      closePath: false,
    });
    drawEndpointMarkers(context, metrics, draftPoints, false, curveColor);
    return;
  }

  if (viewMode === 'errorView') {
    drawErrorViewPlaceholder(context, metrics);
    return;
  }

  paths.forEach((path) => {
    const isSelected = path.id === selectedPath?.id;
    const pathColor = isSelected && paths.length > 1 ? activeColor : curveColor;
    const visiblePoints = showOriginal ? path.originalPoints : path.reconstructedPath;

    if (showOriginal) {
      strokePath(context, metrics, path.originalPoints, {
        isNormalized: true,
        strokeStyle: isSelected ? hexToRgba(activeColor, 0.42) : 'rgba(243, 246, 255, 0.2)',
        lineWidth: isSelected ? 2.1 : 1.4,
        shadowColor: 'transparent',
        shadowBlur: 0,
        closePath: path.isClosed,
      });
    }

    strokePath(context, metrics, path.reconstructedPath, {
      isNormalized: true,
      strokeStyle: pathColor,
      lineWidth: isSelected && paths.length > 1 ? 4.2 : showOriginal ? 3.2 : 2.9,
      shadowColor: hexToRgba(pathColor, isSelected ? 0.78 : 0.5),
      shadowBlur: isSelected ? 20 : 12,
      closePath: path.isClosed,
    });

    if (isSelected) {
      drawEndpointMarkers(context, metrics, visiblePoints, true, pathColor);
    }
  });

  if (showEpicycles && selectedPath && selectedPath.fourierComponents.length > 0) {
    const epicycleTime = getEpicycleTime(
      playbackT,
      selectedPath.fourierComponents.length,
      selectedPath.isClosed,
    );
    const distortedComponents = distortFourierComponents(
      selectedPath.fourierComponents,
      controlledFailure,
      epicycleTime,
    );
    const epicycles = calculateEpicycles(
      distortedComponents,
      epicycleTime,
      {
        componentCount: getPathFrequencyCount(selectedPath, frequencyCount),
        phaseDistortion,
        amplitudeDistortion,
      },
    );

    drawEpicycles(context, epicycles, (point) => toCanvasPoint(point, true, metrics));
  }
}

function getPointToSegmentDistance(point: Point, segmentStart: Point, segmentEnd: Point): number {
  const dx = segmentEnd.x - segmentStart.x;
  const dy = segmentEnd.y - segmentStart.y;
  const lengthSquared = dx * dx + dy * dy;

  if (lengthSquared === 0) {
    return Math.hypot(point.x - segmentStart.x, point.y - segmentStart.y);
  }

  const ratio = Math.max(
    0,
    Math.min(1, ((point.x - segmentStart.x) * dx + (point.y - segmentStart.y) * dy) / lengthSquared),
  );
  const projectedPoint = {
    x: segmentStart.x + ratio * dx,
    y: segmentStart.y + ratio * dy,
  };

  return Math.hypot(point.x - projectedPoint.x, point.y - projectedPoint.y);
}

function findPathAtPoint(
  point: Point,
  paths: FourierPath[],
  canvas: HTMLCanvasElement,
): string | null {
  const metrics = getCanvasMetrics(canvas);
  let closestPathId: string | null = null;
  let closestDistance = 14;

  paths.forEach((path) => {
    const points = path.reconstructedPath.length > 1 ? path.reconstructedPath : path.originalPoints;

    for (let index = 1; index < points.length; index += 1) {
      const distance = getPointToSegmentDistance(
        point,
        toCanvasPoint(points[index - 1], true, metrics),
        toCanvasPoint(points[index], true, metrics),
      );

      if (distance < closestDistance) {
        closestPathId = path.id;
        closestDistance = distance;
      }
    }
  });

  return closestPathId;
}

export function DrawingCanvas({
  paths,
  selectedPathId,
  draftPoints,
  playbackT,
  isDrawing,
  viewMode,
  showEpicycles,
  showOriginal,
  frequencyCount,
  phaseDistortion,
  amplitudeDistortion,
  curveColor,
  controlledFailure,
  canvasRef,
  onDrawingStart,
  onDrawingMove,
  onDrawingEnd,
  onPathSelect,
}: DrawingCanvasProps) {
  const activePointerIdRef = useRef<number | null>(null);
  const didSelectPathRef = useRef(false);
  const sceneSnapshotRef = useRef<SceneSnapshot>({
    paths,
    selectedPathId,
    draftPoints,
    playbackT,
    isDrawing,
    viewMode,
    showEpicycles,
    showOriginal,
    frequencyCount,
    phaseDistortion,
    amplitudeDistortion,
    curveColor,
    controlledFailure,
  });

  sceneSnapshotRef.current = {
    paths,
    selectedPathId,
    draftPoints,
    playbackT,
    isDrawing,
    viewMode,
    showEpicycles,
    showOriginal,
    frequencyCount,
    phaseDistortion,
    amplitudeDistortion,
    curveColor,
    controlledFailure,
  };

  const drawLatestScene = () => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const scene = sceneSnapshotRef.current;

    drawScene(
      canvas,
      scene.paths,
      scene.selectedPathId,
      scene.draftPoints,
      scene.playbackT,
      scene.isDrawing,
      scene.viewMode,
      scene.showEpicycles,
      scene.showOriginal,
      scene.frequencyCount,
      scene.phaseDistortion,
      scene.amplitudeDistortion,
      scene.curveColor,
      scene.controlledFailure,
    );
  };

  useEffect(() => {
    drawLatestScene();
  }, [
    amplitudeDistortion,
    controlledFailure,
    curveColor,
    draftPoints,
    frequencyCount,
    isDrawing,
    paths,
    phaseDistortion,
    playbackT,
    selectedPathId,
    showEpicycles,
    showOriginal,
    viewMode,
  ]);

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    const handleResize = () => {
      drawLatestScene();
    };

    const resizeObserver =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            handleResize();
          });

    resizeObserver?.observe(canvas);
    window.addEventListener('resize', handleResize);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, []);

  const handlePointerDown = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!event.isPrimary) {
      return;
    }

    event.preventDefault();
    activePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);

    if (paths.length > 0 && !isDrawing) {
      const selectedPath = findPathAtPoint(getCanvasPoint(event.currentTarget, event), paths, event.currentTarget);

      if (selectedPath) {
        didSelectPathRef.current = true;
        onPathSelect(selectedPath);
        return;
      }
    }

    didSelectPathRef.current = false;
    onDrawingStart(getCanvasPoint(event.currentTarget, event));
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || activePointerIdRef.current !== event.pointerId || didSelectPathRef.current) {
      return;
    }

    event.preventDefault();
    onDrawingMove(getCanvasPoint(event.currentTarget, event));
  };

  const handlePointerEnd = (event: PointerEvent<HTMLCanvasElement>) => {
    if (activePointerIdRef.current !== event.pointerId) {
      return;
    }

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    activePointerIdRef.current = null;

    if (isDrawing && !didSelectPathRef.current) {
      onDrawingEnd();
    }

    didSelectPathRef.current = false;
  };

  return (
    <section className="canvas-workspace" aria-label="Drawing canvas area">
      <div className="canvas-stage">
        <canvas
          ref={canvasRef}
          className="drawing-canvas"
          aria-label="Drawing canvas"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerEnd}
          onPointerCancel={handlePointerEnd}
        />
        <div className="canvas-grid" aria-hidden="true" />
        <div
          className="canvas-empty-state"
          hidden={viewMode === 'errorView' || draftPoints.length > 0 || paths.length > 0}
        >
          <p>Draw on the canvas with a mouse, pen, or touch.</p>
        </div>
      </div>
    </section>
  );
}
