// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  CameraUpdate,
  ObjectCameraState,
  ObjectCameraTrackingMode,
  ObjectCameraTrackingOptions,
  ObjectCameraTrackingState,
  ObjectInterpolationParameter,
  ObjectWorldPosition,
} from './types';
import { toRadians } from './utils';

///////////////////////////////////////////////////////////////////////////////////

const DEFAULT_CAMERA_TRACKING_FIT_PADDING = 1.1;
const DEFAULT_CAMERA_TRACKING_ZOOM_BIAS = 1.0;
const CAMERA_TRACKING_EPSILON = 1.0e-6;

type Vector3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

export interface CameraTrackingSolution {
  readonly center: ObjectWorldPosition;
  readonly baseDistance: number;
  readonly distance: number;
}

const isFinitePositive = (value: number | undefined) =>
  Number.isFinite(value) && (value as number) > 0;

const normalizePositive = (value: number | undefined, fallback: number) =>
  isFinitePositive(value) ? (value as number) : fallback;

const clampDistance = (distance: number) =>
  Math.max(CAMERA_TRACKING_EPSILON, Number.isFinite(distance) ? distance : 0);

const resolveTrackingMinDistance = (
  trackingState: Pick<ObjectCameraTrackingState, 'minDistance'>
) => {
  if (!isFinitePositive(trackingState.minDistance)) {
    return CAMERA_TRACKING_EPSILON;
  }
  return Math.max(CAMERA_TRACKING_EPSILON, trackingState.minDistance as number);
};

/**
 * Resolves the effective tracking distance after applying zoom bias and floor constraints.
 * @param baseDistance - Distance before applying fit zoom bias or minimum distance.
 * @param trackingState - Tracking state that supplies fit mode and floor settings.
 * @returns Effective camera distance used by tracking.
 */
export const resolveCameraTrackingDistance = (
  baseDistance: number,
  trackingState: Pick<
    ObjectCameraTrackingState,
    'mode' | 'fitZoomBias' | 'minDistance'
  >
) => {
  const zoomBias =
    trackingState.mode === 'fit'
      ? normalizePositive(
          trackingState.fitZoomBias,
          DEFAULT_CAMERA_TRACKING_ZOOM_BIAS
        )
      : 1;
  return Math.max(
    resolveTrackingMinDistance(trackingState),
    clampDistance(baseDistance * zoomBias)
  );
};

const resolveTrackedCameraAxisTarget = (
  value: ObjectCameraState['position']['x']
) => value.interpolation?.toValue ?? value.value;

const dot3 = (a: Vector3, b: Vector3) => a.x * b.x + a.y * b.y + a.z * b.z;

const addScaled3 = (
  base: Vector3,
  direction: Vector3,
  scale: number
): Vector3 => ({
  x: base.x + direction.x * scale,
  y: base.y + direction.y * scale,
  z: base.z + direction.z * scale,
});

const subtract3 = (a: Vector3, b: Vector3): Vector3 => ({
  x: a.x - b.x,
  y: a.y - b.y,
  z: a.z - b.z,
});

const resolveCameraBasis = (cameraState: ObjectCameraState) => {
  const yawRad = toRadians(cameraState.rotation.yaw.value);
  const pitchRad = toRadians(cameraState.rotation.pitch.value);
  const rollRad = toRadians(cameraState.rotation.roll.value);
  const cosZ = Math.cos(yawRad);
  const sinZ = Math.sin(yawRad);
  const cosX = Math.cos(pitchRad);
  const sinX = Math.sin(pitchRad);
  const cosY = Math.cos(rollRad);
  const sinY = Math.sin(rollRad);

  return {
    right: {
      x: cosZ * cosY + sinZ * sinX * sinY,
      y: sinZ * cosY - cosZ * sinX * sinY,
      z: -cosX * sinY,
    },
    up: {
      x: -sinZ * cosX,
      y: cosZ * cosX,
      z: sinX,
    },
    forward: {
      x: -cosZ * sinY - sinZ * sinX * cosY,
      y: -sinZ * sinY + cosZ * sinX * cosY,
      z: -cosX * cosY,
    },
  };
};

const resolveTargetOrigin = (
  targets: readonly ObjectWorldPosition[]
): ObjectWorldPosition => {
  const count = Math.max(1, targets.length);
  const sum = targets.reduce(
    (acc, target) => ({
      x: acc.x + target.x,
      y: acc.y + target.y,
      z: acc.z + target.z,
    }),
    { x: 0, y: 0, z: 0 }
  );
  return {
    x: sum.x / count,
    y: sum.y / count,
    z: sum.z / count,
  };
};

