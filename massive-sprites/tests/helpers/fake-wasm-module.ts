// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import * as cl from '../../src/generated/command-layout.generated';
import * as wl from '../../src/generated/wasm-layout.generated';

type WasmContextState = {
  commandPtr: number;
  commandCount: number;
  resultPtr: number;
  resultCount: number;
  applyStatsPtr: number;
  applyStatsCount: number;
  computeStatsPtr: number;
  computeStatsCount: number;
  pickMaskPageTablePtr: number;
  pickMaskPageTableCount: number;
  pickMaskWordPtr: number;
  pickMaskWordCount: number;
  nextSpriteId: number;
  nextPolylineId: number;
  cameraState: Float32Array;
  applyCommandCounts: number[];
  lastSnapshotTimestampMs: number;
  lastSnapshotViewportWidth: number;
  lastSnapshotViewportHeight: number;
  lastSnapshotValid: boolean;
};

type FakeComputeVerticesOptions = {
  spriteOutput?: Float32Array;
  drawCommands?: Int32Array;
  activeCount?: number;
  polylineOutput?: Float32Array;
};

const FAKE_UNLIMITED_SCALING_MAX_DISTANCE = 3.4028234663852886e38;

const normalizeScalingOptions = (
  minScaleDistance: number,
  maxScaleDistance: number
) => {
  let resolvedMinScaleDistance =
    Number.isFinite(minScaleDistance) && minScaleDistance > 0
      ? minScaleDistance
      : 0;
  let resolvedMaxScaleDistance =
    Number.isFinite(maxScaleDistance) && maxScaleDistance > 0
      ? maxScaleDistance
      : FAKE_UNLIMITED_SCALING_MAX_DISTANCE;
  if (resolvedMaxScaleDistance < resolvedMinScaleDistance) {
    [resolvedMinScaleDistance, resolvedMaxScaleDistance] = [
      resolvedMaxScaleDistance,
      resolvedMinScaleDistance,
    ];
  }
  return {
    minScaleDistance: resolvedMinScaleDistance,
    maxScaleDistance: resolvedMaxScaleDistance,
  };
};

