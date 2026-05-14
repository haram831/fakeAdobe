import type { FourierComponent } from '../types';

type FrequencySpectrumProps = {
  components: FourierComponent[];
  frequencyCount: number;
  onComponentToggle?: (componentIndex: number) => void;
};

export function FrequencySpectrum({
  components,
  frequencyCount,
  onComponentToggle,
}: FrequencySpectrumProps) {
  const maxAmplitude = components.reduce(
    (maxValue, component) => Math.max(maxValue, component.amplitude),
    0,
  );
  const activeCount = Math.min(frequencyCount, components.length);

  return (
    <section className="frequency-spectrum" aria-label="Frequency spectrum">
      <header className="spectrum-header">
        <div>
          <p className="panel-kicker">Spectrum</p>
          <h2>Frequency Amplitude</h2>
        </div>
        <span>
          {activeCount}/{components.length || 0} active
        </span>
      </header>

      <div className="spectrum-plot" role="list" aria-label="Fourier component amplitudes">
        {components.length === 0 ? (
          <p className="spectrum-empty">Draw a line to generate frequency components.</p>
        ) : (
          components.map((component, index) => {
            const isActive = index < activeCount;
            const height = maxAmplitude === 0 ? 0 : (component.amplitude / maxAmplitude) * 100;

            return (
              <button
                type="button"
                key={`${component.frequency}-${index}`}
                className={`spectrum-bar ${isActive ? 'is-active' : 'is-muted'}`}
                style={{ height: `${Math.max(3, height)}%` }}
                aria-label={`Component ${index}, frequency ${component.frequency}, amplitude ${component.amplitude.toFixed(
                  3,
                )}, ${isActive ? 'active' : 'excluded'}`}
                aria-pressed={isActive}
                onClick={() => onComponentToggle?.(index)}
                role="listitem"
              >
                <span className="spectrum-bar-value">{component.amplitude.toFixed(2)}</span>
              </button>
            );
          })
        )}
      </div>
    </section>
  );
}
