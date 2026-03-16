// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type { ObjectCanvasCameraChangeSource } from 'massive-sprites';

export const forEachReverse = <T>(
  items: readonly T[],
  handler: (item: T) => void
) => {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    if (item !== undefined) {
      handler(item);
    }
  }
};

export const shouldSyncCameraSlidersFromEvent = (
  source: ObjectCanvasCameraChangeSource
) => source === 'interaction';

export const shouldApplyCameraUpdateFromSlider = (
  isCameraInteracting: boolean
) => !isCameraInteracting;

export const resolveCameraFar = (
  compensatedZ: number,
  cellWidth: number,
  cellHeight: number,
  gridSize: number
) => {
  const sceneHalfExtent =
    Math.max(cellWidth, cellHeight) * Math.max(0, gridSize) * 0.5;
  const baseline = Math.abs(compensatedZ) + sceneHalfExtent * 4;
  return Math.max(10000000, baseline);
};
