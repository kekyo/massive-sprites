// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type { ObjectInterpolationEasing } from 'massive-sprites';

export type DemoInterpolationType = ObjectInterpolationEasing['type'];

export const DEMO_INTERPOLATION_TYPES = [
  'linear',
  'sigmoid',
  'ease',
  'exponential',
  'quadratic',
  'cubic',
  'sine',
  'bounce',
  'back',
] as const satisfies readonly DemoInterpolationType[];

export const isDemoInterpolationType = (
  value: string
): value is DemoInterpolationType =>
  (DEMO_INTERPOLATION_TYPES as readonly string[]).includes(value);

/**
 * Returns demo easing presets tuned to make each easing characteristic visible.
 */
export const resolveDemoInterpolationEasing = (
  type: DemoInterpolationType
): ObjectInterpolationEasing => {
  switch (type) {
    case 'linear':
      return { type: 'linear' };
    case 'sigmoid':
      return {
        type: 'sigmoid',
        k: 14,
        mid: 0.35,
      };
    case 'ease':
      return {
        type: 'ease',
        power: 9,
        mode: 'out',
      };
    case 'exponential':
      return {
        type: 'exponential',
        exponent: 4,
        mode: 'in',
      };
    case 'quadratic':
      return {
        type: 'quadratic',
        mode: 'out',
      };
    case 'cubic':
      return {
        type: 'cubic',
        mode: 'in',
      };
    case 'sine':
      return {
        type: 'sine',
        mode: 'out',
        amplitude: 1,
      };
    case 'bounce':
      return {
        type: 'bounce',
        bounces: 2,
        decay: 0.1,
      };
    case 'back':
      return {
        type: 'back',
        overshoot: 2,
      };
  }
};
