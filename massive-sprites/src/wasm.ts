// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import {
  loadWasm,
  type WasmInstance,
  type WasmSource,
} from './generated/wasm-loader';
import { Releaseable, WasmInputPrecision } from './types';
import { getNowMs } from './utils';

///////////////////////////////////////////////////////////////////////////////////

/**
 * Source accepted by the WASM loader helper.
 */
export type WasmModuleSource = WasmSource;

type MemAllocFn = (count: number, size: number) => number;
type MemReallocFn = (
  ptr: number,
  oldSize: number,
  newSize: number,
  wedgeIndex: number,
  initValue: number
) => number;
type MemFreeFn = (ptr: number) => void;
type CreateContextFn = () => number;
type ReleaseContextFn = (context: number) => void;
type SetBufferFn = (context: number, buffer: number, count: number) => number;
type SetScalingOptionsFn = (
  context: number,
  spriteMinScaleDistance: number,
  spriteMaxScaleDistance: number,
  polylineMinScaleDistance: number,
  polylineMaxScaleDistance: number
) => number;
type ApplyCommandsFn = (context: number, nowMs: number) => number;
type GetSpriteStateFn = (
  context: number,
  spriteId: number,
  spriteOut: number,
  spriteOutCount: number,
  elementOut: number,
  elementOutCount: number,
  nowMs: number
) => number;
type GetPolylineStateFn = (
  context: number,
  polylineId: number,
  polylineOut: number,
  polylineOutCount: number,
  nodeOut: number,
  nodeOutCount: number,
  nowMs: number
) => number;
type GetCameraStateFn = (
  context: number,
  cameraOut: number,
  cameraOutCount: number
) => number;
type ScreenToWorldOnPlaneFn = (
  context: number,
  screenX: number,
  screenY: number,
  viewportW: number,
  viewportH: number,
  planeZ: number,
  outXY: number,
  outCount: number
) => number;
type ScreenToWorldOnPlaneWithCameraFn = (
  context: number,
  camera: number,
  cameraCount: number,
  screenX: number,
  screenY: number,
  viewportW: number,
  viewportH: number,
  planeZ: number,
  outXY: number,
  outCount: number
) => number;
type ProjectWorldToViewportFn = (
  context: number,
  worldX: number,
  worldY: number,
  worldZ: number,
  viewportW: number,
  viewportH: number,
  outXY: number,
  outCount: number
) => number;
type ProjectWorldToViewportWithCameraFn = (
  context: number,
  camera: number,
  cameraCount: number,
  worldX: number,
  worldY: number,
  worldZ: number,
  viewportW: number,
  viewportH: number,
  outXY: number,
  outCount: number
) => number;
type ComputeVerticesFn = (
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
) => number;
type PickAtFn = (
  context: number,
  screenX: number,
  screenY: number,
  viewportW: number,
  viewportH: number,
  nowMs: number,
  viewMatrix: number,
  viewProjection: number,
  output: number,
  outTexIndices: number,
  polylineOutput: number,
  drawCommands: number,
  outResult: number,
  outCount: number
) => number;
type SetToggleFn = (context: number, enabled: number) => number;
type SetCameraTrackingFn = (
  context: number,
  spriteSlots: number,
  spriteSlotCount: number,
  targetMode: number,
  distance: number,
  minDistance: number,
  fitPadding: number,
  fitZoomBias: number,
  interpolationKind: number,
  interpolationMode: number,
  interpolationDuration: number,
  interpolationEasing: number,
  interpolationParam0: number,
  interpolationParam1: number,
  interpolationParam2: number,
  interpolationParam3: number
) => number;
type ClearCameraTrackingFn = (context: number) => number;
type GetEntryDebugFn = (
  context: number,
  outElementIndices: number,
  outSolveModes: number,
  outScreenFromDeg: number,
  outScreenToDeg: number,
  outScreenAnglesDeg: number,
  outEntryRotateDeg: number,
  outEntryFinalRotateDeg: number,
  outEntryRotationFromDeg: number,
  outEntryRotationToDeg: number,
  outEntryRotationDurationMs: number,
  outEntryFinalRotationFromDeg: number,
  outEntryFinalRotationToDeg: number,
  outEntryFinalRotationDurationMs: number,
  maxCount: number
) => number;

