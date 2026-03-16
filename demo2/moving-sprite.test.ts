// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it } from 'vitest';

import { buildMovingSpritePlacement } from './moving-sprite';

describe('moving sprite placement', () => {
  it('shrinks car and label sprites together', () => {
    const placement = buildMovingSpritePlacement(
      {
        carLabel: 'Car-0',
        imageId: 'car.png',
        labelId: 'label-Car-0',
        labelColor: '#ffffff',
      },
      1,
      100,
      200
    );

    expect(placement.sx).toEqual({ value: 100 });
    expect(placement.sy).toEqual({ value: 200 });
    expect(placement.elements[0]).toMatchObject({
      imageId: 'car.png',
      scale: { value: 0.1 },
      autoDirection: {
        space: 'world',
        mode: {
          type: 'flipping',
          flipX: true,
          flipY: false,
          interpolation: {
            mode: 'feedback',
            durationMs: 500,
            easing: { type: 'sigmoid', k: 14, mid: 0.35 },
          },
        },
        minDistance: 0,
      },
    });
    expect(placement.elements[1]).toMatchObject({
      imageId: 'label-Car-0',
      scale: { value: 0.1 },
      shiftDistance: { value: 30 },
      autoDirection: {
        space: 'world',
        shiftAngleRotation: true,
        minDistance: 0,
      },
      leaderline: {
        width: { value: 1 },
        color: '#ffffff',
      },
    });
  });
});
