import type { DrawingState, ToolStatus } from '../types';

export function useToolStatus(drawingState: DrawingState): ToolStatus {
  const selectedPath =
    drawingState.paths.find((path) => path.id === drawingState.selectedPathId) ?? null;

  return {
    pointCount: selectedPath?.points.length ?? drawingState.draftPoints.length,
    pathCount: drawingState.paths.length,
    frequencyCount: drawingState.frequencyCount,
    pathType: selectedPath?.isClosed ? 'Closed' : 'Open',
    playbackState: drawingState.isPlaying ? 'Playing' : 'Drawing',
  };
}
