import { useEffect, useRef, useState } from 'react';
import { ControlPanel } from './components/ControlPanel';
import { DrawingCanvas } from './components/DrawingCanvas';
import { FrequencySpectrum } from './components/FrequencySpectrum';
import { Header } from './components/Header';
import { StatusBar } from './components/StatusBar';
import { useToolStatus } from './hooks/useToolStatus';
import { applyJitterToPoint, distortFourierComponents } from './utils/distortion';
import { exportCanvasAsPng } from './utils/export';
import { dft, reconstructPoint, sortFourierComponents } from './utils/fourier';
import { isClosedPath, preparePointsForFourier } from './utils/points';
import { sampleFirstSvgPath } from './utils/svg';
import type { DrawingState, Point } from './types';

const FOURIER_TARGET_SAMPLE_COUNT = 256;
const PLAYBACK_DURATION_MS = 6000;

type ReconstructionCacheEntry = {
  fourierComponents: DrawingState['fourierComponents'];
  controlledFailure: DrawingState['controlledFailure'];
  frequencyCount: number;
  phaseDistortion: number;
  amplitudeDistortion: number;
  isClosed: boolean;
  sampleCount: number;
  path: Point[];
};

function getComponentCountLimit(drawingState: DrawingState): number {
  return Math.max(1, drawingState.fourierComponents.length || drawingState.frequencyCount);
}

function getClampedFrequencyCount(drawingState: DrawingState): number {
  return Math.min(drawingState.frequencyCount, getComponentCountLimit(drawingState));
}

function getReconstructionTime(index: number, sampleCount: number, isClosed: boolean): number {
  if (sampleCount <= 1) {
    return 0;
  }

  return isClosed ? index / (sampleCount - 1) : index / sampleCount;
}

function getVisibleReconstructedPath(path: Point[], playbackT: number): Point[] {
  if (path.length === 0) {
    return [];
  }

  const lastSampleIndex = Math.floor(playbackT * (path.length - 1));
  return path.slice(0, lastSampleIndex + 1);
}

function getTargetSampleCount(): number {
  return FOURIER_TARGET_SAMPLE_COUNT;
}

function buildFullReconstructedPath(drawingState: DrawingState): Point[] {
  if (drawingState.fourierComponents.length === 0) {
    return [];
  }

  const sampleCount = Math.max(1, drawingState.points.length || FOURIER_TARGET_SAMPLE_COUNT);
  const frequencyCount = getClampedFrequencyCount(drawingState);
  const activeComponents = drawingState.fourierComponents.slice(0, frequencyCount);

  return Array.from({ length: sampleCount }, (_, index) => {
    const time = getReconstructionTime(index, sampleCount, drawingState.isClosed);
    const distortedComponents = distortFourierComponents(
      activeComponents,
      drawingState.controlledFailure,
      time,
    );
    const reconstructedPoint = reconstructPoint(distortedComponents, time, {
      phaseDistortion: drawingState.phaseDistortion,
      amplitudeDistortion: drawingState.amplitudeDistortion,
    });

    return applyJitterToPoint(reconstructedPoint, drawingState.controlledFailure, time, index);
  });
}

const initialDrawingState: DrawingState = {
  points: [],
  originalPoints: [],
  fourierComponents: [],
  reconstructedPath: [],
  errorPath: [],
  isClosed: false,
  playbackT: 0,
  isDrawing: false,
  isPlaying: false,
  viewMode: 'epicycle',
  showEpicycles: true,
  showOriginal: false,
  frequencyCount: 16,
  speed: 1,
  phaseDistortion: 0,
  amplitudeDistortion: 0,
  controlledFailure: {
    randomPhaseDrift: {
      enabled: false,
      amount: 20,
    },
    frequencyDropout: {
      enabled: false,
      amount: 15,
    },
    jitter: {
      enabled: false,
      amount: 12,
    },
    decay: {
      enabled: false,
      amount: 20,
    },
  },
};

