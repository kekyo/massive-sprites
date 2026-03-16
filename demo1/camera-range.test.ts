// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { describe, expect, it } from 'vitest';
import {
  CAMERA_POSITION_RANGE_SCALE,
  resolveCameraPositionRange,
} from './camera-range';

describe('camera range helpers', () => {
  it('expands camera position range by the configured scale', () => {
    const range = resolveCameraPositionRange(100, 200, 300);

    expect(range.minX).toBe(-100 * CAMERA_POSITION_RANGE_SCALE);
    expect(range.maxX).toBe(100 * CAMERA_POSITION_RANGE_SCALE);
    expect(range.minY).toBe(-200 * CAMERA_POSITION_RANGE_SCALE);
    expect(range.maxY).toBe(200 * CAMERA_POSITION_RANGE_SCALE);
  });
});
