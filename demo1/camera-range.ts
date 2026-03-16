// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

export type CameraPositionRange = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

export const CAMERA_POSITION_RANGE_SCALE = 5;

export const resolveCameraPositionRange = (
  viewWidth: number,
  viewHeight: number,
  initialDistance: number
): CameraPositionRange => ({
  minX: -viewWidth * CAMERA_POSITION_RANGE_SCALE,
  maxX: viewWidth * CAMERA_POSITION_RANGE_SCALE,
  minY: -viewHeight * CAMERA_POSITION_RANGE_SCALE,
  maxY: viewHeight * CAMERA_POSITION_RANGE_SCALE,
  minZ: -1 * CAMERA_POSITION_RANGE_SCALE,
  maxZ: initialDistance * CAMERA_POSITION_RANGE_SCALE,
});
