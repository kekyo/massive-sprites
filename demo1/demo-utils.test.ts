// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { describe, expect, it } from 'vitest';

import {
  forEachReverse,
  resolveCameraFar,
  shouldApplyCameraUpdateFromSlider,
  shouldSyncCameraSlidersFromEvent,
} from './demo-utils';

describe('forEachReverse', () => {
  it('iterates items in reverse order', () => {
    const received: number[] = [];
    forEachReverse([1, 2, 3], (value) => {
      received.push(value);
    });
    expect(received).toEqual([3, 2, 1]);
  });

  it('handles empty arrays', () => {
    const received: number[] = [];
    forEachReverse([], (value) => {
      received.push(value);
    });
    expect(received).toEqual([]);
  });
});

describe('shouldSyncCameraSlidersFromEvent', () => {
  it('returns true for interaction source', () => {
    expect(shouldSyncCameraSlidersFromEvent('interaction')).toBe(true);
  });

  it('returns false for external source', () => {
    expect(shouldSyncCameraSlidersFromEvent('external')).toBe(false);
  });
});

describe('shouldApplyCameraUpdateFromSlider', () => {
  it('returns false while interacting', () => {
    expect(shouldApplyCameraUpdateFromSlider(true)).toBe(false);
  });

  it('returns true when not interacting', () => {
    expect(shouldApplyCameraUpdateFromSlider(false)).toBe(true);
  });
});

describe('resolveCameraFar', () => {
  it('returns at least the minimum far', () => {
    const far = resolveCameraFar(100, 10, 20, 4);
    expect(far).toBe(10000000);
  });

  it('scales with scene extent and depth above the minimum', () => {
    const far = resolveCameraFar(1000, 1_000_000, 1_000_000, 10);
    expect(far).toBe(20001000);
  });
});
