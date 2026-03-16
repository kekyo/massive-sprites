// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createWasmMemory } from '../src/wasm';

const createFakeExports = () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  let heapOffset = 8;
  const reallocCalls: Array<{
    ptr: number;
    oldSize: number;
    newSize: number;
    wedgeIndex: number;
    initValue: number;
  }> = [];
  const malloc = (size: number) => {
    const current = heapOffset;
    heapOffset += size;
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
    wedgeIndex: number,
    initValue: number
  ) => {
    reallocCalls.push({ ptr, oldSize, newSize, wedgeIndex, initValue });
    const current = malloc(newSize);
    const source = new Uint8Array(memory.buffer, ptr, oldSize);
    const target = new Uint8Array(memory.buffer, current, newSize);
    if (newSize <= oldSize) {
      if (newSize > 0) {
        target.set(source.subarray(0, newSize), 0);
      }
      return current;
    }
    const insertAt = Math.max(0, Math.min(wedgeIndex, oldSize));
    const addedSize = newSize - oldSize;
    if (insertAt > 0) {
      target.set(source.subarray(0, insertAt), 0);
    }
    if (oldSize > insertAt) {
      target.set(source.subarray(insertAt, oldSize), insertAt + addedSize);
    }
    if (initValue !== -1 && addedSize > 0) {
      target.fill(initValue & 0xff, insertAt, insertAt + addedSize);
    }
    return current;
  };
  const mem_free = () => {};
  return {
    exports: {
      memory,
      mem_alloc,
      mem_realloc,
      mem_free,
    },
    reallocCalls,
  };
};

describe('createWasmMemory', () => {
  it('expands when additional size is requested', () => {
    const { exports, reallocCalls } = createFakeExports();
    const wasmMemory = createWasmMemory(exports, 4, Float32Array);

    const initialPtr = wasmMemory.ptr;
    const initialView = wasmMemory.getBuffer();

    const resizedView = wasmMemory.expand(4, 4, 0);

    expect(reallocCalls).toHaveLength(1);
    expect(reallocCalls[0]?.ptr).toBe(initialPtr);
    const oldSize = 4 * Float32Array.BYTES_PER_ELEMENT;
    expect(reallocCalls[0]?.oldSize).toBe(oldSize);
    expect(reallocCalls[0]?.newSize).toBe(8 * Float32Array.BYTES_PER_ELEMENT);
    expect(reallocCalls[0]?.wedgeIndex).toBe(oldSize);
    expect(reallocCalls[0]?.initValue).toBe(0);
    expect(resizedView.length).toBe(8);
    expect(resizedView.byteOffset).toBe(wasmMemory.ptr);
    expect(resizedView.buffer).toBe(exports.memory.buffer);
    expect(initialView.buffer).toBe(exports.memory.buffer);
  });

  it('refreshes view when memory grows', () => {
    const { exports } = createFakeExports();
    const wasmMemory = createWasmMemory(exports, 4, Float32Array);

    const initialView = wasmMemory.getBuffer();
    exports.memory.grow(1);
    const refreshedView = wasmMemory.getBuffer();

    expect(refreshedView.buffer).toBe(exports.memory.buffer);
    expect(refreshedView.buffer).not.toBe(initialView.buffer);
    expect(refreshedView.byteOffset).toBe(wasmMemory.ptr);
  });

  it('supports typed array overrides', () => {
    const { exports, reallocCalls } = createFakeExports();
    const wasmMemory = createWasmMemory<Int32Array>(exports, 3, Int32Array);

    const view = wasmMemory.getBuffer();
    wasmMemory.expand(3, 3, 0);

    expect(view).toBeInstanceOf(Int32Array);
    expect(reallocCalls[0]?.newSize).toBe(6 * Int32Array.BYTES_PER_ELEMENT);
  });

  it('does not initialize expanded bytes when initValue is -1', () => {
    const { exports, reallocCalls } = createFakeExports();
    const wasmMemory = createWasmMemory(exports, 4, Float32Array);
    const oldSize = 4 * Float32Array.BYTES_PER_ELEMENT;
    const newSize = 8 * Float32Array.BYTES_PER_ELEMENT;
    const expectedPtr = wasmMemory.ptr + oldSize;

    new Uint8Array(exports.memory.buffer, expectedPtr, newSize).fill(0x7b);
    const resizedView = wasmMemory.expand(4, 4, -1);
    const resizedBytes = new Uint8Array(
      resizedView.buffer,
      resizedView.byteOffset,
      newSize
    );

    expect(reallocCalls).toHaveLength(1);
    expect(reallocCalls[0]?.initValue).toBe(-1);
    expect(wasmMemory.ptr).toBe(expectedPtr);
    expect(Array.from(resizedBytes.subarray(oldSize))).toEqual(
      new Array(newSize - oldSize).fill(0x7b)
    );
  });

  it('reduces by count from wedgeIndex', () => {
    const { exports, reallocCalls } = createFakeExports();
    const wasmMemory = createWasmMemory(exports, 6, Float32Array);

    const reducedView = wasmMemory.reduce(2, 2);

    expect(reallocCalls).toHaveLength(1);
    expect(reallocCalls[0]?.oldSize).toBe(6 * Float32Array.BYTES_PER_ELEMENT);
    expect(reallocCalls[0]?.newSize).toBe(4 * Float32Array.BYTES_PER_ELEMENT);
    expect(reallocCalls[0]?.wedgeIndex).toBe(
      2 * Float32Array.BYTES_PER_ELEMENT
    );
    expect(reallocCalls[0]?.initValue).toBe(-1);
    expect(reducedView.length).toBe(4);
  });

  it('silently ignores missing FinalizationRegistry', () => {
    const { exports } = createFakeExports();
    const original = (
      globalThis as unknown as { FinalizationRegistry?: unknown }
    ).FinalizationRegistry;
    vi.stubGlobal('FinalizationRegistry', undefined);
    try {
      expect(() => createWasmMemory(exports, 2, Float32Array)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
      (
        globalThis as unknown as { FinalizationRegistry?: unknown }
      ).FinalizationRegistry = original;
    }
  });
});
