// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { describe, expect, it } from 'vitest';

import { buildDemoAutoDirectionUpdate } from './auto-direction';

describe('buildDemoAutoDirectionUpdate', () => {
  it('returns null when auto direction is fully disabled', () => {
    expect(
      buildDemoAutoDirectionUpdate({
        space: 'world',
        mode: 'none',
        shiftAngleRotation: false,
        minDistance: 0,
        flipX: false,
        flipY: false,
        interpolationMode: 'none',
        useFeedforward: false,
        durationMs: 1000,
      })
    ).toBeNull();
  });

  it('clears flipping interpolation when the control is set to none', () => {
    expect(
      buildDemoAutoDirectionUpdate({
        space: 'parent_local',
        mode: 'flipping',
        shiftAngleRotation: false,
        minDistance: 0,
        flipX: true,
        flipY: false,
        interpolationMode: 'none',
        useFeedforward: false,
        durationMs: 1000,
      })
    ).toEqual({
      space: 'parent_local',
      mode: {
        type: 'flipping',
        flipX: true,
        flipY: false,
        interpolation: null,
      },
      shiftAngleRotation: false,
      minDistance: 0,
    });
  });

  it('builds flipping interpolation when a demo easing is selected', () => {
    expect(
      buildDemoAutoDirectionUpdate({
        space: 'world',
        mode: 'flipping',
        shiftAngleRotation: true,
        minDistance: 12,
        flipX: true,
        flipY: true,
        interpolationMode: 'sigmoid',
        useFeedforward: true,
        durationMs: 1000,
      })
    ).toEqual({
      space: 'world',
      mode: {
        type: 'flipping',
        flipX: true,
        flipY: true,
        interpolation: {
          mode: 'feedforward',
          durationMs: 1000,
          easing: { type: 'sigmoid', k: 14, mid: 0.35 },
        },
      },
      shiftAngleRotation: true,
      minDistance: 12,
    });
  });
});
