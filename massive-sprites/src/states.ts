// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  ObjectCameraState,
  PositionInPixel,
  PolylineState,
  ObjectWorldPosition,
  SpriteElementRenderMode,
  ObjectInterpolationEasing,
  ObjectInterpolationParameter,
  SpriteState,
  SpriteStateAutoDirection,
  ObjectStateValue,
  WasmInputPrecision,
} from './types';
import type { Releaseable } from './types';
import {
  createWasmMemory,
  type WasmArrayConstructor,
  type WasmMemory,
  type WasmSpriteExports,
} from './wasm';
import { formatColorRGBA } from './utils';
import * as wl from './generated/wasm-layout.generated';
import * as cl from './generated/command-layout.generated';

///////////////////////////////////////////////////////////////////////////////////

const INITIAL_WASM_OUTPUT_CAPACITY = 8;
const INITIAL_WASM_TEXINDEX_CAPACITY = INITIAL_WASM_OUTPUT_CAPACITY;
const INITIAL_WASM_POLYLINE_OUTPUT_CAPACITY = 16;
const INITIAL_DRAW_COMMAND_CAPACITY = 32;
const INITIAL_COMMAND_BUFFER_CAPACITY = 256;
const INITIAL_RESULT_BUFFER_CAPACITY = 128;
const INITIAL_WASM_PICK_RESULT_CAPACITY = 4;
const INITIAL_PICK_MASK_PAGE_TABLE_CAPACITY = 4;
const INITIAL_PICK_MASK_WORD_CAPACITY = 4;

/**
 * Number of scalar values in a 4x4 view/projection matrix.
 */
export const VIEW_MATRIX_SIZE = 16;

/**
 * Numeric array types used for WASM input/output buffers.
 */
export type InputArrayBuffer = Float32Array | Float64Array;

/**
 * Resolves the numeric array constructor for the configured WASM precision.
 * @param precision - Target WASM input precision.
 * @returns Typed-array constructor for the precision.
 */
export const resolveInputArrayType = (
  precision: WasmInputPrecision
): WasmArrayConstructor<InputArrayBuffer> =>
  precision === 'f64'
    ? (Float64Array as unknown as WasmArrayConstructor<InputArrayBuffer>)
    : (Float32Array as unknown as WasmArrayConstructor<InputArrayBuffer>);

///////////////////////////////////////////////////////////////////////////////////

type EasingMode = 'in' | 'out' | 'in-out';

const EASING_MODE_IN = 1 as const;
const EASING_MODE_OUT = 2 as const;
const POLYLINE_CORRECTION_FAN = wl.POLYLINE_CORRECTION_MODE_FAN;
const AUTO_DIRECTION_MODE_ROTATION = wl.AUTO_DIRECTION_MODE_ROTATION;
const AUTO_DIRECTION_MODE_FLIPPING = wl.AUTO_DIRECTION_MODE_FLIPPING;
const AUTO_DIRECTION_SPACE_PARENT_LOCAL = wl.AUTO_DIRECTION_SPACE_PARENT_LOCAL;

const decodeAutoDirectionSpace = (
  raw: number
): SpriteStateAutoDirection['space'] =>
  raw === AUTO_DIRECTION_SPACE_PARENT_LOCAL ? 'parent_local' : 'world';

const decodeInterpolationMode = (
  mode: number
): ObjectInterpolationParameter['mode'] =>
  mode === wl.INTERPOLATION_MODE_FEEDFORWARD ? 'feedforward' : 'feedback';

const decodeEasingMode = (mode: number): EasingMode => {
  if (mode === EASING_MODE_IN) {
    return 'in';
  }
  if (mode === EASING_MODE_OUT) {
    return 'out';
  }
  return 'in-out';
};

const decodePolylineJoinCorrection = (
  mode: number,
  intermediatePointCount: number
): PolylineState['joinCorrection'] =>
  mode === POLYLINE_CORRECTION_FAN
    ? {
        type: 'fan',
        intermediatePointCount: Math.max(0, Math.trunc(intermediatePointCount)),
      }
    : { type: 'none' };

const decodePolylineCapCorrection = (
  mode: number,
  pointCount: number
): PolylineState['capCorrection'] =>
  mode === POLYLINE_CORRECTION_FAN
    ? {
        type: 'fan',
        pointCount: Math.max(1, Math.trunc(pointCount)),
      }
    : { type: 'none' };

const decodeInterpolationEasing = (
  type: number,
  param0: number,
  param1: number
): ObjectInterpolationEasing => {
  switch (type) {
    case wl.INTERPOLATION_EASING_SIGMOID:
      return { type: 'sigmoid', k: param0, mid: param1 };
    case wl.INTERPOLATION_EASING_EASE:
      return { type: 'ease', power: param0, mode: decodeEasingMode(param1) };
    case wl.INTERPOLATION_EASING_EXPONENTIAL:
      return {
        type: 'exponential',
        exponent: param0,
        mode: decodeEasingMode(param1),
      };
    case wl.INTERPOLATION_EASING_QUADRATIC:
      return { type: 'quadratic', mode: decodeEasingMode(param0) };
    case wl.INTERPOLATION_EASING_CUBIC:
      return { type: 'cubic', mode: decodeEasingMode(param0) };
    case wl.INTERPOLATION_EASING_SINE:
      return {
        type: 'sine',
        mode: decodeEasingMode(param0),
        amplitude: param1,
      };
    case wl.INTERPOLATION_EASING_BOUNCE:
      return { type: 'bounce', bounces: param0, decay: param1 };
    case wl.INTERPOLATION_EASING_BACK:
      return { type: 'back', overshoot: param0 };
    case wl.INTERPOLATION_EASING_LINEAR:
    default:
      return { type: 'linear' };
  }
};

const parseCommandIndex = (value: number) =>
  Number.isFinite(value) ? Math.trunc(value) : Number.NaN;

const readStateValue = (
  buffer: InputArrayBuffer,
  baseOffset: number,
  offsets: {
    value: number;
    hasInterpolation: number;
    from: number;
    to: number;
    mode: number;
    duration: number;
    easing: number;
    param0: number;
    param1: number;
  }
): ObjectStateValue<number> => {
  const value = buffer[baseOffset + offsets.value]!;
  const hasInterpolation = buffer[baseOffset + offsets.hasInterpolation] !== 0;
  if (!hasInterpolation) {
    return { value, interpolation: undefined };
  }
  const fromValue = buffer[baseOffset + offsets.from]!;
  const toValue = buffer[baseOffset + offsets.to]!;
  const mode = buffer[baseOffset + offsets.mode]!;
  const durationMs = buffer[baseOffset + offsets.duration]!;
  const easingType = buffer[baseOffset + offsets.easing]!;
  const param0 = buffer[baseOffset + offsets.param0]!;
  const param1 = buffer[baseOffset + offsets.param1]!;
  return {
    value,
    interpolation: {
      fromValue,
      toValue,
      mode: decodeInterpolationMode(mode),
      durationMs,
      easing: decodeInterpolationEasing(easingType, param0, param1),
    },
  };
};

const readStateAutoDirection = (
  buffer: InputArrayBuffer,
  baseOffset: number
): SpriteStateAutoDirection => {
  const space = decodeAutoDirectionSpace(
    buffer[baseOffset + wl.STATE_ELEMENT_AUTO_DIRECTION_SPACE_OFFSET]!
  );
  const modeRaw =
    buffer[baseOffset + wl.STATE_ELEMENT_AUTO_DIRECTION_MODE_OFFSET]!;
  const shiftAngleRotation =
    buffer[
      baseOffset + wl.STATE_ELEMENT_AUTO_DIRECTION_SHIFT_ANGLE_ROTATION_OFFSET
    ] !== 0;
  const minDistance =
    buffer[baseOffset + wl.STATE_ELEMENT_AUTO_DIRECTION_MIN_DISTANCE_OFFSET]!;
  const directionDeg =
    buffer[baseOffset + wl.STATE_ELEMENT_AUTO_DIRECTION_DIRECTION_DEG_OFFSET]!;
  const finalRotateDeg =
    buffer[baseOffset + wl.STATE_ELEMENT_ROTATION_FINAL_DEG_OFFSET]!;
  const finalShiftAngleDeg =
    buffer[baseOffset + wl.STATE_ELEMENT_SHIFT_ANGLE_FINAL_DEG_OFFSET]!;
  if (modeRaw === AUTO_DIRECTION_MODE_FLIPPING) {
    const hasInterpolation =
      buffer[baseOffset + wl.STATE_ELEMENT_AUTO_DIRECTION_INTERP_HAS_OFFSET] !==
      0;
    const interpMode =
      buffer[baseOffset + wl.STATE_ELEMENT_AUTO_DIRECTION_INTERP_MODE_OFFSET]!;
    const interpDuration =
      buffer[
        baseOffset + wl.STATE_ELEMENT_AUTO_DIRECTION_INTERP_DURATION_OFFSET
      ]!;
    const interpEasing =
      buffer[
        baseOffset + wl.STATE_ELEMENT_AUTO_DIRECTION_INTERP_EASING_OFFSET
      ]!;
    const interpParam0 =
      buffer[
        baseOffset + wl.STATE_ELEMENT_AUTO_DIRECTION_INTERP_PARAM0_OFFSET
      ]!;
    const interpParam1 =
      buffer[
        baseOffset + wl.STATE_ELEMENT_AUTO_DIRECTION_INTERP_PARAM1_OFFSET
      ]!;
    const toCommandValue = (value: number): 1 | -1 => (value < 0 ? -1 : 1);
    return {
      space,
      mode: {
        type: 'flipping',
        flipX: {
          enabled:
            buffer[
              baseOffset + wl.STATE_ELEMENT_AUTO_DIRECTION_FLIP_X_ENABLED_OFFSET
            ] !== 0,
          commandValue: toCommandValue(
            buffer[
              baseOffset +
                wl.STATE_ELEMENT_AUTO_DIRECTION_FLIP_X_COMMAND_VALUE_OFFSET
            ]!
          ),
          value:
            buffer[
              baseOffset + wl.STATE_ELEMENT_AUTO_DIRECTION_FLIP_X_VALUE_OFFSET
            ]!,
        },
        flipY: {
          enabled:
            buffer[
              baseOffset + wl.STATE_ELEMENT_AUTO_DIRECTION_FLIP_Y_ENABLED_OFFSET
            ] !== 0,
          commandValue: toCommandValue(
            buffer[
              baseOffset +
                wl.STATE_ELEMENT_AUTO_DIRECTION_FLIP_Y_COMMAND_VALUE_OFFSET
            ]!
          ),
          value:
            buffer[
              baseOffset + wl.STATE_ELEMENT_AUTO_DIRECTION_FLIP_Y_VALUE_OFFSET
            ]!,
        },
        interpolation: hasInterpolation
          ? {
              mode: decodeInterpolationMode(interpMode),
              durationMs: interpDuration,
              easing: decodeInterpolationEasing(
                interpEasing,
                interpParam0,
                interpParam1
              ),
            }
          : undefined,
      },
      shiftAngleRotation,
      minDistance,
      directionDeg,
      finalRotateDeg,
      finalShiftAngleDeg,
    };
  }
  if (modeRaw === AUTO_DIRECTION_MODE_ROTATION) {
    return {
      space,
      mode: { type: 'rotation' },
      shiftAngleRotation,
      minDistance,
      directionDeg,
      finalRotateDeg,
      finalShiftAngleDeg,
    };
  }
  return {
    space,
    mode: undefined,
    shiftAngleRotation,
    minDistance,
    directionDeg,
    finalRotateDeg,
    finalShiftAngleDeg,
  };
};

