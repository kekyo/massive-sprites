// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  ObjectInterpolationParameter,
  ObjectPlacementValue,
  ObjectUpdateValue,
  SpriteElementPlacement,
  SpriteElementRenderMode,
  SpriteElementUpdate,
  SpritePlacement,
  SpriteUpdate,
} from './types';

///////////////////////////////////////////////////////////////////////////////////

interface TrackingScalarSnapshot {
  readonly currentValue: number;
  readonly startValue: number;
  readonly targetValue: number;
  readonly startTimestampMs: number;
  readonly configuredInterpolation: ObjectInterpolationParameter | undefined;
  readonly activeInterpolation: ObjectInterpolationParameter | undefined;
}

type TrackingOriginLocationSnapshot = {
  readonly index: number;
  readonly useResolvedAnchor: boolean;
};

export interface SpriteTrackingElementSnapshot {
  readonly imageId: string | null | undefined;
  readonly originLocation: TrackingOriginLocationSnapshot;
  readonly mode: SpriteElementRenderMode;
  readonly shiftDistance: TrackingScalarSnapshot;
  readonly shiftAngleDeg: TrackingScalarSnapshot;
  readonly scale: TrackingScalarSnapshot;
  readonly opacity: TrackingScalarSnapshot;
  readonly borderWidth: number;
  readonly hasLeaderline: boolean;
  readonly anchorX: TrackingScalarSnapshot;
  readonly anchorY: TrackingScalarSnapshot;
  readonly autoDirectionShiftAngleRotation: boolean;
}

export interface SpriteTrackingSnapshot {
  readonly sx: TrackingScalarSnapshot;
  readonly sy: TrackingScalarSnapshot;
  readonly sz: number;
  readonly opacity: TrackingScalarSnapshot;
  readonly elements: readonly (SpriteTrackingElementSnapshot | null)[];
}

///////////////////////////////////////////////////////////////////////////////////

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const normalizeEasingMode = (
  mode: 'in' | 'out' | 'in-out' | undefined,
  fallback: 'in' | 'out' | 'in-out'
) => {
  if (mode === 'in' || mode === 'out' || mode === 'in-out') {
    return mode;
  }
  return fallback;
};

const sigmoidRaw = (t: number, k: number, mid: number) =>
  1 / (1 + Math.exp(-k * (t - mid)));

