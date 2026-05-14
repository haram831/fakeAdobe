import type { DrawingState, ToolStatus } from '../types';

export function useToolStatus(drawingState: DrawingState): ToolStatus {
  return {
    pointCount: drawingState.points.length,
    frequencyCount: drawingState.frequencyCount,
    pathType: drawingState.isClosed ? 'Closed' : 'Open',
    playbackState: drawingState.isPlaying ? 'Playing' : 'Drawing',
  };
}