///////////////////////////////////////////////////////////////////////////////////

/**
 * Aggregated WASM buffers and context handles used by the renderer.
 */
export interface WasmState extends Releaseable {
  /** Input precision bound to the current WASM context. */
  readonly precision: WasmInputPrecision;
  /** Precision-specific WASM exports. */
  readonly exports: WasmSpriteExports;
  /** Opaque WASM context pointer. */
  contextPtr: number;
  /** Command input buffer shared with WASM. */
  readonly commandBuffer: WasmMemory<InputArrayBuffer>;
  /** Result buffer used for command responses. */
  readonly resultBuffer: WasmMemory<InputArrayBuffer>;
  /** WASM apply-statistics buffer. */
  readonly applyStatsBuffer: WasmMemory<InputArrayBuffer>;
  /** WASM compute-statistics buffer. */
  readonly computeStatsBuffer: WasmMemory<InputArrayBuffer>;
  /** Atlas-page pick-mask metadata table shared with WASM. */
  readonly pickMaskPageTableBuffer: WasmMemory<Int32Array>;
  /** Atlas-page pick-mask bitset storage shared with WASM. */
  readonly pickMaskWordBuffer: WasmMemory<Int32Array>;
  /** Sprite state query buffer. */
  readonly stateSpriteBuffer: WasmMemory<InputArrayBuffer>;
  /** Dense sprite-slot buffer used when syncing camera tracking to WASM. */
  readonly trackingSpriteIdsBuffer: WasmMemory<Int32Array>;
  /** Sprite element state query buffer. */
  readonly stateElementBuffer: WasmMemory<InputArrayBuffer>;
  /** Polyline state query buffer. */
  readonly statePolylineBuffer: WasmMemory<InputArrayBuffer>;
  /** Polyline node state query buffer. */
  readonly statePolylineNodeBuffer: WasmMemory<InputArrayBuffer>;
  /** Camera state query buffer. */
  readonly cameraBuffer: WasmMemory<InputArrayBuffer>;
  /** Output buffer for screen-to-world queries. */
  readonly screenToWorldBuffer: WasmMemory<InputArrayBuffer>;
  /** Temporary camera buffer used by screen-to-world queries with override state. */
  readonly screenToWorldCameraBuffer: WasmMemory<InputArrayBuffer>;
  /** Output buffer for world-to-screen projection queries. */
  readonly projectWorldBuffer: WasmMemory<InputArrayBuffer>;
  /** Output buffer for picking queries. */
  readonly pickResultBuffer: WasmMemory<InputArrayBuffer>;
  /** Sprite vertex output buffer. */
  readonly outputBuffer: WasmMemory<Float32Array>;
  /** Texture index output buffer aligned with sprite vertices. */
  readonly texIndexBuffer: WasmMemory<Int32Array>;
  /** Polyline vertex output buffer. */
  readonly polylineOutputBuffer: WasmMemory<Float32Array>;
  /** Draw-command buffer returned by WASM. */
  readonly drawCommandBuffer: WasmMemory<Int32Array>;
  /** View matrix buffer passed to WASM. */
  readonly viewMatrixBuffer: WasmMemory<InputArrayBuffer>;
  /** View-projection matrix buffer passed to WASM. */
  readonly viewProjectionBuffer: WasmMemory<InputArrayBuffer>;
  /** Optional entry index debug buffer. */
  entryIndexBuffer?: WasmMemory<Int32Array>;
  /** Optional entry solve-mode debug buffer. */
  entrySolveModeBuffer?: WasmMemory<Int32Array>;
  /** Optional debug buffer for entry screen-from angles. */
  entryScreenFromBuffer?: WasmMemory<InputArrayBuffer>;
  /** Optional debug buffer for entry screen-to angles. */
  entryScreenToBuffer?: WasmMemory<InputArrayBuffer>;
  /** Optional debug buffer for resolved entry screen angles. */
  entryScreenAngleBuffer?: WasmMemory<InputArrayBuffer>;
  /** Optional debug buffer for entry rotation values. */
  entryRotateDegBuffer?: WasmMemory<InputArrayBuffer>;
  /** Optional debug buffer for entry final rotation values. */
  entryFinalRotateDegBuffer?: WasmMemory<InputArrayBuffer>;
  /** Optional debug buffer for entry rotation start values. */
  entryRotationFromBuffer?: WasmMemory<InputArrayBuffer>;
  /** Optional debug buffer for entry rotation target values. */
  entryRotationToBuffer?: WasmMemory<InputArrayBuffer>;
  /** Optional debug buffer for entry rotation durations. */
  entryRotationDurationBuffer?: WasmMemory<InputArrayBuffer>;
  /** Optional debug buffer for entry final-rotation start values. */
  entryFinalRotationFromBuffer?: WasmMemory<InputArrayBuffer>;
  /** Optional debug buffer for entry final-rotation target values. */
  entryFinalRotationToBuffer?: WasmMemory<InputArrayBuffer>;
  /** Optional debug buffer for entry final-rotation durations. */
  entryFinalRotationDurationBuffer?: WasmMemory<InputArrayBuffer>;
}

/**
 * Creates the WASM state object and allocates its initial buffers.
 * @param exports - Precision-specific WASM exports.
 * @param precision - Input precision used by the renderer.
 * @returns Initialized WASM state.
 */
export const createWasmState = (
  exports: WasmSpriteExports,
  precision: WasmInputPrecision
): WasmState => {
  const InputArrayType = resolveInputArrayType(precision);
  const contextPtr = exports.create_context();
  if (!contextPtr) {
    throw new Error('Could not create WASM compute context.');
  }
  let wasmState: WasmState = undefined!;
  const release = () => {
    if (wasmState.contextPtr === 0) {
      return;
    }
    wasmState.entryFinalRotationDurationBuffer?.release();
    wasmState.entryFinalRotationToBuffer?.release();
    wasmState.entryFinalRotationFromBuffer?.release();
    wasmState.entryRotationDurationBuffer?.release();
    wasmState.entryRotationToBuffer?.release();
    wasmState.entryRotationFromBuffer?.release();
    wasmState.entryFinalRotateDegBuffer?.release();
    wasmState.entryRotateDegBuffer?.release();
    wasmState.entryScreenToBuffer?.release();
    wasmState.entryScreenFromBuffer?.release();
    wasmState.entryScreenAngleBuffer?.release();
    wasmState.entrySolveModeBuffer?.release();
    wasmState.entryIndexBuffer?.release();
    wasmState.viewProjectionBuffer.release();
    wasmState.viewMatrixBuffer.release();
    wasmState.pickMaskWordBuffer.release();
    wasmState.pickMaskPageTableBuffer.release();
    wasmState.texIndexBuffer.release();
    wasmState.outputBuffer.release();
    wasmState.drawCommandBuffer.release();
    wasmState.polylineOutputBuffer.release();
    wasmState.cameraBuffer.release();
    wasmState.screenToWorldBuffer.release();
    wasmState.screenToWorldCameraBuffer.release();
    wasmState.projectWorldBuffer.release();
    wasmState.pickResultBuffer.release();
    wasmState.statePolylineNodeBuffer.release();
    wasmState.statePolylineBuffer.release();
    wasmState.stateElementBuffer.release();
    wasmState.trackingSpriteIdsBuffer.release();
    wasmState.stateSpriteBuffer.release();
    wasmState.resultBuffer.release();
    wasmState.commandBuffer.release();
    wasmState.applyStatsBuffer.release();
    wasmState.computeStatsBuffer.release();
    exports.release_context(wasmState.contextPtr);
    wasmState.contextPtr = 0;
  };
  wasmState = {
    precision,
    exports,
    contextPtr,
    release,
    [Symbol.dispose]: release,
    commandBuffer: createWasmMemory(
      exports,
      INITIAL_COMMAND_BUFFER_CAPACITY,
      InputArrayType
    ),
    resultBuffer: createWasmMemory(
      exports,
      INITIAL_RESULT_BUFFER_CAPACITY,
      InputArrayType
    ),
    applyStatsBuffer: createWasmMemory(
      exports,
      wl.APPLY_STATS_FIELDS,
      InputArrayType
    ),
    computeStatsBuffer: createWasmMemory(
      exports,
      wl.COMPUTE_STATS_FIELDS,
      InputArrayType
    ),
    pickMaskPageTableBuffer: createWasmMemory(
      exports,
      INITIAL_PICK_MASK_PAGE_TABLE_CAPACITY,
      Int32Array
    ),
    pickMaskWordBuffer: createWasmMemory(
      exports,
      INITIAL_PICK_MASK_WORD_CAPACITY,
      Int32Array
    ),
    stateSpriteBuffer: createWasmMemory(
      exports,
      wl.WASM_STATE_SPRITE_STRIDE,
      InputArrayType
    ),
    trackingSpriteIdsBuffer: createWasmMemory(exports, 1, Int32Array),
    stateElementBuffer: createWasmMemory(
      exports,
      Math.max(1, wl.WASM_MAX_ELEMENTS_PER_SPRITE) *
        wl.WASM_STATE_ELEMENT_STRIDE,
      InputArrayType
    ),
    statePolylineBuffer: createWasmMemory(
      exports,
      wl.WASM_STATE_POLYLINE_STRIDE,
      InputArrayType
    ),
    statePolylineNodeBuffer: createWasmMemory(
      exports,
      Math.max(1, wl.WASM_POLYLINE_NODE_INPUT_FIELDS),
      InputArrayType
    ),
    cameraBuffer: createWasmMemory(
      exports,
      wl.CAMERA_BUFFER_SIZE,
      InputArrayType
    ),
    screenToWorldBuffer: createWasmMemory(exports, 2, InputArrayType),
    screenToWorldCameraBuffer: createWasmMemory(
      exports,
      wl.CAMERA_BUFFER_SIZE,
      InputArrayType
    ),
    projectWorldBuffer: createWasmMemory(exports, 2, InputArrayType),
    pickResultBuffer: createWasmMemory(
      exports,
      INITIAL_WASM_PICK_RESULT_CAPACITY,
      InputArrayType
    ),
    outputBuffer: createWasmMemory(
      exports,
      INITIAL_WASM_OUTPUT_CAPACITY * wl.WASM_OUTPUT_STRIDE,
      Float32Array
    ),
    texIndexBuffer: createWasmMemory(
      exports,
      INITIAL_WASM_TEXINDEX_CAPACITY,
      Int32Array
    ),
    polylineOutputBuffer: createWasmMemory(
      exports,
      INITIAL_WASM_POLYLINE_OUTPUT_CAPACITY * wl.POLYLINE_OUTPUT_STRIDE,
      Float32Array
    ),
    drawCommandBuffer: createWasmMemory(
      exports,
      wl.DRAW_COMMAND_HEADER_FIELDS +
        INITIAL_DRAW_COMMAND_CAPACITY * wl.DRAW_COMMAND_FIELDS,
      Int32Array
    ),
    viewMatrixBuffer: createWasmMemory(
      exports,
      VIEW_MATRIX_SIZE,
      InputArrayType
    ),
    viewProjectionBuffer: createWasmMemory(
      exports,
      VIEW_MATRIX_SIZE,
      InputArrayType
    ),
  };

  if (
    !exports.set_command_buffer(
      wasmState.contextPtr,
      wasmState.commandBuffer.ptr,
      wasmState.commandBuffer.count
    )
  ) {
    throw new Error('Failed to set command buffer.');
  }
  if (
    !exports.set_result_buffer(
      wasmState.contextPtr,
      wasmState.resultBuffer.ptr,
      wasmState.resultBuffer.count
    )
  ) {
    throw new Error('Failed to set result buffer.');
  }
  if (
    !exports.set_apply_stats_buffer(
      wasmState.contextPtr,
      wasmState.applyStatsBuffer.ptr,
      wasmState.applyStatsBuffer.count
    )
  ) {
    throw new Error('Failed to set apply stats buffer.');
  }
  if (
    !exports.set_compute_stats_buffer(
      wasmState.contextPtr,
      wasmState.computeStatsBuffer.ptr,
      wasmState.computeStatsBuffer.count
    )
  ) {
    throw new Error('Failed to set compute stats buffer.');
  }
  if (
    !exports.set_pick_mask_page_table_buffer(
      wasmState.contextPtr,
      wasmState.pickMaskPageTableBuffer.ptr,
      wasmState.pickMaskPageTableBuffer.count
    )
  ) {
    throw new Error('Failed to set pick mask page-table buffer.');
  }
  if (
    !exports.set_pick_mask_word_buffer(
      wasmState.contextPtr,
      wasmState.pickMaskWordBuffer.ptr,
      wasmState.pickMaskWordBuffer.count
    )
  ) {
    throw new Error('Failed to set pick mask word buffer.');
  }

  const commandBuffer = wasmState.commandBuffer.getBuffer();
  commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] =
    cl.COMMAND_BUFFER_HEADER_FIELDS;
  commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = 0;

  return wasmState;
};

