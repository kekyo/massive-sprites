// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  buildHueShiftOffsets,
  formatRgbHex,
  shiftImageDataHueOklch,
  shiftRgbHueOklch,
} from './color-shift';

const expectChannelClose = (actual: number, expected: number) => {
  const delta = Math.abs(actual - expected);
  expect(delta).toBeLessThanOrEqual(2);
};

describe('color-shift', () => {
  it('builds evenly spaced hue offsets', () => {
    const offsets = buildHueShiftOffsets(20);
    expect(offsets).toHaveLength(20);
    const step = 360 / 20;
    offsets.forEach((offset, index) => {
      expect(offset).toBeCloseTo(step * index, 6);
    });
  });

  it('keeps rgb within tolerance when shifting by full circle', () => {
    const input = { r: 200, g: 50, b: 25 };
    const shifted = shiftRgbHueOklch(input, 360);
    expectChannelClose(shifted.r, input.r);
    expectChannelClose(shifted.g, input.g);
    expectChannelClose(shifted.b, input.b);
  });

  it('formats rgb hex values', () => {
    expect(formatRgbHex({ r: 255, g: 0, b: 16 })).toBe('#ff0010');
  });

  it('preserves transparent pixels and shifts opaque ones', () => {
    const data = new Uint8ClampedArray([255, 0, 0, 255, 10, 20, 30, 0]);
    const shifted = shiftImageDataHueOklch(data, 120);
    expect(shifted).toHaveLength(data.length);
    expect(shifted[7]).toBe(0);
    expect(shifted[4]).toBe(10);
    expect(shifted[5]).toBe(20);
    expect(shifted[6]).toBe(30);
    const changed =
      shifted[0] !== data[0] ||
      shifted[1] !== data[1] ||
      shifted[2] !== data[2];
    expect(changed).toBe(true);
  });
});
