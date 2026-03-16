// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  CAMERA_FOV_Y_DEG,
  CAMERA_NEAR,
  createRouteCameraAdjustOptions,
} from './camera-reset';

describe('camera reset', () => {
  it('uses the same reset interpolation for pitch, fov, and move', () => {
    const options = createRouteCameraAdjustOptions(16 / 9, {
      width: 1200,
      height: 600,
    });

    expect(options.interpolation).toEqual({
      mode: 'feedback',
      durationMs: 1000,
      easing: {
        type: 'exponential',
      },
    });
    expect(options.pitch).toEqual({
      value: 0,
      interpolation: options.interpolation,
    });
    expect(options.fov).toEqual({
      value: CAMERA_FOV_Y_DEG,
      interpolation: options.interpolation,
    });
    expect(options.near).toBe(CAMERA_NEAR);
    expect(options.far).toBeGreaterThanOrEqual(10000);
  });
});