///////////////////////////////////////////////////////////////////////////////////

/**
 * Mutable views into the current WASM state buffers.
 */
export interface WasmStateBufferAccess {
  /** Current command buffer view. */
  commandBuffer: InputArrayBuffer;
  /** Current command buffer capacity. */
  commandBufferCapacity: number;
  /** Current result buffer view. */
  resultBuffer: InputArrayBuffer;
  /** Current result buffer capacity. */
  resultBufferCapacity: number;
  /** Current apply-statistics buffer view. */
  applyStatsBuffer: InputArrayBuffer;
  /** Current compute-statistics buffer view. */
  computeStatsBuffer: InputArrayBuffer;
  /** Current sprite state buffer view. */
  stateSpriteBuffer: InputArrayBuffer;
  /** Current sprite state buffer capacity. */
  stateSpriteBufferCapacity: number;
  /** Current sprite element state buffer view. */
  stateElementBuffer: InputArrayBuffer;
  /** Current sprite element state buffer capacity. */
  stateElementBufferCapacity: number;
  /** Current polyline state buffer view. */
  statePolylineBuffer: InputArrayBuffer;
  /** Current polyline state buffer capacity. */
  statePolylineBufferCapacity: number;
  /** Current polyline node state buffer view. */
  statePolylineNodeBuffer: InputArrayBuffer;
  /** Current polyline node state buffer capacity. */
  statePolylineNodeBufferCapacity: number;
  /** Current camera state buffer view. */
  cameraBuffer: InputArrayBuffer;
  /** Current sprite output capacity in element units. */
  outputCapacity: number;
  /** Current texture-index capacity in element units. */
  texIndexCapacity: number;
  /** Current polyline output capacity in vertex units. */
  polylineOutputCapacity: number;
  /** Current draw-command capacity in command units. */
  drawCommandCapacity: number;
  /** Current debug buffer for entry indices. */
  entryIndexBuffer: Int32Array | undefined;
  /** Current debug buffer for entry solve modes. */
  entrySolveModeBuffer: Int32Array | undefined;
  /** Current debug buffer for entry screen-from angles. */
  entryScreenFromBuffer: InputArrayBuffer | undefined;
  /** Current debug buffer for entry screen-to angles. */
  entryScreenToBuffer: InputArrayBuffer | undefined;
  /** Current debug buffer for entry resolved screen angles. */
  entryScreenAngleBuffer: InputArrayBuffer | undefined;
  /** Current debug buffer for entry rotation values. */
  entryRotateDegBuffer: InputArrayBuffer | undefined;
  /** Current debug buffer for entry final rotation values. */
  entryFinalRotateDegBuffer: InputArrayBuffer | undefined;
  /** Current debug buffer for entry rotation start values. */
  entryRotationFromBuffer: InputArrayBuffer | undefined;
  /** Current debug buffer for entry rotation target values. */
  entryRotationToBuffer: InputArrayBuffer | undefined;
  /** Current debug buffer for entry rotation durations. */
  entryRotationDurationBuffer: InputArrayBuffer | undefined;
  /** Current debug buffer for entry final-rotation start values. */
  entryFinalRotationFromBuffer: InputArrayBuffer | undefined;
  /** Current debug buffer for entry final-rotation target values. */
  entryFinalRotationToBuffer: InputArrayBuffer | undefined;
  /** Current debug buffer for entry final-rotation durations. */
  entryFinalRotationDurationBuffer: InputArrayBuffer | undefined;
}

/**
 * Ensures the command buffer can hold the requested command data.
 * @param wasmState - WASM state.
 * @param buffers - Mutable buffer views.
 * @param required - Required command buffer length.
 * @param commandUsed - Number of buffer slots already used.
 * @param commandCount - Number of queued commands.
 * @param recordWasmBufferResize - Callback used to record resize events.
 */
export const ensureCommandCapacity = (
  wasmState: WasmState,
  buffers: WasmStateBufferAccess,
  required: number,
  commandUsed: number,
  commandCount: number,
  recordWasmBufferResize: (resizeCount: number) => void
): void => {
  if (required <= buffers.commandBufferCapacity) {
    return;
  }
  const oldCapacity = buffers.commandBufferCapacity;
  const growCount = required - buffers.commandBufferCapacity;
  wasmState.commandBuffer.expand(buffers.commandBufferCapacity, growCount, 0);
  buffers.commandBuffer = wasmState.commandBuffer.getBuffer();
  buffers.commandBufferCapacity = wasmState.commandBuffer.count;
  if (
    !wasmState.exports.set_command_buffer(
      wasmState.contextPtr,
      wasmState.commandBuffer.ptr,
      wasmState.commandBuffer.count
    )
  ) {
    throw new Error('Failed to update command buffer.');
  }
  buffers.commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] = commandUsed;
  buffers.commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = commandCount;
  if (buffers.commandBufferCapacity !== oldCapacity) {
    recordWasmBufferResize(1);
  }
};

/**
 * Ensures the result buffer can hold the requested result data.
 * @param wasmState - WASM state.
 * @param buffers - Mutable buffer views.
 * @param required - Required result buffer length.
 * @param recordWasmBufferResize - Callback used to record resize events.
 */
export const ensureResultCapacity = (
  wasmState: WasmState,
  buffers: WasmStateBufferAccess,
  required: number,
  recordWasmBufferResize: (resizeCount: number) => void
): void => {
  if (required <= buffers.resultBufferCapacity) {
    buffers.resultBuffer = wasmState.resultBuffer.getBuffer();
    buffers.resultBufferCapacity = wasmState.resultBuffer.count;
    return;
  }
  const oldCapacity = buffers.resultBufferCapacity;
  const growCount = required - buffers.resultBufferCapacity;
  wasmState.resultBuffer.expand(buffers.resultBufferCapacity, growCount, 0);
  buffers.resultBuffer = wasmState.resultBuffer.getBuffer();
  buffers.resultBufferCapacity = wasmState.resultBuffer.count;
  if (
    !wasmState.exports.set_result_buffer(
      wasmState.contextPtr,
      wasmState.resultBuffer.ptr,
      wasmState.resultBuffer.count
    )
  ) {
    throw new Error('Failed to update result buffer.');
  }
  if (buffers.resultBufferCapacity !== oldCapacity) {
    recordWasmBufferResize(1);
  }
};

/**
 * Ensures sprite output buffers can hold the requested element count.
 * @param wasmState - WASM state.
 * @param buffers - Mutable buffer views.
 * @param requiredElementCount - Required sprite element count.
 * @param recordWasmBufferResize - Callback used to record resize events.
 */