export function App() {
  const [drawingState, setDrawingState] = useState<DrawingState>(initialDrawingState);
  const [svgError, setSvgError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const animationStartTimeRef = useRef<number | null>(null);
  const latestDrawingStateRef = useRef<DrawingState>(drawingState);
  const reconstructionCacheRef = useRef<ReconstructionCacheEntry | null>(null);
  const status = useToolStatus(drawingState);

  const getCachedFullReconstructedPath = (state: DrawingState): Point[] => {
    const frequencyCount = getClampedFrequencyCount(state);
    const sampleCount = Math.max(1, state.points.length || FOURIER_TARGET_SAMPLE_COUNT);
    const cached = reconstructionCacheRef.current;

    if (
      cached &&
      cached.fourierComponents === state.fourierComponents &&
      cached.controlledFailure === state.controlledFailure &&
      cached.frequencyCount === frequencyCount &&
      cached.phaseDistortion === state.phaseDistortion &&
      cached.amplitudeDistortion === state.amplitudeDistortion &&
      cached.isClosed === state.isClosed &&
      cached.sampleCount === sampleCount
    ) {
      return cached.path;
    }

    const path = buildFullReconstructedPath({
      ...state,
      frequencyCount,
    });

    reconstructionCacheRef.current = {
      fourierComponents: state.fourierComponents,
      controlledFailure: state.controlledFailure,
      frequencyCount,
      phaseDistortion: state.phaseDistortion,
      amplitudeDistortion: state.amplitudeDistortion,
      isClosed: state.isClosed,
      sampleCount,
      path,
    };

    return path;
  };

  const buildFourierStateFromPoints = (current: DrawingState, sourcePoints: Point[]): DrawingState => {
    const isClosed = isClosedPath(sourcePoints);
    const preparedPoints = preparePointsForFourier(sourcePoints, getTargetSampleCount());
    const fourierComponents = sortFourierComponents(dft(preparedPoints));
    const nextState = {
      ...current,
      points: preparedPoints,
      originalPoints: preparedPoints,
      fourierComponents,
      reconstructedPath: [],
      errorPath: [],
      isClosed,
      playbackT: 0,
      isDrawing: false,
      isPlaying: true,
    };

    return {
      ...nextState,
      frequencyCount: getClampedFrequencyCount(nextState),
      reconstructedPath: getVisibleReconstructedPath(buildFullReconstructedPath(nextState), 0),
    };
  };

  useEffect(() => {
    latestDrawingStateRef.current = drawingState;
  }, [drawingState]);

  useEffect(() => {
    if (!drawingState.isPlaying || drawingState.fourierComponents.length === 0) {
      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }

      return;
    }

    let isCancelled = false;
    animationStartTimeRef.current = null;

    const step = (timestamp: number) => {
      if (isCancelled) {
        return;
      }

      if (animationStartTimeRef.current === null) {
        animationStartTimeRef.current = timestamp;
      }

      const currentState = latestDrawingStateRef.current;
      const elapsed = timestamp - animationStartTimeRef.current;
      const playbackSpeed = Math.max(0, currentState.speed);
      const progress =
        playbackSpeed === 0 ? 0 : Math.min(1, (elapsed * playbackSpeed) / PLAYBACK_DURATION_MS);
      const fullPath = getCachedFullReconstructedPath(currentState);
      const visiblePath = getVisibleReconstructedPath(fullPath, progress);

      setDrawingState((current) => {
        if (!current.isPlaying || current.fourierComponents !== currentState.fourierComponents) {
          return current;
        }

        return {
          ...current,
          reconstructedPath: visiblePath,
          playbackT: progress,
          isPlaying: progress < 1,
        };
      });

      if (progress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(step);
      }
    };

    if (animationFrameRef.current === null) {
      animationFrameRef.current = window.requestAnimationFrame(step);
    }

    return () => {
      isCancelled = true;

      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [
    drawingState.fourierComponents,
    drawingState.isPlaying,
  ]);

  useEffect(() => {
    if (drawingState.fourierComponents.length === 0 || drawingState.isDrawing) {
      return;
    }

    setDrawingState((current) => {
      if (current.fourierComponents.length === 0 || current.isDrawing) {
        return current;
      }

      const frequencyCount = getClampedFrequencyCount(current);

      if (current.isPlaying) {
        return frequencyCount === current.frequencyCount
          ? current
          : {
              ...current,
              frequencyCount,
            };
      }

      const nextState = {
        ...current,
        frequencyCount,
      };

      return {
        ...nextState,
        reconstructedPath: getVisibleReconstructedPath(
          getCachedFullReconstructedPath(nextState),
          nextState.playbackT,
        ),
      };
    });
  }, [
    drawingState.amplitudeDistortion,
    drawingState.controlledFailure,
    drawingState.fourierComponents,
    drawingState.frequencyCount,
    drawingState.isClosed,
    drawingState.isDrawing,
    drawingState.isPlaying,
    drawingState.phaseDistortion,
  ]);

  const startDrawing = (point: Point) => {
    setSvgError(null);
    setDrawingState((current) => ({
      ...current,
      points: [point],
      originalPoints: [],
      fourierComponents: [],
      reconstructedPath: [],
      errorPath: [],
      isClosed: false,
      playbackT: 0,
      isDrawing: true,
      isPlaying: false,
    }));
  };

  const addDrawingPoint = (point: Point) => {
    setDrawingState((current) => {
      if (!current.isDrawing) {
        return current;
      }

      return {
        ...current,
        points: [...current.points, point],
      };
    });
  };

  const stopDrawing = () => {
    setDrawingState((current) => {
      if (!current.isDrawing) {
        return current;
      }

      if (current.points.length < 2) {
        return {
          ...current,
          isDrawing: false,
          isPlaying: false,
          playbackT: 0,
        };
      }

      return buildFourierStateFromPoints(current, current.points);
    });
  };

  const importSvgFile = async (file: File) => {
    try {
      const svgText = await file.text();
      const sampledPoints = sampleFirstSvgPath(svgText, FOURIER_TARGET_SAMPLE_COUNT);

      if (sampledPoints.length < 2) {
        throw new Error('SVG path did not produce enough points.');
      }

      setDrawingState((current) => buildFourierStateFromPoints(current, sampledPoints));
      setSvgError(null);
    } catch (error) {
      setSvgError(error instanceof Error ? error.message : 'Failed to import SVG.');
    }
  };

  const exportPng = async () => {
    const canvas = canvasRef.current;

    if (!canvas) {
      setExportError('Canvas is not ready to export.');
      return;
    }

    try {
      await exportCanvasAsPng(canvas, {
        includeBackground: false,
      });
      setExportError(null);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Failed to export PNG.');
    }
  };

  const resetDrawing = () => {
    setDrawingState({
      ...initialDrawingState,
    });
  };

  return (
    <main className="app-shell">
      <Header />
      <DrawingCanvas
        points={drawingState.points}
        originalPoints={drawingState.originalPoints}
        reconstructedPath={drawingState.reconstructedPath}
        errorPath={drawingState.errorPath}
        isClosed={drawingState.isClosed}
        fourierComponents={drawingState.fourierComponents}
        playbackT={drawingState.playbackT}
        isDrawing={drawingState.isDrawing}
        viewMode={drawingState.viewMode}
        showEpicycles={drawingState.viewMode === 'epicycle' && drawingState.showEpicycles}
        showOriginal={drawingState.viewMode === 'originalCompare' && drawingState.showOriginal}
        frequencyCount={drawingState.frequencyCount}
        phaseDistortion={drawingState.phaseDistortion}
        amplitudeDistortion={drawingState.amplitudeDistortion}
        controlledFailure={drawingState.controlledFailure}
        canvasRef={canvasRef}
        onDrawingStart={startDrawing}
        onDrawingMove={addDrawingPoint}
        onDrawingEnd={stopDrawing}
      />
      <ControlPanel
        drawingState={drawingState}
        setDrawingState={setDrawingState}
        svgError={svgError}
        exportError={exportError}
        onSvgImport={importSvgFile}
        onPngExport={exportPng}
        onReset={resetDrawing}
      />
      <FrequencySpectrum
        components={drawingState.fourierComponents}
        frequencyCount={drawingState.frequencyCount}
      />
      <StatusBar status={status} />
    </main>
  );
}
