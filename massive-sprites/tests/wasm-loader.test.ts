// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { loadWasmModule } from '../src/wasm';

describe('loadWasmModule', () => {
  it('loads a wasm module from bytes', async () => {
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const wasmModule = await loadWasmModule(bytes);

    expect(wasmModule.instance).toBeInstanceOf(WebAssembly.Instance);
    expect(wasmModule.memory).toBeInstanceOf(WebAssembly.Memory);
    expect(typeof wasmModule.exports.mem_alloc).toBe('function');
  });
});