export const ensureRenderBuffers = (
  wasmState: WasmState,
  buffers: WasmStateBufferAccess,
  requiredElementCount: number,
  recordWasmBufferResize: (resizeCount: number) => void
): void => {
  let resizeCount = 0;
  if (requiredElementCount > buffers.outputCapacity) {
    const oldCapacity = buffers.outputCapacity;
    const requiredOutputCount = requiredElementCount * wl.WASM_OUTPUT_STRIDE;
    if (requiredOutputCount > wasmState.outputBuffer.count) {
      const diff = requiredOutputCount - wasmState.outputBuffer.count;
      wasmState.outputBuffer.expand(wasmState.outputBuffer.count, diff, 0);
    }
    buffers.outputCapacity = Math.floor(
      wasmState.outputBuffer.count / wl.WASM_OUTPUT_STRIDE
    );
    if (buffers.outputCapacity !== oldCapacity) {
      resizeCount += 1;
    }
  } else {
    wasmState.outputBuffer.getBuffer();
  }

  if (requiredElementCount > buffers.texIndexCapacity) {
    const oldCapacity = buffers.texIndexCapacity;
    if (requiredElementCount > wasmState.texIndexBuffer.count) {
      const diff = requiredElementCount - wasmState.texIndexBuffer.count;
      wasmState.texIndexBuffer.expand(wasmState.texIndexBuffer.count, diff, 0);
    }
    buffers.texIndexCapacity = wasmState.texIndexBuffer.count;
    if (buffers.texIndexCapacity !== oldCapacity) {
      resizeCount += 1;
    }
  } else {
    wasmState.texIndexBuffer.getBuffer();
  }

  recordWasmBufferResize(resizeCount);
};

/**
 * Ensures polyline output and draw-command buffers can hold the requested data.
 * @param wasmState - WASM state.
 * @param buffers - Mutable buffer views.
 * @param requiredVertexCount - Required polyline vertex count.
 * @param requiredCommandCount - Required draw-command count.
 * @param recordWasmBufferResize - Callback used to record resize events.
 */
export const ensurePolylineBuffers = (
  wasmState: WasmState,
  buffers: WasmStateBufferAccess,
  requiredVertexCount: number,
  requiredCommandCount: number,
  recordWasmBufferResize: (resizeCount: number) => void
): void => {
  let resizeCount = 0;
  if (requiredVertexCount > buffers.polylineOutputCapacity) {
    const oldCapacity = buffers.polylineOutputCapacity;
    const requiredOutputCount = requiredVertexCount * wl.POLYLINE_OUTPUT_STRIDE;
    if (requiredOutputCount > wasmState.polylineOutputBuffer.count) {
      const diff = requiredOutputCount - wasmState.polylineOutputBuffer.count;
      wasmState.polylineOutputBuffer.expand(
        wasmState.polylineOutputBuffer.count,
        diff,
        0
      );
    }
    buffers.polylineOutputCapacity = Math.floor(
      wasmState.polylineOutputBuffer.count / wl.POLYLINE_OUTPUT_STRIDE
    );
    if (buffers.polylineOutputCapacity !== oldCapacity) {
      resizeCount += 1;
    }
  } else {
    wasmState.polylineOutputBuffer.getBuffer();
  }

  const requiredCommands = Math.max(0, requiredCommandCount);
  const requiredCommandInts =
    wl.DRAW_COMMAND_HEADER_FIELDS + requiredCommands * wl.DRAW_COMMAND_FIELDS;
  if (requiredCommandInts > wasmState.drawCommandBuffer.count) {
    const oldCapacity = buffers.drawCommandCapacity;
    const diff = requiredCommandInts - wasmState.drawCommandBuffer.count;
    wasmState.drawCommandBuffer.expand(
      wasmState.drawCommandBuffer.count,
      diff,
      0
    );
    buffers.drawCommandCapacity = Math.max(
      0,
      Math.floor(
        (wasmState.drawCommandBuffer.count - wl.DRAW_COMMAND_HEADER_FIELDS) /
          wl.DRAW_COMMAND_FIELDS
      )
    );
    if (buffers.drawCommandCapacity !== oldCapacity) {
      resizeCount += 1;
    }
  } else {
    wasmState.drawCommandBuffer.getBuffer();
    buffers.drawCommandCapacity = Math.max(
      0,
      Math.floor(
        (wasmState.drawCommandBuffer.count - wl.DRAW_COMMAND_HEADER_FIELDS) /
          wl.DRAW_COMMAND_FIELDS
      )
    );
  }

  recordWasmBufferResize(resizeCount);
};

/**
 * Ensures entry-debug buffers are allocated for the requested count.
 * @param wasmState - WASM state.
 * @param buffers - Mutable buffer views.
 * @param requiredCount - Required debug entry count.
 * @param inputArrayType - Typed-array constructor for the current precision.
 * @param recordWasmBufferResize - Callback used to record resize events.
 */
export const ensureEntryDebugBuffers = (
  wasmState: WasmState,
  buffers: WasmStateBufferAccess,
  requiredCount: number,
  inputArrayType: WasmArrayConstructor<InputArrayBuffer>,
  recordWasmBufferResize: (resizeCount: number) => void
): void => {
  if (!wasmState.entryIndexBuffer) {
    wasmState.entryIndexBuffer = createWasmMemory(
      wasmState.exports,
      requiredCount,
      Int32Array
    );
    recordWasmBufferResize(1);
  } else if (requiredCount > wasmState.entryIndexBuffer.count) {
    const diff = requiredCount - wasmState.entryIndexBuffer.count;
    wasmState.entryIndexBuffer.expand(
      wasmState.entryIndexBuffer.count,
      diff,
      0
    );
    recordWasmBufferResize(1);
  }
  buffers.entryIndexBuffer = wasmState.entryIndexBuffer.getBuffer();

  if (!wasmState.entrySolveModeBuffer) {
    wasmState.entrySolveModeBuffer = createWasmMemory(
      wasmState.exports,
      requiredCount,
      Int32Array
    );
    recordWasmBufferResize(1);
  } else if (requiredCount > wasmState.entrySolveModeBuffer.count) {
    const diff = requiredCount - wasmState.entrySolveModeBuffer.count;
    wasmState.entrySolveModeBuffer.expand(
      wasmState.entrySolveModeBuffer.count,
      diff,
      0
    );
    recordWasmBufferResize(1);
  }
  buffers.entrySolveModeBuffer = wasmState.entrySolveModeBuffer.getBuffer();

  if (!wasmState.entryScreenAngleBuffer) {
    wasmState.entryScreenAngleBuffer = createWasmMemory(
      wasmState.exports,
      requiredCount,
      inputArrayType
    );
    recordWasmBufferResize(1);
  } else if (requiredCount > wasmState.entryScreenAngleBuffer.count) {
    const diff = requiredCount - wasmState.entryScreenAngleBuffer.count;
    wasmState.entryScreenAngleBuffer.expand(
      wasmState.entryScreenAngleBuffer.count,
      diff,
      0
    );
    recordWasmBufferResize(1);
  }
  buffers.entryScreenAngleBuffer = wasmState.entryScreenAngleBuffer.getBuffer();

  if (!wasmState.entryScreenFromBuffer) {
    wasmState.entryScreenFromBuffer = createWasmMemory(
      wasmState.exports,
      requiredCount,
      inputArrayType
    );
    recordWasmBufferResize(1);
  } else if (requiredCount > wasmState.entryScreenFromBuffer.count) {
    const diff = requiredCount - wasmState.entryScreenFromBuffer.count;
    wasmState.entryScreenFromBuffer.expand(
      wasmState.entryScreenFromBuffer.count,
      diff,
      0
    );
    recordWasmBufferResize(1);
  }
  buffers.entryScreenFromBuffer = wasmState.entryScreenFromBuffer.getBuffer();

  if (!wasmState.entryScreenToBuffer) {
    wasmState.entryScreenToBuffer = createWasmMemory(
      wasmState.exports,
      requiredCount,
      inputArrayType
    );
    recordWasmBufferResize(1);
  } else if (requiredCount > wasmState.entryScreenToBuffer.count) {
    const diff = requiredCount - wasmState.entryScreenToBuffer.count;
    wasmState.entryScreenToBuffer.expand(
      wasmState.entryScreenToBuffer.count,
      diff,
      0
    );
    recordWasmBufferResize(1);
  }
  buffers.entryScreenToBuffer = wasmState.entryScreenToBuffer.getBuffer();

  if (!wasmState.entryRotateDegBuffer) {
    wasmState.entryRotateDegBuffer = createWasmMemory(
      wasmState.exports,
      requiredCount,
      inputArrayType
    );
    recordWasmBufferResize(1);
  } else if (requiredCount > wasmState.entryRotateDegBuffer.count) {
    const diff = requiredCount - wasmState.entryRotateDegBuffer.count;
    wasmState.entryRotateDegBuffer.expand(
      wasmState.entryRotateDegBuffer.count,
      diff,
      0
    );
    recordWasmBufferResize(1);
  }
  buffers.entryRotateDegBuffer = wasmState.entryRotateDegBuffer.getBuffer();

  if (!wasmState.entryFinalRotateDegBuffer) {
    wasmState.entryFinalRotateDegBuffer = createWasmMemory(
      wasmState.exports,
      requiredCount,
      inputArrayType
    );
    recordWasmBufferResize(1);
  } else if (requiredCount > wasmState.entryFinalRotateDegBuffer.count) {
    const diff = requiredCount - wasmState.entryFinalRotateDegBuffer.count;
    wasmState.entryFinalRotateDegBuffer.expand(
      wasmState.entryFinalRotateDegBuffer.count,
      diff,
      0
    );
    recordWasmBufferResize(1);
  }
  buffers.entryFinalRotateDegBuffer =
    wasmState.entryFinalRotateDegBuffer.getBuffer();

  if (!wasmState.entryRotationFromBuffer) {
    wasmState.entryRotationFromBuffer = createWasmMemory(
      wasmState.exports,
      requiredCount,
      inputArrayType
    );
    recordWasmBufferResize(1);
  } else if (requiredCount > wasmState.entryRotationFromBuffer.count) {
    const diff = requiredCount - wasmState.entryRotationFromBuffer.count;
    wasmState.entryRotationFromBuffer.expand(
      wasmState.entryRotationFromBuffer.count,
      diff,
      0
    );
    recordWasmBufferResize(1);
  }
  buffers.entryRotationFromBuffer =
    wasmState.entryRotationFromBuffer.getBuffer();

  if (!wasmState.entryRotationToBuffer) {
    wasmState.entryRotationToBuffer = createWasmMemory(
      wasmState.exports,
      requiredCount,
      inputArrayType
    );
    recordWasmBufferResize(1);
  } else if (requiredCount > wasmState.entryRotationToBuffer.count) {
    const diff = requiredCount - wasmState.entryRotationToBuffer.count;
    wasmState.entryRotationToBuffer.expand(
      wasmState.entryRotationToBuffer.count,
      diff,
      0
    );
    recordWasmBufferResize(1);
  }
  buffers.entryRotationToBuffer = wasmState.entryRotationToBuffer.getBuffer();

  if (!wasmState.entryRotationDurationBuffer) {
    wasmState.entryRotationDurationBuffer = createWasmMemory(
      wasmState.exports,
      requiredCount,
      inputArrayType
    );
    recordWasmBufferResize(1);
  } else if (requiredCount > wasmState.entryRotationDurationBuffer.count) {
    const diff = requiredCount - wasmState.entryRotationDurationBuffer.count;
    wasmState.entryRotationDurationBuffer.expand(
      wasmState.entryRotationDurationBuffer.count,
      diff,
      0
    );
    recordWasmBufferResize(1);
  }
  buffers.entryRotationDurationBuffer =
    wasmState.entryRotationDurationBuffer.getBuffer();

  if (!wasmState.entryFinalRotationFromBuffer) {
    wasmState.entryFinalRotationFromBuffer = createWasmMemory(
      wasmState.exports,
      requiredCount,
      inputArrayType
    );
    recordWasmBufferResize(1);
  } else if (requiredCount > wasmState.entryFinalRotationFromBuffer.count) {
    const diff = requiredCount - wasmState.entryFinalRotationFromBuffer.count;
    wasmState.entryFinalRotationFromBuffer.expand(
      wasmState.entryFinalRotationFromBuffer.count,
      diff,
      0
    );
    recordWasmBufferResize(1);
  }
  buffers.entryFinalRotationFromBuffer =
    wasmState.entryFinalRotationFromBuffer.getBuffer();

  if (!wasmState.entryFinalRotationToBuffer) {
    wasmState.entryFinalRotationToBuffer = createWasmMemory(
      wasmState.exports,
      requiredCount,
      inputArrayType
    );
    recordWasmBufferResize(1);
  } else if (requiredCount > wasmState.entryFinalRotationToBuffer.count) {
    const diff = requiredCount - wasmState.entryFinalRotationToBuffer.count;
    wasmState.entryFinalRotationToBuffer.expand(
      wasmState.entryFinalRotationToBuffer.count,
      diff,
      0
    );
    recordWasmBufferResize(1);
  }
  buffers.entryFinalRotationToBuffer =
    wasmState.entryFinalRotationToBuffer.getBuffer();

  if (!wasmState.entryFinalRotationDurationBuffer) {
    wasmState.entryFinalRotationDurationBuffer = createWasmMemory(
      wasmState.exports,
      requiredCount,
      inputArrayType
    );
    recordWasmBufferResize(1);
  } else if (requiredCount > wasmState.entryFinalRotationDurationBuffer.count) {
    const diff =
      requiredCount - wasmState.entryFinalRotationDurationBuffer.count;
    wasmState.entryFinalRotationDurationBuffer.expand(
      wasmState.entryFinalRotationDurationBuffer.count,
      diff,
      0
    );
    recordWasmBufferResize(1);
  }
  buffers.entryFinalRotationDurationBuffer =
    wasmState.entryFinalRotationDurationBuffer.getBuffer();
};