interface WasmMemoryFunctionSignatures {
  readonly mem_alloc: MemAllocFn;
  readonly mem_realloc: MemReallocFn;
  readonly mem_free: MemFreeFn;
}

interface WasmPrecisionFunctionSignatures {
  readonly create_context: CreateContextFn;
  readonly release_context: ReleaseContextFn;
  readonly set_command_buffer: SetBufferFn;
  readonly set_result_buffer: SetBufferFn;
  readonly set_apply_stats_buffer: SetBufferFn;
  readonly set_compute_stats_buffer: SetBufferFn;
  readonly set_pick_mask_page_table_buffer: SetBufferFn;
  readonly set_pick_mask_word_buffer: SetBufferFn;
  readonly set_scaling_options: SetScalingOptionsFn;
  readonly apply_commands: ApplyCommandsFn;
  readonly get_sprite_state: GetSpriteStateFn;
  readonly get_polyline_state: GetPolylineStateFn;
  readonly get_camera_state: GetCameraStateFn;
  readonly screen_to_world_on_plane: ScreenToWorldOnPlaneFn;
  readonly screen_to_world_on_plane_with_camera: ScreenToWorldOnPlaneWithCameraFn;
  readonly project_world_to_viewport: ProjectWorldToViewportFn;
  readonly project_world_to_viewport_with_camera: ProjectWorldToViewportWithCameraFn;
  readonly compute_vertices: ComputeVerticesFn;
  readonly pick_at: PickAtFn;
  readonly pick_at_cached: PickAtFn;
  readonly set_entry_debug_enabled: SetToggleFn;
  readonly set_element_anim_detail_enabled: SetToggleFn;
  readonly get_entry_debug: GetEntryDebugFn;
}

interface WasmOptionalPrecisionFunctionSignatures {
  readonly set_camera_tracking?: SetCameraTrackingFn;
  readonly clear_camera_tracking?: ClearCameraTrackingFn;
}

type OptionalProperties<T extends object> = {
  readonly [K in keyof T]?: T[K];
};

type WithPrecisionSuffix<
  T extends object,
  TPrecision extends WasmInputPrecision,
> = {
  readonly [K in keyof T as K extends string
    ? `${K}_${TPrecision}`
    : never]?: T[K];
};

/**
 * Full exported function surface expected from the compute WASM module.
 */
export type ComputeWasmFunctionExports =
  OptionalProperties<WasmMemoryFunctionSignatures> &
    WithPrecisionSuffix<WasmPrecisionFunctionSignatures, 'f32'> &
    WithPrecisionSuffix<WasmPrecisionFunctionSignatures, 'f64'> &
    OptionalProperties<
      WithPrecisionSuffix<WasmOptionalPrecisionFunctionSignatures, 'f32'>
    > &
    OptionalProperties<
      WithPrecisionSuffix<WasmOptionalPrecisionFunctionSignatures, 'f64'>
    >;

/**
 * Loaded WASM module returned by {@link loadWasmModule}.
 */
export type LoadedWasmModule = WasmInstance<ComputeWasmFunctionExports>;
/**
 * Accepted WASM module input for renderer factories.
 */
export type WasmModule = WebAssembly.Instance | LoadedWasmModule;
type WasmImportModule = NonNullable<WebAssembly.Imports[string]>;

const resolveImportNamespace = (
  imports: WebAssembly.Imports,
  moduleName: string
): WasmImportModule => {
  const currentImports = imports[moduleName];
  const resolvedImports =
    typeof currentImports === 'object' && currentImports !== null
      ? (currentImports as Record<string | symbol, unknown>)
      : {};
  return new Proxy(resolvedImports, {
    get: (target, prop) => {
      if (
        prop === 'msp_performance_now' &&
        target.msp_performance_now === undefined
      ) {
        return getNowMs;
      }
      if (prop in target) {
        return (target as Record<string | symbol, unknown>)[prop];
      }
      return () => 0;
    },
  }) as WasmImportModule;
};

