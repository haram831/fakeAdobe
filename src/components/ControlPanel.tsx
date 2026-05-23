import { Download, FileUp, RotateCcw, SlidersHorizontal, Zap } from 'lucide-react';
import type { ChangeEvent, Dispatch, ReactNode, SetStateAction } from 'react';
import type { ControlledFailureSettings, DrawingState, ViewMode } from '../types';

type ControlPanelProps = {
  drawingState: DrawingState;
  setDrawingState: Dispatch<SetStateAction<DrawingState>>;
  svgError: string | null;
  exportError: string | null;
  onSvgImport: (file: File) => void;
  onPngExport: () => void;
  onReset: () => void;
};

function getFrequencyLimit(drawingState: DrawingState): number {
  return Math.max(1, drawingState.fourierComponents.length || drawingState.frequencyCount);
}

const viewModeLabels: Record<ViewMode, string> = {
  finalCurve: 'Trace Only',
  epicycle: 'Oscillator Rig',
  originalCompare: 'Source Ghost',
  errorView: 'Error Field',
};

const controlledFailureLabels: Record<keyof ControlledFailureSettings, string> = {
  randomPhaseDrift: 'Phase Drift',
  frequencyDropout: 'Frequency Dropout',
  jitter: 'Trace Jitter',
  decay: 'Signal Decay',
};

type ControlSectionProps = {
  title: string;
  label: string;
  children: ReactNode;
};

function ControlSection({ title, label, children }: ControlSectionProps) {
  return (
    <details className="control-section" aria-label={label} open>
      <summary className="control-section-summary">
        <span>{title}</span>
      </summary>
      <div className="control-section-content">{children}</div>
    </details>
  );
}