/**
 * Ensures sprite state query buffers can hold the requested element count.
 * @param wasmState - WASM state.
 * @param buffers - Mutable buffer views.
 * @param requiredElementCount - Required sprite element count.
 * @param recordWasmBufferResize - Callback used to record resize events.
 */
export const ensureStateBuffers = (
  wasmState: WasmState,
  buffers: WasmStateBufferAccess,
  requiredElementCount: number,
  recordWasmBufferResize: (resizeCount: number) => void
): void => {
  if (wl.WASM_STATE_SPRITE_STRIDE > buffers.stateSpriteBufferCapacity) {
    const oldCapacity = buffers.stateSpriteBufferCapacity;
    const growCount =
      wl.WASM_STATE_SPRITE_STRIDE - buffers.stateSpriteBufferCapacity;
    wasmState.stateSpriteBuffer.expand(
      buffers.stateSpriteBufferCapacity,
      growCount,
      0
    );
    buffers.stateSpriteBuffer = wasmState.stateSpriteBuffer.getBuffer();
    buffers.stateSpriteBufferCapacity = wasmState.stateSpriteBuffer.count;
    if (buffers.stateSpriteBufferCapacity !== oldCapacity) {
      recordWasmBufferResize(1);
    }
  } else {
    buffers.stateSpriteBuffer = wasmState.stateSpriteBuffer.getBuffer();
    buffers.stateSpriteBufferCapacity = wasmState.stateSpriteBuffer.count;
  }

  const required =
    Math.max(1, requiredElementCount) * wl.WASM_STATE_ELEMENT_STRIDE;
  if (required > buffers.stateElementBufferCapacity) {
    const oldCapacity = buffers.stateElementBufferCapacity;
    const growCount = required - buffers.stateElementBufferCapacity;
    wasmState.stateElementBuffer.expand(
      buffers.stateElementBufferCapacity,
      growCount,
      0
    );
    buffers.stateElementBuffer = wasmState.stateElementBuffer.getBuffer();
    buffers.stateElementBufferCapacity = wasmState.stateElementBuffer.count;
    if (buffers.stateElementBufferCapacity !== oldCapacity) {
      recordWasmBufferResize(1);
    }
  } else {
    buffers.stateElementBuffer = wasmState.stateElementBuffer.getBuffer();
    buffers.stateElementBufferCapacity = wasmState.stateElementBuffer.count;
  }
};

/**
 * Ensures polyline state query buffers can hold the requested node count.
 * @param wasmState - WASM state.
 * @param buffers - Mutable buffer views.
 * @param requiredNodeCount - Required polyline node count.
 * @param recordWasmBufferResize - Callback used to record resize events.
 */
export const ensurePolylineStateBuffers = (
  wasmState: WasmState,
  buffers: WasmStateBufferAccess,
  requiredNodeCount: number,
  recordWasmBufferResize: (resizeCount: number) => void
): void => {
  if (wl.WASM_STATE_POLYLINE_STRIDE > buffers.statePolylineBufferCapacity) {
    const oldCapacity = buffers.statePolylineBufferCapacity;
    const growCount =
      wl.WASM_STATE_POLYLINE_STRIDE - buffers.statePolylineBufferCapacity;
    wasmState.statePolylineBuffer.expand(
      buffers.statePolylineBufferCapacity,
      growCount,
      0
    );
    buffers.statePolylineBuffer = wasmState.statePolylineBuffer.getBuffer();
    buffers.statePolylineBufferCapacity = wasmState.statePolylineBuffer.count;
    if (buffers.statePolylineBufferCapacity !== oldCapacity) {
      recordWasmBufferResize(1);
    }
  } else {
    buffers.statePolylineBuffer = wasmState.statePolylineBuffer.getBuffer();
    buffers.statePolylineBufferCapacity = wasmState.statePolylineBuffer.count;
  }

  const required =
    Math.max(1, requiredNodeCount) * wl.WASM_POLYLINE_NODE_INPUT_FIELDS;
  if (required > buffers.statePolylineNodeBufferCapacity) {
    const oldCapacity = buffers.statePolylineNodeBufferCapacity;
    const growCount = required - buffers.statePolylineNodeBufferCapacity;
    wasmState.statePolylineNodeBuffer.expand(
      buffers.statePolylineNodeBufferCapacity,
      growCount,
      0
    );
    buffers.statePolylineNodeBuffer =
      wasmState.statePolylineNodeBuffer.getBuffer();
    buffers.statePolylineNodeBufferCapacity =
      wasmState.statePolylineNodeBuffer.count;
    if (buffers.statePolylineNodeBufferCapacity !== oldCapacity) {
      recordWasmBufferResize(1);
    }
  } else {
    buffers.statePolylineNodeBuffer =
      wasmState.statePolylineNodeBuffer.getBuffer();
    buffers.statePolylineNodeBufferCapacity =
      wasmState.statePolylineNodeBuffer.count;
  }
};

/**
 * Reads the camera state buffer from WASM and returns the refreshed typed array.
 * @param wasmState - WASM state.
 * @param buffers - Mutable buffer views.
 * @returns Refreshed camera state buffer view.
 */
export const readCameraStateBuffer = (
  wasmState: WasmState,
  buffers: WasmStateBufferAccess
) => {
  const ok = wasmState.exports.get_camera_state(
    wasmState.contextPtr,
    wasmState.cameraBuffer.ptr,
    wasmState.cameraBuffer.count
  );
  if (!ok) {
    throw new Error('Failed to read camera state.');
  }
  buffers.cameraBuffer = wasmState.cameraBuffer.getBuffer();
  return buffers.cameraBuffer;
};

///////////////////////////////////////////////////////////////////////////////////

interface SpriteStateReadOptions {
  readonly wasmState: WasmState;
  readonly buffers: WasmStateBufferAccess;
  readonly spriteIndex: number;
  readonly elementCount: number;
  readonly timestampMs: number | undefined;
  readonly resolveImageIdByTexIndex: (texIndex: number) => string | undefined;
  readonly recordWasmBufferResize: (resizeCount: number) => void;
}

const sxOffsets = {
  value: wl.STATE_SPRITE_SX_VALUE_OFFSET,
  hasInterpolation: wl.STATE_SPRITE_SX_HAS_INTERPOLATION_OFFSET,
  from: wl.STATE_SPRITE_SX_FROM_OFFSET,
  to: wl.STATE_SPRITE_SX_TO_OFFSET,
  mode: wl.STATE_SPRITE_SX_MODE_OFFSET,
  duration: wl.STATE_SPRITE_SX_DURATION_OFFSET,
  easing: wl.STATE_SPRITE_SX_EASING_OFFSET,
  param0: wl.STATE_SPRITE_SX_EASING_PARAM0_OFFSET,
  param1: wl.STATE_SPRITE_SX_EASING_PARAM1_OFFSET,
} as const;

