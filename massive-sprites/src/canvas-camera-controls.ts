// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type { ObjectInterpolationParameter } from './types';

///////////////////////////////////////////////////////////////////////////////////

/**
 * Two-dimensional control vector used for camera pan and rotation deltas.
 */
export type CameraControlVector = {
  readonly x: number;
  readonly y: number;
};

/**
 * Three-dimensional vector used for camera wheel focus calculations.
 */
export type CameraControlVector3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

const resolveDeltaSeconds = (deltaMs: number) =>
  Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs / 1000 : 0;

/**
 * Resolves drag movement in pixels to a control-space delta.
 * @param dxPixel - Horizontal drag distance in pixels.
 * @param dyPixel - Vertical drag distance in pixels.
 * @param scalePerPixel - Control-space scale per pixel.
 * @param invertY - Whether the vertical axis should be inverted.
 * @returns Control-space drag delta.
 */
export const resolveCameraDragDelta = (
  dxPixel: number,
  dyPixel: number,
  scalePerPixel: number,
  invertY: boolean
): CameraControlVector => ({
  x: dxPixel * scalePerPixel,
  y: (invertY ? -dyPixel : dyPixel) * scalePerPixel,
});

/**
 * Converts pointer movement into world-space pan velocity.
 * @param dxPixel - Horizontal drag distance in pixels.
 * @param dyPixel - Vertical drag distance in pixels.
 * @param worldPerPixelX - World-space basis vector for the screen X axis.
 * @param worldPerPixelY - World-space basis vector for the screen Y axis.
 * @param ratePerPixel - Velocity gain per pixel.
 * @param invertX - Whether the horizontal axis should be inverted.
 * @param invertY - Whether the vertical axis should be inverted.
 * @returns World-space pan velocity.
 */
export const resolvePanWorldVelocity = (
  dxPixel: number,
  dyPixel: number,
  worldPerPixelX: CameraControlVector,
  worldPerPixelY: CameraControlVector,
  ratePerPixel: number,
  invertX: boolean,
  invertY: boolean
): CameraControlVector => {
  const signX = invertX ? -1 : 1;
  const signY = invertY ? -1 : 1;
  const screenVelocityX = dxPixel * ratePerPixel * signX;
  const screenVelocityY = dyPixel * ratePerPixel * signY;
  return {
    x: worldPerPixelX.x * screenVelocityX + worldPerPixelY.x * screenVelocityY,
    y: worldPerPixelX.y * screenVelocityX + worldPerPixelY.y * screenVelocityY,
  };
};

/**
 * Resolves the target camera position for wheel zooming toward a focus point.
 * @param focus - Focus point in world space.
 * @param direction - Normalized camera direction vector.
 * @param distance - Distance to keep from the focus point.
 * @returns Target camera position.
 */
export const resolveWheelTargetPosition = (
  focus: CameraControlVector3,
  direction: CameraControlVector3,
  distance: number
): CameraControlVector3 => ({
  x: focus.x - direction.x * distance,
  y: focus.y - direction.y * distance,
  z: focus.z - direction.z * distance,
});

/**
 * Accumulates time-based camera control deltas from pointer movement.
 * @param current - Current accumulated control value.
 * @param dxPixel - Horizontal drag distance in pixels.
 * @param dyPixel - Vertical drag distance in pixels.
 * @param ratePerPixel - Velocity gain per pixel.
 * @param deltaMs - Elapsed time since the previous sample.
 * @param invertY - Whether the vertical axis should be inverted.
 * @returns Updated accumulated control value.
 */
export const accumulateCameraControl = (
  current: CameraControlVector,
  dxPixel: number,
  dyPixel: number,
  ratePerPixel: number,
  deltaMs: number,
  invertY: boolean
): CameraControlVector => {
  const deltaSeconds = resolveDeltaSeconds(deltaMs);
  if (!deltaSeconds || !Number.isFinite(ratePerPixel)) {
    return current;
  }
  const velocity = resolveCameraDragDelta(
    dxPixel,
    dyPixel,
    ratePerPixel,
    invertY
  );
  return {
    x: current.x + velocity.x * deltaSeconds,
    y: current.y + velocity.y * deltaSeconds,
  };
};

/**
 * Applies an accumulated control vector to a starting value.
 * @param start - Starting control value.
 * @param accumulated - Accumulated delta.
 * @returns Applied control value.
 */
export const applyCameraControl = (
  start: CameraControlVector,
  accumulated: CameraControlVector
): CameraControlVector => ({
  x: start.x + accumulated.x,
  y: start.y + accumulated.y,
});

/**
 * Clamps a camera value to the configured range.
 * @param value - Value to clamp.
 * @param minValue - Optional minimum value.
 * @param maxValue - Optional maximum value.
 * @returns Clamped value.
 */
export const clampCameraValue = (
  value: number,
  minValue: number | undefined,
  maxValue: number | undefined
) => {
  const hasMin = Number.isFinite(minValue);
  const hasMax = Number.isFinite(maxValue);
  if (!hasMin && !hasMax) {
    return value;
  }
  let resolvedMin = hasMin ? (minValue as number) : -Infinity;
  let resolvedMax = hasMax ? (maxValue as number) : Infinity;
  if (resolvedMin > resolvedMax) {
    const swap = resolvedMin;
    resolvedMin = resolvedMax;
    resolvedMax = swap;
  }
  return Math.max(resolvedMin, Math.min(resolvedMax, value));
};

/**
 * Clamps pitch to the configured range, defaulting to a practical camera tilt interval.
 * @param pitch - Pitch in degrees.
 * @param minValue - Optional minimum pitch.
 * @param maxValue - Optional maximum pitch.
 * @returns Clamped pitch value.
 */
export const clampCameraPitch = (
  pitch: number,
  minValue: number | undefined,
  maxValue: number | undefined
) => clampCameraValue(pitch, minValue ?? 0, maxValue ?? 89);

/**
 * Reuses an interpolation definition while replacing its duration.
 * @param interpolation - Base interpolation definition.
 * @param durationMs - Duration to apply.
 * @returns Interpolation with updated duration, or `null`.
 */
export const resolveCameraControlInterpolation = (
  interpolation: ObjectInterpolationParameter | null,
  durationMs: number
): ObjectInterpolationParameter | null => {
  if (!interpolation) {
    return interpolation;
  }
  return {
    ...interpolation,
    durationMs,
  };
};

/**
 * Resolves a stable interpolation duration for wheel camera updates.
 * @param pollingIntervalMs - Pointer polling interval in milliseconds.
 * @returns Rounded duration in milliseconds.
 */
export const resolveWheelInterpolationDuration = (pollingIntervalMs: number) =>
  Math.max(
    1,
    Math.round(Number.isFinite(pollingIntervalMs) ? pollingIntervalMs : 0)
  );