export function ControlPanel({
  drawingState,
  setDrawingState,
  svgError,
  exportError,
  onSvgImport,
  onPngExport,
  onReset,
}: ControlPanelProps) {
  const frequencyLimit = getFrequencyLimit(drawingState);
  const frequencyCount = Math.min(drawingState.frequencyCount, frequencyLimit);

  const updateNumber = (key: 'frequencyCount' | 'speed' | 'phaseDistortion' | 'amplitudeDistortion') => {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.currentTarget.value);

      if (!Number.isFinite(value)) {
        return;
      }

      setDrawingState((current) => ({
        ...current,
        [key]: key === 'frequencyCount' ? Math.min(value, getFrequencyLimit(current)) : value,
      }));
    };
  };

  const updateBoolean = (key: 'showEpicycles' | 'showOriginal') => {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const { checked } = event.currentTarget;

      setDrawingState((current) => ({
        ...current,
        [key]: checked,
      }));
    };
  };

  const updateViewMode = (event: ChangeEvent<HTMLSelectElement>) => {
    const viewMode = event.currentTarget.value as ViewMode;

    setDrawingState((current) => ({
      ...current,
      viewMode,
      showEpicycles: viewMode === 'epicycle',
      showOriginal: viewMode === 'originalCompare',
    }));
  };

  const updateControlledFailureEnabled = (key: keyof ControlledFailureSettings) => {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const { checked } = event.currentTarget;

      setDrawingState((current) => ({
        ...current,
        controlledFailure: {
          ...current.controlledFailure,
          [key]: {
            ...current.controlledFailure[key],
            enabled: checked,
          },
        },
      }));
    };
  };

  const updateControlledFailureAmount = (key: keyof ControlledFailureSettings) => {
    return (event: ChangeEvent<HTMLInputElement>) => {
      const value = Number(event.currentTarget.value);

      if (!Number.isFinite(value)) {
        return;
      }

      setDrawingState((current) => ({
        ...current,
        controlledFailure: {
          ...current.controlledFailure,
          [key]: {
            ...current.controlledFailure[key],
            amount: value,
          },
        },
      }));
    };
  };

  const updateCurveColor = (event: ChangeEvent<HTMLInputElement>) => {
    const { value } = event.currentTarget;

    setDrawingState((current) => ({
      ...current,
      curveColor: value,
    }));
  };

  const handleSvgFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files?.[0];

    if (file) {
      onSvgImport(file);
    }

    event.currentTarget.value = '';
  };

  const breakCurve = () => {
    setDrawingState((current) => ({
      ...current,
      controlledFailure: {
        randomPhaseDrift: {
          enabled: true,
          amount: Math.max(current.controlledFailure.randomPhaseDrift.amount, 36),
        },
        frequencyDropout: {
          enabled: true,
          amount: Math.max(current.controlledFailure.frequencyDropout.amount, 18),
        },
        jitter: {
          enabled: true,
          amount: Math.max(current.controlledFailure.jitter.amount, 22),
        },
        decay: {
          ...current.controlledFailure.decay,
        },
      },
    }));
  };

  return (
    <aside className="control-panel" aria-label="Control panel">
      <header className="panel-header">
        <div>
          <p className="panel-kicker">Signal Rack</p>
          <h2>Curve Lab</h2>
        </div>
        <SlidersHorizontal size={20} aria-hidden="true" />
      </header>

      <ControlSection title="I/O" label="Import and export controls">
        <label className="file-upload-button">
          <FileUp size={17} aria-hidden="true" />
          Unanchor
          <input type="file" accept=".svg,image/svg+xml" onChange={handleSvgFileChange} />
        </label>
        {svgError ? <p className="control-error">{svgError}</p> : null}
        <button type="button" className="panel-action-button" onClick={onPngExport}>
          <Download size={17} aria-hidden="true" />
          Export Trace
        </button>
        {exportError ? <p className="control-error">{exportError}</p> : null}
      </ControlSection>

      <ControlSection title="Oscillators" label="Fourier controls">
        <label className="control-row">
          <span>
            Frequency Count
            <strong>{frequencyCount}</strong>
          </span>
          <input
            type="range"
            min="1"
            max={frequencyLimit}
            value={frequencyCount}
            onChange={updateNumber('frequencyCount')}
          />
        </label>

        <label className="control-row">
          <span>
            Speed
            <strong>{drawingState.speed.toFixed(1)}x</strong>
          </span>
          <input
            type="range"
            min="0"
            max="4"
            step="0.1"
            value={drawingState.speed}
            onChange={updateNumber('speed')}
          />
        </label>

        <label className="control-row">
          <span>
            Phase Distortion
            <strong>{drawingState.phaseDistortion}%</strong>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={drawingState.phaseDistortion}
            onChange={updateNumber('phaseDistortion')}
          />
        </label>

        <label className="control-row">
          <span>
            Amplitude Distortion
            <strong>{drawingState.amplitudeDistortion}%</strong>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={drawingState.amplitudeDistortion}
            onChange={updateNumber('amplitudeDistortion')}
          />
        </label>
      </ControlSection>

      <ControlSection title="Monitor" label="Display controls">
        <label className="color-control">
          <span>
            Trace Color
            <strong>{drawingState.curveColor.toUpperCase()}</strong>
          </span>
          <input
            type="color"
            value={drawingState.curveColor}
            onChange={updateCurveColor}
            aria-label="Trace color"
          />
        </label>

        <label className="control-row">
          <span>View Mode</span>
          <select className="view-mode-select" value={drawingState.viewMode} onChange={updateViewMode}>
            {Object.entries(viewModeLabels).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>

        <label className="toggle-row">
          <span>Expose Rings</span>
          <input
            type="checkbox"
            checked={drawingState.showEpicycles}
            onChange={updateBoolean('showEpicycles')}
            disabled={drawingState.viewMode !== 'epicycle'}
          />
        </label>

        <label className="toggle-row">
          <span>Source Ghost</span>
          <input
            type="checkbox"
            checked={drawingState.showOriginal}
            onChange={updateBoolean('showOriginal')}
            disabled={drawingState.viewMode !== 'originalCompare'}
          />
        </label>
      </ControlSection>

      <ControlSection title="Controlled Failure" label="Controlled failure controls">
        <button type="button" className="panel-action-button break-button" onClick={breakCurve}>
          <Zap size={17} aria-hidden="true" />
          Break Curve
        </button>
        {Object.entries(controlledFailureLabels).map(([key, label]) => {
          const failureKey = key as keyof ControlledFailureSettings;
          const failure = drawingState.controlledFailure[failureKey];

          return (
            <div className="failure-control" key={failureKey}>
              <label className="toggle-row">
                <span>{label}</span>
                <input
                  type="checkbox"
                  checked={failure.enabled}
                  onChange={updateControlledFailureEnabled(failureKey)}
                />
              </label>
              <label className="control-row">
                <span>
                  Amount
                  <strong>{failure.amount}%</strong>
                </span>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={failure.amount}
                  onChange={updateControlledFailureAmount(failureKey)}
                  disabled={!failure.enabled}
                />
              </label>
            </div>
          );
        })}
      </ControlSection>

      <button type="button" className="reset-button" onClick={onReset}>
        <RotateCcw size={17} aria-hidden="true" />
        Reset Path
      </button>
    </aside>
  );
}
