// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

type FakeWasmExports = {
  memory: WebAssembly.Memory;
  mem_alloc: (count: number, size: number) => number;
  mem_realloc: (
    ptr: number,
    oldSize: number,
    newSize: number,
    wedgeIndex: number,
    initValue: number
  ) => number;
  mem_free: (ptr: number) => void;
};

type HeldDescriptor = {
  ptr: number;
  _free: (ptr: number) => void;
};

type RegisterEntry = {
  target: object;
  heldValue: HeldDescriptor;
  unregisterToken: unknown;
  registry: FakeFinalizationRegistry;
};

class FakeFinalizationRegistry {
  static entries: RegisterEntry[] = [];

  readonly cleanupCallback: (heldValue: HeldDescriptor) => void;

  constructor(cleanupCallback: (heldValue: HeldDescriptor) => void) {
    this.cleanupCallback = cleanupCallback;
  }

  register(
    target: object,
    heldValue: HeldDescriptor,
    unregisterToken?: unknown
  ) {
    FakeFinalizationRegistry.entries.push({
      target,
      heldValue,
      unregisterToken,
      registry: this,
    });
  }

  unregister(unregisterToken: unknown): boolean {
    const beforeLength = FakeFinalizationRegistry.entries.length;
    FakeFinalizationRegistry.entries = FakeFinalizationRegistry.entries.filter(
      (entry) => entry.unregisterToken !== unregisterToken
    );
    return FakeFinalizationRegistry.entries.length !== beforeLength;
  }

  static reset() {
    FakeFinalizationRegistry.entries = [];
  }

  static runPendingFinalizers() {
    const snapshot = [...FakeFinalizationRegistry.entries];
    for (const entry of snapshot) {
      entry.registry.cleanupCallback(entry.heldValue);
    }
  }
}

const createFakeExports = () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  let heapOffset = 8;
  const freeCalls: number[] = [];

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

  const mem_free = (ptr: number) => {
    freeCalls.push(ptr);
  };

  return {
    exports: {
      memory,
      mem_alloc,
      mem_realloc,
      mem_free,
    } satisfies FakeWasmExports,
    freeCalls,
  };
};

const withStubbedFinalizationRegistry = async (
  body: (
    createWasmMemory: typeof import('../src/wasm').createWasmMemory
  ) => void
) => {
  FakeFinalizationRegistry.reset();
  vi.stubGlobal(
    'FinalizationRegistry',
    FakeFinalizationRegistry as unknown as typeof FinalizationRegistry
  );
  vi.resetModules();
  try {
    const { createWasmMemory } = await import('../src/wasm');
    await body(createWasmMemory);
  } finally {
    vi.unstubAllGlobals();
  }
};

describe('createWasmMemory finalizer safety (RED verification)', () => {
  it('registers finalizer with an unregister token tied to the wasm memory object', async () => {
    await withStubbedFinalizationRegistry(async (createWasmMemory) => {
      const { exports } = createFakeExports();
      const wasmMemory = createWasmMemory(exports, 4, Float32Array);

      expect(FakeFinalizationRegistry.entries).toHaveLength(1);
      expect(FakeFinalizationRegistry.entries[0]?.unregisterToken).toBe(
        wasmMemory
      );
    });
  });

  it('keeps finalizer pointer synchronized after internal reallocation', async () => {
    await withStubbedFinalizationRegistry(async (createWasmMemory) => {
      const { exports } = createFakeExports();
      const wasmMemory = createWasmMemory(exports, 4, Float32Array);
      const initialPtr = wasmMemory.ptr;

      wasmMemory.expand(4, 4, 0);

      expect(wasmMemory.ptr).not.toBe(initialPtr);
      expect(FakeFinalizationRegistry.entries[0]?.heldValue.ptr).toBe(
        wasmMemory.ptr
      );
    });
  });

  it('does not call free from finalizer after release has already freed memory', async () => {
    await withStubbedFinalizationRegistry(async (createWasmMemory) => {
      const { exports, freeCalls } = createFakeExports();
      const wasmMemory = createWasmMemory(exports, 4, Float32Array);

      wasmMemory.release();
      const freeCallsAfterRelease = [...freeCalls];

      FakeFinalizationRegistry.runPendingFinalizers();

      expect(freeCalls).toEqual(freeCallsAfterRelease);
    });
  });
});
