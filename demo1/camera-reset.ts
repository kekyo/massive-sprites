// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  CameraAdjustPositionOptions,
  ObjectInterpolationParameter,
} from 'massive-sprites';

import { createInterpolatedParameter } from './element-params';

///////////////////////////////////////////////////////////////////////////////////

export type DemoCameraResetValues = {
  readonly yaw: number;
  readonly pitch: number;
  readonly roll: number;
  readonly fov: number;
};

export type DemoCameraResetControl = {
  readonly setValue: (value: number) => void;
};

export type DemoCameraResetControls = {
  readonly yaw: DemoCameraResetControl;
  readonly pitch: DemoCameraResetControl;
  readonly roll: DemoCameraResetControl;
  readonly fov: DemoCameraResetControl;
};

///////////////////////////////////////////////////////////////////////////////////

export const createDemoCameraResetValues = (
  yaw: number,
  pitch: number,
  roll: number,
  fov: number
): DemoCameraResetValues => ({
  yaw,
  pitch,
  roll,
  fov,
});

export const applyDemoCameraResetValues = (
  controls: DemoCameraResetControls,
  values: DemoCameraResetValues
) => {
  controls.yaw.setValue(values.yaw);
  controls.pitch.setValue(values.pitch);
  controls.roll.setValue(values.roll);
  controls.fov.setValue(values.fov);
};

export const createAdjustCameraToSpritesOptions = (
  pitch: number,
  fov: number,
  far: number,
  interpolation: ObjectInterpolationParameter | null | undefined
): CameraAdjustPositionOptions => ({
  pitch: createInterpolatedParameter(pitch, interpolation),
  fov: createInterpolatedParameter(fov, interpolation),
  ...(interpolation !== undefined ? { interpolation } : {}),
  far,
});