export const createFakeWasmModule = (
  options: {
    failAddSprite?: boolean;
    failUpdateSprite?: boolean;
    failRemoveSprite?: boolean;
    failAddPolyline?: boolean;
    failUpdatePolyline?: boolean;
    failRemovePolyline?: boolean;
    failUpdateCamera?: boolean;
    failAdjustCameraPosition?: boolean;
    forceZeroResults?: boolean;
    growMemoryAfterWrite?: boolean;
    computeVertices?: FakeComputeVerticesOptions;
  } = {}
) => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  let nextContextPtr = 1;
  let heapOffset = 8;
  const allocations = new Map<number, number>();
  const contexts = new Map<number, WasmContextState>();
  const createDefaultCameraState = () => {
    const cameraState = new Float32Array(wl.CAMERA_BUFFER_SIZE);
    cameraState[wl.CAMERA_FOV_Y_OFFSET] = 45;
    cameraState[wl.CAMERA_NEAR_OFFSET] = 0.1;
    cameraState[wl.CAMERA_FAR_OFFSET] = 10000;
    cameraState[wl.CAMERA_VIEWPORT_ASPECT_OFFSET] = 1;
    cameraState[wl.CAMERA_SPRITE_SCALING_MIN_DISTANCE_OFFSET] = 0;
    cameraState[wl.CAMERA_SPRITE_SCALING_MAX_DISTANCE_OFFSET] =
      FAKE_UNLIMITED_SCALING_MAX_DISTANCE;
    cameraState[wl.CAMERA_POLYLINE_SCALING_MIN_DISTANCE_OFFSET] = 0;
    cameraState[wl.CAMERA_POLYLINE_SCALING_MAX_DISTANCE_OFFSET] =
      FAKE_UNLIMITED_SCALING_MAX_DISTANCE;
    cameraState[wl.CAMERA_PROJECTION_DIRTY_OFFSET] = 1;
    return cameraState;
  };

  const ensureMemoryCapacity = (requiredSize: number) => {
    if (requiredSize <= memory.buffer.byteLength) {
      return;
    }
    const pageBytes = 64 * 1024;
    const missingBytes = requiredSize - memory.buffer.byteLength;
    const requiredPages = Math.ceil(missingBytes / pageBytes);
    memory.grow(requiredPages);
  };

  const malloc = (size: number) => {
    ensureMemoryCapacity(heapOffset + size);
    const current = heapOffset;
    heapOffset += size;
    allocations.set(current, size);
    return current;
  };

  const mem_alloc = (count: number, size: number) => {
    const total = count * size;
    const current = malloc(total);
    new Uint8Array(memory.buffer, current, total).fill(0);
    return current;
  };

  const mem_realloc = (
    ptr: number,
    oldSize: number,
    newSize: number,
    wedgeOffset: number,
    initValue: number
  ) => {
    const current = malloc(newSize);
    const source = new Uint8Array(memory.buffer, ptr, oldSize);
    const target = new Uint8Array(memory.buffer, current, newSize);
    const resolvedWedge = Math.max(0, Math.min(wedgeOffset, oldSize));
    const head = source.slice(0, resolvedWedge);
    target.set(head, 0);
    if (newSize > oldSize) {
      const initBytes = new Uint8Array(newSize - oldSize);
      initBytes.fill(initValue);
      target.set(initBytes, resolvedWedge);
    }
    const tailStart = Math.min(resolvedWedge, oldSize);
    const tail = source.slice(tailStart);
    const tailOffset = resolvedWedge + Math.max(0, newSize - oldSize);
    if (tailOffset + tail.length <= target.length) {
      target.set(tail, tailOffset);
    }
    allocations.delete(ptr);
    allocations.set(current, newSize);
    return current;
  };

  const mem_free = (ptr: number) => {
    allocations.delete(ptr);
  };

  const create_context = () => {
    const ptr = nextContextPtr++;
    contexts.set(ptr, {
      commandPtr: 0,
      commandCount: 0,
      resultPtr: 0,
      resultCount: 0,
      applyStatsPtr: 0,
      applyStatsCount: 0,
      computeStatsPtr: 0,
      computeStatsCount: 0,
      pickMaskPageTablePtr: 0,
      pickMaskPageTableCount: 0,
      pickMaskWordPtr: 0,
      pickMaskWordCount: 0,
      nextSpriteId: 0,
      nextPolylineId: 0,
      cameraState: createDefaultCameraState(),
      applyCommandCounts: [],
      lastSnapshotTimestampMs: 0,
      lastSnapshotViewportWidth: 0,
      lastSnapshotViewportHeight: 0,
      lastSnapshotValid: false,
    });
    return ptr;
  };

  const release_context = (context: number) => {
    contexts.delete(context);
  };

  const set_command_buffer = (
    context: number,
    buffer: number,
    count: number
  ) => {
    const state = contexts.get(context);
    if (!state) {
      return 0;
    }
    state.commandPtr = buffer;
    state.commandCount = count;
    return 1;
  };

  const set_result_buffer = (
    context: number,
    buffer: number,
    count: number
  ) => {
    const state = contexts.get(context);
    if (!state) {
      return 0;
    }
    state.resultPtr = buffer;
    state.resultCount = count;
    return 1;
  };

  const set_apply_stats_buffer = (
    context: number,
    buffer: number,
    count: number
  ) => {
    const state = contexts.get(context);
    if (!state) {
      return 0;
    }
    state.applyStatsPtr = buffer;
    state.applyStatsCount = count;
    return 1;
  };

  const set_compute_stats_buffer = (
    context: number,
    buffer: number,
    count: number
  ) => {
    const state = contexts.get(context);
    if (!state) {
      return 0;
    }
    state.computeStatsPtr = buffer;
    state.computeStatsCount = count;
    return 1;
  };

  const set_pick_mask_page_table_buffer = (
    context: number,
    buffer: number,
    count: number
  ) => {
    const state = contexts.get(context);
    if (!state) {
      return 0;
    }
    state.pickMaskPageTablePtr = buffer;
    state.pickMaskPageTableCount = count;
    return 1;
  };

  const set_pick_mask_word_buffer = (
    context: number,
    buffer: number,
    count: number
  ) => {
    const state = contexts.get(context);
    if (!state) {
      return 0;
    }
    state.pickMaskWordPtr = buffer;
    state.pickMaskWordCount = count;
    return 1;
  };

  const set_scaling_options = (
    context: number,
    spriteMinScaleDistance: number,
    spriteMaxScaleDistance: number,
    polylineMinScaleDistance: number,
    polylineMaxScaleDistance: number
  ) => {
    const state = contexts.get(context);
    if (!state) {
      return 0;
    }
    const spriteScaling = normalizeScalingOptions(
      spriteMinScaleDistance,
      spriteMaxScaleDistance
    );
    const polylineScaling = normalizeScalingOptions(
      polylineMinScaleDistance,
      polylineMaxScaleDistance
    );
    state.cameraState[wl.CAMERA_SPRITE_SCALING_MIN_DISTANCE_OFFSET] =
      spriteScaling.minScaleDistance;
    state.cameraState[wl.CAMERA_SPRITE_SCALING_MAX_DISTANCE_OFFSET] =
      spriteScaling.maxScaleDistance;
    state.cameraState[wl.CAMERA_POLYLINE_SCALING_MIN_DISTANCE_OFFSET] =
      polylineScaling.minScaleDistance;
    state.cameraState[wl.CAMERA_POLYLINE_SCALING_MAX_DISTANCE_OFFSET] =
      polylineScaling.maxScaleDistance;
    return 1;
  };

  const apply_commands = (context: number) => {
    const state = contexts.get(context);
    if (!state) {
      return 0;
    }
    const commandBuffer = new Float32Array(
      memory.buffer,
      state.commandPtr,
      state.commandCount
    );
    const used = Math.trunc(commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET]!);
    const commandCount = Math.trunc(
      commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET]!
    );
    state.applyCommandCounts.push(commandCount);

    const failures: number[] = [];
    const results: number[] = [];

    let cursor = cl.COMMAND_BUFFER_HEADER_FIELDS;
    for (let index = 0; index < commandCount; index += 1) {
      if (cursor + cl.COMMAND_HEADER_FIELDS > used) {
        break;
      }
      const op = Math.trunc(
        commandBuffer[cursor + cl.COMMAND_HEADER_OP_OFFSET]!
      );
      const size = Math.trunc(
        commandBuffer[cursor + cl.COMMAND_HEADER_SIZE_OFFSET]!
      );
      if (op === cl.COMMAND_OP_ADD_SPRITE) {
        if (options.failAddSprite) {
          failures.push(index);
        } else {
          const resultIndex = Math.trunc(
            commandBuffer[cursor + cl.COMMAND_ADD_SPRITE_RESULT_INDEX_OFFSET] ??
              -1
          );
          if (resultIndex >= 0) {
            if (resultIndex >= results.length) {
              results.length = resultIndex + 1;
            }
            results[resultIndex] = state.nextSpriteId++;
          } else {
            state.nextSpriteId += 1;
          }
        }
      }
      if (op === cl.COMMAND_OP_ADD_POLYLINE) {
        if (options.failAddPolyline) {
          failures.push(index);
        } else {
          const resultIndex = Math.trunc(
            commandBuffer[
              cursor + cl.COMMAND_ADD_POLYLINE_RESULT_INDEX_OFFSET
            ] ?? -1
          );
          if (resultIndex >= 0) {
            if (resultIndex >= results.length) {
              results.length = resultIndex + 1;
            }
            results[resultIndex] = state.nextPolylineId++;
          } else {
            state.nextPolylineId += 1;
          }
        }
      }
      if (op === cl.COMMAND_OP_UPDATE_SPRITE) {
        if (options.failUpdateSprite) {
          failures.push(index);
        }
      }
      if (op === cl.COMMAND_OP_UPDATE_POLYLINE) {
        if (options.failUpdatePolyline) {
          failures.push(index);
        }
      }
      if (op === cl.COMMAND_OP_REMOVE_SPRITE) {
        if (options.failRemoveSprite) {
          failures.push(index);
        }
      }
      if (op === cl.COMMAND_OP_REMOVE_POLYLINE) {
        if (options.failRemovePolyline) {
          failures.push(index);
        }
      }
      if (op === cl.COMMAND_OP_UPDATE_CAMERA) {
        if (options.failUpdateCamera) {
          failures.push(index);
        } else {
          if (
            commandBuffer[
              cursor + cl.COMMAND_UPDATE_CAMERA_POSITION_X_HAS_OFFSET
            ]
          ) {
            state.cameraState[wl.CAMERA_POSITION_X_OFFSET] =
              commandBuffer[
                cursor + cl.COMMAND_UPDATE_CAMERA_POSITION_X_VALUE_OFFSET
              ]!;
          }
          if (
            commandBuffer[
              cursor + cl.COMMAND_UPDATE_CAMERA_POSITION_Y_HAS_OFFSET
            ]
          ) {
            state.cameraState[wl.CAMERA_POSITION_Y_OFFSET] =
              commandBuffer[
                cursor + cl.COMMAND_UPDATE_CAMERA_POSITION_Y_VALUE_OFFSET
              ]!;
          }
          if (
            commandBuffer[
              cursor + cl.COMMAND_UPDATE_CAMERA_POSITION_Z_HAS_OFFSET
            ]
          ) {
            state.cameraState[wl.CAMERA_POSITION_Z_OFFSET] =
              commandBuffer[
                cursor + cl.COMMAND_UPDATE_CAMERA_POSITION_Z_VALUE_OFFSET
              ]!;
          }
          if (
            commandBuffer[
              cursor + cl.COMMAND_UPDATE_CAMERA_ROTATION_YAW_HAS_OFFSET
            ]
          ) {
            state.cameraState[wl.CAMERA_ROTATION_YAW_OFFSET] =
              commandBuffer[
                cursor + cl.COMMAND_UPDATE_CAMERA_ROTATION_YAW_VALUE_OFFSET
              ]!;
          }
          if (
            commandBuffer[
              cursor + cl.COMMAND_UPDATE_CAMERA_ROTATION_PITCH_HAS_OFFSET
            ]
          ) {
            state.cameraState[wl.CAMERA_ROTATION_PITCH_OFFSET] =
              commandBuffer[
                cursor + cl.COMMAND_UPDATE_CAMERA_ROTATION_PITCH_VALUE_OFFSET
              ]!;
          }
          if (
            commandBuffer[
              cursor + cl.COMMAND_UPDATE_CAMERA_ROTATION_ROLL_HAS_OFFSET
            ]
          ) {
            state.cameraState[wl.CAMERA_ROTATION_ROLL_OFFSET] =
              commandBuffer[
                cursor + cl.COMMAND_UPDATE_CAMERA_ROTATION_ROLL_VALUE_OFFSET
              ]!;
          }
          if (
            commandBuffer[cursor + cl.COMMAND_UPDATE_CAMERA_FOV_Y_HAS_OFFSET]
          ) {
            state.cameraState[wl.CAMERA_FOV_Y_OFFSET] =
              commandBuffer[
                cursor + cl.COMMAND_UPDATE_CAMERA_FOV_Y_VALUE_OFFSET
              ]!;
          }
          if (
            commandBuffer[cursor + cl.COMMAND_UPDATE_CAMERA_NEAR_HAS_OFFSET]
          ) {
            state.cameraState[wl.CAMERA_NEAR_OFFSET] =
              commandBuffer[
                cursor + cl.COMMAND_UPDATE_CAMERA_NEAR_VALUE_OFFSET
              ]!;
          }
          if (commandBuffer[cursor + cl.COMMAND_UPDATE_CAMERA_FAR_HAS_OFFSET]) {
            state.cameraState[wl.CAMERA_FAR_OFFSET] =
              commandBuffer[
                cursor + cl.COMMAND_UPDATE_CAMERA_FAR_VALUE_OFFSET
              ]!;
          }
          if (
            commandBuffer[
              cursor + cl.COMMAND_UPDATE_CAMERA_VIEWPORT_ASPECT_HAS_OFFSET
            ]
          ) {
            state.cameraState[wl.CAMERA_VIEWPORT_ASPECT_OFFSET] =
              commandBuffer[
                cursor + cl.COMMAND_UPDATE_CAMERA_VIEWPORT_ASPECT_VALUE_OFFSET
              ]!;
          }
          state.cameraState[wl.CAMERA_PROJECTION_DIRTY_OFFSET] = 1;
        }
      }
      if (op === cl.COMMAND_OP_ADJUST_CAMERA_POSITION) {
        if (options.failAdjustCameraPosition) {
          failures.push(index);
        } else {
          state.cameraState[wl.CAMERA_ROTATION_YAW_OFFSET] = 0;
          state.cameraState[wl.CAMERA_ROTATION_ROLL_OFFSET] = 0;
          if (
            commandBuffer[
              cursor + cl.COMMAND_ADJUST_CAMERA_POSITION_PITCH_HAS_OFFSET
            ]
          ) {
            state.cameraState[wl.CAMERA_ROTATION_PITCH_OFFSET] =
              commandBuffer[
                cursor + cl.COMMAND_ADJUST_CAMERA_POSITION_PITCH_VALUE_OFFSET
              ]!;
          }
          if (
            commandBuffer[
              cursor + cl.COMMAND_ADJUST_CAMERA_POSITION_FOV_Y_HAS_OFFSET
            ]
          ) {
            state.cameraState[wl.CAMERA_FOV_Y_OFFSET] =
              commandBuffer[
                cursor + cl.COMMAND_ADJUST_CAMERA_POSITION_FOV_Y_VALUE_OFFSET
              ]!;
          }
          if (
            commandBuffer[
              cursor + cl.COMMAND_ADJUST_CAMERA_POSITION_NEAR_HAS_OFFSET
            ]
          ) {
            state.cameraState[wl.CAMERA_NEAR_OFFSET] =
              commandBuffer[
                cursor + cl.COMMAND_ADJUST_CAMERA_POSITION_NEAR_VALUE_OFFSET
              ]!;
          }
          if (
            commandBuffer[
              cursor + cl.COMMAND_ADJUST_CAMERA_POSITION_FAR_HAS_OFFSET
            ]
          ) {
            state.cameraState[wl.CAMERA_FAR_OFFSET] =
              commandBuffer[
                cursor + cl.COMMAND_ADJUST_CAMERA_POSITION_FAR_VALUE_OFFSET
              ]!;
          }
          state.cameraState[wl.CAMERA_POSITION_X_OFFSET] = 0;
          state.cameraState[wl.CAMERA_POSITION_Y_OFFSET] = 0;
          state.cameraState[wl.CAMERA_POSITION_Z_OFFSET] = 0;
          state.cameraState[wl.CAMERA_PROJECTION_DIRTY_OFFSET] = 1;
        }
      }
      cursor += size;
    }

    const resultBuffer = new Float32Array(
      memory.buffer,
      state.resultPtr,
      state.resultCount
    );
    if (options.forceZeroResults) {
      resultBuffer[cl.COMMAND_RESULT_FAILED_COUNT_OFFSET] = 0;
      resultBuffer[cl.COMMAND_RESULT_RESULT_COUNT_OFFSET] = 0;
    } else {
      resultBuffer[cl.COMMAND_RESULT_FAILED_COUNT_OFFSET] = failures.length;
      resultBuffer[cl.COMMAND_RESULT_RESULT_COUNT_OFFSET] = results.length;
      failures.forEach((value, idx) => {
        resultBuffer[cl.COMMAND_RESULT_HEADER_FIELDS + idx] = value;
      });
      results.forEach((value, idx) => {
        resultBuffer[cl.COMMAND_RESULT_HEADER_FIELDS + failures.length + idx] =
          value ?? Number.NaN;
      });
    }
    commandBuffer.fill(0);
    commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET] =
      cl.COMMAND_BUFFER_HEADER_FIELDS;
    commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = 0;
    if (state.applyStatsPtr && state.applyStatsCount >= 4) {
      const statsBuffer = new Float32Array(
        memory.buffer,
        state.applyStatsPtr,
        state.applyStatsCount
      );
      statsBuffer[0] = 1;
      statsBuffer[1] = 2;
      statsBuffer[2] = 3;
      statsBuffer[3] = 4;
    }
    if (options.growMemoryAfterWrite) {
      memory.grow(1);
    }
    return 1;
  };

  const compute_vertices = (
    context: number,
    viewMatrix: number,
    viewProjection: number,
    output: number,
    outTexIndices: number,
    polylineOutput: number,
    drawCommands: number,
    viewportW: number,
    viewportH: number,
    nowMs: number
  ) => {
    void viewMatrix;
    void viewProjection;
    void outTexIndices;
    const state = contexts.get(context);
    if (!state) {
      return 0;
    }
    const writeComputeStats = () => {
      if (
        state.computeStatsPtr &&
        state.computeStatsCount >= wl.COMPUTE_STATS_FIELDS
      ) {
        const statsBuffer = new Float32Array(
          memory.buffer,
          state.computeStatsPtr,
          state.computeStatsCount
        );
        statsBuffer.fill(0);
        statsBuffer[wl.COMPUTE_STATS_TOTAL_MS_OFFSET] = 10;
        statsBuffer[wl.COMPUTE_STATS_PROJECTION_MS_OFFSET] = 11;
        statsBuffer[wl.COMPUTE_STATS_SPRITE_ANIMATION_MS_OFFSET] = 12;
        statsBuffer[wl.COMPUTE_STATS_ELEMENT_ANIMATION_MS_OFFSET] = 13;
        statsBuffer[wl.COMPUTE_STATS_PIVOT_RESOLVE_MS_OFFSET] = 14;
        statsBuffer[wl.COMPUTE_STATS_AUTO_ROTATION_MS_OFFSET] = 15;
        statsBuffer[wl.COMPUTE_STATS_COLLECT_ENTRIES_MS_OFFSET] = 16;
        statsBuffer[wl.COMPUTE_STATS_SORT_ENTRIES_MS_OFFSET] = 17;
        statsBuffer[wl.COMPUTE_STATS_WRITE_OUTPUT_MS_OFFSET] = 18;
        statsBuffer[wl.COMPUTE_STATS_CAMERA_DIRTY_OFFSET] =
          state.cameraState[wl.CAMERA_PROJECTION_DIRTY_OFFSET] !== 0 ? 1 : 0;
      }
    };

    const override = options.computeVertices;
    if (override) {
      if (output && override.spriteOutput) {
        const out = new Float32Array(
          memory.buffer,
          output,
          override.spriteOutput.length
        );
        out.set(override.spriteOutput);
      }
      if (polylineOutput && override.polylineOutput) {
        const out = new Float32Array(
          memory.buffer,
          polylineOutput,
          override.polylineOutput.length
        );
        out.set(override.polylineOutput);
      }
      if (drawCommands) {
        if (override.drawCommands) {
          const drawBuffer = new Int32Array(
            memory.buffer,
            drawCommands,
            override.drawCommands.length
          );
          drawBuffer.set(override.drawCommands);
        } else {
          const drawBuffer = new Int32Array(
            memory.buffer,
            drawCommands,
            wl.DRAW_COMMAND_HEADER_FIELDS
          );
          drawBuffer[wl.DRAW_COMMAND_COMMAND_COUNT_OFFSET] = 0;
          drawBuffer[wl.DRAW_COMMAND_POLYLINE_VERTEX_COUNT_OFFSET] = 0;
        }
      }
      writeComputeStats();
      state.cameraState[wl.CAMERA_PROJECTION_DIRTY_OFFSET] = 0;
      state.lastSnapshotTimestampMs = nowMs;
      state.lastSnapshotViewportWidth = viewportW;
      state.lastSnapshotViewportHeight = viewportH;
      state.lastSnapshotValid =
        Number.isFinite(viewportW) &&
        Number.isFinite(viewportH) &&
        viewportW > 0 &&
        viewportH > 0;
      const derivedCount =
        override.activeCount ??
        Math.floor(
          (override.spriteOutput?.length ?? 0) / wl.WASM_OUTPUT_STRIDE
        );
      return Math.max(0, derivedCount);
    }

    if (drawCommands) {
      const drawBuffer = new Int32Array(
        memory.buffer,
        drawCommands,
        wl.DRAW_COMMAND_HEADER_FIELDS
      );
      drawBuffer[wl.DRAW_COMMAND_COMMAND_COUNT_OFFSET] = 0;
      drawBuffer[wl.DRAW_COMMAND_POLYLINE_VERTEX_COUNT_OFFSET] = 0;
    }
    writeComputeStats();
    state.cameraState[wl.CAMERA_PROJECTION_DIRTY_OFFSET] = 0;
    state.lastSnapshotTimestampMs = nowMs;
    state.lastSnapshotViewportWidth = viewportW;
    state.lastSnapshotViewportHeight = viewportH;
    state.lastSnapshotValid =
      Number.isFinite(viewportW) &&
      Number.isFinite(viewportH) &&
      viewportW > 0 &&
      viewportH > 0;
    return 0;
  };

  const get_camera_state = (
    context: number,
    cameraOut: number,
    cameraOutCount: number
  ) => {
    const state = contexts.get(context);
    if (!state || cameraOutCount < wl.CAMERA_BUFFER_SIZE) {
      return 0;
    }
    const cameraBuffer = new Float32Array(
      memory.buffer,
      cameraOut,
      cameraOutCount
    );
    cameraBuffer.set(state.cameraState);
    return 1;
  };

  const screen_to_world_on_plane_f32 = (
    context: number,
    screenX: number,
    screenY: number,
    viewportW: number,
    viewportH: number,
    planeZ: number,
    screenToWorldOut: number,
    screenToWorldOutCount: number
  ) => {
    void viewportW;
    void viewportH;
    void planeZ;
    const state = contexts.get(context);
    if (!state || screenToWorldOutCount < 2) {
      return 0;
    }
    const out = new Float32Array(
      memory.buffer,
      screenToWorldOut,
      screenToWorldOutCount
    );
    out[0] = screenX;
    out[1] = screenY;
    return 1;
  };

  const screen_to_world_on_plane_f64 = (
    context: number,
    screenX: number,
    screenY: number,
    viewportW: number,
    viewportH: number,
    planeZ: number,
    screenToWorldOut: number,
    screenToWorldOutCount: number
  ) => {
    void viewportW;
    void viewportH;
    void planeZ;
    const state = contexts.get(context);
    if (!state || screenToWorldOutCount < 2) {
      return 0;
    }
    const out = new Float64Array(
      memory.buffer,
      screenToWorldOut,
      screenToWorldOutCount
    );
    out[0] = screenX;
    out[1] = screenY;
    return 1;
  };

  const screen_to_world_on_plane_with_camera_f32 = (
    context: number,
    cameraPtr: number,
    cameraCount: number,
    screenX: number,
    screenY: number,
    viewportW: number,
    viewportH: number,
    planeZ: number,
    screenToWorldOut: number,
    screenToWorldOutCount: number
  ) => {
    void screenX;
    void screenY;
    void viewportW;
    void viewportH;
    void planeZ;
    const state = contexts.get(context);
    if (!state || cameraCount < wl.CAMERA_BUFFER_SIZE) {
      return 0;
    }
    if (screenToWorldOutCount < 2) {
      return 0;
    }
    const camera = new Float32Array(memory.buffer, cameraPtr, cameraCount);
    const out = new Float32Array(
      memory.buffer,
      screenToWorldOut,
      screenToWorldOutCount
    );
    out[0] = camera[wl.CAMERA_POSITION_X_OFFSET] ?? 0;
    out[1] = camera[wl.CAMERA_POSITION_Y_OFFSET] ?? 0;
    return 1;
  };

  const screen_to_world_on_plane_with_camera_f64 = (
    context: number,
    cameraPtr: number,
    cameraCount: number,
    screenX: number,
    screenY: number,
    viewportW: number,
    viewportH: number,
    planeZ: number,
    screenToWorldOut: number,
    screenToWorldOutCount: number
  ) => {
    void screenX;
    void screenY;
    void viewportW;
    void viewportH;
    void planeZ;
    const state = contexts.get(context);
    if (!state || cameraCount < wl.CAMERA_BUFFER_SIZE) {
      return 0;
    }
    if (screenToWorldOutCount < 2) {
      return 0;
    }
    const camera = new Float64Array(memory.buffer, cameraPtr, cameraCount);
    const out = new Float64Array(
      memory.buffer,
      screenToWorldOut,
      screenToWorldOutCount
    );
    out[0] = camera[wl.CAMERA_POSITION_X_OFFSET] ?? 0;
    out[1] = camera[wl.CAMERA_POSITION_Y_OFFSET] ?? 0;
    return 1;
  };

  const project_world_to_viewport_f32 = (
    context: number,
    worldX: number,
    worldY: number,
    worldZ: number,
    viewportW: number,
    viewportH: number,
    outPtr: number,
    outCount: number
  ) => {
    void worldZ;
    void viewportW;
    void viewportH;
    const state = contexts.get(context);
    if (!state || outCount < 2) {
      return 0;
    }
    const out = new Float32Array(memory.buffer, outPtr, outCount);
    out[0] = worldX;
    out[1] = worldY;
    return 1;
  };

  const project_world_to_viewport_f64 = (
    context: number,
    worldX: number,
    worldY: number,
    worldZ: number,
    viewportW: number,
    viewportH: number,
    outPtr: number,
    outCount: number
  ) => {
    void worldZ;
    void viewportW;
    void viewportH;
    const state = contexts.get(context);
    if (!state || outCount < 2) {
      return 0;
    }
    const out = new Float64Array(memory.buffer, outPtr, outCount);
    out[0] = worldX;
    out[1] = worldY;
    return 1;
  };

  const project_world_to_viewport_with_camera_f32 = (
    context: number,
    cameraPtr: number,
    cameraCount: number,
    worldX: number,
    worldY: number,
    worldZ: number,
    viewportW: number,
    viewportH: number,
    outPtr: number,
    outCount: number
  ) => {
    void worldX;
    void worldY;
    void worldZ;
    void viewportW;
    void viewportH;
    const state = contexts.get(context);
    if (!state || cameraCount < wl.CAMERA_BUFFER_SIZE) {
      return 0;
    }
    if (outCount < 2) {
      return 0;
    }
    const camera = new Float32Array(memory.buffer, cameraPtr, cameraCount);
    const out = new Float32Array(memory.buffer, outPtr, outCount);
    out[0] = camera[wl.CAMERA_POSITION_X_OFFSET] ?? 0;
    out[1] = camera[wl.CAMERA_POSITION_Y_OFFSET] ?? 0;
    return 1;
  };

  const project_world_to_viewport_with_camera_f64 = (
    context: number,
    cameraPtr: number,
    cameraCount: number,
    worldX: number,
    worldY: number,
    worldZ: number,
    viewportW: number,
    viewportH: number,
    outPtr: number,
    outCount: number
  ) => {
    void worldX;
    void worldY;
    void worldZ;
    void viewportW;
    void viewportH;
    const state = contexts.get(context);
    if (!state || cameraCount < wl.CAMERA_BUFFER_SIZE) {
      return 0;
    }
    if (outCount < 2) {
      return 0;
    }
    const camera = new Float64Array(memory.buffer, cameraPtr, cameraCount);
    const out = new Float64Array(memory.buffer, outPtr, outCount);
    out[0] = camera[wl.CAMERA_POSITION_X_OFFSET] ?? 0;
    out[1] = camera[wl.CAMERA_POSITION_Y_OFFSET] ?? 0;
    return 1;
  };

  const pick_at_f32 = (
    context: number,
    screenX: number,
    screenY: number,
    viewportW: number,
    viewportH: number,
    nowMs: number,
    viewMatrixPtr: number,
    viewProjectionPtr: number,
    outputPtr: number,
    outTexIndicesPtr: number,
    polylineOutputPtr: number,
    drawCommandsPtr: number,
    pickOutPtr: number,
    pickOutCount: number
  ) => {
    void screenX;
    void screenY;
    void viewMatrixPtr;
    void viewProjectionPtr;
    void outputPtr;
    void outTexIndicesPtr;
    void polylineOutputPtr;
    void drawCommandsPtr;
    const state = contexts.get(context);
    if (!state || pickOutCount < 4) {
      return 0;
    }
    state.lastSnapshotTimestampMs = nowMs;
    state.lastSnapshotViewportWidth = viewportW;
    state.lastSnapshotViewportHeight = viewportH;
    state.lastSnapshotValid =
      Number.isFinite(viewportW) &&
      Number.isFinite(viewportH) &&
      viewportW > 0 &&
      viewportH > 0;
    const out = new Float32Array(memory.buffer, pickOutPtr, pickOutCount);
    if (state.nextSpriteId > 0) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      return 1;
    }
    if (state.nextPolylineId > 0) {
      out[0] = 2;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      return 1;
    }
    out[0] = 0;
    out[1] = -1;
    out[2] = -1;
    out[3] = -1;
    return 1;
  };

  const pick_at_cached_f32 = (
    context: number,
    screenX: number,
    screenY: number,
    viewportW: number,
    viewportH: number,
    nowMs: number,
    viewMatrixPtr: number,
    viewProjectionPtr: number,
    outputPtr: number,
    outTexIndicesPtr: number,
    polylineOutputPtr: number,
    drawCommandsPtr: number,
    pickOutPtr: number,
    pickOutCount: number
  ) =>
    pick_at_f32(
      context,
      screenX,
      screenY,
      viewportW,
      viewportH,
      nowMs,
      viewMatrixPtr,
      viewProjectionPtr,
      outputPtr,
      outTexIndicesPtr,
      polylineOutputPtr,
      drawCommandsPtr,
      pickOutPtr,
      pickOutCount
    );

  const pick_at_f64 = (
    context: number,
    screenX: number,
    screenY: number,
    viewportW: number,
    viewportH: number,
    nowMs: number,
    viewMatrixPtr: number,
    viewProjectionPtr: number,
    outputPtr: number,
    outTexIndicesPtr: number,
    polylineOutputPtr: number,
    drawCommandsPtr: number,
    pickOutPtr: number,
    pickOutCount: number
  ) => {
    void screenX;
    void screenY;
    void viewMatrixPtr;
    void viewProjectionPtr;
    void outputPtr;
    void outTexIndicesPtr;
    void polylineOutputPtr;
    void drawCommandsPtr;
    const state = contexts.get(context);
    if (!state || pickOutCount < 4) {
      return 0;
    }
    state.lastSnapshotTimestampMs = nowMs;
    state.lastSnapshotViewportWidth = viewportW;
    state.lastSnapshotViewportHeight = viewportH;
    state.lastSnapshotValid =
      Number.isFinite(viewportW) &&
      Number.isFinite(viewportH) &&
      viewportW > 0 &&
      viewportH > 0;
    const out = new Float64Array(memory.buffer, pickOutPtr, pickOutCount);
    if (state.nextSpriteId > 0) {
      out[0] = 1;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      return 1;
    }
    if (state.nextPolylineId > 0) {
      out[0] = 2;
      out[1] = 0;
      out[2] = 0;
      out[3] = 0;
      return 1;
    }
    out[0] = 0;
    out[1] = -1;
    out[2] = -1;
    out[3] = -1;
    return 1;
  };

  const pick_at_cached_f64 = (
    context: number,
    screenX: number,
    screenY: number,
    viewportW: number,
    viewportH: number,
    nowMs: number,
    viewMatrixPtr: number,
    viewProjectionPtr: number,
    outputPtr: number,
    outTexIndicesPtr: number,
    polylineOutputPtr: number,
    drawCommandsPtr: number,
    pickOutPtr: number,
    pickOutCount: number
  ) =>
    pick_at_f64(
      context,
      screenX,
      screenY,
      viewportW,
      viewportH,
      nowMs,
      viewMatrixPtr,
      viewProjectionPtr,
      outputPtr,
      outTexIndicesPtr,
      polylineOutputPtr,
      drawCommandsPtr,
      pickOutPtr,
      pickOutCount
    );

  const get_sprite_state = (
    context: number,
    spriteId: number,
    spriteOut: number,
    spriteOutCount: number,
    elementOut: number,
    elementOutCount: number,
    nowMs: number
  ) => {
    void spriteId;
    void elementOut;
    void elementOutCount;
    const state = contexts.get(context);
    if (!state || spriteOutCount < wl.WASM_STATE_SPRITE_STRIDE) {
      return 0;
    }
    const out = new Float32Array(memory.buffer, spriteOut, spriteOutCount);
    out.fill(0);
    const resolvedTimestampMs =
      Number.isFinite(nowMs) && nowMs !== 0
        ? nowMs
        : state.lastSnapshotValid
          ? state.lastSnapshotTimestampMs
          : 0;
    out[wl.STATE_SPRITE_TIMESTAMP_MS_OFFSET] = resolvedTimestampMs;
    out[wl.STATE_SPRITE_SZ_OFFSET] = 0;
    out[wl.STATE_SPRITE_OPACITY_VALUE_OFFSET] = 1;
    if (state.lastSnapshotValid) {
      out[wl.STATE_SPRITE_VIEWPORT_BASE_VALID_OFFSET] = 1;
      out[wl.STATE_SPRITE_VIEWPORT_BASE_X_PIXEL_OFFSET] =
        state.lastSnapshotViewportWidth * 0.5;
      out[wl.STATE_SPRITE_VIEWPORT_BASE_Y_PIXEL_OFFSET] =
        state.lastSnapshotViewportHeight * 0.5;
    }
    return 1;
  };
  const get_polyline_state = (
    context: number,
    polylineId: number,
    polylineOut: number,
    polylineOutCount: number,
    nodeOut: number,
    nodeOutCount: number,
    nowMs: number
  ) => {
    void polylineId;
    void nodeOut;
    void nodeOutCount;
    const state = contexts.get(context);
    if (!state || polylineOutCount < wl.WASM_STATE_POLYLINE_STRIDE) {
      return 0;
    }
    const out = new Float32Array(memory.buffer, polylineOut, polylineOutCount);
    out.fill(0);
    out[wl.STATE_POLYLINE_TIMESTAMP_MS_OFFSET] =
      Number.isFinite(nowMs) && nowMs !== 0
        ? nowMs
        : state.lastSnapshotValid
          ? state.lastSnapshotTimestampMs
          : 0;
    out[wl.STATE_POLYLINE_COLOR0_A_OFFSET] = 1;
    out[wl.STATE_POLYLINE_COLOR1_A_OFFSET] = 1;
    out[wl.STATE_POLYLINE_NODE_COUNT_OFFSET] = 0;
    return 1;
  };
  const set_entry_debug_enabled = () => 1;
  const set_element_anim_detail_enabled = () => 1;
  const get_entry_debug = () => 0;

  const exports = {
    memory,
    mem_alloc,
    mem_realloc,
    mem_free,
    create_context_f32: create_context,
    release_context_f32: release_context,
    set_command_buffer_f32: set_command_buffer,
    set_result_buffer_f32: set_result_buffer,
    set_apply_stats_buffer_f32: set_apply_stats_buffer,
    set_compute_stats_buffer_f32: set_compute_stats_buffer,
    set_pick_mask_page_table_buffer_f32: set_pick_mask_page_table_buffer,
    set_pick_mask_word_buffer_f32: set_pick_mask_word_buffer,
    set_scaling_options_f32: set_scaling_options,
    apply_commands_f32: apply_commands,
    get_sprite_state_f32: get_sprite_state,
    get_polyline_state_f32: get_polyline_state,
    get_camera_state_f32: get_camera_state,
    screen_to_world_on_plane_f32,
    screen_to_world_on_plane_with_camera_f32,
    project_world_to_viewport_f32,
    project_world_to_viewport_with_camera_f32,
    compute_vertices_f32: compute_vertices,
    pick_at_f32,
    pick_at_cached_f32,
    set_entry_debug_enabled_f32: set_entry_debug_enabled,
    set_element_anim_detail_enabled_f32: set_element_anim_detail_enabled,
    get_entry_debug_f32: get_entry_debug,
    screen_to_world_on_plane_f64,
    screen_to_world_on_plane_with_camera_f64,
    project_world_to_viewport_f64,
    project_world_to_viewport_with_camera_f64,
    set_pick_mask_page_table_buffer_f64: set_pick_mask_page_table_buffer,
    set_pick_mask_word_buffer_f64: set_pick_mask_word_buffer,
    pick_at_f64,
    pick_at_cached_f64,
  } as unknown as WebAssembly.Exports;

  return {
    instance: { exports } as WebAssembly.Instance,
    state: {
      memory,
      contexts,
      getApplyCommandCounts: (contextPtr: number) => [
        ...(contexts.get(contextPtr)?.applyCommandCounts ?? []),
      ],
    },
  };
};
