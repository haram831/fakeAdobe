import type { FourierComponent, Point } from '../types';

export type EpicycleOptions = {
  componentCount?: number;
  phaseDistortion?: number;
  amplitudeDistortion?: number;
};

export type Epicycle = {
  center: Point;
  end: Point;
  radius: number;
  angle: number;
  frequency: number;
};

export type PointTransform = (point: Point) => Point;

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

export function calculateEpicycles(
  components: FourierComponent[],
  t: number,
  options: EpicycleOptions = {},
): Epicycle[] {
  assertFourierComponents(components);
  assertFiniteNumber(t, 't');

  if (t < 0 || t > 1) {
    throw new RangeError('t must be between 0 and 1.');
  }

  const phaseDistortion = options.phaseDistortion ?? 0;
  const amplitudeDistortion = options.amplitudeDistortion ?? 0;

  assertFiniteNumber(phaseDistortion, 'phaseDistortion');
  assertFiniteNumber(amplitudeDistortion, 'amplitudeDistortion');

  const amplitudeScale = 1 + amplitudeDistortion / 100;

  if (amplitudeScale < 0) {
    throw new RangeError('amplitudeDistortion cannot reduce amplitudes below zero.');
  }

  const phaseOffset = (phaseDistortion / 100) * Math.PI * 2;
  const epicycles: Epicycle[] = [];
  let currentPoint: Point = { x: 0, y: 0 };

  for (const component of getSelectedComponents(components, options.componentCount)) {
    // Each Fourier component is one rotating vector.
    // The circle is centered at the previous vector's endpoint, its radius is
    // the component amplitude, and the current vector angle follows the inverse
    // Fourier term: phase + 2π * frequency * t.
    const radius = component.amplitude * amplitudeScale;
    const angle = component.phase + phaseOffset + Math.PI * 2 * component.frequency * t;
    const center = currentPoint;
    const end = {
      x: center.x + Math.cos(angle) * radius,
      y: center.y + Math.sin(angle) * radius,
    };

    epicycles.push({
      center,
      end,
      radius,
      angle,
      frequency: component.frequency,
    });

    currentPoint = end;
  }

  return epicycles;
}

export function getEpicycleEndPoint(epicycles: Epicycle[]): Point {
  if (!Array.isArray(epicycles)) {
    throw new TypeError('epicycles must be an array.');
  }

  if (epicycles.length === 0) {
    return { x: 0, y: 0 };
  }

  return { ...epicycles[epicycles.length - 1].end };
}

export function drawEpicycles(
  context: CanvasRenderingContext2D,
  epicycles: Epicycle[],
  transformPoint: PointTransform,
): void {
  context.save();
  context.lineWidth = 1;
  context.shadowBlur = 0;

  for (const epicycle of epicycles) {
    const center = transformPoint(epicycle.center);
    const end = transformPoint(epicycle.end);
    const radiusPoint = transformPoint({
      x: epicycle.center.x + epicycle.radius,
      y: epicycle.center.y,
    });
    const radius = Math.abs(radiusPoint.x - center.x);

    context.strokeStyle = 'rgba(243, 246, 255, 0.18)';
    context.beginPath();
    context.arc(center.x, center.y, radius, 0, Math.PI * 2);
    context.stroke();

    context.strokeStyle = 'rgba(133, 255, 216, 0.28)';
    context.beginPath();
    context.moveTo(center.x, center.y);
    context.lineTo(end.x, end.y);
    context.stroke();
  }

  context.restore();
}
