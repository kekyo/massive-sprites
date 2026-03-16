// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  SizeInPixel,
  PolylinePlacement,
  PolylineNodePlacement,
  PolylineJoinCorrection,
  PolylineCapCorrection,
  PolylineState,
  PolylineUpdate,
  PolylineBulkUpdate,
  SpriteAtlasOptions,
  ObjectCameraState,
  ObjectCameraTrackingOptions,
  ObjectCameraTrackingState,
  CameraAdjustPositionOptions,
  CameraUpdate,
  SpriteElementBorderPlacement,
  SpriteElementBorderUpdate,
  SpriteElementPlacement,
  SpriteElementLeaderlinePlacement,
  SpriteElementLeaderlineUpdate,
  SpriteElementOriginLocationPlacement,
  SpriteElementRenderMode,
  SpriteElementUpdate,
  ObjectInterpolationEasing,
  ObjectInterpolationParameter,
  SpritePlacementAutoDirection,
  SpritePlacement,
  ObjectPlacementValue,
  ObjectRenderer,
  ObjectRendererOptions,
  SpriteState,
  SpriteImageRegisterOptions,
  SpriteTextGlyphDimensions,
  SpriteTextGlyphOptions,
  SpriteUpdate,
  SpriteUpdateAutoDirection,
  SpriteBulkUpdate,
  ObjectUpdateValue,
  ObjectWorldPosition,
  ObjectPickResult,
  ObjectRendererCameraStateChangeEvent,
  WasmInputPrecision,
} from './types';
import { resolveWasmExports, type WasmModule } from './wasm';
import { getNoOpLogger } from './logger';
import { createRotationLogger } from './debug-logs';
import {
  createPolylineProgram,
  createSpriteProgram,
  type PolylineShaderProgram,
  type SpriteShaderProgram,
} from './shader';
import { createTextureManager } from './texture';
import { createObjectPerformanceTracker } from './performance';
import {
  createWasmState,
  ensureCommandCapacity as ensureCommandCapacityForWasmState,
  ensureEntryDebugBuffers as ensureEntryDebugBuffersForWasmState,
  ensurePolylineBuffers as ensurePolylineBuffersForWasmState,
  ensureRenderBuffers as ensureRenderBuffersForWasmState,
  ensureResultCapacity as ensureResultCapacityForWasmState,
  ensureStateBuffers as ensureStateBuffersForWasmState,
  getCameraStateFromWasm,
  getPolylineStateFromWasm,
  getSpriteStateFromWasm,
  InputArrayBuffer,
  readCameraStateBuffer as readCameraStateBufferFromWasm,
  resolveInputArrayType,
  VIEW_MATRIX_SIZE,
  type WasmStateBufferAccess,
} from './states';
import {
  createCameraTrackingUpdate,
  hasMaterialCameraTrackingUpdate,
  normalizeCameraTrackingOptions,
  resolveCameraTrackingDistance,
  resolveCameraTrackingSolution,
} from './camera-tracking';
import {
  applySpriteTrackingSnapshotUpdate,
  createSpriteTrackingSnapshot,
  resolveSpriteTrackingSnapshotOpacity,
  resolveSpriteTrackingSnapshotPosition,
  resolveTrackingSnapshotScalarValue,
} from './tracking-snapshot';
import {
  createIdIndexMap,
  getNowMs,
  normalizeFiniteNumber,
  normalizePositiveFinite,
  normalizePositiveNumber,
  parseColorRGBA,
  toRadians,
} from './utils';
import {
  calculateDistanceScaleFactor,
  resolveDistanceScalingOptions,
  resolveDistanceScalingOptionsForWasm,
} from './scaling';
import * as wl from './generated/wasm-layout.generated';
import * as cl from './generated/command-layout.generated';

///////////////////////////////////////////////////////////////////////////////////

const RENDER_FLOATS_PER_VERTEX = 6;
const RENDER_VERTICES_PER_SPRITE = 4;
const RENDER_VERTEX_STRIDE_BYTES = RENDER_FLOATS_PER_VERTEX * 4;
const POLYLINE_FLOATS_PER_VERTEX = wl.POLYLINE_OUTPUT_STRIDE;
const POLYLINE_VERTEX_STRIDE_BYTES = POLYLINE_FLOATS_PER_VERTEX * 4;
const RENDER_INDICES_PER_SPRITE = 6;
const RENDER_MAX_INDEXED_VERTICES = 65535;
const RENDER_MAX_SPRITES_PER_BATCH = Math.floor(
  RENDER_MAX_INDEXED_VERTICES / RENDER_VERTICES_PER_SPRITE
);
const MAX_COMMANDS_PER_APPLY = 4096;
const MAX_COMMAND_BUFFER_USED_PER_APPLY = 262144;
const MAX_PENDING_RESULTS_PER_APPLY = 4096;
const PICK_RESULT_FIELDS = 4;
const PICK_RESULT_KIND_OFFSET = 0;
const PICK_RESULT_PRIMARY_ID_OFFSET = 1;
const PICK_RESULT_SECONDARY_ID_OFFSET = 2;
const ELEMENT_BORDER_MODE_CLEAR = cl.COMMAND_BORDER_MODE_CLEAR;
const ELEMENT_BORDER_MODE_SET = cl.COMMAND_BORDER_MODE_SET;

type TrackingVector3 = {
  readonly x: number;
  readonly y: number;
  readonly z: number;
};

type TrackingBasis = {
  readonly right: TrackingVector3;
  readonly up: TrackingVector3;
  readonly forward: TrackingVector3;
};

type TrackingBoundsAccumulator = {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
  count: number;
};

type TrackingElementSnapshot = NonNullable<
  ReturnType<typeof createSpriteTrackingSnapshot>['elements'][number]
>;

type TrackingElementGeometry = {
  readonly parentPivot: TrackingVector3;
  readonly parentBasisRight: TrackingVector3;
  readonly parentBasisUp: TrackingVector3;
  readonly pivot: TrackingVector3;
  readonly basisRight: TrackingVector3;
  readonly basisUp: TrackingVector3;
  readonly halfWidth: number;
  readonly halfHeight: number;
  readonly anchorOffsetX: number;
  readonly anchorOffsetY: number;
  readonly borderWidth: number;
  readonly shiftDistance: number;
  readonly autoDirectionShiftAngleRotation: boolean;
  readonly hasLeaderline: boolean;
};

type SpriteRenderContext = SpriteShaderProgram & {
  readonly buffer: WebGLBuffer;
  readonly indexBuffer: WebGLBuffer;
  readonly indexBufferSpriteCapacity: number;
};

type PolylineRenderContext = PolylineShaderProgram & {
  readonly buffer: WebGLBuffer;
};

interface RenderContext {
  readonly gl: WebGLRenderingContext;
  readonly sprite: SpriteRenderContext;
  readonly polyline: PolylineRenderContext;
}

///////////////////////////////////////////////////////////////////////////////////

const TRACKING_ZERO_BASIS: TrackingBasis = {
  right: { x: 1, y: 0, z: 0 },
  up: { x: 0, y: 1, z: 0 },
  forward: { x: 0, y: 0, z: 1 },
};

const createTrackingBoundsAccumulator = (): TrackingBoundsAccumulator => ({
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  minZ: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
  maxZ: Number.NEGATIVE_INFINITY,
  count: 0,
});

const dotTracking3 = (lhs: TrackingVector3, rhs: TrackingVector3) =>
  lhs.x * rhs.x + lhs.y * rhs.y + lhs.z * rhs.z;

const addTrackingScaled3 = (
  base: TrackingVector3,
  direction: TrackingVector3,
  scale: number
): TrackingVector3 => ({
  x: base.x + direction.x * scale,
  y: base.y + direction.y * scale,
  z: base.z + direction.z * scale,
});

const includeTrackingPoint = (
  bounds: TrackingBoundsAccumulator,
  basis: TrackingBasis,
  point: TrackingVector3
) => {
  const localX = dotTracking3(point, basis.right);
  const localY = dotTracking3(point, basis.up);
  const localZ = dotTracking3(point, basis.forward);
  bounds.minX = Math.min(bounds.minX, localX);
  bounds.minY = Math.min(bounds.minY, localY);
  bounds.minZ = Math.min(bounds.minZ, localZ);
  bounds.maxX = Math.max(bounds.maxX, localX);
  bounds.maxY = Math.max(bounds.maxY, localY);
  bounds.maxZ = Math.max(bounds.maxZ, localZ);
  bounds.count += 1;
};

const includeTrackingOrientedRect = (
  bounds: TrackingBoundsAccumulator,
  trackingBasis: TrackingBasis,
  center: TrackingVector3,
  localRight: TrackingVector3,
  localUp: TrackingVector3,
  halfWidth: number,
  halfHeight: number
) => {
  const centerX = dotTracking3(center, trackingBasis.right);
  const centerY = dotTracking3(center, trackingBasis.up);
  const centerZ = dotTracking3(center, trackingBasis.forward);
  const extentX =
    Math.abs(dotTracking3(localRight, trackingBasis.right)) * halfWidth +
    Math.abs(dotTracking3(localUp, trackingBasis.right)) * halfHeight;
  const extentY =
    Math.abs(dotTracking3(localRight, trackingBasis.up)) * halfWidth +
    Math.abs(dotTracking3(localUp, trackingBasis.up)) * halfHeight;
  const extentZ =
    Math.abs(dotTracking3(localRight, trackingBasis.forward)) * halfWidth +
    Math.abs(dotTracking3(localUp, trackingBasis.forward)) * halfHeight;
  bounds.minX = Math.min(bounds.minX, centerX - extentX);
  bounds.minY = Math.min(bounds.minY, centerY - extentY);
  bounds.minZ = Math.min(bounds.minZ, centerZ - extentZ);
  bounds.maxX = Math.max(bounds.maxX, centerX + extentX);
  bounds.maxY = Math.max(bounds.maxY, centerY + extentY);
  bounds.maxZ = Math.max(bounds.maxZ, centerZ + extentZ);
  bounds.count += 1;
};

const resolveTrackingCameraBasis = (
  cameraState: ObjectCameraState
): TrackingBasis => {
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

const resolveBillboardPerspectiveBasis = (
  forwardX: number,
  forwardY: number,
  forwardZ: number
) => {
  let upX = -forwardX * forwardY;
  let upY = 1 - forwardY * forwardY;
  let upZ = -forwardZ * forwardY;
  let upLenSq = upX * upX + upY * upY + upZ * upZ;
  if (upLenSq < 1.0e-6) {
    upX = 1 - forwardX * forwardX;
    upY = -forwardY * forwardX;
    upZ = -forwardZ * forwardX;
    upLenSq = upX * upX + upY * upY + upZ * upZ;
  }
  if (upLenSq < 1.0e-6) {
    upX = 0;
    upY = 1;
    upZ = 0;
    upLenSq = 1;
  }
  const upInvLen = 1 / Math.sqrt(upLenSq);
  upX *= upInvLen;
  upY *= upInvLen;
  upZ *= upInvLen;

  let rightX = upY * forwardZ - upZ * forwardY;
  let rightY = upZ * forwardX - upX * forwardZ;
  let rightZ = upX * forwardY - upY * forwardX;
  const rightLenSq = rightX * rightX + rightY * rightY + rightZ * rightZ;
  if (rightLenSq > 0) {
    const rightInvLen = 1 / Math.sqrt(rightLenSq);
    rightX *= rightInvLen;
    rightY *= rightInvLen;
    rightZ *= rightInvLen;
  }

  return {
    right: { x: rightX, y: rightY, z: rightZ },
    up: {
      x: forwardY * rightZ - forwardZ * rightY,
      y: forwardZ * rightX - forwardX * rightZ,
      z: forwardX * rightY - forwardY * rightX,
    },
  };
};

const resolveTrackingBoundsBaseDistance = (
  cameraState: ObjectCameraState,
  bounds: TrackingBoundsAccumulator,
  padding: number
) => {
  if (bounds.count <= 0) {
    return 0;
  }
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerY = (bounds.minY + bounds.maxY) * 0.5;
  const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
  const xs = [bounds.minX - centerX, bounds.maxX - centerX];
  const ys = [bounds.minY - centerY, bounds.maxY - centerY];
  const zs = [bounds.minZ - centerZ, bounds.maxZ - centerZ];
  const fovYRad = toRadians(cameraState.fovY.value);
  const tanHalfY = Math.tan(fovYRad / 2);
  const aspectRatio =
    Number.isFinite(cameraState.aspectRatio) && cameraState.aspectRatio > 0
      ? cameraState.aspectRatio
      : 1;
  const tanHalfX = tanHalfY * aspectRatio;
  let distance = 1.0e-6;
  for (const localX of xs) {
    for (const localY of ys) {
      for (const localZ of zs) {
        if (tanHalfX > 1.0e-6) {
          distance = Math.max(
            distance,
            (Math.abs(localX) * padding) / tanHalfX - localZ
          );
        }
        if (tanHalfY > 1.0e-6) {
          distance = Math.max(
            distance,
            (Math.abs(localY) * padding) / tanHalfY - localZ
          );
        }
      }
    }
  }
  return Math.max(1.0e-6, distance);
};

const resolveTrackingBoundsCenter = (
  bounds: TrackingBoundsAccumulator,
  basis: TrackingBasis
): ObjectWorldPosition => {
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerY = (bounds.minY + bounds.maxY) * 0.5;
  const centerZ = (bounds.minZ + bounds.maxZ) * 0.5;
  return {
    x:
      basis.right.x * centerX +
      basis.up.x * centerY +
      basis.forward.x * centerZ,
    y:
      basis.right.y * centerX +
      basis.up.y * centerY +
      basis.forward.y * centerZ,
    z:
      basis.right.z * centerX +
      basis.up.z * centerY +
      basis.forward.z * centerZ,
  };
};

const DEFAULT_SIGMOID_K = 10;
const DEFAULT_SIGMOID_MID = 0.5;
const expApproxBuffer = new ArrayBuffer(4);
const expApproxInt = new Int32Array(expApproxBuffer);
const expApproxFloat = new Float32Array(expApproxBuffer);

const expApproxF32 = (value: number) => {
  const clamped = Math.max(
    -wl.COMMON_EXP_APPROX_CLAMP,
    Math.min(wl.COMMON_EXP_APPROX_CLAMP, value)
  );
  const scaled = Math.fround(
    clamped * wl.COMMON_EXP_APPROX_SCALE + wl.COMMON_EXP_APPROX_BIAS
  );
  expApproxInt[0] = scaled | 0;
  return expApproxFloat[0]!;
};

const expApproxF64 = (value: number) => {
  const clamped = Math.max(
    -wl.COMMON_EXP_APPROX_CLAMP,
    Math.min(wl.COMMON_EXP_APPROX_CLAMP, value)
  );
  return Math.exp(clamped);
};

const sigmoidRaw = (
  t: number,
  k: number,
  mid: number,
  precision: WasmInputPrecision
) =>
  1 /
  (1 +
    (precision === 'f64'
      ? expApproxF64(-k * (t - mid))
      : expApproxF32(-k * (t - mid))));

type EasingMode = 'in' | 'out' | 'in-out';
type EasingModeCode = 0 | 1 | 2;

interface ResolvedInterpolationEasingPayload {
  readonly type: number;
  readonly param0: number;
  readonly param1: number;
  readonly param2: number;
  readonly param3: number;
}

const POLYLINE_CORRECTION_NONE = wl.POLYLINE_CORRECTION_MODE_NONE;
const POLYLINE_CORRECTION_FAN = wl.POLYLINE_CORRECTION_MODE_FAN;

type PolylineCorrectionModeCode =
  | typeof POLYLINE_CORRECTION_NONE
  | typeof POLYLINE_CORRECTION_FAN;

interface NormalizedPolylineJoinCorrection {
  readonly mode: PolylineCorrectionModeCode;
  readonly intermediatePointCount: number;
}

interface NormalizedPolylineCapCorrection {
  readonly mode: PolylineCorrectionModeCode;
  readonly pointCount: number;
}

interface NormalizedPolylineRenderOptions {
  readonly joinCorrection: NormalizedPolylineJoinCorrection;
  readonly capCorrection: NormalizedPolylineCapCorrection;
}

const DEFAULT_NORMALIZED_POLYLINE_JOIN_CORRECTION: NormalizedPolylineJoinCorrection =
  {
    mode: POLYLINE_CORRECTION_FAN,
    intermediatePointCount: 0,
  };

const DEFAULT_NORMALIZED_POLYLINE_CAP_CORRECTION: NormalizedPolylineCapCorrection =
  {
    mode: POLYLINE_CORRECTION_NONE,
    pointCount: 0,
  };

const DEFAULT_NORMALIZED_POLYLINE_RENDER_OPTIONS: NormalizedPolylineRenderOptions =
  {
    joinCorrection: DEFAULT_NORMALIZED_POLYLINE_JOIN_CORRECTION,
    capCorrection: DEFAULT_NORMALIZED_POLYLINE_CAP_CORRECTION,
  };

const EASING_MODE_IN_OUT = 0 as const;
const EASING_MODE_IN = 1 as const;
const EASING_MODE_OUT = 2 as const;

const normalizeEasingMode = (
  mode: EasingMode | undefined,
  fallback: EasingMode
): EasingMode => {
  if (mode === 'in' || mode === 'out' || mode === 'in-out') {
    return mode;
  }
  return fallback;
};

const encodeEasingMode = (mode: EasingMode): EasingModeCode => {
  switch (mode) {
    case 'in':
      return EASING_MODE_IN;
    case 'out':
      return EASING_MODE_OUT;
    case 'in-out':
    default:
      return EASING_MODE_IN_OUT;
  }
};

const resolveInterpolationEasingPayload = (
  easing: ObjectInterpolationEasing,
  precision: WasmInputPrecision
): ResolvedInterpolationEasingPayload => {
  switch (easing.type) {
    case 'linear':
      return {
        type: wl.INTERPOLATION_EASING_LINEAR,
        param0: 0,
        param1: 0,
        param2: 0,
        param3: 0,
      };
    case 'sigmoid': {
      const k = easing.k ?? DEFAULT_SIGMOID_K;
      const mid = easing.mid ?? DEFAULT_SIGMOID_MID;
      if (!Number.isFinite(k) || k <= 0) {
        throw new Error('Sigmoid k must be a positive number.');
      }
      if (!Number.isFinite(mid)) {
        throw new Error('Sigmoid mid must be a finite number.');
      }
      const s0 = sigmoidRaw(0, k, mid, precision);
      const s1 = sigmoidRaw(1, k, mid, precision);
      const span = s1 - s0;
      const invSpan = span === 0 ? 0 : 1 / span;
      return {
        type: wl.INTERPOLATION_EASING_SIGMOID,
        param0: k,
        param1: mid,
        param2: s0,
        param3: invSpan,
      };
    }
    case 'ease': {
      const power = normalizePositiveFinite(easing.power, 3);
      const mode = normalizeEasingMode(easing.mode, 'in-out');
      return {
        type: wl.INTERPOLATION_EASING_EASE,
        param0: power,
        param1: encodeEasingMode(mode),
        param2: 0,
        param3: 0,
      };
    }
    case 'exponential': {
      const exponent = normalizePositiveFinite(easing.exponent, 5);
      const mode = normalizeEasingMode(easing.mode, 'in-out');
      return {
        type: wl.INTERPOLATION_EASING_EXPONENTIAL,
        param0: exponent,
        param1: encodeEasingMode(mode),
        param2: 0,
        param3: 0,
      };
    }
    case 'quadratic': {
      const mode = normalizeEasingMode(easing.mode, 'in-out');
      return {
        type: wl.INTERPOLATION_EASING_QUADRATIC,
        param0: encodeEasingMode(mode),
        param1: 0,
        param2: 0,
        param3: 0,
      };
    }
    case 'cubic': {
      const mode = normalizeEasingMode(easing.mode, 'in-out');
      return {
        type: wl.INTERPOLATION_EASING_CUBIC,
        param0: encodeEasingMode(mode),
        param1: 0,
        param2: 0,
        param3: 0,
      };
    }
    case 'sine': {
      const mode = normalizeEasingMode(easing.mode, 'in-out');
      const amplitude = normalizePositiveFinite(easing.amplitude, 1);
      return {
        type: wl.INTERPOLATION_EASING_SINE,
        param0: encodeEasingMode(mode),
        param1: amplitude,
        param2: 0,
        param3: 0,
      };
    }
    case 'bounce': {
      const bounces = normalizePositiveFinite(easing.bounces, 3);
      const decay = normalizePositiveFinite(easing.decay, 0.5);
      return {
        type: wl.INTERPOLATION_EASING_BOUNCE,
        param0: bounces,
        param1: decay,
        param2: 0,
        param3: 0,
      };
    }
    case 'back': {
      const overshoot = normalizePositiveFinite(easing.overshoot, 1.70158);
      return {
        type: wl.INTERPOLATION_EASING_BACK,
        param0: overshoot,
        param1: 0,
        param2: 0,
        param3: 0,
      };
    }
    default:
      throw new Error('Unknown interpolation easing.');
  }
};

interface PendingCommand {
  index: number;
  kind:
    | 'addSprite'
    | 'updateSprite'
    | 'removeSprite'
    | 'addPolyline'
    | 'updatePolyline'
    | 'removePolyline'
    | 'updateCamera'
    | 'adjustCameraPosition'
    | 'setTextureInfo'
    | 'setTiledTextureInfo'
    | 'setTextureTileInfo';
  placement?: SpritePlacement | PolylinePlacement;
  spriteId?: number;
  polylineId?: number;
  spriteIndex?: number;
  polylineIndex?: number;
  elementCount?: number;
  nodeCount?: number;
  polylineRenderOptions?: NormalizedPolylineRenderOptions;
  leaderlineFlags?: boolean[];
  borderFlags?: boolean[];
  elementTexIndices?: number[];
  elementUpdates?: Array<{ index: number; kind: number }>;
  elementCommands?: Array<{
    index: number;
    update: SpriteElementUpdate | null;
  }>;
  camera?: CameraUpdate;
  adjustPayload?: CameraAdjustPayload;
  resultIndex?: number;
  resolve?: (spriteId?: number) => void;
  reject?: (error: Error) => void;
}

const createCommandError = (
  message: string,
  placement?: SpritePlacement | PolylinePlacement
) => {
  const error = new Error(message);
  if (placement) {
    (error as { placement?: SpritePlacement | PolylinePlacement }).placement =
      placement;
  }
  return error;
};

const parseResultIndex = (value: number) =>
  Number.isFinite(value) ? Math.trunc(value) : Number.NaN;

const parseCommandIndex = (value: number) =>
  Number.isFinite(value) ? Math.trunc(value) : Number.NaN;

type PromiseHandlers<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
};

const createPromiseHandlers = <T>(): PromiseHandlers<T> => {
  let resolve: (value: T) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<T>((resolveFn, rejectFn) => {
    resolve = resolveFn;
    reject = rejectFn;
  });
  return { promise, resolve, reject };
};

const createCommandErrorFromPending = (
  message: string,
  command: PendingCommand
) => {
  const error = createCommandError(message, command.placement);
  if (command.spriteId !== undefined) {
    (error as { spriteId?: number }).spriteId = command.spriteId;
  }
  if (command.polylineId !== undefined) {
    (error as { polylineId?: number }).polylineId = command.polylineId;
  }
  if (command.elementUpdates) {
    (
      error as { elementUpdates?: Array<{ index: number; kind: number }> }
    ).elementUpdates = command.elementUpdates;
  }
  if (command.nodeCount !== undefined) {
    (error as { nodeCount?: number }).nodeCount = command.nodeCount;
  }
  if (command.camera) {
    (error as { camera?: CameraUpdate }).camera = command.camera;
  }
  if (command.adjustPayload) {
    (error as { payload?: CameraAdjustPayload }).payload =
      command.adjustPayload;
  }
  return error;
};

const createCameraCommandError = (message: string, camera: CameraUpdate) => {
  const error = new Error(message);
  (error as { camera?: CameraUpdate }).camera = camera;
  return error;
};

type CameraAdjustPayload = CameraAdjustPositionOptions;

const createCameraAdjustCommandError = (
  message: string,
  payload: CameraAdjustPayload
) => {
  const error = new Error(message);
  (error as { payload?: CameraAdjustPayload }).payload = payload;
  return error;
};

const createCameraAdjustPayload = (
  options: CameraAdjustPayload
): CameraAdjustPayload => ({
  ...(options.pitch !== undefined ? { pitch: options.pitch } : {}),
  ...(options.fov !== undefined ? { fov: options.fov } : {}),
  ...(options.interpolation !== undefined
    ? { interpolation: options.interpolation }
    : {}),
  ...(options.near !== undefined ? { near: options.near } : {}),
  ...(options.far !== undefined ? { far: options.far } : {}),
});

const isFiniteUpdateValue = (
  value: ObjectUpdateValue<number> | null | undefined
) => !!value && (value.value === undefined || Number.isFinite(value.value));

const isUpdateValueSpecified = (
  value: ObjectUpdateValue<number> | null | undefined
): value is ObjectUpdateValue<number> =>
  !!value && (value.value !== undefined || value.interpolation !== undefined);

const isUpdateRotationSpecified = (
  value: ObjectUpdateValue<number> | null | undefined
): value is ObjectUpdateValue<number> => isUpdateValueSpecified(value);

const isUpdateAutoDirectionSpecified = (
  value: SpriteUpdateAutoDirection | null | undefined
): value is SpriteUpdateAutoDirection | null =>
  value === null ||
  (!!value &&
    (value.space !== undefined ||
      value.mode !== undefined ||
      value.shiftAngleRotation !== undefined ||
      value.minDistance !== undefined));

const createSpriteIdCommandError = (
  message: string,
  spriteId: number,
  update?: SpriteUpdate
) => {
  const error = new Error(message);
  (error as { spriteId?: number; update?: SpriteUpdate }).spriteId = spriteId;
  if (update) {
    (error as { update?: SpriteUpdate }).update = update;
  }
  return error;
};

const createPolylineIdCommandError = (
  message: string,
  polylineId: number,
  update?: PolylineUpdate
) => {
  const error = new Error(message);
  (error as { polylineId?: number; update?: PolylineUpdate }).polylineId =
    polylineId;
  if (update) {
    (error as { update?: PolylineUpdate }).update = update;
  }
  return error;
};

///////////////////////////////////////////////////////////////////////////////////

const resolveInterpolationMode = (
  mode: ObjectInterpolationParameter['mode']
) =>
  mode === 'feedforward'
    ? wl.INTERPOLATION_MODE_FEEDFORWARD
    : wl.INTERPOLATION_MODE_FEEDBACK;

const resolveCameraTrackingInterpolationPayload = (
  interpolation: ObjectInterpolationParameter | null | undefined,
  precision: WasmInputPrecision
) => {
  if (interpolation === undefined) {
    return {
      kind: wl.CAMERA_TRACKING_INTERPOLATION_KEEP,
      mode: 0,
      duration: 0,
      easing: 0,
      param0: 0,
      param1: 0,
      param2: 0,
      param3: 0,
    };
  }
  if (interpolation === null) {
    return {
      kind: wl.CAMERA_TRACKING_INTERPOLATION_CLEAR,
      mode: 0,
      duration: 0,
      easing: 0,
      param0: 0,
      param1: 0,
      param2: 0,
      param3: 0,
    };
  }
  const easing = resolveInterpolationEasingPayload(
    interpolation.easing,
    precision
  );
  return {
    kind: wl.CAMERA_TRACKING_INTERPOLATION_SET,
    mode: resolveInterpolationMode(interpolation.mode),
    duration: interpolation.durationMs,
    easing: easing.type,
    param0: easing.param0,
    param1: easing.param1,
    param2: easing.param2,
    param3: easing.param3,
  };
};

const resolveElementRenderMode = (mode: SpriteElementRenderMode): number => {
  switch (mode) {
    case 'billboard_perspective':
      return wl.COMMON_RENDER_MODE_BILLBOARD_PERSPECTIVE;
    case 'billboard':
      return wl.COMMON_RENDER_MODE_BILLBOARD;
    case 'surface':
    default:
      return wl.COMMON_RENDER_MODE_SURFACE;
  }
};

type InterpolationCommandOffsets = {
  readonly has: number;
  readonly value: number;
  readonly hasInterpolation: number;
  readonly keepInterpolation: number;
  readonly mode: number;
  readonly duration: number;
  readonly easing: number;
  readonly param0: number;
  readonly param1: number;
  readonly param2: number;
  readonly param3: number;
};

type InterpolationCommandValue =
  | ObjectUpdateValue<number>
  | ObjectPlacementValue<number>;

const AUTO_DIRECTION_MODE_NONE = wl.AUTO_DIRECTION_MODE_NONE;
const AUTO_DIRECTION_MODE_ROTATION = wl.AUTO_DIRECTION_MODE_ROTATION;
const AUTO_DIRECTION_MODE_FLIPPING = wl.AUTO_DIRECTION_MODE_FLIPPING;
const AUTO_DIRECTION_SPACE_WORLD = wl.AUTO_DIRECTION_SPACE_WORLD;
const AUTO_DIRECTION_SPACE_PARENT_LOCAL = wl.AUTO_DIRECTION_SPACE_PARENT_LOCAL;

const VALUE_INTERPOLATION_OFFSETS: InterpolationCommandOffsets = {
  has: cl.COMMAND_VALUE_HAS_OFFSET,
  value: cl.COMMAND_VALUE_VALUE_OFFSET,
  hasInterpolation: cl.COMMAND_VALUE_HAS_INTERP_OFFSET,
  keepInterpolation: cl.COMMAND_VALUE_KEEP_INTERP_OFFSET,
  mode: cl.COMMAND_VALUE_MODE_OFFSET,
  duration: cl.COMMAND_VALUE_DURATION_OFFSET,
  easing: cl.COMMAND_VALUE_EASING_OFFSET,
  param0: cl.COMMAND_VALUE_PARAM0_OFFSET,
  param1: cl.COMMAND_VALUE_PARAM1_OFFSET,
  param2: cl.COMMAND_VALUE_PARAM2_OFFSET,
  param3: cl.COMMAND_VALUE_PARAM3_OFFSET,
} as const;

const ROTATION_INTERPOLATION_OFFSETS: InterpolationCommandOffsets = {
  has: cl.COMMAND_ROTATION_HAS_OFFSET,
  value: cl.COMMAND_ROTATION_VALUE_OFFSET,
  hasInterpolation: cl.COMMAND_ROTATION_HAS_INTERP_OFFSET,
  keepInterpolation: cl.COMMAND_ROTATION_KEEP_INTERP_OFFSET,
  mode: cl.COMMAND_ROTATION_MODE_OFFSET,
  duration: cl.COMMAND_ROTATION_DURATION_OFFSET,
  easing: cl.COMMAND_ROTATION_EASING_OFFSET,
  param0: cl.COMMAND_ROTATION_PARAM0_OFFSET,
  param1: cl.COMMAND_ROTATION_PARAM1_OFFSET,
  param2: cl.COMMAND_ROTATION_PARAM2_OFFSET,
  param3: cl.COMMAND_ROTATION_PARAM3_OFFSET,
} as const;

const resolveAutoDirectionMode = (type: 'rotation' | 'flipping') =>
  type === 'flipping'
    ? AUTO_DIRECTION_MODE_FLIPPING
    : AUTO_DIRECTION_MODE_ROTATION;

const resolveAutoDirectionSpace = (space: 'world' | 'parent_local') =>
  space === 'parent_local'
    ? AUTO_DIRECTION_SPACE_PARENT_LOCAL
    : AUTO_DIRECTION_SPACE_WORLD;

const writeAutoDirectionInterpolationCommand = (
  buffer: InputArrayBuffer,
  baseOffset: number,
  interpolation: ObjectInterpolationParameter | null | undefined,
  precision: WasmInputPrecision,
  allowMissingInterpolation: boolean
) => {
  if (interpolation === undefined) {
    if (!allowMissingInterpolation) {
      buffer[
        baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_CLEAR_OFFSET
      ] = 0;
    }
    return;
  }
  if (interpolation === null) {
    buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_CLEAR_OFFSET] =
      1;
    return;
  }
  const payload = resolveInterpolationEasingPayload(
    interpolation.easing,
    precision
  );
  buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_HAS_OFFSET] = 1;
  buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_MODE_OFFSET] =
    resolveInterpolationMode(interpolation.mode);
  buffer[
    baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_DURATION_OFFSET
  ] = interpolation.durationMs;
  buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_EASING_OFFSET] =
    payload.type;
  buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_PARAM0_OFFSET] =
    payload.param0;
  buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_PARAM1_OFFSET] =
    payload.param1;
  buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_PARAM2_OFFSET] =
    payload.param2;
  buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_PARAM3_OFFSET] =
    payload.param3;
};

const writeInterpolationCommand = (
  buffer: InputArrayBuffer,
  baseOffset: number,
  offsets: InterpolationCommandOffsets,
  value: InterpolationCommandValue,
  precision: WasmInputPrecision,
  allowMissingInterpolation: boolean,
  allowMissingValue: boolean
) => {
  const hasValue = value.value !== undefined;
  if (!hasValue && !allowMissingValue) {
    throw new Error('Value is required.');
  }
  buffer[baseOffset + offsets.has] = hasValue ? 1 : 0;
  buffer[baseOffset + offsets.value] = hasValue ? value.value : 0;
  buffer[baseOffset + offsets.hasInterpolation] = 0;
  buffer[baseOffset + offsets.keepInterpolation] = 0;
  const interpolation = value.interpolation;
  if (interpolation === undefined) {
    if (allowMissingInterpolation && hasValue) {
      buffer[baseOffset + offsets.keepInterpolation] = 1;
    }
    return;
  }
  if (interpolation === null) {
    if (!hasValue) {
      const payload = resolveInterpolationEasingPayload(
        { type: 'linear' },
        precision
      );
      buffer[baseOffset + offsets.hasInterpolation] = 1;
      buffer[baseOffset + offsets.mode] = resolveInterpolationMode('feedback');
      buffer[baseOffset + offsets.duration] = 0;
      buffer[baseOffset + offsets.easing] = payload.type;
      buffer[baseOffset + offsets.param0] = payload.param0;
      buffer[baseOffset + offsets.param1] = payload.param1;
      buffer[baseOffset + offsets.param2] = payload.param2;
      buffer[baseOffset + offsets.param3] = payload.param3;
    }
    return;
  }
  const payload = resolveInterpolationEasingPayload(
    interpolation.easing,
    precision
  );
  buffer[baseOffset + offsets.hasInterpolation] = 1;
  buffer[baseOffset + offsets.mode] = resolveInterpolationMode(
    interpolation.mode
  );
  buffer[baseOffset + offsets.duration] = interpolation.durationMs;
  buffer[baseOffset + offsets.easing] = payload.type;
  buffer[baseOffset + offsets.param0] = payload.param0;
  buffer[baseOffset + offsets.param1] = payload.param1;
  buffer[baseOffset + offsets.param2] = payload.param2;
  buffer[baseOffset + offsets.param3] = payload.param3;
};

const writeValueCommand = (
  buffer: InputArrayBuffer,
  baseOffset: number,
  value: ObjectUpdateValue<number> | ObjectPlacementValue<number>,
  precision: WasmInputPrecision,
  allowMissingInterpolation: boolean,
  allowMissingValue: boolean
) => {
  writeInterpolationCommand(
    buffer,
    baseOffset,
    VALUE_INTERPOLATION_OFFSETS,
    value,
    precision,
    allowMissingInterpolation,
    allowMissingValue
  );
};

const writeOptionalCommand = (
  buffer: InputArrayBuffer,
  baseOffset: number,
  value: number
) => {
  buffer[baseOffset + cl.COMMAND_OPTIONAL_HAS_OFFSET] = 1;
  buffer[baseOffset + cl.COMMAND_OPTIONAL_VALUE_OFFSET] = value;
};

const normalizeLayerValue = (value: number) => {
  if (!Number.isFinite(value)) {
    throw new Error('Layer must be a finite number.');
  }
  const floored = Math.floor(value);
  if (floored < 0 || floored > 31) {
    throw new Error('Layer must be between 0 and 31.');
  }
  return floored;
};

const normalizeOrderValue = (value: number) => {
  if (!Number.isFinite(value)) {
    throw new Error('Order must be a finite number.');
  }
  const floored = Math.floor(value);
  if (floored < 0 || floored > 7) {
    throw new Error('Order must be between 0 and 7.');
  }
  return floored;
};

const normalizeVisibilityDistanceValue = (value: number) =>
  normalizePositiveNumber(value, 'Visibility distance');

const writeVisibilityDistanceCommand = (
  buffer: InputArrayBuffer,
  baseOffset: number,
  value: number | null | undefined
) => {
  if (value === undefined) {
    return;
  }
  writeOptionalCommand(
    buffer,
    baseOffset,
    value === null ? 0 : normalizeVisibilityDistanceValue(value)
  );
};

const normalizePolylineColor = (color: PolylinePlacement['color']) => {
  if (typeof color === 'string') {
    const parsed = parseColorRGBA(color);
    return {
      color0: parsed,
      color1: parsed,
      repeatLength: 0,
    };
  }
  if (!color || typeof color !== 'object') {
    throw new Error('Color must be a valid PolylineColor.');
  }
  const color0 = parseColorRGBA(color.color0);
  const color1 = parseColorRGBA(color.color1);
  const repeatLength = normalizePositiveNumber(
    color.repeatLength,
    'Repeat length'
  );
  return { color0, color1, repeatLength };
};

const normalizePolylineNodes = (nodes: readonly PolylineNodePlacement[]) => {
  if (!Array.isArray(nodes)) {
    throw new Error('Polyline nodes must be an array.');
  }
  if (nodes.length < 2) {
    throw new Error('Polyline nodes must contain at least 2 entries.');
  }
  return nodes.map((node, index) => {
    if (!node || typeof node !== 'object') {
      throw new Error(`Polyline node at index ${index} is invalid.`);
    }
    const x = normalizeFiniteNumber(node.x, 'Node x');
    const y = normalizeFiniteNumber(node.y, 'Node y');
    const thickness = normalizePositiveNumber(node.thickness, 'Node thickness');
    return { x, y, thickness };
  });
};

const normalizePolylineCorrectionCount = (
  value: number,
  name: string,
  minimum: number
) => {
  if (
    !Number.isFinite(value) ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new Error(
      `${name} must be an integer greater than or equal to ${minimum}.`
    );
  }
  return value;
};

const normalizePolylineJoinCorrection = (
  correction: PolylineJoinCorrection | undefined
): NormalizedPolylineJoinCorrection => {
  if (correction === undefined) {
    return DEFAULT_NORMALIZED_POLYLINE_JOIN_CORRECTION;
  }
  if (!correction || typeof correction !== 'object') {
    throw new Error('Join correction must be a valid PolylineJoinCorrection.');
  }
  if (correction.type === 'none') {
    return {
      mode: POLYLINE_CORRECTION_NONE,
      intermediatePointCount: 0,
    };
  }
  if (correction.type === 'fan') {
    return {
      mode: POLYLINE_CORRECTION_FAN,
      intermediatePointCount: normalizePolylineCorrectionCount(
        correction.intermediatePointCount,
        'Join correction intermediatePointCount',
        0
      ),
    };
  }
  throw new Error('Join correction must be a valid PolylineJoinCorrection.');
};

const normalizePolylineCapCorrection = (
  correction: PolylineCapCorrection | undefined
): NormalizedPolylineCapCorrection => {
  if (correction === undefined) {
    return DEFAULT_NORMALIZED_POLYLINE_CAP_CORRECTION;
  }
  if (!correction || typeof correction !== 'object') {
    throw new Error('Cap correction must be a valid PolylineCapCorrection.');
  }
  if (correction.type === 'none') {
    return {
      mode: POLYLINE_CORRECTION_NONE,
      pointCount: 0,
    };
  }
  if (correction.type === 'fan') {
    return {
      mode: POLYLINE_CORRECTION_FAN,
      pointCount: normalizePolylineCorrectionCount(
        correction.pointCount,
        'Cap correction pointCount',
        1
      ),
    };
  }
  throw new Error('Cap correction must be a valid PolylineCapCorrection.');
};

const normalizePolylineRenderOptions = (
  joinCorrection: PolylineJoinCorrection | undefined,
  capCorrection: PolylineCapCorrection | undefined
): NormalizedPolylineRenderOptions => ({
  joinCorrection: normalizePolylineJoinCorrection(joinCorrection),
  capCorrection: normalizePolylineCapCorrection(capCorrection),
});

const estimatePolylineVertexCount = (
  nodeCount: number,
  renderOptions: NormalizedPolylineRenderOptions
) => {
  if (nodeCount < 2) {
    return 0;
  }
  const segmentVertexCount = (nodeCount - 1) * 6;
  const joinVertexCount =
    renderOptions.joinCorrection.mode === POLYLINE_CORRECTION_FAN &&
    nodeCount > 2
      ? (nodeCount - 2) *
        3 *
        (renderOptions.joinCorrection.intermediatePointCount + 1)
      : 0;
  const capVertexCount =
    renderOptions.capCorrection.mode === POLYLINE_CORRECTION_FAN
      ? 2 * 3 * (renderOptions.capCorrection.pointCount + 1)
      : 0;
  return segmentVertexCount + joinVertexCount + capVertexCount;
};

const writePolylineRenderOptions = (
  buffer: InputArrayBuffer,
  joinModeOffset: number,
  joinIntermediatePointCountOffset: number,
  capModeOffset: number,
  capPointCountOffset: number,
  renderOptions: NormalizedPolylineRenderOptions
) => {
  writePolylineJoinCorrection(
    buffer,
    joinModeOffset,
    joinIntermediatePointCountOffset,
    renderOptions.joinCorrection
  );
  writePolylineCapCorrection(
    buffer,
    capModeOffset,
    capPointCountOffset,
    renderOptions.capCorrection
  );
};

const writePolylineJoinCorrection = (
  buffer: InputArrayBuffer,
  modeOffset: number,
  intermediatePointCountOffset: number,
  correction: NormalizedPolylineJoinCorrection
) => {
  buffer[modeOffset] = correction.mode;
  buffer[intermediatePointCountOffset] = correction.intermediatePointCount;
};

const writePolylineCapCorrection = (
  buffer: InputArrayBuffer,
  modeOffset: number,
  pointCountOffset: number,
  correction: NormalizedPolylineCapCorrection
) => {
  buffer[modeOffset] = correction.mode;
  buffer[pointCountOffset] = correction.pointCount;
};

const formatPolylineJoinCorrection = (
  mode: number,
  intermediatePointCount: number
): PolylineState['joinCorrection'] =>
  mode === POLYLINE_CORRECTION_FAN
    ? {
        type: 'fan',
        intermediatePointCount: Math.max(0, Math.trunc(intermediatePointCount)),
      }
    : { type: 'none' };

const formatPolylineCapCorrection = (
  mode: number,
  pointCount: number
): PolylineState['capCorrection'] =>
  mode === POLYLINE_CORRECTION_FAN
    ? {
        type: 'fan',
        pointCount: Math.max(1, Math.trunc(pointCount)),
      }
    : { type: 'none' };

const writeRotationCommand = (
  buffer: InputArrayBuffer,
  baseOffset: number,
  value: ObjectPlacementValue<number> | ObjectUpdateValue<number>,
  precision: WasmInputPrecision,
  allowMissingInterpolation: boolean,
  allowMissingValue: boolean
) => {
  writeInterpolationCommand(
    buffer,
    baseOffset,
    ROTATION_INTERPOLATION_OFFSETS,
    value,
    precision,
    allowMissingInterpolation,
    allowMissingValue
  );
};

const writeAutoDirectionCommand = (
  buffer: InputArrayBuffer,
  baseOffset: number,
  value:
    | SpritePlacementAutoDirection
    | SpriteUpdateAutoDirection
    | null
    | undefined,
  precision: WasmInputPrecision,
  mode: 'placement' | 'update'
) => {
  if (value === undefined) {
    return;
  }
  if (value === null) {
    buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_SPACE_HAS_OFFSET] = 1;
    buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_SPACE_OFFSET] =
      AUTO_DIRECTION_SPACE_WORLD;
    buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_MODE_HAS_OFFSET] = 1;
    buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_MODE_OFFSET] =
      AUTO_DIRECTION_MODE_NONE;
    buffer[
      baseOffset +
        cl.COMMAND_ELEMENT_AUTO_DIRECTION_SHIFT_ANGLE_ROTATION_HAS_OFFSET
    ] = 1;
    buffer[
      baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_SHIFT_ANGLE_ROTATION_OFFSET
    ] = 0;
    buffer[
      baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_MIN_DISTANCE_HAS_OFFSET
    ] = 1;
    buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_MIN_DISTANCE_OFFSET] =
      0;
    buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_X_HAS_OFFSET] =
      1;
    buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_X_OFFSET] = 0;
    buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_Y_HAS_OFFSET] =
      1;
    buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_Y_OFFSET] = 0;
    buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_CLEAR_OFFSET] =
      1;
    return;
  }

  const autoDirection = value as
    | SpritePlacementAutoDirection
    | SpriteUpdateAutoDirection;
  if (autoDirection.space !== undefined || mode === 'placement') {
    buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_SPACE_HAS_OFFSET] = 1;
    buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_SPACE_OFFSET] =
      resolveAutoDirectionSpace(autoDirection.space ?? 'world');
  }
  if (autoDirection.mode !== undefined) {
    buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_MODE_HAS_OFFSET] = 1;
    buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_MODE_OFFSET] =
      autoDirection.mode === null
        ? AUTO_DIRECTION_MODE_NONE
        : resolveAutoDirectionMode(autoDirection.mode.type);
    if (autoDirection.mode && autoDirection.mode.type === 'flipping') {
      if (autoDirection.mode.flipX !== undefined || mode === 'placement') {
        buffer[
          baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_X_HAS_OFFSET
        ] = 1;
        buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_X_OFFSET] =
          autoDirection.mode.flipX ? 1 : 0;
      }
      if (autoDirection.mode.flipY !== undefined || mode === 'placement') {
        buffer[
          baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_Y_HAS_OFFSET
        ] = 1;
        buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_Y_OFFSET] =
          autoDirection.mode.flipY ? 1 : 0;
      }
      writeAutoDirectionInterpolationCommand(
        buffer,
        baseOffset,
        autoDirection.mode.interpolation,
        precision,
        mode === 'update'
      );
    } else if (autoDirection.mode === null || mode === 'placement') {
      if (mode === 'placement' || autoDirection.mode === null) {
        buffer[
          baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_X_HAS_OFFSET
        ] = 1;
        buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_X_OFFSET] =
          0;
        buffer[
          baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_Y_HAS_OFFSET
        ] = 1;
        buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_Y_OFFSET] =
          0;
      }
      if (autoDirection.mode === null) {
        buffer[
          baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_CLEAR_OFFSET
        ] = 1;
      }
    }
  }
  if (autoDirection.shiftAngleRotation !== undefined || mode === 'placement') {
    buffer[
      baseOffset +
        cl.COMMAND_ELEMENT_AUTO_DIRECTION_SHIFT_ANGLE_ROTATION_HAS_OFFSET
    ] = 1;
    buffer[
      baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_SHIFT_ANGLE_ROTATION_OFFSET
    ] = autoDirection.shiftAngleRotation ? 1 : 0;
  }
  if (autoDirection.minDistance !== undefined || mode === 'placement') {
    buffer[
      baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_MIN_DISTANCE_HAS_OFFSET
    ] = 1;
    buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_MIN_DISTANCE_OFFSET] =
      autoDirection.minDistance ?? 0;
  }
};

interface SpriteElementCommons {
  readonly imageId: string | null | undefined;
  readonly originLocation: SpriteElementOriginLocationPlacement | undefined;
  readonly mode: SpriteElementRenderMode | undefined;
  readonly layer: number | undefined;
  readonly order: number | undefined;
  readonly shiftDistance:
    | ObjectPlacementValue<number>
    | ObjectUpdateValue<number>
    | undefined;
  readonly shiftAngleDeg:
    | ObjectPlacementValue<number>
    | ObjectUpdateValue<number>
    | undefined;
  readonly scale:
    | ObjectPlacementValue<number>
    | ObjectUpdateValue<number>
    | undefined;
  readonly opacity:
    | ObjectPlacementValue<number>
    | ObjectUpdateValue<number>
    | undefined;
  readonly border:
    | SpriteElementBorderPlacement
    | SpriteElementBorderUpdate
    | null
    | undefined;
  readonly leaderline:
    | SpriteElementLeaderlinePlacement
    | SpriteElementLeaderlineUpdate
    | undefined;
  readonly anchorX:
    | ObjectPlacementValue<number>
    | ObjectUpdateValue<number>
    | undefined;
  readonly anchorY:
    | ObjectPlacementValue<number>
    | ObjectUpdateValue<number>
    | undefined;
  readonly rotation:
    | ObjectPlacementValue<number>
    | ObjectUpdateValue<number>
    | undefined;
  readonly autoDirection:
    | SpritePlacementAutoDirection
    | SpriteUpdateAutoDirection
    | null
    | undefined;
}

const writeElementFields = (
  buffer: InputArrayBuffer,
  baseOffset: number,
  element: SpriteElementPlacement | SpriteElementUpdate | null | undefined,
  mode: 'placement' | 'update',
  resolveTextureIndex: (imageId: string) => number | undefined,
  precision: WasmInputPrecision
) => {
  if (!element) {
    buffer[baseOffset + cl.COMMAND_ELEMENT_KIND_OFFSET] =
      cl.COMMAND_ELEMENT_KIND_NONE;
    return;
  }

  const elementCommon = element as SpriteElementCommons;

  buffer[baseOffset + cl.COMMAND_ELEMENT_KIND_OFFSET] =
    cl.COMMAND_ELEMENT_KIND_PRESENT;

  const imageId = elementCommon.imageId;

  if (mode === 'placement') {
    buffer[baseOffset + cl.COMMAND_ELEMENT_IMAGE_MODE_OFFSET] =
      cl.COMMAND_IMAGE_MODE_SET;
    const resourceTexIndex =
      imageId !== undefined && imageId !== null
        ? resolveTextureIndex(imageId)
        : undefined;
    buffer[baseOffset + cl.COMMAND_ELEMENT_TEX_INDEX_OFFSET] =
      resourceTexIndex ?? -1;
  } else {
    if (imageId === null) {
      buffer[baseOffset + cl.COMMAND_ELEMENT_IMAGE_MODE_OFFSET] =
        cl.COMMAND_IMAGE_MODE_CLEAR;
    } else if (imageId !== undefined) {
      buffer[baseOffset + cl.COMMAND_ELEMENT_IMAGE_MODE_OFFSET] =
        cl.COMMAND_IMAGE_MODE_SET;
      const resourceTexIndex = resolveTextureIndex(imageId);
      buffer[baseOffset + cl.COMMAND_ELEMENT_TEX_INDEX_OFFSET] =
        resourceTexIndex ?? -1;
    }
  }

  const originLocation = elementCommon.originLocation;
  if (originLocation !== undefined) {
    buffer[baseOffset + cl.COMMAND_ELEMENT_ORIGIN_LOCATION_HAS_OFFSET] = 1;
    buffer[baseOffset + cl.COMMAND_ELEMENT_ORIGIN_LOCATION_INDEX_OFFSET] =
      originLocation.index;
    buffer[
      baseOffset + cl.COMMAND_ELEMENT_ORIGIN_LOCATION_USE_RESOLVED_ANCHOR_OFFSET
    ] = originLocation.useResolvedAnchor ? 1 : 0;
  } else {
    buffer[baseOffset + cl.COMMAND_ELEMENT_ORIGIN_LOCATION_HAS_OFFSET] = 0;
    buffer[baseOffset + cl.COMMAND_ELEMENT_ORIGIN_LOCATION_INDEX_OFFSET] = -1;
    buffer[
      baseOffset + cl.COMMAND_ELEMENT_ORIGIN_LOCATION_USE_RESOLVED_ANCHOR_OFFSET
    ] = 0;
  }

  const layer = elementCommon.layer;
  if (layer !== undefined) {
    writeOptionalCommand(
      buffer,
      baseOffset + cl.COMMAND_ELEMENT_LAYER_HAS_OFFSET,
      normalizeLayerValue(layer)
    );
  }

  const order = elementCommon.order;
  if (order !== undefined) {
    writeOptionalCommand(
      buffer,
      baseOffset + cl.COMMAND_ELEMENT_ORDER_HAS_OFFSET,
      normalizeOrderValue(order)
    );
  }

  const renderMode = elementCommon.mode;
  if (renderMode !== undefined) {
    writeOptionalCommand(
      buffer,
      baseOffset + cl.COMMAND_ELEMENT_RENDER_MODE_HAS_OFFSET,
      resolveElementRenderMode(renderMode)
    );
  }

  const shiftDistance = elementCommon.shiftDistance;
  if (
    shiftDistance &&
    (mode === 'placement' ||
      isUpdateValueSpecified(shiftDistance as ObjectUpdateValue<number>))
  ) {
    writeValueCommand(
      buffer,
      baseOffset + cl.COMMAND_ELEMENT_SHIFT_DISTANCE_HAS_OFFSET,
      shiftDistance as ObjectUpdateValue<number>,
      precision,
      mode === 'update',
      mode === 'update'
    );
  }

  const shiftAngle = elementCommon.shiftAngleDeg;
  if (
    shiftAngle &&
    (mode === 'placement' ||
      isUpdateValueSpecified(shiftAngle as ObjectUpdateValue<number>))
  ) {
    writeValueCommand(
      buffer,
      baseOffset + cl.COMMAND_ELEMENT_SHIFT_ANGLE_HAS_OFFSET,
      shiftAngle as ObjectUpdateValue<number>,
      precision,
      mode === 'update',
      mode === 'update'
    );
  }

  const scale = elementCommon.scale;
  if (
    scale &&
    (mode === 'placement' ||
      isUpdateValueSpecified(scale as ObjectUpdateValue<number>))
  ) {
    writeValueCommand(
      buffer,
      baseOffset + cl.COMMAND_ELEMENT_SCALE_HAS_OFFSET,
      scale as ObjectUpdateValue<number>,
      precision,
      mode === 'update',
      mode === 'update'
    );
  }

  const opacity = elementCommon.opacity;
  if (
    opacity &&
    (mode === 'placement' ||
      isUpdateValueSpecified(opacity as ObjectUpdateValue<number>))
  ) {
    writeValueCommand(
      buffer,
      baseOffset + cl.COMMAND_ELEMENT_OPACITY_HAS_OFFSET,
      opacity as ObjectUpdateValue<number>,
      precision,
      mode === 'update',
      mode === 'update'
    );
  }

  const border = elementCommon.border;
  if (border === null) {
    buffer[baseOffset + cl.COMMAND_ELEMENT_BORDER_MODE_OFFSET] =
      ELEMENT_BORDER_MODE_CLEAR;
  } else if (border) {
    buffer[baseOffset + cl.COMMAND_ELEMENT_BORDER_MODE_OFFSET] =
      ELEMENT_BORDER_MODE_SET;
    if (border.width !== undefined) {
      writeOptionalCommand(
        buffer,
        baseOffset + cl.COMMAND_ELEMENT_BORDER_WIDTH_HAS_OFFSET,
        normalizePositiveNumber(border.width, 'Border width')
      );
    }
    if (border.color !== undefined) {
      const borderColor = parseColorRGBA(border.color);
      buffer[baseOffset + cl.COMMAND_ELEMENT_BORDER_COLOR_HAS_OFFSET] = 1;
      buffer[baseOffset + cl.COMMAND_ELEMENT_BORDER_COLOR_R_OFFSET] =
        borderColor.r;
      buffer[baseOffset + cl.COMMAND_ELEMENT_BORDER_COLOR_G_OFFSET] =
        borderColor.g;
      buffer[baseOffset + cl.COMMAND_ELEMENT_BORDER_COLOR_B_OFFSET] =
        borderColor.b;
      buffer[baseOffset + cl.COMMAND_ELEMENT_BORDER_COLOR_A_OFFSET] =
        borderColor.a;
    }
  }

  const leaderline = elementCommon.leaderline;
  if (leaderline) {
    buffer[baseOffset + cl.COMMAND_ELEMENT_LEADERLINE_HAS_OFFSET] = 1;
    const leaderlineWidth = leaderline.width;
    if (
      leaderlineWidth &&
      (mode === 'placement' ||
        isUpdateValueSpecified(leaderlineWidth as ObjectUpdateValue<number>))
    ) {
      writeValueCommand(
        buffer,
        baseOffset + cl.COMMAND_ELEMENT_LEADERLINE_WIDTH_HAS_OFFSET,
        leaderlineWidth as ObjectUpdateValue<number>,
        precision,
        mode === 'update',
        mode === 'update'
      );
    }
    const colorPayload = normalizePolylineColor(leaderline.color);
    buffer[baseOffset + cl.COMMAND_ELEMENT_LEADERLINE_COLOR0_R_OFFSET] =
      colorPayload.color0.r;
    buffer[baseOffset + cl.COMMAND_ELEMENT_LEADERLINE_COLOR0_G_OFFSET] =
      colorPayload.color0.g;
    buffer[baseOffset + cl.COMMAND_ELEMENT_LEADERLINE_COLOR0_B_OFFSET] =
      colorPayload.color0.b;
    buffer[baseOffset + cl.COMMAND_ELEMENT_LEADERLINE_COLOR0_A_OFFSET] =
      colorPayload.color0.a;
    buffer[baseOffset + cl.COMMAND_ELEMENT_LEADERLINE_COLOR1_R_OFFSET] =
      colorPayload.color1.r;
    buffer[baseOffset + cl.COMMAND_ELEMENT_LEADERLINE_COLOR1_G_OFFSET] =
      colorPayload.color1.g;
    buffer[baseOffset + cl.COMMAND_ELEMENT_LEADERLINE_COLOR1_B_OFFSET] =
      colorPayload.color1.b;
    buffer[baseOffset + cl.COMMAND_ELEMENT_LEADERLINE_COLOR1_A_OFFSET] =
      colorPayload.color1.a;
    buffer[baseOffset + cl.COMMAND_ELEMENT_LEADERLINE_REPEAT_LENGTH_OFFSET] =
      colorPayload.repeatLength;
  }

  const anchorX = elementCommon.anchorX;
  if (
    anchorX &&
    (mode === 'placement' ||
      isUpdateValueSpecified(anchorX as ObjectUpdateValue<number>))
  ) {
    writeValueCommand(
      buffer,
      baseOffset + cl.COMMAND_ELEMENT_ANCHOR_X_HAS_OFFSET,
      anchorX as ObjectUpdateValue<number>,
      precision,
      mode === 'update',
      mode === 'update'
    );
  }

  const anchorY = elementCommon.anchorY;
  if (
    anchorY &&
    (mode === 'placement' ||
      isUpdateValueSpecified(anchorY as ObjectUpdateValue<number>))
  ) {
    writeValueCommand(
      buffer,
      baseOffset + cl.COMMAND_ELEMENT_ANCHOR_Y_HAS_OFFSET,
      anchorY as ObjectUpdateValue<number>,
      precision,
      mode === 'update',
      mode === 'update'
    );
  }

  const rotation = elementCommon.rotation;
  if (
    rotation &&
    (mode === 'placement' ||
      isUpdateRotationSpecified(rotation as ObjectUpdateValue<number>))
  ) {
    writeRotationCommand(
      buffer,
      baseOffset + cl.COMMAND_ELEMENT_ROTATION_HAS_OFFSET,
      rotation as ObjectUpdateValue<number>,
      precision,
      mode === 'update',
      mode === 'update'
    );
  }

  const autoDirection = elementCommon.autoDirection;
  if (
    autoDirection !== undefined &&
    (mode === 'placement' ||
      isUpdateAutoDirectionSpecified(
        autoDirection as SpriteUpdateAutoDirection | null
      ))
  ) {
    writeAutoDirectionCommand(
      buffer,
      baseOffset,
      autoDirection as SpriteUpdateAutoDirection | null,
      precision,
      mode
    );
  }
};

///////////////////////////////////////////////////////////////////////////////////

type CameraUpdatePayload = CameraUpdate & {
  readonly aspectRatio?: number;
};

const computeAspectRatio = (size: SizeInPixel) =>
  size.heightPixel === 0
    ? 1.0
    : Math.max(1.0, size.widthPixel) / size.heightPixel;

///////////////////////////////////////////////////////////////////////////////////

/**
 * Creates the core renderer that manages sprites, polylines, camera state, and WASM execution.
 * @param initialViewPortSize - Initial viewport size in CSS pixels.
 * @param wasmModule - Loaded or instantiated WASM module.
 * @param options - Renderer options.
 * @returns Object renderer instance.
 */
export const createObjectRenderer = (
  initialViewPortSize: SizeInPixel,
  wasmModule: WasmModule,
  options: ObjectRendererOptions = {}
): ObjectRenderer => {
  const precision = options.precision ?? 'f32';
  if (precision !== 'f32' && precision !== 'f64') {
    throw new Error('Unsupported WASM input precision.');
  }
  const logger = options.logger ?? getNoOpLogger();
  const resolvedSpriteScaling = resolveDistanceScalingOptions(
    options.spriteScaling
  );
  const resolvedPolylineScaling = resolveDistanceScalingOptions(
    options.polylineScaling
  );
  resolvedSpriteScaling.warnings.forEach((warning) => {
    logger.warn(`[spriteScaling] ${warning}`);
  });
  resolvedPolylineScaling.warnings.forEach((warning) => {
    logger.warn(`[polylineScaling] ${warning}`);
  });
  let latestViewPortSize: SizeInPixel = {
    widthPixel: initialViewPortSize.widthPixel,
    heightPixel: initialViewPortSize.heightPixel,
  };
  let renderContext: RenderContext | null = null;

  const spriteElementCounts: number[] = [];
  const spriteLeaderlineFlags: boolean[][] = [];
  const spriteLeaderlineCounts: number[] = [];
  const spriteBorderFlags: boolean[][] = [];
  const spriteBorderCounts: number[] = [];
  const spriteElementTexIndices: number[][] = [];
  const polylineNodeCounts: number[] = [];
  const polylineRenderOptions: NormalizedPolylineRenderOptions[] = [];
  const spriteIdMap = createIdIndexMap();
  const polylineIdMap = createIdIndexMap();
  const pendingSpriteRemovalIndices: number[] = [];
  const pendingSpriteRemovalIds = new Set<number>();
  const pendingPolylineRemovalIndices: number[] = [];
  const pendingPolylineRemovalIds = new Set<number>();
  let totalElementCount = 0;
  let totalLeaderlineCount = 0;
  let totalBorderCount = 0;
  let totalPolylineNodeCount = 0;

  const performanceTracker = createObjectPerformanceTracker();
  const pushPerformanceSample = performanceTracker.pushSample;
  const getPerformanceSnapshot = performanceTracker.getPerformanceSnapshot;
  const resetPerformanceSnapshot = performanceTracker.resetPerformanceSnapshot;
  const recordWasmBufferResize = performanceTracker.recordWasmBufferResize;

  const cameraStateChangeListeners = new Set<
    (event: ObjectRendererCameraStateChangeEvent) => void
  >();
  let pendingCameraStateChange = false;
  let pendingCameraStateChangeSource: 'tracking' | undefined = undefined;
  let pendingCameraStateChangeUpdate: CameraUpdate | undefined = undefined;
  let cameraStateChangeTimerId: ReturnType<typeof setTimeout> | null = null;
  let cameraTrackingState: ObjectCameraTrackingState | null = null;
  const spriteTrackingSnapshots = new Map<
    number,
    ReturnType<typeof createSpriteTrackingSnapshot>
  >();

  const emitCameraStateChange = (
    event: ObjectRendererCameraStateChangeEvent
  ) => {
    cameraStateChangeListeners.forEach((listener) => {
      listener(event);
    });
  };

  const scheduleCameraStateChange = () => {
    if (cameraStateChangeTimerId !== null) {
      return;
    }
    if (cameraStateChangeListeners.size === 0) {
      pendingCameraStateChange = false;
      pendingCameraStateChangeSource = undefined;
      pendingCameraStateChangeUpdate = undefined;
      return;
    }
    cameraStateChangeTimerId = setTimeout(() => {
      cameraStateChangeTimerId = null;
      if (!pendingCameraStateChange) {
        return;
      }
      pendingCameraStateChange = false;
      if (cameraStateChangeListeners.size === 0) {
        pendingCameraStateChangeSource = undefined;
        pendingCameraStateChangeUpdate = undefined;
        return;
      }
      emitCameraStateChange({
        cameraState: getCameraState(),
        ...(pendingCameraStateChangeSource !== undefined
          ? { source: pendingCameraStateChangeSource }
          : {}),
        ...(pendingCameraStateChangeUpdate !== undefined
          ? { cameraUpdate: pendingCameraStateChangeUpdate }
          : {}),
        timestampMs: getNowMs(),
      });
      pendingCameraStateChangeSource = undefined;
      pendingCameraStateChangeUpdate = undefined;
    }, 0);
  };

  const notifyCameraStateChange = (
    details:
      | {
          readonly source?: 'tracking';
          readonly cameraUpdate?: CameraUpdate;
        }
      | undefined = undefined
  ) => {
    pendingCameraStateChange = true;
    if (details?.source !== undefined) {
      pendingCameraStateChangeSource = details.source;
    }
    if (details?.cameraUpdate !== undefined) {
      pendingCameraStateChangeUpdate = details.cameraUpdate;
    }
    scheduleCameraStateChange();
  };

  const countPendingRemovalsBefore = (indices: number[], index: number) => {
    let low = 0;
    let high = indices.length;
    while (low < high) {
      const mid = (low + high) >> 1;
      if ((indices[mid] ?? 0) < index) {
        low = mid + 1;
      } else {
        high = mid;
      }
    }
    return low;
  };

  const insertPendingRemovalIndex = (indices: number[], index: number) => {
    const position = countPendingRemovalsBefore(indices, index);
    indices.splice(position, 0, index);
  };

  const resolveSpriteBaseIndex = (spriteId: number): number | null => {
    const index = spriteIdMap.getIndexById(spriteId);
    if (index === null) {
      return null;
    }
    if (index < 0 || index >= spriteElementCounts.length) {
      return null;
    }
    return index;
  };

  const resolveSpriteIndicesForCommand = (
    spriteId: number,
    pendingIndices: number[] = pendingSpriteRemovalIndices,
    pendingIds: Set<number> = pendingSpriteRemovalIds
  ): { baseIndex: number; effectiveIndex: number } | null => {
    if (pendingIds.has(spriteId)) {
      return null;
    }
    const baseIndex = resolveSpriteBaseIndex(spriteId);
    if (baseIndex === null) {
      return null;
    }
    const shift = countPendingRemovalsBefore(pendingIndices, baseIndex);
    const effectiveIndex = baseIndex - shift;
    if (effectiveIndex < 0) {
      return null;
    }
    return { baseIndex, effectiveIndex };
  };

  const resolvePolylineBaseIndex = (polylineId: number): number | null => {
    const index = polylineIdMap.getIndexById(polylineId);
    if (index === null) {
      return null;
    }
    if (index < 0 || index >= polylineNodeCounts.length) {
      return null;
    }
    return index;
  };

  const getPolylineRenderOptionsAt = (polylineIndex: number) =>
    polylineRenderOptions[polylineIndex] ??
    DEFAULT_NORMALIZED_POLYLINE_RENDER_OPTIONS;

  const resolvePolylineIndicesForCommand = (
    polylineId: number,
    pendingIndices: number[] = pendingPolylineRemovalIndices,
    pendingIds: Set<number> = pendingPolylineRemovalIds
  ): { baseIndex: number; effectiveIndex: number } | null => {
    if (pendingIds.has(polylineId)) {
      return null;
    }
    const baseIndex = resolvePolylineBaseIndex(polylineId);
    if (baseIndex === null) {
      return null;
    }
    const shift = countPendingRemovalsBefore(pendingIndices, baseIndex);
    const effectiveIndex = baseIndex - shift;
    if (effectiveIndex < 0) {
      return null;
    }
    return { baseIndex, effectiveIndex };
  };

  const getMaxAtlasSize = (): SizeInPixel => {
    if (!renderContext) {
      throw new Error('WebGL context is not attached.');
    }
    const maxSize = renderContext.gl.getParameter(
      renderContext.gl.MAX_TEXTURE_SIZE
    );
    const resolved =
      typeof maxSize === 'number' && Number.isFinite(maxSize)
        ? Math.max(0, Math.floor(maxSize))
        : 0;
    return { widthPixel: resolved, heightPixel: resolved };
  };

  const wasmState = createWasmState(
    resolveWasmExports(wasmModule, precision),
    precision
  );
  const supportsWasmCameraTracking =
    typeof wasmState.exports.set_camera_tracking === 'function' &&
    typeof wasmState.exports.clear_camera_tracking === 'function';
  const wasmSpriteScaling = resolveDistanceScalingOptionsForWasm(
    resolvedSpriteScaling.resolved,
    precision
  );
  const wasmPolylineScaling = resolveDistanceScalingOptionsForWasm(
    resolvedPolylineScaling.resolved,
    precision
  );
  const scalingConfigured = wasmState.exports.set_scaling_options(
    wasmState.contextPtr,
    wasmSpriteScaling.minScaleDistance,
    wasmSpriteScaling.maxScaleDistance,
    wasmPolylineScaling.minScaleDistance,
    wasmPolylineScaling.maxScaleDistance
  );
  if (!scalingConfigured) {
    wasmState.release();
    throw new Error('Failed to configure distance scaling options.');
  }

  let commandBuffer = wasmState.commandBuffer.getBuffer();
  let commandBufferCapacity = wasmState.commandBuffer.count;
  let commandUsed = cl.COMMAND_BUFFER_HEADER_FIELDS;
  let commandCount = 0;
  let commandRevision = 0;
  let lastComputeCommandRevision = -1;
  let lastComputeTimestampMs: number | null = null;
  let lastComputeOutputValid = false;
  let resultBuffer = wasmState.resultBuffer.getBuffer();
  let resultBufferCapacity = wasmState.resultBuffer.count;
  let applyStatsBuffer = wasmState.applyStatsBuffer.getBuffer();
  let computeStatsBuffer = wasmState.computeStatsBuffer.getBuffer();
  let stateSpriteBuffer = wasmState.stateSpriteBuffer.getBuffer();
  let stateSpriteBufferCapacity = wasmState.stateSpriteBuffer.count;
  let stateElementBuffer = wasmState.stateElementBuffer.getBuffer();
  let stateElementBufferCapacity = wasmState.stateElementBuffer.count;
  let statePolylineBuffer = wasmState.statePolylineBuffer.getBuffer();
  let statePolylineBufferCapacity = wasmState.statePolylineBuffer.count;
  let statePolylineNodeBuffer = wasmState.statePolylineNodeBuffer.getBuffer();
  let statePolylineNodeBufferCapacity = wasmState.statePolylineNodeBuffer.count;
  let cameraBuffer = wasmState.cameraBuffer.getBuffer();
  let outputCapacity = Math.floor(
    wasmState.outputBuffer.count / wl.WASM_OUTPUT_STRIDE
  );
  let texIndexCapacity = wasmState.texIndexBuffer.count;
  let polylineOutputCapacity = Math.floor(
    wasmState.polylineOutputBuffer.count / wl.POLYLINE_OUTPUT_STRIDE
  );
  let drawCommandCapacity = Math.max(
    0,
    Math.floor(
      (wasmState.drawCommandBuffer.count - wl.DRAW_COMMAND_HEADER_FIELDS) /
        wl.DRAW_COMMAND_FIELDS
    )
  );
  let entryIndexBuffer: Int32Array | undefined;
  let entrySolveModeBuffer: Int32Array | undefined;
  let entryScreenFromBuffer: InputArrayBuffer | undefined;
  let entryScreenToBuffer: InputArrayBuffer | undefined;
  let entryScreenAngleBuffer: InputArrayBuffer | undefined;
  let entryRotateDegBuffer: InputArrayBuffer | undefined;
  let entryFinalRotateDegBuffer: InputArrayBuffer | undefined;
  let entryRotationFromBuffer: InputArrayBuffer | undefined;
  let entryRotationToBuffer: InputArrayBuffer | undefined;
  let entryRotationDurationBuffer: InputArrayBuffer | undefined;
  let entryFinalRotationFromBuffer: InputArrayBuffer | undefined;
  let entryFinalRotationToBuffer: InputArrayBuffer | undefined;
  let entryFinalRotationDurationBuffer: InputArrayBuffer | undefined;
  let entryDebugEnabled = false;
  let elementAnimDetailEnabled = false;
  let elementAnimProfileFrame = 0;

  const wasmBufferAccess: WasmStateBufferAccess = {
    get commandBuffer() {
      return commandBuffer;
    },
    set commandBuffer(value) {
      commandBuffer = value;
    },
    get commandBufferCapacity() {
      return commandBufferCapacity;
    },
    set commandBufferCapacity(value) {
      commandBufferCapacity = value;
    },
    get resultBuffer() {
      return resultBuffer;
    },
    set resultBuffer(value) {
      resultBuffer = value;
    },
    get resultBufferCapacity() {
      return resultBufferCapacity;
    },
    set resultBufferCapacity(value) {
      resultBufferCapacity = value;
    },
    get applyStatsBuffer() {
      return applyStatsBuffer;
    },
    set applyStatsBuffer(value) {
      applyStatsBuffer = value;
    },
    get computeStatsBuffer() {
      return computeStatsBuffer;
    },
    set computeStatsBuffer(value) {
      computeStatsBuffer = value;
    },
    get stateSpriteBuffer() {
      return stateSpriteBuffer;
    },
    set stateSpriteBuffer(value) {
      stateSpriteBuffer = value;
    },
    get stateSpriteBufferCapacity() {
      return stateSpriteBufferCapacity;
    },
    set stateSpriteBufferCapacity(value) {
      stateSpriteBufferCapacity = value;
    },
    get stateElementBuffer() {
      return stateElementBuffer;
    },
    set stateElementBuffer(value) {
      stateElementBuffer = value;
    },
    get stateElementBufferCapacity() {
      return stateElementBufferCapacity;
    },
    set stateElementBufferCapacity(value) {
      stateElementBufferCapacity = value;
    },
    get statePolylineBuffer() {
      return statePolylineBuffer;
    },
    set statePolylineBuffer(value) {
      statePolylineBuffer = value;
    },
    get statePolylineBufferCapacity() {
      return statePolylineBufferCapacity;
    },
    set statePolylineBufferCapacity(value) {
      statePolylineBufferCapacity = value;
    },
    get statePolylineNodeBuffer() {
      return statePolylineNodeBuffer;
    },
    set statePolylineNodeBuffer(value) {
      statePolylineNodeBuffer = value;
    },
    get statePolylineNodeBufferCapacity() {
      return statePolylineNodeBufferCapacity;
    },
    set statePolylineNodeBufferCapacity(value) {
      statePolylineNodeBufferCapacity = value;
    },
    get cameraBuffer() {
      return cameraBuffer;
    },
    set cameraBuffer(value) {
      cameraBuffer = value;
    },
    get outputCapacity() {
      return outputCapacity;
    },
    set outputCapacity(value) {
      outputCapacity = value;
    },
    get texIndexCapacity() {
      return texIndexCapacity;
    },
    set texIndexCapacity(value) {
      texIndexCapacity = value;
    },
    get polylineOutputCapacity() {
      return polylineOutputCapacity;
    },
    set polylineOutputCapacity(value) {
      polylineOutputCapacity = value;
    },
    get drawCommandCapacity() {
      return drawCommandCapacity;
    },
    set drawCommandCapacity(value) {
      drawCommandCapacity = value;
    },
    get entryIndexBuffer() {
      return entryIndexBuffer;
    },
    set entryIndexBuffer(value) {
      entryIndexBuffer = value;
    },
    get entrySolveModeBuffer() {
      return entrySolveModeBuffer;
    },
    set entrySolveModeBuffer(value) {
      entrySolveModeBuffer = value;
    },
    get entryScreenFromBuffer() {
      return entryScreenFromBuffer;
    },
    set entryScreenFromBuffer(value) {
      entryScreenFromBuffer = value;
    },
    get entryScreenToBuffer() {
      return entryScreenToBuffer;
    },
    set entryScreenToBuffer(value) {
      entryScreenToBuffer = value;
    },
    get entryScreenAngleBuffer() {
      return entryScreenAngleBuffer;
    },
    set entryScreenAngleBuffer(value) {
      entryScreenAngleBuffer = value;
    },
    get entryRotateDegBuffer() {
      return entryRotateDegBuffer;
    },
    set entryRotateDegBuffer(value) {
      entryRotateDegBuffer = value;
    },
    get entryFinalRotateDegBuffer() {
      return entryFinalRotateDegBuffer;
    },
    set entryFinalRotateDegBuffer(value) {
      entryFinalRotateDegBuffer = value;
    },
    get entryRotationFromBuffer() {
      return entryRotationFromBuffer;
    },
    set entryRotationFromBuffer(value) {
      entryRotationFromBuffer = value;
    },
    get entryRotationToBuffer() {
      return entryRotationToBuffer;
    },
    set entryRotationToBuffer(value) {
      entryRotationToBuffer = value;
    },
    get entryRotationDurationBuffer() {
      return entryRotationDurationBuffer;
    },
    set entryRotationDurationBuffer(value) {
      entryRotationDurationBuffer = value;
    },
    get entryFinalRotationFromBuffer() {
      return entryFinalRotationFromBuffer;
    },
    set entryFinalRotationFromBuffer(value) {
      entryFinalRotationFromBuffer = value;
    },
    get entryFinalRotationToBuffer() {
      return entryFinalRotationToBuffer;
    },
    set entryFinalRotationToBuffer(value) {
      entryFinalRotationToBuffer = value;
    },
    get entryFinalRotationDurationBuffer() {
      return entryFinalRotationDurationBuffer;
    },
    set entryFinalRotationDurationBuffer(value) {
      entryFinalRotationDurationBuffer = value;
    },
  };

  const entryScreenAngleArrayType = resolveInputArrayType(precision);

  const viewProjectionUploadBuffer = new Float32Array(VIEW_MATRIX_SIZE);
  const getViewProjectionUploadBuffer = () => {
    const buffer = wasmState.viewProjectionBuffer.getBuffer();
    if (buffer instanceof Float32Array) {
      return buffer;
    }
    for (let index = 0; index < VIEW_MATRIX_SIZE; index += 1) {
      viewProjectionUploadBuffer[index] = buffer[index]!;
    }
    return viewProjectionUploadBuffer;
  };
  const viewMatrixUploadBuffer = new Float32Array(VIEW_MATRIX_SIZE);
  const getViewMatrixUploadBuffer = () => {
    const buffer = wasmState.viewMatrixBuffer.getBuffer();
    if (buffer instanceof Float32Array) {
      return buffer;
    }
    for (let index = 0; index < VIEW_MATRIX_SIZE; index += 1) {
      viewMatrixUploadBuffer[index] = buffer[index]!;
    }
    return viewMatrixUploadBuffer;
  };

  const pendingCommands: PendingCommand[] = [];
  let pendingUpdateSpriteCommandCount = 0;
  let pendingUpdateSpriteFirstQueuedAtMs: number | null = null;
  let nextResultIndex = 0;
  let pendingResultCount = 0;
  let reportedResultBufferShortage = false;
  let reportedMissingResults = false;
  let commandPumpScheduled = false;
  let isApplyingCommands = false;
  let isReleased = false;

  const ensureCommandCapacity = (required: number) => {
    commandBuffer = wasmState.commandBuffer.getBuffer();
    commandBufferCapacity = wasmState.commandBuffer.count;
    ensureCommandCapacityForWasmState(
      wasmState,
      wasmBufferAccess,
      required,
      commandUsed,
      commandCount,
      recordWasmBufferResize
    );
  };

  const ensureResultCapacity = (required: number) =>
    ensureResultCapacityForWasmState(
      wasmState,
      wasmBufferAccess,
      required,
      recordWasmBufferResize
    );

  const ensureRenderBuffers = (requiredElementCount: number) =>
    ensureRenderBuffersForWasmState(
      wasmState,
      wasmBufferAccess,
      requiredElementCount,
      recordWasmBufferResize
    );

  const ensurePolylineBuffers = (
    requiredVertexCount: number,
    requiredCommandCount: number
  ) =>
    ensurePolylineBuffersForWasmState(
      wasmState,
      wasmBufferAccess,
      requiredVertexCount,
      requiredCommandCount,
      recordWasmBufferResize
    );

  const ensureEntryDebugBuffers = (requiredCount: number) =>
    ensureEntryDebugBuffersForWasmState(
      wasmState,
      wasmBufferAccess,
      requiredCount,
      entryScreenAngleArrayType,
      recordWasmBufferResize
    );

  const ensureStateBuffers = (requiredElementCount: number) =>
    ensureStateBuffersForWasmState(
      wasmState,
      wasmBufferAccess,
      requiredElementCount,
      recordWasmBufferResize
    );

  const hasPendingAsyncCommands = () =>
    initializeScopeRunning ||
    pendingCommands.some((command) => command.resolve || command.reject);

  const requestCommandPump = () => {
    if (commandPumpScheduled || isReleased) {
      return;
    }
    commandPumpScheduled = true;
    const run = () => {
      commandPumpScheduled = false;
      if (
        isReleased ||
        isApplyingCommands ||
        commandCount <= 0 ||
        !hasPendingAsyncCommands()
      ) {
        return;
      }
      void flushQueuedCommandsNow(false);
      if (commandCount > 0 && hasPendingAsyncCommands()) {
        requestCommandPump();
      }
    };
    if (typeof queueMicrotask === 'function') {
      queueMicrotask(run);
      return;
    }
    Promise.resolve()
      .then(run)
      .catch(() => {});
  };

  const flushQueuedCommandsNow = (throwOnApplyFailure: boolean) => {
    if (commandCount <= 0 || isApplyingCommands || isReleased) {
      return true;
    }
    try {
      void applyQueuedCommands(getNowMs(), throwOnApplyFailure);
      return true;
    } catch {
      return false;
    }
  };

  const flushBeforeQueue = (
    size: number,
    throwOnApplyFailure: boolean,
    additionalPendingResults: number = 0
  ) => {
    if (commandCount <= 0 || isApplyingCommands) {
      return true;
    }
    const nextCommandCount = commandCount + 1;
    const nextCommandUsed = commandUsed + size;
    const nextPendingResults = pendingResultCount + additionalPendingResults;
    if (
      nextCommandCount > MAX_COMMANDS_PER_APPLY ||
      nextCommandUsed > MAX_COMMAND_BUFFER_USED_PER_APPLY ||
      nextPendingResults > MAX_PENDING_RESULTS_PER_APPLY
    ) {
      return flushQueuedCommandsNow(throwOnApplyFailure);
    }
    return true;
  };

  const readCameraStateBuffer = () =>
    readCameraStateBufferFromWasm(wasmState, wasmBufferAccess);

  const readCameraAspectRatio = () => {
    const buffer = readCameraStateBuffer();
    return buffer[wl.CAMERA_VIEWPORT_ASPECT_OFFSET]!;
  };

  const queue_commandRet = { offset: 0, commandIndex: 0 }; // DIRTY HACK: common buffer, reuseable
  const queueCommand = (
    op: number,
    size: number,
    ret: { offset: number; commandIndex: number }
  ) => {
    const required = commandUsed + size;
    ensureCommandCapacity(required);
    ret.offset = commandUsed;
    commandBuffer[ret.offset + cl.COMMAND_HEADER_OP_OFFSET] = op;
    commandBuffer[ret.offset + cl.COMMAND_HEADER_SIZE_OFFSET] = size;
    commandUsed = required;
    ret.commandIndex = commandCount;
    commandCount += 1;
    commandRevision += 1;
    commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
    commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = commandCount;
    requestCommandPump();
  };

  const queueSetTextureInfo = (
    texIndex: number,
    width: number,
    height: number,
    valid: boolean,
    pageId: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number
  ) => {
    const size = cl.COMMAND_SET_TEXTURE_INFO_FIELDS;
    if (!flushBeforeQueue(size, false)) {
      return;
    }
    queueCommand(cl.COMMAND_OP_SET_TEXTURE_INFO, size, queue_commandRet);
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TEXTURE_INFO_TEX_INDEX_OFFSET
    ] = texIndex;
    // Pass width/height so WASM can cache element dimensions and avoid
    // per-frame texture lookups during pivot updates.
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TEXTURE_INFO_WIDTH_OFFSET
    ] = width;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TEXTURE_INFO_HEIGHT_OFFSET
    ] = height;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TEXTURE_INFO_VALID_OFFSET
    ] = valid ? 1 : 0;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TEXTURE_INFO_PAGE_ID_OFFSET
    ] = pageId;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TEXTURE_INFO_U0_OFFSET
    ] = u0;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TEXTURE_INFO_V0_OFFSET
    ] = v0;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TEXTURE_INFO_U1_OFFSET
    ] = u1;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TEXTURE_INFO_V1_OFFSET
    ] = v1;
    pendingCommands.push({
      index: queue_commandRet.commandIndex,
      kind: 'setTextureInfo',
    });
  };

  const queueSetTiledTextureInfo = (
    texIndex: number,
    width: number,
    height: number,
    valid: boolean,
    tileCount: number
  ) => {
    const size = cl.COMMAND_SET_TILED_TEXTURE_INFO_FIELDS;
    if (!flushBeforeQueue(size, false)) {
      return;
    }
    queueCommand(cl.COMMAND_OP_SET_TILED_TEXTURE_INFO, size, queue_commandRet);
    commandBuffer[
      queue_commandRet.offset +
        cl.COMMAND_SET_TILED_TEXTURE_INFO_TEX_INDEX_OFFSET
    ] = texIndex;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TILED_TEXTURE_INFO_WIDTH_OFFSET
    ] = width;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TILED_TEXTURE_INFO_HEIGHT_OFFSET
    ] = height;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TILED_TEXTURE_INFO_VALID_OFFSET
    ] = valid ? 1 : 0;
    commandBuffer[
      queue_commandRet.offset +
        cl.COMMAND_SET_TILED_TEXTURE_INFO_TILE_COUNT_OFFSET
    ] = tileCount;
    pendingCommands.push({
      index: queue_commandRet.commandIndex,
      kind: 'setTiledTextureInfo',
    });
  };

  const queueSetTextureTileInfo = (
    texIndex: number,
    tileIndex: number,
    pageId: number,
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    leftRatio: number,
    topRatio: number,
    rightRatio: number,
    bottomRatio: number
  ) => {
    const size = cl.COMMAND_SET_TEXTURE_TILE_INFO_FIELDS;
    if (!flushBeforeQueue(size, false)) {
      return;
    }
    queueCommand(cl.COMMAND_OP_SET_TEXTURE_TILE_INFO, size, queue_commandRet);
    commandBuffer[
      queue_commandRet.offset +
        cl.COMMAND_SET_TEXTURE_TILE_INFO_TEX_INDEX_OFFSET
    ] = texIndex;
    commandBuffer[
      queue_commandRet.offset +
        cl.COMMAND_SET_TEXTURE_TILE_INFO_TILE_INDEX_OFFSET
    ] = tileIndex;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TEXTURE_TILE_INFO_PAGE_ID_OFFSET
    ] = pageId;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TEXTURE_TILE_INFO_U0_OFFSET
    ] = u0;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TEXTURE_TILE_INFO_V0_OFFSET
    ] = v0;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TEXTURE_TILE_INFO_U1_OFFSET
    ] = u1;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_SET_TEXTURE_TILE_INFO_V1_OFFSET
    ] = v1;
    commandBuffer[
      queue_commandRet.offset +
        cl.COMMAND_SET_TEXTURE_TILE_INFO_LEFT_RATIO_OFFSET
    ] = leftRatio;
    commandBuffer[
      queue_commandRet.offset +
        cl.COMMAND_SET_TEXTURE_TILE_INFO_TOP_RATIO_OFFSET
    ] = topRatio;
    commandBuffer[
      queue_commandRet.offset +
        cl.COMMAND_SET_TEXTURE_TILE_INFO_RIGHT_RATIO_OFFSET
    ] = rightRatio;
    commandBuffer[
      queue_commandRet.offset +
        cl.COMMAND_SET_TEXTURE_TILE_INFO_BOTTOM_RATIO_OFFSET
    ] = bottomRatio;
    pendingCommands.push({
      index: queue_commandRet.commandIndex,
      kind: 'setTextureTileInfo',
    });
  };

  const acquirePickMaskPageTableBuffer = (requiredCount: number) => {
    const resolvedCount = Math.max(4, Math.ceil(requiredCount));
    if (resolvedCount > wasmState.pickMaskPageTableBuffer.count) {
      wasmState.pickMaskPageTableBuffer.expand(
        wasmState.pickMaskPageTableBuffer.count,
        resolvedCount,
        0
      );
      if (
        !wasmState.exports.set_pick_mask_page_table_buffer(
          wasmState.contextPtr,
          wasmState.pickMaskPageTableBuffer.ptr,
          wasmState.pickMaskPageTableBuffer.count
        )
      ) {
        throw new Error('Failed to update pick mask page-table buffer.');
      }
    }
    return wasmState.pickMaskPageTableBuffer.getBuffer();
  };

  const acquirePickMaskWordBuffer = (requiredCount: number) => {
    const resolvedCount = Math.max(4, Math.ceil(requiredCount));
    if (resolvedCount > wasmState.pickMaskWordBuffer.count) {
      wasmState.pickMaskWordBuffer.expand(
        wasmState.pickMaskWordBuffer.count,
        resolvedCount,
        0
      );
      if (
        !wasmState.exports.set_pick_mask_word_buffer(
          wasmState.contextPtr,
          wasmState.pickMaskWordBuffer.ptr,
          wasmState.pickMaskWordBuffer.count
        )
      ) {
        throw new Error('Failed to update pick mask word buffer.');
      }
    }
    return wasmState.pickMaskWordBuffer.getBuffer();
  };

  const textureManager = createTextureManager({
    queueSetTextureInfo,
    queueSetTiledTextureInfo,
    queueSetTextureTileInfo,
    acquirePickMaskPageTableBuffer,
    acquirePickMaskWordBuffer,
  });

  const resolveTrackedElementTexIndex = (
    imageId: string | null | undefined
  ) => {
    if (imageId === undefined || imageId === null) {
      return -1;
    }
    return textureManager.resolveTextureIndex(imageId) ?? -1;
  };

  const resolvePlacementElementTexIndices = (
    elements: readonly (SpriteElementPlacement | null | undefined)[]
  ) =>
    elements.map((element) => resolveTrackedElementTexIndex(element?.imageId));

  const applyElementCommandsToTextureIndices = (
    spriteIndex: number,
    commands: Array<{ index: number; update: SpriteElementUpdate | null }>
  ) => {
    if (spriteIndex < 0 || spriteIndex >= spriteElementTexIndices.length) {
      return;
    }
    const plannedTexIndices = [...(spriteElementTexIndices[spriteIndex] ?? [])];
    let nextCount = plannedTexIndices.length;
    const removedIndices: number[] = [];

    for (const command of commands) {
      if (command.update === null) {
        if (command.index >= 0 && command.index < nextCount) {
          removedIndices.push(command.index);
        }
        continue;
      }
      if (command.index === nextCount) {
        plannedTexIndices.push(
          resolveTrackedElementTexIndex(command.update.imageId)
        );
        nextCount += 1;
        continue;
      }
      if (command.index < 0 || command.index >= nextCount) {
        continue;
      }
      if (command.update.imageId !== undefined) {
        plannedTexIndices[command.index] = resolveTrackedElementTexIndex(
          command.update.imageId
        );
      }
    }

    if (removedIndices.length > 0) {
      removedIndices.sort((lhs, rhs) => rhs - lhs);
      for (const index of removedIndices) {
        if (index >= 0 && index < plannedTexIndices.length) {
          plannedTexIndices.splice(index, 1);
        }
      }
    }

    spriteElementTexIndices[spriteIndex] = plannedTexIndices;
  };

  const resolveRequiredSpriteOutputCount = () => {
    let totalOutputParts = 0;
    for (const texIndices of spriteElementTexIndices) {
      for (const texIndex of texIndices) {
        if (!Number.isInteger(texIndex) || texIndex < 0) {
          continue;
        }
        totalOutputParts += Math.max(
          0,
          textureManager.resolveTextureOutputPartCountByTexIndex(texIndex)
        );
      }
    }
    return Math.max(totalElementCount, totalOutputParts);
  };

  const createScratchCommandBuffer = (required: number): InputArrayBuffer =>
    precision === 'f64'
      ? new Float64Array(Math.max(required, 1))
      : new Float32Array(Math.max(required, 1));

  const ensureResolvedElementTexture = (
    buffer: InputArrayBuffer,
    baseOffset: number,
    imageId: string | null | undefined
  ) => {
    const imageMode = Math.trunc(
      buffer[baseOffset + cl.COMMAND_ELEMENT_IMAGE_MODE_OFFSET] ?? 0
    );
    if (imageMode !== cl.COMMAND_IMAGE_MODE_SET) {
      return;
    }
    const texIndex = Math.trunc(
      buffer[baseOffset + cl.COMMAND_ELEMENT_TEX_INDEX_OFFSET] ?? -1
    );
    if (texIndex >= 0) {
      return;
    }
    if (imageId === undefined || imageId === null) {
      throw new Error('Image id is required.');
    }
    throw new Error(`Image "${imageId}" is not registered.`);
  };

  const hasPlacementBorder = (
    element: SpriteElementPlacement | null | undefined
  ) => !!element?.border;

  const resolveUpdatedBorderFlag = (
    update: SpriteElementUpdate,
    currentFlag: boolean
  ) => {
    if (update.border === undefined) {
      return currentFlag;
    }
    if (update.border === null) {
      return false;
    }
    return currentFlag || update.border.width !== undefined;
  };

  const writeSpriteUpdateElementCommand = (
    buffer: InputArrayBuffer,
    baseOffset: number,
    elementIndex: number,
    update: SpriteElementUpdate | null
  ) => {
    buffer[baseOffset + cl.COMMAND_UPDATE_ELEMENT_INDEX_OFFSET] = elementIndex;
    buffer[baseOffset + cl.COMMAND_UPDATE_ELEMENT_KIND_OFFSET] =
      update === null
        ? cl.COMMAND_UPDATE_ELEMENT_KIND_REMOVE
        : cl.COMMAND_UPDATE_ELEMENT_KIND_UPDATE;
    const dataBase = baseOffset + cl.COMMAND_UPDATE_ELEMENT_DATA_OFFSET;
    if (update === null) {
      buffer[dataBase + cl.COMMAND_ELEMENT_KIND_OFFSET] =
        cl.COMMAND_ELEMENT_KIND_NONE;
      return;
    }
    writeElementFields(
      buffer,
      dataBase,
      update,
      'update',
      textureManager.resolveTextureIndex,
      precision
    );
    ensureResolvedElementTexture(buffer, dataBase, update.imageId);
  };

  const validateSpritePlacementCommand = (
    placement: SpritePlacement,
    elements: readonly (SpriteElementPlacement | null | undefined)[],
    elementCount: number,
    size: number
  ) => {
    const scratch = createScratchCommandBuffer(size);
    writeValueCommand(
      scratch,
      cl.COMMAND_ADD_SPRITE_SX_HAS_OFFSET,
      placement.sx,
      precision,
      false,
      false
    );
    writeValueCommand(
      scratch,
      cl.COMMAND_ADD_SPRITE_SY_HAS_OFFSET,
      placement.sy,
      precision,
      false,
      false
    );
    if (placement.sz !== undefined) {
      writeOptionalCommand(
        scratch,
        cl.COMMAND_ADD_SPRITE_SZ_HAS_OFFSET,
        placement.sz
      );
    }
    if (placement.opacity) {
      writeValueCommand(
        scratch,
        cl.COMMAND_ADD_SPRITE_OPACITY_HAS_OFFSET,
        placement.opacity,
        precision,
        false,
        false
      );
    }
    writeVisibilityDistanceCommand(
      scratch,
      cl.COMMAND_ADD_SPRITE_VISIBILITY_DISTANCE_HAS_OFFSET,
      placement.visibilityDistance
    );
    for (let index = 0; index < elementCount; index += 1) {
      const base =
        cl.COMMAND_ADD_SPRITE_ELEMENT_BASE_OFFSET +
        index * cl.COMMAND_ELEMENT_FIELDS;
      const element = elements[index];
      writeElementFields(
        scratch,
        base,
        element,
        'placement',
        textureManager.resolveTextureIndex,
        precision
      );
      ensureResolvedElementTexture(scratch, base, element?.imageId);
    }
  };

  const validateSpriteUpdateCommand = (
    update: SpriteUpdate,
    elementCommands: Array<{
      index: number;
      update: SpriteElementUpdate | null;
    }>,
    size: number
  ) => {
    const scratch = createScratchCommandBuffer(size);
    if (isUpdateValueSpecified(update.sx)) {
      try {
        writeValueCommand(
          scratch,
          cl.COMMAND_UPDATE_SPRITE_SX_HAS_OFFSET,
          update.sx,
          precision,
          true,
          true
        );
      } catch {
        scratch[cl.COMMAND_UPDATE_SPRITE_SX_HAS_OFFSET] = 0;
      }
    }
    if (isUpdateValueSpecified(update.sy)) {
      try {
        writeValueCommand(
          scratch,
          cl.COMMAND_UPDATE_SPRITE_SY_HAS_OFFSET,
          update.sy,
          precision,
          true,
          true
        );
      } catch {
        scratch[cl.COMMAND_UPDATE_SPRITE_SY_HAS_OFFSET] = 0;
      }
    }
    if (update.sz !== undefined) {
      writeOptionalCommand(
        scratch,
        cl.COMMAND_UPDATE_SPRITE_SZ_HAS_OFFSET,
        update.sz
      );
    }
    if (isUpdateValueSpecified(update.opacity)) {
      try {
        writeValueCommand(
          scratch,
          cl.COMMAND_UPDATE_SPRITE_OPACITY_HAS_OFFSET,
          update.opacity,
          precision,
          true,
          true
        );
      } catch {
        scratch[cl.COMMAND_UPDATE_SPRITE_OPACITY_HAS_OFFSET] = 0;
      }
    }
    writeVisibilityDistanceCommand(
      scratch,
      cl.COMMAND_UPDATE_SPRITE_VISIBILITY_DISTANCE_HAS_OFFSET,
      update.visibilityDistance
    );
    scratch[cl.COMMAND_UPDATE_SPRITE_ELEMENT_UPDATE_COUNT_OFFSET] =
      elementCommands.length;
    for (
      let commandIndex = 0;
      commandIndex < elementCommands.length;
      commandIndex += 1
    ) {
      const elementCommand = elementCommands[commandIndex]!;
      const base =
        cl.COMMAND_UPDATE_SPRITE_ELEMENT_BASE_OFFSET +
        commandIndex * cl.COMMAND_UPDATE_ELEMENT_FIELDS;
      writeSpriteUpdateElementCommand(
        scratch,
        base,
        elementCommand.index,
        elementCommand.update
      );
    }
  };

  const validatePolylinePlacementCommand = (
    placement: PolylinePlacement,
    nodes: { x: number; y: number; thickness: number }[],
    colorPayload: {
      color0: { r: number; g: number; b: number; a: number };
      color1: { r: number; g: number; b: number; a: number };
      repeatLength: number;
    },
    renderOptions: NormalizedPolylineRenderOptions,
    layerValue: number | undefined,
    size: number
  ) => {
    const scratch = createScratchCommandBuffer(size);
    if (layerValue !== undefined) {
      writeOptionalCommand(
        scratch,
        cl.COMMAND_ADD_POLYLINE_LAYER_HAS_OFFSET,
        layerValue
      );
    }
    if (placement.opacity) {
      writeValueCommand(
        scratch,
        cl.COMMAND_ADD_POLYLINE_OPACITY_HAS_OFFSET,
        placement.opacity,
        precision,
        false,
        false
      );
    }
    scratch[cl.COMMAND_ADD_POLYLINE_COLOR0_R_OFFSET] = colorPayload.color0.r;
    scratch[cl.COMMAND_ADD_POLYLINE_COLOR0_G_OFFSET] = colorPayload.color0.g;
    scratch[cl.COMMAND_ADD_POLYLINE_COLOR0_B_OFFSET] = colorPayload.color0.b;
    scratch[cl.COMMAND_ADD_POLYLINE_COLOR0_A_OFFSET] = colorPayload.color0.a;
    scratch[cl.COMMAND_ADD_POLYLINE_COLOR1_R_OFFSET] = colorPayload.color1.r;
    scratch[cl.COMMAND_ADD_POLYLINE_COLOR1_G_OFFSET] = colorPayload.color1.g;
    scratch[cl.COMMAND_ADD_POLYLINE_COLOR1_B_OFFSET] = colorPayload.color1.b;
    scratch[cl.COMMAND_ADD_POLYLINE_COLOR1_A_OFFSET] = colorPayload.color1.a;
    scratch[cl.COMMAND_ADD_POLYLINE_REPEAT_LENGTH_OFFSET] =
      colorPayload.repeatLength;
    writePolylineRenderOptions(
      scratch,
      cl.COMMAND_ADD_POLYLINE_JOIN_CORRECTION_MODE_OFFSET,
      cl.COMMAND_ADD_POLYLINE_JOIN_CORRECTION_INTERMEDIATE_POINT_COUNT_OFFSET,
      cl.COMMAND_ADD_POLYLINE_CAP_CORRECTION_MODE_OFFSET,
      cl.COMMAND_ADD_POLYLINE_CAP_CORRECTION_POINT_COUNT_OFFSET,
      renderOptions
    );
    for (let index = 0; index < nodes.length; index += 1) {
      const base =
        cl.COMMAND_ADD_POLYLINE_NODE_BASE_OFFSET +
        index * cl.COMMAND_POLYLINE_NODE_FIELDS;
      const node = nodes[index]!;
      scratch[base + cl.COMMAND_POLYLINE_NODE_X_OFFSET] = node.x;
      scratch[base + cl.COMMAND_POLYLINE_NODE_Y_OFFSET] = node.y;
      scratch[base + cl.COMMAND_POLYLINE_NODE_THICKNESS_OFFSET] =
        node.thickness;
    }
  };

  const validatePolylineUpdateCommand = (
    update: PolylineUpdate,
    nodeCount: number,
    nodes: { x: number; y: number; thickness: number }[] | null,
    colorPayload: {
      color0: { r: number; g: number; b: number; a: number };
      color1: { r: number; g: number; b: number; a: number };
      repeatLength: number;
    } | null,
    joinCorrection: NormalizedPolylineJoinCorrection | null,
    capCorrection: NormalizedPolylineCapCorrection | null,
    size: number
  ) => {
    const scratch = createScratchCommandBuffer(size);
    scratch[cl.COMMAND_UPDATE_POLYLINE_NODE_COUNT_OFFSET] = nodeCount;
    if (update.layer !== undefined) {
      writeOptionalCommand(
        scratch,
        cl.COMMAND_UPDATE_POLYLINE_LAYER_HAS_OFFSET,
        normalizeLayerValue(update.layer)
      );
    }
    if (isUpdateValueSpecified(update.opacity)) {
      try {
        writeValueCommand(
          scratch,
          cl.COMMAND_UPDATE_POLYLINE_OPACITY_HAS_OFFSET,
          update.opacity,
          precision,
          true,
          true
        );
      } catch {
        scratch[cl.COMMAND_UPDATE_POLYLINE_OPACITY_HAS_OFFSET] = 0;
      }
    }
    if (colorPayload) {
      scratch[cl.COMMAND_UPDATE_POLYLINE_COLOR_HAS_OFFSET] = 1;
      scratch[cl.COMMAND_UPDATE_POLYLINE_COLOR0_R_OFFSET] =
        colorPayload.color0.r;
      scratch[cl.COMMAND_UPDATE_POLYLINE_COLOR0_G_OFFSET] =
        colorPayload.color0.g;
      scratch[cl.COMMAND_UPDATE_POLYLINE_COLOR0_B_OFFSET] =
        colorPayload.color0.b;
      scratch[cl.COMMAND_UPDATE_POLYLINE_COLOR0_A_OFFSET] =
        colorPayload.color0.a;
      scratch[cl.COMMAND_UPDATE_POLYLINE_COLOR1_R_OFFSET] =
        colorPayload.color1.r;
      scratch[cl.COMMAND_UPDATE_POLYLINE_COLOR1_G_OFFSET] =
        colorPayload.color1.g;
      scratch[cl.COMMAND_UPDATE_POLYLINE_COLOR1_B_OFFSET] =
        colorPayload.color1.b;
      scratch[cl.COMMAND_UPDATE_POLYLINE_COLOR1_A_OFFSET] =
        colorPayload.color1.a;
      scratch[cl.COMMAND_UPDATE_POLYLINE_REPEAT_LENGTH_OFFSET] =
        colorPayload.repeatLength;
    }
    if (joinCorrection) {
      scratch[cl.COMMAND_UPDATE_POLYLINE_JOIN_CORRECTION_HAS_OFFSET] = 1;
      writePolylineJoinCorrection(
        scratch,
        cl.COMMAND_UPDATE_POLYLINE_JOIN_CORRECTION_MODE_OFFSET,
        cl.COMMAND_UPDATE_POLYLINE_JOIN_CORRECTION_INTERMEDIATE_POINT_COUNT_OFFSET,
        joinCorrection
      );
    }
    if (capCorrection) {
      scratch[cl.COMMAND_UPDATE_POLYLINE_CAP_CORRECTION_HAS_OFFSET] = 1;
      writePolylineCapCorrection(
        scratch,
        cl.COMMAND_UPDATE_POLYLINE_CAP_CORRECTION_MODE_OFFSET,
        cl.COMMAND_UPDATE_POLYLINE_CAP_CORRECTION_POINT_COUNT_OFFSET,
        capCorrection
      );
    }
    if (!nodes) {
      return;
    }
    for (let index = 0; index < nodes.length; index += 1) {
      const base =
        cl.COMMAND_UPDATE_POLYLINE_NODE_BASE_OFFSET +
        index * cl.COMMAND_POLYLINE_NODE_FIELDS;
      const node = nodes[index]!;
      scratch[base + cl.COMMAND_POLYLINE_NODE_X_OFFSET] = node.x;
      scratch[base + cl.COMMAND_POLYLINE_NODE_Y_OFFSET] = node.y;
      scratch[base + cl.COMMAND_POLYLINE_NODE_THICKNESS_OFFSET] =
        node.thickness;
    }
  };

  const queueUpdateCamera = (
    camera: CameraUpdatePayload,
    promiseHandlers: PromiseHandlers<void> | null
  ) => {
    const size = cl.COMMAND_UPDATE_CAMERA_FIELDS;
    if (!flushBeforeQueue(size, promiseHandlers !== null)) {
      throw new Error('Failed to flush queued commands.');
    }
    queueCommand(cl.COMMAND_OP_UPDATE_CAMERA, size, queue_commandRet);
    const position = camera.position;
    const positionX = position?.x;
    if (isUpdateValueSpecified(positionX)) {
      writeValueCommand(
        commandBuffer,
        queue_commandRet.offset +
          cl.COMMAND_UPDATE_CAMERA_POSITION_X_HAS_OFFSET,
        positionX,
        precision,
        true,
        true
      );
    }
    const positionY = position?.y;
    if (isUpdateValueSpecified(positionY)) {
      writeValueCommand(
        commandBuffer,
        queue_commandRet.offset +
          cl.COMMAND_UPDATE_CAMERA_POSITION_Y_HAS_OFFSET,
        positionY,
        precision,
        true,
        true
      );
    }
    const positionZ = position?.z;
    if (isUpdateValueSpecified(positionZ)) {
      writeValueCommand(
        commandBuffer,
        queue_commandRet.offset +
          cl.COMMAND_UPDATE_CAMERA_POSITION_Z_HAS_OFFSET,
        positionZ,
        precision,
        true,
        true
      );
    }
    const rotation = camera.rotation;
    const rotationYaw = rotation?.yaw;
    if (isUpdateValueSpecified(rotationYaw)) {
      writeValueCommand(
        commandBuffer,
        queue_commandRet.offset +
          cl.COMMAND_UPDATE_CAMERA_ROTATION_YAW_HAS_OFFSET,
        rotationYaw,
        precision,
        true,
        true
      );
    }
    const rotationPitch = rotation?.pitch;
    if (isUpdateValueSpecified(rotationPitch)) {
      writeValueCommand(
        commandBuffer,
        queue_commandRet.offset +
          cl.COMMAND_UPDATE_CAMERA_ROTATION_PITCH_HAS_OFFSET,
        rotationPitch,
        precision,
        true,
        true
      );
    }
    const rotationRoll = rotation?.roll;
    if (isUpdateValueSpecified(rotationRoll)) {
      writeValueCommand(
        commandBuffer,
        queue_commandRet.offset +
          cl.COMMAND_UPDATE_CAMERA_ROTATION_ROLL_HAS_OFFSET,
        rotationRoll,
        precision,
        true,
        true
      );
    }
    if (isUpdateValueSpecified(camera.fovY)) {
      writeValueCommand(
        commandBuffer,
        queue_commandRet.offset + cl.COMMAND_UPDATE_CAMERA_FOV_Y_HAS_OFFSET,
        camera.fovY,
        precision,
        true,
        true
      );
    }
    if (camera.near !== undefined) {
      writeOptionalCommand(
        commandBuffer,
        queue_commandRet.offset + cl.COMMAND_UPDATE_CAMERA_NEAR_HAS_OFFSET,
        camera.near
      );
    }
    if (camera.far !== undefined) {
      writeOptionalCommand(
        commandBuffer,
        queue_commandRet.offset + cl.COMMAND_UPDATE_CAMERA_FAR_HAS_OFFSET,
        camera.far
      );
    }
    if (camera.aspectRatio !== undefined) {
      writeOptionalCommand(
        commandBuffer,
        queue_commandRet.offset +
          cl.COMMAND_UPDATE_CAMERA_VIEWPORT_ASPECT_HAS_OFFSET,
        camera.aspectRatio
      );
    }
    const pending: PendingCommand = {
      index: queue_commandRet.commandIndex,
      kind: 'updateCamera',
      camera,
    };
    if (promiseHandlers) {
      pending.resolve = () => {
        promiseHandlers.resolve(undefined);
      };
      pending.reject = promiseHandlers.reject;
    }
    pendingCommands.push(pending);
  };

  const queueAdjustCameraPosition = (
    payload: CameraAdjustPayload,
    promiseHandlers: PromiseHandlers<void> | null
  ) => {
    const size = cl.COMMAND_ADJUST_CAMERA_POSITION_FIELDS;
    if (!flushBeforeQueue(size, promiseHandlers !== null)) {
      throw new Error('Failed to flush queued commands.');
    }
    queueCommand(cl.COMMAND_OP_ADJUST_CAMERA_POSITION, size, queue_commandRet);
    const pitch = payload.pitch;
    if (pitch) {
      writeValueCommand(
        commandBuffer,
        queue_commandRet.offset +
          cl.COMMAND_ADJUST_CAMERA_POSITION_PITCH_HAS_OFFSET,
        pitch,
        precision,
        true,
        false
      );
    }
    const fov = payload.fov;
    if (fov) {
      writeValueCommand(
        commandBuffer,
        queue_commandRet.offset +
          cl.COMMAND_ADJUST_CAMERA_POSITION_FOV_Y_HAS_OFFSET,
        fov,
        precision,
        true,
        false
      );
    }
    if (payload.near !== undefined) {
      writeOptionalCommand(
        commandBuffer,
        queue_commandRet.offset +
          cl.COMMAND_ADJUST_CAMERA_POSITION_NEAR_HAS_OFFSET,
        payload.near
      );
    }
    if (payload.far !== undefined) {
      writeOptionalCommand(
        commandBuffer,
        queue_commandRet.offset +
          cl.COMMAND_ADJUST_CAMERA_POSITION_FAR_HAS_OFFSET,
        payload.far
      );
    }
    const moveInterpolation: ObjectUpdateValue<number> =
      payload.interpolation === undefined
        ? { value: 0 }
        : { value: 0, interpolation: payload.interpolation };
    writeValueCommand(
      commandBuffer,
      queue_commandRet.offset +
        cl.COMMAND_ADJUST_CAMERA_POSITION_MOVE_HAS_OFFSET,
      moveInterpolation,
      precision,
      true,
      false
    );

    const pending: PendingCommand = {
      index: queue_commandRet.commandIndex,
      kind: 'adjustCameraPosition',
      adjustPayload: payload,
    };
    if (promiseHandlers) {
      pending.resolve = () => {
        promiseHandlers.resolve(undefined);
      };
      pending.reject = promiseHandlers.reject;
    }
    pendingCommands.push(pending);
  };

  const finalizeCommandResults = (failures: number[], results: number[]) => {
    const failedCountRaw = parseCommandIndex(
      resultBuffer[cl.COMMAND_RESULT_FAILED_COUNT_OFFSET]!
    );
    const resultCountRaw = parseCommandIndex(
      resultBuffer[cl.COMMAND_RESULT_RESULT_COUNT_OFFSET]!
    );
    const failedCount =
      Number.isFinite(failedCountRaw) && failedCountRaw > 0
        ? failedCountRaw
        : 0;
    const resultCount =
      Number.isFinite(resultCountRaw) && resultCountRaw > 0
        ? resultCountRaw
        : 0;
    if (failedCount > 0) {
      for (let index = 0; index < failedCount; index += 1) {
        const raw = resultBuffer[cl.COMMAND_RESULT_HEADER_FIELDS + index]!;
        const parsed = parseCommandIndex(raw);
        if (Number.isFinite(parsed)) {
          failures.push(parsed);
        }
      }
    }
    if (resultCount > 0) {
      const resultOffset = cl.COMMAND_RESULT_HEADER_FIELDS + failedCount;
      for (let index = 0; index < resultCount; index += 1) {
        const raw = resultBuffer[resultOffset + index]!;
        results.push(raw);
      }
    }
  };

  const resolveCommandOpName = (op: number) => {
    switch (op) {
      case cl.COMMAND_OP_UPDATE_CAMERA:
        return 'updateCamera';
      case cl.COMMAND_OP_ADJUST_CAMERA_POSITION:
        return 'adjustCameraPosition';
      case cl.COMMAND_OP_SET_TEXTURE_INFO:
        return 'setTextureInfo';
      case cl.COMMAND_OP_SET_TILED_TEXTURE_INFO:
        return 'setTiledTextureInfo';
      case cl.COMMAND_OP_SET_TEXTURE_TILE_INFO:
        return 'setTextureTileInfo';
      case cl.COMMAND_OP_ADD_SPRITE:
        return 'addSprite';
      case cl.COMMAND_OP_UPDATE_SPRITE:
        return 'updateSprite';
      case cl.COMMAND_OP_REMOVE_SPRITE:
        return 'removeSprite';
      case cl.COMMAND_OP_ADD_POLYLINE:
        return 'addPolyline';
      case cl.COMMAND_OP_UPDATE_POLYLINE:
        return 'updatePolyline';
      case cl.COMMAND_OP_REMOVE_POLYLINE:
        return 'removePolyline';
      default:
        return `unknown(${op})`;
    }
  };

  const readOptionalSnapshot = (
    buffer: InputArrayBuffer,
    baseOffset: number
  ) => {
    const has = buffer[baseOffset + cl.COMMAND_OPTIONAL_HAS_OFFSET] !== 0;
    if (!has) {
      return { has };
    }
    return {
      has,
      value: buffer[baseOffset + cl.COMMAND_OPTIONAL_VALUE_OFFSET],
    };
  };

  const readInterpolationSnapshot = (
    buffer: InputArrayBuffer,
    baseOffset: number,
    offsets: InterpolationCommandOffsets
  ) => {
    const has = buffer[baseOffset + offsets.has] !== 0;
    if (!has) {
      return { has };
    }
    const hasInterpolation =
      buffer[baseOffset + offsets.hasInterpolation] !== 0;
    return {
      has,
      value: buffer[baseOffset + offsets.value],
      interpolation: hasInterpolation
        ? {
            mode: buffer[baseOffset + offsets.mode],
            duration: buffer[baseOffset + offsets.duration],
            easing: buffer[baseOffset + offsets.easing],
            param0: buffer[baseOffset + offsets.param0],
            param1: buffer[baseOffset + offsets.param1],
            param2: buffer[baseOffset + offsets.param2],
            param3: buffer[baseOffset + offsets.param3],
          }
        : undefined,
    };
  };

  const readValueSnapshot = (buffer: InputArrayBuffer, baseOffset: number) =>
    readInterpolationSnapshot(buffer, baseOffset, VALUE_INTERPOLATION_OFFSETS);

  const readRotationSnapshot = (buffer: InputArrayBuffer, baseOffset: number) =>
    readInterpolationSnapshot(
      buffer,
      baseOffset,
      ROTATION_INTERPOLATION_OFFSETS
    );

  const readAutoDirectionSnapshot = (
    buffer: InputArrayBuffer,
    baseOffset: number
  ) => ({
    spaceHas:
      buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_SPACE_HAS_OFFSET],
    space: buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_SPACE_OFFSET],
    modeHas:
      buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_MODE_HAS_OFFSET],
    mode: buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_MODE_OFFSET],
    shiftAngleRotationHas:
      buffer[
        baseOffset +
          cl.COMMAND_ELEMENT_AUTO_DIRECTION_SHIFT_ANGLE_ROTATION_HAS_OFFSET
      ],
    shiftAngleRotation:
      buffer[
        baseOffset +
          cl.COMMAND_ELEMENT_AUTO_DIRECTION_SHIFT_ANGLE_ROTATION_OFFSET
      ],
    minDistanceHas:
      buffer[
        baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_MIN_DISTANCE_HAS_OFFSET
      ],
    minDistance:
      buffer[
        baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_MIN_DISTANCE_OFFSET
      ],
    flipXHas:
      buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_X_HAS_OFFSET],
    flipX: buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_X_OFFSET],
    flipYHas:
      buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_Y_HAS_OFFSET],
    flipY: buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_Y_OFFSET],
    interpolationHas:
      buffer[baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_HAS_OFFSET],
    interpolationClear:
      buffer[
        baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_CLEAR_OFFSET
      ],
    interpolation:
      buffer[
        baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_HAS_OFFSET
      ] !== 0
        ? {
            mode: buffer[
              baseOffset + cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_MODE_OFFSET
            ],
            duration:
              buffer[
                baseOffset +
                  cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_DURATION_OFFSET
              ],
            easing:
              buffer[
                baseOffset +
                  cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_EASING_OFFSET
              ],
            param0:
              buffer[
                baseOffset +
                  cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_PARAM0_OFFSET
              ],
            param1:
              buffer[
                baseOffset +
                  cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_PARAM1_OFFSET
              ],
            param2:
              buffer[
                baseOffset +
                  cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_PARAM2_OFFSET
              ],
            param3:
              buffer[
                baseOffset +
                  cl.COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_PARAM3_OFFSET
              ],
          }
        : undefined,
  });

  const collectCommandSnapshots = (
    buffer: InputArrayBuffer,
    count: number,
    used: number,
    targetIndices?: Set<number>
  ) => {
    const snapshots: Array<Record<string, unknown>> = [];
    let cursor = cl.COMMAND_BUFFER_HEADER_FIELDS;
    for (let index = 0; index < count; index += 1) {
      if (cursor + cl.COMMAND_HEADER_FIELDS > used) {
        break;
      }
      const op = Math.trunc(buffer[cursor + cl.COMMAND_HEADER_OP_OFFSET]!);
      const size = Math.trunc(buffer[cursor + cl.COMMAND_HEADER_SIZE_OFFSET]!);
      const shouldCollect = !targetIndices || targetIndices.has(index);
      if (shouldCollect) {
        const snapshot: Record<string, unknown> = {
          index,
          op,
          opName: resolveCommandOpName(op),
          size,
        };
        if (op === cl.COMMAND_OP_UPDATE_CAMERA) {
          snapshot.camera = {
            positionX:
              buffer[cursor + cl.COMMAND_UPDATE_CAMERA_POSITION_X_VALUE_OFFSET],
            positionY:
              buffer[cursor + cl.COMMAND_UPDATE_CAMERA_POSITION_Y_VALUE_OFFSET],
            positionZ:
              buffer[cursor + cl.COMMAND_UPDATE_CAMERA_POSITION_Z_VALUE_OFFSET],
            yaw: buffer[
              cursor + cl.COMMAND_UPDATE_CAMERA_ROTATION_YAW_VALUE_OFFSET
            ],
            pitch:
              buffer[
                cursor + cl.COMMAND_UPDATE_CAMERA_ROTATION_PITCH_VALUE_OFFSET
              ],
            roll: buffer[
              cursor + cl.COMMAND_UPDATE_CAMERA_ROTATION_ROLL_VALUE_OFFSET
            ],
            fovY: buffer[cursor + cl.COMMAND_UPDATE_CAMERA_FOV_Y_VALUE_OFFSET],
            near: buffer[cursor + cl.COMMAND_UPDATE_CAMERA_NEAR_VALUE_OFFSET],
            far: buffer[cursor + cl.COMMAND_UPDATE_CAMERA_FAR_VALUE_OFFSET],
            aspect:
              buffer[
                cursor + cl.COMMAND_UPDATE_CAMERA_VIEWPORT_ASPECT_VALUE_OFFSET
              ],
          };
        } else if (op === cl.COMMAND_OP_ADJUST_CAMERA_POSITION) {
          snapshot.adjustCameraPosition = {
            pitch: readValueSnapshot(
              buffer,
              cursor + cl.COMMAND_ADJUST_CAMERA_POSITION_PITCH_HAS_OFFSET
            ),
            fovY: readValueSnapshot(
              buffer,
              cursor + cl.COMMAND_ADJUST_CAMERA_POSITION_FOV_Y_HAS_OFFSET
            ),
            near: readOptionalSnapshot(
              buffer,
              cursor + cl.COMMAND_ADJUST_CAMERA_POSITION_NEAR_HAS_OFFSET
            ),
            far: readOptionalSnapshot(
              buffer,
              cursor + cl.COMMAND_ADJUST_CAMERA_POSITION_FAR_HAS_OFFSET
            ),
            moveInterpolation: readValueSnapshot(
              buffer,
              cursor + cl.COMMAND_ADJUST_CAMERA_POSITION_MOVE_HAS_OFFSET
            ),
          };
        } else if (op === cl.COMMAND_OP_SET_TEXTURE_INFO) {
          snapshot.textureInfo = {
            texIndex:
              buffer[cursor + cl.COMMAND_SET_TEXTURE_INFO_TEX_INDEX_OFFSET],
            width: buffer[cursor + cl.COMMAND_SET_TEXTURE_INFO_WIDTH_OFFSET],
            height: buffer[cursor + cl.COMMAND_SET_TEXTURE_INFO_HEIGHT_OFFSET],
            valid: buffer[cursor + cl.COMMAND_SET_TEXTURE_INFO_VALID_OFFSET],
            pageId: buffer[cursor + cl.COMMAND_SET_TEXTURE_INFO_PAGE_ID_OFFSET],
            u0: buffer[cursor + cl.COMMAND_SET_TEXTURE_INFO_U0_OFFSET],
            v0: buffer[cursor + cl.COMMAND_SET_TEXTURE_INFO_V0_OFFSET],
            u1: buffer[cursor + cl.COMMAND_SET_TEXTURE_INFO_U1_OFFSET],
            v1: buffer[cursor + cl.COMMAND_SET_TEXTURE_INFO_V1_OFFSET],
          };
        } else if (op === cl.COMMAND_OP_ADD_SPRITE) {
          const elementCount = Math.trunc(
            buffer[cursor + cl.COMMAND_ADD_SPRITE_ELEMENT_COUNT_OFFSET]!
          );
          const elements: Array<Record<string, unknown>> = [];
          for (
            let elementIndex = 0;
            elementIndex < elementCount;
            elementIndex += 1
          ) {
            const base =
              cursor +
              cl.COMMAND_ADD_SPRITE_ELEMENT_BASE_OFFSET +
              elementIndex * cl.COMMAND_ELEMENT_FIELDS;
            elements.push({
              kind: buffer[base + cl.COMMAND_ELEMENT_KIND_OFFSET],
              imageMode: buffer[base + cl.COMMAND_ELEMENT_IMAGE_MODE_OFFSET],
              texIndex: buffer[base + cl.COMMAND_ELEMENT_TEX_INDEX_OFFSET],
              originLocationHas:
                buffer[base + cl.COMMAND_ELEMENT_ORIGIN_LOCATION_HAS_OFFSET],
              originLocationIndex:
                buffer[base + cl.COMMAND_ELEMENT_ORIGIN_LOCATION_INDEX_OFFSET],
              originLocationUseResolvedAnchor:
                buffer[
                  base +
                    cl.COMMAND_ELEMENT_ORIGIN_LOCATION_USE_RESOLVED_ANCHOR_OFFSET
                ],
              shiftDistance: readValueSnapshot(
                buffer,
                base + cl.COMMAND_ELEMENT_SHIFT_DISTANCE_HAS_OFFSET
              ),
              shiftAngle: readValueSnapshot(
                buffer,
                base + cl.COMMAND_ELEMENT_SHIFT_ANGLE_HAS_OFFSET
              ),
              scale: readValueSnapshot(
                buffer,
                base + cl.COMMAND_ELEMENT_SCALE_HAS_OFFSET
              ),
              opacity: readValueSnapshot(
                buffer,
                base + cl.COMMAND_ELEMENT_OPACITY_HAS_OFFSET
              ),
              anchorX: readValueSnapshot(
                buffer,
                base + cl.COMMAND_ELEMENT_ANCHOR_X_HAS_OFFSET
              ),
              anchorY: readValueSnapshot(
                buffer,
                base + cl.COMMAND_ELEMENT_ANCHOR_Y_HAS_OFFSET
              ),
              rotation: readRotationSnapshot(
                buffer,
                base + cl.COMMAND_ELEMENT_ROTATION_HAS_OFFSET
              ),
              autoDirection: readAutoDirectionSnapshot(buffer, base),
            });
          }
          snapshot.addSprite = {
            resultIndex:
              buffer[cursor + cl.COMMAND_ADD_SPRITE_RESULT_INDEX_OFFSET],
            elementCount,
            sx: readValueSnapshot(
              buffer,
              cursor + cl.COMMAND_ADD_SPRITE_SX_HAS_OFFSET
            ),
            sy: readValueSnapshot(
              buffer,
              cursor + cl.COMMAND_ADD_SPRITE_SY_HAS_OFFSET
            ),
            sz: readOptionalSnapshot(
              buffer,
              cursor + cl.COMMAND_ADD_SPRITE_SZ_HAS_OFFSET
            ),
            opacity: readValueSnapshot(
              buffer,
              cursor + cl.COMMAND_ADD_SPRITE_OPACITY_HAS_OFFSET
            ),
            visibilityDistance: readOptionalSnapshot(
              buffer,
              cursor + cl.COMMAND_ADD_SPRITE_VISIBILITY_DISTANCE_HAS_OFFSET
            ),
            elements,
          };
        } else if (op === cl.COMMAND_OP_UPDATE_SPRITE) {
          const updateCount = Math.trunc(
            buffer[
              cursor + cl.COMMAND_UPDATE_SPRITE_ELEMENT_UPDATE_COUNT_OFFSET
            ]!
          );
          const updates: Array<Record<string, unknown>> = [];
          for (
            let updateIndex = 0;
            updateIndex < updateCount;
            updateIndex += 1
          ) {
            const base =
              cursor +
              cl.COMMAND_UPDATE_SPRITE_ELEMENT_BASE_OFFSET +
              updateIndex * cl.COMMAND_UPDATE_ELEMENT_FIELDS;
            const dataBase = base + cl.COMMAND_UPDATE_ELEMENT_DATA_OFFSET;
            updates.push({
              index: buffer[base + cl.COMMAND_UPDATE_ELEMENT_INDEX_OFFSET],
              kind: buffer[base + cl.COMMAND_UPDATE_ELEMENT_KIND_OFFSET],
              data: {
                kind: buffer[dataBase + cl.COMMAND_ELEMENT_KIND_OFFSET],
                imageMode:
                  buffer[dataBase + cl.COMMAND_ELEMENT_IMAGE_MODE_OFFSET],
                texIndex:
                  buffer[dataBase + cl.COMMAND_ELEMENT_TEX_INDEX_OFFSET],
                originLocationHas:
                  buffer[
                    dataBase + cl.COMMAND_ELEMENT_ORIGIN_LOCATION_HAS_OFFSET
                  ],
                originLocationIndex:
                  buffer[
                    dataBase + cl.COMMAND_ELEMENT_ORIGIN_LOCATION_INDEX_OFFSET
                  ],
                originLocationUseResolvedAnchor:
                  buffer[
                    dataBase +
                      cl.COMMAND_ELEMENT_ORIGIN_LOCATION_USE_RESOLVED_ANCHOR_OFFSET
                  ],
                shiftDistance: readValueSnapshot(
                  buffer,
                  dataBase + cl.COMMAND_ELEMENT_SHIFT_DISTANCE_HAS_OFFSET
                ),
                shiftAngle: readValueSnapshot(
                  buffer,
                  dataBase + cl.COMMAND_ELEMENT_SHIFT_ANGLE_HAS_OFFSET
                ),
                scale: readValueSnapshot(
                  buffer,
                  dataBase + cl.COMMAND_ELEMENT_SCALE_HAS_OFFSET
                ),
                opacity: readValueSnapshot(
                  buffer,
                  dataBase + cl.COMMAND_ELEMENT_OPACITY_HAS_OFFSET
                ),
                anchorX: readValueSnapshot(
                  buffer,
                  dataBase + cl.COMMAND_ELEMENT_ANCHOR_X_HAS_OFFSET
                ),
                anchorY: readValueSnapshot(
                  buffer,
                  dataBase + cl.COMMAND_ELEMENT_ANCHOR_Y_HAS_OFFSET
                ),
                rotation: readRotationSnapshot(
                  buffer,
                  dataBase + cl.COMMAND_ELEMENT_ROTATION_HAS_OFFSET
                ),
                autoDirection: readAutoDirectionSnapshot(buffer, dataBase),
              },
            });
          }
          snapshot.updateSprite = {
            spriteId:
              buffer[cursor + cl.COMMAND_UPDATE_SPRITE_SPRITE_ID_OFFSET],
            sx: readValueSnapshot(
              buffer,
              cursor + cl.COMMAND_UPDATE_SPRITE_SX_HAS_OFFSET
            ),
            sy: readValueSnapshot(
              buffer,
              cursor + cl.COMMAND_UPDATE_SPRITE_SY_HAS_OFFSET
            ),
            sz: readOptionalSnapshot(
              buffer,
              cursor + cl.COMMAND_UPDATE_SPRITE_SZ_HAS_OFFSET
            ),
            opacity: readValueSnapshot(
              buffer,
              cursor + cl.COMMAND_UPDATE_SPRITE_OPACITY_HAS_OFFSET
            ),
            visibilityDistance: readOptionalSnapshot(
              buffer,
              cursor + cl.COMMAND_UPDATE_SPRITE_VISIBILITY_DISTANCE_HAS_OFFSET
            ),
            updates,
          };
        } else if (op === cl.COMMAND_OP_REMOVE_SPRITE) {
          snapshot.removeSprite = {
            spriteId:
              buffer[cursor + cl.COMMAND_REMOVE_SPRITE_SPRITE_ID_OFFSET],
          };
        } else if (op === cl.COMMAND_OP_ADD_POLYLINE) {
          const nodeCount = Math.trunc(
            buffer[cursor + cl.COMMAND_ADD_POLYLINE_NODE_COUNT_OFFSET]!
          );
          const nodes: Array<Record<string, unknown>> = [];
          for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
            const base =
              cursor +
              cl.COMMAND_ADD_POLYLINE_NODE_BASE_OFFSET +
              nodeIndex * cl.COMMAND_POLYLINE_NODE_FIELDS;
            nodes.push({
              x: buffer[base + cl.COMMAND_POLYLINE_NODE_X_OFFSET],
              y: buffer[base + cl.COMMAND_POLYLINE_NODE_Y_OFFSET],
              thickness:
                buffer[base + cl.COMMAND_POLYLINE_NODE_THICKNESS_OFFSET],
            });
          }
          snapshot.addPolyline = {
            resultIndex:
              buffer[cursor + cl.COMMAND_ADD_POLYLINE_RESULT_INDEX_OFFSET],
            nodeCount,
            layer: readOptionalSnapshot(
              buffer,
              cursor + cl.COMMAND_ADD_POLYLINE_LAYER_HAS_OFFSET
            ),
            opacity: readValueSnapshot(
              buffer,
              cursor + cl.COMMAND_ADD_POLYLINE_OPACITY_HAS_OFFSET
            ),
            color: {
              color0: {
                r: buffer[cursor + cl.COMMAND_ADD_POLYLINE_COLOR0_R_OFFSET],
                g: buffer[cursor + cl.COMMAND_ADD_POLYLINE_COLOR0_G_OFFSET],
                b: buffer[cursor + cl.COMMAND_ADD_POLYLINE_COLOR0_B_OFFSET],
                a: buffer[cursor + cl.COMMAND_ADD_POLYLINE_COLOR0_A_OFFSET],
              },
              color1: {
                r: buffer[cursor + cl.COMMAND_ADD_POLYLINE_COLOR1_R_OFFSET],
                g: buffer[cursor + cl.COMMAND_ADD_POLYLINE_COLOR1_G_OFFSET],
                b: buffer[cursor + cl.COMMAND_ADD_POLYLINE_COLOR1_B_OFFSET],
                a: buffer[cursor + cl.COMMAND_ADD_POLYLINE_COLOR1_A_OFFSET],
              },
              repeatLength:
                buffer[cursor + cl.COMMAND_ADD_POLYLINE_REPEAT_LENGTH_OFFSET],
            },
            joinCorrection: formatPolylineJoinCorrection(
              buffer[
                cursor + cl.COMMAND_ADD_POLYLINE_JOIN_CORRECTION_MODE_OFFSET
              ] ?? 0,
              buffer[
                cursor +
                  cl.COMMAND_ADD_POLYLINE_JOIN_CORRECTION_INTERMEDIATE_POINT_COUNT_OFFSET
              ] ?? 0
            ),
            capCorrection: formatPolylineCapCorrection(
              buffer[
                cursor + cl.COMMAND_ADD_POLYLINE_CAP_CORRECTION_MODE_OFFSET
              ] ?? 0,
              buffer[
                cursor +
                  cl.COMMAND_ADD_POLYLINE_CAP_CORRECTION_POINT_COUNT_OFFSET
              ] ?? 0
            ),
            nodes,
          };
        } else if (op === cl.COMMAND_OP_UPDATE_POLYLINE) {
          const nodeCount = Math.trunc(
            buffer[cursor + cl.COMMAND_UPDATE_POLYLINE_NODE_COUNT_OFFSET]!
          );
          const hasNodes = nodeCount >= 0;
          const nodes: Array<Record<string, unknown>> = [];
          if (hasNodes) {
            for (let nodeIndex = 0; nodeIndex < nodeCount; nodeIndex += 1) {
              const base =
                cursor +
                cl.COMMAND_UPDATE_POLYLINE_NODE_BASE_OFFSET +
                nodeIndex * cl.COMMAND_POLYLINE_NODE_FIELDS;
              nodes.push({
                x: buffer[base + cl.COMMAND_POLYLINE_NODE_X_OFFSET],
                y: buffer[base + cl.COMMAND_POLYLINE_NODE_Y_OFFSET],
                thickness:
                  buffer[base + cl.COMMAND_POLYLINE_NODE_THICKNESS_OFFSET],
              });
            }
          }
          const colorHas =
            buffer[cursor + cl.COMMAND_UPDATE_POLYLINE_COLOR_HAS_OFFSET] !== 0;
          const joinCorrectionHas =
            buffer[
              cursor + cl.COMMAND_UPDATE_POLYLINE_JOIN_CORRECTION_HAS_OFFSET
            ] !== 0;
          const capCorrectionHas =
            buffer[
              cursor + cl.COMMAND_UPDATE_POLYLINE_CAP_CORRECTION_HAS_OFFSET
            ] !== 0;
          snapshot.updatePolyline = {
            polylineId:
              buffer[cursor + cl.COMMAND_UPDATE_POLYLINE_POLYLINE_ID_OFFSET],
            issuedAtMs:
              buffer[
                cursor + cl.COMMAND_UPDATE_POLYLINE_ISSUED_AT_TIMESTAMP_OFFSET
              ],
            nodeCount,
            layer: readOptionalSnapshot(
              buffer,
              cursor + cl.COMMAND_UPDATE_POLYLINE_LAYER_HAS_OFFSET
            ),
            opacity: readValueSnapshot(
              buffer,
              cursor + cl.COMMAND_UPDATE_POLYLINE_OPACITY_HAS_OFFSET
            ),
            colorHas,
            color: colorHas
              ? {
                  color0: {
                    r: buffer[
                      cursor + cl.COMMAND_UPDATE_POLYLINE_COLOR0_R_OFFSET
                    ],
                    g: buffer[
                      cursor + cl.COMMAND_UPDATE_POLYLINE_COLOR0_G_OFFSET
                    ],
                    b: buffer[
                      cursor + cl.COMMAND_UPDATE_POLYLINE_COLOR0_B_OFFSET
                    ],
                    a: buffer[
                      cursor + cl.COMMAND_UPDATE_POLYLINE_COLOR0_A_OFFSET
                    ],
                  },
                  color1: {
                    r: buffer[
                      cursor + cl.COMMAND_UPDATE_POLYLINE_COLOR1_R_OFFSET
                    ],
                    g: buffer[
                      cursor + cl.COMMAND_UPDATE_POLYLINE_COLOR1_G_OFFSET
                    ],
                    b: buffer[
                      cursor + cl.COMMAND_UPDATE_POLYLINE_COLOR1_B_OFFSET
                    ],
                    a: buffer[
                      cursor + cl.COMMAND_UPDATE_POLYLINE_COLOR1_A_OFFSET
                    ],
                  },
                  repeatLength:
                    buffer[
                      cursor + cl.COMMAND_UPDATE_POLYLINE_REPEAT_LENGTH_OFFSET
                    ],
                }
              : undefined,
            joinCorrection: joinCorrectionHas
              ? formatPolylineJoinCorrection(
                  buffer[
                    cursor +
                      cl.COMMAND_UPDATE_POLYLINE_JOIN_CORRECTION_MODE_OFFSET
                  ] ?? 0,
                  buffer[
                    cursor +
                      cl.COMMAND_UPDATE_POLYLINE_JOIN_CORRECTION_INTERMEDIATE_POINT_COUNT_OFFSET
                  ] ?? 0
                )
              : undefined,
            capCorrection: capCorrectionHas
              ? formatPolylineCapCorrection(
                  buffer[
                    cursor +
                      cl.COMMAND_UPDATE_POLYLINE_CAP_CORRECTION_MODE_OFFSET
                  ] ?? 0,
                  buffer[
                    cursor +
                      cl.COMMAND_UPDATE_POLYLINE_CAP_CORRECTION_POINT_COUNT_OFFSET
                  ] ?? 0
                )
              : undefined,
            nodes: hasNodes ? nodes : undefined,
          };
        } else if (op === cl.COMMAND_OP_REMOVE_POLYLINE) {
          snapshot.removePolyline = {
            polylineId:
              buffer[cursor + cl.COMMAND_REMOVE_POLYLINE_POLYLINE_ID_OFFSET],
          };
        }
        snapshots.push(snapshot);
      }
      cursor += size;
    }
    return snapshots;
  };

  const describeCommandFailure = (index: number) => {
    const command = pendingCommands.find((entry) => entry.index === index);
    if (!command) {
      return { index, kind: 'unknown' };
    }
    if (command.kind === 'addSprite') {
      return {
        index,
        kind: command.kind,
        placement: command.placement,
        elementCount: command.elementCount,
        resultIndex: command.resultIndex,
      };
    }
    if (command.kind === 'updateSprite') {
      return {
        index,
        kind: command.kind,
        spriteId: command.spriteId,
        elementUpdates: command.elementUpdates,
      };
    }
    if (command.kind === 'addPolyline') {
      return {
        index,
        kind: command.kind,
        placement: command.placement,
        nodeCount: command.nodeCount,
        resultIndex: command.resultIndex,
      };
    }
    if (command.kind === 'updatePolyline') {
      return {
        index,
        kind: command.kind,
        polylineId: command.polylineId,
        nodeCount: command.nodeCount,
      };
    }
    if (command.kind === 'updateCamera') {
      return {
        index,
        kind: command.kind,
        camera: command.camera,
      };
    }
    if (command.kind === 'adjustCameraPosition') {
      return {
        index,
        kind: command.kind,
        payload: command.adjustPayload,
      };
    }
    if (command.kind === 'removeSprite') {
      return { index, kind: command.kind, spriteId: command.spriteId };
    }
    if (command.kind === 'removePolyline') {
      return { index, kind: command.kind, polylineId: command.polylineId };
    }
    return { index, kind: command.kind };
  };

  const applyElementCommandsToCounts = (
    spriteIndex: number,
    commands: Array<{ index: number; update: SpriteElementUpdate | null }>
  ) => {
    if (spriteIndex < 0 || spriteIndex >= spriteElementCounts.length) {
      return;
    }
    const initialCount = spriteElementCounts[spriteIndex]!;
    let nextCount = initialCount;
    let removeCount = 0;
    for (const command of commands) {
      if (command.update === null) {
        if (command.index >= 0 && command.index < nextCount) {
          removeCount += 1;
        }
        continue;
      }
      if (command.index === nextCount) {
        nextCount += 1;
      }
    }
    const finalCount = Math.max(0, nextCount - removeCount);
    spriteElementCounts[spriteIndex] = finalCount;
    totalElementCount = Math.max(
      0,
      totalElementCount + (finalCount - initialCount)
    );
  };

  const applyElementCommandsToLeaderlines = (
    spriteIndex: number,
    commands: Array<{ index: number; update: SpriteElementUpdate | null }>
  ) => {
    if (spriteIndex < 0 || spriteIndex >= spriteLeaderlineFlags.length) {
      return;
    }
    const initialCount = spriteLeaderlineCounts[spriteIndex] ?? 0;
    const plannedFlags = [...(spriteLeaderlineFlags[spriteIndex] ?? [])];
    let nextCount = plannedFlags.length;
    const removedIndices: number[] = [];

    for (const command of commands) {
      if (command.update === null) {
        if (command.index >= 0 && command.index < nextCount) {
          removedIndices.push(command.index);
        }
        continue;
      }
      if (command.index === nextCount) {
        const hasLeaderline = command.update.leaderline !== undefined;
        plannedFlags.push(hasLeaderline);
        nextCount += 1;
        continue;
      }
      if (command.index < 0 || command.index >= nextCount) {
        continue;
      }
      if (command.update.leaderline !== undefined) {
        const hasLeaderline = command.update.leaderline !== null;
        plannedFlags[command.index] = hasLeaderline;
      }
    }

    if (removedIndices.length > 0) {
      removedIndices.sort((a, b) => b - a);
      for (const index of removedIndices) {
        if (index >= 0 && index < plannedFlags.length) {
          plannedFlags.splice(index, 1);
        }
      }
    }

    const finalCount = plannedFlags.reduce(
      (sum, flag) => (flag ? sum + 1 : sum),
      0
    );
    spriteLeaderlineFlags[spriteIndex] = plannedFlags;
    spriteLeaderlineCounts[spriteIndex] = finalCount;
    totalLeaderlineCount = Math.max(
      0,
      totalLeaderlineCount + (finalCount - initialCount)
    );
  };

  const applyElementCommandsToBorders = (
    spriteIndex: number,
    commands: Array<{ index: number; update: SpriteElementUpdate | null }>
  ) => {
    if (spriteIndex < 0 || spriteIndex >= spriteBorderFlags.length) {
      return;
    }
    const initialCount = spriteBorderCounts[spriteIndex] ?? 0;
    const plannedFlags = [...(spriteBorderFlags[spriteIndex] ?? [])];
    let nextCount = plannedFlags.length;
    const removedIndices: number[] = [];

    for (const command of commands) {
      if (command.update === null) {
        if (command.index >= 0 && command.index < nextCount) {
          removedIndices.push(command.index);
        }
        continue;
      }
      if (command.index === nextCount) {
        plannedFlags.push(resolveUpdatedBorderFlag(command.update, false));
        nextCount += 1;
        continue;
      }
      if (command.index < 0 || command.index >= nextCount) {
        continue;
      }
      plannedFlags[command.index] = resolveUpdatedBorderFlag(
        command.update,
        plannedFlags[command.index] ?? false
      );
    }

    if (removedIndices.length > 0) {
      removedIndices.sort((a, b) => b - a);
      for (const index of removedIndices) {
        if (index >= 0 && index < plannedFlags.length) {
          plannedFlags.splice(index, 1);
        }
      }
    }

    const finalCount = plannedFlags.reduce(
      (sum, flag) => (flag ? sum + 1 : sum),
      0
    );
    spriteBorderFlags[spriteIndex] = plannedFlags;
    spriteBorderCounts[spriteIndex] = finalCount;
    totalBorderCount = Math.max(
      0,
      totalBorderCount + (finalCount - initialCount)
    );
  };

  const applyCommandResults_failureSet = new Set<number>(); // DIRTY HACK: common buffer, reuseable
  const applyCommandResults = (failures: number[], results: number[]) => {
    if (pendingCommands.length === 0) {
      return;
    }

    applyCommandResults_failureSet.clear();
    for (const failure of failures) {
      applyCommandResults_failureSet.add(failure);
    }

    for (const command of pendingCommands) {
      if (applyCommandResults_failureSet.has(command.index)) {
        if (command.reject) {
          const message =
            command.kind === 'updateCamera'
              ? 'Camera command failed.'
              : command.kind === 'adjustCameraPosition'
                ? 'Camera adjust command failed.'
                : 'Sprite command failed.';
          command.reject(createCommandErrorFromPending(message, command));
        }
        continue;
      }

      if (command.kind === 'addSprite') {
        const hasResultIndex = command.resultIndex !== undefined;
        let spriteIndex: number | null = null;
        if (hasResultIndex) {
          const resultIndex = command.resultIndex ?? -1;
          const resolvedIndex =
            resultIndex >= 0 && resultIndex < results.length
              ? parseResultIndex(results[resultIndex]!)
              : Number.NaN;
          if (Number.isFinite(resolvedIndex)) {
            spriteIndex = Math.trunc(resolvedIndex as number);
          } else if (command.reject) {
            logger.warn('Wasm command returned no sprite id.', {
              index: command.index,
              resultIndex,
              resultsCount: results.length,
              placement: command.placement,
            });
            command.reject(
              createCommandError('Sprite command failed.', command.placement)
            );
            continue;
          }
        } else {
          spriteIndex = spriteElementCounts.length;
        }
        if (spriteIndex !== null && spriteIndex >= 0) {
          const elementCount = command.elementCount ?? 0;
          const leaderlineFlags = command.leaderlineFlags
            ? [...command.leaderlineFlags]
            : [];
          const borderFlags = command.borderFlags
            ? [...command.borderFlags]
            : [];
          if (leaderlineFlags.length < elementCount) {
            leaderlineFlags.push(
              ...Array.from(
                { length: elementCount - leaderlineFlags.length },
                () => false
              )
            );
          } else if (leaderlineFlags.length > elementCount) {
            leaderlineFlags.length = elementCount;
          }
          const leaderlineCount = leaderlineFlags.reduce(
            (sum, flag) => (flag ? sum + 1 : sum),
            0
          );
          if (borderFlags.length < elementCount) {
            borderFlags.push(
              ...Array.from(
                { length: elementCount - borderFlags.length },
                () => false
              )
            );
          } else if (borderFlags.length > elementCount) {
            borderFlags.length = elementCount;
          }
          const borderCount = borderFlags.reduce(
            (sum, flag) => (flag ? sum + 1 : sum),
            0
          );
          spriteIdMap.insertIndex(spriteIndex, command.spriteId ?? null);
          spriteElementCounts.splice(spriteIndex, 0, elementCount);
          spriteLeaderlineFlags.splice(spriteIndex, 0, leaderlineFlags);
          spriteLeaderlineCounts.splice(spriteIndex, 0, leaderlineCount);
          spriteBorderFlags.splice(spriteIndex, 0, borderFlags);
          spriteBorderCounts.splice(spriteIndex, 0, borderCount);
          spriteElementTexIndices.splice(spriteIndex, 0, [
            ...(command.elementTexIndices ?? []),
          ]);
          totalElementCount += elementCount;
          totalLeaderlineCount += leaderlineCount;
          totalBorderCount += borderCount;
          if (command.resolve) {
            command.resolve(command.spriteId);
          }
        } else if (command.reject) {
          command.reject(
            createCommandError('Sprite command failed.', command.placement)
          );
        }
        continue;
      }

      if (command.kind === 'updateSprite') {
        const spriteIndex = command.spriteIndex ?? -1;
        if (spriteIndex < 0 || spriteIndex >= spriteElementCounts.length) {
          continue;
        }
        const updates = command.elementUpdates ?? [];
        const initialCount = spriteElementCounts[spriteIndex]!;
        let nextCount = initialCount;
        let removeCount = 0;
        for (const update of updates) {
          if (update.kind === cl.COMMAND_UPDATE_ELEMENT_KIND_REMOVE) {
            if (update.index >= 0 && update.index < nextCount) {
              removeCount += 1;
            }
            continue;
          }
          if (update.index === nextCount) {
            nextCount += 1;
          }
        }
        const finalCount = Math.max(0, nextCount - removeCount);
        spriteElementCounts[spriteIndex] = finalCount;
        totalElementCount = Math.max(
          0,
          totalElementCount + (finalCount - initialCount)
        );
        if (command.elementCommands) {
          applyElementCommandsToTextureIndices(
            spriteIndex,
            command.elementCommands
          );
          applyElementCommandsToLeaderlines(
            spriteIndex,
            command.elementCommands
          );
          applyElementCommandsToBorders(spriteIndex, command.elementCommands);
        }
        if (command.resolve) {
          command.resolve();
        }
        continue;
      }

      if (command.kind === 'addPolyline') {
        const hasResultIndex = command.resultIndex !== undefined;
        let polylineIndex: number | null = null;
        if (hasResultIndex) {
          const resultIndex = command.resultIndex ?? -1;
          const resolvedIndex =
            resultIndex >= 0 && resultIndex < results.length
              ? parseResultIndex(results[resultIndex]!)
              : Number.NaN;
          if (Number.isFinite(resolvedIndex)) {
            polylineIndex = Math.trunc(resolvedIndex as number);
          } else if (command.reject) {
            logger.warn('Wasm command returned no polyline id.', {
              index: command.index,
              resultIndex,
              resultsCount: results.length,
              placement: command.placement,
            });
            command.reject(
              createCommandError('Polyline command failed.', command.placement)
            );
            continue;
          }
        } else {
          polylineIndex = polylineNodeCounts.length;
        }
        if (polylineIndex !== null && polylineIndex >= 0) {
          const nodeCount = command.nodeCount ?? 0;
          const renderOptions =
            command.polylineRenderOptions ??
            DEFAULT_NORMALIZED_POLYLINE_RENDER_OPTIONS;
          polylineIdMap.insertIndex(polylineIndex, command.polylineId ?? null);
          polylineNodeCounts.splice(polylineIndex, 0, nodeCount);
          polylineRenderOptions.splice(polylineIndex, 0, renderOptions);
          totalPolylineNodeCount += nodeCount;
          if (command.resolve) {
            command.resolve(command.polylineId);
          }
        } else if (command.reject) {
          command.reject(
            createCommandError('Polyline command failed.', command.placement)
          );
        }
        continue;
      }

      if (command.kind === 'updatePolyline') {
        const polylineIndex = command.polylineIndex ?? -1;
        if (polylineIndex < 0 || polylineIndex >= polylineNodeCounts.length) {
          continue;
        }
        if (command.nodeCount !== undefined) {
          const initialCount = polylineNodeCounts[polylineIndex]!;
          const finalCount = command.nodeCount;
          polylineNodeCounts[polylineIndex] = finalCount;
          totalPolylineNodeCount = Math.max(
            0,
            totalPolylineNodeCount + (finalCount - initialCount)
          );
        }
        if (command.polylineRenderOptions) {
          polylineRenderOptions[polylineIndex] = command.polylineRenderOptions;
        }
        if (command.resolve) {
          command.resolve();
        }
        continue;
      }

      if (command.kind === 'updateCamera') {
        if (command.resolve) {
          command.resolve();
        }
        continue;
      }
      if (command.kind === 'adjustCameraPosition') {
        if (command.resolve) {
          command.resolve();
        }
        continue;
      }

      if (command.kind === 'removeSprite') {
        const spriteIndex = command.spriteIndex ?? -1;
        if (spriteIndex >= 0 && spriteIndex < spriteElementCounts.length) {
          const removedCount = spriteElementCounts[spriteIndex]!;
          const removedLeaderlineCount =
            spriteLeaderlineCounts[spriteIndex] ?? 0;
          const removedBorderCount = spriteBorderCounts[spriteIndex] ?? 0;
          totalElementCount = Math.max(0, totalElementCount - removedCount);
          totalLeaderlineCount = Math.max(
            0,
            totalLeaderlineCount - removedLeaderlineCount
          );
          totalBorderCount = Math.max(0, totalBorderCount - removedBorderCount);
          spriteIdMap.removeIndex(spriteIndex);
          spriteElementCounts.splice(spriteIndex, 1);
          spriteLeaderlineCounts.splice(spriteIndex, 1);
          spriteLeaderlineFlags.splice(spriteIndex, 1);
          spriteBorderCounts.splice(spriteIndex, 1);
          spriteBorderFlags.splice(spriteIndex, 1);
          spriteElementTexIndices.splice(spriteIndex, 1);
        }
        if (command.resolve) {
          command.resolve();
        }
      }

      if (command.kind === 'removePolyline') {
        const polylineIndex = command.polylineIndex ?? -1;
        if (polylineIndex >= 0 && polylineIndex < polylineNodeCounts.length) {
          const removedCount = polylineNodeCounts[polylineIndex]!;
          totalPolylineNodeCount = Math.max(
            0,
            totalPolylineNodeCount - removedCount
          );
          polylineIdMap.removeIndex(polylineIndex);
          polylineNodeCounts.splice(polylineIndex, 1);
          polylineRenderOptions.splice(polylineIndex, 1);
        }
        if (command.resolve) {
          command.resolve();
        }
      }
    }
  };

  const resetCommandBuffer = () => {
    commandUsed = cl.COMMAND_BUFFER_HEADER_FIELDS;
    commandCount = 0;
    commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
    commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = 0;
    pendingCommands.length = 0;
    pendingSpriteRemovalIndices.length = 0;
    pendingSpriteRemovalIds.clear();
    pendingPolylineRemovalIndices.length = 0;
    pendingPolylineRemovalIds.clear();
    pendingUpdateSpriteCommandCount = 0;
    pendingUpdateSpriteFirstQueuedAtMs = null;
    nextResultIndex = 0;
    pendingResultCount = 0;
  };

  const allocateAtlas = (options?: SpriteAtlasOptions) =>
    textureManager.allocateAtlas(options);

  const registerImage = async (
    atlasId: number,
    imageId: string,
    imageSource: TexImageSource,
    upScalingToPowerOfTwo = false,
    options?: SpriteImageRegisterOptions
  ): Promise<SizeInPixel> =>
    textureManager.registerImage(
      atlasId,
      imageId,
      imageSource,
      upScalingToPowerOfTwo,
      options
    );

  const registerTextGlyph = async (
    atlasId: number,
    imageId: string,
    text: string,
    dimensions: SpriteTextGlyphDimensions,
    options?: SpriteTextGlyphOptions
  ): Promise<SizeInPixel> =>
    textureManager.registerTextGlyph(
      atlasId,
      imageId,
      text,
      dimensions,
      options
    );

  const unregisterImage = (imageId: string) => {
    textureManager.unregisterImage(imageId);
  };

  const releaseAtlas = (atlasId: number) => {
    textureManager.releaseAtlas(atlasId);
  };

  // =================================================

  function addSprite(placement: SpritePlacement): void;
  function addSprite(placement: SpritePlacement, awaitable: false): void;
  function addSprite(
    placement: SpritePlacement,
    awaitable: true
  ): Promise<number>;
  function addSprite(
    placement: SpritePlacement,
    awaitable: boolean = false
  ): void | Promise<number> {
    const promiseHandlers = awaitable ? createPromiseHandlers<number>() : null;

    if (!placement || typeof placement !== 'object') {
      if (promiseHandlers) {
        promiseHandlers.reject(createCommandError('Placement is required.'));
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const elements = Array.isArray(placement.elements)
      ? placement.elements
      : [];
    if (elements.length > wl.WASM_MAX_ELEMENTS_PER_SPRITE) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCommandError(
            `Sprite element count must be less than or equal to ${wl.WASM_MAX_ELEMENTS_PER_SPRITE}.`,
            placement
          )
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const elementCount = elements.length;
    const leaderlineFlags = elements.map((element) => !!element?.leaderline);
    const borderFlags = elements.map((element) => hasPlacementBorder(element));
    const size =
      cl.COMMAND_ADD_SPRITE_BASE_FIELDS +
      elementCount * cl.COMMAND_ELEMENT_FIELDS;
    try {
      validateSpritePlacementCommand(placement, elements, elementCount, size);
    } catch (error) {
      if (promiseHandlers) {
        const message =
          error instanceof Error ? error.message : 'Invalid data.';
        promiseHandlers.reject(createCommandError(message, placement));
        return promiseHandlers.promise;
      }
      return undefined;
    }
    if (
      !flushBeforeQueue(size, promiseHandlers !== null, promiseHandlers ? 1 : 0)
    ) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCommandError('Sprite command failed.', placement)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const resultIndex = promiseHandlers ? nextResultIndex++ : -1;
    if (promiseHandlers) {
      pendingResultCount = Math.max(pendingResultCount, resultIndex + 1);
    }

    const previousCommandUsed = commandUsed;
    const previousCommandCount = commandCount;
    queueCommand(cl.COMMAND_OP_ADD_SPRITE, size, queue_commandRet);

    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_ADD_SPRITE_RESULT_INDEX_OFFSET
    ] = resultIndex;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_ADD_SPRITE_ELEMENT_COUNT_OFFSET
    ] = elementCount;

    try {
      writeValueCommand(
        commandBuffer,
        queue_commandRet.offset + cl.COMMAND_ADD_SPRITE_SX_HAS_OFFSET,
        placement.sx,
        precision,
        false,
        false
      );
      writeValueCommand(
        commandBuffer,
        queue_commandRet.offset + cl.COMMAND_ADD_SPRITE_SY_HAS_OFFSET,
        placement.sy,
        precision,
        false,
        false
      );
      if (placement.sz !== undefined) {
        writeOptionalCommand(
          commandBuffer,
          queue_commandRet.offset + cl.COMMAND_ADD_SPRITE_SZ_HAS_OFFSET,
          placement.sz
        );
      }
      if (placement.opacity) {
        writeValueCommand(
          commandBuffer,
          queue_commandRet.offset + cl.COMMAND_ADD_SPRITE_OPACITY_HAS_OFFSET,
          placement.opacity,
          precision,
          false,
          false
        );
      }
      writeVisibilityDistanceCommand(
        commandBuffer,
        queue_commandRet.offset +
          cl.COMMAND_ADD_SPRITE_VISIBILITY_DISTANCE_HAS_OFFSET,
        placement.visibilityDistance
      );

      for (let index = 0; index < elementCount; index += 1) {
        const base =
          queue_commandRet.offset +
          cl.COMMAND_ADD_SPRITE_ELEMENT_BASE_OFFSET +
          index * cl.COMMAND_ELEMENT_FIELDS;
        writeElementFields(
          commandBuffer,
          base,
          elements[index],
          'placement',
          textureManager.resolveTextureIndex,
          precision
        );
      }
    } catch (error) {
      commandUsed = previousCommandUsed;
      commandCount = previousCommandCount;
      commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
      commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = commandCount;
      if (promiseHandlers) {
        nextResultIndex = Math.max(0, nextResultIndex - 1);
      }
      if (promiseHandlers) {
        const message =
          error instanceof Error ? error.message : 'Invalid data.';
        promiseHandlers.reject(createCommandError(message, placement));
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const publicSpriteId = promiseHandlers ? spriteIdMap.allocateId() : null;
    if (publicSpriteId !== null) {
      spriteTrackingSnapshots.set(
        publicSpriteId,
        createSpriteTrackingSnapshot(placement)
      );
    }
    const pending: PendingCommand = {
      index: queue_commandRet.commandIndex,
      kind: 'addSprite',
      placement,
      elementCount,
      leaderlineFlags,
      borderFlags,
      elementTexIndices: resolvePlacementElementTexIndices(elements),
    };
    if (publicSpriteId !== null) {
      pending.spriteId = publicSpriteId;
    }
    if (promiseHandlers) {
      pending.resultIndex = resultIndex;
      pending.resolve = () => {
        promiseHandlers.resolve(publicSpriteId as number);
      };
      pending.reject = promiseHandlers.reject;
    }
    pendingCommands.push(pending);

    return promiseHandlers?.promise;
  }

  // =================================================

  function addSprites(placements: readonly SpritePlacement[]): void;
  function addSprites(
    placements: readonly SpritePlacement[],
    awaitable: false
  ): void;
  function addSprites(
    placements: readonly SpritePlacement[],
    awaitable: true
  ): Promise<number[]>;
  function addSprites(
    placements: readonly SpritePlacement[],
    awaitable: boolean = false
  ): void | Promise<number[]> {
    const promiseHandlers = awaitable
      ? createPromiseHandlers<number[]>()
      : null;

    if (!Array.isArray(placements)) {
      if (promiseHandlers) {
        promiseHandlers.reject(createCommandError('Placements are required.'));
        return promiseHandlers.promise;
      }
      return undefined;
    }

    if (placements.length === 0) {
      if (promiseHandlers) {
        promiseHandlers.resolve([]);
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const prepared: Array<{
      placement: SpritePlacement;
      elements: readonly (SpriteElementPlacement | null | undefined)[];
      elementCount: number;
      leaderlineFlags: boolean[];
      borderFlags: boolean[];
      size: number;
      outputIndex: number;
    }> = [];
    let totalSize = 0;

    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index];
      if (!placement || typeof placement !== 'object') {
        if (promiseHandlers) {
          promiseHandlers.reject(createCommandError('Placement is required.'));
          return promiseHandlers.promise;
        }
        continue;
      }

      const elements: readonly (SpriteElementPlacement | null | undefined)[] =
        Array.isArray(placement.elements) ? placement.elements : [];
      if (elements.length > wl.WASM_MAX_ELEMENTS_PER_SPRITE) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createCommandError(
              `Sprite element count must be less than or equal to ${wl.WASM_MAX_ELEMENTS_PER_SPRITE}.`,
              placement
            )
          );
          return promiseHandlers.promise;
        }
        continue;
      }

      const elementCount = elements.length;
      const leaderlineFlags = elements.map((element) => !!element?.leaderline);
      const borderFlags = elements.map((element) =>
        hasPlacementBorder(element)
      );
      const size =
        cl.COMMAND_ADD_SPRITE_BASE_FIELDS +
        elementCount * cl.COMMAND_ELEMENT_FIELDS;
      try {
        validateSpritePlacementCommand(placement, elements, elementCount, size);
      } catch (error) {
        if (promiseHandlers) {
          const message =
            error instanceof Error ? error.message : 'Invalid data.';
          promiseHandlers.reject(createCommandError(message, placement));
          return promiseHandlers.promise;
        }
        continue;
      }
      prepared.push({
        placement,
        elements,
        elementCount,
        leaderlineFlags,
        borderFlags,
        size,
        outputIndex: prepared.length,
      });
      totalSize += size;
    }

    if (prepared.length === 0) {
      if (promiseHandlers) {
        promiseHandlers.resolve([]);
        return promiseHandlers.promise;
      }
      return undefined;
    }

    ensureCommandCapacity(
      Math.min(commandUsed + totalSize, MAX_COMMAND_BUFFER_USED_PER_APPLY)
    );

    const batchStart = promiseHandlers
      ? {
          commandUsed,
          commandCount,
          pendingCommandsLength: pendingCommands.length,
          nextResultIndex,
          pendingResultCount,
        }
      : null;

    const results = promiseHandlers ? new Array<number>(prepared.length) : [];
    let remaining = promiseHandlers ? prepared.length : 0;
    let settled = false;

    const rejectBatch = (error: Error) => {
      if (!promiseHandlers || settled) {
        return;
      }
      settled = true;
      promiseHandlers.reject(error);
    };

    const resolveBatch = () => {
      if (!promiseHandlers || settled || remaining !== 0) {
        return;
      }
      settled = true;
      promiseHandlers.resolve(results);
    };

    for (let index = 0; index < prepared.length; index += 1) {
      const entry = prepared[index]!;
      const previousCommandUsed = commandUsed;
      const previousCommandCount = commandCount;
      const previousNextResultIndex = nextResultIndex;
      const previousPendingResultCount = pendingResultCount;
      if (
        !flushBeforeQueue(
          entry.size,
          promiseHandlers !== null,
          promiseHandlers ? 1 : 0
        )
      ) {
        if (promiseHandlers) {
          rejectBatch(
            createCommandError('Sprite command failed.', entry.placement)
          );
          return promiseHandlers.promise;
        }
        return undefined;
      }

      const resultIndex = promiseHandlers ? nextResultIndex++ : -1;
      if (promiseHandlers) {
        pendingResultCount = Math.max(pendingResultCount, resultIndex + 1);
      }

      queueCommand(cl.COMMAND_OP_ADD_SPRITE, entry.size, queue_commandRet);

      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_ADD_SPRITE_RESULT_INDEX_OFFSET
      ] = resultIndex;
      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_ADD_SPRITE_ELEMENT_COUNT_OFFSET
      ] = entry.elementCount;

      try {
        writeValueCommand(
          commandBuffer,
          queue_commandRet.offset + cl.COMMAND_ADD_SPRITE_SX_HAS_OFFSET,
          entry.placement.sx,
          precision,
          false,
          false
        );
        writeValueCommand(
          commandBuffer,
          queue_commandRet.offset + cl.COMMAND_ADD_SPRITE_SY_HAS_OFFSET,
          entry.placement.sy,
          precision,
          false,
          false
        );
        if (entry.placement.sz !== undefined) {
          writeOptionalCommand(
            commandBuffer,
            queue_commandRet.offset + cl.COMMAND_ADD_SPRITE_SZ_HAS_OFFSET,
            entry.placement.sz
          );
        }
        if (entry.placement.opacity) {
          writeValueCommand(
            commandBuffer,
            queue_commandRet.offset + cl.COMMAND_ADD_SPRITE_OPACITY_HAS_OFFSET,
            entry.placement.opacity,
            precision,
            false,
            false
          );
        }
        writeVisibilityDistanceCommand(
          commandBuffer,
          queue_commandRet.offset +
            cl.COMMAND_ADD_SPRITE_VISIBILITY_DISTANCE_HAS_OFFSET,
          entry.placement.visibilityDistance
        );

        for (
          let elementIndex = 0;
          elementIndex < entry.elementCount;
          elementIndex += 1
        ) {
          const base =
            queue_commandRet.offset +
            cl.COMMAND_ADD_SPRITE_ELEMENT_BASE_OFFSET +
            elementIndex * cl.COMMAND_ELEMENT_FIELDS;
          writeElementFields(
            commandBuffer,
            base,
            entry.elements[elementIndex],
            'placement',
            textureManager.resolveTextureIndex,
            precision
          );
        }
      } catch (error) {
        commandUsed = previousCommandUsed;
        commandCount = previousCommandCount;
        commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
        commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = commandCount;
        if (promiseHandlers) {
          nextResultIndex = previousNextResultIndex;
          pendingResultCount = previousPendingResultCount;
          if (batchStart) {
            commandUsed = batchStart.commandUsed;
            commandCount = batchStart.commandCount;
            commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
            commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] =
              commandCount;
            pendingCommands.length = batchStart.pendingCommandsLength;
            nextResultIndex = batchStart.nextResultIndex;
            pendingResultCount = batchStart.pendingResultCount;
          }
          const message =
            error instanceof Error ? error.message : 'Invalid data.';
          rejectBatch(createCommandError(message, entry.placement));
          return promiseHandlers.promise;
        }
        continue;
      }

      const publicSpriteId = promiseHandlers ? spriteIdMap.allocateId() : null;
      if (publicSpriteId !== null) {
        spriteTrackingSnapshots.set(
          publicSpriteId,
          createSpriteTrackingSnapshot(entry.placement)
        );
      }
      const pending: PendingCommand = {
        index: queue_commandRet.commandIndex,
        kind: 'addSprite',
        placement: entry.placement,
        elementCount: entry.elementCount,
        leaderlineFlags: entry.leaderlineFlags,
        borderFlags: entry.borderFlags,
        elementTexIndices: resolvePlacementElementTexIndices(entry.elements),
      };
      if (publicSpriteId !== null) {
        pending.spriteId = publicSpriteId;
      }
      if (promiseHandlers) {
        pending.resultIndex = resultIndex;
        pending.resolve = () => {
          if (settled) {
            return;
          }
          results[entry.outputIndex] = publicSpriteId as number;
          remaining -= 1;
          resolveBatch();
        };
        pending.reject = (error) => {
          rejectBatch(error);
        };
      }
      pendingCommands.push(pending);
    }

    return promiseHandlers?.promise;
  }

  // =================================================

  function updateSprite(spriteId: number, update: SpriteUpdate): void;
  function updateSprite(
    spriteId: number,
    update: SpriteUpdate,
    awaitable: false
  ): void;
  function updateSprite(
    spriteId: number,
    update: SpriteUpdate,
    awaitable: true
  ): Promise<void>;
  function updateSprite(
    spriteId: number,
    update: SpriteUpdate,
    awaitable: boolean = false
  ): void | Promise<void> {
    const promiseHandlers = awaitable ? createPromiseHandlers<void>() : null;

    if (!Number.isInteger(spriteId) || spriteId < 0) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createSpriteIdCommandError('Invalid sprite id.', spriteId)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    if (!update || typeof update !== 'object') {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createSpriteIdCommandError('Update payload is required.', spriteId)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    const spriteIndices = resolveSpriteIndicesForCommand(spriteId);
    if (spriteIndices === null) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createSpriteIdCommandError('Invalid sprite id.', spriteId)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    const { baseIndex: spriteBaseIndex, effectiveIndex: spriteIndex } =
      spriteIndices;

    const elementUpdates: Array<{ index: number; kind: number }> | null =
      awaitable ? [] : null;
    const elementCommands: Array<{
      index: number;
      update: SpriteElementUpdate | null;
    }> = [];
    if (update.elements !== undefined) {
      if (!Array.isArray(update.elements)) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createSpriteIdCommandError(
              'Update elements must be an array.',
              spriteId,
              update
            )
          );
          return promiseHandlers.promise;
        }
        return undefined;
      }
      if (update.elements.length > wl.WASM_MAX_ELEMENTS_PER_SPRITE) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createSpriteIdCommandError(
              `Sprite element count must be less than or equal to ${wl.WASM_MAX_ELEMENTS_PER_SPRITE}.`,
              spriteId,
              update
            )
          );
          return promiseHandlers.promise;
        }
        return undefined;
      }
      for (let index = 0; index < update.elements.length; index += 1) {
        const elementUpdate = update.elements[index];
        if (elementUpdate === undefined) {
          continue;
        }
        if (elementUpdate === null) {
          if (elementUpdates) {
            elementUpdates.push({
              index,
              kind: cl.COMMAND_UPDATE_ELEMENT_KIND_REMOVE,
            });
          }
          elementCommands.push({ index, update: null });
          continue;
        }
        if (elementUpdates) {
          elementUpdates.push({
            index,
            kind: cl.COMMAND_UPDATE_ELEMENT_KIND_UPDATE,
          });
        }
        elementCommands.push({ index, update: elementUpdate });
      }
    }

    const size =
      cl.COMMAND_UPDATE_SPRITE_BASE_FIELDS +
      elementCommands.length * cl.COMMAND_UPDATE_ELEMENT_FIELDS;
    try {
      validateSpriteUpdateCommand(update, elementCommands, size);
    } catch {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createSpriteIdCommandError('Sprite command failed.', spriteId, update)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    if (!flushBeforeQueue(size, promiseHandlers !== null)) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createSpriteIdCommandError('Sprite command failed.', spriteId, update)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    const previousCommandUsed = commandUsed;
    const previousCommandCount = commandCount;
    const updateTimestampMs = getNowMs();
    queueCommand(cl.COMMAND_OP_UPDATE_SPRITE, size, queue_commandRet);

    try {
      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_UPDATE_SPRITE_SPRITE_ID_OFFSET
      ] = spriteIndex;
      commandBuffer[
        queue_commandRet.offset +
          cl.COMMAND_UPDATE_SPRITE_ISSUED_AT_TIMESTAMP_OFFSET
      ] = updateTimestampMs;
      if (isUpdateValueSpecified(update.sx)) {
        try {
          writeValueCommand(
            commandBuffer,
            queue_commandRet.offset + cl.COMMAND_UPDATE_SPRITE_SX_HAS_OFFSET,
            update.sx,
            precision,
            true,
            true
          );
        } catch {
          commandBuffer[
            queue_commandRet.offset + cl.COMMAND_UPDATE_SPRITE_SX_HAS_OFFSET
          ] = 0;
        }
      }
      if (isUpdateValueSpecified(update.sy)) {
        try {
          writeValueCommand(
            commandBuffer,
            queue_commandRet.offset + cl.COMMAND_UPDATE_SPRITE_SY_HAS_OFFSET,
            update.sy,
            precision,
            true,
            true
          );
        } catch {
          commandBuffer[
            queue_commandRet.offset + cl.COMMAND_UPDATE_SPRITE_SY_HAS_OFFSET
          ] = 0;
        }
      }
      if (update.sz !== undefined) {
        writeOptionalCommand(
          commandBuffer,
          queue_commandRet.offset + cl.COMMAND_UPDATE_SPRITE_SZ_HAS_OFFSET,
          update.sz
        );
      }
      if (isUpdateValueSpecified(update.opacity)) {
        try {
          writeValueCommand(
            commandBuffer,
            queue_commandRet.offset +
              cl.COMMAND_UPDATE_SPRITE_OPACITY_HAS_OFFSET,
            update.opacity,
            precision,
            true,
            true
          );
        } catch {
          commandBuffer[
            queue_commandRet.offset +
              cl.COMMAND_UPDATE_SPRITE_OPACITY_HAS_OFFSET
          ] = 0;
        }
      }
      writeVisibilityDistanceCommand(
        commandBuffer,
        queue_commandRet.offset +
          cl.COMMAND_UPDATE_SPRITE_VISIBILITY_DISTANCE_HAS_OFFSET,
        update.visibilityDistance
      );

      commandBuffer[
        queue_commandRet.offset +
          cl.COMMAND_UPDATE_SPRITE_ELEMENT_UPDATE_COUNT_OFFSET
      ] = elementCommands.length;

      for (
        let commandIndex = 0;
        commandIndex < elementCommands.length;
        commandIndex += 1
      ) {
        const elementCommand = elementCommands[commandIndex]!;
        const base =
          queue_commandRet.offset +
          cl.COMMAND_UPDATE_SPRITE_ELEMENT_BASE_OFFSET +
          commandIndex * cl.COMMAND_UPDATE_ELEMENT_FIELDS;
        writeSpriteUpdateElementCommand(
          commandBuffer,
          base,
          elementCommand.index,
          elementCommand.update
        );
      }

      if (promiseHandlers) {
        pendingCommands.push({
          index: queue_commandRet.commandIndex,
          kind: 'updateSprite',
          spriteId,
          spriteIndex,
          elementUpdates: elementUpdates ?? [],
          elementCommands,
          resolve: () => {
            promiseHandlers.resolve(undefined);
          },
          reject: promiseHandlers.reject,
        });
      } else {
        applyElementCommandsToCounts(spriteBaseIndex, elementCommands);
        applyElementCommandsToTextureIndices(spriteBaseIndex, elementCommands);
        applyElementCommandsToLeaderlines(spriteBaseIndex, elementCommands);
        applyElementCommandsToBorders(spriteBaseIndex, elementCommands);
      }
      const trackingSnapshot = spriteTrackingSnapshots.get(spriteId);
      if (trackingSnapshot) {
        spriteTrackingSnapshots.set(
          spriteId,
          applySpriteTrackingSnapshotUpdate(
            trackingSnapshot,
            update,
            updateTimestampMs
          )
        );
      }
      if (pendingUpdateSpriteCommandCount === 0) {
        pendingUpdateSpriteFirstQueuedAtMs = getNowMs();
      }
      pendingUpdateSpriteCommandCount += 1;
    } catch {
      commandUsed = previousCommandUsed;
      commandCount = previousCommandCount;
      commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
      commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = commandCount;
      if (promiseHandlers) {
        promiseHandlers.reject(
          createSpriteIdCommandError('Sprite command failed.', spriteId, update)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }

    return promiseHandlers?.promise;
  }

  // =================================================

  function updateSprites(updates: readonly SpriteBulkUpdate[]): void;
  function updateSprites(
    updates: readonly SpriteBulkUpdate[],
    awaitable: false
  ): void;
  function updateSprites(
    updates: readonly SpriteBulkUpdate[],
    awaitable: true
  ): Promise<void>;
  function updateSprites(
    updates: readonly SpriteBulkUpdate[],
    awaitable: boolean = false
  ): void | Promise<void> {
    const promiseHandlers = awaitable ? createPromiseHandlers<void>() : null;

    if (!Array.isArray(updates)) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCommandError('Update payload is required.')
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }

    if (updates.length === 0) {
      if (promiseHandlers) {
        promiseHandlers.resolve(undefined);
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const prepared: Array<{
      spriteId: number;
      spriteBaseIndex: number;
      spriteIndex: number;
      update: SpriteUpdate;
      elementUpdates: Array<{ index: number; kind: number }> | null;
      elementCommands: Array<{
        index: number;
        update: SpriteElementUpdate | null;
      }>;
      size: number;
    }> = [];
    let totalSize = 0;

    for (let index = 0; index < updates.length; index += 1) {
      const entry = updates[index];
      if (!entry || typeof entry !== 'object') {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createCommandError('Update payload is required.')
          );
          return promiseHandlers.promise;
        }
        continue;
      }
      const spriteId = entry.spriteId;
      const { spriteId: _spriteId, ...updatePayload } = entry;
      const update = updatePayload as SpriteUpdate;
      if (!Number.isInteger(spriteId) || spriteId < 0) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createSpriteIdCommandError('Invalid sprite id.', spriteId)
          );
          return promiseHandlers.promise;
        }
        continue;
      }
      if (!update || typeof update !== 'object') {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createSpriteIdCommandError('Update payload is required.', spriteId)
          );
          return promiseHandlers.promise;
        }
        continue;
      }
      const spriteIndices = resolveSpriteIndicesForCommand(spriteId);
      if (spriteIndices === null) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createSpriteIdCommandError('Invalid sprite id.', spriteId)
          );
          return promiseHandlers.promise;
        }
        continue;
      }
      const { baseIndex: spriteBaseIndex, effectiveIndex: spriteIndex } =
        spriteIndices;

      const elementUpdates: Array<{ index: number; kind: number }> | null =
        promiseHandlers ? [] : null;
      const elementCommands: Array<{
        index: number;
        update: SpriteElementUpdate | null;
      }> = [];
      if (update.elements !== undefined) {
        if (!Array.isArray(update.elements)) {
          if (promiseHandlers) {
            promiseHandlers.reject(
              createSpriteIdCommandError(
                'Update elements must be an array.',
                spriteId,
                update
              )
            );
            return promiseHandlers.promise;
          }
          continue;
        }
        if (update.elements.length > wl.WASM_MAX_ELEMENTS_PER_SPRITE) {
          if (promiseHandlers) {
            promiseHandlers.reject(
              createSpriteIdCommandError(
                `Sprite element count must be less than or equal to ${wl.WASM_MAX_ELEMENTS_PER_SPRITE}.`,
                spriteId,
                update
              )
            );
            return promiseHandlers.promise;
          }
          continue;
        }
        for (
          let elementIndex = 0;
          elementIndex < update.elements.length;
          elementIndex += 1
        ) {
          const elementUpdate = update.elements[elementIndex];
          if (elementUpdate === undefined) {
            continue;
          }
          if (elementUpdate === null) {
            if (elementUpdates) {
              elementUpdates.push({
                index: elementIndex,
                kind: cl.COMMAND_UPDATE_ELEMENT_KIND_REMOVE,
              });
            }
            elementCommands.push({ index: elementIndex, update: null });
            continue;
          }
          if (elementUpdates) {
            elementUpdates.push({
              index: elementIndex,
              kind: cl.COMMAND_UPDATE_ELEMENT_KIND_UPDATE,
            });
          }
          elementCommands.push({ index: elementIndex, update: elementUpdate });
        }
      }

      const size =
        cl.COMMAND_UPDATE_SPRITE_BASE_FIELDS +
        elementCommands.length * cl.COMMAND_UPDATE_ELEMENT_FIELDS;
      try {
        validateSpriteUpdateCommand(update, elementCommands, size);
      } catch {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createSpriteIdCommandError(
              'Sprite command failed.',
              spriteId,
              update
            )
          );
          return promiseHandlers.promise;
        }
        continue;
      }
      prepared.push({
        spriteId,
        spriteBaseIndex,
        spriteIndex,
        update,
        elementUpdates,
        elementCommands,
        size,
      });
      totalSize += size;
    }

    if (prepared.length === 0) {
      if (promiseHandlers) {
        promiseHandlers.resolve(undefined);
        return promiseHandlers.promise;
      }
      return undefined;
    }

    ensureCommandCapacity(
      Math.min(commandUsed + totalSize, MAX_COMMAND_BUFFER_USED_PER_APPLY)
    );
    const issuedAtMs = getNowMs();

    const batchStart = promiseHandlers
      ? {
          commandUsed,
          commandCount,
          pendingCommandsLength: pendingCommands.length,
          pendingUpdateSpriteCommandCount,
          pendingUpdateSpriteFirstQueuedAtMs,
        }
      : null;

    let remaining = promiseHandlers ? prepared.length : 0;
    let settled = false;

    const rejectBatch = (error: Error) => {
      if (!promiseHandlers || settled) {
        return;
      }
      settled = true;
      promiseHandlers.reject(error);
    };

    const resolveBatch = () => {
      if (!promiseHandlers || settled || remaining !== 0) {
        return;
      }
      settled = true;
      promiseHandlers.resolve(undefined);
    };

    for (let index = 0; index < prepared.length; index += 1) {
      const entry = prepared[index]!;
      const previousCommandUsed = commandUsed;
      const previousCommandCount = commandCount;
      if (!flushBeforeQueue(entry.size, promiseHandlers !== null)) {
        if (promiseHandlers) {
          rejectBatch(
            createSpriteIdCommandError(
              'Sprite command failed.',
              entry.spriteId,
              entry.update
            )
          );
          return promiseHandlers.promise;
        }
        return undefined;
      }
      queueCommand(cl.COMMAND_OP_UPDATE_SPRITE, entry.size, queue_commandRet);

      try {
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_UPDATE_SPRITE_SPRITE_ID_OFFSET
        ] = entry.spriteIndex;
        commandBuffer[
          queue_commandRet.offset +
            cl.COMMAND_UPDATE_SPRITE_ISSUED_AT_TIMESTAMP_OFFSET
        ] = issuedAtMs;
        if (isUpdateValueSpecified(entry.update.sx)) {
          try {
            writeValueCommand(
              commandBuffer,
              queue_commandRet.offset + cl.COMMAND_UPDATE_SPRITE_SX_HAS_OFFSET,
              entry.update.sx,
              precision,
              true,
              true
            );
          } catch {
            commandBuffer[
              queue_commandRet.offset + cl.COMMAND_UPDATE_SPRITE_SX_HAS_OFFSET
            ] = 0;
          }
        }
        if (isUpdateValueSpecified(entry.update.sy)) {
          try {
            writeValueCommand(
              commandBuffer,
              queue_commandRet.offset + cl.COMMAND_UPDATE_SPRITE_SY_HAS_OFFSET,
              entry.update.sy,
              precision,
              true,
              true
            );
          } catch {
            commandBuffer[
              queue_commandRet.offset + cl.COMMAND_UPDATE_SPRITE_SY_HAS_OFFSET
            ] = 0;
          }
        }
        if (entry.update.sz !== undefined) {
          writeOptionalCommand(
            commandBuffer,
            queue_commandRet.offset + cl.COMMAND_UPDATE_SPRITE_SZ_HAS_OFFSET,
            entry.update.sz
          );
        }
        if (isUpdateValueSpecified(entry.update.opacity)) {
          try {
            writeValueCommand(
              commandBuffer,
              queue_commandRet.offset +
                cl.COMMAND_UPDATE_SPRITE_OPACITY_HAS_OFFSET,
              entry.update.opacity,
              precision,
              true,
              true
            );
          } catch {
            commandBuffer[
              queue_commandRet.offset +
                cl.COMMAND_UPDATE_SPRITE_OPACITY_HAS_OFFSET
            ] = 0;
          }
        }
        writeVisibilityDistanceCommand(
          commandBuffer,
          queue_commandRet.offset +
            cl.COMMAND_UPDATE_SPRITE_VISIBILITY_DISTANCE_HAS_OFFSET,
          entry.update.visibilityDistance
        );

        commandBuffer[
          queue_commandRet.offset +
            cl.COMMAND_UPDATE_SPRITE_ELEMENT_UPDATE_COUNT_OFFSET
        ] = entry.elementCommands.length;

        for (
          let commandIndex = 0;
          commandIndex < entry.elementCommands.length;
          commandIndex += 1
        ) {
          const elementCommand = entry.elementCommands[commandIndex]!;
          const base =
            queue_commandRet.offset +
            cl.COMMAND_UPDATE_SPRITE_ELEMENT_BASE_OFFSET +
            commandIndex * cl.COMMAND_UPDATE_ELEMENT_FIELDS;
          writeSpriteUpdateElementCommand(
            commandBuffer,
            base,
            elementCommand.index,
            elementCommand.update
          );
        }

        if (promiseHandlers) {
          pendingCommands.push({
            index: queue_commandRet.commandIndex,
            kind: 'updateSprite',
            spriteId: entry.spriteId,
            spriteIndex: entry.spriteIndex,
            elementUpdates: entry.elementUpdates ?? [],
            elementCommands: entry.elementCommands,
            resolve: () => {
              if (settled) {
                return;
              }
              remaining -= 1;
              resolveBatch();
            },
            reject: (error) => {
              rejectBatch(error);
            },
          });
        } else {
          applyElementCommandsToCounts(
            entry.spriteBaseIndex,
            entry.elementCommands
          );
          applyElementCommandsToTextureIndices(
            entry.spriteBaseIndex,
            entry.elementCommands
          );
          applyElementCommandsToLeaderlines(
            entry.spriteBaseIndex,
            entry.elementCommands
          );
          applyElementCommandsToBorders(
            entry.spriteBaseIndex,
            entry.elementCommands
          );
        }
        const trackingSnapshot = spriteTrackingSnapshots.get(entry.spriteId);
        if (trackingSnapshot) {
          spriteTrackingSnapshots.set(
            entry.spriteId,
            applySpriteTrackingSnapshotUpdate(
              trackingSnapshot,
              entry.update,
              issuedAtMs
            )
          );
        }
        if (pendingUpdateSpriteCommandCount === 0) {
          pendingUpdateSpriteFirstQueuedAtMs = issuedAtMs;
        }
        pendingUpdateSpriteCommandCount += 1;
      } catch {
        commandUsed = previousCommandUsed;
        commandCount = previousCommandCount;
        commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
        commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = commandCount;
        if (promiseHandlers) {
          if (batchStart) {
            commandUsed = batchStart.commandUsed;
            commandCount = batchStart.commandCount;
            commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
            commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] =
              commandCount;
            pendingCommands.length = batchStart.pendingCommandsLength;
            pendingUpdateSpriteCommandCount =
              batchStart.pendingUpdateSpriteCommandCount;
            pendingUpdateSpriteFirstQueuedAtMs =
              batchStart.pendingUpdateSpriteFirstQueuedAtMs;
          }
          rejectBatch(
            createSpriteIdCommandError(
              'Sprite command failed.',
              entry.spriteId,
              entry.update
            )
          );
          return promiseHandlers.promise;
        }
        continue;
      }
    }

    return promiseHandlers?.promise;
  }

  // =================================================

  function addPolyline(placement: PolylinePlacement): void;
  function addPolyline(placement: PolylinePlacement, awaitable: false): void;
  function addPolyline(
    placement: PolylinePlacement,
    awaitable: true
  ): Promise<number>;
  function addPolyline(
    placement: PolylinePlacement,
    awaitable: boolean = false
  ): void | Promise<number> {
    const promiseHandlers = awaitable ? createPromiseHandlers<number>() : null;

    if (!placement || typeof placement !== 'object') {
      if (promiseHandlers) {
        promiseHandlers.reject(createCommandError('Placement is required.'));
        return promiseHandlers.promise;
      }
      return undefined;
    }

    let nodes: { x: number; y: number; thickness: number }[];
    let colorPayload: {
      color0: { r: number; g: number; b: number; a: number };
      color1: { r: number; g: number; b: number; a: number };
      repeatLength: number;
    };
    let renderOptions: NormalizedPolylineRenderOptions;
    try {
      nodes = normalizePolylineNodes(placement.nodes);
      colorPayload = normalizePolylineColor(placement.color);
      renderOptions = normalizePolylineRenderOptions(
        placement.joinCorrection,
        placement.capCorrection
      );
      if (placement.opacity) {
        normalizeFiniteNumber(placement.opacity.value, 'Opacity');
      }
    } catch (error) {
      if (promiseHandlers) {
        const message =
          error instanceof Error ? error.message : 'Invalid data.';
        promiseHandlers.reject(createCommandError(message, placement));
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const nodeCount = nodes.length;
    const size =
      cl.COMMAND_ADD_POLYLINE_BASE_FIELDS +
      nodeCount * cl.COMMAND_POLYLINE_NODE_FIELDS;
    try {
      validatePolylinePlacementCommand(
        placement,
        nodes,
        colorPayload,
        renderOptions,
        placement.layer !== undefined
          ? normalizeLayerValue(placement.layer)
          : undefined,
        size
      );
    } catch (error) {
      if (promiseHandlers) {
        const message =
          error instanceof Error ? error.message : 'Invalid data.';
        promiseHandlers.reject(createCommandError(message, placement));
        return promiseHandlers.promise;
      }
      return undefined;
    }
    if (
      !flushBeforeQueue(size, promiseHandlers !== null, promiseHandlers ? 1 : 0)
    ) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCommandError('Polyline command failed.', placement)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const resultIndex = promiseHandlers ? nextResultIndex++ : -1;
    if (promiseHandlers) {
      pendingResultCount = Math.max(pendingResultCount, resultIndex + 1);
    }

    const previousCommandUsed = commandUsed;
    const previousCommandCount = commandCount;
    queueCommand(cl.COMMAND_OP_ADD_POLYLINE, size, queue_commandRet);

    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_RESULT_INDEX_OFFSET
    ] = resultIndex;
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_NODE_COUNT_OFFSET
    ] = nodeCount;

    try {
      if (placement.layer !== undefined) {
        writeOptionalCommand(
          commandBuffer,
          queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_LAYER_HAS_OFFSET,
          normalizeLayerValue(placement.layer)
        );
      }
      if (placement.opacity) {
        writeValueCommand(
          commandBuffer,
          queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_OPACITY_HAS_OFFSET,
          placement.opacity,
          precision,
          false,
          false
        );
      }

      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_COLOR0_R_OFFSET
      ] = colorPayload.color0.r;
      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_COLOR0_G_OFFSET
      ] = colorPayload.color0.g;
      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_COLOR0_B_OFFSET
      ] = colorPayload.color0.b;
      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_COLOR0_A_OFFSET
      ] = colorPayload.color0.a;
      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_COLOR1_R_OFFSET
      ] = colorPayload.color1.r;
      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_COLOR1_G_OFFSET
      ] = colorPayload.color1.g;
      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_COLOR1_B_OFFSET
      ] = colorPayload.color1.b;
      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_COLOR1_A_OFFSET
      ] = colorPayload.color1.a;
      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_REPEAT_LENGTH_OFFSET
      ] = colorPayload.repeatLength;
      writePolylineRenderOptions(
        commandBuffer,
        queue_commandRet.offset +
          cl.COMMAND_ADD_POLYLINE_JOIN_CORRECTION_MODE_OFFSET,
        queue_commandRet.offset +
          cl.COMMAND_ADD_POLYLINE_JOIN_CORRECTION_INTERMEDIATE_POINT_COUNT_OFFSET,
        queue_commandRet.offset +
          cl.COMMAND_ADD_POLYLINE_CAP_CORRECTION_MODE_OFFSET,
        queue_commandRet.offset +
          cl.COMMAND_ADD_POLYLINE_CAP_CORRECTION_POINT_COUNT_OFFSET,
        renderOptions
      );

      for (let index = 0; index < nodeCount; index += 1) {
        const base =
          queue_commandRet.offset +
          cl.COMMAND_ADD_POLYLINE_NODE_BASE_OFFSET +
          index * cl.COMMAND_POLYLINE_NODE_FIELDS;
        const node = nodes[index]!;
        commandBuffer[base + cl.COMMAND_POLYLINE_NODE_X_OFFSET] = node.x;
        commandBuffer[base + cl.COMMAND_POLYLINE_NODE_Y_OFFSET] = node.y;
        commandBuffer[base + cl.COMMAND_POLYLINE_NODE_THICKNESS_OFFSET] =
          node.thickness;
      }
    } catch (error) {
      commandUsed = previousCommandUsed;
      commandCount = previousCommandCount;
      commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
      commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = commandCount;
      if (promiseHandlers) {
        nextResultIndex = Math.max(0, nextResultIndex - 1);
      }
      if (promiseHandlers) {
        const message =
          error instanceof Error ? error.message : 'Invalid data.';
        promiseHandlers.reject(createCommandError(message, placement));
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const publicPolylineId = promiseHandlers
      ? polylineIdMap.allocateId()
      : null;
    const pending: PendingCommand = {
      index: queue_commandRet.commandIndex,
      kind: 'addPolyline',
      placement,
      nodeCount,
      polylineRenderOptions: renderOptions,
    };
    if (publicPolylineId !== null) {
      pending.polylineId = publicPolylineId;
    }
    if (promiseHandlers) {
      pending.resultIndex = resultIndex;
      pending.resolve = () => {
        promiseHandlers.resolve(publicPolylineId as number);
      };
      pending.reject = promiseHandlers.reject;
    }
    pendingCommands.push(pending);

    return promiseHandlers?.promise;
  }

  // =================================================

  function addPolylines(placements: readonly PolylinePlacement[]): void;
  function addPolylines(
    placements: readonly PolylinePlacement[],
    awaitable: false
  ): void;
  function addPolylines(
    placements: readonly PolylinePlacement[],
    awaitable: true
  ): Promise<number[]>;
  function addPolylines(
    placements: readonly PolylinePlacement[],
    awaitable: boolean = false
  ): void | Promise<number[]> {
    const promiseHandlers = awaitable
      ? createPromiseHandlers<number[]>()
      : null;

    if (!Array.isArray(placements)) {
      if (promiseHandlers) {
        promiseHandlers.reject(createCommandError('Placements are required.'));
        return promiseHandlers.promise;
      }
      return undefined;
    }

    if (placements.length === 0) {
      if (promiseHandlers) {
        promiseHandlers.resolve([]);
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const prepared: Array<{
      placement: PolylinePlacement;
      nodes: { x: number; y: number; thickness: number }[];
      nodeCount: number;
      colorPayload: {
        color0: { r: number; g: number; b: number; a: number };
        color1: { r: number; g: number; b: number; a: number };
        repeatLength: number;
      };
      renderOptions: NormalizedPolylineRenderOptions;
      layerValue: number | undefined;
      size: number;
      outputIndex: number;
    }> = [];
    let totalSize = 0;

    for (let index = 0; index < placements.length; index += 1) {
      const placement = placements[index];
      if (!placement || typeof placement !== 'object') {
        if (promiseHandlers) {
          promiseHandlers.reject(createCommandError('Placement is required.'));
          return promiseHandlers.promise;
        }
        continue;
      }

      let nodes: { x: number; y: number; thickness: number }[];
      let colorPayload: {
        color0: { r: number; g: number; b: number; a: number };
        color1: { r: number; g: number; b: number; a: number };
        repeatLength: number;
      };
      let renderOptions: NormalizedPolylineRenderOptions;
      let layerValue: number | undefined;
      try {
        nodes = normalizePolylineNodes(placement.nodes);
        colorPayload = normalizePolylineColor(placement.color);
        renderOptions = normalizePolylineRenderOptions(
          placement.joinCorrection,
          placement.capCorrection
        );
        if (placement.opacity) {
          normalizeFiniteNumber(placement.opacity.value, 'Opacity');
        }
        if (placement.layer !== undefined) {
          layerValue = normalizeLayerValue(placement.layer);
        }
      } catch (error) {
        if (promiseHandlers) {
          const message =
            error instanceof Error ? error.message : 'Invalid data.';
          promiseHandlers.reject(createCommandError(message, placement));
          return promiseHandlers.promise;
        }
        continue;
      }

      const nodeCount = nodes.length;
      const size =
        cl.COMMAND_ADD_POLYLINE_BASE_FIELDS +
        nodeCount * cl.COMMAND_POLYLINE_NODE_FIELDS;
      try {
        validatePolylinePlacementCommand(
          placement,
          nodes,
          colorPayload,
          renderOptions,
          layerValue,
          size
        );
      } catch (error) {
        if (promiseHandlers) {
          const message =
            error instanceof Error ? error.message : 'Invalid data.';
          promiseHandlers.reject(createCommandError(message, placement));
          return promiseHandlers.promise;
        }
        continue;
      }
      prepared.push({
        placement,
        nodes,
        nodeCount,
        colorPayload,
        renderOptions,
        layerValue,
        size,
        outputIndex: prepared.length,
      });
      totalSize += size;
    }

    if (prepared.length === 0) {
      if (promiseHandlers) {
        promiseHandlers.resolve([]);
        return promiseHandlers.promise;
      }
      return undefined;
    }

    ensureCommandCapacity(
      Math.min(commandUsed + totalSize, MAX_COMMAND_BUFFER_USED_PER_APPLY)
    );

    const batchStart = promiseHandlers
      ? {
          commandUsed,
          commandCount,
          pendingCommandsLength: pendingCommands.length,
          nextResultIndex,
          pendingResultCount,
        }
      : null;

    const results = promiseHandlers ? new Array<number>(prepared.length) : [];
    let remaining = promiseHandlers ? prepared.length : 0;
    let settled = false;

    const rejectBatch = (error: Error) => {
      if (!promiseHandlers || settled) {
        return;
      }
      settled = true;
      promiseHandlers.reject(error);
    };

    const resolveBatch = () => {
      if (!promiseHandlers || settled || remaining !== 0) {
        return;
      }
      settled = true;
      promiseHandlers.resolve(results);
    };

    for (let index = 0; index < prepared.length; index += 1) {
      const entry = prepared[index]!;
      const previousCommandUsed = commandUsed;
      const previousCommandCount = commandCount;
      const previousNextResultIndex = nextResultIndex;
      const previousPendingResultCount = pendingResultCount;
      if (
        !flushBeforeQueue(
          entry.size,
          promiseHandlers !== null,
          promiseHandlers ? 1 : 0
        )
      ) {
        if (promiseHandlers) {
          rejectBatch(
            createCommandError('Polyline command failed.', entry.placement)
          );
          return promiseHandlers.promise;
        }
        return undefined;
      }

      const resultIndex = promiseHandlers ? nextResultIndex++ : -1;
      if (promiseHandlers) {
        pendingResultCount = Math.max(pendingResultCount, resultIndex + 1);
      }

      queueCommand(cl.COMMAND_OP_ADD_POLYLINE, entry.size, queue_commandRet);

      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_RESULT_INDEX_OFFSET
      ] = resultIndex;
      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_NODE_COUNT_OFFSET
      ] = entry.nodeCount;

      try {
        if (entry.layerValue !== undefined) {
          writeOptionalCommand(
            commandBuffer,
            queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_LAYER_HAS_OFFSET,
            entry.layerValue
          );
        }
        if (entry.placement.opacity) {
          writeValueCommand(
            commandBuffer,
            queue_commandRet.offset +
              cl.COMMAND_ADD_POLYLINE_OPACITY_HAS_OFFSET,
            entry.placement.opacity,
            precision,
            false,
            false
          );
        }

        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_COLOR0_R_OFFSET
        ] = entry.colorPayload.color0.r;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_COLOR0_G_OFFSET
        ] = entry.colorPayload.color0.g;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_COLOR0_B_OFFSET
        ] = entry.colorPayload.color0.b;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_COLOR0_A_OFFSET
        ] = entry.colorPayload.color0.a;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_COLOR1_R_OFFSET
        ] = entry.colorPayload.color1.r;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_COLOR1_G_OFFSET
        ] = entry.colorPayload.color1.g;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_COLOR1_B_OFFSET
        ] = entry.colorPayload.color1.b;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_COLOR1_A_OFFSET
        ] = entry.colorPayload.color1.a;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_ADD_POLYLINE_REPEAT_LENGTH_OFFSET
        ] = entry.colorPayload.repeatLength;
        writePolylineRenderOptions(
          commandBuffer,
          queue_commandRet.offset +
            cl.COMMAND_ADD_POLYLINE_JOIN_CORRECTION_MODE_OFFSET,
          queue_commandRet.offset +
            cl.COMMAND_ADD_POLYLINE_JOIN_CORRECTION_INTERMEDIATE_POINT_COUNT_OFFSET,
          queue_commandRet.offset +
            cl.COMMAND_ADD_POLYLINE_CAP_CORRECTION_MODE_OFFSET,
          queue_commandRet.offset +
            cl.COMMAND_ADD_POLYLINE_CAP_CORRECTION_POINT_COUNT_OFFSET,
          entry.renderOptions
        );

        for (let nodeIndex = 0; nodeIndex < entry.nodeCount; nodeIndex += 1) {
          const base =
            queue_commandRet.offset +
            cl.COMMAND_ADD_POLYLINE_NODE_BASE_OFFSET +
            nodeIndex * cl.COMMAND_POLYLINE_NODE_FIELDS;
          const node = entry.nodes[nodeIndex]!;
          commandBuffer[base + cl.COMMAND_POLYLINE_NODE_X_OFFSET] = node.x;
          commandBuffer[base + cl.COMMAND_POLYLINE_NODE_Y_OFFSET] = node.y;
          commandBuffer[base + cl.COMMAND_POLYLINE_NODE_THICKNESS_OFFSET] =
            node.thickness;
        }
      } catch (error) {
        commandUsed = previousCommandUsed;
        commandCount = previousCommandCount;
        commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
        commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = commandCount;
        if (promiseHandlers) {
          nextResultIndex = previousNextResultIndex;
          pendingResultCount = previousPendingResultCount;
          if (batchStart) {
            commandUsed = batchStart.commandUsed;
            commandCount = batchStart.commandCount;
            commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
            commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] =
              commandCount;
            pendingCommands.length = batchStart.pendingCommandsLength;
            nextResultIndex = batchStart.nextResultIndex;
            pendingResultCount = batchStart.pendingResultCount;
          }
          const message =
            error instanceof Error ? error.message : 'Invalid data.';
          rejectBatch(createCommandError(message, entry.placement));
          return promiseHandlers.promise;
        }
        continue;
      }

      const publicPolylineId = promiseHandlers
        ? polylineIdMap.allocateId()
        : null;
      const pending: PendingCommand = {
        index: queue_commandRet.commandIndex,
        kind: 'addPolyline',
        placement: entry.placement,
        nodeCount: entry.nodeCount,
        polylineRenderOptions: entry.renderOptions,
      };
      if (publicPolylineId !== null) {
        pending.polylineId = publicPolylineId;
      }
      if (promiseHandlers) {
        pending.resultIndex = resultIndex;
        pending.resolve = () => {
          if (settled) {
            return;
          }
          results[entry.outputIndex] = publicPolylineId as number;
          remaining -= 1;
          resolveBatch();
        };
        pending.reject = (error) => {
          rejectBatch(error);
        };
      }
      pendingCommands.push(pending);
    }

    return promiseHandlers?.promise;
  }

  // =================================================

  function updatePolyline(polylineId: number, update: PolylineUpdate): void;
  function updatePolyline(
    polylineId: number,
    update: PolylineUpdate,
    awaitable: false
  ): void;
  function updatePolyline(
    polylineId: number,
    update: PolylineUpdate,
    awaitable: true
  ): Promise<void>;
  function updatePolyline(
    polylineId: number,
    update: PolylineUpdate,
    awaitable: boolean = false
  ): void | Promise<void> {
    const promiseHandlers = awaitable ? createPromiseHandlers<void>() : null;

    if (!Number.isInteger(polylineId) || polylineId < 0) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createPolylineIdCommandError('Invalid polyline id.', polylineId)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    if (!update || typeof update !== 'object') {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createPolylineIdCommandError(
            'Update payload is required.',
            polylineId
          )
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    const polylineIndices = resolvePolylineIndicesForCommand(polylineId);
    if (polylineIndices === null) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createPolylineIdCommandError('Invalid polyline id.', polylineId)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    const { baseIndex: polylineBaseIndex, effectiveIndex: polylineIndex } =
      polylineIndices;
    const currentRenderOptions = getPolylineRenderOptionsAt(polylineBaseIndex);

    let nodeCount = -1;
    let nodes: { x: number; y: number; thickness: number }[] | null = null;
    if (update.nodes !== undefined) {
      try {
        nodes = normalizePolylineNodes(update.nodes);
        nodeCount = nodes.length;
      } catch (error) {
        if (promiseHandlers) {
          const message =
            error instanceof Error ? error.message : 'Invalid data.';
          promiseHandlers.reject(
            createPolylineIdCommandError(message, polylineId, update)
          );
          return promiseHandlers.promise;
        }
        return undefined;
      }
    }

    let colorPayload: {
      color0: { r: number; g: number; b: number; a: number };
      color1: { r: number; g: number; b: number; a: number };
      repeatLength: number;
    } | null = null;
    let joinCorrection: NormalizedPolylineJoinCorrection | null = null;
    let capCorrection: NormalizedPolylineCapCorrection | null = null;
    try {
      if (update.color !== undefined) {
        colorPayload = normalizePolylineColor(update.color);
      }
      if (update.joinCorrection !== undefined) {
        joinCorrection = normalizePolylineJoinCorrection(update.joinCorrection);
      }
      if (update.capCorrection !== undefined) {
        capCorrection = normalizePolylineCapCorrection(update.capCorrection);
      }
      if (
        isUpdateValueSpecified(update.opacity) &&
        update.opacity.value !== undefined
      ) {
        normalizeFiniteNumber(update.opacity.value, 'Opacity');
      }
    } catch (error) {
      if (promiseHandlers) {
        const message =
          error instanceof Error ? error.message : 'Invalid data.';
        promiseHandlers.reject(
          createPolylineIdCommandError(message, polylineId, update)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const size =
      cl.COMMAND_UPDATE_POLYLINE_BASE_FIELDS +
      Math.max(0, nodeCount) * cl.COMMAND_POLYLINE_NODE_FIELDS;
    try {
      validatePolylineUpdateCommand(
        update,
        nodeCount,
        nodes,
        colorPayload,
        joinCorrection,
        capCorrection,
        size
      );
    } catch {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createPolylineIdCommandError(
            'Polyline command failed.',
            polylineId,
            update
          )
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    if (!flushBeforeQueue(size, promiseHandlers !== null)) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createPolylineIdCommandError(
            'Polyline command failed.',
            polylineId,
            update
          )
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    const previousCommandUsed = commandUsed;
    const previousCommandCount = commandCount;
    queueCommand(cl.COMMAND_OP_UPDATE_POLYLINE, size, queue_commandRet);

    try {
      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_POLYLINE_ID_OFFSET
      ] = polylineIndex;
      commandBuffer[
        queue_commandRet.offset +
          cl.COMMAND_UPDATE_POLYLINE_ISSUED_AT_TIMESTAMP_OFFSET
      ] = getNowMs();
      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_NODE_COUNT_OFFSET
      ] = nodeCount;

      if (update.layer !== undefined) {
        writeOptionalCommand(
          commandBuffer,
          queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_LAYER_HAS_OFFSET,
          normalizeLayerValue(update.layer)
        );
      }
      if (isUpdateValueSpecified(update.opacity)) {
        try {
          writeValueCommand(
            commandBuffer,
            queue_commandRet.offset +
              cl.COMMAND_UPDATE_POLYLINE_OPACITY_HAS_OFFSET,
            update.opacity,
            precision,
            true,
            true
          );
        } catch {
          commandBuffer[
            queue_commandRet.offset +
              cl.COMMAND_UPDATE_POLYLINE_OPACITY_HAS_OFFSET
          ] = 0;
        }
      }

      if (colorPayload) {
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR_HAS_OFFSET
        ] = 1;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR0_R_OFFSET
        ] = colorPayload.color0.r;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR0_G_OFFSET
        ] = colorPayload.color0.g;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR0_B_OFFSET
        ] = colorPayload.color0.b;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR0_A_OFFSET
        ] = colorPayload.color0.a;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR1_R_OFFSET
        ] = colorPayload.color1.r;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR1_G_OFFSET
        ] = colorPayload.color1.g;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR1_B_OFFSET
        ] = colorPayload.color1.b;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR1_A_OFFSET
        ] = colorPayload.color1.a;
        commandBuffer[
          queue_commandRet.offset +
            cl.COMMAND_UPDATE_POLYLINE_REPEAT_LENGTH_OFFSET
        ] = colorPayload.repeatLength;
      }
      if (joinCorrection) {
        commandBuffer[
          queue_commandRet.offset +
            cl.COMMAND_UPDATE_POLYLINE_JOIN_CORRECTION_HAS_OFFSET
        ] = 1;
        writePolylineJoinCorrection(
          commandBuffer,
          queue_commandRet.offset +
            cl.COMMAND_UPDATE_POLYLINE_JOIN_CORRECTION_MODE_OFFSET,
          queue_commandRet.offset +
            cl.COMMAND_UPDATE_POLYLINE_JOIN_CORRECTION_INTERMEDIATE_POINT_COUNT_OFFSET,
          joinCorrection
        );
      }
      if (capCorrection) {
        commandBuffer[
          queue_commandRet.offset +
            cl.COMMAND_UPDATE_POLYLINE_CAP_CORRECTION_HAS_OFFSET
        ] = 1;
        writePolylineCapCorrection(
          commandBuffer,
          queue_commandRet.offset +
            cl.COMMAND_UPDATE_POLYLINE_CAP_CORRECTION_MODE_OFFSET,
          queue_commandRet.offset +
            cl.COMMAND_UPDATE_POLYLINE_CAP_CORRECTION_POINT_COUNT_OFFSET,
          capCorrection
        );
      }

      if (nodes) {
        for (let index = 0; index < nodes.length; index += 1) {
          const base =
            queue_commandRet.offset +
            cl.COMMAND_UPDATE_POLYLINE_NODE_BASE_OFFSET +
            index * cl.COMMAND_POLYLINE_NODE_FIELDS;
          const node = nodes[index]!;
          commandBuffer[base + cl.COMMAND_POLYLINE_NODE_X_OFFSET] = node.x;
          commandBuffer[base + cl.COMMAND_POLYLINE_NODE_Y_OFFSET] = node.y;
          commandBuffer[base + cl.COMMAND_POLYLINE_NODE_THICKNESS_OFFSET] =
            node.thickness;
        }
      }

      if (promiseHandlers) {
        const nextRenderOptions =
          joinCorrection || capCorrection
            ? {
                joinCorrection:
                  joinCorrection ?? currentRenderOptions.joinCorrection,
                capCorrection:
                  capCorrection ?? currentRenderOptions.capCorrection,
              }
            : null;
        const pending: PendingCommand = {
          index: queue_commandRet.commandIndex,
          kind: 'updatePolyline',
          polylineId,
          polylineIndex,
          resolve: () => {
            promiseHandlers.resolve(undefined);
          },
          reject: promiseHandlers.reject,
        };
        if (nodeCount >= 0) {
          pending.nodeCount = nodeCount;
        }
        if (nextRenderOptions) {
          pending.polylineRenderOptions = nextRenderOptions;
        }
        pendingCommands.push(pending);
      } else {
        if (nodeCount >= 0) {
          if (
            polylineBaseIndex >= 0 &&
            polylineBaseIndex < polylineNodeCounts.length
          ) {
            const previousCount = polylineNodeCounts[polylineBaseIndex] ?? 0;
            polylineNodeCounts[polylineBaseIndex] = nodeCount;
            totalPolylineNodeCount = Math.max(
              0,
              totalPolylineNodeCount + (nodeCount - previousCount)
            );
          }
        }
        if (
          (joinCorrection || capCorrection) &&
          polylineBaseIndex >= 0 &&
          polylineBaseIndex < polylineRenderOptions.length
        ) {
          polylineRenderOptions[polylineBaseIndex] = {
            joinCorrection:
              joinCorrection ?? currentRenderOptions.joinCorrection,
            capCorrection: capCorrection ?? currentRenderOptions.capCorrection,
          };
        }
      }
    } catch {
      commandUsed = previousCommandUsed;
      commandCount = previousCommandCount;
      commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
      commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = commandCount;
      if (promiseHandlers) {
        promiseHandlers.reject(
          createPolylineIdCommandError(
            'Polyline command failed.',
            polylineId,
            update
          )
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }

    return promiseHandlers?.promise;
  }

  // =================================================

  function updatePolylines(updates: readonly PolylineBulkUpdate[]): void;
  function updatePolylines(
    updates: readonly PolylineBulkUpdate[],
    awaitable: false
  ): void;
  function updatePolylines(
    updates: readonly PolylineBulkUpdate[],
    awaitable: true
  ): Promise<void>;
  function updatePolylines(
    updates: readonly PolylineBulkUpdate[],
    awaitable: boolean = false
  ): void | Promise<void> {
    const promiseHandlers = awaitable ? createPromiseHandlers<void>() : null;

    if (!Array.isArray(updates)) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCommandError('Update payload is required.')
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }

    if (updates.length === 0) {
      if (promiseHandlers) {
        promiseHandlers.resolve(undefined);
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const prepared: Array<{
      polylineId: number;
      polylineBaseIndex: number;
      polylineIndex: number;
      update: PolylineUpdate;
      nodeCount: number;
      nodes: { x: number; y: number; thickness: number }[] | null;
      colorPayload: {
        color0: { r: number; g: number; b: number; a: number };
        color1: { r: number; g: number; b: number; a: number };
        repeatLength: number;
      } | null;
      joinCorrection: NormalizedPolylineJoinCorrection | null;
      capCorrection: NormalizedPolylineCapCorrection | null;
      nextRenderOptions: NormalizedPolylineRenderOptions | null;
      size: number;
    }> = [];
    let totalSize = 0;

    for (let index = 0; index < updates.length; index += 1) {
      const entry = updates[index];
      if (!entry || typeof entry !== 'object') {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createCommandError('Update payload is required.')
          );
          return promiseHandlers.promise;
        }
        continue;
      }
      const polylineId = entry.polylineId;
      const { polylineId: _polylineId, ...updatePayload } = entry;
      const update = updatePayload as PolylineUpdate;
      if (!Number.isInteger(polylineId) || polylineId < 0) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createPolylineIdCommandError('Invalid polyline id.', polylineId)
          );
          return promiseHandlers.promise;
        }
        continue;
      }
      if (!update || typeof update !== 'object') {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createPolylineIdCommandError(
              'Update payload is required.',
              polylineId
            )
          );
          return promiseHandlers.promise;
        }
        continue;
      }
      const polylineIndices = resolvePolylineIndicesForCommand(polylineId);
      if (polylineIndices === null) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createPolylineIdCommandError('Invalid polyline id.', polylineId)
          );
          return promiseHandlers.promise;
        }
        continue;
      }
      const { baseIndex: polylineBaseIndex, effectiveIndex: polylineIndex } =
        polylineIndices;
      const currentRenderOptions =
        getPolylineRenderOptionsAt(polylineBaseIndex);

      let nodeCount = -1;
      let nodes: { x: number; y: number; thickness: number }[] | null = null;
      if (update.nodes !== undefined) {
        try {
          nodes = normalizePolylineNodes(update.nodes);
          nodeCount = nodes.length;
        } catch (error) {
          if (promiseHandlers) {
            const message =
              error instanceof Error ? error.message : 'Invalid data.';
            promiseHandlers.reject(
              createPolylineIdCommandError(message, polylineId, update)
            );
            return promiseHandlers.promise;
          }
          continue;
        }
      }

      let colorPayload: {
        color0: { r: number; g: number; b: number; a: number };
        color1: { r: number; g: number; b: number; a: number };
        repeatLength: number;
      } | null = null;
      let joinCorrection: NormalizedPolylineJoinCorrection | null = null;
      let capCorrection: NormalizedPolylineCapCorrection | null = null;
      try {
        if (update.color !== undefined) {
          colorPayload = normalizePolylineColor(update.color);
        }
        if (update.joinCorrection !== undefined) {
          joinCorrection = normalizePolylineJoinCorrection(
            update.joinCorrection
          );
        }
        if (update.capCorrection !== undefined) {
          capCorrection = normalizePolylineCapCorrection(update.capCorrection);
        }
        if (
          isUpdateValueSpecified(update.opacity) &&
          update.opacity.value !== undefined
        ) {
          normalizeFiniteNumber(update.opacity.value, 'Opacity');
        }
      } catch (error) {
        if (promiseHandlers) {
          const message =
            error instanceof Error ? error.message : 'Invalid data.';
          promiseHandlers.reject(
            createPolylineIdCommandError(message, polylineId, update)
          );
          return promiseHandlers.promise;
        }
        continue;
      }

      const size =
        cl.COMMAND_UPDATE_POLYLINE_BASE_FIELDS +
        Math.max(0, nodeCount) * cl.COMMAND_POLYLINE_NODE_FIELDS;
      try {
        validatePolylineUpdateCommand(
          update,
          nodeCount,
          nodes,
          colorPayload,
          joinCorrection,
          capCorrection,
          size
        );
      } catch {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createPolylineIdCommandError(
              'Polyline command failed.',
              polylineId,
              update
            )
          );
          return promiseHandlers.promise;
        }
        continue;
      }
      prepared.push({
        polylineId,
        polylineBaseIndex,
        polylineIndex,
        update,
        nodeCount,
        nodes,
        colorPayload,
        joinCorrection,
        capCorrection,
        nextRenderOptions:
          joinCorrection || capCorrection
            ? {
                joinCorrection:
                  joinCorrection ?? currentRenderOptions.joinCorrection,
                capCorrection:
                  capCorrection ?? currentRenderOptions.capCorrection,
              }
            : null,
        size,
      });
      totalSize += size;
    }

    if (prepared.length === 0) {
      if (promiseHandlers) {
        promiseHandlers.resolve(undefined);
        return promiseHandlers.promise;
      }
      return undefined;
    }

    ensureCommandCapacity(
      Math.min(commandUsed + totalSize, MAX_COMMAND_BUFFER_USED_PER_APPLY)
    );
    const issuedAtMs = getNowMs();

    const batchStart = promiseHandlers
      ? {
          commandUsed,
          commandCount,
          pendingCommandsLength: pendingCommands.length,
        }
      : null;

    let remaining = promiseHandlers ? prepared.length : 0;
    let settled = false;

    const rejectBatch = (error: Error) => {
      if (!promiseHandlers || settled) {
        return;
      }
      settled = true;
      promiseHandlers.reject(error);
    };

    const resolveBatch = () => {
      if (!promiseHandlers || settled || remaining !== 0) {
        return;
      }
      settled = true;
      promiseHandlers.resolve(undefined);
    };

    for (let index = 0; index < prepared.length; index += 1) {
      const entry = prepared[index]!;
      const previousCommandUsed = commandUsed;
      const previousCommandCount = commandCount;
      if (!flushBeforeQueue(entry.size, promiseHandlers !== null)) {
        if (promiseHandlers) {
          rejectBatch(
            createPolylineIdCommandError(
              'Polyline command failed.',
              entry.polylineId,
              entry.update
            )
          );
          return promiseHandlers.promise;
        }
        return undefined;
      }
      queueCommand(cl.COMMAND_OP_UPDATE_POLYLINE, entry.size, queue_commandRet);

      try {
        commandBuffer[
          queue_commandRet.offset +
            cl.COMMAND_UPDATE_POLYLINE_POLYLINE_ID_OFFSET
        ] = entry.polylineIndex;
        commandBuffer[
          queue_commandRet.offset +
            cl.COMMAND_UPDATE_POLYLINE_ISSUED_AT_TIMESTAMP_OFFSET
        ] = issuedAtMs;
        commandBuffer[
          queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_NODE_COUNT_OFFSET
        ] = entry.nodeCount;

        if (entry.update.layer !== undefined) {
          writeOptionalCommand(
            commandBuffer,
            queue_commandRet.offset +
              cl.COMMAND_UPDATE_POLYLINE_LAYER_HAS_OFFSET,
            normalizeLayerValue(entry.update.layer)
          );
        }
        if (isUpdateValueSpecified(entry.update.opacity)) {
          try {
            writeValueCommand(
              commandBuffer,
              queue_commandRet.offset +
                cl.COMMAND_UPDATE_POLYLINE_OPACITY_HAS_OFFSET,
              entry.update.opacity,
              precision,
              true,
              true
            );
          } catch {
            commandBuffer[
              queue_commandRet.offset +
                cl.COMMAND_UPDATE_POLYLINE_OPACITY_HAS_OFFSET
            ] = 0;
          }
        }

        if (entry.colorPayload) {
          commandBuffer[
            queue_commandRet.offset +
              cl.COMMAND_UPDATE_POLYLINE_COLOR_HAS_OFFSET
          ] = 1;
          commandBuffer[
            queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR0_R_OFFSET
          ] = entry.colorPayload.color0.r;
          commandBuffer[
            queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR0_G_OFFSET
          ] = entry.colorPayload.color0.g;
          commandBuffer[
            queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR0_B_OFFSET
          ] = entry.colorPayload.color0.b;
          commandBuffer[
            queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR0_A_OFFSET
          ] = entry.colorPayload.color0.a;
          commandBuffer[
            queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR1_R_OFFSET
          ] = entry.colorPayload.color1.r;
          commandBuffer[
            queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR1_G_OFFSET
          ] = entry.colorPayload.color1.g;
          commandBuffer[
            queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR1_B_OFFSET
          ] = entry.colorPayload.color1.b;
          commandBuffer[
            queue_commandRet.offset + cl.COMMAND_UPDATE_POLYLINE_COLOR1_A_OFFSET
          ] = entry.colorPayload.color1.a;
          commandBuffer[
            queue_commandRet.offset +
              cl.COMMAND_UPDATE_POLYLINE_REPEAT_LENGTH_OFFSET
          ] = entry.colorPayload.repeatLength;
        }
        if (entry.joinCorrection) {
          commandBuffer[
            queue_commandRet.offset +
              cl.COMMAND_UPDATE_POLYLINE_JOIN_CORRECTION_HAS_OFFSET
          ] = 1;
          writePolylineJoinCorrection(
            commandBuffer,
            queue_commandRet.offset +
              cl.COMMAND_UPDATE_POLYLINE_JOIN_CORRECTION_MODE_OFFSET,
            queue_commandRet.offset +
              cl.COMMAND_UPDATE_POLYLINE_JOIN_CORRECTION_INTERMEDIATE_POINT_COUNT_OFFSET,
            entry.joinCorrection
          );
        }
        if (entry.capCorrection) {
          commandBuffer[
            queue_commandRet.offset +
              cl.COMMAND_UPDATE_POLYLINE_CAP_CORRECTION_HAS_OFFSET
          ] = 1;
          writePolylineCapCorrection(
            commandBuffer,
            queue_commandRet.offset +
              cl.COMMAND_UPDATE_POLYLINE_CAP_CORRECTION_MODE_OFFSET,
            queue_commandRet.offset +
              cl.COMMAND_UPDATE_POLYLINE_CAP_CORRECTION_POINT_COUNT_OFFSET,
            entry.capCorrection
          );
        }

        if (entry.nodes) {
          for (
            let nodeIndex = 0;
            nodeIndex < entry.nodes.length;
            nodeIndex += 1
          ) {
            const base =
              queue_commandRet.offset +
              cl.COMMAND_UPDATE_POLYLINE_NODE_BASE_OFFSET +
              nodeIndex * cl.COMMAND_POLYLINE_NODE_FIELDS;
            const node = entry.nodes[nodeIndex]!;
            commandBuffer[base + cl.COMMAND_POLYLINE_NODE_X_OFFSET] = node.x;
            commandBuffer[base + cl.COMMAND_POLYLINE_NODE_Y_OFFSET] = node.y;
            commandBuffer[base + cl.COMMAND_POLYLINE_NODE_THICKNESS_OFFSET] =
              node.thickness;
          }
        }

        if (promiseHandlers) {
          const pending: PendingCommand = {
            index: queue_commandRet.commandIndex,
            kind: 'updatePolyline',
            polylineId: entry.polylineId,
            polylineIndex: entry.polylineIndex,
            resolve: () => {
              if (settled) {
                return;
              }
              remaining -= 1;
              resolveBatch();
            },
            reject: (error) => {
              rejectBatch(error);
            },
          };
          if (entry.nodeCount >= 0) {
            pending.nodeCount = entry.nodeCount;
          }
          if (entry.nextRenderOptions) {
            pending.polylineRenderOptions = entry.nextRenderOptions;
          }
          pendingCommands.push(pending);
        } else {
          if (entry.nodeCount >= 0) {
            if (
              entry.polylineBaseIndex >= 0 &&
              entry.polylineBaseIndex < polylineNodeCounts.length
            ) {
              const previousCount =
                polylineNodeCounts[entry.polylineBaseIndex] ?? 0;
              polylineNodeCounts[entry.polylineBaseIndex] = entry.nodeCount;
              totalPolylineNodeCount = Math.max(
                0,
                totalPolylineNodeCount + (entry.nodeCount - previousCount)
              );
            }
          }
          if (
            entry.nextRenderOptions &&
            entry.polylineBaseIndex >= 0 &&
            entry.polylineBaseIndex < polylineRenderOptions.length
          ) {
            polylineRenderOptions[entry.polylineBaseIndex] =
              entry.nextRenderOptions;
          }
        }
      } catch {
        commandUsed = previousCommandUsed;
        commandCount = previousCommandCount;
        commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
        commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = commandCount;
        if (promiseHandlers) {
          if (batchStart) {
            commandUsed = batchStart.commandUsed;
            commandCount = batchStart.commandCount;
            commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
            commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] =
              commandCount;
            pendingCommands.length = batchStart.pendingCommandsLength;
          }
          rejectBatch(
            createPolylineIdCommandError(
              'Polyline command failed.',
              entry.polylineId,
              entry.update
            )
          );
          return promiseHandlers.promise;
        }
        continue;
      }
    }

    return promiseHandlers?.promise;
  }

  // =================================================

  const getSpriteState = (
    spriteId: number,
    timestampMs?: number
  ): SpriteState => {
    if (!Number.isInteger(spriteId) || spriteId < 0) {
      throw createSpriteIdCommandError('Invalid sprite id.', spriteId);
    }
    if (timestampMs !== undefined && !Number.isFinite(timestampMs)) {
      throw createSpriteIdCommandError(
        'Invalid sprite state timestamp.',
        spriteId
      );
    }
    const spriteIndex = resolveSpriteBaseIndex(spriteId);
    if (spriteIndex === null) {
      throw createSpriteIdCommandError('Invalid sprite id.', spriteId);
    }

    const elementCount = spriteElementCounts[spriteIndex]!;
    try {
      return getSpriteStateFromWasm({
        wasmState,
        buffers: wasmBufferAccess,
        spriteIndex,
        elementCount,
        timestampMs,
        resolveImageIdByTexIndex: (texIndex) =>
          textureManager.resolveImageIdByTexIndex(texIndex),
        recordWasmBufferResize,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Failed to read sprite state.'
      ) {
        throw createSpriteIdCommandError(
          'Failed to read sprite state.',
          spriteId
        );
      }
      throw error;
    }
  };

  // =================================================

  const getPolylineState = (
    polylineId: number,
    timestampMs?: number
  ): PolylineState => {
    if (!Number.isInteger(polylineId) || polylineId < 0) {
      throw createPolylineIdCommandError('Invalid polyline id.', polylineId);
    }
    if (timestampMs !== undefined && !Number.isFinite(timestampMs)) {
      throw createPolylineIdCommandError(
        'Invalid polyline state timestamp.',
        polylineId
      );
    }
    const polylineIndex = resolvePolylineBaseIndex(polylineId);
    if (polylineIndex === null) {
      throw createPolylineIdCommandError('Invalid polyline id.', polylineId);
    }

    const nodeCount = polylineNodeCounts[polylineIndex] ?? 0;
    try {
      return getPolylineStateFromWasm({
        wasmState,
        buffers: wasmBufferAccess,
        polylineIndex,
        nodeCount,
        timestampMs,
        recordWasmBufferResize,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === 'Failed to read polyline state.'
      ) {
        throw createPolylineIdCommandError(
          'Failed to read polyline state.',
          polylineId
        );
      }
      throw error;
    }
  };

  // =================================================

  const getCameraState = (): ObjectCameraState =>
    getCameraStateFromWasm(wasmState, wasmBufferAccess);

  // =================================================

  const syncCameraTrackingToWasm = () => {
    if (!supportsWasmCameraTracking) {
      return;
    }
    const setCameraTracking = wasmState.exports.set_camera_tracking;
    const clearCameraTracking = wasmState.exports.clear_camera_tracking;
    if (!setCameraTracking || !clearCameraTracking) {
      return;
    }
    if (!cameraTrackingState) {
      if (!clearCameraTracking(wasmState.contextPtr)) {
        throw new Error('Failed to clear wasm camera tracking.');
      }
      return;
    }

    const spriteSlots: number[] = [];
    for (const spriteId of cameraTrackingState.spriteIds) {
      const spriteSlot = spriteIdMap.getIndexById(spriteId);
      if (spriteSlot === null) {
        cameraTrackingState = null;
        if (!clearCameraTracking(wasmState.contextPtr)) {
          throw new Error('Failed to clear wasm camera tracking.');
        }
        return;
      }
      spriteSlots.push(spriteSlot);
    }

    if (spriteSlots.length > wasmState.trackingSpriteIdsBuffer.count) {
      wasmState.trackingSpriteIdsBuffer.expand(
        wasmState.trackingSpriteIdsBuffer.count,
        spriteSlots.length - wasmState.trackingSpriteIdsBuffer.count,
        0
      );
    }
    const trackingSpriteIdsBuffer =
      wasmState.trackingSpriteIdsBuffer.getBuffer();
    trackingSpriteIdsBuffer.set(spriteSlots, 0);
    const interpolation = resolveCameraTrackingInterpolationPayload(
      cameraTrackingState.interpolation,
      precision
    );
    const ok = setCameraTracking(
      wasmState.contextPtr,
      wasmState.trackingSpriteIdsBuffer.ptr,
      spriteSlots.length,
      cameraTrackingState.targetMode === 'contentApprox'
        ? wl.CAMERA_TRACKING_TARGET_MODE_CONTENT_APPROX
        : wl.CAMERA_TRACKING_TARGET_MODE_BASE,
      cameraTrackingState.distance ?? Number.NaN,
      cameraTrackingState.minDistance ?? Number.NaN,
      cameraTrackingState.fitPadding ?? Number.NaN,
      cameraTrackingState.fitZoomBias ?? Number.NaN,
      interpolation.kind,
      interpolation.mode,
      interpolation.duration,
      interpolation.easing,
      interpolation.param0,
      interpolation.param1,
      interpolation.param2,
      interpolation.param3
    );
    if (!ok) {
      throw new Error('Failed to configure wasm camera tracking.');
    }
  };

  // =================================================

  const resolveContentApproxTrackingSolution = (
    cameraState: ObjectCameraState,
    trackingState: ObjectCameraTrackingState,
    nowMs: number
  ) => {
    const trackingBasis = resolveTrackingCameraBasis(cameraState);
    const bounds = createTrackingBoundsAccumulator();
    const cameraPosition: TrackingVector3 = {
      x: cameraState.position.x.value,
      y: cameraState.position.y.value,
      z: cameraState.position.z.value,
    };

    for (const spriteId of trackingState.spriteIds) {
      const snapshot = spriteTrackingSnapshots.get(spriteId);
      if (!snapshot) {
        return { missingTarget: true as const, solution: undefined };
      }
      const spriteOpacity = resolveSpriteTrackingSnapshotOpacity(
        snapshot,
        nowMs
      );
      if (!(spriteOpacity > 0)) {
        continue;
      }
      const spriteBasePosition = resolveSpriteTrackingSnapshotPosition(
        snapshot,
        nowMs
      );
      const spriteBase: TrackingVector3 = {
        x: spriteBasePosition.x,
        y: spriteBasePosition.y,
        z: spriteBasePosition.z,
      };
      const distanceScale = calculateDistanceScaleFactor(
        Math.hypot(
          cameraPosition.x - spriteBase.x,
          cameraPosition.y - spriteBase.y,
          cameraPosition.z - spriteBase.z
        ),
        resolvedSpriteScaling.resolved
      );
      const geometryCache = new Array<
        TrackingElementGeometry | null | undefined
      >(snapshot.elements.length);
      const resolving = new Set<number>();

      const resolveElementGeometry = (
        elementIndex: number
      ): TrackingElementGeometry | null => {
        if (
          elementIndex < 0 ||
          elementIndex >= snapshot.elements.length ||
          resolving.has(elementIndex)
        ) {
          return null;
        }
        const cached = geometryCache[elementIndex];
        if (cached !== undefined) {
          return cached;
        }
        const element = snapshot.elements[
          elementIndex
        ] as TrackingElementSnapshot | null;
        if (!element) {
          geometryCache[elementIndex] = null;
          return null;
        }
        resolving.add(elementIndex);
        let parentPivot = spriteBase;
        let parentBasisRight = TRACKING_ZERO_BASIS.right;
        let parentBasisUp = TRACKING_ZERO_BASIS.up;
        const originIndex = element.originLocation.index;
        if (originIndex >= 0 && originIndex !== elementIndex) {
          const parentGeometry = resolveElementGeometry(originIndex);
          if (parentGeometry) {
            parentPivot = parentGeometry.pivot;
            parentBasisRight = parentGeometry.basisRight;
            parentBasisUp = parentGeometry.basisUp;
            if (!element.originLocation.useResolvedAnchor) {
              parentPivot = addTrackingScaled3(
                addTrackingScaled3(
                  parentPivot,
                  parentBasisRight,
                  -parentGeometry.anchorOffsetX
                ),
                parentBasisUp,
                -parentGeometry.anchorOffsetY
              );
            }
          }
        }
        const shiftDistance = resolveTrackingSnapshotScalarValue(
          element.shiftDistance,
          nowMs
        );
        const shiftAngleDeg = resolveTrackingSnapshotScalarValue(
          element.shiftAngleDeg,
          nowMs
        );
        let pivot = parentPivot;
        if (
          !element.autoDirectionShiftAngleRotation &&
          Number.isFinite(shiftDistance) &&
          Math.abs(shiftDistance) > 1.0e-6
        ) {
          const angleRad = toRadians(shiftAngleDeg);
          pivot = addTrackingScaled3(
            addTrackingScaled3(
              parentPivot,
              parentBasisRight,
              shiftDistance * Math.sin(angleRad)
            ),
            parentBasisUp,
            shiftDistance * Math.cos(angleRad)
          );
        }
        const scale =
          resolveTrackingSnapshotScalarValue(element.scale, nowMs) *
          distanceScale;
        const imageSize =
          element.imageId !== undefined && element.imageId !== null
            ? textureManager.resolveImageLogicalSizeById(element.imageId)
            : undefined;
        const halfWidth =
          imageSize && Number.isFinite(scale)
            ? Math.max(0, imageSize.widthPixel * scale * 0.5)
            : 0;
        const halfHeight =
          imageSize && Number.isFinite(scale)
            ? Math.max(0, imageSize.heightPixel * scale * 0.5)
            : 0;
        const anchorOffsetX =
          resolveTrackingSnapshotScalarValue(element.anchorX, nowMs) *
          halfWidth;
        const anchorOffsetY =
          resolveTrackingSnapshotScalarValue(element.anchorY, nowMs) *
          halfHeight;
        let basisRight = TRACKING_ZERO_BASIS.right;
        let basisUp = TRACKING_ZERO_BASIS.up;
        if (element.mode === 'billboard') {
          basisRight = trackingBasis.right;
          basisUp = trackingBasis.up;
        } else if (element.mode === 'billboard_perspective') {
          const forwardX = cameraPosition.x - pivot.x;
          const forwardY = cameraPosition.y - pivot.y;
          const forwardZ = cameraPosition.z - pivot.z;
          const basis = resolveBillboardPerspectiveBasis(
            forwardX,
            forwardY,
            forwardZ
          );
          basisRight = basis.right;
          basisUp = basis.up;
        }
        const geometry: TrackingElementGeometry = {
          parentPivot,
          parentBasisRight,
          parentBasisUp,
          pivot,
          basisRight,
          basisUp,
          halfWidth,
          halfHeight,
          anchorOffsetX,
          anchorOffsetY,
          borderWidth: element.borderWidth,
          shiftDistance,
          autoDirectionShiftAngleRotation:
            element.autoDirectionShiftAngleRotation,
          hasLeaderline: element.hasLeaderline,
        };
        geometryCache[elementIndex] = geometry;
        resolving.delete(elementIndex);
        return geometry;
      };

      let spriteIncluded = false;
      for (
        let elementIndex = 0;
        elementIndex < snapshot.elements.length;
        elementIndex += 1
      ) {
        const element = snapshot.elements[
          elementIndex
        ] as TrackingElementSnapshot | null;
        if (!element) {
          continue;
        }
        const geometry = resolveElementGeometry(elementIndex);
        if (!geometry) {
          continue;
        }
        const effectiveOpacity =
          spriteOpacity *
          resolveTrackingSnapshotScalarValue(element.opacity, nowMs);
        if (!(effectiveOpacity > 0)) {
          continue;
        }
        if (geometry.hasLeaderline) {
          includeTrackingPoint(bounds, trackingBasis, geometry.parentPivot);
          spriteIncluded = true;
        }
        if (!(geometry.halfWidth > 0 || geometry.halfHeight > 0)) {
          continue;
        }
        const visibleHalfWidth = geometry.halfWidth + geometry.borderWidth;
        const visibleHalfHeight = geometry.halfHeight + geometry.borderWidth;
        const center = addTrackingScaled3(
          addTrackingScaled3(
            geometry.pivot,
            geometry.basisRight,
            -geometry.anchorOffsetX
          ),
          geometry.basisUp,
          -geometry.anchorOffsetY
        );
        if (
          geometry.autoDirectionShiftAngleRotation &&
          Number.isFinite(geometry.shiftDistance) &&
          Math.abs(geometry.shiftDistance) > 1.0e-6
        ) {
          const centerX = dotTracking3(center, trackingBasis.right);
          const centerY = dotTracking3(center, trackingBasis.up);
          const centerZ = dotTracking3(center, trackingBasis.forward);
          const shapeExtentX =
            Math.abs(dotTracking3(geometry.basisRight, trackingBasis.right)) *
              visibleHalfWidth +
            Math.abs(dotTracking3(geometry.basisUp, trackingBasis.right)) *
              visibleHalfHeight;
          const shapeExtentY =
            Math.abs(dotTracking3(geometry.basisRight, trackingBasis.up)) *
              visibleHalfWidth +
            Math.abs(dotTracking3(geometry.basisUp, trackingBasis.up)) *
              visibleHalfHeight;
          const shapeExtentZ =
            Math.abs(dotTracking3(geometry.basisRight, trackingBasis.forward)) *
              visibleHalfWidth +
            Math.abs(dotTracking3(geometry.basisUp, trackingBasis.forward)) *
              visibleHalfHeight;
          const orbitDistance = Math.abs(geometry.shiftDistance);
          const orbitExtentX =
            orbitDistance *
            Math.hypot(
              dotTracking3(geometry.parentBasisRight, trackingBasis.right),
              dotTracking3(geometry.parentBasisUp, trackingBasis.right)
            );
          const orbitExtentY =
            orbitDistance *
            Math.hypot(
              dotTracking3(geometry.parentBasisRight, trackingBasis.up),
              dotTracking3(geometry.parentBasisUp, trackingBasis.up)
            );
          const orbitExtentZ =
            orbitDistance *
            Math.hypot(
              dotTracking3(geometry.parentBasisRight, trackingBasis.forward),
              dotTracking3(geometry.parentBasisUp, trackingBasis.forward)
            );
          bounds.minX = Math.min(
            bounds.minX,
            centerX - (shapeExtentX + orbitExtentX)
          );
          bounds.minY = Math.min(
            bounds.minY,
            centerY - (shapeExtentY + orbitExtentY)
          );
          bounds.minZ = Math.min(
            bounds.minZ,
            centerZ - (shapeExtentZ + orbitExtentZ)
          );
          bounds.maxX = Math.max(
            bounds.maxX,
            centerX + shapeExtentX + orbitExtentX
          );
          bounds.maxY = Math.max(
            bounds.maxY,
            centerY + shapeExtentY + orbitExtentY
          );
          bounds.maxZ = Math.max(
            bounds.maxZ,
            centerZ + shapeExtentZ + orbitExtentZ
          );
          bounds.count += 1;
          spriteIncluded = true;
          continue;
        }
        includeTrackingOrientedRect(
          bounds,
          trackingBasis,
          center,
          geometry.basisRight,
          geometry.basisUp,
          visibleHalfWidth,
          visibleHalfHeight
        );
        spriteIncluded = true;
      }
      if (!spriteIncluded) {
        continue;
      }
    }

    if (bounds.count <= 0) {
      return { missingTarget: false as const, solution: undefined };
    }
    const center = resolveTrackingBoundsCenter(bounds, trackingBasis);
    const fitPadding =
      Number.isFinite(trackingState.fitPadding ?? undefined) &&
      (trackingState.fitPadding ?? 0) > 0
        ? (trackingState.fitPadding ?? 1)
        : 1;
    const fitBaseDistance = resolveTrackingBoundsBaseDistance(
      cameraState,
      bounds,
      fitPadding
    );
    const currentDistance = Math.hypot(
      center.x - cameraPosition.x,
      center.y - cameraPosition.y,
      center.z - cameraPosition.z
    );
    const baseDistance =
      trackingState.mode === 'single'
        ? Math.max(
            fitBaseDistance,
            Number.isFinite(trackingState.resolvedDistance)
              ? (trackingState.resolvedDistance as number)
              : currentDistance
          )
        : fitBaseDistance;
    return {
      missingTarget: false as const,
      solution: {
        center,
        baseDistance,
        distance: resolveCameraTrackingDistance(baseDistance, trackingState),
      },
    };
  };

  const setCameraTracking = (tracking: ObjectCameraTrackingOptions) => {
    if (!tracking || typeof tracking !== 'object') {
      throw new Error('Camera tracking payload is required.');
    }
    if (!Array.isArray(tracking.spriteIds) || tracking.spriteIds.length === 0) {
      throw new Error('Camera tracking requires at least one sprite id.');
    }
    const spriteIds = Array.from(
      new Set(
        tracking.spriteIds.map((spriteId) => {
          if (!Number.isInteger(spriteId) || spriteId < 0) {
            throw new Error('Camera tracking sprite ids must be integers.');
          }
          return spriteId;
        })
      )
    );
    cameraTrackingState = normalizeCameraTrackingOptions({
      ...tracking,
      spriteIds,
    });
    syncCameraTrackingToWasm();
  };

  const clearCameraTracking = () => {
    cameraTrackingState = null;
    syncCameraTrackingToWasm();
  };

  const getCameraTrackingState = (): ObjectCameraTrackingState | null =>
    cameraTrackingState
      ? {
          ...cameraTrackingState,
          spriteIds: [...cameraTrackingState.spriteIds],
        }
      : null;

  // =================================================

  const onCameraStateChange = (
    listener: (event: ObjectRendererCameraStateChangeEvent) => void
  ) => {
    if (typeof listener !== 'function') {
      return () => {};
    }
    cameraStateChangeListeners.add(listener);
    return () => {
      cameraStateChangeListeners.delete(listener);
    };
  };

  // =================================================

  const writeCameraStateToBuffer = (
    buffer: InputArrayBuffer,
    cameraState: ObjectCameraState
  ) => {
    buffer[wl.CAMERA_POSITION_X_OFFSET] = cameraState.position.x.value;
    buffer[wl.CAMERA_POSITION_Y_OFFSET] = cameraState.position.y.value;
    buffer[wl.CAMERA_POSITION_Z_OFFSET] = cameraState.position.z.value;
    buffer[wl.CAMERA_ROTATION_YAW_OFFSET] = cameraState.rotation.yaw.value;
    buffer[wl.CAMERA_ROTATION_PITCH_OFFSET] = cameraState.rotation.pitch.value;
    buffer[wl.CAMERA_ROTATION_ROLL_OFFSET] = cameraState.rotation.roll.value;
    buffer[wl.CAMERA_FOV_Y_OFFSET] = cameraState.fovY.value;
    buffer[wl.CAMERA_NEAR_OFFSET] = cameraState.near;
    buffer[wl.CAMERA_FAR_OFFSET] = cameraState.far;
    buffer[wl.CAMERA_VIEWPORT_ASPECT_OFFSET] = cameraState.aspectRatio;
  };

  // =================================================

  const viewportToWorldOnPlane: ObjectRenderer['viewportToWorldOnPlane'] = (
    viewportXPixel: number,
    viewportYPixel: number,
    viewPortSize: SizeInPixel,
    planeZ: number,
    cameraState?: ObjectCameraState
  ) => {
    if (
      !Number.isFinite(viewportXPixel) ||
      !Number.isFinite(viewportYPixel) ||
      !Number.isFinite(planeZ) ||
      !Number.isFinite(viewPortSize.widthPixel) ||
      !Number.isFinite(viewPortSize.heightPixel) ||
      viewPortSize.widthPixel <= 0 ||
      viewPortSize.heightPixel <= 0
    ) {
      const error = new Error('Invalid viewport-to-world parameters.');
      (
        error as {
          viewportXPixel?: number;
          viewportYPixel?: number;
          viewPortSize?: SizeInPixel;
          planeZ?: number;
        }
      ).viewportXPixel = viewportXPixel;
      (
        error as {
          viewportXPixel?: number;
          viewportYPixel?: number;
          viewPortSize?: SizeInPixel;
          planeZ?: number;
        }
      ).viewportYPixel = viewportYPixel;
      (
        error as {
          viewportXPixel?: number;
          viewportYPixel?: number;
          viewPortSize?: SizeInPixel;
          planeZ?: number;
        }
      ).viewPortSize = viewPortSize;
      (
        error as {
          viewportXPixel?: number;
          viewportYPixel?: number;
          viewPortSize?: SizeInPixel;
          planeZ?: number;
        }
      ).planeZ = planeZ;
      throw error;
    }
    let ok = 0;
    if (cameraState) {
      const buffer = wasmState.screenToWorldCameraBuffer.getBuffer();
      writeCameraStateToBuffer(buffer, cameraState);
      ok = wasmState.exports.screen_to_world_on_plane_with_camera(
        wasmState.contextPtr,
        wasmState.screenToWorldCameraBuffer.ptr,
        wasmState.screenToWorldCameraBuffer.count,
        viewportXPixel,
        viewportYPixel,
        viewPortSize.widthPixel,
        viewPortSize.heightPixel,
        planeZ,
        wasmState.screenToWorldBuffer.ptr,
        wasmState.screenToWorldBuffer.count
      );
    } else {
      ok = wasmState.exports.screen_to_world_on_plane(
        wasmState.contextPtr,
        viewportXPixel,
        viewportYPixel,
        viewPortSize.widthPixel,
        viewPortSize.heightPixel,
        planeZ,
        wasmState.screenToWorldBuffer.ptr,
        wasmState.screenToWorldBuffer.count
      );
    }
    if (!ok) {
      return undefined;
    }
    const buffer = wasmState.screenToWorldBuffer.getBuffer();
    return {
      x: buffer[0] ?? 0,
      y: buffer[1] ?? 0,
      z: 0, // On plane
    };
  };

  // =================================================

  const projectWorldToViewport: ObjectRenderer['projectWorldToViewport'] = (
    world,
    cameraState
  ) => {
    const viewPortSize = latestViewPortSize;
    if (
      !world ||
      !Number.isFinite(world.x) ||
      !Number.isFinite(world.y) ||
      !Number.isFinite(world.z) ||
      !Number.isFinite(viewPortSize.widthPixel) ||
      !Number.isFinite(viewPortSize.heightPixel) ||
      viewPortSize.widthPixel <= 0 ||
      viewPortSize.heightPixel <= 0
    ) {
      const error = new Error('Invalid world projection parameters.');
      (error as { world?: ObjectWorldPosition }).world = world;
      (error as { viewPortSize?: SizeInPixel }).viewPortSize = viewPortSize;
      throw error;
    }
    let ok = 0;
    if (cameraState) {
      const buffer = wasmState.screenToWorldCameraBuffer.getBuffer();
      writeCameraStateToBuffer(buffer, cameraState);
      ok = wasmState.exports.project_world_to_viewport_with_camera(
        wasmState.contextPtr,
        wasmState.screenToWorldCameraBuffer.ptr,
        wasmState.screenToWorldCameraBuffer.count,
        world.x,
        world.y,
        world.z,
        viewPortSize.widthPixel,
        viewPortSize.heightPixel,
        wasmState.projectWorldBuffer.ptr,
        wasmState.projectWorldBuffer.count
      );
    } else {
      ok = wasmState.exports.project_world_to_viewport(
        wasmState.contextPtr,
        world.x,
        world.y,
        world.z,
        viewPortSize.widthPixel,
        viewPortSize.heightPixel,
        wasmState.projectWorldBuffer.ptr,
        wasmState.projectWorldBuffer.count
      );
    }
    if (!ok) {
      return undefined;
    }
    const buffer = wasmState.projectWorldBuffer.getBuffer();
    return {
      xPixel: buffer[0] ?? 0,
      yPixel: buffer[1] ?? 0,
    };
  };

  // =================================================

  const pickAt: ObjectRenderer['pickAt'] = (
    viewportXPixel,
    viewportYPixel,
    timestampMs
  ) => {
    const viewPortSize = latestViewPortSize;
    if (
      !Number.isFinite(viewportXPixel) ||
      !Number.isFinite(viewportYPixel) ||
      !Number.isFinite(viewPortSize.widthPixel) ||
      !Number.isFinite(viewPortSize.heightPixel) ||
      viewPortSize.widthPixel <= 0 ||
      viewPortSize.heightPixel <= 0
    ) {
      const error = new Error('Invalid pick parameters.');
      (
        error as {
          viewportXPixel?: number;
          viewportYPixel?: number;
          viewPortSize?: SizeInPixel;
        }
      ).viewportXPixel = viewportXPixel;
      (
        error as {
          viewportXPixel?: number;
          viewportYPixel?: number;
          viewPortSize?: SizeInPixel;
        }
      ).viewportYPixel = viewportYPixel;
      (
        error as {
          viewportXPixel?: number;
          viewportYPixel?: number;
          viewPortSize?: SizeInPixel;
        }
      ).viewPortSize = viewPortSize;
      throw error;
    }
    const nowMs =
      Number.isFinite(timestampMs ?? Number.NaN) && timestampMs !== undefined
        ? (timestampMs as number)
        : getNowMs();
    const useCached =
      lastComputeOutputValid &&
      lastComputeCommandRevision === commandRevision &&
      lastComputeTimestampMs !== null;
    const pickTimestampMs =
      useCached && lastComputeTimestampMs !== null
        ? lastComputeTimestampMs
        : nowMs;
    const pickStartMs = getNowMs();
    const ok = useCached
      ? wasmState.exports.pick_at_cached(
          wasmState.contextPtr,
          viewportXPixel,
          viewportYPixel,
          viewPortSize.widthPixel,
          viewPortSize.heightPixel,
          pickTimestampMs,
          wasmState.viewMatrixBuffer.ptr,
          wasmState.viewProjectionBuffer.ptr,
          wasmState.outputBuffer.ptr,
          wasmState.texIndexBuffer.ptr,
          wasmState.polylineOutputBuffer.ptr,
          wasmState.drawCommandBuffer.ptr,
          wasmState.pickResultBuffer.ptr,
          wasmState.pickResultBuffer.count
        )
      : wasmState.exports.pick_at(
          wasmState.contextPtr,
          viewportXPixel,
          viewportYPixel,
          viewPortSize.widthPixel,
          viewPortSize.heightPixel,
          pickTimestampMs,
          wasmState.viewMatrixBuffer.ptr,
          wasmState.viewProjectionBuffer.ptr,
          wasmState.outputBuffer.ptr,
          wasmState.texIndexBuffer.ptr,
          wasmState.polylineOutputBuffer.ptr,
          wasmState.drawCommandBuffer.ptr,
          wasmState.pickResultBuffer.ptr,
          wasmState.pickResultBuffer.count
        );
    const durationMs = Math.max(0, getNowMs() - pickStartMs);
    if (!ok) {
      logger.warn('PickAt failed.', {
        viewportXPixel,
        viewportYPixel,
        viewPortSize,
        cached: useCached,
      });
      return undefined;
    }

    const pickBuffer = wasmState.pickResultBuffer.getBuffer();
    if (pickBuffer.length < PICK_RESULT_FIELDS) {
      logger.warn('PickAt result buffer is too small.', {
        resultBufferLength: pickBuffer.length,
        requiredLength: PICK_RESULT_FIELDS,
      });
      return undefined;
    }
    const kindRaw = pickBuffer[PICK_RESULT_KIND_OFFSET] ?? 0;
    const kind = Math.trunc(kindRaw);
    const primaryRaw = pickBuffer[PICK_RESULT_PRIMARY_ID_OFFSET] ?? -1;
    const secondaryRaw = pickBuffer[PICK_RESULT_SECONDARY_ID_OFFSET] ?? -1;
    const primaryId = Math.trunc(primaryRaw);
    const secondaryId = Math.trunc(secondaryRaw);

    const world = viewportToWorldOnPlane(
      viewportXPixel,
      viewportYPixel,
      viewPortSize,
      0
    );

    if (kind === 1) {
      const spriteId = spriteIdMap.getIdByIndex(primaryId);
      if (spriteId === null || primaryId < 0 || secondaryId < 0) {
        logger.debug('PickAt hit invalid sprite.', {
          durationMs,
          internalSpriteIndex: primaryId,
          elementIndex: secondaryId,
          cached: useCached,
        });
        return undefined;
      }
      const result: ObjectPickResult = {
        kind: 'sprite',
        spriteId,
        elementIndex: secondaryId,
        screen: { xPixel: viewportXPixel, yPixel: viewportYPixel },
        timestampMs: pickTimestampMs,
        ...(world ? { world: { x: world.x, y: world.y, z: 0 } } : {}),
      };
      logger.debug('PickAt completed.', {
        durationMs,
        kind: 'sprite',
        spriteId,
        elementIndex: secondaryId,
        cached: useCached,
      });
      return result;
    }

    if (kind === 2) {
      const polylineId = polylineIdMap.getIdByIndex(primaryId);
      if (polylineId === null || primaryId < 0 || secondaryId < 0) {
        logger.debug('PickAt hit invalid polyline.', {
          durationMs,
          internalPolylineIndex: primaryId,
          segmentIndex: secondaryId,
          cached: useCached,
        });
        return undefined;
      }
      const result: ObjectPickResult = {
        kind: 'polyline',
        polylineId,
        segmentIndex: secondaryId,
        screen: { xPixel: viewportXPixel, yPixel: viewportYPixel },
        timestampMs: pickTimestampMs,
        ...(world ? { world: { x: world.x, y: world.y, z: 0 } } : {}),
      };
      logger.debug('PickAt completed.', {
        durationMs,
        kind: 'polyline',
        polylineId,
        segmentIndex: secondaryId,
        cached: useCached,
      });
      return result;
    }

    logger.debug('PickAt completed.', {
      durationMs,
      kind: 'none',
      cached: useCached,
    });
    return undefined;
  };

  // =================================================

  function removeSprite(spriteId: number): void;
  function removeSprite(spriteId: number, awaitable: false): void;
  function removeSprite(spriteId: number, awaitable: true): Promise<void>;
  function removeSprite(
    spriteId: number,
    awaitable: boolean = false
  ): void | Promise<void> {
    const promiseHandlers = awaitable ? createPromiseHandlers<void>() : null;

    if (!Number.isInteger(spriteId) || spriteId < 0) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createSpriteIdCommandError('Invalid sprite id.', spriteId)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    const spriteIndices = resolveSpriteIndicesForCommand(spriteId);
    if (spriteIndices === null) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createSpriteIdCommandError('Invalid sprite id.', spriteId)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    const { baseIndex: spriteBaseIndex, effectiveIndex: spriteIndex } =
      spriteIndices;
    const size = cl.COMMAND_REMOVE_SPRITE_FIELDS;
    if (!flushBeforeQueue(size, promiseHandlers !== null)) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createSpriteIdCommandError('Sprite command failed.', spriteId)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    queueCommand(cl.COMMAND_OP_REMOVE_SPRITE, size, queue_commandRet);
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_REMOVE_SPRITE_SPRITE_ID_OFFSET
    ] = spriteIndex;
    const pending: PendingCommand = {
      index: queue_commandRet.commandIndex,
      kind: 'removeSprite',
      spriteId,
      spriteIndex,
    };
    if (promiseHandlers) {
      pending.resolve = () => {
        promiseHandlers.resolve(undefined);
      };
      pending.reject = promiseHandlers.reject;
    }
    pendingCommands.push(pending);
    pendingSpriteRemovalIds.add(spriteId);
    insertPendingRemovalIndex(pendingSpriteRemovalIndices, spriteBaseIndex);
    spriteTrackingSnapshots.delete(spriteId);

    return promiseHandlers?.promise;
  }

  // =================================================

  function removeSprites(spriteIds: readonly number[]): void;
  function removeSprites(spriteIds: readonly number[], awaitable: false): void;
  function removeSprites(
    spriteIds: readonly number[],
    awaitable: true
  ): Promise<void>;
  function removeSprites(
    spriteIds: readonly number[],
    awaitable: boolean = false
  ): void | Promise<void> {
    const promiseHandlers = awaitable ? createPromiseHandlers<void>() : null;

    if (!Array.isArray(spriteIds)) {
      if (promiseHandlers) {
        promiseHandlers.reject(createCommandError('Sprite ids are required.'));
        return promiseHandlers.promise;
      }
      return undefined;
    }

    if (spriteIds.length === 0) {
      if (promiseHandlers) {
        promiseHandlers.resolve(undefined);
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const prepared: Array<{
      spriteId: number;
      spriteBaseIndex: number;
      spriteIndex: number;
    }> = [];
    const localPendingRemovalIndices = [...pendingSpriteRemovalIndices];
    const localPendingRemovalIds = new Set(pendingSpriteRemovalIds);

    for (let index = 0; index < spriteIds.length; index += 1) {
      const spriteId = spriteIds[index] as number;
      if (!Number.isInteger(spriteId) || spriteId < 0) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createSpriteIdCommandError('Invalid sprite id.', spriteId)
          );
          return promiseHandlers.promise;
        }
        continue;
      }
      const spriteIndices = resolveSpriteIndicesForCommand(
        spriteId,
        localPendingRemovalIndices,
        localPendingRemovalIds
      );
      if (spriteIndices === null) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createSpriteIdCommandError('Invalid sprite id.', spriteId)
          );
          return promiseHandlers.promise;
        }
        continue;
      }
      prepared.push({
        spriteId,
        spriteBaseIndex: spriteIndices.baseIndex,
        spriteIndex: spriteIndices.effectiveIndex,
      });
      insertPendingRemovalIndex(
        localPendingRemovalIndices,
        spriteIndices.baseIndex
      );
      localPendingRemovalIds.add(spriteId);
    }

    if (prepared.length === 0) {
      if (promiseHandlers) {
        promiseHandlers.resolve(undefined);
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const totalSize = prepared.length * cl.COMMAND_REMOVE_SPRITE_FIELDS;
    ensureCommandCapacity(
      Math.min(commandUsed + totalSize, MAX_COMMAND_BUFFER_USED_PER_APPLY)
    );

    let remaining = promiseHandlers ? prepared.length : 0;
    let settled = false;

    const rejectBatch = (error: Error) => {
      if (!promiseHandlers || settled) {
        return;
      }
      settled = true;
      promiseHandlers.reject(error);
    };

    const resolveBatch = () => {
      if (!promiseHandlers || settled || remaining !== 0) {
        return;
      }
      settled = true;
      promiseHandlers.resolve(undefined);
    };

    for (let index = 0; index < prepared.length; index += 1) {
      const entry = prepared[index]!;
      const size = cl.COMMAND_REMOVE_SPRITE_FIELDS;
      if (!flushBeforeQueue(size, promiseHandlers !== null)) {
        if (promiseHandlers) {
          rejectBatch(
            createSpriteIdCommandError('Sprite command failed.', entry.spriteId)
          );
          return promiseHandlers.promise;
        }
        return undefined;
      }
      queueCommand(cl.COMMAND_OP_REMOVE_SPRITE, size, queue_commandRet);
      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_REMOVE_SPRITE_SPRITE_ID_OFFSET
      ] = entry.spriteIndex;
      const pending: PendingCommand = {
        index: queue_commandRet.commandIndex,
        kind: 'removeSprite',
        spriteId: entry.spriteId,
        spriteIndex: entry.spriteIndex,
      };
      if (promiseHandlers) {
        pending.resolve = () => {
          if (settled) {
            return;
          }
          remaining -= 1;
          resolveBatch();
        };
        pending.reject = (error) => {
          rejectBatch(error);
        };
      }
      pendingCommands.push(pending);
      pendingSpriteRemovalIds.add(entry.spriteId);
      insertPendingRemovalIndex(
        pendingSpriteRemovalIndices,
        entry.spriteBaseIndex
      );
      spriteTrackingSnapshots.delete(entry.spriteId);
    }

    return promiseHandlers?.promise;
  }

  // =================================================

  function removePolyline(polylineId: number): void;
  function removePolyline(polylineId: number, awaitable: false): void;
  function removePolyline(polylineId: number, awaitable: true): Promise<void>;
  function removePolyline(
    polylineId: number,
    awaitable: boolean = false
  ): void | Promise<void> {
    const promiseHandlers = awaitable ? createPromiseHandlers<void>() : null;

    if (!Number.isInteger(polylineId) || polylineId < 0) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createPolylineIdCommandError('Invalid polyline id.', polylineId)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    const polylineIndices = resolvePolylineIndicesForCommand(polylineId);
    if (polylineIndices === null) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createPolylineIdCommandError('Invalid polyline id.', polylineId)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    const { baseIndex: polylineBaseIndex, effectiveIndex: polylineIndex } =
      polylineIndices;
    const size = cl.COMMAND_REMOVE_POLYLINE_FIELDS;
    if (!flushBeforeQueue(size, promiseHandlers !== null)) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createPolylineIdCommandError('Polyline command failed.', polylineId)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    queueCommand(cl.COMMAND_OP_REMOVE_POLYLINE, size, queue_commandRet);
    commandBuffer[
      queue_commandRet.offset + cl.COMMAND_REMOVE_POLYLINE_POLYLINE_ID_OFFSET
    ] = polylineIndex;
    const pending: PendingCommand = {
      index: queue_commandRet.commandIndex,
      kind: 'removePolyline',
      polylineId,
      polylineIndex,
    };
    if (promiseHandlers) {
      pending.resolve = () => {
        promiseHandlers.resolve(undefined);
      };
      pending.reject = promiseHandlers.reject;
    }
    pendingCommands.push(pending);
    pendingPolylineRemovalIds.add(polylineId);
    insertPendingRemovalIndex(pendingPolylineRemovalIndices, polylineBaseIndex);

    return promiseHandlers?.promise;
  }

  // =================================================

  function removePolylines(polylineIds: readonly number[]): void;
  function removePolylines(
    polylineIds: readonly number[],
    awaitable: false
  ): void;
  function removePolylines(
    polylineIds: readonly number[],
    awaitable: true
  ): Promise<void>;
  function removePolylines(
    polylineIds: readonly number[],
    awaitable: boolean = false
  ): void | Promise<void> {
    const promiseHandlers = awaitable ? createPromiseHandlers<void>() : null;

    if (!Array.isArray(polylineIds)) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCommandError('Polyline ids are required.')
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }

    if (polylineIds.length === 0) {
      if (promiseHandlers) {
        promiseHandlers.resolve(undefined);
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const prepared: Array<{
      polylineId: number;
      polylineBaseIndex: number;
      polylineIndex: number;
    }> = [];
    const localPendingRemovalIndices = [...pendingPolylineRemovalIndices];
    const localPendingRemovalIds = new Set(pendingPolylineRemovalIds);

    for (let index = 0; index < polylineIds.length; index += 1) {
      const polylineId = polylineIds[index] as number;
      if (!Number.isInteger(polylineId) || polylineId < 0) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createPolylineIdCommandError('Invalid polyline id.', polylineId)
          );
          return promiseHandlers.promise;
        }
        continue;
      }
      const polylineIndices = resolvePolylineIndicesForCommand(
        polylineId,
        localPendingRemovalIndices,
        localPendingRemovalIds
      );
      if (polylineIndices === null) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createPolylineIdCommandError('Invalid polyline id.', polylineId)
          );
          return promiseHandlers.promise;
        }
        continue;
      }
      prepared.push({
        polylineId,
        polylineBaseIndex: polylineIndices.baseIndex,
        polylineIndex: polylineIndices.effectiveIndex,
      });
      insertPendingRemovalIndex(
        localPendingRemovalIndices,
        polylineIndices.baseIndex
      );
      localPendingRemovalIds.add(polylineId);
    }

    if (prepared.length === 0) {
      if (promiseHandlers) {
        promiseHandlers.resolve(undefined);
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const totalSize = prepared.length * cl.COMMAND_REMOVE_POLYLINE_FIELDS;
    ensureCommandCapacity(
      Math.min(commandUsed + totalSize, MAX_COMMAND_BUFFER_USED_PER_APPLY)
    );

    let remaining = promiseHandlers ? prepared.length : 0;
    let settled = false;

    const rejectBatch = (error: Error) => {
      if (!promiseHandlers || settled) {
        return;
      }
      settled = true;
      promiseHandlers.reject(error);
    };

    const resolveBatch = () => {
      if (!promiseHandlers || settled || remaining !== 0) {
        return;
      }
      settled = true;
      promiseHandlers.resolve(undefined);
    };

    for (let index = 0; index < prepared.length; index += 1) {
      const entry = prepared[index]!;
      const size = cl.COMMAND_REMOVE_POLYLINE_FIELDS;
      if (!flushBeforeQueue(size, promiseHandlers !== null)) {
        if (promiseHandlers) {
          rejectBatch(
            createPolylineIdCommandError(
              'Polyline command failed.',
              entry.polylineId
            )
          );
          return promiseHandlers.promise;
        }
        return undefined;
      }
      queueCommand(cl.COMMAND_OP_REMOVE_POLYLINE, size, queue_commandRet);
      commandBuffer[
        queue_commandRet.offset + cl.COMMAND_REMOVE_POLYLINE_POLYLINE_ID_OFFSET
      ] = entry.polylineIndex;
      const pending: PendingCommand = {
        index: queue_commandRet.commandIndex,
        kind: 'removePolyline',
        polylineId: entry.polylineId,
        polylineIndex: entry.polylineIndex,
      };
      if (promiseHandlers) {
        pending.resolve = () => {
          if (settled) {
            return;
          }
          remaining -= 1;
          resolveBatch();
        };
        pending.reject = (error) => {
          rejectBatch(error);
        };
      }
      pendingCommands.push(pending);
      pendingPolylineRemovalIds.add(entry.polylineId);
      insertPendingRemovalIndex(
        pendingPolylineRemovalIndices,
        entry.polylineBaseIndex
      );
    }

    return promiseHandlers?.promise;
  }

  // =================================================

  function updateCamera(camera: CameraUpdate): void;
  function updateCamera(camera: CameraUpdate, awaitable: false): void;
  function updateCamera(camera: CameraUpdate, awaitable: true): Promise<void>;
  function updateCamera(
    camera: CameraUpdate,
    awaitable: boolean = false
  ): void | Promise<void> {
    const promiseHandlers = awaitable ? createPromiseHandlers<void>() : null;

    if (!camera || typeof camera !== 'object') {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCameraCommandError('Camera update payload is required.', camera)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const position = camera.position;
    if (position) {
      if (
        (position.x !== undefined && !isFiniteUpdateValue(position.x)) ||
        (position.y !== undefined && !isFiniteUpdateValue(position.y)) ||
        (position.z !== undefined && !isFiniteUpdateValue(position.z))
      ) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createCameraCommandError(
              'Camera parameters must be finite numbers.',
              camera
            )
          );
          return promiseHandlers.promise;
        }
        return undefined;
      }
    }

    const rotation = camera.rotation;
    if (rotation) {
      if (
        (rotation.yaw !== undefined && !isFiniteUpdateValue(rotation.yaw)) ||
        (rotation.pitch !== undefined &&
          !isFiniteUpdateValue(rotation.pitch)) ||
        (rotation.roll !== undefined && !isFiniteUpdateValue(rotation.roll))
      ) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createCameraCommandError(
              'Camera parameters must be finite numbers.',
              camera
            )
          );
          return promiseHandlers.promise;
        }
        return undefined;
      }
    }

    const fovY = camera.fovY;
    if (fovY !== undefined) {
      if (!isFiniteUpdateValue(fovY)) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createCameraCommandError(
              'Camera parameters must be finite numbers.',
              camera
            )
          );
          return promiseHandlers.promise;
        }
        return undefined;
      }
      if (fovY.value !== undefined && !(fovY.value > 0 && fovY.value < 180)) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createCameraCommandError(
              'Field of view must be between 0 and PI.',
              camera
            )
          );
          return promiseHandlers.promise;
        }
        return undefined;
      }
    }
    const near = camera.near;
    if (near !== undefined && !(near > 0)) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCameraCommandError('Invalid near/far range.', camera)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    const far = camera.far;
    if (far !== undefined && !(far > 0)) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCameraCommandError('Invalid near/far range.', camera)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    if (near !== undefined && far !== undefined && !(far > near)) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCameraCommandError('Invalid near/far range.', camera)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const previousCommandUsed = commandUsed;
    const previousCommandCount = commandCount;
    try {
      queueUpdateCamera(camera, promiseHandlers);
    } catch {
      commandUsed = previousCommandUsed;
      commandCount = previousCommandCount;
      commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
      commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = commandCount;
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCameraCommandError('Camera command failed.', camera)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }

    return promiseHandlers?.promise;
  }

  // =================================================

  function adjustCameraPosition(options: CameraAdjustPositionOptions): void;
  function adjustCameraPosition(
    options: CameraAdjustPositionOptions,
    awaitable: false
  ): void;
  function adjustCameraPosition(
    options: CameraAdjustPositionOptions,
    awaitable: true
  ): Promise<void>;
  function adjustCameraPosition(
    options: CameraAdjustPositionOptions,
    awaitable: boolean = false
  ): void | Promise<void> {
    const promiseHandlers = awaitable ? createPromiseHandlers<void>() : null;

    if (!options || typeof options !== 'object') {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCameraAdjustCommandError(
            'Camera adjust options are required.',
            {}
          )
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    const errorPayload = createCameraAdjustPayload(options);

    const pitch = options.pitch;
    if (pitch !== undefined && !isFiniteUpdateValue(pitch)) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCameraAdjustCommandError(
            'Camera pitch must be a finite number.',
            errorPayload
          )
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const fov = options.fov;
    if (fov !== undefined) {
      if (!isFiniteUpdateValue(fov)) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createCameraAdjustCommandError(
              'Field of view must be a finite number.',
              errorPayload
            )
          );
          return promiseHandlers.promise;
        }
        return undefined;
      }
      if (fov.value !== undefined && !(fov.value > 0 && fov.value < 180)) {
        if (promiseHandlers) {
          promiseHandlers.reject(
            createCameraAdjustCommandError(
              'Field of view must be between 0 and PI.',
              errorPayload
            )
          );
          return promiseHandlers.promise;
        }
        return undefined;
      }
    }

    const near = options.near;
    if (near !== undefined && !(near > 0)) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCameraAdjustCommandError(
            'Invalid near/far range.',
            errorPayload
          )
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    const far = options.far;
    if (far !== undefined && !(far > 0)) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCameraAdjustCommandError(
            'Invalid near/far range.',
            errorPayload
          )
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }
    if (near !== undefined && far !== undefined && !(far > near)) {
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCameraAdjustCommandError(
            'Invalid near/far range.',
            errorPayload
          )
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const payload = createCameraAdjustPayload(options);

    const previousCommandUsed = commandUsed;
    const previousCommandCount = commandCount;
    try {
      queueAdjustCameraPosition(payload, promiseHandlers);
    } catch {
      commandUsed = previousCommandUsed;
      commandCount = previousCommandCount;
      commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
      commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = commandCount;
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCameraAdjustCommandError(
            'Camera adjust command failed.',
            payload
          )
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }

    return promiseHandlers?.promise;
  }

  // =================================================

  function setViewPortSize(size: SizeInPixel): void;
  function setViewPortSize(size: SizeInPixel, awaitable: false): void;
  function setViewPortSize(size: SizeInPixel, awaitable: true): Promise<void>;
  function setViewPortSize(
    size: SizeInPixel,
    awaitable: boolean = false
  ): void | Promise<void> {
    const promiseHandlers = awaitable ? createPromiseHandlers<void>() : null;

    if (
      !Number.isFinite(size.widthPixel) ||
      !Number.isFinite(size.heightPixel)
    ) {
      if (promiseHandlers) {
        const error = new Error('Invalid viewport size.');
        (error as { size?: SizeInPixel }).size = size;
        promiseHandlers.reject(error);
        return promiseHandlers.promise;
      }
      return undefined;
    }

    const cameraPayload: CameraUpdatePayload = {
      aspectRatio: computeAspectRatio(size),
    };

    const previousCommandUsed = commandUsed;
    const previousCommandCount = commandCount;
    try {
      queueUpdateCamera(cameraPayload, promiseHandlers);
    } catch {
      commandUsed = previousCommandUsed;
      commandCount = previousCommandCount;
      commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
      commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = commandCount;
      if (promiseHandlers) {
        promiseHandlers.reject(
          createCameraCommandError('Camera command failed.', cameraPayload)
        );
        return promiseHandlers.promise;
      }
      return undefined;
    }

    latestViewPortSize = {
      widthPixel: size.widthPixel,
      heightPixel: size.heightPixel,
    };

    return promiseHandlers?.promise;
  }

  // =================================================

  const render_failures: number[] = []; // DIRTY HACK: common buffer, reuseable
  const render_results: number[] = []; // DIRTY HACK: common buffer, reuseable
  interface ApplyCommandStats {
    commandApplyDurationMs: number;
    commandApplyCallDurationMs: number;
    commandApplyJsDurationMs: number;
    commandApplyWasmDurationMs: number;
    commandApplyWasmLoopDurationMs: number;
    commandApplyWasmSyncSlotsDurationMs: number;
    commandApplyWasmClearDurationMs: number;
    commandCountSample: number;
    updateSpriteCommandCount: number;
    updateFrameCount: number;
    updateQueueDelayMs: number;
  }

  const rejectPendingCommands = (message: string) => {
    pendingCommands.forEach((command) => {
      if (command.reject) {
        command.reject(createCommandErrorFromPending(message, command));
      }
    });
  };

  const applyQueuedCommands = (
    nowMs: number,
    throwOnFailure: boolean,
    allowEmptyApply: boolean = false
  ): ApplyCommandStats => {
    const stats: ApplyCommandStats = {
      commandApplyDurationMs: 0,
      commandApplyCallDurationMs: 0,
      commandApplyJsDurationMs: 0,
      commandApplyWasmDurationMs: 0,
      commandApplyWasmLoopDurationMs: 0,
      commandApplyWasmSyncSlotsDurationMs: 0,
      commandApplyWasmClearDurationMs: 0,
      commandCountSample: 0,
      updateSpriteCommandCount: 0,
      updateFrameCount: 0,
      updateQueueDelayMs: 0,
    };
    if ((commandCount <= 0 && !allowEmptyApply) || isReleased) {
      return stats;
    }

    isApplyingCommands = true;
    try {
      const commandApplyStartMs = getNowMs();
      const requiredResultCapacity =
        cl.COMMAND_RESULT_HEADER_FIELDS + commandCount + pendingResultCount;
      if (commandCount > 0) {
        ensureResultCapacity(requiredResultCapacity);
        if (resultBufferCapacity < requiredResultCapacity) {
          if (!reportedResultBufferShortage) {
            logger.error('Result buffer is smaller than required capacity.', {
              requiredResultCapacity,
              resultBufferCapacity,
              commandCount,
              pendingResultCount,
            });
            reportedResultBufferShortage = true;
          }
        } else if (reportedResultBufferShortage) {
          reportedResultBufferShortage = false;
        }
      }
      const commandUsedBefore = commandUsed;
      const commandCountBefore = commandCount;
      const pendingResultCountBefore = pendingResultCount;
      const commandSnapshotBuffer = commandBuffer.slice(
        0,
        commandUsedBefore
      ) as InputArrayBuffer;
      stats.commandCountSample = commandCountBefore;
      stats.updateSpriteCommandCount = pendingUpdateSpriteCommandCount;
      stats.updateFrameCount = stats.updateSpriteCommandCount > 0 ? 1 : 0;
      if (
        stats.updateFrameCount > 0 &&
        pendingUpdateSpriteFirstQueuedAtMs !== null
      ) {
        stats.updateQueueDelayMs = Math.max(
          0,
          commandApplyStartMs - pendingUpdateSpriteFirstQueuedAtMs
        );
      }
      const commandApplyCallStartMs = getNowMs();
      const ok = wasmState.exports.apply_commands(wasmState.contextPtr, nowMs);
      stats.commandApplyCallDurationMs = Math.max(
        0,
        getNowMs() - commandApplyCallStartMs
      );
      const commandApplyJsStartMs = getNowMs();
      commandBuffer = wasmState.commandBuffer.getBuffer();
      commandBufferCapacity = wasmState.commandBuffer.count;
      resultBuffer = wasmState.resultBuffer.getBuffer();
      resultBufferCapacity = wasmState.resultBuffer.count;
      applyStatsBuffer = wasmState.applyStatsBuffer.getBuffer();
      if (applyStatsBuffer.length >= wl.APPLY_STATS_FIELDS) {
        const totalRaw = applyStatsBuffer[wl.APPLY_STATS_TOTAL_MS_OFFSET]!;
        const loopRaw = applyStatsBuffer[wl.APPLY_STATS_LOOP_MS_OFFSET]!;
        const syncRaw = applyStatsBuffer[wl.APPLY_STATS_SYNC_SLOTS_MS_OFFSET]!;
        const clearRaw = applyStatsBuffer[wl.APPLY_STATS_CLEAR_MS_OFFSET]!;
        if (Number.isFinite(totalRaw)) {
          stats.commandApplyWasmDurationMs = Math.max(0, totalRaw);
        }
        if (Number.isFinite(loopRaw)) {
          stats.commandApplyWasmLoopDurationMs = Math.max(0, loopRaw);
        }
        if (Number.isFinite(syncRaw)) {
          stats.commandApplyWasmSyncSlotsDurationMs = Math.max(0, syncRaw);
        }
        if (Number.isFinite(clearRaw)) {
          stats.commandApplyWasmClearDurationMs = Math.max(0, clearRaw);
        }
      }
      if (!ok) {
        const failureSnapshots = collectCommandSnapshots(
          commandSnapshotBuffer,
          commandCountBefore,
          commandUsedBefore
        );
        const failureSummary = {
          commandCount: commandCountBefore,
          pendingResultCount: pendingResultCountBefore,
          commands: failureSnapshots,
        };
        logger.error('Failed to apply wasm commands.', failureSummary);
        logger.error(
          'Failed to apply wasm commands (snapshot).',
          JSON.stringify(failureSummary)
        );
        rejectPendingCommands('Sprite command failed.');
        resetCommandBuffer();
        const error = new Error('Failed to apply wasm commands.');
        if (throwOnFailure) {
          throw error;
        }
        return stats;
      }
      const headerFailedCount =
        resultBuffer[cl.COMMAND_RESULT_FAILED_COUNT_OFFSET]!;
      const headerResultCount =
        resultBuffer[cl.COMMAND_RESULT_RESULT_COUNT_OFFSET]!;

      render_failures.length = 0;
      render_results.length = 0;
      finalizeCommandResults(render_failures, render_results);

      if (pendingResultCountBefore > 0 && render_results.length === 0) {
        if (!reportedMissingResults) {
          const summary = {
            commandCount: commandCountBefore,
            pendingResultCount: pendingResultCountBefore,
            resultBufferCapacity,
            requiredResultCapacity,
            headerFailedCount,
            headerResultCount,
          };
          logger.warn('Wasm result buffer returned no results.', summary);
          logger.warn(
            'Wasm result buffer returned no results (snapshot).',
            JSON.stringify(summary)
          );
          reportedMissingResults = true;
        }
      } else if (reportedMissingResults) {
        reportedMissingResults = false;
      }
      if (render_failures.length > 0) {
        const failureSnapshots = collectCommandSnapshots(
          commandSnapshotBuffer,
          commandCountBefore,
          commandUsedBefore,
          new Set(render_failures)
        );
        const failureSummary = {
          failures: render_failures.map(describeCommandFailure),
          commandCount: commandCountBefore,
          pendingResultCount: pendingResultCountBefore,
          commands: failureSnapshots,
        };
        logger.warn('Wasm command failures detected.', failureSummary);
        logger.warn(
          'Wasm command failures detected (snapshot).',
          JSON.stringify(failureSummary)
        );
      }
      applyCommandResults(render_failures, render_results);
      resetCommandBuffer();
      const commandApplyEndMs = getNowMs();
      stats.commandApplyJsDurationMs = Math.max(
        0,
        commandApplyEndMs - commandApplyJsStartMs
      );
      stats.commandApplyDurationMs = Math.max(
        0,
        commandApplyEndMs - commandApplyStartMs
      );
      return stats;
    } finally {
      isApplyingCommands = false;
    }
  };

  const rotationLogger = createRotationLogger();
  interface DrawPayload {
    readonly spriteOutput: Float32Array;
    readonly spriteCount: number;
    readonly polylineOutput: Float32Array;
    readonly drawCommands: Int32Array;
  }

  interface DrawStats {
    drawSetupDurationMs: number;
    vertexUploadDurationMs: number;
    drawLoopDurationMs: number;
    drawCallCount: number;
    textureBindCount: number;
    textureBindDurationMs: number;
    opacityUniformDurationMs: number;
    drawCallDurationMs: number;
    skippedDrawCount: number;
  }

  const drawStats: DrawStats = {
    drawSetupDurationMs: 0,
    vertexUploadDurationMs: 0,
    drawLoopDurationMs: 0,
    drawCallCount: 0,
    textureBindCount: 0,
    textureBindDurationMs: 0,
    opacityUniformDurationMs: 0,
    drawCallDurationMs: 0,
    skippedDrawCount: 0,
  };

  const resetDrawStats = (stats: DrawStats) => {
    stats.drawSetupDurationMs = 0;
    stats.vertexUploadDurationMs = 0;
    stats.drawLoopDurationMs = 0;
    stats.drawCallCount = 0;
    stats.textureBindCount = 0;
    stats.textureBindDurationMs = 0;
    stats.opacityUniformDurationMs = 0;
    stats.drawCallDurationMs = 0;
    stats.skippedDrawCount = 0;
  };

  const drawFrame = (payload: DrawPayload, stats: DrawStats) => {
    const context = renderContext;
    if (!context) {
      throw new Error('WebGL context is not attached.');
    }
    const { gl, sprite, polyline } = context;
    const viewProjection = getViewProjectionUploadBuffer();
    const commands = payload.drawCommands;
    const commandCount = Math.trunc(
      commands[wl.DRAW_COMMAND_COMMAND_COUNT_OFFSET] ?? 0
    );
    if (commandCount <= 0) {
      return;
    }

    const polylineVertexCount = Math.trunc(
      commands[wl.DRAW_COMMAND_POLYLINE_VERTEX_COUNT_OFFSET] ?? 0
    );
    const drawSetupStartMs = getNowMs();
    let currentProgram: 'sprite' | 'polyline' | null = null;
    let lastVertexBaseOffsetBytes = -1;
    let spriteUploaded = false;
    let polylineUploaded = false;

    const setSpriteProgram = () => {
      if (currentProgram === 'sprite') {
        return;
      }
      gl.useProgram(sprite.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, sprite.buffer);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, sprite.indexBuffer);
      gl.enableVertexAttribArray(sprite.positionLocation);
      gl.enableVertexAttribArray(sprite.texCoordLocation);
      gl.enableVertexAttribArray(sprite.opacityAttributeLocation);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform1i(sprite.textureLocation, 0);
      const opacityUniformStartMs = getNowMs();
      gl.uniform1f(sprite.opacityLocation, 1.0);
      stats.opacityUniformDurationMs += Math.max(
        0,
        getNowMs() - opacityUniformStartMs
      );
      gl.uniformMatrix4fv(sprite.viewProjectionLocation, false, viewProjection);
      currentProgram = 'sprite';
      lastVertexBaseOffsetBytes = -1;
    };

    const setSpriteVertexBaseOffset = (baseOffsetBytes: number) => {
      if (baseOffsetBytes === lastVertexBaseOffsetBytes) {
        return;
      }
      gl.vertexAttribPointer(
        sprite.positionLocation,
        3,
        gl.FLOAT,
        false,
        RENDER_VERTEX_STRIDE_BYTES,
        baseOffsetBytes
      );
      gl.vertexAttribPointer(
        sprite.texCoordLocation,
        2,
        gl.FLOAT,
        false,
        RENDER_VERTEX_STRIDE_BYTES,
        baseOffsetBytes + 12
      );
      gl.vertexAttribPointer(
        sprite.opacityAttributeLocation,
        1,
        gl.FLOAT,
        false,
        RENDER_VERTEX_STRIDE_BYTES,
        baseOffsetBytes + 20
      );
      lastVertexBaseOffsetBytes = baseOffsetBytes;
    };

    const setPolylineProgram = () => {
      if (currentProgram === 'polyline') {
        return;
      }
      gl.useProgram(polyline.program);
      gl.bindBuffer(gl.ARRAY_BUFFER, polyline.buffer);
      gl.enableVertexAttribArray(polyline.positionLocation);
      gl.enableVertexAttribArray(polyline.colorLocation);
      gl.vertexAttribPointer(
        polyline.positionLocation,
        3,
        gl.FLOAT,
        false,
        POLYLINE_VERTEX_STRIDE_BYTES,
        0
      );
      gl.vertexAttribPointer(
        polyline.colorLocation,
        4,
        gl.FLOAT,
        false,
        POLYLINE_VERTEX_STRIDE_BYTES,
        12
      );
      gl.uniformMatrix4fv(
        polyline.viewProjectionLocation,
        false,
        viewProjection
      );
      currentProgram = 'polyline';
    };

    stats.drawSetupDurationMs = Math.max(0, getNowMs() - drawSetupStartMs);

    const drawLoopStartMs = getNowMs();
    for (let index = 0; index < commandCount; index += 1) {
      const base =
        wl.DRAW_COMMAND_HEADER_FIELDS + index * wl.DRAW_COMMAND_FIELDS;
      const kind = commands[base + wl.DRAW_COMMAND_KIND_FIELD_OFFSET]!;
      const start = commands[base + wl.DRAW_COMMAND_START_FIELD_OFFSET]!;
      const count = commands[base + wl.DRAW_COMMAND_COUNT_FIELD_OFFSET]!;
      const extra = commands[base + wl.DRAW_COMMAND_EXTRA_FIELD_OFFSET]!;
      if (count <= 0) {
        continue;
      }

      if (kind === wl.DRAW_COMMAND_KIND_SPRITE) {
        const texture = textureManager.resolveTextureByPageId(extra);
        if (!texture) {
          stats.skippedDrawCount += Math.max(0, count);
          continue;
        }
        textureManager.ensureMipmap(extra);

        const outputEnd = Math.min(payload.spriteCount, start + count);
        const spriteCount = Math.max(0, outputEnd - start);
        if (spriteCount <= 0) {
          continue;
        }

        setSpriteProgram();
        if (!spriteUploaded) {
          const vertexUploadStartMs = getNowMs();
          gl.bufferData(gl.ARRAY_BUFFER, payload.spriteOutput, gl.DYNAMIC_DRAW);
          stats.vertexUploadDurationMs += Math.max(
            0,
            getNowMs() - vertexUploadStartMs
          );
          spriteUploaded = true;
        }

        const textureBindStartMs = getNowMs();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        stats.textureBindDurationMs += Math.max(
          0,
          getNowMs() - textureBindStartMs
        );
        stats.textureBindCount += 1;

        let remainingSprites = spriteCount;
        let startSprite = 0;
        while (remainingSprites > 0) {
          const batchSpriteCount = Math.min(
            remainingSprites,
            sprite.indexBufferSpriteCapacity
          );
          const indexCount = batchSpriteCount * RENDER_INDICES_PER_SPRITE;
          const baseOffsetBytes =
            (start + startSprite) *
            RENDER_VERTICES_PER_SPRITE *
            RENDER_VERTEX_STRIDE_BYTES;
          setSpriteVertexBaseOffset(baseOffsetBytes);
          const drawCallStartMs = getNowMs();
          gl.drawElements(gl.TRIANGLES, indexCount, gl.UNSIGNED_SHORT, 0);
          stats.drawCallDurationMs += Math.max(0, getNowMs() - drawCallStartMs);
          stats.drawCallCount += 1;
          startSprite += batchSpriteCount;
          remainingSprites -= batchSpriteCount;
        }
      } else if (kind === wl.DRAW_COMMAND_KIND_POLYLINE) {
        if (polylineVertexCount <= 0) {
          continue;
        }
        if (!polylineUploaded) {
          setPolylineProgram();
          const vertexUploadStartMs = getNowMs();
          gl.bufferData(
            gl.ARRAY_BUFFER,
            payload.polylineOutput.subarray(
              0,
              polylineVertexCount * POLYLINE_FLOATS_PER_VERTEX
            ),
            gl.DYNAMIC_DRAW
          );
          stats.vertexUploadDurationMs += Math.max(
            0,
            getNowMs() - vertexUploadStartMs
          );
          polylineUploaded = true;
        } else {
          setPolylineProgram();
        }

        const drawCallStartMs = getNowMs();
        gl.drawArrays(gl.TRIANGLES, start, count);
        stats.drawCallDurationMs += Math.max(0, getNowMs() - drawCallStartMs);
        stats.drawCallCount += 1;
      }
    }

    stats.drawLoopDurationMs = Math.max(0, getNowMs() - drawLoopStartMs);
  };

  const computeFrame = (
    drawHandler: ((payload: DrawPayload, stats: DrawStats) => void) | null
  ): number => {
    const renderStartMs = getNowMs();
    const nowMs = renderStartMs;
    let activeCount = 0;
    let wasmComputeDurationMs = 0;
    let wasmComputeInternalDurationMs = 0;
    let wasmComputeProjectionDurationMs = 0;
    let wasmComputeSpriteAnimationDurationMs = 0;
    let wasmComputeElementAnimationDurationMs = 0;
    let wasmComputeElementAnimOwnerDurationMs = 0;
    let wasmComputeElementAnimOpacityDurationMs = 0;
    let wasmComputeElementAnimRotationDurationMs = 0;
    let wasmComputeElementAnimScaleDurationMs = 0;
    let wasmComputeElementAnimAnchorDurationMs = 0;
    let wasmComputeElementAnimShiftDurationMs = 0;
    let wasmComputeElementAnimPivotDurationMs = 0;
    let wasmComputeElementAnimMergeDurationMs = 0;
    let wasmComputeElementAnimScalarDurationMs = 0;
    let wasmComputeElementAnimSimdLoopDurationMs = 0;
    let wasmComputePivotResolveDurationMs = 0;
    let wasmComputeAutoRotationDurationMs = 0;
    let wasmComputeCollectEntriesDurationMs = 0;
    let wasmComputeSortEntriesDurationMs = 0;
    let wasmComputeWriteOutputDurationMs = 0;
    let commandApplyDurationMs = 0;
    let commandApplyCallDurationMs = 0;
    let commandApplyJsDurationMs = 0;
    let commandApplyWasmDurationMs = 0;
    let commandApplyWasmLoopDurationMs = 0;
    let commandApplyWasmSyncSlotsDurationMs = 0;
    let commandApplyWasmClearDurationMs = 0;
    let cameraTrackingDurationMs = 0;
    let ensureRenderBuffersDurationMs = 0;
    let commandCountSample = 0;
    let updateSpriteCommandCount = 0;
    let updateFrameCount = 0;
    let updateQueueDelayMs = 0;
    let skippedDrawCount = 0;
    const accumulateApplyStats = (applyStats: ApplyCommandStats) => {
      commandApplyDurationMs += applyStats.commandApplyDurationMs;
      commandApplyCallDurationMs += applyStats.commandApplyCallDurationMs;
      commandApplyJsDurationMs += applyStats.commandApplyJsDurationMs;
      commandApplyWasmDurationMs += applyStats.commandApplyWasmDurationMs;
      commandApplyWasmLoopDurationMs +=
        applyStats.commandApplyWasmLoopDurationMs;
      commandApplyWasmSyncSlotsDurationMs +=
        applyStats.commandApplyWasmSyncSlotsDurationMs;
      commandApplyWasmClearDurationMs +=
        applyStats.commandApplyWasmClearDurationMs;
      commandCountSample += applyStats.commandCountSample;
      updateSpriteCommandCount += applyStats.updateSpriteCommandCount;
      updateFrameCount += applyStats.updateFrameCount;
      updateQueueDelayMs += applyStats.updateQueueDelayMs;
    };
    resetDrawStats(drawStats);
    const rotationLogEnabled =
      (globalThis as typeof globalThis).outputRotationLog === true &&
      typeof (globalThis as typeof globalThis).rotationLogSink === 'function';
    const rotationLogEntriesEnabled =
      rotationLogEnabled &&
      (globalThis as typeof globalThis).outputRotationLogEntries === true;
    if (rotationLogEntriesEnabled !== entryDebugEnabled) {
      wasmState.exports.set_entry_debug_enabled(
        wasmState.contextPtr,
        rotationLogEntriesEnabled ? 1 : 0
      );
      entryDebugEnabled = rotationLogEntriesEnabled;
    }
    const elementAnimProfileEnabled =
      (globalThis as typeof globalThis).outputElementAnimProfile === true &&
      typeof (globalThis as typeof globalThis).elementAnimProfileSink ===
        'function';
    if (elementAnimProfileEnabled !== elementAnimDetailEnabled) {
      wasmState.exports.set_element_anim_detail_enabled(
        wasmState.contextPtr,
        elementAnimProfileEnabled ? 1 : 0
      );
      elementAnimDetailEnabled = elementAnimProfileEnabled;
      if (elementAnimProfileEnabled) {
        elementAnimProfileFrame = 0;
      }
    }

    if (
      commandCount > 0 ||
      (cameraTrackingState && !supportsWasmCameraTracking)
    ) {
      accumulateApplyStats(
        applyQueuedCommands(
          nowMs,
          true,
          cameraTrackingState !== null && !supportsWasmCameraTracking
        )
      );
      if (cameraTrackingState && supportsWasmCameraTracking) {
        syncCameraTrackingToWasm();
      }
    }

    if (cameraTrackingState && !supportsWasmCameraTracking) {
      const trackingStartMs = getNowMs();
      if (cameraTrackingState.targetMode === 'contentApprox') {
        const cameraState = getCameraState();
        const trackingResolution = resolveContentApproxTrackingSolution(
          cameraState,
          cameraTrackingState,
          nowMs
        );
        if (trackingResolution.missingTarget) {
          clearCameraTracking();
        } else if (trackingResolution.solution) {
          cameraTrackingState = {
            ...cameraTrackingState,
            resolvedDistance: trackingResolution.solution.distance,
          };
          const trackingUpdate = createCameraTrackingUpdate(
            cameraState,
            trackingResolution.solution,
            cameraTrackingState.interpolation
          );
          if (hasMaterialCameraTrackingUpdate(cameraState, trackingUpdate)) {
            queueUpdateCamera(trackingUpdate, null);
            accumulateApplyStats(applyQueuedCommands(nowMs, true));
            notifyCameraStateChange({
              source: 'tracking',
              cameraUpdate: trackingUpdate,
            });
          }
        }
      } else {
        const trackingTargets: ObjectWorldPosition[] = [];
        let trackingTargetMissing = false;
        for (
          let trackingIndex = 0;
          trackingIndex < cameraTrackingState.spriteIds.length;
          trackingIndex += 1
        ) {
          const spriteId = cameraTrackingState.spriteIds[trackingIndex]!;
          const trackingSnapshot = spriteTrackingSnapshots.get(spriteId);
          if (!trackingSnapshot) {
            trackingTargetMissing = true;
            break;
          }
          if (
            !(resolveSpriteTrackingSnapshotOpacity(trackingSnapshot, nowMs) > 0)
          ) {
            continue;
          }
          trackingTargets.push(
            resolveSpriteTrackingSnapshotPosition(trackingSnapshot, nowMs)
          );
        }
        if (trackingTargetMissing) {
          clearCameraTracking();
        } else if (trackingTargets.length > 0) {
          const cameraState = getCameraState();
          const trackingSolution = resolveCameraTrackingSolution(
            cameraState,
            cameraTrackingState,
            trackingTargets
          );
          if (trackingSolution) {
            cameraTrackingState = {
              ...cameraTrackingState,
              resolvedDistance: trackingSolution.distance,
            };
            const trackingUpdate = createCameraTrackingUpdate(
              cameraState,
              trackingSolution,
              cameraTrackingState.interpolation
            );
            if (hasMaterialCameraTrackingUpdate(cameraState, trackingUpdate)) {
              queueUpdateCamera(trackingUpdate, null);
              accumulateApplyStats(applyQueuedCommands(nowMs, true));
              notifyCameraStateChange({
                source: 'tracking',
                cameraUpdate: trackingUpdate,
              });
            }
          }
        }
      }
      cameraTrackingDurationMs = Math.max(0, getNowMs() - trackingStartMs);
    }

    const leaderlineVertexCount =
      totalLeaderlineCount > 0 ? totalLeaderlineCount * 6 : 0;
    const borderVertexCount = totalBorderCount > 0 ? totalBorderCount * 24 : 0;
    const polylineSegmentCount =
      totalPolylineNodeCount > 0
        ? polylineNodeCounts.reduce(
            (sum, count) => sum + Math.max(0, count - 1),
            0
          )
        : 0;
    const totalPolylineSegmentCount =
      polylineSegmentCount + totalLeaderlineCount + totalBorderCount;
    const polylineVertexCount =
      totalPolylineNodeCount > 0
        ? polylineNodeCounts.reduce(
            (sum, count, index) =>
              sum +
              estimatePolylineVertexCount(
                count,
                getPolylineRenderOptionsAt(index)
              ),
            0
          )
        : 0;
    const totalPolylineVertexCount =
      leaderlineVertexCount + borderVertexCount + polylineVertexCount;
    const hasSprites = totalElementCount > 0;
    const hasPolylines = totalPolylineVertexCount > 0;
    const requiredSpriteOutputCount = hasSprites
      ? resolveRequiredSpriteOutputCount()
      : 0;
    const requiredDrawCommandCount =
      requiredSpriteOutputCount + totalPolylineSegmentCount;

    if (hasSprites || hasPolylines) {
      const rotationLogEnabled =
        globalThis.outputRotationLog === true &&
        typeof (globalThis as typeof globalThis).rotationLogSink === 'function';
      const rotationLogAspectRatio = rotationLogEnabled
        ? readCameraAspectRatio()
        : undefined;
      const ensureRenderBuffersStartMs = getNowMs();
      if (hasSprites) {
        ensureRenderBuffers(requiredSpriteOutputCount);
      }
      ensurePolylineBuffers(
        Math.max(0, totalPolylineVertexCount),
        Math.max(0, requiredDrawCommandCount)
      );
      ensureRenderBuffersDurationMs = Math.max(
        0,
        getNowMs() - ensureRenderBuffersStartMs
      );

      const wasmComputeStartMs = getNowMs();
      activeCount = wasmState.exports.compute_vertices(
        wasmState.contextPtr,
        wasmState.viewMatrixBuffer.ptr,
        wasmState.viewProjectionBuffer.ptr,
        wasmState.outputBuffer.ptr,
        wasmState.texIndexBuffer.ptr,
        wasmState.polylineOutputBuffer.ptr,
        wasmState.drawCommandBuffer.ptr,
        latestViewPortSize.widthPixel,
        latestViewPortSize.heightPixel,
        nowMs
      );
      wasmComputeDurationMs = Math.max(0, getNowMs() - wasmComputeStartMs);
      lastComputeTimestampMs = nowMs;
      lastComputeCommandRevision = commandRevision;
      lastComputeOutputValid = true;
      computeStatsBuffer = wasmState.computeStatsBuffer.getBuffer();
      if (computeStatsBuffer.length >= wl.COMPUTE_STATS_FIELDS) {
        const cameraDirty =
          computeStatsBuffer[wl.COMPUTE_STATS_CAMERA_DIRTY_OFFSET]!;
        const totalRaw = computeStatsBuffer[wl.COMPUTE_STATS_TOTAL_MS_OFFSET]!;
        const projectionRaw =
          computeStatsBuffer[wl.COMPUTE_STATS_PROJECTION_MS_OFFSET]!;
        const spriteAnimationRaw =
          computeStatsBuffer[wl.COMPUTE_STATS_SPRITE_ANIMATION_MS_OFFSET]!;
        const elementAnimationRaw =
          computeStatsBuffer[wl.COMPUTE_STATS_ELEMENT_ANIMATION_MS_OFFSET]!;
        const pivotResolveRaw =
          computeStatsBuffer[wl.COMPUTE_STATS_PIVOT_RESOLVE_MS_OFFSET]!;
        const autoRotationRaw =
          computeStatsBuffer[wl.COMPUTE_STATS_AUTO_ROTATION_MS_OFFSET]!;
        const cameraTrackingRaw =
          computeStatsBuffer[wl.COMPUTE_STATS_CAMERA_TRACKING_MS_OFFSET]!;
        const collectEntriesRaw =
          computeStatsBuffer[wl.COMPUTE_STATS_COLLECT_ENTRIES_MS_OFFSET]!;
        const sortEntriesRaw =
          computeStatsBuffer[wl.COMPUTE_STATS_SORT_ENTRIES_MS_OFFSET]!;
        const writeOutputRaw =
          computeStatsBuffer[wl.COMPUTE_STATS_WRITE_OUTPUT_MS_OFFSET]!;
        const elementAnimOwnerRaw =
          computeStatsBuffer[
            wl.COMPUTE_STATS_ELEMENT_ANIMATION_OWNER_MS_OFFSET
          ]!;
        const elementAnimOpacityRaw =
          computeStatsBuffer[
            wl.COMPUTE_STATS_ELEMENT_ANIMATION_OPACITY_MS_OFFSET
          ]!;
        const elementAnimRotationRaw =
          computeStatsBuffer[
            wl.COMPUTE_STATS_ELEMENT_ANIMATION_ROTATION_MS_OFFSET
          ]!;
        const elementAnimScaleRaw =
          computeStatsBuffer[
            wl.COMPUTE_STATS_ELEMENT_ANIMATION_SCALE_MS_OFFSET
          ]!;
        const elementAnimAnchorRaw =
          computeStatsBuffer[
            wl.COMPUTE_STATS_ELEMENT_ANIMATION_ANCHOR_MS_OFFSET
          ]!;
        const elementAnimShiftRaw =
          computeStatsBuffer[
            wl.COMPUTE_STATS_ELEMENT_ANIMATION_SHIFT_MS_OFFSET
          ]!;
        const elementAnimPivotRaw =
          computeStatsBuffer[
            wl.COMPUTE_STATS_ELEMENT_ANIMATION_PIVOT_MS_OFFSET
          ]!;
        const elementAnimMergeRaw =
          computeStatsBuffer[
            wl.COMPUTE_STATS_ELEMENT_ANIMATION_MERGE_MS_OFFSET
          ]!;
        const elementAnimScalarRaw =
          computeStatsBuffer[
            wl.COMPUTE_STATS_ELEMENT_ANIMATION_SCALAR_MS_OFFSET
          ]!;
        const elementAnimSimdLoopRaw =
          computeStatsBuffer[
            wl.COMPUTE_STATS_ELEMENT_ANIMATION_SIMD_LOOP_MS_OFFSET
          ]!;
        const cameraTrackingAppliedRaw =
          computeStatsBuffer[wl.COMPUTE_STATS_CAMERA_TRACKING_APPLIED_OFFSET]!;
        const cameraTrackingResolvedDistanceRaw =
          computeStatsBuffer[
            wl.COMPUTE_STATS_CAMERA_TRACKING_RESOLVED_DISTANCE_OFFSET
          ]!;

        wasmComputeInternalDurationMs = Math.max(0, totalRaw);
        wasmComputeProjectionDurationMs = Math.max(0, projectionRaw);
        wasmComputeSpriteAnimationDurationMs = Math.max(0, spriteAnimationRaw);
        wasmComputeElementAnimationDurationMs = Math.max(
          0,
          elementAnimationRaw
        );
        wasmComputePivotResolveDurationMs = Math.max(0, pivotResolveRaw);
        wasmComputeAutoRotationDurationMs = Math.max(0, autoRotationRaw);
        wasmComputeCollectEntriesDurationMs = Math.max(0, collectEntriesRaw);
        wasmComputeSortEntriesDurationMs = Math.max(0, sortEntriesRaw);
        wasmComputeWriteOutputDurationMs = Math.max(0, writeOutputRaw);
        wasmComputeElementAnimOwnerDurationMs = Math.max(
          0,
          elementAnimOwnerRaw
        );
        wasmComputeElementAnimOpacityDurationMs = Math.max(
          0,
          elementAnimOpacityRaw
        );
        wasmComputeElementAnimRotationDurationMs = Math.max(
          0,
          elementAnimRotationRaw
        );
        wasmComputeElementAnimScaleDurationMs = Math.max(
          0,
          elementAnimScaleRaw
        );
        wasmComputeElementAnimAnchorDurationMs = Math.max(
          0,
          elementAnimAnchorRaw
        );
        wasmComputeElementAnimShiftDurationMs = Math.max(
          0,
          elementAnimShiftRaw
        );
        wasmComputeElementAnimPivotDurationMs = Math.max(
          0,
          elementAnimPivotRaw
        );
        wasmComputeElementAnimMergeDurationMs = Math.max(
          0,
          elementAnimMergeRaw
        );
        wasmComputeElementAnimScalarDurationMs = Math.max(
          0,
          elementAnimScalarRaw
        );
        wasmComputeElementAnimSimdLoopDurationMs = Math.max(
          0,
          elementAnimSimdLoopRaw
        );
        if (supportsWasmCameraTracking) {
          cameraTrackingDurationMs = Math.max(0, cameraTrackingRaw);
          if (
            cameraTrackingState &&
            Number.isFinite(cameraTrackingResolvedDistanceRaw) &&
            cameraTrackingResolvedDistanceRaw > 0
          ) {
            cameraTrackingState = {
              ...cameraTrackingState,
              resolvedDistance: cameraTrackingResolvedDistanceRaw,
            };
          }
          if (cameraTrackingAppliedRaw !== 0) {
            notifyCameraStateChange({ source: 'tracking' });
          } else if (cameraDirty !== 0) {
            notifyCameraStateChange();
          }
        } else if (cameraDirty !== 0) {
          notifyCameraStateChange();
        }
      }

      if (elementAnimProfileEnabled) {
        const sink = (globalThis as typeof globalThis).elementAnimProfileSink;
        if (typeof sink === 'function') {
          const simdDetailSum =
            wasmComputeElementAnimOwnerDurationMs +
            wasmComputeElementAnimOpacityDurationMs +
            wasmComputeElementAnimRotationDurationMs +
            wasmComputeElementAnimScaleDurationMs +
            wasmComputeElementAnimAnchorDurationMs +
            wasmComputeElementAnimShiftDurationMs +
            wasmComputeElementAnimPivotDurationMs +
            wasmComputeElementAnimMergeDurationMs;
          const simdOtherMs = Math.max(
            0,
            wasmComputeElementAnimSimdLoopDurationMs - simdDetailSum
          );
          const setupOtherMs = Math.max(
            0,
            wasmComputeElementAnimationDurationMs -
              wasmComputeElementAnimSimdLoopDurationMs -
              wasmComputeElementAnimScalarDurationMs
          );
          const unaccountedMs = Math.max(
            0,
            wasmComputeElementAnimationDurationMs -
              simdDetailSum -
              wasmComputeElementAnimScalarDurationMs
          );
          sink(
            `[element-anim] frame=${elementAnimProfileFrame} t=${nowMs.toFixed(
              2
            )} total=${wasmComputeElementAnimationDurationMs.toFixed(
              3
            )} owner=${wasmComputeElementAnimOwnerDurationMs.toFixed(
              3
            )} opacity=${wasmComputeElementAnimOpacityDurationMs.toFixed(
              3
            )} rotation=${wasmComputeElementAnimRotationDurationMs.toFixed(
              3
            )} scale=${wasmComputeElementAnimScaleDurationMs.toFixed(
              3
            )} anchor=${wasmComputeElementAnimAnchorDurationMs.toFixed(
              3
            )} shift=${wasmComputeElementAnimShiftDurationMs.toFixed(
              3
            )} pivot=${wasmComputeElementAnimPivotDurationMs.toFixed(
              3
            )} merge=${wasmComputeElementAnimMergeDurationMs.toFixed(
              3
            )} scalar=${wasmComputeElementAnimScalarDurationMs.toFixed(
              3
            )} simd=${wasmComputeElementAnimSimdLoopDurationMs.toFixed(
              3
            )} simd_other=${simdOtherMs.toFixed(
              3
            )} setup_other=${setupOtherMs.toFixed(
              3
            )} other=${unaccountedMs.toFixed(
              3
            )} elements=${totalElementCount} active=${activeCount}`
          );
          elementAnimProfileFrame += 1;
        }
      }

      const drawCommands = wasmState.drawCommandBuffer.getBuffer();
      const spriteOutputCount = Math.trunc(
        drawCommands[wl.DRAW_COMMAND_SPRITE_OUTPUT_COUNT_OFFSET]!
      );
      const vertexCount =
        Math.max(0, spriteOutputCount) * wl.WASM_OUTPUT_STRIDE;
      const outputSlice = wasmState.outputBuffer
        .getBuffer()
        .subarray(0, vertexCount);
      const pageIdBuffer = wasmState.texIndexBuffer.getBuffer();
      const drawCommandCount = Math.trunc(
        drawCommands[wl.DRAW_COMMAND_COMMAND_COUNT_OFFSET]!
      );
      const polylineVertexCount = Math.trunc(
        drawCommands[wl.DRAW_COMMAND_POLYLINE_VERTEX_COUNT_OFFSET]!
      );

      if (spriteOutputCount > 0) {
        let entryIndices: Int32Array | undefined;
        let entrySolveModes: Int32Array | undefined;
        let entryScreenFromDeg: InputArrayBuffer | undefined;
        let entryScreenToDeg: InputArrayBuffer | undefined;
        let entryScreenAnglesDeg: InputArrayBuffer | undefined;
        let entryRotateDeg: InputArrayBuffer | undefined;
        let entryFinalRotateDeg: InputArrayBuffer | undefined;
        let entryRotationFromDeg: InputArrayBuffer | undefined;
        let entryRotationToDeg: InputArrayBuffer | undefined;
        let entryRotationDurationMs: InputArrayBuffer | undefined;
        let entryFinalRotationFromDeg: InputArrayBuffer | undefined;
        let entryFinalRotationToDeg: InputArrayBuffer | undefined;
        let entryFinalRotationDurationMs: InputArrayBuffer | undefined;
        if (rotationLogEntriesEnabled) {
          ensureEntryDebugBuffers(spriteOutputCount);
          if (
            wasmState.entryIndexBuffer &&
            wasmState.entrySolveModeBuffer &&
            wasmState.entryScreenAngleBuffer &&
            wasmState.entryScreenFromBuffer &&
            wasmState.entryScreenToBuffer &&
            wasmState.entryRotateDegBuffer &&
            wasmState.entryFinalRotateDegBuffer &&
            wasmState.entryRotationFromBuffer &&
            wasmState.entryRotationToBuffer &&
            wasmState.entryRotationDurationBuffer &&
            wasmState.entryFinalRotationFromBuffer &&
            wasmState.entryFinalRotationToBuffer &&
            wasmState.entryFinalRotationDurationBuffer
          ) {
            const debugCount = wasmState.exports.get_entry_debug(
              wasmState.contextPtr,
              wasmState.entryIndexBuffer.ptr,
              wasmState.entrySolveModeBuffer.ptr,
              wasmState.entryScreenFromBuffer.ptr,
              wasmState.entryScreenToBuffer.ptr,
              wasmState.entryScreenAngleBuffer.ptr,
              wasmState.entryRotateDegBuffer.ptr,
              wasmState.entryFinalRotateDegBuffer.ptr,
              wasmState.entryRotationFromBuffer.ptr,
              wasmState.entryRotationToBuffer.ptr,
              wasmState.entryRotationDurationBuffer.ptr,
              wasmState.entryFinalRotationFromBuffer.ptr,
              wasmState.entryFinalRotationToBuffer.ptr,
              wasmState.entryFinalRotationDurationBuffer.ptr,
              spriteOutputCount
            );
            if (debugCount > 0) {
              entryIndices = entryIndexBuffer;
              entrySolveModes = entrySolveModeBuffer;
              entryScreenFromDeg = entryScreenFromBuffer;
              entryScreenToDeg = entryScreenToBuffer;
              entryScreenAnglesDeg = entryScreenAngleBuffer;
              entryRotateDeg = entryRotateDegBuffer;
              entryFinalRotateDeg = entryFinalRotateDegBuffer;
              entryRotationFromDeg = entryRotationFromBuffer;
              entryRotationToDeg = entryRotationToBuffer;
              entryRotationDurationMs = entryRotationDurationBuffer;
              entryFinalRotationFromDeg = entryFinalRotationFromBuffer;
              entryFinalRotationToDeg = entryFinalRotationToBuffer;
              entryFinalRotationDurationMs = entryFinalRotationDurationBuffer;
            }
          }
        }

        // ---------------------------------------------------------------
        // Short circuit for rotation log output
        if (rotationLogEnabled) {
          let viewMatrix: Float32Array | undefined;
          let rotateDeg = Number.NaN;
          let finalRotateDeg = Number.NaN;
          let rotationFromDeg = Number.NaN;
          let rotationToDeg = Number.NaN;
          let rotationStartMs = Number.NaN;
          let rotationDurationMs = Number.NaN;
          let rotationT = Number.NaN;
          let rotationTEased = Number.NaN;
          let rotationDeltaDeg = Number.NaN;
          let finalRotationFromDeg = Number.NaN;
          let finalRotationToDeg = Number.NaN;
          let finalRotationStartMs = Number.NaN;
          let finalRotationDurationMs = Number.NaN;
          let finalRotationT = Number.NaN;
          let finalRotationTEased = Number.NaN;
          let finalRotationDeltaDeg = Number.NaN;
          let renderMode = Number.NaN;

          if (spriteElementCounts.length > 0) {
            viewMatrix = getViewMatrixUploadBuffer();
            const elementCount = spriteElementCounts[0]!;
            if (elementCount > 0) {
              ensureStateBuffers(elementCount);
              const ok = wasmState.exports.get_sprite_state(
                wasmState.contextPtr,
                0,
                wasmState.stateSpriteBuffer.ptr,
                wasmState.stateSpriteBuffer.count,
                wasmState.stateElementBuffer.ptr,
                wasmState.stateElementBuffer.count,
                nowMs
              );
              if (ok) {
                const base = 0;
                rotateDeg =
                  stateElementBuffer[
                    base + wl.STATE_ELEMENT_ROTATION_VALUE_OFFSET
                  ]!;
                finalRotateDeg =
                  stateElementBuffer[
                    base + wl.STATE_ELEMENT_ROTATION_FINAL_DEG_OFFSET
                  ]!;
                rotationFromDeg =
                  stateElementBuffer[
                    base + wl.STATE_ELEMENT_ROTATION_FROM_OFFSET
                  ]!;
                rotationToDeg =
                  stateElementBuffer[
                    base + wl.STATE_ELEMENT_ROTATION_TO_OFFSET
                  ]!;
                rotationStartMs =
                  stateElementBuffer[
                    base + wl.STATE_ELEMENT_ROTATION_START_TIMESTAMP_OFFSET
                  ]!;
                rotationDurationMs =
                  stateElementBuffer[
                    base + wl.STATE_ELEMENT_ROTATION_DURATION_OFFSET
                  ]!;
                rotationT =
                  stateElementBuffer[
                    base + wl.STATE_ELEMENT_ROTATION_T_OFFSET
                  ]!;
                rotationTEased =
                  stateElementBuffer[
                    base + wl.STATE_ELEMENT_ROTATION_T_EASED_OFFSET
                  ]!;
                rotationDeltaDeg =
                  stateElementBuffer[
                    base + wl.STATE_ELEMENT_ROTATION_DELTA_DEG_OFFSET
                  ]!;
                finalRotationFromDeg =
                  stateElementBuffer[
                    base + wl.STATE_ELEMENT_FINAL_ROTATION_FROM_OFFSET
                  ]!;
                finalRotationToDeg =
                  stateElementBuffer[
                    base + wl.STATE_ELEMENT_FINAL_ROTATION_TO_OFFSET
                  ]!;
                finalRotationStartMs =
                  stateElementBuffer[
                    base +
                      wl.STATE_ELEMENT_FINAL_ROTATION_START_TIMESTAMP_OFFSET
                  ]!;
                finalRotationDurationMs =
                  stateElementBuffer[
                    base + wl.STATE_ELEMENT_FINAL_ROTATION_DURATION_OFFSET
                  ]!;
                finalRotationT =
                  stateElementBuffer[
                    base + wl.STATE_ELEMENT_FINAL_ROTATION_T_OFFSET
                  ]!;
                finalRotationTEased =
                  stateElementBuffer[
                    base + wl.STATE_ELEMENT_FINAL_ROTATION_T_EASED_OFFSET
                  ]!;
                finalRotationDeltaDeg =
                  stateElementBuffer[
                    base + wl.STATE_ELEMENT_FINAL_ROTATION_DELTA_DEG_OFFSET
                  ]!;
                renderMode =
                  stateElementBuffer[
                    base + wl.STATE_ELEMENT_RENDER_MODE_OFFSET
                  ]!;
              }
            }
          }
          const viewProjection = getViewProjectionUploadBuffer();
          rotationLogger({
            viewProjection,
            ...(viewMatrix ? { viewMatrix } : {}),
            vertices: outputSlice,
            nowMs,
            ...(rotationLogAspectRatio !== undefined
              ? { aspectRatio: rotationLogAspectRatio }
              : {}),
            renderMode,
            rotateDeg,
            finalRotateDeg,
            rotationFromDeg,
            rotationToDeg,
            rotationStartMs,
            rotationDurationMs,
            rotationT,
            rotationTEased,
            rotationDeltaDeg,
            finalRotationFromDeg,
            finalRotationToDeg,
            finalRotationStartMs,
            finalRotationDurationMs,
            finalRotationT,
            finalRotationTEased,
            finalRotationDeltaDeg,
            entryCount: spriteOutputCount,
            entryStride: wl.WASM_OUTPUT_STRIDE,
            texIndices: pageIdBuffer,
            ...(entryIndices ? { entryIndices } : {}),
            ...(entrySolveModes ? { entrySolveModes } : {}),
            ...(entryScreenFromDeg ? { entryScreenFromDeg } : {}),
            ...(entryScreenToDeg ? { entryScreenToDeg } : {}),
            ...(entryScreenAnglesDeg ? { entryScreenAnglesDeg } : {}),
            ...(entryRotateDeg ? { entryRotateDeg } : {}),
            ...(entryFinalRotateDeg ? { entryFinalRotateDeg } : {}),
            ...(entryRotationFromDeg ? { entryRotationFromDeg } : {}),
            ...(entryRotationToDeg ? { entryRotationToDeg } : {}),
            ...(entryRotationDurationMs ? { entryRotationDurationMs } : {}),
            ...(entryFinalRotationFromDeg ? { entryFinalRotationFromDeg } : {}),
            ...(entryFinalRotationToDeg ? { entryFinalRotationToDeg } : {}),
            ...(entryFinalRotationDurationMs
              ? { entryFinalRotationDurationMs }
              : {}),
          });
        }
      }

      if (drawHandler && drawCommandCount > 0) {
        const polylineOutputSlice = wasmState.polylineOutputBuffer
          .getBuffer()
          .subarray(0, polylineVertexCount * POLYLINE_FLOATS_PER_VERTEX);
        drawHandler(
          {
            spriteOutput: outputSlice,
            spriteCount: Math.max(0, spriteOutputCount),
            polylineOutput: polylineOutputSlice,
            drawCommands,
          },
          drawStats
        );
        skippedDrawCount = drawStats.skippedDrawCount;
      }
    }
    if (!hasSprites && !hasPolylines) {
      lastComputeOutputValid = false;
    }

    const renderEndMs = getNowMs();
    pushPerformanceSample({
      timestampMs: renderEndMs,
      spriteRenderDurationMs: Math.max(0, renderEndMs - renderStartMs),
      cameraTrackingDurationMs,
      wasmComputeDurationMs,
      wasmComputeInternalDurationMs,
      wasmComputeProjectionDurationMs,
      wasmComputeSpriteAnimationDurationMs,
      wasmComputeElementAnimationDurationMs,
      wasmComputePivotResolveDurationMs,
      wasmComputeAutoRotationDurationMs,
      wasmComputeCollectEntriesDurationMs,
      wasmComputeSortEntriesDurationMs,
      wasmComputeWriteOutputDurationMs,
      commandApplyDurationMs,
      commandApplyCallDurationMs,
      commandApplyJsDurationMs,
      commandApplyWasmDurationMs,
      commandApplyWasmLoopDurationMs,
      commandApplyWasmSyncSlotsDurationMs,
      commandApplyWasmClearDurationMs,
      drawSetupDurationMs: drawStats.drawSetupDurationMs,
      ensureRenderBuffersDurationMs,
      vertexUploadDurationMs: drawStats.vertexUploadDurationMs,
      drawLoopDurationMs: drawStats.drawLoopDurationMs,
      commandCount: commandCountSample,
      updateSpriteCommandCount,
      updateFrameCount,
      updateQueueDelayMs,
      activeElementCount: Math.max(0, activeCount),
      drawCallCount: Math.max(0, drawStats.drawCallCount),
      textureBindCount: Math.max(0, drawStats.textureBindCount),
      skippedDrawCount: Math.max(0, skippedDrawCount),
      textureBindDurationMs: Math.max(0, drawStats.textureBindDurationMs),
      opacityUniformDurationMs: Math.max(0, drawStats.opacityUniformDurationMs),
      drawCallDurationMs: Math.max(0, drawStats.drawCallDurationMs),
    });

    return renderStartMs;
  };

  const attachWebGL = (gl: WebGLRenderingContext) => {
    if (!gl) {
      throw new Error('WebGL context is required.');
    }
    if (renderContext) {
      throw new Error('WebGL context is already attached.');
    }
    textureManager.attachWebGL(gl);
    const spriteProgram = createSpriteProgram(gl);
    const polylineProgram = createPolylineProgram(gl);

    const spriteBuffer = gl.createBuffer();
    if (!spriteBuffer) {
      throw new Error('Failed to create vertex buffer.');
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, spriteBuffer);

    const indexBuffer = gl.createBuffer();
    if (!indexBuffer) {
      throw new Error('Failed to create index buffer.');
    }

    const indexBufferSpriteCapacityRaw = RENDER_MAX_SPRITES_PER_BATCH;
    const indexBufferSpriteCapacity = Math.min(
      Math.max(1, Math.floor(indexBufferSpriteCapacityRaw)),
      RENDER_MAX_SPRITES_PER_BATCH
    );
    const indexCount = indexBufferSpriteCapacity * RENDER_INDICES_PER_SPRITE;
    const indexData = new Uint16Array(indexCount);
    for (let index = 0; index < indexBufferSpriteCapacity; index += 1) {
      const base = index * RENDER_VERTICES_PER_SPRITE;
      const offset = index * RENDER_INDICES_PER_SPRITE;
      indexData[offset + 0] = base;
      indexData[offset + 1] = base + 1;
      indexData[offset + 2] = base + 2;
      indexData[offset + 3] = base + 2;
      indexData[offset + 4] = base + 1;
      indexData[offset + 5] = base + 3;
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, indexBuffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indexData, gl.STATIC_DRAW);

    const polylineBuffer = gl.createBuffer();
    if (!polylineBuffer) {
      throw new Error('Failed to create polyline buffer.');
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, polylineBuffer);

    renderContext = {
      gl,
      sprite: {
        ...spriteProgram,
        buffer: spriteBuffer,
        indexBuffer,
        indexBufferSpriteCapacity,
      },
      polyline: {
        ...polylineProgram,
        buffer: polylineBuffer,
      },
    };
  };

  const render = () => {
    if (!renderContext) {
      return undefined;
    }
    return computeFrame(drawFrame);
  };

  const hasAnimationFrame =
    typeof globalThis.requestAnimationFrame === 'function' &&
    typeof globalThis.cancelAnimationFrame === 'function';
  let initializeScopeDepth = 0;
  let initializeScopeRunning = false;
  let initializeScopeTimerId: number | ReturnType<typeof setTimeout> | null =
    null;
  let initializeScopeError: unknown = null;

  const stopInitializeScopeLoop = () => {
    initializeScopeRunning = false;
    if (initializeScopeTimerId === null) {
      return;
    }
    if (hasAnimationFrame) {
      globalThis.cancelAnimationFrame(initializeScopeTimerId as number);
    } else {
      clearTimeout(initializeScopeTimerId as ReturnType<typeof setTimeout>);
    }
    initializeScopeTimerId = null;
  };

  const runInitializeScopeFrame = () => {
    if (!initializeScopeRunning) {
      return;
    }
    try {
      computeFrame(null);
    } catch (error) {
      initializeScopeError = error;
      stopInitializeScopeLoop();
      return;
    }
    if (initializeScopeRunning) {
      if (hasAnimationFrame) {
        initializeScopeTimerId = globalThis.requestAnimationFrame(
          runInitializeScopeFrame
        );
      } else {
        initializeScopeTimerId = setTimeout(runInitializeScopeFrame, 16);
      }
    }
  };

  const initializeScope = async (body: () => Promise<void>): Promise<void> => {
    if (typeof body !== 'function') {
      throw new Error('Initialize scope handler is required.');
    }
    initializeScopeDepth += 1;
    if (initializeScopeDepth === 1) {
      initializeScopeError = null;
      initializeScopeRunning = true;
      if (hasAnimationFrame) {
        initializeScopeTimerId = globalThis.requestAnimationFrame(
          runInitializeScopeFrame
        );
      } else {
        initializeScopeTimerId = setTimeout(runInitializeScopeFrame, 16);
      }
    }
    let bodyError: unknown = null;
    try {
      await body();
    } catch (error) {
      bodyError = error;
    } finally {
      initializeScopeDepth = Math.max(0, initializeScopeDepth - 1);
      if (initializeScopeDepth === 0) {
        stopInitializeScopeLoop();
      }
    }
    if (bodyError) {
      throw bodyError;
    }
    if (initializeScopeError) {
      throw initializeScopeError;
    }
  };

  const release = () => {
    if (isReleased) {
      return;
    }
    isReleased = true;
    commandPumpScheduled = false;
    initializeScopeDepth = 0;
    initializeScopeError = new Error('Renderer has been released.');
    stopInitializeScopeLoop();
    rejectPendingCommands('Renderer has been released.');
    resetCommandBuffer();
    if (cameraStateChangeTimerId !== null) {
      clearTimeout(cameraStateChangeTimerId);
      cameraStateChangeTimerId = null;
    }
    pendingCameraStateChange = false;
    pendingCameraStateChangeSource = undefined;
    pendingCameraStateChangeUpdate = undefined;
    cameraStateChangeListeners.clear();
    cameraTrackingState = null;
    spriteTrackingSnapshots.clear();
    if (renderContext) {
      const { gl, sprite, polyline } = renderContext;
      gl.deleteBuffer(sprite.buffer);
      gl.deleteBuffer(sprite.indexBuffer);
      gl.deleteProgram(sprite.program);
      gl.deleteShader(sprite.vertexShader);
      gl.deleteShader(sprite.fragmentShader);
      gl.deleteBuffer(polyline.buffer);
      gl.deleteProgram(polyline.program);
      gl.deleteShader(polyline.vertexShader);
      gl.deleteShader(polyline.fragmentShader);
      renderContext = null;
    }
    textureManager.release();
    spriteElementCounts.length = 0;
    spriteLeaderlineFlags.length = 0;
    spriteLeaderlineCounts.length = 0;
    spriteBorderFlags.length = 0;
    spriteBorderCounts.length = 0;
    polylineNodeCounts.length = 0;
    polylineRenderOptions.length = 0;
    spriteIdMap.reset();
    polylineIdMap.reset();
    totalElementCount = 0;
    totalLeaderlineCount = 0;
    totalBorderCount = 0;
    totalPolylineNodeCount = 0;
    resetPerformanceSnapshot();
    wasmState.release();
  };

  queueUpdateCamera(
    {
      position: { x: { value: 0 }, y: { value: 0 }, z: { value: 0 } },
      rotation: {
        yaw: { value: 0 },
        pitch: { value: 0 },
        roll: { value: 0 },
      },
      fovY: { value: wl.COMMON_DEFAULT_CAMERA_FOV_Y },
      near: wl.COMMON_DEFAULT_CAMERA_NEAR,
      far: wl.COMMON_DEFAULT_CAMERA_FAR,
      aspectRatio: computeAspectRatio(initialViewPortSize),
    },
    null
  );

  return {
    getPerformanceSnapshot,
    resetPerformanceSnapshot,
    attachWebGL,
    getMaxAtlasSize,
    allocateAtlas,
    releaseAtlas,
    registerImage,
    registerTextGlyph,
    unregisterImage,
    addSprite,
    addSprites,
    updateSprite,
    updateSprites,
    getSpriteState,
    addPolyline,
    addPolylines,
    updatePolyline,
    updatePolylines,
    getPolylineState,
    pickAt,
    getCameraState,
    viewportToWorldOnPlane,
    projectWorldToViewport,
    removeSprite,
    removeSprites,
    removePolyline,
    removePolylines,
    updateCamera,
    adjustCameraPosition,
    setViewPortSize,
    setCameraTracking,
    clearCameraTracking,
    getCameraTrackingState,
    render,
    onCameraStateChange,
    initializeScope,
    release,
    [Symbol.dispose]: release,
  };
};