const createWasmImports = (
  imports: WebAssembly.Imports = {}
): WebAssembly.Imports => ({
  ...imports,
  env: resolveImportNamespace(imports, 'env'),
  wasi_snapshot_preview1: resolveImportNamespace(
    imports,
    'wasi_snapshot_preview1'
  ),
});

/**
 * Loads the compute WASM module and fills missing host imports with safe defaults.
 * @param source - WASM source accepted by the generated loader.
 * @param imports - Optional import object merged with default namespaces.
 * @returns Loaded WASM module with typed exports.
 */
export const loadWasmModule = async (
  source: WasmModuleSource,
  imports: WebAssembly.Imports = {}
): Promise<LoadedWasmModule> => {
  return await loadWasm<ComputeWasmFunctionExports>(source, {
    imports: createWasmImports(imports),
  });
};

///////////////////////////////////////////////////////////////////////////////////

/**
 * Base exports required for managing WASM memory.
 */
export type WasmBasisExports = {
  /** Linear memory exported by the WASM module. */
  readonly memory: WebAssembly.Memory;
} & WasmMemoryFunctionSignatures;

/**
 * Array-like view backed by WASM memory.
 */
export interface WasmArrayBuffer {
  /** Underlying ArrayBuffer-like storage. */
  readonly buffer: ArrayBufferLike;
  /** Byte offset of the view within `buffer`. */
  readonly byteOffset: number;
  /** Element count exposed by the view. */
  readonly length: number;
}

/**
 * Typed array constructor accepted by WASM memory helpers.
 * @typeParam TArray - Array view type.
 */
export interface WasmArrayConstructor<TArray extends WasmArrayBuffer> {
  /** Byte size of one element. */
  readonly BYTES_PER_ELEMENT: number;
  new (buffer: ArrayBufferLike, byteOffset: number, length: number): TArray;
}

/**
 * Managed WASM memory range exposed as a typed array.
 * @typeParam TArrayBuffer - Backing array type.
 */
export interface WasmMemory<
  TArrayBuffer extends WasmArrayBuffer = Float32Array,
> extends Releaseable {
  /** Raw pointer to the beginning of the allocation. */
  readonly ptr: number;
  /** Current element count. */
  readonly count: number;
  /** Returns the current typed-array view, refreshing it after memory growth. */
  readonly getBuffer: () => TArrayBuffer;
  /** Shrinks the allocation and returns the refreshed view. */
  readonly reduce: (wedgeIndex: number, count: number) => TArrayBuffer;
  /** Grows the allocation and returns the refreshed view. */
  readonly expand: (
    wedgeIndex: number,
    count: number,
    initValue: number
  ) => TArrayBuffer;
}

///////////////////////////////////////////////////////////////////////////////////

interface WasmMemoryDescriptor {
  ptr: number;
  readonly mem_free: (ptr: number) => void;
}

let memoryCollector: FinalizationRegistry<WasmMemoryDescriptor> | undefined;

const registerMemoryCollector = (
  exports: WasmBasisExports,
  wasmMemory: WasmMemory
): WasmMemoryDescriptor | undefined => {
  if (typeof FinalizationRegistry !== 'function') {
    return undefined;
  }
  if (!memoryCollector) {
    memoryCollector = new FinalizationRegistry(
      (descriptor: WasmMemoryDescriptor) => {
        if (descriptor.ptr !== 0) {
          descriptor.mem_free(descriptor.ptr);
          descriptor.ptr = 0;
        }
      }
    );
  }
  const descriptor: WasmMemoryDescriptor = {
    ptr: wasmMemory.ptr,
    mem_free: exports.mem_free,
  };
  memoryCollector.register(wasmMemory, descriptor, wasmMemory);
  return descriptor;
};

