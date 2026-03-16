// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  CameraAdjustPositionOptions,
  ObjectInterpolationParameter,
} from 'massive-sprites';

///////////////////////////////////////////////////////////////////////////////////

export interface CameraContentBounds {
  readonly width: number;
  readonly height: number;
}

export const CAMERA_FOV_Y_DEG = 45;
export const CAMERA_PADDING = 1.1;
export const CAMERA_NEAR = 0.1;
export const CAMERA_INITIAL_ADJUST_DURATION = 1000;

///////////////////////////////////////////////////////////////////////////////////

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const clampAxisLength = (value: number) =>
  Number.isFinite(value) && value > 0 ? value : 1;

export const createResetViewInterpolation =
  (): ObjectInterpolationParameter => ({
    mode: 'feedback',
    durationMs: CAMERA_INITIAL_ADJUST_DURATION,
    easing: {
      type: 'exponential',
    },
  });

export const createRouteCameraAdjustOptions = (
  aspect: number,
  bounds: CameraContentBounds
): CameraAdjustPositionOptions => {
  const safeWidth = clampAxisLength(bounds.width);
  const safeHeight = clampAxisLength(bounds.height);
  const halfWidth = safeWidth * 0.5 * CAMERA_PADDING;
  const halfHeight = safeHeight * 0.5 * CAMERA_PADDING;
  const fovYRad = toRadians(CAMERA_FOV_Y_DEG);
  const fovXRad = 2 * Math.atan(Math.tan(fovYRad / 2) * aspect);
  const distanceForHeight = halfHeight / Math.tan(fovYRad / 2);
  const distanceForWidth = halfWidth / Math.tan(fovXRad / 2);
  const distance = Math.max(distanceForHeight, distanceForWidth);
  const far = Math.max(10000, distance + Math.max(halfWidth, halfHeight) * 4);
  const interpolation = createResetViewInterpolation();

  return {
    pitch: {
      value: 0,
      interpolation,
    },
    fov: {
      value: CAMERA_FOV_Y_DEG,
      interpolation,
    },
    interpolation,
    near: CAMERA_NEAR,
    far,
  };
};
