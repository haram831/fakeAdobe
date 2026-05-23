import type { ToolStatus } from '../types';

type StatusBarProps = {
  status: ToolStatus;
};

export function StatusBar({ status }: StatusBarProps) {
  return (
    <footer className="status-bar" aria-label="Status bar">
      <span>Samples: {status.pointCount}</span>
      <span>Paths: {status.pathCount}</span>
      <span>Oscillators: {status.frequencyCount}</span>
      <span>Topology: {status.pathType}</span>
      <span>Signal: {status.playbackState}</span>
    </footer>
  );
}
