import type { ToolStatus } from '../types';

type StatusBarProps = {
  status: ToolStatus;
};

export function StatusBar({ status }: StatusBarProps) {
  return (
    <footer className="status-bar" aria-label="Status bar">
      <span>Points: {status.pointCount}</span>
      <span>Frequencies: {status.frequencyCount}</span>
      <span>Path: {status.pathType}</span>
      <span>Status: {status.playbackState}</span>
    </footer>
  );
}
