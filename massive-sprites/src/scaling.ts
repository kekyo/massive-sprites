// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type { DistanceScalingOptions, WasmInputPrecision } from './types';

///////////////////////////////////////////////////////////////////////////////////

/**
 * Distance scaling limits after defaulting and validation.
 */
export interface ResolvedDistanceScalingOptions {
  /** Near-distance clamp used when shrinking objects. */
  readonly minScaleDistance: number;
  /** Far-distance clamp used when growing objects. */
  readonly maxScaleDistance: number;
}

/**
 * Result of resolving user-facing distance scaling options.
 */
export interface DistanceScalingResolveResult {
  /** Fully resolved scaling limits. */
  readonly resolved: ResolvedDistanceScalingOptions;
  /** Human-readable warnings emitted while normalizing the input. */
  readonly warnings: readonly string[];
}

const WASM_F32_UNLIMITED_DISTANCE_SCALING_MAX_DISTANCE = 3.4028234663852886e38;

const normalizeMaxScaleDistance = (
  value: number,
  treatPositiveInfinityAsUnlimited: boolean
) => {
  if (treatPositiveInfinityAsUnlimited && value === Number.POSITIVE_INFINITY) {
    return Number.MAX_VALUE;
  }
  if (!Number.isFinite(value) || value <= 0) {
    return Number.MAX_VALUE;
  }
  return value;
};

/**
 * Unlimited distance scaling defaults.
 */
export const UNLIMITED_DISTANCE_SCALING_OPTIONS: ResolvedDistanceScalingOptions =
  {
    minScaleDistance: 0,
    maxScaleDistance: Number.MAX_VALUE,
  } as const;

/**
 * Returns the finite sentinel used to represent unlimited max distance in WASM.
 * @param precision - WASM input precision.
 * @returns Finite sentinel value understood by the WASM module.
 */
export const getUnlimitedDistanceScalingMaxDistanceForWasm = (
  precision: WasmInputPrecision
): number =>
  precision === 'f32'
    ? WASM_F32_UNLIMITED_DISTANCE_SCALING_MAX_DISTANCE
    : Number.MAX_VALUE;

/**
 * Converts resolved scaling options into the finite representation used by WASM.
 * @param scaling - Resolved scaling limits.
 * @param precision - WASM input precision.
 * @returns Scaling limits safe to pass to the WASM module.
 */
export const resolveDistanceScalingOptionsForWasm = (
  scaling: ResolvedDistanceScalingOptions,
  precision: WasmInputPrecision
): ResolvedDistanceScalingOptions => {
  const unlimitedMaxScaleDistance =
    getUnlimitedDistanceScalingMaxDistanceForWasm(precision);
  let minScaleDistance =
    Number.isFinite(scaling.minScaleDistance) && scaling.minScaleDistance >= 0
      ? Math.min(scaling.minScaleDistance, unlimitedMaxScaleDistance)
      : 0;
  let maxScaleDistance = normalizeMaxScaleDistance(
    scaling.maxScaleDistance,
    true
  );
  maxScaleDistance = Math.min(maxScaleDistance, unlimitedMaxScaleDistance);
  if (maxScaleDistance < minScaleDistance) {
    [minScaleDistance, maxScaleDistance] = [maxScaleDistance, minScaleDistance];
  }
  return {
    minScaleDistance,
    maxScaleDistance,
  };
};

/**
 * Resolves distance scaling options into a complete object.
 * @param options - Optional user-provided scaling limits.
 * @returns Resolved scaling limits and any normalization warnings.
 * @remarks Invalid values are normalized to safe defaults instead of throwing.
 */
export const resolveDistanceScalingOptions = (
  options?: DistanceScalingOptions
): DistanceScalingResolveResult => {
  const warnings: string[] = [];

  let minScaleDistance =
    options?.minScaleDistance ??
    UNLIMITED_DISTANCE_SCALING_OPTIONS.minScaleDistance;
  if (!Number.isFinite(minScaleDistance) || minScaleDistance < 0) {
    if (options?.minScaleDistance !== undefined) {
      warnings.push(
        `minScaleDistance(${String(
          options.minScaleDistance
        )}) is invalid; using 0`
      );
    }
    minScaleDistance = 0;
  }

  let maxScaleDistance =
    options?.maxScaleDistance ??
    UNLIMITED_DISTANCE_SCALING_OPTIONS.maxScaleDistance;
  const maxIsPositiveInfinity = maxScaleDistance === Number.POSITIVE_INFINITY;
  if (maxIsPositiveInfinity) {
    maxScaleDistance = Number.MAX_VALUE;
  } else if (!Number.isFinite(maxScaleDistance)) {
    if (options?.maxScaleDistance !== undefined) {
      warnings.push(
        `maxScaleDistance(${String(
          options.maxScaleDistance
        )}) is not finite; treated as unlimited`
      );
    }
    maxScaleDistance = Number.MAX_VALUE;
  } else if (maxScaleDistance <= 0) {
    if (options?.maxScaleDistance !== undefined) {
      warnings.push(
        `maxScaleDistance(${String(
          options.maxScaleDistance
        )}) is non-positive; treated as unlimited`
      );
    }
    maxScaleDistance = Number.MAX_VALUE;
  }

  if (maxScaleDistance < minScaleDistance) {
    warnings.push(
      `maxScaleDistance(${maxScaleDistance}) < minScaleDistance(${minScaleDistance}); swapped values to maintain ascending order`
    );
    [minScaleDistance, maxScaleDistance] = [maxScaleDistance, minScaleDistance];
  }

  return {
    resolved: {
      minScaleDistance,
      maxScaleDistance,
    },
    warnings,
  };
};

/**
 * Calculates a scale factor based on the camera distance and scaling limits.
 * @param distance - Camera distance to evaluate.
 * @param scaling - Resolved scaling limits.
 * @returns Multiplicative scale factor to apply.
 */
export const calculateDistanceScaleFactor = (
  distance: number,
  scaling: ResolvedDistanceScalingOptions
): number => {
  if (!Number.isFinite(distance) || distance <= 0) {
    return 1;
  }
  let clampedDistance = distance;
  if (scaling.minScaleDistance > 0 && distance < scaling.minScaleDistance) {
    clampedDistance = scaling.minScaleDistance;
  } else if (
    Number.isFinite(scaling.maxScaleDistance) &&
    scaling.maxScaleDistance > 0 &&
    distance > scaling.maxScaleDistance
  ) {
    clampedDistance = scaling.maxScaleDistance;
  }
  if (clampedDistance === distance || clampedDistance <= 0) {
    return 1;
  }
  return distance / clampedDistance;
};
