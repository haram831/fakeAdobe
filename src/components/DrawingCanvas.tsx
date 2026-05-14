import { useEffect } from 'react';
import type { MouseEvent, RefObject } from 'react';
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

function getCanvasPoint(canvas: HTMLCanvasElement, event: MouseEvent<HTMLCanvasElement>): Point {
  const rect = canvas.getBoundingClientRect();

  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function syncCanvasSize(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
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

  return context;
}

function getNormalizedScale(canvas: HTMLCanvasElement): number {
  const rect = canvas.getBoundingClientRect();
  return Math.max(1, Math.min(rect.width, rect.height) * 0.38);
}

function toCanvasPoint(canvas: HTMLCanvasElement, point: Point, isNormalized: boolean): Point {
  if (!isNormalized) {
    return point;
  }

  const rect = canvas.getBoundingClientRect();
  const scale = getNormalizedScale(canvas);

  return {
    x: rect.width / 2 + point.x * scale,
    y: rect.height / 2 + point.y * scale,
  };
}

function getEpicycleTime(playbackT: number, sampleCount: number, isClosed: boolean): number {
  if (isClosed || sampleCount <= 1) {
    return playbackT;
  }

  return playbackT * ((sampleCount - 1) / sampleCount);
}

function strokePath(
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
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

  const firstPoint = toCanvasPoint(canvas, points[0], options.isNormalized);
  context.beginPath();
  context.moveTo(firstPoint.x, firstPoint.y);

  for (const point of points.slice(1)) {
    const canvasPoint = toCanvasPoint(canvas, point, options.isNormalized);
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
  canvas: HTMLCanvasElement,
  context: CanvasRenderingContext2D,
  points: Point[],
  isNormalized: boolean,
) {
  if (points.length < 2) {
    return;
  }

  const startPoint = toCanvasPoint(canvas, points[0], isNormalized);
  const endPoint = toCanvasPoint(canvas, points[points.length - 1], isNormalized);

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

function drawErrorViewPlaceholder(canvas: HTMLCanvasElement, context: CanvasRenderingContext2D) {
  const rect = canvas.getBoundingClientRect();

  context.save();
  context.fillStyle = 'rgba(243, 246, 255, 0.58)';
  context.font = '600 14px Inter, ui-sans-serif, system-ui, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText('Error View placeholder', rect.width / 2, rect.height / 2);
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
  const context = syncCanvasSize(canvas);

  if (!context) {
    return;
  }

  if (isDrawing) {
    strokePath(canvas, context, points, {
      isNormalized: false,
      strokeStyle: '#85ffd8',
      lineWidth: 2.4,
      shadowColor: 'rgba(133, 255, 216, 0.52)',
      shadowBlur: 12,
      closePath: false,
    });
    drawEndpointMarkers(canvas, context, points, false);
    return;
  }

  if (viewMode === 'errorView') {
    drawErrorViewPlaceholder(canvas, context);
    return;
  }

  if (showOriginal) {
    strokePath(canvas, context, originalPoints, {
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

    drawEpicycles(context, epicycles, (point) => toCanvasPoint(canvas, point, true));
  }

  strokePath(canvas, context, reconstructedPath, {
    isNormalized: true,
    strokeStyle: '#85ffd8',
    lineWidth: showOriginal ? 3.6 : 3.2,
    shadowColor: showOriginal ? 'rgba(133, 255, 216, 0.68)' : 'rgba(133, 255, 216, 0.58)',
    shadowBlur: showOriginal ? 18 : 14,
    closePath: isClosed,
  });

  drawEndpointMarkers(canvas, context, showOriginal ? originalPoints : reconstructedPath, true);

  if (errorPath.length > 0) {
    strokePath(canvas, context, errorPath, {
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
  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas) {
      return;
    }

    drawScene(
      canvas,
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
    );
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
    const handleResize = () => {
      const canvas = canvasRef.current;

      if (canvas) {
        drawScene(
          canvas,
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
        );
      }
    };

    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
    };
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

  const handleMouseDown = (event: MouseEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    onDrawingStart(getCanvasPoint(event.currentTarget, event));
  };

  const handleMouseMove = (event: MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing) {
      return;
    }

    onDrawingMove(getCanvasPoint(event.currentTarget, event));
  };

  const handleMouseEnd = () => {
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
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseEnd}
          onMouseLeave={handleMouseEnd}
        />
        <div className="canvas-grid" aria-hidden="true" />
        <div
          className="canvas-empty-state"
          hidden={viewMode === 'errorView' || points.length > 0 || reconstructedPath.length > 0}
        >
          <p>Mouse drawing canvas placeholder</p>
        </div>
      </div>
    </section>
  );
}
