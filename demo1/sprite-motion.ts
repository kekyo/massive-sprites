// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type { DemoInterpolationType } from './interpolation-easing';

export type MoveMode = 'none' | DemoInterpolationType;

export const ROTATE_STEP_DEG = 45;
export const MOVE_PHASES = [1, 2, 1, 0, -1, -2, -1, 0] as const;
export const OPACITY_WAVE_PHASES = [1, 0, -1, 0] as const;

export const resolveSpriteMotion = (
  moveMode: MoveMode,
  movementSpeedScale: number
) => {
  void moveMode;
  const moveSpeedScale =
    Number.isFinite(movementSpeedScale) && movementSpeedScale > 0
      ? movementSpeedScale
      : 0;
  return {
    // "none" in the move dropdown is treated as "skip interpolation".
    // Stopping movement is controlled only by speed=0.
    shouldMove: moveSpeedScale > 0,
    moveSpeedScale,
    rotateStepDeg: ROTATE_STEP_DEG,
  };
};