const applyEasing = (
  progress: number,
  easing: ObjectInterpolationParameter['easing']
) => {
  const t = clamp01(progress);
  const pi = Math.PI;

  switch (easing.type) {
    case 'linear':
      return t;
    case 'sigmoid': {
      const k = Number.isFinite(easing.k) && easing.k! > 0 ? easing.k! : 10;
      const mid = Number.isFinite(easing.mid) ? easing.mid! : 0.5;
      const s0 = sigmoidRaw(0, k, mid);
      const s1 = sigmoidRaw(1, k, mid);
      const span = s1 - s0;
      return span === 0 ? t : (sigmoidRaw(t, k, mid) - s0) / span;
    }
    case 'ease': {
      const power =
        Number.isFinite(easing.power) && easing.power! > 0 ? easing.power! : 3;
      const mode = normalizeEasingMode(easing.mode, 'in-out');
      if (mode === 'in') {
        return t ** power;
      }
      if (mode === 'out') {
        return 1 - (1 - t) ** power;
      }
      if (t < 0.5) {
        return 0.5 * (t * 2) ** power;
      }
      return 1 - 0.5 * (2 - t * 2) ** power;
    }
    case 'exponential': {
      const exponent =
        Number.isFinite(easing.exponent) && easing.exponent! > 0
          ? easing.exponent!
          : 5;
      const denom = Math.expm1(exponent);
      const expIn = (value: number) => {
        if (value <= 0) {
          return 0;
        }
        if (value >= 1) {
          return 1;
        }
        return Math.expm1(exponent * value) / denom;
      };
      const expOut = (value: number) => {
        if (value <= 0) {
          return 0;
        }
        if (value >= 1) {
          return 1;
        }
        return 1 - Math.expm1(exponent * (1 - value)) / denom;
      };
      const mode = normalizeEasingMode(easing.mode, 'in-out');
      if (mode === 'in') {
        return expIn(t);
      }
      if (mode === 'out') {
        return expOut(t);
      }
      if (t < 0.5) {
        return 0.5 * expIn(t * 2);
      }
      return 0.5 + 0.5 * expOut(t * 2 - 1);
    }
    case 'quadratic': {
      const mode = normalizeEasingMode(easing.mode, 'in-out');
      if (mode === 'in') {
        return t * t;
      }
      if (mode === 'out') {
        return 1 - (1 - t) * (1 - t);
      }
      if (t < 0.5) {
        const x = t * 2;
        return 0.5 * x * x;
      }
      const x = 2 - t * 2;
      return 1 - 0.5 * x * x;
    }
    case 'cubic': {
      const mode = normalizeEasingMode(easing.mode, 'in-out');
      if (mode === 'in') {
        return t * t * t;
      }
      if (mode === 'out') {
        const inv = 1 - t;
        return 1 - inv * inv * inv;
      }
      if (t < 0.5) {
        const x = t * 2;
        return 0.5 * x * x * x;
      }
      const x = 2 - t * 2;
      return 1 - 0.5 * x * x * x;
    }
    case 'sine': {
      const amplitude =
        Number.isFinite(easing.amplitude) && easing.amplitude! > 0
          ? easing.amplitude!
          : 1;
      const mode = normalizeEasingMode(easing.mode, 'in-out');
      if (mode === 'in') {
        return amplitude * (1 - Math.cos((pi / 2) * t));
      }
      if (mode === 'out') {
        return amplitude * Math.sin((pi / 2) * t);
      }
      return amplitude * 0.5 * (1 - Math.cos(pi * t));
    }
    case 'bounce': {
      const bounceBase =
        Number.isFinite(easing.bounces) && easing.bounces! > 0
          ? easing.bounces!
          : 3;
      const bounces = Math.max(1, Math.round(bounceBase));
      const decay = !Number.isFinite(easing.decay)
        ? 0.5
        : Math.max(0, Math.min(1, easing.decay!));
      const oscillation = Math.cos(pi * (bounces + 0.5) * t);
      const dampening = decay ** (t * bounces);
      return 1 - Math.abs(oscillation) * dampening;
    }
    case 'back': {
      const overshoot = Number.isFinite(easing.overshoot)
        ? easing.overshoot!
        : 1.70158;
      const c3 = overshoot + 1;
      const p = t - 1;
      return 1 + c3 * p * p * p + overshoot * p * p;
    }
    default:
      return t;
  }
};

const createTrackingScalarSnapshot = (
  value: ObjectPlacementValue<number>
): TrackingScalarSnapshot => ({
  currentValue: value.value,
  startValue: value.value,
  targetValue: value.value,
  startTimestampMs: 0,
  configuredInterpolation: value.interpolation,
  activeInterpolation: undefined,
});

const createTrackingScalarSnapshotWithDefault = (value: number) =>
  createTrackingScalarSnapshot({ value });

export const resolveTrackingSnapshotScalarValue = (
  state: TrackingScalarSnapshot,
  nowMs: number
) => {
  const interpolation = state.activeInterpolation;
  if (!interpolation || interpolation.durationMs <= 0) {
    return state.targetValue;
  }
  if (!Number.isFinite(nowMs)) {
    return state.currentValue;
  }
  const t = (nowMs - state.startTimestampMs) / interpolation.durationMs;
  if (t <= 0) {
    return state.startValue;
  }
  if (t >= 1) {
    return state.targetValue;
  }
  const eased = applyEasing(t, interpolation.easing);
  return state.startValue + (state.targetValue - state.startValue) * eased;
};

