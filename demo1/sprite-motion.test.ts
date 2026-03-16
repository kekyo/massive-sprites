// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { describe, expect, it } from 'vitest';
import {
  MOVE_PHASES,
  resolveSpriteMotion,
  ROTATE_STEP_DEG,
} from './sprite-motion';

describe('sprite-motion helpers', () => {
  it('treats none mode as skip interpolation and keeps translation enabled', () => {
    const state = resolveSpriteMotion('none', 1);

    expect(state.shouldMove).toBe(true);
    expect(state.moveSpeedScale).toBe(1);
    expect(state.rotateStepDeg).toBe(ROTATE_STEP_DEG);
  });

  it('stops translation for zero speed while keeping rotation step', () => {
    const state = resolveSpriteMotion('linear', 0);

    expect(state.shouldMove).toBe(false);
    expect(state.moveSpeedScale).toBe(0);
    expect(state.rotateStepDeg).toBe(ROTATE_STEP_DEG);
  });

  it('enables translation for extended easing mode and positive speed', () => {
    const state = resolveSpriteMotion('ease', 1.5);

    expect(state.shouldMove).toBe(true);
    expect(state.moveSpeedScale).toBe(1.5);
    expect(state.rotateStepDeg).toBe(ROTATE_STEP_DEG);
  });

  it('uses extended move phase cycle for Y-axis sprite motion', () => {
    expect([...MOVE_PHASES]).toStrictEqual([1, 2, 1, 0, -1, -2, -1, 0]);
  });
});
