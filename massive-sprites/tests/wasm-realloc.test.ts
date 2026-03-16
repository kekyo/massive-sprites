// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { loadWasmModule } from '../src/wasm';

type WasmExports = {
  mem_alloc?: (count: number, size: number) => number;
  mem_realloc?: (
    ptr: number,
    oldSize: number,
    newSize: number,
    wedgeIndex: number,
    initValue: number
  ) => number;
  mem_free?: (ptr: number) => void;
};

describe('compute.wasm mem_realloc', () => {
  it('shrinks bytes at wedgeIndex when reduced', async () => {
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const wasmModule = await loadWasmModule(bytes);
    const exports = wasmModule.exports as WasmExports;

    const memory = wasmModule.memory;
    const mem_alloc = exports.mem_alloc;
    const mem_realloc = exports.mem_realloc;
    const mem_free = exports.mem_free;

    expect(memory).toBeInstanceOf(WebAssembly.Memory);
    expect(typeof mem_alloc).toBe('function');
    expect(typeof mem_realloc).toBe('function');
    expect(typeof mem_free).toBe('function');

    const oldSize = 10;
    const newSize = 7;
    const wedgeIndex = 2;

    const ptr = mem_alloc!(oldSize, 1);
    const source = new Uint8Array(memory!.buffer, ptr, oldSize);
    for (let index = 0; index < oldSize; index += 1) {
      source[index] = index;
    }

    const newPtr = mem_realloc!(ptr, oldSize, newSize, wedgeIndex, 0);
    const resized = new Uint8Array(memory!.buffer, newPtr, newSize);

    expect(Array.from(resized)).toEqual([0, 1, 5, 6, 7, 8, 9]);

    mem_free!(newPtr);
  });
});
