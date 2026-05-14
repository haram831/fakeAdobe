import type { ControlledFailureSettings, FourierComponent, Point } from '../types';

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function getAmount(value: number): number {
  return clamp01(value / 100);
}

function seededNoise(seed: number): number {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

function bipolarNoise(seed: number): number {
  return seededNoise(seed) * 2 - 1;
}

function getComponentSeed(component: FourierComponent, index: number): number {
  return component.frequency * 97.31 + index * 13.17 + 0.618;
}

function getDropoutScale(
  component: FourierComponent,
  index: number,
  settings: ControlledFailureSettings,
): number {
  if (!settings.frequencyDropout.enabled || component.frequency === 0) {
    return 1;
  }

  const amount = getAmount(settings.frequencyDropout.amount);
  const dropoutProbability = amount * 0.45;

  return seededNoise(getComponentSeed(component, index)) < dropoutProbability ? 0 : 1;
}

function getDecayScale(time: number, settings: ControlledFailureSettings): number {
  if (!settings.decay.enabled) {
    return 1;
  }

  const amount = getAmount(settings.decay.amount);
  const decayProgress = Math.pow(clamp01(time), 1.35);

  return Math.max(0.18, 1 - amount * decayProgress * 0.82);
}

function getPhaseDrift(
  component: FourierComponent,
  index: number,
  time: number,
  settings: ControlledFailureSettings,
): number {
  if (!settings.randomPhaseDrift.enabled || component.frequency === 0) {
    return 0;
  }

  const amount = getAmount(settings.randomPhaseDrift.amount);
  const seed = getComponentSeed(component, index);
  const driftDirection = bipolarNoise(seed + 4.2);
  const wobble = Math.sin((time * 2.4 + seededNoise(seed + 8.4)) * Math.PI * 2) * 0.18;

  return (driftDirection + wobble) * amount * Math.PI * 1.15 * clamp01(time);
}

export function distortFourierComponents(
  components: FourierComponent[],
  settings: ControlledFailureSettings,
  time: number,
): FourierComponent[] {
  const decayScale = getDecayScale(time, settings);

  return components.map((component, index) => {
    const amplitude = component.amplitude * decayScale * getDropoutScale(component, index, settings);
    const phase = component.phase + getPhaseDrift(component, index, time, settings);

    return {
      ...component,
      amplitude,
      phase,
      re: Math.cos(phase) * amplitude,
      im: Math.sin(phase) * amplitude,
    };
  });
}

export function applyJitterToPoint(
  point: Point,
  settings: ControlledFailureSettings,
  time: number,
  sampleIndex: number,
): Point {
  if (!settings.jitter.enabled) {
    return point;
  }

  const amount = getAmount(settings.jitter.amount);
  const jitterRadius = amount * 0.035 * Math.max(0.12, clamp01(time));
  const phase = time * Math.PI * 6;
  const xSeed = sampleIndex * 19.19 + 1.7;
  const ySeed = sampleIndex * 23.23 + 2.9;

  return {
    x: point.x + Math.sin(phase + xSeed) * jitterRadius * (0.65 + seededNoise(xSeed) * 0.7),
    y: point.y + Math.cos(phase + ySeed) * jitterRadius * (0.65 + seededNoise(ySeed) * 0.7),
  };
}