const resolveFitCenter = (
  cameraState: ObjectCameraState,
  targets: readonly ObjectWorldPosition[]
) => {
  const basis = resolveCameraBasis(cameraState);
  const origin = resolveTargetOrigin(targets);
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;

  targets.forEach((target) => {
    const delta = subtract3(target, origin);
    const x = dot3(delta, basis.right);
    const y = dot3(delta, basis.up);
    const z = dot3(delta, basis.forward);
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    minZ = Math.min(minZ, z);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
    maxZ = Math.max(maxZ, z);
  });

  const centerLocal = {
    x: (minX + maxX) * 0.5,
    y: (minY + maxY) * 0.5,
    z: (minZ + maxZ) * 0.5,
  };
  const center = addScaled3(
    addScaled3(
      addScaled3(origin, basis.right, centerLocal.x),
      basis.up,
      centerLocal.y
    ),
    basis.forward,
    centerLocal.z
  );
  return { basis, center };
};

const resolveSingleTargetDistance = (
  cameraState: ObjectCameraState,
  target: ObjectWorldPosition,
  trackingState: ObjectCameraTrackingState
) => {
  if (isFinitePositive(trackingState.resolvedDistance)) {
    return trackingState.resolvedDistance as number;
  }
  const cameraPosition = {
    x: cameraState.position.x.value,
    y: cameraState.position.y.value,
    z: cameraState.position.z.value,
  };
  const delta = subtract3(target, cameraPosition);
  return clampDistance(Math.hypot(delta.x, delta.y, delta.z));
};

const resolveFitBaseDistance = (
  cameraState: ObjectCameraState,
  center: ObjectWorldPosition,
  basis: ReturnType<typeof resolveCameraBasis>,
  targets: readonly ObjectWorldPosition[],
  trackingState: ObjectCameraTrackingState
) => {
  const fovYRad = toRadians(cameraState.fovY.value);
  const tanHalfY = Math.tan(fovYRad / 2);
  const aspectRatio =
    Number.isFinite(cameraState.aspectRatio) && cameraState.aspectRatio > 0
      ? cameraState.aspectRatio
      : 1;
  const tanHalfX = tanHalfY * aspectRatio;
  const padding = normalizePositive(
    trackingState.fitPadding,
    DEFAULT_CAMERA_TRACKING_FIT_PADDING
  );
  let distance = CAMERA_TRACKING_EPSILON;

  targets.forEach((target) => {
    const delta = subtract3(target, center);
    const localX = dot3(delta, basis.right);
    const localY = dot3(delta, basis.up);
    const localZ = dot3(delta, basis.forward);
    if (tanHalfX > CAMERA_TRACKING_EPSILON) {
      distance = Math.max(
        distance,
        (Math.abs(localX) * padding) / tanHalfX - localZ
      );
    }
    if (tanHalfY > CAMERA_TRACKING_EPSILON) {
      distance = Math.max(
        distance,
        (Math.abs(localY) * padding) / tanHalfY - localZ
      );
    }
  });

  return clampDistance(distance);
};

/**
 * Normalizes camera tracking options to an internal state object.
 * @param tracking - Public tracking options.
 * @returns Normalized tracking state.
 */
export const normalizeCameraTrackingOptions = (
  tracking: ObjectCameraTrackingOptions
): ObjectCameraTrackingState => {
  const distance = isFinitePositive(tracking.distance)
    ? tracking.distance
    : undefined;
  const minDistance = isFinitePositive(tracking.minDistance)
    ? tracking.minDistance
    : undefined;
  const fitPadding = normalizePositive(
    tracking.fitPadding,
    DEFAULT_CAMERA_TRACKING_FIT_PADDING
  );
  const fitZoomBias = normalizePositive(
    tracking.fitZoomBias,
    DEFAULT_CAMERA_TRACKING_ZOOM_BIAS
  );
  const mode: ObjectCameraTrackingMode =
    tracking.spriteIds.length > 1 ? 'fit' : 'single';
  const result: ObjectCameraTrackingState = {
    spriteIds: [...tracking.spriteIds],
    targetMode:
      tracking.targetMode === 'contentApprox' ? 'contentApprox' : 'base',
    ...(minDistance !== undefined ? { minDistance } : {}),
    fitPadding,
    fitZoomBias,
    mode,
    resolvedDistance: undefined,
    ...(tracking.interpolation !== undefined
      ? { interpolation: tracking.interpolation }
      : {}),
  };
  if (distance !== undefined) {
    return {
      ...result,
      distance,
      resolvedDistance: resolveCameraTrackingDistance(distance, result),
    };
  }
  return result;
};