const unregisterMemoryCollector = (token: object) => {
  if (memoryCollector) {
    memoryCollector.unregister(token);
  }
};

/**
 * Allocates and manages a resizable typed array in WASM memory.
 * @typeParam TArrayBuffer - Backing array type.
 * @param exports - Base WASM exports.
 * @param count - Initial element count.
 * @param ArrayBufferType - Typed array constructor.
 * @param options - Optional allocation settings.
 * @returns Managed WASM memory block.
 */
export const createWasmMemory = <TArrayBuffer extends WasmArrayBuffer>(
  exports: WasmBasisExports,
  count: number,
  ArrayBufferType: WasmArrayConstructor<TArrayBuffer>,
  options: { growthFactor?: number } = {}
): WasmMemory<TArrayBuffer> => {
  const wasmMemory: any = {};
  let collectorDescriptor: WasmMemoryDescriptor | undefined;

  wasmMemory.bpe = ArrayBufferType.BYTES_PER_ELEMENT;
  wasmMemory.count = count;
  wasmMemory.growthFactor = options.growthFactor ?? 2;
  wasmMemory.ptr = exports.mem_alloc(wasmMemory.count, wasmMemory.bpe);
  if (!wasmMemory.ptr) {
    throw new Error(
      `Could not allocate wasm heap: ${wasmMemory.count * wasmMemory.bpe}`
    );
  }

  collectorDescriptor = registerMemoryCollector(exports, wasmMemory);

  wasmMemory.arrayBuffer = new ArrayBufferType(
    exports.memory.buffer,
    wasmMemory.ptr,
    wasmMemory.count
  );

  wasmMemory.release = () => {
    if (wasmMemory.ptr) {
      const releasedPtr = wasmMemory.ptr;
      wasmMemory.arrayBuffer = undefined!;
      wasmMemory.ptr = 0;
      if (collectorDescriptor) {
        collectorDescriptor.ptr = 0;
      }
      unregisterMemoryCollector(wasmMemory);
      exports.mem_free(releasedPtr);
    }
  };
  wasmMemory[Symbol.dispose] = wasmMemory.release;

  const refreshArrayBuffer = () => {
    if (wasmMemory.arrayBuffer.buffer !== exports.memory.buffer) {
      wasmMemory.arrayBuffer = new ArrayBufferType(
        exports.memory.buffer,
        wasmMemory.ptr,
        wasmMemory.count
      );
    }
  };

  const reallocate = (
    resolvedCount: number,
    wedgeIndex: number,
    initValue: number
  ) => {
    if (resolvedCount === wasmMemory.count) {
      refreshArrayBuffer();
      return wasmMemory.arrayBuffer as TArrayBuffer;
    }
    const oldCount = wasmMemory.count;
    const oldSize = oldCount * wasmMemory.bpe;
    const newSize = resolvedCount * wasmMemory.bpe;
    const resolvedWedgeIndex = Math.max(0, Math.min(wedgeIndex, oldCount));
    const resolvedWedgeOffset = resolvedWedgeIndex * wasmMemory.bpe;
    const newPtr = exports.mem_realloc(
      wasmMemory.ptr,
      oldSize,
      newSize,
      resolvedWedgeOffset,
      initValue
    );
    if (!newPtr && newSize > 0) {
      throw new Error(`Could not reallocate wasm heap: ${newSize}`);
    }
    wasmMemory.ptr = newPtr;
    if (collectorDescriptor) {
      collectorDescriptor.ptr = newPtr;
    }
    wasmMemory.count = resolvedCount;
    wasmMemory.arrayBuffer = new ArrayBufferType(
      exports.memory.buffer,
      wasmMemory.ptr,
      wasmMemory.count
    );
    return wasmMemory.arrayBuffer;
  };

  wasmMemory.getBuffer = (): TArrayBuffer => {
    refreshArrayBuffer();
    return wasmMemory.arrayBuffer;
  };

  wasmMemory.expand = (
    wedgeIndex: number,
    count: number,
    initValue: number
  ): TArrayBuffer => {
    if (count <= 0) {
      return wasmMemory.getBuffer();
    }
    const requestedCount = wasmMemory.count + count;
    const resolvedCount = Math.max(
      requestedCount,
      Math.ceil(wasmMemory.count * wasmMemory.growthFactor)
    );
    return reallocate(resolvedCount, wedgeIndex, initValue);
  };

  wasmMemory.reduce = (wedgeIndex: number, count: number): TArrayBuffer => {
    if (count <= 0) {
      return wasmMemory.getBuffer();
    }
    const resolvedCount = Math.max(0, wasmMemory.count - count);
    return reallocate(resolvedCount, wedgeIndex, -1);
  };

  return wasmMemory;
};

