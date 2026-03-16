// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  createCameraTrackingUpdate,
  hasMaterialCameraTrackingUpdate,
  normalizeCameraTrackingOptions,
  resolveCameraTrackingSolution,
  resolveCameraTrackingWheelZoomFactor,
} from '../src/camera-tracking';
import type { ObjectCameraState } from '../src/types';

const createCameraState = (
  overrides: Partial<ObjectCameraState> | undefined = undefined
): ObjectCameraState => ({
  position: {
    x: { value: 0, interpolation: undefined },
    y: { value: 0, interpolation: undefined },
    z: { value: 10, interpolation: undefined },
  },
  rotation: {
    yaw: { value: 0, interpolation: undefined },
    pitch: { value: 0, interpolation: undefined },
    roll: { value: 0, interpolation: undefined },
  },
  fovY: { value: 45, interpolation: undefined },
  near: 0.1,
  far: 1000,
  aspectRatio: 1,
  ...(overrides ?? {}),
});

describe('camera tracking core', () => {
  it('normalizes single-target tracking options', () => {
    const tracking = normalizeCameraTrackingOptions({
      spriteIds: [3],
      minDistance: 12,
      interpolation: null,
    });
    expect(tracking.mode).toBe('single');
    expect(tracking.targetMode).toBe('base');
    expect(tracking.minDistance).toBeCloseTo(12);
    expect(tracking.fitPadding).toBeCloseTo(1.1);
    expect(tracking.fitZoomBias).toBeCloseTo(1);
    expect(tracking.resolvedDistance).toBeUndefined();
  });

  it('normalizes contentApprox tracking options', () => {
    const tracking = normalizeCameraTrackingOptions({
      spriteIds: [3, 4],
      targetMode: 'contentApprox',
      fitPadding: 1.4,
      fitZoomBias: 1.2,
    });
    expect(tracking.mode).toBe('fit');
    expect(tracking.targetMode).toBe('contentApprox');
    expect(tracking.fitPadding).toBeCloseTo(1.4);
    expect(tracking.fitZoomBias).toBeCloseTo(1.2);
  });

  it('resolves fixed-distance tracking for a single target', () => {
    const cameraState = createCameraState();
    const tracking = normalizeCameraTrackingOptions({
      spriteIds: [0],
      distance: 10,
      interpolation: null,
    });
    const solution = resolveCameraTrackingSolution(cameraState, tracking, [
      { x: 5, y: 7, z: 0 },
    ]);
    if (!solution) {
      throw new Error('Expected tracking solution.');
    }
    expect(solution.center).toEqual({ x: 5, y: 7, z: 0 });
    expect(solution.distance).toBeCloseTo(10, 6);

    const update = createCameraTrackingUpdate(cameraState, solution, null);
    expect(update.position?.x?.value).toBeCloseTo(5, 6);
    expect(update.position?.y?.value).toBeCloseTo(7, 6);
    expect(update.position?.z?.value).toBeCloseTo(10, 6);
  });

  it('clamps single-target tracking by minDistance', () => {
    const cameraState = createCameraState({
      position: {
        x: { value: 0, interpolation: undefined },
        y: { value: 0, interpolation: undefined },
        z: { value: 3, interpolation: undefined },
      },
    });
    const tracking = normalizeCameraTrackingOptions({
      spriteIds: [0],
      minDistance: 10,
      interpolation: null,
    });
    const solution = resolveCameraTrackingSolution(cameraState, tracking, [
      { x: 0, y: 0, z: 0 },
    ]);
    if (!solution) {
      throw new Error('Expected tracking solution.');
    }
    expect(solution.baseDistance).toBeCloseTo(3, 6);
    expect(solution.distance).toBeCloseTo(10, 6);
  });

  it('fits multiple targets in camera-local space', () => {
    const cameraState = createCameraState({
      position: {
        x: { value: 0, interpolation: undefined },
        y: { value: 0, interpolation: undefined },
        z: { value: 5, interpolation: undefined },
      },
      fovY: { value: 90, interpolation: undefined },
    });
    const tracking = normalizeCameraTrackingOptions({
      spriteIds: [0, 1],
      fitPadding: 1,
      fitZoomBias: 1,
    });
    const solution = resolveCameraTrackingSolution(cameraState, tracking, [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]);
    if (!solution) {
      throw new Error('Expected tracking solution.');
    }
    expect(solution.center.x).toBeCloseTo(0, 6);
    expect(solution.center.y).toBeCloseTo(0, 6);
    expect(solution.center.z).toBeCloseTo(0, 6);
    expect(solution.distance).toBeCloseTo(1, 6);

    const update = createCameraTrackingUpdate(cameraState, solution, null);
    expect(update.position?.x?.value).toBeCloseTo(0, 6);
    expect(update.position?.y?.value).toBeCloseTo(0, 6);
    expect(update.position?.z?.value).toBeCloseTo(1, 6);
  });

  it('clamps fit tracking by minDistance', () => {
    const cameraState = createCameraState({
      position: {
        x: { value: 0, interpolation: undefined },
        y: { value: 0, interpolation: undefined },
        z: { value: 20, interpolation: undefined },
      },
      fovY: { value: 90, interpolation: undefined },
    });
    const tracking = normalizeCameraTrackingOptions({
      spriteIds: [0, 1],
      minDistance: 15,
      fitPadding: 1,
      fitZoomBias: 1,
    });
    const solution = resolveCameraTrackingSolution(cameraState, tracking, [
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
    ]);
    if (!solution) {
      throw new Error('Expected tracking solution.');
    }
    expect(solution.baseDistance).toBeCloseTo(1, 6);
    expect(solution.distance).toBeCloseTo(15, 6);
  });

  it('detects material tracking updates', () => {
    const cameraState = createCameraState();
    expect(
      hasMaterialCameraTrackingUpdate(cameraState, {
        position: {
          x: { value: 0 },
          y: { value: 0 },
          z: { value: 10 },
        },
      })
    ).toBe(false);
    expect(
      hasMaterialCameraTrackingUpdate(cameraState, {
        position: {
          x: { value: 1 },
        },
      })
    ).toBe(true);
  });

  it('ignores repeated targets while the camera is already interpolating toward them', () => {
    const cameraState = createCameraState({
      position: {
        x: {
          value: 0,
          interpolation: {
            mode: 'feedback',
            durationMs: 40,
            easing: { type: 'linear' },
            fromValue: 0,
            toValue: 5,
          },
        },
        y: {
          value: 0,
          interpolation: {
            mode: 'feedback',
            durationMs: 40,
            easing: { type: 'linear' },
            fromValue: 0,
            toValue: 6,
          },
        },
        z: {
          value: 10,
          interpolation: {
            mode: 'feedback',
            durationMs: 40,
            easing: { type: 'linear' },
            fromValue: 10,
            toValue: 15,
          },
        },
      },
    });
    expect(
      hasMaterialCameraTrackingUpdate(cameraState, {
        position: {
          x: { value: 5 },
          y: { value: 6 },
          z: { value: 15 },
        },
      })
    ).toBe(false);
  });

  it('resolves wheel zoom factors multiplicatively', () => {
    expect(resolveCameraTrackingWheelZoomFactor(120, 45, 240)).toBeGreaterThan(
      1
    );
    expect(resolveCameraTrackingWheelZoomFactor(-120, 45, 240)).toBeLessThan(1);
    expect(resolveCameraTrackingWheelZoomFactor(0, 45, 240)).toBeCloseTo(1, 6);
  });
});
