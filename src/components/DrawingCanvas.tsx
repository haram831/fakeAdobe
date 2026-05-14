import { useEffect, useRef } from 'react';
import type { PointerEvent, RefObject } from 'react';
import type { ControlledFailureSettings, FourierComponent, Point, ViewMode } from '../types';
import { calculateEpicycles, drawEpicycles } from '../utils/epicycle';
import { distortFourierComponents } from '../utils/distortion';

type DrawingCanvasProps = {
  points: Point[];
  originalPoints: Point[];
  reconstructedPath: Point[];
  errorPath: Point[];
  isClosed: boolean;
  fourierComponents: FourierComponent[];
  playbackT: number;
  isDrawing: boolean;
  viewMode: ViewMode;
  showEpicycles: boolean;
  showOriginal: boolean;
  frequencyCount: number;
  phaseDistortion: number;
  amplitudeDistortion: number;
  controlledFailure: ControlledFailureSettings;
  canvasRef: RefObject<HTMLCanvasElement>;
  onDrawingStart: (point: Point) => void;
  onDrawingMove: (point: Point) => void;
  onDrawingEnd: () => void;
};

type CanvasMetrics = {
  width: number;
  height: number;
  scale: number;
};

type SceneSnapshot = Omit<
  DrawingCanvasProps,
  'canvasRef' | 'onDrawingStart' | 'onDrawingMove' | 'onDrawingEnd'
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

function toCanvasPoint(point: Point, isNormalized: boolean, metrics: CanvasMetrics): Point {
  if (!isNormalized) {
    return point;
  }

  return {
    x: metrics.width / 2 + point.x * metrics.scale,
    y: metrics.height / 2 + point.y * metrics.scale,
  };
}

function getEpicycleTime(playbackT: number, sampleCount: number, isClosed: boolean): number {
  if (isClosed || sampleCount <= 1) {
    return playbackT;
  }

  return playbackT * ((sampleCount - 1) / sampleCount);
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
) {
  if (points.length < 2) {
    return;
  }

  const startPoint = toCanvasPoint(points[0], isNormalized, metrics);
  const endPoint = toCanvasPoint(points[points.length - 1], isNormalized, metrics);

  context.save();

  context.shadowBlur = 8;
  context.shadowColor = 'rgba(133, 255, 216, 0.45)';
  context.fillStyle = '#85ffd8';
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
  points: Point[],
  originalPoints: Point[],
  reconstructedPath: Point[],
  errorPath: Point[],
  isClosed: boolean,
  fourierComponents: FourierComponent[],
  playbackT: number,
  isDrawing: boolean,
  viewMode: ViewMode,
  showEpicycles: boolean,
  showOriginal: boolean,
  frequencyCount: number,
  phaseDistortion: number,
  amplitudeDistortion: number,
  controlledFailure: ControlledFailureSettings,
) {
  const canvasState = syncCanvasSize(canvas);

  if (!canvasState) {
    return;
  }

  const { context, metrics } = canvasState;

  if (isDrawing) {
    strokePath(context, metrics, points, {
      isNormalized: false,
      strokeStyle: '#85ffd8',
      lineWidth: 2.4,
      shadowColor: 'rgba(133, 255, 216, 0.52)',
      shadowBlur: 12,
      closePath: false,
    });
    drawEndpointMarkers(context, metrics, points, false);
    return;
  }

  if (viewMode === 'errorView') {
    drawErrorViewPlaceholder(context, metrics);
    return;
  }

  if (showOriginal) {
    strokePath(context, metrics, originalPoints, {
      isNormalized: true,
      strokeStyle: 'rgba(243, 246, 255, 0.24)',
      lineWidth: 1.6,
      shadowColor: 'transparent',
      shadowBlur: 0,
      closePath: isClosed,
    });
  }

  if (showEpicycles && fourierComponents.length > 0) {
    const epicycleTime = getEpicycleTime(playbackT, fourierComponents.length, isClosed);
    const distortedComponents = distortFourierComponents(
      fourierComponents,
      controlledFailure,
      epicycleTime,
    );
    const epicycles = calculateEpicycles(
      distortedComponents,
      epicycleTime,
      {
        componentCount: frequencyCount,
        phaseDistortion,
        amplitudeDistortion,
      },
    );

    drawEpicycles(context, epicycles, (point) => toCanvasPoint(point, true, metrics));
  }

  strokePath(context, metrics, reconstructedPath, {
    isNormalized: true,
    strokeStyle: '#85ffd8',
    lineWidth: showOriginal ? 3.6 : 3.2,
    shadowColor: showOriginal ? 'rgba(133, 255, 216, 0.68)' : 'rgba(133, 255, 216, 0.58)',
    shadowBlur: showOriginal ? 18 : 14,
    closePath: isClosed,
  });

  drawEndpointMarkers(context, metrics, showOriginal ? originalPoints : reconstructedPath, true);

  if (errorPath.length > 0) {
    strokePath(context, metrics, errorPath, {
      isNormalized: true,
      strokeStyle: 'rgba(255, 119, 119, 0.8)',
      lineWidth: 1.4,
      shadowColor: 'rgba(255, 119, 119, 0.32)',
      shadowBlur: 8,
      closePath: false,
    });
  }
}

export function DrawingCanvas({
  points,
  originalPoints,
  reconstructedPath,
  errorPath,
  isClosed,
  fourierComponents,
  playbackT,
  isDrawing,
  viewMode,
  showEpicycles,
  showOriginal,
  frequencyCount,
  phaseDistortion,
  amplitudeDistortion,
  controlledFailure,
  canvasRef,
  onDrawingStart,
  onDrawingMove,
  onDrawingEnd,
}: DrawingCanvasProps) {
  const activePointerIdRef = useRef<number | null>(null);
  const sceneSnapshotRef = useRef<SceneSnapshot>({
    points,
    originalPoints,
    reconstructedPath,
    errorPath,
    isClosed,
    fourierComponents,
    playbackT,
    isDrawing,
    viewMode,
    showEpicycles,
    showOriginal,
    frequencyCount,
    phaseDistortion,
    amplitudeDistortion,
    controlledFailure,
  });

  sceneSnapshotRef.current = {
    points,
    originalPoints,
    reconstructedPath,
    errorPath,
    isClosed,
    fourierComponents,
    playbackT,
    isDrawing,
    viewMode,
    showEpicycles,
    showOriginal,
    frequencyCount,
    phaseDistortion,
    amplitudeDistortion,
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
      scene.points,
      scene.originalPoints,
      scene.reconstructedPath,
      scene.errorPath,
      scene.isClosed,
      scene.fourierComponents,
      scene.playbackT,
      scene.isDrawing,
      scene.viewMode,
      scene.showEpicycles,
      scene.showOriginal,
      scene.frequencyCount,
      scene.phaseDistortion,
      scene.amplitudeDistortion,
      scene.controlledFailure,
    );
  };

  useEffect(() => {
    drawLatestScene();
  }, [
    amplitudeDistortion,
    controlledFailure,
    errorPath,
    fourierComponents,
    frequencyCount,
    isClosed,
    isDrawing,
    originalPoints,
    phaseDistortion,
    playbackT,
    points,
    reconstructedPath,
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
    onDrawingStart(getCanvasPoint(event.currentTarget, event));
  };

  const handlePointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || activePointerIdRef.current !== event.pointerId) {
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

    if (isDrawing) {
      onDrawingEnd();
    }
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
          hidden={viewMode === 'errorView' || points.length > 0 || reconstructedPath.length > 0}
        >
          <p>Draw on the canvas with a mouse, pen, or touch.</p>
        </div>
      </div>
    </section>
  );
}
