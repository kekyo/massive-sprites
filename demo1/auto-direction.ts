// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  ObjectInterpolationParameter,
  SpriteAutoDirectionSpace,
  SpriteElementUpdate,
} from 'massive-sprites';
import {
  resolveDemoInterpolationEasing,
  type DemoInterpolationType,
} from './interpolation-easing';

/**
 * Auto-direction mode exposed by the demo controls.
 */
export type AutoDirectionMode = 'none' | 'rotation' | 'flipping';

/**
 * Auto-direction observe space exposed by the demo controls.
 */
export type DemoAutoDirectionSpace = SpriteAutoDirectionSpace;

/**
 * Auto-direction interpolation mode exposed by the demo controls.
 */
export type AutoDirectionInterpolationMode = DemoInterpolationType | 'none';

/**
 * Runtime control values used to build one demo auto-direction update.
 */
export interface DemoAutoDirectionConfig {
  /** Selected auto-direction observe space. */
  readonly space: DemoAutoDirectionSpace;
  /** Selected auto-direction mode. */
  readonly mode: AutoDirectionMode;
  /** Whether detected direction also drives `shiftAngleDeg`. */
  readonly shiftAngleRotation: boolean;
  /** Minimum movement distance before direction changes are accepted. */
  readonly minDistance: number;
  /** Whether local X flipping is enabled. */
  readonly flipX: boolean;
  /** Whether local Y flipping is enabled. */
  readonly flipY: boolean;
  /** Selected interpolation mode for flipping. */
  readonly interpolationMode: AutoDirectionInterpolationMode;
  /** Whether the demo should use feedforward interpolation. */
  readonly useFeedforward: boolean;
  /** Shared interpolation duration used by the demo. */
  readonly durationMs: number;
}

const buildDemoAutoDirectionInterpolation = (
  interpolationMode: AutoDirectionInterpolationMode,
  useFeedforward: boolean,
  durationMs: number
): ObjectInterpolationParameter | null => {
  if (interpolationMode === 'none') {
    return null;
  }
  return {
    mode: useFeedforward ? 'feedforward' : 'feedback',
    durationMs,
    easing: resolveDemoInterpolationEasing(interpolationMode),
  };
};

/**
 * Builds the demo's `SpriteElementUpdate.autoDirection` payload from UI state.
 * @remarks Flipping interpolation uses `null` to clear a previously configured
 * runtime when the control is set back to `none`.
 */
export const buildDemoAutoDirectionUpdate = (
  config: DemoAutoDirectionConfig
): Exclude<SpriteElementUpdate['autoDirection'], undefined> => {
  if (config.mode === 'none' && !config.shiftAngleRotation) {
    return null;
  }
  if (config.mode === 'rotation') {
    return {
      space: config.space,
      mode: { type: 'rotation' },
      shiftAngleRotation: config.shiftAngleRotation,
      minDistance: config.minDistance,
    };
  }
  if (config.mode === 'flipping') {
    return {
      space: config.space,
      mode: {
        type: 'flipping',
        flipX: config.flipX,
        flipY: config.flipY,
        interpolation: buildDemoAutoDirectionInterpolation(
          config.interpolationMode,
          config.useFeedforward,
          config.durationMs
        ),
      },
      shiftAngleRotation: config.shiftAngleRotation,
      minDistance: config.minDistance,
    };
  }
  return {
    space: config.space,
    shiftAngleRotation: config.shiftAngleRotation,
    minDistance: config.minDistance,
  };
};