///////////////////////////////////////////////////////////////////////////////////

/**
 * Resolved compute exports for a specific WASM precision.
 */
export type WasmSpriteExports = WasmBasisExports &
  WasmPrecisionFunctionSignatures &
  WasmOptionalPrecisionFunctionSignatures;

const isLoadedWasmModule = (
  wasmModule: WasmModule
): wasmModule is LoadedWasmModule =>
  typeof wasmModule === 'object' &&
  wasmModule !== null &&
  'instance' in wasmModule &&
  'exports' in wasmModule &&
  'memory' in wasmModule &&
  'rawExports' in wasmModule;

const resolveLoadedMemory = (wasmModule: WasmModule) => {
  if (isLoadedWasmModule(wasmModule)) {
    return wasmModule.memory;
  }
  const memory = (wasmModule.exports as Record<string, unknown>).memory;
  if (!(memory instanceof WebAssembly.Memory)) {
    throw new Error('WASM module must export memory.');
  }
  return memory;
};

const resolveLoadedExports = (
  wasmModule: WasmModule
): ComputeWasmFunctionExports =>
  isLoadedWasmModule(wasmModule)
    ? wasmModule.exports
    : (wasmModule.exports as unknown as ComputeWasmFunctionExports);

/**
 * Resolves the precision-specific compute exports from a loaded WASM module.
 * @param wasmModule - Loaded or instantiated WASM module.
 * @param precision - Target input precision.
 * @returns Precision-specific WASM exports.
 */
