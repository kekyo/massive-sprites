// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { describe, expect, it } from 'vitest';
import {
  DEMO_INTERPOLATION_TYPES,
  isDemoInterpolationType,
  resolveDemoInterpolationEasing,
} from './interpolation-easing';

describe('interpolation-easing presets', () => {
  it('provides all supported interpolation types', () => {
    expect(DEMO_INTERPOLATION_TYPES).toEqual([
      'linear',
      'sigmoid',
      'ease',
      'exponential',
      'quadratic',
      'cubic',
      'sine',
      'bounce',
      'back',
    ]);
  });

  it('checks interpolation type guards', () => {
    expect(isDemoInterpolationType('linear')).toBe(true);
    expect(isDemoInterpolationType('bounce')).toBe(true);
    expect(isDemoInterpolationType('unknown')).toBe(false);
    expect(isDemoInterpolationType('none')).toBe(false);
  });

  it('resolves characteristic parameter presets', () => {
    expect(resolveDemoInterpolationEasing('linear')).toEqual({
      type: 'linear',
    });
    expect(resolveDemoInterpolationEasing('sigmoid')).toEqual({
      type: 'sigmoid',
      k: 14,
      mid: 0.35,
    });
    expect(resolveDemoInterpolationEasing('ease')).toEqual({
      type: 'ease',
      power: 9,
      mode: 'out',
    });
    expect(resolveDemoInterpolationEasing('exponential')).toEqual({
      type: 'exponential',
      exponent: 4,
      mode: 'in',
    });
    expect(resolveDemoInterpolationEasing('quadratic')).toEqual({
      type: 'quadratic',
      mode: 'out',
    });
    expect(resolveDemoInterpolationEasing('cubic')).toEqual({
      type: 'cubic',
      mode: 'in',
    });
    expect(resolveDemoInterpolationEasing('sine')).toEqual({
      type: 'sine',
      mode: 'out',
      amplitude: 1,
    });
    expect(resolveDemoInterpolationEasing('bounce')).toEqual({
      type: 'bounce',
      bounces: 2,
      decay: 0.1,
    });
    expect(resolveDemoInterpolationEasing('back')).toEqual({
      type: 'back',
      overshoot: 2,
    });
  });
});
