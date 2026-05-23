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
import { getPathLength, isClosedPath, preparePointGroupsForFourier } from './utils/points';
import { sampleSvgPaths } from './utils/svg';
import type { DrawingState, FourierPath, Point } from './types';

const FOURIER_TARGET_SAMPLE_COUNT = 256;
const PLAYBACK_DURATION_MS = 6000;

type ReconstructionCacheEntry = {
  sourcePath: FourierPath;
  controlledFailure: DrawingState['controlledFailure'];
  frequencyCount: number;
  phaseDistortion: number;
  amplitudeDistortion: number;
  path: Point[];
};

function getPathFrequencyLimit(path: FourierPath): number {
  return Math.max(1, path.fourierComponents.length);
}

export function getGlobalFrequencyLimit(drawingState: DrawingState): number {
  if (drawingState.paths.length === 0) {
    return Math.max(1, drawingState.frequencyCount);
  }

  return Math.max(
    1,
    drawingState.paths.reduce(
      (maxValue, path) => Math.max(maxValue, getPathFrequencyLimit(path)),
      1,
    ),
  );
}

export function getPathFrequencyCount(path: FourierPath, globalFrequencyCount: number): number {
  return Math.min(path.frequencyCountOverride ?? globalFrequencyCount, getPathFrequencyLimit(path));
}