const applyTrackingScalarUpdate = (
  state: TrackingScalarSnapshot,
  update: ObjectUpdateValue<number>,
  nowMs: number
): TrackingScalarSnapshot => {
  if (update.value === undefined && update.interpolation === undefined) {
    return state;
  }

  const currentValue = resolveTrackingSnapshotScalarValue(state, nowMs);
  const configuredInterpolation =
    update.interpolation === undefined
      ? state.configuredInterpolation
      : (update.interpolation ?? undefined);

  const nextTargetValue =
    update.value === undefined ? state.targetValue : update.value;

  if (
    !configuredInterpolation ||
    configuredInterpolation.durationMs <= 0 ||
    !Number.isFinite(nextTargetValue) ||
    Math.abs(currentValue - nextTargetValue) <= 1.0e-6
  ) {
    return {
      currentValue: nextTargetValue,
      startValue: nextTargetValue,
      targetValue: nextTargetValue,
      startTimestampMs: nowMs,
      configuredInterpolation,
      activeInterpolation: undefined,
    };
  }

  return {
    currentValue,
    startValue: currentValue,
    targetValue: nextTargetValue,
    startTimestampMs: nowMs,
    configuredInterpolation,
    activeInterpolation: configuredInterpolation,
  };
};

const resolveBorderWidth = (
  border:
    | SpriteElementPlacement['border']
    | SpriteElementUpdate['border']
    | undefined
) => {
  if (
    !border ||
    typeof border.width !== 'number' ||
    !Number.isFinite(border.width)
  ) {
    return 0;
  }
  return Math.max(0, border.width);
};

const normalizeOriginLocation = (
  originLocation:
    | SpriteElementPlacement['originLocation']
    | SpriteElementUpdate['originLocation']
    | undefined
): TrackingOriginLocationSnapshot => ({
  index:
    typeof originLocation?.index === 'number' &&
    Number.isFinite(originLocation.index)
      ? Math.trunc(originLocation.index)
      : -1,
  useResolvedAnchor: originLocation?.useResolvedAnchor === true,
});

const createTrackingElementSnapshot = (
  element: SpriteElementPlacement | null | undefined
): SpriteTrackingElementSnapshot | null => {
  if (!element) {
    return null;
  }
  return {
    imageId: element.imageId,
    originLocation: normalizeOriginLocation(element.originLocation),
    mode: element.mode ?? 'surface',
    shiftDistance: element.shiftDistance
      ? createTrackingScalarSnapshot(element.shiftDistance)
      : createTrackingScalarSnapshotWithDefault(0),
    shiftAngleDeg: element.shiftAngleDeg
      ? createTrackingScalarSnapshot(element.shiftAngleDeg)
      : createTrackingScalarSnapshotWithDefault(0),
    scale: element.scale
      ? createTrackingScalarSnapshot(element.scale)
      : createTrackingScalarSnapshotWithDefault(1),
    opacity: element.opacity
      ? createTrackingScalarSnapshot(element.opacity)
      : createTrackingScalarSnapshotWithDefault(1),
    borderWidth: resolveBorderWidth(element.border),
    hasLeaderline: element.leaderline !== undefined,
    anchorX: element.anchorX
      ? createTrackingScalarSnapshot(element.anchorX)
      : createTrackingScalarSnapshotWithDefault(0),
    anchorY: element.anchorY
      ? createTrackingScalarSnapshot(element.anchorY)
      : createTrackingScalarSnapshotWithDefault(0),
    autoDirectionShiftAngleRotation:
      element.autoDirection?.shiftAngleRotation === true,
  };
};