const syOffsets = {
  value: wl.STATE_SPRITE_SY_VALUE_OFFSET,
  hasInterpolation: wl.STATE_SPRITE_SY_HAS_INTERPOLATION_OFFSET,
  from: wl.STATE_SPRITE_SY_FROM_OFFSET,
  to: wl.STATE_SPRITE_SY_TO_OFFSET,
  mode: wl.STATE_SPRITE_SY_MODE_OFFSET,
  duration: wl.STATE_SPRITE_SY_DURATION_OFFSET,
  easing: wl.STATE_SPRITE_SY_EASING_OFFSET,
  param0: wl.STATE_SPRITE_SY_EASING_PARAM0_OFFSET,
  param1: wl.STATE_SPRITE_SY_EASING_PARAM1_OFFSET,
} as const;

const spriteOpacityOffsets = {
  value: wl.STATE_SPRITE_OPACITY_VALUE_OFFSET,
  hasInterpolation: wl.STATE_SPRITE_OPACITY_HAS_INTERPOLATION_OFFSET,
  from: wl.STATE_SPRITE_OPACITY_FROM_OFFSET,
  to: wl.STATE_SPRITE_OPACITY_TO_OFFSET,
  mode: wl.STATE_SPRITE_OPACITY_MODE_OFFSET,
  duration: wl.STATE_SPRITE_OPACITY_DURATION_OFFSET,
  easing: wl.STATE_SPRITE_OPACITY_EASING_OFFSET,
  param0: wl.STATE_SPRITE_OPACITY_EASING_PARAM0_OFFSET,
  param1: wl.STATE_SPRITE_OPACITY_EASING_PARAM1_OFFSET,
} as const;

const shiftDistanceOffsets = {
  value: wl.STATE_ELEMENT_SHIFT_DISTANCE_VALUE_OFFSET,
  hasInterpolation: wl.STATE_ELEMENT_SHIFT_DISTANCE_HAS_INTERPOLATION_OFFSET,
  from: wl.STATE_ELEMENT_SHIFT_DISTANCE_FROM_OFFSET,
  to: wl.STATE_ELEMENT_SHIFT_DISTANCE_TO_OFFSET,
  mode: wl.STATE_ELEMENT_SHIFT_DISTANCE_MODE_OFFSET,
  duration: wl.STATE_ELEMENT_SHIFT_DISTANCE_DURATION_OFFSET,
  easing: wl.STATE_ELEMENT_SHIFT_DISTANCE_EASING_OFFSET,
  param0: wl.STATE_ELEMENT_SHIFT_DISTANCE_EASING_PARAM0_OFFSET,
  param1: wl.STATE_ELEMENT_SHIFT_DISTANCE_EASING_PARAM1_OFFSET,
} as const;

const shiftAngleDegOffsets = {
  value: wl.STATE_ELEMENT_SHIFT_ANGLE_DEG_VALUE_OFFSET,
  hasInterpolation: wl.STATE_ELEMENT_SHIFT_ANGLE_DEG_HAS_INTERPOLATION_OFFSET,
  from: wl.STATE_ELEMENT_SHIFT_ANGLE_DEG_FROM_OFFSET,
  to: wl.STATE_ELEMENT_SHIFT_ANGLE_DEG_TO_OFFSET,
  mode: wl.STATE_ELEMENT_SHIFT_ANGLE_DEG_MODE_OFFSET,
  duration: wl.STATE_ELEMENT_SHIFT_ANGLE_DEG_DURATION_OFFSET,
  easing: wl.STATE_ELEMENT_SHIFT_ANGLE_DEG_EASING_OFFSET,
  param0: wl.STATE_ELEMENT_SHIFT_ANGLE_DEG_EASING_PARAM0_OFFSET,
  param1: wl.STATE_ELEMENT_SHIFT_ANGLE_DEG_EASING_PARAM1_OFFSET,
} as const;

const scaleOffsets = {
  value: wl.STATE_ELEMENT_SCALE_VALUE_OFFSET,
  hasInterpolation: wl.STATE_ELEMENT_SCALE_HAS_INTERPOLATION_OFFSET,
  from: wl.STATE_ELEMENT_SCALE_FROM_OFFSET,
  to: wl.STATE_ELEMENT_SCALE_TO_OFFSET,
  mode: wl.STATE_ELEMENT_SCALE_MODE_OFFSET,
  duration: wl.STATE_ELEMENT_SCALE_DURATION_OFFSET,
  easing: wl.STATE_ELEMENT_SCALE_EASING_OFFSET,
  param0: wl.STATE_ELEMENT_SCALE_EASING_PARAM0_OFFSET,
  param1: wl.STATE_ELEMENT_SCALE_EASING_PARAM1_OFFSET,
} as const;

const opacityOffsets = {
  value: wl.STATE_ELEMENT_OPACITY_VALUE_OFFSET,
  hasInterpolation: wl.STATE_ELEMENT_OPACITY_HAS_INTERPOLATION_OFFSET,
  from: wl.STATE_ELEMENT_OPACITY_FROM_OFFSET,
  to: wl.STATE_ELEMENT_OPACITY_TO_OFFSET,
  mode: wl.STATE_ELEMENT_OPACITY_MODE_OFFSET,
  duration: wl.STATE_ELEMENT_OPACITY_DURATION_OFFSET,
  easing: wl.STATE_ELEMENT_OPACITY_EASING_OFFSET,
  param0: wl.STATE_ELEMENT_OPACITY_EASING_PARAM0_OFFSET,
  param1: wl.STATE_ELEMENT_OPACITY_EASING_PARAM1_OFFSET,
} as const;

const leaderlineWidthOffsets = {
  value: wl.STATE_ELEMENT_LEADERLINE_WIDTH_VALUE_OFFSET,
  hasInterpolation: wl.STATE_ELEMENT_LEADERLINE_WIDTH_HAS_INTERPOLATION_OFFSET,
  from: wl.STATE_ELEMENT_LEADERLINE_WIDTH_FROM_OFFSET,
  to: wl.STATE_ELEMENT_LEADERLINE_WIDTH_TO_OFFSET,
  mode: wl.STATE_ELEMENT_LEADERLINE_WIDTH_MODE_OFFSET,
  duration: wl.STATE_ELEMENT_LEADERLINE_WIDTH_DURATION_OFFSET,
  easing: wl.STATE_ELEMENT_LEADERLINE_WIDTH_EASING_OFFSET,
  param0: wl.STATE_ELEMENT_LEADERLINE_WIDTH_EASING_PARAM0_OFFSET,
  param1: wl.STATE_ELEMENT_LEADERLINE_WIDTH_EASING_PARAM1_OFFSET,
} as const;

const anchorXOffsets = {
  value: wl.STATE_ELEMENT_ANCHOR_X_VALUE_OFFSET,
  hasInterpolation: wl.STATE_ELEMENT_ANCHOR_X_HAS_INTERPOLATION_OFFSET,
  from: wl.STATE_ELEMENT_ANCHOR_X_FROM_OFFSET,
  to: wl.STATE_ELEMENT_ANCHOR_X_TO_OFFSET,
  mode: wl.STATE_ELEMENT_ANCHOR_X_MODE_OFFSET,
  duration: wl.STATE_ELEMENT_ANCHOR_X_DURATION_OFFSET,
  easing: wl.STATE_ELEMENT_ANCHOR_X_EASING_OFFSET,
  param0: wl.STATE_ELEMENT_ANCHOR_X_EASING_PARAM0_OFFSET,
  param1: wl.STATE_ELEMENT_ANCHOR_X_EASING_PARAM1_OFFSET,
} as const;

const anchorYOffsets = {
  value: wl.STATE_ELEMENT_ANCHOR_Y_VALUE_OFFSET,
  hasInterpolation: wl.STATE_ELEMENT_ANCHOR_Y_HAS_INTERPOLATION_OFFSET,
  from: wl.STATE_ELEMENT_ANCHOR_Y_FROM_OFFSET,
  to: wl.STATE_ELEMENT_ANCHOR_Y_TO_OFFSET,
  mode: wl.STATE_ELEMENT_ANCHOR_Y_MODE_OFFSET,
  duration: wl.STATE_ELEMENT_ANCHOR_Y_DURATION_OFFSET,
  easing: wl.STATE_ELEMENT_ANCHOR_Y_EASING_OFFSET,
  param0: wl.STATE_ELEMENT_ANCHOR_Y_EASING_PARAM0_OFFSET,
  param1: wl.STATE_ELEMENT_ANCHOR_Y_EASING_PARAM1_OFFSET,
} as const;

const rotationOffsets = {
  value: wl.STATE_ELEMENT_ROTATION_VALUE_OFFSET,
  hasInterpolation: wl.STATE_ELEMENT_ROTATION_HAS_INTERPOLATION_OFFSET,
  from: wl.STATE_ELEMENT_ROTATION_FROM_OFFSET,
  to: wl.STATE_ELEMENT_ROTATION_TO_OFFSET,
  mode: wl.STATE_ELEMENT_ROTATION_MODE_OFFSET,
  duration: wl.STATE_ELEMENT_ROTATION_DURATION_OFFSET,
  easing: wl.STATE_ELEMENT_ROTATION_EASING_OFFSET,
  param0: wl.STATE_ELEMENT_ROTATION_EASING_PARAM0_OFFSET,
  param1: wl.STATE_ELEMENT_ROTATION_EASING_PARAM1_OFFSET,
} as const;

const readSpriteStateIntoBuffers = (options: SpriteStateReadOptions) => {
  const {
    wasmState,
    buffers,
    spriteIndex,
    elementCount,
    timestampMs,
    recordWasmBufferResize,
  } = options;

  ensureStateBuffers(wasmState, buffers, elementCount, recordWasmBufferResize);
  const ok = wasmState.exports.get_sprite_state(
    wasmState.contextPtr,
    spriteIndex,
    wasmState.stateSpriteBuffer.ptr,
    wasmState.stateSpriteBuffer.count,
    wasmState.stateElementBuffer.ptr,
    wasmState.stateElementBuffer.count,
    timestampMs ?? 0
  );
  if (!ok) {
    throw new Error('Failed to read sprite state.');
  }
};

