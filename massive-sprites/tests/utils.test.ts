// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  formatColorRGBA,
  getNextPowerOfTwo,
  getNowMs,
  isPowerOfTwo,
  normalizeFiniteNumber,
  normalizePositiveFinite,
  normalizePositiveNumber,
  parseColorRGBA,
  toDegrees,
  toRadians,
  wrapDegrees,
  wrapRadians,
} from '../src/utils';

describe('utils', () => {
  it('getNowMs returns a finite number', () => {
    const value = getNowMs();

    expect(Number.isFinite(value)).toBe(true);
  });

  it('converts degrees to radians and back', () => {
    const degrees = 180;
    const radians = toRadians(degrees);

    expect(radians).toBeCloseTo(Math.PI, 10);
    expect(toDegrees(radians)).toBeCloseTo(degrees, 10);
  });

  it('wraps radians into the [-pi, pi] range', () => {
    const wrapped = wrapRadians(3 * Math.PI);

    expect(wrapped).toBeCloseTo(-Math.PI, 10);
    expect(wrapped).toBeGreaterThanOrEqual(-Math.PI);
    expect(wrapped).toBeLessThanOrEqual(Math.PI);
  });

  it('wraps degrees into the (-180, 180] range', () => {
    const wrapped = wrapDegrees(270);

    expect(wrapped).toBe(-90);
    expect(wrapped).toBeGreaterThanOrEqual(-180);
    expect(wrapped).toBeLessThanOrEqual(180);
  });

  it('checks powers of two and resolves next power', () => {
    expect(isPowerOfTwo(1)).toBe(true);
    expect(isPowerOfTwo(2)).toBe(true);
    expect(isPowerOfTwo(3)).toBe(false);
    expect(getNextPowerOfTwo(1)).toBe(1);
    expect(getNextPowerOfTwo(2)).toBe(2);
    expect(getNextPowerOfTwo(3)).toBe(4);
    expect(getNextPowerOfTwo(5)).toBe(8);
  });

  it('normalizes positive finite numbers', () => {
    expect(normalizePositiveFinite(2, 5)).toBe(2);
    expect(normalizePositiveFinite(undefined, 5)).toBe(5);
    expect(normalizePositiveFinite(-1, 5)).toBe(5);
    expect(normalizePositiveFinite(Number.NaN, 5)).toBe(5);
  });

  it('normalizes finite numbers with validation', () => {
    expect(normalizeFiniteNumber(1.5, 'Value')).toBe(1.5);
    expect(() => normalizeFiniteNumber(Number.NaN, 'Value')).toThrow(
      'Value must be a finite number.'
    );
  });

  it('normalizes positive numbers with validation', () => {
    expect(normalizePositiveNumber(2, 'Value')).toBe(2);
    expect(() => normalizePositiveNumber(0, 'Value')).toThrow(
      'Value must be a positive finite number.'
    );
  });

  it('parses and formats color RGBA strings', () => {
    const parsed = parseColorRGBA('#ff0000');

    expect(parsed.r).toBeCloseTo(1, 6);
    expect(parsed.g).toBeCloseTo(0, 6);
    expect(parsed.b).toBeCloseTo(0, 6);
    expect(parsed.a).toBeCloseTo(1, 6);

    const formatted = formatColorRGBA(1, 0, 0, 1);
    expect(formatted).toBe('#ff0000ff');

    const roundTrip = parseColorRGBA(formatted);
    expect(roundTrip.a).toBeCloseTo(1, 6);
  });

  it('rejects invalid color strings', () => {
    expect(() => parseColorRGBA('#12345')).toThrow(
      'Color must be in #RRGGBB or #RRGGBBAA format.'
    );
  });
});
