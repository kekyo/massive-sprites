// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  SpriteElementUpdate,
  ObjectInterpolationParameter,
} from 'massive-sprites';
import { applyInterpolatedUpdateSpecsOptional } from './element-params';
import type { DemoInterpolationType } from './interpolation-easing';
import type { ElementMode } from './sprite-elements';

export type RotationMode = 'none' | DemoInterpolationType;
export type ShiftInterpolationMode = 'none' | DemoInterpolationType;
export type ScaleInterpolationMode = 'none' | DemoInterpolationType;
export type OpacityMode = 'none' | 'wave';
export type OpacityInterpolationMode = 'none' | DemoInterpolationType;

export const shouldAnimateOpacityWaveFromModes = (
  opacityModes: readonly OpacityMode[]
) => opacityModes.some((mode) => mode === 'wave');

export const shouldAdvanceElementRotatePhase = (
  index: number,
  elementMode: ElementMode,
  rotationMode: RotationMode
) => {
  void rotationMode;
  const isPrimaryElement = index === 0;
  if (!isPrimaryElement && elementMode === 'none') {
    return false;
  }
  // "none" in the rotation dropdown is treated as "skip interpolation".
  return true;
};

export const shouldAdvanceElementShiftPhase = (
  index: number,
  elementMode: ElementMode
) => {
  const isPrimaryElement = index === 0;
  if (!isPrimaryElement && elementMode === 'none') {
    return false;
  }
  return elementMode === 'orbit';
};

export const applyRotationModeToElementUpdate = (
  rotationMode: RotationMode,
  elementUpdate: SpriteElementUpdate | null | undefined
) => {
  void rotationMode;
  return elementUpdate;
};

export const resolveElementOpacity = (
  opacityMode: OpacityMode,
  phase: number,
  shouldAnimate: boolean
) => {
  if (opacityMode !== 'wave' || !shouldAnimate) {
    return 1;
  }
  const clampedPhase = Math.max(-1, Math.min(1, phase));
  return 0.75 + clampedPhase * 0.25;
};

export const applyOpacityModeToElementUpdate = (
  opacityMode: OpacityMode,
  opacityInterpolation: ObjectInterpolationParameter | null | undefined,
  phase: number,
  shouldAnimate: boolean,
  elementUpdate: SpriteElementUpdate | null | undefined
) => {
  if (!elementUpdate) {
    return elementUpdate;
  }
  const explicitOpacity = elementUpdate.opacity;
  const opacityValue =
    explicitOpacity?.value ??
    (elementUpdate.imageId === null
      ? 0
      : resolveElementOpacity(opacityMode, phase, shouldAnimate));
  return applyInterpolatedUpdateSpecsOptional(elementUpdate, [
    {
      key: 'opacity',
      value: opacityValue,
      interpolation: opacityInterpolation,
      preserveExistingValue: true,
      preserveExistingInterpolation: true,
    },
  ]);
};