// Tracking runs before vertex compute. When a non-interpolated update has just
// been applied, `value` can still reflect the previous snapshot while `to`
// already carries the new target. Prefer `to` in that case.
const readTrackingStateValue = (
  buffer: InputArrayBuffer,
  offsets: {
    value: number;
    hasInterpolation: number;
    to: number;
  }
) => {
  const value = buffer[offsets.value]!;
  const hasInterpolation = buffer[offsets.hasInterpolation] !== 0;
  if (hasInterpolation) {
    return value;
  }
  const toValue = buffer[offsets.to]!;
  return Number.isFinite(toValue) ? toValue : value;
};

/**
 * Reads the world-space base position used by camera tracking.
 * @param options - Sprite state read options.
 * @returns Sprite base position in world coordinates.
 */
export const getSpriteTrackingPositionFromWasm = (
  options: SpriteStateReadOptions
): ObjectWorldPosition => {
  readSpriteStateIntoBuffers(options);
  const { buffers } = options;
  return {
    x: readTrackingStateValue(buffers.stateSpriteBuffer, sxOffsets),
    y: readTrackingStateValue(buffers.stateSpriteBuffer, syOffsets),
    z: buffers.stateSpriteBuffer[wl.STATE_SPRITE_SZ_OFFSET]!,
  };
};

/**
 * Reads and decodes a sprite state snapshot from WASM.
 * @param options - Sprite state read options.
 * @returns Decoded sprite state.
 */
export const getSpriteStateFromWasm = (
  options: SpriteStateReadOptions
): SpriteState => {
  const { buffers, elementCount, resolveImageIdByTexIndex } = options;

  readSpriteStateIntoBuffers(options);

  const sx = readStateValue(buffers.stateSpriteBuffer, 0, sxOffsets);
  const sy = readStateValue(buffers.stateSpriteBuffer, 0, syOffsets);
  const opacity = readStateValue(
    buffers.stateSpriteBuffer,
    0,
    spriteOpacityOffsets
  );
  const sz = buffers.stateSpriteBuffer[wl.STATE_SPRITE_SZ_OFFSET]!;
  const visibilityDistanceRaw =
    buffers.stateSpriteBuffer[wl.STATE_SPRITE_VISIBILITY_DISTANCE_OFFSET]!;
  const visibilityDistance =
    visibilityDistanceRaw > 0 ? visibilityDistanceRaw : undefined;
  const timestampMsValue =
    buffers.stateSpriteBuffer[wl.STATE_SPRITE_TIMESTAMP_MS_OFFSET] ?? 0;
  const viewportBasePosition: PositionInPixel | undefined =
    (buffers.stateSpriteBuffer[wl.STATE_SPRITE_VIEWPORT_BASE_VALID_OFFSET] ??
      0) !== 0
      ? {
          xPixel:
            buffers.stateSpriteBuffer[
              wl.STATE_SPRITE_VIEWPORT_BASE_X_PIXEL_OFFSET
            ] ?? 0,
          yPixel:
            buffers.stateSpriteBuffer[
              wl.STATE_SPRITE_VIEWPORT_BASE_Y_PIXEL_OFFSET
            ] ?? 0,
        }
      : undefined;

  const elements = Array.from({ length: elementCount }, (_, index) => {
    const base = index * wl.WASM_STATE_ELEMENT_STRIDE;
    const texIndexRaw = parseCommandIndex(
      buffers.stateElementBuffer[base + wl.STATE_ELEMENT_TEX_INDEX_OFFSET] ??
        Number.NaN
    );
    const originLocationIndexRaw = parseCommandIndex(
      buffers.stateElementBuffer[
        base + wl.STATE_ELEMENT_ORIGIN_LOCATION_INDEX_OFFSET
      ] ?? Number.NaN
    );
    const originLocationUseResolvedAnchorRaw =
      buffers.stateElementBuffer[
        base + wl.STATE_ELEMENT_ORIGIN_LOCATION_USE_RESOLVED_ANCHOR_OFFSET
      ] ?? 0;
    const imageId =
      Number.isFinite(texIndexRaw) && texIndexRaw >= 0
        ? resolveImageIdByTexIndex(texIndexRaw)
        : undefined;
    const originLocationIndex = Number.isFinite(originLocationIndexRaw)
      ? (originLocationIndexRaw as number)
      : -1;
    const originLocation = {
      index: originLocationIndex,
      useResolvedAnchor: originLocationUseResolvedAnchorRaw !== 0,
    };
    const renderModeRaw =
      buffers.stateElementBuffer[base + wl.STATE_ELEMENT_RENDER_MODE_OFFSET] ??
      wl.COMMON_RENDER_MODE_SURFACE;
    const renderMode: SpriteElementRenderMode =
      renderModeRaw === wl.COMMON_RENDER_MODE_BILLBOARD_PERSPECTIVE
        ? 'billboard_perspective'
        : renderModeRaw === wl.COMMON_RENDER_MODE_BILLBOARD
          ? 'billboard'
          : 'surface';

    return {
      imageId,
      originLocation,
      mode: renderMode,
      layer: buffers.stateElementBuffer[base + wl.STATE_ELEMENT_LAYER_OFFSET]!,
      order: buffers.stateElementBuffer[base + wl.STATE_ELEMENT_ORDER_OFFSET]!,
      shiftDistance: readStateValue(
        buffers.stateElementBuffer,
        base,
        shiftDistanceOffsets
      ),
      shiftAngleDeg: readStateValue(
        buffers.stateElementBuffer,
        base,
        shiftAngleDegOffsets
      ),
      scale: readStateValue(buffers.stateElementBuffer, base, scaleOffsets),
      opacity: readStateValue(buffers.stateElementBuffer, base, opacityOffsets),
      border:
        (buffers.stateElementBuffer[
          base + wl.STATE_ELEMENT_BORDER_WIDTH_OFFSET
        ] ?? 0) > 0
          ? {
              width:
                buffers.stateElementBuffer[
                  base + wl.STATE_ELEMENT_BORDER_WIDTH_OFFSET
                ]!,
              color: formatColorRGBA(
                buffers.stateElementBuffer[
                  base + wl.STATE_ELEMENT_BORDER_COLOR_R_OFFSET
                ]!,
                buffers.stateElementBuffer[
                  base + wl.STATE_ELEMENT_BORDER_COLOR_G_OFFSET
                ]!,
                buffers.stateElementBuffer[
                  base + wl.STATE_ELEMENT_BORDER_COLOR_B_OFFSET
                ]!,
                buffers.stateElementBuffer[
                  base + wl.STATE_ELEMENT_BORDER_COLOR_A_OFFSET
                ]!
              ),
            }
          : undefined,
      leaderline: {
        width: readStateValue(
          buffers.stateElementBuffer,
          base,
          leaderlineWidthOffsets
        ),
        color: {
          color0: formatColorRGBA(
            buffers.stateElementBuffer[
              base + wl.STATE_ELEMENT_LEADERLINE_COLOR0_R_OFFSET
            ]!,
            buffers.stateElementBuffer[
              base + wl.STATE_ELEMENT_LEADERLINE_COLOR0_G_OFFSET
            ]!,
            buffers.stateElementBuffer[
              base + wl.STATE_ELEMENT_LEADERLINE_COLOR0_B_OFFSET
            ]!,
            buffers.stateElementBuffer[
              base + wl.STATE_ELEMENT_LEADERLINE_COLOR0_A_OFFSET
            ]!
          ),
          color1: formatColorRGBA(
            buffers.stateElementBuffer[
              base + wl.STATE_ELEMENT_LEADERLINE_COLOR1_R_OFFSET
            ]!,
            buffers.stateElementBuffer[
              base + wl.STATE_ELEMENT_LEADERLINE_COLOR1_G_OFFSET
            ]!,
            buffers.stateElementBuffer[
              base + wl.STATE_ELEMENT_LEADERLINE_COLOR1_B_OFFSET
            ]!,
            buffers.stateElementBuffer[
              base + wl.STATE_ELEMENT_LEADERLINE_COLOR1_A_OFFSET
            ]!
          ),
          repeatLength:
            buffers.stateElementBuffer[
              base + wl.STATE_ELEMENT_LEADERLINE_REPEAT_LENGTH_OFFSET
            ]!,
        },
      },
      anchorX: readStateValue(buffers.stateElementBuffer, base, anchorXOffsets),
      anchorY: readStateValue(buffers.stateElementBuffer, base, anchorYOffsets),
      rotation: readStateValue(
        buffers.stateElementBuffer,
        base,
        rotationOffsets
      ),
      autoDirection: readStateAutoDirection(buffers.stateElementBuffer, base),
    };
  });

  return {
    timestampMs: timestampMsValue,
    sx,
    sy,
    sz,
    viewportBasePosition,
    opacity,
    visibilityDistance,
    elements,
  };
};

type PolylineStateReadOptions = {
  readonly wasmState: WasmState;
  readonly buffers: WasmStateBufferAccess;
  readonly polylineIndex: number;
  readonly nodeCount: number;
  readonly timestampMs: number | undefined;
  readonly recordWasmBufferResize: (resizeCount: number) => void;
};

/**
 * Reads and decodes a polyline state snapshot from WASM.
 * @param options - Polyline state read options.
 * @returns Decoded polyline state.
 */