export const resolveWasmExports = (
  wasmModule: WasmModule,
  precision: WasmInputPrecision
): WasmSpriteExports => {
  const exports = resolveLoadedExports(wasmModule);
  const memory = resolveLoadedMemory(wasmModule);
  const mem_alloc = exports.mem_alloc;
  const mem_realloc = exports.mem_realloc;
  const mem_free = exports.mem_free;
  const createContext =
    precision === 'f64'
      ? exports.create_context_f64
      : exports.create_context_f32;
  const releaseContext =
    precision === 'f64'
      ? exports.release_context_f64
      : exports.release_context_f32;
  const setCommandBuffer =
    precision === 'f64'
      ? exports.set_command_buffer_f64
      : exports.set_command_buffer_f32;
  const setResultBuffer =
    precision === 'f64'
      ? exports.set_result_buffer_f64
      : exports.set_result_buffer_f32;
  const setApplyStatsBuffer =
    precision === 'f64'
      ? exports.set_apply_stats_buffer_f64
      : exports.set_apply_stats_buffer_f32;
  const setComputeStatsBuffer =
    precision === 'f64'
      ? exports.set_compute_stats_buffer_f64
      : exports.set_compute_stats_buffer_f32;
  const setPickMaskPageTableBuffer =
    precision === 'f64'
      ? exports.set_pick_mask_page_table_buffer_f64
      : exports.set_pick_mask_page_table_buffer_f32;
  const setPickMaskWordBuffer =
    precision === 'f64'
      ? exports.set_pick_mask_word_buffer_f64
      : exports.set_pick_mask_word_buffer_f32;
  const setScalingOptions =
    precision === 'f64'
      ? exports.set_scaling_options_f64
      : exports.set_scaling_options_f32;
  const applyCommands =
    precision === 'f64'
      ? exports.apply_commands_f64
      : exports.apply_commands_f32;
  const getSpriteState =
    precision === 'f64'
      ? exports.get_sprite_state_f64
      : exports.get_sprite_state_f32;
  const getPolylineState =
    precision === 'f64'
      ? exports.get_polyline_state_f64
      : exports.get_polyline_state_f32;
  const getCameraState =
    precision === 'f64'
      ? exports.get_camera_state_f64
      : exports.get_camera_state_f32;
  const screenToWorldOnPlane =
    precision === 'f64'
      ? exports.screen_to_world_on_plane_f64
      : exports.screen_to_world_on_plane_f32;
  const screenToWorldOnPlaneWithCamera =
    precision === 'f64'
      ? exports.screen_to_world_on_plane_with_camera_f64
      : exports.screen_to_world_on_plane_with_camera_f32;
  const projectWorldToViewport =
    precision === 'f64'
      ? exports.project_world_to_viewport_f64
      : exports.project_world_to_viewport_f32;
  const projectWorldToViewportWithCamera =
    precision === 'f64'
      ? exports.project_world_to_viewport_with_camera_f64
      : exports.project_world_to_viewport_with_camera_f32;
  const computeVertices =
    precision === 'f64'
      ? exports.compute_vertices_f64
      : exports.compute_vertices_f32;
  const pickAt =
    precision === 'f64' ? exports.pick_at_f64 : exports.pick_at_f32;
  const pickAtCached =
    precision === 'f64'
      ? exports.pick_at_cached_f64
      : exports.pick_at_cached_f32;
  const setEntryDebugEnabled =
    precision === 'f64'
      ? exports.set_entry_debug_enabled_f64
      : exports.set_entry_debug_enabled_f32;
  const setElementAnimDetailEnabled =
    precision === 'f64'
      ? exports.set_element_anim_detail_enabled_f64
      : exports.set_element_anim_detail_enabled_f32;
  const setElementAnimDetailEnabledFn =
    typeof setElementAnimDetailEnabled === 'function'
      ? (setElementAnimDetailEnabled as WasmSpriteExports['set_element_anim_detail_enabled'])
      : () => 0;
  const getEntryDebug =
    precision === 'f64'
      ? exports.get_entry_debug_f64
      : exports.get_entry_debug_f32;
  const setCameraTracking =
    precision === 'f64'
      ? exports.set_camera_tracking_f64
      : exports.set_camera_tracking_f32;
  const clearCameraTracking =
    precision === 'f64'
      ? exports.clear_camera_tracking_f64
      : exports.clear_camera_tracking_f32;

  if (
    typeof mem_alloc !== 'function' ||
    typeof mem_realloc !== 'function' ||
    typeof mem_free !== 'function' ||
    typeof createContext !== 'function' ||
    typeof releaseContext !== 'function' ||
    typeof setCommandBuffer !== 'function' ||
    typeof setResultBuffer !== 'function' ||
    typeof setApplyStatsBuffer !== 'function' ||
    typeof setComputeStatsBuffer !== 'function' ||
    typeof setPickMaskPageTableBuffer !== 'function' ||
    typeof setPickMaskWordBuffer !== 'function' ||
    typeof setScalingOptions !== 'function' ||
    typeof applyCommands !== 'function' ||
    typeof getSpriteState !== 'function' ||
    typeof getPolylineState !== 'function' ||
    typeof getCameraState !== 'function' ||
    typeof screenToWorldOnPlane !== 'function' ||
    typeof screenToWorldOnPlaneWithCamera !== 'function' ||
    typeof projectWorldToViewport !== 'function' ||
    typeof projectWorldToViewportWithCamera !== 'function' ||
    typeof computeVertices !== 'function' ||
    typeof pickAt !== 'function' ||
    typeof pickAtCached !== 'function' ||
    typeof setEntryDebugEnabled !== 'function' ||
    typeof getEntryDebug !== 'function'
  ) {
    throw new Error(
      'WASM module must export precision-specific create_context/release_context/set_command_buffer/set_result_buffer/set_apply_stats_buffer/set_compute_stats_buffer/set_pick_mask_page_table_buffer/set_pick_mask_word_buffer/set_scaling_options/apply_commands/get_sprite_state/get_polyline_state/get_camera_state/screen_to_world_on_plane/screen_to_world_on_plane_with_camera/project_world_to_viewport/project_world_to_viewport_with_camera/compute_vertices/pick_at/pick_at_cached/set_entry_debug_enabled/get_entry_debug functions.'
    );
  }

  const resolvedExports = {
    memory,
    mem_alloc: mem_alloc as WasmSpriteExports['mem_alloc'],
    mem_realloc: mem_realloc as WasmSpriteExports['mem_realloc'],
    mem_free: mem_free as WasmSpriteExports['mem_free'],
    create_context: createContext as WasmSpriteExports['create_context'],
    release_context: releaseContext as WasmSpriteExports['release_context'],
    set_command_buffer:
      setCommandBuffer as WasmSpriteExports['set_command_buffer'],
    set_result_buffer:
      setResultBuffer as WasmSpriteExports['set_result_buffer'],
    set_apply_stats_buffer:
      setApplyStatsBuffer as WasmSpriteExports['set_apply_stats_buffer'],
    set_compute_stats_buffer:
      setComputeStatsBuffer as WasmSpriteExports['set_compute_stats_buffer'],
    set_pick_mask_page_table_buffer:
      setPickMaskPageTableBuffer as WasmSpriteExports['set_pick_mask_page_table_buffer'],
    set_pick_mask_word_buffer:
      setPickMaskWordBuffer as WasmSpriteExports['set_pick_mask_word_buffer'],
    set_scaling_options:
      setScalingOptions as WasmSpriteExports['set_scaling_options'],
    apply_commands: applyCommands as WasmSpriteExports['apply_commands'],
    get_sprite_state: getSpriteState as WasmSpriteExports['get_sprite_state'],
    get_polyline_state:
      getPolylineState as WasmSpriteExports['get_polyline_state'],
    get_camera_state: getCameraState as WasmSpriteExports['get_camera_state'],
    screen_to_world_on_plane:
      screenToWorldOnPlane as WasmSpriteExports['screen_to_world_on_plane'],
    screen_to_world_on_plane_with_camera:
      screenToWorldOnPlaneWithCamera as WasmSpriteExports['screen_to_world_on_plane_with_camera'],
    project_world_to_viewport:
      projectWorldToViewport as WasmSpriteExports['project_world_to_viewport'],
    project_world_to_viewport_with_camera:
      projectWorldToViewportWithCamera as WasmSpriteExports['project_world_to_viewport_with_camera'],
    compute_vertices: computeVertices as WasmSpriteExports['compute_vertices'],
    pick_at: pickAt as WasmSpriteExports['pick_at'],
    pick_at_cached: pickAtCached as WasmSpriteExports['pick_at_cached'],
    set_entry_debug_enabled:
      setEntryDebugEnabled as WasmSpriteExports['set_entry_debug_enabled'],
    set_element_anim_detail_enabled: setElementAnimDetailEnabledFn,
    get_entry_debug: getEntryDebug as WasmSpriteExports['get_entry_debug'],
  } as WasmSpriteExports;
  if (typeof setCameraTracking === 'function') {
    (
      resolvedExports as {
        set_camera_tracking?: WasmSpriteExports['set_camera_tracking'];
      }
    ).set_camera_tracking =
      setCameraTracking as WasmSpriteExports['set_camera_tracking'];
  }
  if (typeof clearCameraTracking === 'function') {
    (
      resolvedExports as {
        clear_camera_tracking?: WasmSpriteExports['clear_camera_tracking'];
      }
    ).clear_camera_tracking =
      clearCameraTracking as WasmSpriteExports['clear_camera_tracking'];
  }
  return resolvedExports;
};
