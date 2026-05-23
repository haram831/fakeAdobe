export type Point = {
  x: number;
  y: number;
};

export type Complex = {
  re: number;
  im: number;
};

export type FourierComponent = {
  frequency: number;
  amplitude: number;
  phase: number;
  re: number;
  im: number;
};

export type ViewMode = 'finalCurve' | 'epicycle' | 'originalCompare' | 'errorView';

export type ControlledFailureSettings = {
  randomPhaseDrift: {
    enabled: boolean;
    amount: number;
  };
  frequencyDropout: {
    enabled: boolean;
    amount: number;
  };
  jitter: {
    enabled: boolean;
    amount: number;
  };
  decay: {
    enabled: boolean;
    amount: number;
  };
};

export type DrawingState = {
  points: Point[];
  originalPoints: Point[];
  fourierComponents: FourierComponent[];
  reconstructedPath: Point[];
  errorPath: Point[];
  isClosed: boolean;
  playbackT: number;
  isDrawing: boolean;
  isPlaying: boolean;
  viewMode: ViewMode;
  showEpicycles: boolean;
  showOriginal: boolean;
  frequencyCount: number;
  speed: number;
  phaseDistortion: number;
  amplitudeDistortion: number;
  curveColor: string;
  controlledFailure: ControlledFailureSettings;
};

export type ToolStatus = {
  pointCount: number;
  frequencyCount: number;
  pathType: 'Open' | 'Closed';
  playbackState: 'Drawing' | 'Playing';
};
