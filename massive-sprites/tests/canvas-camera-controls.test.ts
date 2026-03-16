// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  accumulateCameraControl,
  applyCameraControl,
  clampCameraPitch,
  clampCameraValue,
  resolveCameraDragDelta,
  resolveCameraControlInterpolation,
  resolvePanWorldVelocity,
  resolveWheelTargetPosition,
  resolveWheelInterpolationDuration,
} from '../src/canvas-camera-controls';

describe('canvas camera controls', () => {
  it('accumulates movement based on start delta', () => {
    const accumulated = accumulateCameraControl(
      { x: 0, y: 0 },
      10,
      -5,
      2,
      500,
      true
    );
    expect(accumulated).toEqual({ x: 10, y: 5 });

    const next = applyCameraControl({ x: 100, y: 200 }, accumulated);
    expect(next).toEqual({ x: 110, y: 205 });
  });

  it('keeps accumulation when delta time is zero', () => {
    const accumulated = accumulateCameraControl(
      { x: 3, y: -4 },
      8,
      6,
      1,
      0,
      true
    );
    expect(accumulated).toEqual({ x: 3, y: -4 });
  });

  it('clamps pitch to [0, 89]', () => {
    expect(clampCameraPitch(120, undefined, undefined)).toBe(89);
    expect(clampCameraPitch(-120, undefined, undefined)).toBe(0);
    expect(clampCameraPitch(45, undefined, undefined)).toBe(45);
  });

  it('clamps values with optional bounds', () => {
    expect(clampCameraValue(5, undefined, undefined)).toBe(5);
    expect(clampCameraValue(5, 10, undefined)).toBe(10);
    expect(clampCameraValue(5, undefined, 4)).toBe(4);
    expect(clampCameraValue(5, 10, 0)).toBe(5);
  });

  it('maps drag distance to rotation delta', () => {
    const delta = resolveCameraDragDelta(20, -10, 0.5, false);
    const next = applyCameraControl({ x: 10, y: 20 }, delta);
    expect(delta).toEqual({ x: 10, y: -5 });
    expect(next).toEqual({ x: 20, y: 15 });
  });

  it('maps screen drag velocity to world velocity', () => {
    const velocity = resolvePanWorldVelocity(
      10,
      5,
      { x: 2, y: 0 },
      { x: 0, y: -3 },
      0.5,
      false,
      false
    );
    expect(velocity).toEqual({ x: 10, y: -7.5 });
  });

  it('resolves wheel target position on the focus ray', () => {
    const target = resolveWheelTargetPosition(
      { x: 10, y: -5, z: 2 },
      { x: 0, y: 0, z: 1 },
      4
    );
    expect(target).toEqual({ x: 10, y: -5, z: -2 });
  });

  it('resolves wheel interpolation duration from polling interval', () => {
    expect(resolveWheelInterpolationDuration(200)).toBe(200);
    expect(resolveWheelInterpolationDuration(0)).toBe(1);
    expect(resolveWheelInterpolationDuration(Number.NaN)).toBe(1);
  });

  it('overrides interpolation duration for camera control', () => {
    expect(resolveCameraControlInterpolation(null, 10)).toBeNull();
    const interpolation = {
      mode: 'feedback' as const,
      durationMs: 500,
      easing: { type: 'linear' as const },
    };
    expect(resolveCameraControlInterpolation(interpolation, 16)).toEqual({
      mode: 'feedback',
      durationMs: 16,
      easing: { type: 'linear' },
    });
  });
});