function getSelectedPath(drawingState: DrawingState): FourierPath | null {
  return drawingState.paths.find((path) => path.id === drawingState.selectedPathId) ?? null;
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

function buildFullReconstructedPath(
  path: FourierPath,
  drawingState: DrawingState,
  frequencyCount = getPathFrequencyCount(path, drawingState.frequencyCount),
): Point[] {
  if (path.fourierComponents.length === 0) {
    return [];
  }

  const sampleCount = Math.max(1, path.points.length || FOURIER_TARGET_SAMPLE_COUNT);
  const activeComponents = path.fourierComponents.slice(0, frequencyCount);

  return Array.from({ length: sampleCount }, (_, index) => {
    const time = getReconstructionTime(index, sampleCount, path.isClosed);
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

function getPathPlaybackProgress(path: FourierPath, maxPathLength: number, playbackT: number): number {
  if (maxPathLength <= 0 || path.length <= 0) {
    return playbackT;
  }

  return Math.min(1, playbackT / (path.length / maxPathLength));
}

function getPathId(index: number): string {
  return `path-${index + 1}`;
}

function buildFourierPathsFromPointGroups(sourcePointGroups: Point[][]): FourierPath[] {
  const preparedGroups = preparePointGroupsForFourier(sourcePointGroups, getTargetSampleCount());

  return preparedGroups.map((preparedPoints, index) => ({
    id: getPathId(index),
    label: String(index + 1),
    points: preparedPoints,
    originalPoints: preparedPoints,
    fourierComponents: sortFourierComponents(dft(preparedPoints)),
    reconstructedPath: [],
    errorPath: [],
    isClosed: isClosedPath(sourcePointGroups[index]),
    length: getPathLength(sourcePointGroups[index]),
    frequencyCountOverride: null,
  }));
}

function createInitialDrawingState(): DrawingState {
  return {
    paths: [],
    selectedPathId: null,
    draftPoints: [],
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
    curveColor: '#85ffd8',
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
}

function downloadSelectedPathAsSvg(path: FourierPath, points: Point[], curveColor: string): string {
  if (points.length < 2) {
    throw new Error('Selected path is not ready to export.');
  }

  const bounds = points.reduce(
    (currentBounds, point) => ({
      minX: Math.min(currentBounds.minX, point.x),
      minY: Math.min(currentBounds.minY, point.y),
      maxX: Math.max(currentBounds.maxX, point.x),
      maxY: Math.max(currentBounds.maxY, point.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
  const padding = 0.08;
  const width = Math.max(0.01, bounds.maxX - bounds.minX + padding * 2);
  const height = Math.max(0.01, bounds.maxY - bounds.minY + padding * 2);
  const offsetX = bounds.minX - padding;
  const offsetY = bounds.minY - padding;
  const polylinePoints = points
    .map((point) => `${(point.x - offsetX).toFixed(4)},${(point.y - offsetY).toFixed(4)}`)
    .join(' ');
  const filename = `unanchor-path-${path.label}.svg`;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(4)} ${height.toFixed(4)}">`,
    `<polyline points="${polylinePoints}" fill="none" stroke="${curveColor}" stroke-width="0.02" stroke-linecap="round" stroke-linejoin="round"/>`,
    '</svg>',
  ].join('');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);

  return filename;
}

function downloadPathsAsSvg(paths: Array<{ label: string; points: Point[] }>, curveColor: string): string {
  const drawablePaths = paths.filter((path) => path.points.length >= 2);
  const allPoints = drawablePaths.flatMap((path) => path.points);

  if (allPoints.length < 2) {
    throw new Error('Paths are not ready to export.');
  }

  const bounds = allPoints.reduce(
    (currentBounds, point) => ({
      minX: Math.min(currentBounds.minX, point.x),
      minY: Math.min(currentBounds.minY, point.y),
      maxX: Math.max(currentBounds.maxX, point.x),
      maxY: Math.max(currentBounds.maxY, point.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
  const padding = 0.08;
  const width = Math.max(0.01, bounds.maxX - bounds.minX + padding * 2);
  const height = Math.max(0.01, bounds.maxY - bounds.minY + padding * 2);
  const offsetX = bounds.minX - padding;
  const offsetY = bounds.minY - padding;
  const pathElements = drawablePaths
    .map((path) => {
      const polylinePoints = path.points
        .map((point) => `${(point.x - offsetX).toFixed(4)},${(point.y - offsetY).toFixed(4)}`)
        .join(' ');

      return `<polyline data-path-label="${path.label}" points="${polylinePoints}" fill="none" stroke="${curveColor}" stroke-width="0.02" stroke-linecap="round" stroke-linejoin="round"/>`;
    })
    .join('');
  const filename = 'unanchor-all-paths.svg';
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width.toFixed(4)} ${height.toFixed(4)}">`,
    pathElements,
    '</svg>',
  ].join('');
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  const link = document.createElement('a');

  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);

  return filename;
}

export function App() {
  const [drawingState, setDrawingState] = useState<DrawingState>(() => createInitialDrawingState());
  const [svgError, setSvgError] = useState<string | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const animationStartTimeRef = useRef<number | null>(null);
  const latestDrawingStateRef = useRef<DrawingState>(drawingState);
  const reconstructionCacheRef = useRef<Map<string, ReconstructionCacheEntry>>(new Map());
  const status = useToolStatus(drawingState);
  const selectedPath = getSelectedPath(drawingState);
  const selectedPathFrequencyCount = selectedPath
    ? getPathFrequencyCount(selectedPath, drawingState.frequencyCount)
    : drawingState.frequencyCount;
  const pathFrequencySignature = drawingState.paths
    .map((path) => `${path.id}:${path.frequencyCountOverride ?? 'global'}:${path.fourierComponents.length}`)
    .join('|');

  const getCachedFullReconstructedPath = (state: DrawingState, path: FourierPath): Point[] => {
    const frequencyCount = getPathFrequencyCount(path, state.frequencyCount);
    const cached = reconstructionCacheRef.current.get(path.id);

    if (
      cached &&
      cached.sourcePath === path &&
      cached.controlledFailure === state.controlledFailure &&
      cached.frequencyCount === frequencyCount &&
      cached.phaseDistortion === state.phaseDistortion &&
      cached.amplitudeDistortion === state.amplitudeDistortion
    ) {
      return cached.path;
    }

    const reconstructedPath = buildFullReconstructedPath(path, state, frequencyCount);

    reconstructionCacheRef.current.set(path.id, {
      sourcePath: path,
      controlledFailure: state.controlledFailure,
      frequencyCount,
      phaseDistortion: state.phaseDistortion,
      amplitudeDistortion: state.amplitudeDistortion,
      path: reconstructedPath,
    });

    return reconstructedPath;
  };

  const rebuildVisiblePaths = (state: DrawingState, playbackT: number): FourierPath[] => {
    const maxPathLength = state.paths.reduce(
      (maxValue, path) => Math.max(maxValue, path.length),
      0,
    );

    return state.paths.map((path) => {
      const fullPath = getCachedFullReconstructedPath(state, path);
      const pathPlaybackT = getPathPlaybackProgress(path, maxPathLength, playbackT);

      return {
        ...path,
        reconstructedPath: getVisibleReconstructedPath(fullPath, pathPlaybackT),
      };
    });
  };

  const buildFourierStateFromPointGroups = (
    current: DrawingState,
    sourcePointGroups: Point[][],
  ): DrawingState => {
    const paths = buildFourierPathsFromPointGroups(sourcePointGroups);
    const nextState = {
      ...current,
      paths,
      selectedPathId: null,
      draftPoints: [],
      playbackT: 0,
      isDrawing: false,
      isPlaying: true,
      frequencyCount: Math.min(current.frequencyCount, getGlobalFrequencyLimit({ ...current, paths })),
    };

    return {
      ...nextState,
      paths: rebuildVisiblePaths(nextState, 0),
    };
  };

  useEffect(() => {
    latestDrawingStateRef.current = drawingState;
  }, [drawingState]);

  useEffect(() => {
    if (!drawingState.isPlaying || drawingState.paths.length === 0) {
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
      const visiblePaths = rebuildVisiblePaths(currentState, progress);

      setDrawingState((current) => {
        if (!current.isPlaying || current.paths !== currentState.paths) {
          return current;
        }

        return {
          ...current,
          paths: visiblePaths,
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
  }, [drawingState.isPlaying]);

  useEffect(() => {
    if (drawingState.paths.length === 0 || drawingState.isDrawing) {
      return;
    }

    setDrawingState((current) => {
      if (current.paths.length === 0 || current.isDrawing || current.isPlaying) {
        return current;
      }

      return {
        ...current,
        paths: rebuildVisiblePaths(current, current.playbackT),
      };
    });
  }, [
    drawingState.amplitudeDistortion,
    drawingState.controlledFailure,
    drawingState.frequencyCount,
    drawingState.isDrawing,
    drawingState.isPlaying,
    pathFrequencySignature,
    drawingState.phaseDistortion,
  ]);

  const startDrawing = (point: Point) => {
    setSvgError(null);
    setDrawingState((current) => ({
      ...current,
      paths: [],
      selectedPathId: null,
      draftPoints: [point],
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
        draftPoints: [...current.draftPoints, point],
      };
    });
  };

  const stopDrawing = () => {
    setDrawingState((current) => {
      if (!current.isDrawing) {
        return current;
      }

      if (current.draftPoints.length < 2) {
        return {
          ...current,
          draftPoints: [],
          isDrawing: false,
          isPlaying: false,
          playbackT: 0,
        };
      }

      return buildFourierStateFromPointGroups(current, [current.draftPoints]);
    });
  };

  const importSvgFile = async (file: File) => {
    try {
      const svgText = await file.text();
      const sampledPointGroups = sampleSvgPaths(svgText, FOURIER_TARGET_SAMPLE_COUNT);

      setDrawingState((current) => buildFourierStateFromPointGroups(current, sampledPointGroups));
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
      if (drawingState.paths.length > 1) {
        const pathToExport = getSelectedPath(drawingState);

        if (pathToExport) {
          const fullPath = getCachedFullReconstructedPath(drawingState, pathToExport);
          downloadSelectedPathAsSvg(pathToExport, fullPath, drawingState.curveColor);
        } else {
          downloadPathsAsSvg(
            drawingState.paths.map((path) => ({
              label: path.label,
              points: getCachedFullReconstructedPath(drawingState, path),
            })),
            drawingState.curveColor,
          );
        }
      } else {
        await exportCanvasAsPng(canvas, {
          includeBackground: false,
        });
      }

      setExportError(null);
    } catch (error) {
      setExportError(error instanceof Error ? error.message : 'Failed to export path.');
    }
  };

  const resetDrawing = () => {
    reconstructionCacheRef.current.clear();
    setDrawingState(createInitialDrawingState());
  };

  return (
    <main className="app-shell">
      <Header />
      <DrawingCanvas
        paths={drawingState.paths}
        selectedPathId={drawingState.selectedPathId}
        draftPoints={drawingState.draftPoints}
        playbackT={drawingState.playbackT}
        isDrawing={drawingState.isDrawing}
        viewMode={drawingState.viewMode}
        showEpicycles={drawingState.viewMode === 'epicycle' && drawingState.showEpicycles}
        showOriginal={drawingState.viewMode === 'originalCompare' && drawingState.showOriginal}
        frequencyCount={drawingState.frequencyCount}
        phaseDistortion={drawingState.phaseDistortion}
        amplitudeDistortion={drawingState.amplitudeDistortion}
        curveColor={drawingState.curveColor}
        controlledFailure={drawingState.controlledFailure}
        canvasRef={canvasRef}
        onDrawingStart={startDrawing}
        onDrawingMove={addDrawingPoint}
        onDrawingEnd={stopDrawing}
        onPathSelect={(pathId) => setDrawingState((current) => ({ ...current, selectedPathId: pathId }))}
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
        pathLabel={selectedPath?.label ?? null}
        components={selectedPath?.fourierComponents ?? []}
        frequencyCount={selectedPathFrequencyCount}
      />
      <StatusBar status={status} />
    </main>
  );
}
