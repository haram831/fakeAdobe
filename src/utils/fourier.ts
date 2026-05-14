import type { FourierComponent, Point } from '../types';
import { complexAdd, complexExp, complexMagnitude, complexMul, complexScale } from './complex';

export type ReconstructOptions = {
  componentCount?: number;
  phaseDistortion?: number;
  amplitudeDistortion?: number;
  isClosed?: boolean;
};

function assertFinitePoint(point: Point, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`${label} must contain finite x and y values.`);
  }
}

function assertPointArray(points: Point[]): void {
  if (!Array.isArray(points)) {
    throw new TypeError('points must be an array.');
  }

  points.forEach((point, index) => assertFinitePoint(point, `points[${index}]`));
}

function assertFourierComponent(component: FourierComponent, label: string): void {
  if (
    !Number.isFinite(component.frequency) ||
    !Number.isFinite(component.amplitude) ||
    !Number.isFinite(component.phase) ||
    !Number.isFinite(component.re) ||
    !Number.isFinite(component.im)
  ) {
    throw new TypeError(`${label} must contain finite Fourier component values.`);
  }
}

function assertFourierComponents(components: FourierComponent[]): void {
  if (!Array.isArray(components)) {
    throw new TypeError('components must be an array.');
  }

  components.forEach((component, index) => {
    assertFourierComponent(component, `components[${index}]`);
  });
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

function getSelectedComponents(
  components: FourierComponent[],
  componentCount: number | undefined,
): FourierComponent[] {
  if (componentCount === undefined) {
    return components;
  }

  if (!Number.isInteger(componentCount) || componentCount < 0) {
    throw new RangeError('componentCount must be a non-negative integer.');
  }

  return components.slice(0, componentCount);
}

export function dft(points: Point[]): FourierComponent[] {
  assertPointArray(points);

  const sampleCount = points.length;

  if (sampleCount === 0) {
    return [];
  }

  const components: FourierComponent[] = [];

  for (let k = 0; k < sampleCount; k += 1) {
    let sum = { re: 0, im: 0 };

    for (let n = 0; n < sampleCount; n += 1) {
      // Treat each drawing sample as a complex number z_n = x_n + i y_n.
      const sample = { re: points[n].x, im: points[n].y };

      // DFT coefficient:
      //   X_k = (1 / N) * sum(z_n * e^(-i * 2πkn / N))
      // The negative sign extracts how strongly frequency k appears in the input path.
      const angle = (-2 * Math.PI * k * n) / sampleCount;
      sum = complexAdd(sum, complexMul(sample, complexExp(angle)));
    }

    const coefficient = complexScale(sum, 1 / sampleCount);

    // Frequencies above N / 2 represent negative rotations in the inverse transform.
    // Example: for N = 8, k = 7 is frequency -1.
    const frequency = k <= sampleCount / 2 ? k : k - sampleCount;

    components.push({
      frequency,
      amplitude: complexMagnitude(coefficient),
      phase: Math.atan2(coefficient.im, coefficient.re),
      re: coefficient.re,
      im: coefficient.im,
    });
  }

  return components;
}

export function sortFourierComponents(components: FourierComponent[]): FourierComponent[] {
  assertFourierComponents(components);

  return [...components].sort((a, b) => b.amplitude - a.amplitude);
}

export function reconstructPoint(
  components: FourierComponent[],
  t: number,
  options: ReconstructOptions = {},
): Point {
  assertFourierComponents(components);
  assertFiniteNumber(t, 't');

  if (t < 0 || t > 1) {
    throw new RangeError('t must be between 0 and 1.');
  }

  const phaseDistortion = options.phaseDistortion ?? 0;
  const amplitudeDistortion = options.amplitudeDistortion ?? 0;

  assertFiniteNumber(phaseDistortion, 'phaseDistortion');
  assertFiniteNumber(amplitudeDistortion, 'amplitudeDistortion');

  // Distortion values are interpreted as percentages because the UI exposes them as 0-100.
  // phaseDistortion = 100 adds one full turn to each component's phase.
  // amplitudeDistortion = 100 doubles each component's amplitude.
  const phaseOffset = (phaseDistortion / 100) * Math.PI * 2;
  const amplitudeScale = 1 + amplitudeDistortion / 100;

  if (amplitudeScale < 0) {
    throw new RangeError('amplitudeDistortion cannot reduce amplitudes below zero.');
  }

  let sum = { re: 0, im: 0 };
  const selectedComponents = getSelectedComponents(components, options.componentCount);

  for (const component of selectedComponents) {
    // Inverse DFT term:
    //   z(t) += X_k * e^(i * 2πf_k t)
    // The stored coefficient X_k is rebuilt from amplitude and phase so optional
    // distortions can be applied without mutating the component itself.
    const amplitude = component.amplitude * amplitudeScale;
    const phase = component.phase + phaseOffset;
    const rotationAngle = Math.PI * 2 * component.frequency * t + phase;
    const contribution = complexScale(complexExp(rotationAngle), amplitude);

    sum = complexAdd(sum, contribution);
  }

  return {
    x: sum.re,
    y: sum.im,
  };
}

export function reconstructPath(
  components: FourierComponent[],
  sampleCount: number,
  options: ReconstructOptions = {},
): Point[] {
  assertFourierComponents(components);

  if (!Number.isInteger(sampleCount) || sampleCount <= 0) {
    throw new RangeError('sampleCount must be a positive integer.');
  }

  if (sampleCount === 1) {
    return [reconstructPoint(components, 0, options)];
  }

  return Array.from({ length: sampleCount }, (_, index) => {
    // Closed paths include t = 1 so the curve returns to its start point.
    // Open paths stop at (N - 1) / N, matching the last original DFT sample.
    const t = options.isClosed === false ? index / sampleCount : index / (sampleCount - 1);
    return reconstructPoint(components, t, options);
  });
}
