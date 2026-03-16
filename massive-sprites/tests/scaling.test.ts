// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  UNLIMITED_DISTANCE_SCALING_OPTIONS,
  calculateDistanceScaleFactor,
  resolveDistanceScalingOptions,
  resolveDistanceScalingOptionsForWasm,
} from '../src/scaling';

describe('distance scaling', () => {
  it('resolves defaults to unlimited', () => {
    const result = resolveDistanceScalingOptions();

    expect(result.resolved).toEqual(UNLIMITED_DISTANCE_SCALING_OPTIONS);
    expect(result.warnings).toEqual([]);
  });

  it('normalizes invalid distances and records warnings', () => {
    const result = resolveDistanceScalingOptions({
      minScaleDistance: -10,
      maxScaleDistance: 0,
    });

    expect(result.resolved.minScaleDistance).toBe(0);
    expect(result.resolved.maxScaleDistance).toBe(Number.MAX_VALUE);
    expect(result.warnings).toHaveLength(2);
  });

  it('treats positive infinity as unlimited without warnings', () => {
    const result = resolveDistanceScalingOptions({
      maxScaleDistance: Number.POSITIVE_INFINITY,
    });

    expect(result.resolved.maxScaleDistance).toBe(Number.MAX_VALUE);
    expect(result.warnings).toEqual([]);
  });

  it('swaps descending ranges into ascending order', () => {
    const result = resolveDistanceScalingOptions({
      minScaleDistance: 30,
      maxScaleDistance: 10,
    });

    expect(result.resolved.minScaleDistance).toBe(10);
    expect(result.resolved.maxScaleDistance).toBe(30);
    expect(result.warnings).toHaveLength(1);
  });

  it('calculates scale factors for near and far clamps', () => {
    const scaling = {
      minScaleDistance: 20,
      maxScaleDistance: 40,
    } as const;

    expect(calculateDistanceScaleFactor(10, scaling)).toBeCloseTo(0.5, 6);
    expect(calculateDistanceScaleFactor(20, scaling)).toBeCloseTo(1.0, 6);
    expect(calculateDistanceScaleFactor(30, scaling)).toBeCloseTo(1.0, 6);
    expect(calculateDistanceScaleFactor(80, scaling)).toBeCloseTo(2.0, 6);
  });

  it('converts unlimited max distance to finite wasm sentinels', () => {
    expect(
      resolveDistanceScalingOptionsForWasm(
        UNLIMITED_DISTANCE_SCALING_OPTIONS,
        'f32'
      )
    ).toEqual({
      minScaleDistance: 0,
      maxScaleDistance: 3.4028234663852886e38,
    });
    expect(
      resolveDistanceScalingOptionsForWasm(
        UNLIMITED_DISTANCE_SCALING_OPTIONS,
        'f64'
      )
    ).toEqual({
      minScaleDistance: 0,
      maxScaleDistance: Number.MAX_VALUE,
    });
  });
});
