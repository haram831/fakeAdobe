import type { Point } from '../types';

function assertFinitePoint(point: Point, label: string): void {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    throw new TypeError(`${label} must contain finite x and y values.`);
  }
}

function assertPointArray(points: Point[]): void {
  if (!Array.isArray(points)) {
    throw new TypeError('points must be an array.');
  }

  points.forEach((point, index) => {
    assertFinitePoint(point, `points[${index}]`);
  });
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${label} must be a positive integer.`);
  }
}

function clonePoint(point: Point): Point {
  return { x: point.x, y: point.y };
}

function interpolatePoint(start: Point, end: Point, ratio: number): Point {
  return {
    x: start.x + (end.x - start.x) * ratio,
    y: start.y + (end.y - start.y) * ratio,
  };
}

export function getDistance(p1: Point, p2: Point): number {
  assertFinitePoint(p1, 'p1');
  assertFinitePoint(p2, 'p2');

  return Math.hypot(p2.x - p1.x, p2.y - p1.y);
}

export function getPathLength(points: Point[]): number {
  assertPointArray(points);

  if (points.length < 2) {
    return 0;
  }

  return points.reduce((total, point, index) => {
    if (index === 0) {
      return total;
    }

    return total + getDistance(points[index - 1], point);
  }, 0);
}

export function isClosedPath(points: Point[]): boolean {
  assertPointArray(points);

  if (points.length < 2) {
    return false;
  }

  const pathLength = getPathLength(points);
  const endpointDistance = getDistance(points[0], points[points.length - 1]);
  const lengthBasedThreshold = pathLength * 0.035;
  const threshold = Math.max(10, Math.min(42, lengthBasedThreshold));

  return endpointDistance <= threshold;
}

export function resamplePoints(points: Point[], targetCount: number): Point[] {
  assertPointArray(points);
  assertPositiveInteger(targetCount, 'targetCount');

  if (points.length === 0) {
    return [];
  }

  if (targetCount === 1) {
    return [clonePoint(points[0])];
  }

  if (points.length === 1) {
    return Array.from({ length: targetCount }, () => clonePoint(points[0]));
  }

  const cumulativeDistances = [0];

  for (let index = 1; index < points.length; index += 1) {
    cumulativeDistances[index] =
      cumulativeDistances[index - 1] + getDistance(points[index - 1], points[index]);
  }

  const totalDistance = cumulativeDistances[cumulativeDistances.length - 1];

  if (totalDistance === 0) {
    return Array.from({ length: targetCount }, () => clonePoint(points[0]));
  }

  const interval = totalDistance / (targetCount - 1);
  const resampledPoints: Point[] = [];
  let segmentIndex = 1;

  for (let index = 0; index < targetCount; index += 1) {
    const targetDistance = index === targetCount - 1 ? totalDistance : interval * index;

    while (
      segmentIndex < cumulativeDistances.length - 1 &&
      cumulativeDistances[segmentIndex] < targetDistance
    ) {
      segmentIndex += 1;
    }

    const segmentStartDistance = cumulativeDistances[segmentIndex - 1];
    const segmentEndDistance = cumulativeDistances[segmentIndex];
    const segmentLength = segmentEndDistance - segmentStartDistance;

    if (segmentLength === 0) {
      resampledPoints.push(clonePoint(points[segmentIndex]));
      continue;
    }

    const ratio = (targetDistance - segmentStartDistance) / segmentLength;
    resampledPoints.push(interpolatePoint(points[segmentIndex - 1], points[segmentIndex], ratio));
  }

  return resampledPoints;
}

export function centerPoints(points: Point[]): Point[] {
  assertPointArray(points);

  if (points.length === 0) {
    return [];
  }

  const center = points.reduce(
    (sum, point) => ({
      x: sum.x + point.x,
      y: sum.y + point.y,
    }),
    { x: 0, y: 0 },
  );

  const inverseLength = 1 / points.length;
  const centerX = center.x * inverseLength;
  const centerY = center.y * inverseLength;

  return points.map((point) => ({
    x: point.x - centerX,
    y: point.y - centerY,
  }));
}

export function normalizePoints(points: Point[], scale: number): Point[] {
  assertPointArray(points);

  if (!Number.isFinite(scale) || scale <= 0) {
    throw new RangeError('scale must be a positive finite number.');
  }

  if (points.length === 0) {
    return [];
  }

  const maxDistanceFromOrigin = points.reduce(
    (maxDistance, point) => Math.max(maxDistance, Math.hypot(point.x, point.y)),
    0,
  );

  if (maxDistanceFromOrigin === 0) {
    return points.map(clonePoint);
  }

  const scaleFactor = scale / maxDistanceFromOrigin;

  return points.map((point) => ({
    x: point.x * scaleFactor,
    y: point.y * scaleFactor,
  }));
}

export function preparePointsForFourier(points: Point[], targetCount: number): Point[] {
  return normalizePoints(centerPoints(resamplePoints(points, targetCount)), 1);
}

export function preparePointGroupsForFourier(pointGroups: Point[][], targetCount: number): Point[][] {
  const resampledGroups = pointGroups.map((points) => resamplePoints(points, targetCount));
  const allPoints = resampledGroups.flat();

  assertPointArray(allPoints);

  if (allPoints.length === 0) {
    return resampledGroups;
  }

  const bounds = allPoints.reduce(
    (currentBounds, point) => ({
      minX: Math.min(currentBounds.minX, point.x),
      minY: Math.min(currentBounds.minY, point.y),
      maxX: Math.max(currentBounds.maxX, point.x),
      maxY: Math.max(currentBounds.maxY, point.y),
    }),
    {
      minX: Number.POSITIVE_INFINITY,
      minY: Number.POSITIVE_INFINITY,
      maxX: Number.NEGATIVE_INFINITY,
      maxY: Number.NEGATIVE_INFINITY,
    },
  );
  const center = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
  const maxDistanceFromOrigin = allPoints.reduce(
    (maxDistance, point) => Math.max(maxDistance, Math.hypot(point.x - center.x, point.y - center.y)),
    0,
  );

  if (maxDistanceFromOrigin === 0) {
    return resampledGroups.map((points) => points.map(clonePoint));
  }

  const scaleFactor = 1 / maxDistanceFromOrigin;

  return resampledGroups.map((points) =>
    points.map((point) => ({
      x: (point.x - center.x) * scaleFactor,
      y: (point.y - center.y) * scaleFactor,
    })),
  );
}
