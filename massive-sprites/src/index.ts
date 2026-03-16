// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

///////////////////////////////////////////////////////////////////////////////////

// Type exports
export * from './types';
export * from './scaling';

// Constants
export { WASM_MAX_ELEMENTS_PER_SPRITE } from './generated/wasm-layout.generated';

// Logger exports
export { getNoOpLogger, getConsoleLogger } from './logger';

// Canvas renderer exports
export { createObjectCanvasRenderer } from './canvas-renderer';

// Renderer exports
export { createObjectRenderer } from './renderer';

// WASM helper exports
export { loadWasmModule } from './wasm';
/**
 * WASM module helper types accepted and returned by the public loader APIs.
 */
export type { LoadedWasmModule, WasmModule, WasmModuleSource } from './wasm';

// Texture options
export {
  MAX_TEXTURE_SAMPLING_OPTIONS,
  MIN_TEXTURE_SAMPLING_OPTIONS,
  DEFAULT_TEXTURE_SAMPLING_OPTIONS,
} from './texture';