export const getPolylineStateFromWasm = (
  options: PolylineStateReadOptions
): PolylineState => {
  const {
    wasmState,
    buffers,
    polylineIndex,
    nodeCount,
    timestampMs,
    recordWasmBufferResize,
  } = options;

  ensurePolylineStateBuffers(
    wasmState,
    buffers,
    nodeCount,
    recordWasmBufferResize
  );
  const ok = wasmState.exports.get_polyline_state(
    wasmState.contextPtr,
    polylineIndex,
    wasmState.statePolylineBuffer.ptr,
    wasmState.statePolylineBuffer.count,
    wasmState.statePolylineNodeBuffer.ptr,
    wasmState.statePolylineNodeBuffer.count,
    timestampMs ?? 0
  );
  if (!ok) {
    throw new Error('Failed to read polyline state.');
  }

  const opacity = readStateValue(buffers.statePolylineBuffer, 0, {
    value: wl.STATE_POLYLINE_OPACITY_VALUE_OFFSET,
    hasInterpolation: wl.STATE_POLYLINE_OPACITY_HAS_INTERPOLATION_OFFSET,
    from: wl.STATE_POLYLINE_OPACITY_FROM_OFFSET,
    to: wl.STATE_POLYLINE_OPACITY_TO_OFFSET,
    mode: wl.STATE_POLYLINE_OPACITY_MODE_OFFSET,
    duration: wl.STATE_POLYLINE_OPACITY_DURATION_OFFSET,
    easing: wl.STATE_POLYLINE_OPACITY_EASING_OFFSET,
    param0: wl.STATE_POLYLINE_OPACITY_EASING_PARAM0_OFFSET,
    param1: wl.STATE_POLYLINE_OPACITY_EASING_PARAM1_OFFSET,
  });

  const layer = buffers.statePolylineBuffer[wl.STATE_POLYLINE_LAYER_OFFSET]!;
  const color0 = formatColorRGBA(
    buffers.statePolylineBuffer[wl.STATE_POLYLINE_COLOR0_R_OFFSET]!,
    buffers.statePolylineBuffer[wl.STATE_POLYLINE_COLOR0_G_OFFSET]!,
    buffers.statePolylineBuffer[wl.STATE_POLYLINE_COLOR0_B_OFFSET]!,
    buffers.statePolylineBuffer[wl.STATE_POLYLINE_COLOR0_A_OFFSET]!
  );
  const color1 = formatColorRGBA(
    buffers.statePolylineBuffer[wl.STATE_POLYLINE_COLOR1_R_OFFSET]!,
    buffers.statePolylineBuffer[wl.STATE_POLYLINE_COLOR1_G_OFFSET]!,
    buffers.statePolylineBuffer[wl.STATE_POLYLINE_COLOR1_B_OFFSET]!,
    buffers.statePolylineBuffer[wl.STATE_POLYLINE_COLOR1_A_OFFSET]!
  );
  const repeatLength =
    buffers.statePolylineBuffer[wl.STATE_POLYLINE_REPEAT_LENGTH_OFFSET]!;
  const joinCorrection = decodePolylineJoinCorrection(
    buffers.statePolylineBuffer[wl.STATE_POLYLINE_JOIN_CORRECTION_MODE_OFFSET]!,
    buffers.statePolylineBuffer[
      wl.STATE_POLYLINE_JOIN_CORRECTION_INTERMEDIATE_POINT_COUNT_OFFSET
    ]!
  );
  const capCorrection = decodePolylineCapCorrection(
    buffers.statePolylineBuffer[wl.STATE_POLYLINE_CAP_CORRECTION_MODE_OFFSET]!,
    buffers.statePolylineBuffer[
      wl.STATE_POLYLINE_CAP_CORRECTION_POINT_COUNT_OFFSET
    ]!
  );

  const nodes: PolylineState['nodes'] = Array.from(
    { length: nodeCount },
    (_, index) => {
      const base = index * wl.WASM_POLYLINE_NODE_INPUT_FIELDS;
      return {
        x: buffers.statePolylineNodeBuffer[base + wl.POLYLINE_NODE_X_OFFSET]!,
        y: buffers.statePolylineNodeBuffer[base + wl.POLYLINE_NODE_Y_OFFSET]!,
        thickness:
          buffers.statePolylineNodeBuffer[
            base + wl.POLYLINE_NODE_THICKNESS_OFFSET
          ]!,
      };
    }
  );

  return {
    timestampMs:
      buffers.statePolylineBuffer[wl.STATE_POLYLINE_TIMESTAMP_MS_OFFSET] ?? 0,
    nodes,
    layer,
    opacity,
    color: {
      color0,
      color1,
      repeatLength,
    },
    joinCorrection,
    capCorrection,
  };
};

const positionXOffsets = {
  value: wl.CAMERA_POSITION_X_OFFSET,
  hasInterpolation: wl.CAMERA_POSITION_X_HAS_INTERPOLATION_OFFSET,
  from: wl.CAMERA_POSITION_X_FROM_OFFSET,
  to: wl.CAMERA_POSITION_X_TO_OFFSET,
  mode: wl.CAMERA_POSITION_X_MODE_OFFSET,
  duration: wl.CAMERA_POSITION_X_DURATION_OFFSET,
  easing: wl.CAMERA_POSITION_X_EASING_OFFSET,
  param0: wl.CAMERA_POSITION_X_EASING_PARAM0_OFFSET,
  param1: wl.CAMERA_POSITION_X_EASING_PARAM1_OFFSET,
} as const;

const positionYOffsets = {
  value: wl.CAMERA_POSITION_Y_OFFSET,
  hasInterpolation: wl.CAMERA_POSITION_Y_HAS_INTERPOLATION_OFFSET,
  from: wl.CAMERA_POSITION_Y_FROM_OFFSET,
  to: wl.CAMERA_POSITION_Y_TO_OFFSET,
  mode: wl.CAMERA_POSITION_Y_MODE_OFFSET,
  duration: wl.CAMERA_POSITION_Y_DURATION_OFFSET,
  easing: wl.CAMERA_POSITION_Y_EASING_OFFSET,
  param0: wl.CAMERA_POSITION_Y_EASING_PARAM0_OFFSET,
  param1: wl.CAMERA_POSITION_Y_EASING_PARAM1_OFFSET,
} as const;

const positionZOffsets = {
  value: wl.CAMERA_POSITION_Z_OFFSET,
  hasInterpolation: wl.CAMERA_POSITION_Z_HAS_INTERPOLATION_OFFSET,
  from: wl.CAMERA_POSITION_Z_FROM_OFFSET,
  to: wl.CAMERA_POSITION_Z_TO_OFFSET,
  mode: wl.CAMERA_POSITION_Z_MODE_OFFSET,
  duration: wl.CAMERA_POSITION_Z_DURATION_OFFSET,
  easing: wl.CAMERA_POSITION_Z_EASING_OFFSET,
  param0: wl.CAMERA_POSITION_Z_EASING_PARAM0_OFFSET,
  param1: wl.CAMERA_POSITION_Z_EASING_PARAM1_OFFSET,
} as const;

const rotationYawOffsets = {
  value: wl.CAMERA_ROTATION_YAW_OFFSET,
  hasInterpolation: wl.CAMERA_ROTATION_YAW_HAS_INTERPOLATION_OFFSET,
  from: wl.CAMERA_ROTATION_YAW_FROM_OFFSET,
  to: wl.CAMERA_ROTATION_YAW_TO_OFFSET,
  mode: wl.CAMERA_ROTATION_YAW_MODE_OFFSET,
  duration: wl.CAMERA_ROTATION_YAW_DURATION_OFFSET,
  easing: wl.CAMERA_ROTATION_YAW_EASING_OFFSET,
  param0: wl.CAMERA_ROTATION_YAW_EASING_PARAM0_OFFSET,
  param1: wl.CAMERA_ROTATION_YAW_EASING_PARAM1_OFFSET,
} as const;

const rotationPitchOffsets = {
  value: wl.CAMERA_ROTATION_PITCH_OFFSET,
  hasInterpolation: wl.CAMERA_ROTATION_PITCH_HAS_INTERPOLATION_OFFSET,
  from: wl.CAMERA_ROTATION_PITCH_FROM_OFFSET,
  to: wl.CAMERA_ROTATION_PITCH_TO_OFFSET,
  mode: wl.CAMERA_ROTATION_PITCH_MODE_OFFSET,
  duration: wl.CAMERA_ROTATION_PITCH_DURATION_OFFSET,
  easing: wl.CAMERA_ROTATION_PITCH_EASING_OFFSET,
  param0: wl.CAMERA_ROTATION_PITCH_EASING_PARAM0_OFFSET,
  param1: wl.CAMERA_ROTATION_PITCH_EASING_PARAM1_OFFSET,
} as const;

const rotationRollOffsets = {
  value: wl.CAMERA_ROTATION_ROLL_OFFSET,
  hasInterpolation: wl.CAMERA_ROTATION_ROLL_HAS_INTERPOLATION_OFFSET,
  from: wl.CAMERA_ROTATION_ROLL_FROM_OFFSET,
  to: wl.CAMERA_ROTATION_ROLL_TO_OFFSET,
  mode: wl.CAMERA_ROTATION_ROLL_MODE_OFFSET,
  duration: wl.CAMERA_ROTATION_ROLL_DURATION_OFFSET,
  easing: wl.CAMERA_ROTATION_ROLL_EASING_OFFSET,
  param0: wl.CAMERA_ROTATION_ROLL_EASING_PARAM0_OFFSET,
  param1: wl.CAMERA_ROTATION_ROLL_EASING_PARAM1_OFFSET,
} as const;

const fovYOffsets = {
  value: wl.CAMERA_FOV_Y_OFFSET,
  hasInterpolation: wl.CAMERA_FOV_Y_HAS_INTERPOLATION_OFFSET,
  from: wl.CAMERA_FOV_Y_FROM_OFFSET,
  to: wl.CAMERA_FOV_Y_TO_OFFSET,
  mode: wl.CAMERA_FOV_Y_MODE_OFFSET,
  duration: wl.CAMERA_FOV_Y_DURATION_OFFSET,
  easing: wl.CAMERA_FOV_Y_EASING_OFFSET,
  param0: wl.CAMERA_FOV_Y_EASING_PARAM0_OFFSET,
  param1: wl.CAMERA_FOV_Y_EASING_PARAM1_OFFSET,
} as const;

/**
 * Reads and decodes the current camera state from WASM.
 * @param wasmState - WASM state.
 * @param buffers - Mutable buffer views.
 * @returns Decoded camera state.
 */
export const getCameraStateFromWasm = (
  wasmState: WasmState,
  buffers: WasmStateBufferAccess
): ObjectCameraState => {
  const buffer = readCameraStateBuffer(wasmState, buffers);
  const positionX = readStateValue(buffer, 0, positionXOffsets);
  const positionY = readStateValue(buffer, 0, positionYOffsets);
  const positionZ = readStateValue(buffer, 0, positionZOffsets);
  const rotationYaw = readStateValue(buffer, 0, rotationYawOffsets);
  const rotationPitch = readStateValue(buffer, 0, rotationPitchOffsets);
  const rotationRoll = readStateValue(buffer, 0, rotationRollOffsets);
  const fovY = readStateValue(buffer, 0, fovYOffsets);
  return {
    position: {
      x: positionX,
      y: positionY,
      z: positionZ,
    },
    rotation: {
      yaw: rotationYaw,
      pitch: rotationPitch,
      roll: rotationRoll,
    },
    fovY,
    near: buffer[wl.CAMERA_NEAR_OFFSET]!,
    far: buffer[wl.CAMERA_FAR_OFFSET]!,
    aspectRatio: buffer[wl.CAMERA_VIEWPORT_ASPECT_OFFSET]!,
  };
};
