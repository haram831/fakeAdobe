import type { Complex } from '../types';

function assertFiniteComplex(value: Complex, label: string): void {
  if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) {
    throw new TypeError(`${label} must contain finite re and im values.`);
  }
}

function assertFiniteNumber(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label} must be a finite number.`);
  }
}

export function complexAdd(a: Complex, b: Complex): Complex {
  assertFiniteComplex(a, 'a');
  assertFiniteComplex(b, 'b');

  return {
    re: a.re + b.re,
    im: a.im + b.im,
  };
}

export function complexSub(a: Complex, b: Complex): Complex {
  assertFiniteComplex(a, 'a');
  assertFiniteComplex(b, 'b');

  return {
    re: a.re - b.re,
    im: a.im - b.im,
  };
}

export function complexMul(a: Complex, b: Complex): Complex {
  assertFiniteComplex(a, 'a');
  assertFiniteComplex(b, 'b');

  return {
    re: a.re * b.re - a.im * b.im,
    im: a.re * b.im + a.im * b.re,
  };
}

export function complexScale(a: Complex, scalar: number): Complex {
  assertFiniteComplex(a, 'a');
  assertFiniteNumber(scalar, 'scalar');

  return {
    re: a.re * scalar,
    im: a.im * scalar,
  };
}

export function complexExp(theta: number): Complex {
  assertFiniteNumber(theta, 'theta');

  return {
    re: Math.cos(theta),
    im: Math.sin(theta),
  };
}

export function complexMagnitude(c: Complex): number {
  assertFiniteComplex(c, 'c');

  return Math.hypot(c.re, c.im);
}

export function complexPhase(c: Complex): number {
  assertFiniteComplex(c, 'c');

  return Math.atan2(c.im, c.re);
}
