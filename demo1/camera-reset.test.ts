// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { describe, expect, it, vi } from 'vitest';

import {
  applyDemoCameraResetValues,
  createAdjustCameraToSpritesOptions,
  createDemoCameraResetValues,
} from './camera-reset';

describe('demo camera reset', () => {
  it('applies reset values to camera controls', () => {
    const controls = {
      yaw: { setValue: vi.fn() },
      pitch: { setValue: vi.fn() },
      roll: { setValue: vi.fn() },
      fov: { setValue: vi.fn() },
    };
    const values = createDemoCameraResetValues(10, 20, 30, 40);

    applyDemoCameraResetValues(controls, values);

    expect(controls.yaw.setValue).toHaveBeenCalledWith(10);
    expect(controls.pitch.setValue).toHaveBeenCalledWith(20);
    expect(controls.roll.setValue).toHaveBeenCalledWith(30);
    expect(controls.fov.setValue).toHaveBeenCalledWith(40);
  });

  it('uses the same interpolation for pitch, fov, and move', () => {
    const interpolation = {
      mode: 'feedback' as const,
      durationMs: 500,
      easing: {
        type: 'sigmoid' as const,
        k: 14,
        mid: 0.35,
      },
    };

    const options = createAdjustCameraToSpritesOptions(
      0,
      45,
      1_000_000,
      interpolation
    );

    expect(options.pitch).toEqual({
      value: 0,
      interpolation,
    });
    expect(options.fov).toEqual({
      value: 45,
      interpolation,
    });
    expect(options.interpolation).toEqual(interpolation);
    expect(options.far).toBe(1_000_000);
  });

  it('omits interpolation when camera interpolation is none', () => {
    const options = createAdjustCameraToSpritesOptions(
      0,
      45,
      1_000_000,
      undefined
    );

    expect(options.pitch).toEqual({ value: 0 });
    expect(options.fov).toEqual({ value: 45 });
    expect(options).not.toHaveProperty('interpolation');
  });
});
