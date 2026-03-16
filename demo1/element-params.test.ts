// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { describe, expect, it } from 'vitest';
import {
  applyInterpolatedUpdateSpecs,
  applyInterpolatedUpdateSpecsOptional,
  createInterpolatedParameter,
  createUpdateValue,
} from './element-params';

describe('element-params helpers', () => {
  it('creates interpolated parameters without interpolation by default', () => {
    expect(createInterpolatedParameter(12)).toEqual({
      value: 12,
    });
  });

  it('creates update values with optional value payloads', () => {
    const linear = {
      mode: 'feedback' as const,
      durationMs: 500,
      easing: { type: 'linear' as const },
    };
    expect(createUpdateValue(12, undefined)).toEqual({ value: 12 });
    expect(createUpdateValue(12, null)).toEqual({
      value: 12,
      interpolation: null,
    });
    expect(createUpdateValue(undefined, null)).toEqual({
      interpolation: null,
    });
    expect(createUpdateValue(undefined, linear)).toEqual({
      interpolation: linear,
    });
    expect(createUpdateValue(undefined, undefined)).toBe(undefined);
  });

  it('applies multiple interpolated fields to an element update', () => {
    const linear = {
      mode: 'feedback' as const,
      durationMs: 500,
      easing: { type: 'linear' as const },
    };
    expect(
      applyInterpolatedUpdateSpecs(
        {
          imageId: 'curve',
        },
        [
          {
            key: 'shiftDistance',
            value: 64,
            interpolation: linear,
          },
          {
            key: 'shiftAngleDeg',
            value: 120,
          },
        ]
      )
    ).toEqual({
      imageId: 'curve',
      shiftDistance: {
        value: 64,
        interpolation: linear,
      },
      shiftAngleDeg: {
        value: 120,
        interpolation: null,
      },
    });
  });

  it('preserves existing value and interpolation when requested', () => {
    const linear = {
      mode: 'feedback' as const,
      durationMs: 500,
      easing: { type: 'linear' as const },
    };
    expect(
      applyInterpolatedUpdateSpecs(
        {
          imageId: 'curve',
          opacity: {
            value: 0.25,
            interpolation: linear,
          },
        },
        [
          {
            key: 'opacity',
            value: 1,
            preserveExistingValue: true,
            preserveExistingInterpolation: true,
          },
        ]
      )
    ).toEqual({
      imageId: 'curve',
      opacity: {
        value: 0.25,
      },
    });
  });

  it('supports optional updates while preserving nullish inputs', () => {
    expect(
      applyInterpolatedUpdateSpecsOptional(undefined, [
        {
          key: 'rotation',
          value: 0,
        },
      ])
    ).toBe(undefined);
    expect(
      applyInterpolatedUpdateSpecsOptional(null, [
        {
          key: 'rotation',
          value: 0,
        },
      ])
    ).toBe(null);
    expect(
      applyInterpolatedUpdateSpecsOptional(
        {
          imageId: 'curve',
        },
        [
          {
            key: 'rotation',
            value: 0,
          },
        ]
      )
    ).toEqual({
      imageId: 'curve',
      rotation: {
        value: 0,
        interpolation: null,
      },
    });
  });
});
