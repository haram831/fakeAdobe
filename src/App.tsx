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

const FOURIER_SAMPLE_COUNT = 256;
const PLAYBACK_DURATION_MS = 6000;

function getComponentCountLimit(drawingState: DrawingState): number {
  return Math.max(1, drawingState.fourierComponents.length || drawingState.frequencyCount);
}

function getClampedFrequencyCount(drawingState: DrawingState): number {
  return Math.min(drawingState.frequencyCount, getComponentCountLimit(drawingState));
}

function getReconstructionTime(index: number, isClosed: boolean): number {
  return isClosed ? index / (FOURIER_SAMPLE_COUNT - 1) : index / FOURIER_SAMPLE_COUNT;
}

function getReconstructedPath(drawingState: DrawingState, playbackT: number): Point[] {
  if (drawingState.fourierComponents.length === 0) {
    return [];
  }

  const lastSampleIndex = Math.floor(playbackT * (FOURIER_SAMPLE_COUNT - 1));

  return Array.from({ length: lastSampleIndex + 1 }, (_, index) => {
    const time = getReconstructionTime(index, drawingState.isClosed);
    const distortedComponents = distortFourierComponents(
      drawingState.fourierComponents,
      drawingState.controlledFailure,
      time,
    );
    const reconstructedPoint = reconstructPoint(distortedComponents, time, {
      componentCount: getClampedFrequencyCount(drawingState),
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
  const status = useToolStatus(drawingState);

  const buildFourierStateFromPoints = (current: DrawingState, sourcePoints: Point[]): DrawingState => {
    const isClosed = isClosedPath(sourcePoints);
    const preparedPoints = preparePointsForFourier(sourcePoints, FOURIER_SAMPLE_COUNT);
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
      reconstructedPath: getReconstructedPath(nextState, 0),
    };
  };

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

      const elapsed = timestamp - animationStartTimeRef.current;
      const playbackSpeed = Math.max(0, drawingState.speed);
      const progress =
        playbackSpeed === 0 ? 0 : Math.min(1, (elapsed * playbackSpeed) / PLAYBACK_DURATION_MS);

      setDrawingState((current) => {
        if (!current.isPlaying || current.fourierComponents !== drawingState.fourierComponents) {
          return current;
        }

        return {
          ...current,
          reconstructedPath: getReconstructedPath(current, progress),
          playbackT: progress,
          isPlaying: progress < 1,
        };
      });

      if (progress < 1) {
        animationFrameRef.current = window.requestAnimationFrame(step);
      }
    };

    animationFrameRef.current = window.requestAnimationFrame(step);

    return () => {
      isCancelled = true;

      if (animationFrameRef.current !== null) {
        window.cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
    };
  }, [
    drawingState.amplitudeDistortion,
    drawingState.controlledFailure,
    drawingState.fourierComponents,
    drawingState.frequencyCount,
    drawingState.isClosed,
    drawingState.isPlaying,
    drawingState.phaseDistortion,
    drawingState.speed,
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
        reconstructedPath: getReconstructedPath(nextState, nextState.playbackT),
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
      const sampledPoints = sampleFirstSvgPath(svgText, FOURIER_SAMPLE_COUNT);

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
