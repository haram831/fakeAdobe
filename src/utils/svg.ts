import type { Point } from '../types';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

function parseSvg(svgText: string): Document {
  const document = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const parserError = document.querySelector('parsererror');

  if (parserError) {
    throw new Error('Invalid SVG file.');
  }

  return document;
}

function getSampleTime(index: number, sampleCount: number): number {
  return sampleCount === 1 ? 0 : index / (sampleCount - 1);
}

function samplePathData(pathData: string, sampleCount: number): Point[] {
  const svg = window.document.createElementNS(SVG_NAMESPACE, 'svg');
  const path = window.document.createElementNS(SVG_NAMESPACE, 'path');

  path.setAttribute('d', pathData);
  svg.style.position = 'absolute';
  svg.style.width = '0';
  svg.style.height = '0';
  svg.style.overflow = 'hidden';
  svg.appendChild(path);
  window.document.body.appendChild(svg);

  try {
    const length = path.getTotalLength();

    if (!Number.isFinite(length) || length <= 0) {
      throw new Error('SVG path has no drawable length.');
    }

    return Array.from({ length: sampleCount }, (_, index) => {
      const point = path.getPointAtLength(length * getSampleTime(index, sampleCount));
      return { x: point.x, y: point.y };
    });
  } finally {
    svg.remove();
  }
}

function parsePolylinePoints(pointsValue: string): Point[] {
  const values = pointsValue
    .trim()
    .split(/[\s,]+/)
    .map((value) => Number(value));

  if (values.length < 4 || values.length % 2 !== 0 || values.some((value) => !Number.isFinite(value))) {
    throw new Error('SVG polyline points are invalid.');
  }

  const points: Point[] = [];

  for (let index = 0; index < values.length; index += 2) {
    points.push({ x: values[index], y: values[index + 1] });
  }

  return points;
}

function samplePolyline(points: Point[], sampleCount: number): Point[] {
  if (points.length < 2) {
    throw new Error('SVG polyline needs at least two points.');
  }

  const polyline = window.document.createElementNS(SVG_NAMESPACE, 'polyline');
  polyline.setAttribute('points', points.map((point) => `${point.x},${point.y}`).join(' '));

  const svg = window.document.createElementNS(SVG_NAMESPACE, 'svg');
  svg.style.position = 'absolute';
  svg.style.width = '0';
  svg.style.height = '0';
  svg.style.overflow = 'hidden';
  svg.appendChild(polyline);
  window.document.body.appendChild(svg);

  try {
    const length = polyline.getTotalLength();

    if (!Number.isFinite(length) || length <= 0) {
      throw new Error('SVG polyline has no drawable length.');
    }

    return Array.from({ length: sampleCount }, (_, index) => {
      const point = polyline.getPointAtLength(length * getSampleTime(index, sampleCount));
      return { x: point.x, y: point.y };
    });
  } finally {
    svg.remove();
  }
}

export function sampleFirstSvgPath(svgText: string, sampleCount: number): Point[] {
  if (!Number.isInteger(sampleCount) || sampleCount < 2) {
    throw new Error('SVG sample count must be at least 2.');
  }

  const svgDocument = parseSvg(svgText);
  const path = svgDocument.querySelector('path');

  if (path) {
    const pathData = path.getAttribute('d');

    if (!pathData) {
      throw new Error('First SVG path has no path data.');
    }

    return samplePathData(pathData, sampleCount);
  }

  const polyline = svgDocument.querySelector('polyline');

  if (polyline) {
    const pointsValue = polyline.getAttribute('points');

    if (!pointsValue) {
      throw new Error('First SVG polyline has no points.');
    }

    return samplePolyline(parsePolylinePoints(pointsValue), sampleCount);
  }

  throw new Error('No path or polyline found in SVG.');
}