/**
 * Resolves the current tracking solution from camera and target states.
 * @param cameraState - Current camera state.
 * @param trackingState - Current tracking state.
 * @param targets - Tracked target world positions.
 * @returns Tracking solution, or `undefined` when the input is not solvable.
 */
export const resolveCameraTrackingSolution = (
  cameraState: ObjectCameraState,
  trackingState: ObjectCameraTrackingState,
  targets: readonly ObjectWorldPosition[]
): CameraTrackingSolution | undefined => {
  if (targets.length === 0) {
    return undefined;
  }

  if (targets.length === 1 || trackingState.mode === 'single') {
    const target = targets[0];
    if (!target) {
      return undefined;
    }
    const baseDistance = resolveSingleTargetDistance(
      cameraState,
      target,
      trackingState
    );
    return {
      center: target,
      baseDistance,
      distance: resolveCameraTrackingDistance(baseDistance, trackingState),
    };
  }

  const { basis, center } = resolveFitCenter(cameraState, targets);
  const baseDistance = resolveFitBaseDistance(
    cameraState,
    center,
    basis,
    targets,
    trackingState
  );
  return {
    center,
    baseDistance,
    distance: resolveCameraTrackingDistance(baseDistance, trackingState),
  };
};

/**
 * Builds a camera update payload from a tracking solution.
 * @param cameraState - Current camera state.
 * @param solution - Resolved tracking solution.
 * @param interpolation - Optional interpolation applied to all position axes.
 * @returns Camera update payload.
 */
export const createCameraTrackingUpdate = (
  cameraState: ObjectCameraState,
  solution: CameraTrackingSolution,
  interpolation: ObjectInterpolationParameter | null | undefined
): CameraUpdate => {
  const basis = resolveCameraBasis(cameraState);
  const position = {
    x: solution.center.x - basis.forward.x * solution.distance,
    y: solution.center.y - basis.forward.y * solution.distance,
    z: solution.center.z - basis.forward.z * solution.distance,
  };
  const createUpdateValue = (value: number) =>
    interpolation === undefined ? { value } : { value, interpolation };
  return {
    position: {
      x: createUpdateValue(position.x),
      y: createUpdateValue(position.y),
      z: createUpdateValue(position.z),
    },
  };
};

/**
 * Returns whether a tracking update would move the camera materially.
 * @param cameraState - Current camera state.
 * @param update - Candidate tracking update.
 * @returns `true` when the camera position target would change.
 */
export const hasMaterialCameraTrackingUpdate = (
  cameraState: ObjectCameraState,
  update: CameraUpdate
) => {
  const position = update.position;
  const nextX = position?.x?.value;
  const nextY = position?.y?.value;
  const nextZ = position?.z?.value;
  const currentTargetX = resolveTrackedCameraAxisTarget(cameraState.position.x);
  const currentTargetY = resolveTrackedCameraAxisTarget(cameraState.position.y);
  const currentTargetZ = resolveTrackedCameraAxisTarget(cameraState.position.z);
  return (
    (nextX !== undefined &&
      Math.abs(nextX - currentTargetX) > CAMERA_TRACKING_EPSILON) ||
    (nextY !== undefined &&
      Math.abs(nextY - currentTargetY) > CAMERA_TRACKING_EPSILON) ||
    (nextZ !== undefined &&
      Math.abs(nextZ - currentTargetZ) > CAMERA_TRACKING_EPSILON)
  );
};

/**
 * Resolves the multiplicative wheel zoom factor used while tracking.
 * @param deltaPixels - Raw wheel delta in pixels.
 * @param fovYDeg - Current vertical field of view in degrees.
 * @param viewportHeightPixel - Viewport height in CSS pixels.
 * @returns Multiplicative distance factor.
 */
export const resolveCameraTrackingWheelZoomFactor = (
  deltaPixels: number,
  fovYDeg: number,
  viewportHeightPixel: number
) => {
  if (
    !Number.isFinite(deltaPixels) ||
    !Number.isFinite(fovYDeg) ||
    !Number.isFinite(viewportHeightPixel) ||
    viewportHeightPixel <= 0
  ) {
    return 1;
  }
  const fovYRad = toRadians(fovYDeg);
  const zoomRate = (2 * Math.tan(fovYRad / 2)) / viewportHeightPixel;
  return Math.exp(deltaPixels * zoomRate);
};