const createTrackingElementSnapshotFromUpdate = (
  update: SpriteElementUpdate
): SpriteTrackingElementSnapshot => ({
  imageId: update.imageId,
  originLocation: normalizeOriginLocation(update.originLocation),
  mode: update.mode ?? 'surface',
  shiftDistance:
    update.shiftDistance !== undefined
      ? applyTrackingScalarUpdate(
          createTrackingScalarSnapshotWithDefault(0),
          update.shiftDistance,
          0
        )
      : createTrackingScalarSnapshotWithDefault(0),
  shiftAngleDeg:
    update.shiftAngleDeg !== undefined
      ? applyTrackingScalarUpdate(
          createTrackingScalarSnapshotWithDefault(0),
          update.shiftAngleDeg,
          0
        )
      : createTrackingScalarSnapshotWithDefault(0),
  scale:
    update.scale !== undefined
      ? applyTrackingScalarUpdate(
          createTrackingScalarSnapshotWithDefault(1),
          update.scale,
          0
        )
      : createTrackingScalarSnapshotWithDefault(1),
  opacity:
    update.opacity !== undefined
      ? applyTrackingScalarUpdate(
          createTrackingScalarSnapshotWithDefault(1),
          update.opacity,
          0
        )
      : createTrackingScalarSnapshotWithDefault(1),
  borderWidth:
    update.border === null ? 0 : resolveBorderWidth(update.border ?? undefined),
  hasLeaderline: update.leaderline !== undefined,
  anchorX:
    update.anchorX !== undefined
      ? applyTrackingScalarUpdate(
          createTrackingScalarSnapshotWithDefault(0),
          update.anchorX,
          0
        )
      : createTrackingScalarSnapshotWithDefault(0),
  anchorY:
    update.anchorY !== undefined
      ? applyTrackingScalarUpdate(
          createTrackingScalarSnapshotWithDefault(0),
          update.anchorY,
          0
        )
      : createTrackingScalarSnapshotWithDefault(0),
  autoDirectionShiftAngleRotation:
    update.autoDirection !== null &&
    update.autoDirection?.shiftAngleRotation === true,
});

const applyTrackingElementSnapshotUpdate = (
  state: SpriteTrackingElementSnapshot | null,
  update: SpriteElementUpdate,
  nowMs: number
): SpriteTrackingElementSnapshot => {
  const previous = state ?? createTrackingElementSnapshotFromUpdate(update);
  return {
    imageId: update.imageId === undefined ? previous.imageId : update.imageId,
    originLocation:
      update.originLocation === undefined
        ? previous.originLocation
        : normalizeOriginLocation(update.originLocation),
    mode: update.mode ?? previous.mode,
    shiftDistance:
      update.shiftDistance !== undefined
        ? applyTrackingScalarUpdate(
            previous.shiftDistance,
            update.shiftDistance,
            nowMs
          )
        : previous.shiftDistance,
    shiftAngleDeg:
      update.shiftAngleDeg !== undefined
        ? applyTrackingScalarUpdate(
            previous.shiftAngleDeg,
            update.shiftAngleDeg,
            nowMs
          )
        : previous.shiftAngleDeg,
    scale:
      update.scale !== undefined
        ? applyTrackingScalarUpdate(previous.scale, update.scale, nowMs)
        : previous.scale,
    opacity:
      update.opacity !== undefined
        ? applyTrackingScalarUpdate(previous.opacity, update.opacity, nowMs)
        : previous.opacity,
    borderWidth:
      update.border === undefined
        ? previous.borderWidth
        : update.border === null
          ? 0
          : resolveBorderWidth(update.border),
    hasLeaderline:
      update.leaderline === undefined
        ? previous.hasLeaderline
        : update.leaderline !== null,
    anchorX:
      update.anchorX !== undefined
        ? applyTrackingScalarUpdate(previous.anchorX, update.anchorX, nowMs)
        : previous.anchorX,
    anchorY:
      update.anchorY !== undefined
        ? applyTrackingScalarUpdate(previous.anchorY, update.anchorY, nowMs)
        : previous.anchorY,
    autoDirectionShiftAngleRotation:
      update.autoDirection === undefined
        ? previous.autoDirectionShiftAngleRotation
        : update.autoDirection === null
          ? false
          : update.autoDirection.shiftAngleRotation === undefined
            ? previous.autoDirectionShiftAngleRotation
            : update.autoDirection.shiftAngleRotation,
  };
};

