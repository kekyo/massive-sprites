// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type { ColorRGBA } from './types';

///////////////////////////////////////////////////////////////////////////////////

/**
 * Returns a monotonic timestamp when available, otherwise falls back to `Date.now()`.
 * @returns Current timestamp in milliseconds.
 */
export const getNowMs = () =>
  typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now();

/**
 * Converts degrees to radians.
 * @param deg - Angle in degrees.
 * @returns Angle in radians.
 */
export const toRadians = (deg: number) => (deg * Math.PI) / 180;

/**
 * Converts radians to degrees.
 * @param rad - Angle in radians.
 * @returns Angle in degrees.
 */
export const toDegrees = (rad: number) => (rad * 180) / Math.PI;

/**
 * Wraps an angle to the `[-PI, PI)` range.
 * @param value - Angle in radians.
 * @returns Wrapped angle in radians.
 */
export const wrapRadians = (value: number) => {
  let v = value;
  const tau = Math.PI * 2;
  v = ((((v + Math.PI) % tau) + tau) % tau) - Math.PI;
  return v;
};

/**
 * Wraps an angle to the `[-180, 180]` range.
 * @param value - Angle in degrees.
 * @returns Wrapped angle in degrees.
 */
export const wrapDegrees = (value: number) => {
  let v = value;
  while (v > 180) {
    v -= 360;
  }
  while (v < -180) {
    v += 360;
  }
  return v;
};

/**
 * Returns whether the value is a power of two.
 * @param value - Integer-like value to inspect.
 * @returns `true` when the value is a power of two.
 */
export const isPowerOfTwo = (value: number) => (value & (value - 1)) === 0;

/**
 * Returns the next power of two greater than or equal to the value.
 * @param value - Lower bound.
 * @returns Smallest power of two not smaller than `value`.
 */
export const getNextPowerOfTwo = (value: number) => {
  let result = 1;
  while (result < value) {
    result <<= 1;
  }
  return result;
};

/**
 * Returns the value when it is a positive finite number, otherwise the fallback.
 * @param value - Candidate value.
 * @param fallback - Value to use when the candidate is invalid.
 * @returns Normalized positive finite value.
 */
export const normalizePositiveFinite = (
  value: number | undefined,
  fallback: number
) => (Number.isFinite(value) && value! > 0 ? value! : fallback);

/**
 * Validates that the value is finite.
 * @param value - Value to validate.
 * @param label - Label used in the error message.
 * @returns The validated value.
 */
export const normalizeFiniteNumber = (value: number, label: string) => {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }
  return value;
};

/**
 * Validates that the value is a positive finite number.
 * @param value - Value to validate.
 * @param label - Label used in the error message.
 * @returns The validated value.
 */
export const normalizePositiveNumber = (value: number, label: string) => {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`);
  }
  return value;
};

/**
 * Parses a `#RRGGBB` or `#RRGGBBAA` color string into normalized RGBA channels.
 * @param value - Color string to parse.
 * @returns Normalized RGBA channels in the `[0, 1]` range.
 */
export const parseColorRGBA = (value: ColorRGBA) => {
  if (typeof value !== 'string') {
    throw new Error('Color must be a string.');
  }
  const normalized = value.trim();
  const match = /^#([0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.exec(normalized);
  if (!match) {
    throw new Error('Color must be in #RRGGBB or #RRGGBBAA format.');
  }
  const hex = match[1]!;
  const r = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const g = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const b = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) / 255 : 1;
  return { r, g, b, a };
};

/**
 * Formats normalized RGBA channels into a `#RRGGBBAA` color string.
 * @param r - Red channel in the `[0, 1]` range.
 * @param g - Green channel in the `[0, 1]` range.
 * @param b - Blue channel in the `[0, 1]` range.
 * @param a - Alpha channel in the `[0, 1]` range.
 * @returns Formatted color string.
 */
export const formatColorRGBA = (r: number, g: number, b: number, a: number) => {
  const clamp = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value * 255)));
  const toHex = (value: number) => clamp(value).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}${toHex(a)}` as ColorRGBA;
};

///////////////////////////////////////////////////////////////////////////////////

/**
 * Bidirectional mapping between stable ids and compact indices.
 */
export interface IdIndexMap {
  /** Allocates a new stable id. */
  readonly allocateId: () => number;
  /** Resolves a compact index from a stable id. */
  readonly getIndexById: (id: number) => number | null;
  /** Resolves a stable id from a compact index. */
  readonly getIdByIndex: (index: number) => number | null;
  /** Inserts an id entry at the given compact index. */
  readonly insertIndex: (index: number, id: number | null) => void;
  /** Removes the entry at the given compact index and returns the removed id. */
  readonly removeIndex: (index: number) => number | null;
  /** Clears the map and resets id allocation. */
  readonly reset: () => void;
}

/**
 * Creates a bidirectional id/index map for compacted renderer storage.
 * @returns Id/index map instance.
 */
export const createIdIndexMap = (): IdIndexMap => {
  let nextId = 0;
  const idToIndex = new Map<number, number>();
  const indexToId: Array<number | null> = [];

  const allocateId = () => {
    const id = nextId;
    nextId += 1;
    return id;
  };

  const getIndexById = (id: number) => {
    const index = idToIndex.get(id);
    return index === undefined ? null : index;
  };

  const getIdByIndex = (index: number) => {
    if (index < 0 || index >= indexToId.length) {
      return null;
    }
    const id = indexToId[index];
    return id == null ? null : id;
  };

  const updateIndicesFrom = (startIndex: number) => {
    for (let index = startIndex; index < indexToId.length; index += 1) {
      const id = indexToId[index];
      if (id != null) {
        idToIndex.set(id, index);
      }
    }
  };

  const insertIndex = (index: number, id: number | null) => {
    const resolvedIndex = Math.max(0, Math.min(index, indexToId.length));
    const resolvedId = id === null ? null : id;
    indexToId.splice(resolvedIndex, 0, resolvedId);
    if (resolvedId !== null) {
      idToIndex.set(resolvedId, resolvedIndex);
    }
    updateIndicesFrom(resolvedIndex + 1);
  };

  const removeIndex = (index: number) => {
    if (index < 0 || index >= indexToId.length) {
      return null;
    }
    const removedId = indexToId[index] ?? null;
    indexToId.splice(index, 1);
    if (removedId != null) {
      idToIndex.delete(removedId);
    }
    updateIndicesFrom(index);
    return removedId ?? null;
  };

  const reset = () => {
    nextId = 0;
    idToIndex.clear();
    indexToId.length = 0;
  };

  return {
    allocateId,
    getIndexById,
    getIdByIndex,
    insertIndex,
    removeIndex,
    reset,
  };
};