/**
 * Creates a sprite tracking snapshot from a placement payload.
 * @param placement - Sprite placement.
 * @returns Tracking snapshot.
 */
export const createSpriteTrackingSnapshot = (
  placement: SpritePlacement
): SpriteTrackingSnapshot => ({
  sx: createTrackingScalarSnapshot(placement.sx),
  sy: createTrackingScalarSnapshot(placement.sy),
  sz: placement.sz ?? 0,
  opacity: placement.opacity
    ? createTrackingScalarSnapshot(placement.opacity)
    : createTrackingScalarSnapshotWithDefault(1),
  elements: placement.elements.map((element) =>
    createTrackingElementSnapshot(element)
  ),
});

/**
 * Applies a sprite update to an existing tracking snapshot.
 * @param state - Previous tracking snapshot.
 * @param update - Sprite update.
 * @param nowMs - Timestamp used to resolve the current interpolated value.
 * @returns Updated tracking snapshot.
 */
export const applySpriteTrackingSnapshotUpdate = (
  state: SpriteTrackingSnapshot,
  update: SpriteUpdate,
  nowMs: number
): SpriteTrackingSnapshot => {
  const nextElements = [...state.elements];
  const removedIndices: number[] = [];
  let nextCount = nextElements.length;

  if (update.elements !== undefined) {
    for (let index = 0; index < update.elements.length; index += 1) {
      const elementUpdate = update.elements[index];
      if (elementUpdate === undefined) {
        continue;
      }
      if (elementUpdate === null) {
        if (index >= 0 && index < nextCount) {
          removedIndices.push(index);
        }
        continue;
      }
      if (index === nextCount) {
        nextElements.push(
          applyTrackingElementSnapshotUpdate(null, elementUpdate, nowMs)
        );
        nextCount += 1;
        continue;
      }
      if (index < 0 || index >= nextCount) {
        continue;
      }
      nextElements[index] = applyTrackingElementSnapshotUpdate(
        nextElements[index] ?? null,
        elementUpdate,
        nowMs
      );
    }
  }

  if (removedIndices.length > 0) {
    removedIndices.sort((lhs, rhs) => rhs - lhs);
    for (const index of removedIndices) {
      if (index >= 0 && index < nextElements.length) {
        nextElements.splice(index, 1);
      }
    }
  }

  return {
    sx:
      update.sx !== undefined
        ? applyTrackingScalarUpdate(state.sx, update.sx, nowMs)
        : state.sx,
    sy:
      update.sy !== undefined
        ? applyTrackingScalarUpdate(state.sy, update.sy, nowMs)
        : state.sy,
    sz: update.sz ?? state.sz,
    opacity:
      update.opacity !== undefined
        ? applyTrackingScalarUpdate(state.opacity, update.opacity, nowMs)
        : state.opacity,
    elements: nextElements,
  };
};

/**
 * Resolves the current world-space base position from a tracking snapshot.
 * @param state - Tracking snapshot.
 * @param nowMs - Timestamp used to evaluate active interpolation.
 * @returns Current sprite base position.
 */
export const resolveSpriteTrackingSnapshotPosition = (
  state: SpriteTrackingSnapshot,
  nowMs: number
) => ({
  x: resolveTrackingSnapshotScalarValue(state.sx, nowMs),
  y: resolveTrackingSnapshotScalarValue(state.sy, nowMs),
  z: state.sz,
});

/**
 * Resolves the current sprite opacity used by camera tracking.
 * @param state - Tracking snapshot.
 * @param nowMs - Timestamp used to evaluate active interpolation.
 * @returns Current sprite opacity.
 */
export const resolveSpriteTrackingSnapshotOpacity = (
  state: SpriteTrackingSnapshot,
  nowMs: number
) => resolveTrackingSnapshotScalarValue(state.opacity, nowMs);
