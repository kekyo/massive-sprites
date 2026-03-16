// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { describe, expect, it, vi } from 'vitest';

import { createObjectRenderer as createCoreObjectRenderer } from '../src/renderer';
import { resolveWasmExports, loadWasmModule } from '../src/wasm';
import {
  createWasmState,
  ensureCommandCapacity,
  readCameraStateBuffer,
  type WasmStateBufferAccess,
} from '../src/states';
import * as wl from '../src/generated/wasm-layout.generated';
import * as cl from '../src/generated/command-layout.generated';
import type { ObjectRendererOptions, SpritePlacement } from '../src/types';
import {
  getUnlimitedDistanceScalingMaxDistanceForWasm,
  resolveDistanceScalingOptions,
  resolveDistanceScalingOptionsForWasm,
} from '../src/scaling';
import { createFakeWasmModule } from './helpers/fake-wasm-module';
import {
  createFakeBitmap,
  createFakeGL,
} from './helpers/object-renderer-test-kit';

const timeState = vi.hoisted(() => ({ nowMs: 0 }));

vi.mock('../src/utils', async () => {
  const actual =
    await vi.importActual<typeof import('../src/utils')>('../src/utils');
  return {
    ...actual,
    getNowMs: () => timeState.nowMs,
  };
});

const createRendererResources = () => ({
  program: {} as WebGLProgram,
  buffer: {} as WebGLBuffer,
  indexBuffer: {} as WebGLBuffer,
  indexBufferSpriteCapacity: 16383,
  positionLocation: 0,
  texCoordLocation: 1,
  opacityAttributeLocation: 2,
  textureLocation: {} as WebGLUniformLocation,
  opacityLocation: {} as WebGLUniformLocation,
  viewProjectionLocation: {} as WebGLUniformLocation,
});

const createObjectRenderer = (
  viewPortSize: Parameters<typeof createCoreObjectRenderer>[0],
  gl: WebGLRenderingContext,
  resources: ReturnType<typeof createRendererResources>,
  wasmModule: Parameters<typeof createCoreObjectRenderer>[1],
  options?: ObjectRendererOptions
) => {
  void resources;
  const renderer = createCoreObjectRenderer(viewPortSize, wasmModule, options);
  renderer.attachWebGL(gl);
  return renderer;
};

const allocateDefaultAtlas = (
  renderer: ReturnType<typeof createObjectRenderer>
) =>
  renderer.allocateAtlas({
    widthPixel: 512,
    heightPixel: 512,
  });

const expectCloseTo = (
  actual: number,
  expected: number,
  tolerance = 1.0e-3
) => {
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);
};

const createBufferAccess = (wasmState: ReturnType<typeof createWasmState>) => {
  const buffers: WasmStateBufferAccess = {
    commandBuffer: wasmState.commandBuffer.getBuffer(),
    commandBufferCapacity: wasmState.commandBuffer.count,
    resultBuffer: wasmState.resultBuffer.getBuffer(),
    resultBufferCapacity: wasmState.resultBuffer.count,
    applyStatsBuffer: wasmState.applyStatsBuffer.getBuffer(),
    computeStatsBuffer: wasmState.computeStatsBuffer.getBuffer(),
    stateSpriteBuffer: wasmState.stateSpriteBuffer.getBuffer(),
    stateSpriteBufferCapacity: wasmState.stateSpriteBuffer.count,
    stateElementBuffer: wasmState.stateElementBuffer.getBuffer(),
    stateElementBufferCapacity: wasmState.stateElementBuffer.count,
    statePolylineBuffer: wasmState.statePolylineBuffer.getBuffer(),
    statePolylineBufferCapacity: wasmState.statePolylineBuffer.count,
    statePolylineNodeBuffer: wasmState.statePolylineNodeBuffer.getBuffer(),
    statePolylineNodeBufferCapacity: wasmState.statePolylineNodeBuffer.count,
    cameraBuffer: wasmState.cameraBuffer.getBuffer(),
    outputCapacity: Math.floor(
      wasmState.outputBuffer.count / wl.WASM_OUTPUT_STRIDE
    ),
    texIndexCapacity: wasmState.texIndexBuffer.count,
    polylineOutputCapacity: Math.floor(
      wasmState.polylineOutputBuffer.count / wl.POLYLINE_OUTPUT_STRIDE
    ),
    drawCommandCapacity: Math.max(
      0,
      Math.floor(
        (wasmState.drawCommandBuffer.count - wl.DRAW_COMMAND_HEADER_FIELDS) /
          wl.DRAW_COMMAND_FIELDS
      )
    ),
    entryIndexBuffer: undefined,
    entrySolveModeBuffer: undefined,
    entryScreenFromBuffer: undefined,
    entryScreenToBuffer: undefined,
    entryScreenAngleBuffer: undefined,
    entryRotateDegBuffer: undefined,
    entryFinalRotateDegBuffer: undefined,
    entryRotationFromBuffer: undefined,
    entryRotationToBuffer: undefined,
    entryRotationDurationBuffer: undefined,
    entryFinalRotationFromBuffer: undefined,
    entryFinalRotationToBuffer: undefined,
    entryFinalRotationDurationBuffer: undefined,
  };
  return buffers;
};

describe('states', () => {
  it('expands command buffer and updates headers', async () => {
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const wasmState = createWasmState(
      resolveWasmExports(instance, 'f32'),
      'f32'
    );

    try {
      const buffers = createBufferAccess(wasmState);
      const initialCapacity = buffers.commandBufferCapacity;
      const required = initialCapacity + 10;
      let resizeCount = 0;
      const recordResize = (count: number) => {
        resizeCount += count;
      };
      const commandUsed = 64;
      const commandCount = 2;

      ensureCommandCapacity(
        wasmState,
        buffers,
        required,
        commandUsed,
        commandCount,
        recordResize
      );

      expect(buffers.commandBufferCapacity).toBeGreaterThanOrEqual(required);
      expect(resizeCount).toBeGreaterThan(0);
      expect(buffers.commandBuffer[cl.COMMAND_BUFFER_USED_OFFSET]).toBe(
        commandUsed
      );
      expect(
        buffers.commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET]
      ).toBe(commandCount);
    } finally {
      wasmState.release();
    }
  });
});

describe('states (renderer integration)', () => {
  it('stores scaling limits in the shared camera buffer', () => {
    const { gl } = createFakeGL();
    const { instance, state } = createFakeWasmModule();
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance,
      {
        logger,
        spriteScaling: {
          minScaleDistance: 30,
          maxScaleDistance: 10,
        },
        polylineScaling: {
          maxScaleDistance: 0,
        },
      }
    );

    try {
      const context = Array.from(state.contexts.values())[0];
      if (!context) {
        throw new Error('Missing wasm context state.');
      }
      expect(
        context.cameraState[wl.CAMERA_SPRITE_SCALING_MIN_DISTANCE_OFFSET]
      ).toBe(10);
      expect(
        context.cameraState[wl.CAMERA_SPRITE_SCALING_MAX_DISTANCE_OFFSET]
      ).toBe(30);
      expect(
        context.cameraState[wl.CAMERA_POLYLINE_SCALING_MIN_DISTANCE_OFFSET]
      ).toBe(0);
      expect(
        context.cameraState[wl.CAMERA_POLYLINE_SCALING_MAX_DISTANCE_OFFSET]
      ).toBe(getUnlimitedDistanceScalingMaxDistanceForWasm('f32'));
      expect(logger.warn).toHaveBeenCalledTimes(2);
    } finally {
      renderer.release();
    }
  });

  it('stores unlimited scaling limits as finite sentinels in real wasm', async () => {
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const resolvedUnlimitedScaling = resolveDistanceScalingOptions({
      maxScaleDistance: Number.POSITIVE_INFINITY,
    }).resolved;

    for (const precision of ['f32', 'f64'] as const) {
      const wasmState = createWasmState(
        resolveWasmExports(instance, precision),
        precision
      );

      try {
        const buffers = createBufferAccess(wasmState);
        const wasmScaling = resolveDistanceScalingOptionsForWasm(
          resolvedUnlimitedScaling,
          precision
        );
        const configured = wasmState.exports.set_scaling_options(
          wasmState.contextPtr,
          wasmScaling.minScaleDistance,
          wasmScaling.maxScaleDistance,
          wasmScaling.minScaleDistance,
          wasmScaling.maxScaleDistance
        );

        expect(configured).toBe(1);

        const cameraBuffer = readCameraStateBuffer(wasmState, buffers);
        const expectedUnlimitedMaxDistance =
          getUnlimitedDistanceScalingMaxDistanceForWasm(precision);

        expect(cameraBuffer[wl.CAMERA_SPRITE_SCALING_MAX_DISTANCE_OFFSET]).toBe(
          expectedUnlimitedMaxDistance
        );
        expect(
          cameraBuffer[wl.CAMERA_POLYLINE_SCALING_MAX_DISTANCE_OFFSET]
        ).toBe(expectedUnlimitedMaxDistance);
        expect(
          Number.isFinite(
            cameraBuffer[wl.CAMERA_SPRITE_SCALING_MAX_DISTANCE_OFFSET]
          )
        ).toBe(true);
        expect(
          Number.isFinite(
            cameraBuffer[wl.CAMERA_POLYLINE_SCALING_MAX_DISTANCE_OFFSET]
          )
        ).toBe(true);
      } finally {
        wasmState.release();
      }
    }
  });

  it('skips interpolation when values are unchanged', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const addPromise = renderer.addSprite(
        {
          sx: { value: 10 },
          sy: { value: 20 },
          elements: [{ imageId: 'sprite', scale: { value: 1 } }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const interpolation = {
        mode: 'feedback' as const,
        durationMs: 1000,
        easing: { type: 'linear' as const },
      };
      const updatePromise = renderer.updateSprite(
        spriteId,
        {
          sx: { value: 10, interpolation },
          sy: { value: 20, interpolation },
          elements: [
            {
              scale: { value: 1, interpolation },
              anchorX: { value: 0, interpolation },
              anchorY: { value: 0, interpolation },
            },
          ],
        },
        true
      ) as Promise<void>;
      renderer.render();
      await updatePromise;

      const state = renderer.getSpriteState(spriteId);
      expect(state.sx.interpolation).toBeUndefined();
      expect(state.sy.interpolation).toBeUndefined();
      const element = state.elements[0]!;
      expect(element.scale.interpolation).toBeUndefined();
      expect(element.anchorX.interpolation).toBeUndefined();
      expect(element.anchorY.interpolation).toBeUndefined();
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('reads sprite state from wasm buffers', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'base', createFakeBitmap(64, 32));
      await renderer.registerImage(atlasId, 'child', createFakeBitmap(32, 16));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 10 },
          sy: { value: 20 },
          sz: 3,
          opacity: { value: 0.5 },
          elements: [
            {
              imageId: 'base',
              scale: { value: 1.5 },
              anchorX: { value: 0.25 },
              anchorY: { value: 0.75 },
              layer: 1.9,
              order: 4.9,
            },
            {
              imageId: 'child',
              originLocation: { index: 0 },
              shiftDistance: { value: 5 },
              shiftAngleDeg: { value: 90 },
              scale: { value: 2 },
              opacity: { value: 0.8 },
              rotation: { value: 45 },
              autoDirection: { space: 'world', minDistance: 0 },
              layer: 2.4,
              order: 1.1,
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.sx.value, 10);
      expectCloseTo(state.sy.value, 20);
      expectCloseTo(state.sz, 3);
      expectCloseTo(state.opacity.value, 0.5);
      expect(state.sx.interpolation).toBeUndefined();
      expect(state.sy.interpolation).toBeUndefined();
      expect(state.opacity.interpolation).toBeUndefined();

      expect(state.elements).toHaveLength(2);
      const baseState = state.elements[0]!;
      const childState = state.elements[1]!;

      expect(baseState.imageId).toBe('base');
      expect(baseState.originLocation.index).toBe(-1);
      expect(baseState.originLocation.useResolvedAnchor).toBe(false);
      expect(baseState.layer).toBe(1);
      expect(baseState.order).toBe(4);
      expectCloseTo(baseState.scale.value, 1.5);
      expectCloseTo(baseState.anchorX.value, 0.25);
      expectCloseTo(baseState.anchorY.value, 0.75);

      expect(childState.imageId).toBe('child');
      expect(childState.originLocation.index).toBe(0);
      expect(childState.originLocation.useResolvedAnchor).toBe(false);
      expect(childState.layer).toBe(2);
      expect(childState.order).toBe(1);
      expectCloseTo(childState.shiftDistance.value, 5);
      expectCloseTo(childState.shiftAngleDeg.value, 90);
      expectCloseTo(childState.scale.value, 2);
      expectCloseTo(childState.opacity.value, 0.8);
      expectCloseTo(childState.rotation.value, 45);
      expectCloseTo(childState.autoDirection.finalRotateDeg, 45);
      expect(childState.autoDirection.space).toBe('world');
      expect(childState.autoDirection.mode).toBeUndefined();
      expectCloseTo(childState.autoDirection.minDistance, 0);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('reads sprite snapshot timestamp and viewport position with optional timestamp overrides', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      renderer.updateCamera({
        position: {
          x: { value: 0 },
          y: { value: 0 },
          z: { value: 40 },
        },
      });
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(32, 32));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 10 },
          sy: { value: 20 },
          sz: 0,
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      timeState.nowMs = 100;
      renderer.render();
      const spriteId = await addPromise;

      const updatePromise = renderer.updateSprite(
        spriteId,
        {
          sx: {
            value: 110,
            interpolation: {
              mode: 'feedback',
              durationMs: 1000,
              easing: { type: 'linear' },
            },
          },
        },
        true
      ) as Promise<void>;
      renderer.render();
      await updatePromise;

      const snapshotState = renderer.getSpriteState(spriteId);
      expect(snapshotState.timestampMs).toBe(100);
      expect(snapshotState.viewportBasePosition).toBeDefined();
      const projected = renderer.projectWorldToViewport({
        x: snapshotState.sx.value,
        y: snapshotState.sy.value,
        z: snapshotState.sz,
      });
      expect(projected).toBeDefined();
      expectCloseTo(
        snapshotState.viewportBasePosition!.xPixel,
        projected!.xPixel,
        1.0e-3
      );
      expectCloseTo(
        snapshotState.viewportBasePosition!.yPixel,
        projected!.yPixel,
        1.0e-3
      );

      timeState.nowMs = 600;
      const omittedState = renderer.getSpriteState(spriteId);
      const zeroState = renderer.getSpriteState(spriteId, 0);
      const overrideState = renderer.getSpriteState(spriteId, 600);

      expect(omittedState.timestampMs).toBe(100);
      expect(zeroState.timestampMs).toBe(100);
      expectCloseTo(omittedState.sx.value, 10, 1.0e-3);
      expectCloseTo(zeroState.sx.value, 10, 1.0e-3);
      expect(overrideState.timestampMs).toBe(600);
      expectCloseTo(overrideState.sx.value, 60, 1.0e-3);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('reads and clears sprite visibilityDistance while keeping base opacity', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    renderer.updateCamera({
      position: {
        x: { value: 0 },
        y: { value: 0 },
        z: { value: 40 },
      },
    });
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(32, 32));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          sz: 0,
          opacity: { value: 0.5 },
          visibilityDistance: 20,
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      let state = renderer.getSpriteState(spriteId);
      expect(state.visibilityDistance).toBe(20);
      expectCloseTo(state.opacity.value, 0.5);
      expect(state.opacity.interpolation).toBeUndefined();

      const clearPromise = renderer.updateSprite(
        spriteId,
        { visibilityDistance: null },
        true
      ) as Promise<void>;
      renderer.render();
      await clearPromise;

      state = renderer.getSpriteState(spriteId);
      expect(state.visibilityDistance).toBeUndefined();
      expectCloseTo(state.opacity.value, 0.5);
      expect(state.opacity.interpolation).toBeUndefined();
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('keeps element base opacity state while visibilityDistance uses render opacity', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    renderer.updateCamera({
      position: {
        x: { value: 0 },
        y: { value: 0 },
        z: { value: 40 },
      },
    });
    const atlasId = allocateDefaultAtlas(renderer);
    const interpolation = {
      mode: 'feedback' as const,
      durationMs: 1000,
      easing: { type: 'linear' as const },
    };

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(32, 32));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          sz: 0,
          visibilityDistance: 20,
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const opacityUpdate = renderer.updateSprite(
        spriteId,
        {
          elements: [{ opacity: { value: 0.8, interpolation } }],
        },
        true
      ) as Promise<void>;
      renderer.render();
      await opacityUpdate;

      timeState.nowMs = 500;
      renderer.render();
      let element = renderer.getSpriteState(spriteId).elements[0]!;
      expectCloseTo(element.opacity.value, 0.9, 1.0e-3);
      expect(element.opacity.interpolation).toBeDefined();

      const hidePromise = renderer.updateSprite(
        spriteId,
        { visibilityDistance: 5 },
        true
      ) as Promise<void>;
      renderer.render();
      await hidePromise;

      element = renderer.getSpriteState(spriteId).elements[0]!;
      expectCloseTo(element.opacity.value, 0.9, 1.0e-3);
      expect(element.opacity.interpolation).toBeDefined();

      timeState.nowMs = 1000;
      renderer.render();
      element = renderer.getSpriteState(spriteId).elements[0]!;
      expectCloseTo(element.opacity.value, 0.8, 1.0e-3);
      expect(element.opacity.interpolation).toBeUndefined();
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('animates scale and anchor updates with interpolation', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const addPromise = renderer.addSprite(
        {
          sx: { value: 10 },
          sy: { value: 20 },
          elements: [
            {
              imageId: 'sprite',
              scale: { value: 1 },
              anchorX: { value: 0 },
              anchorY: { value: 0 },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const interpolation = {
        mode: 'feedback' as const,
        durationMs: 1000,
        easing: { type: 'linear' as const },
      };
      const updatePromise = renderer.updateSprite(
        spriteId,
        {
          elements: [
            {
              scale: { value: 2, interpolation },
              anchorX: { value: 1, interpolation },
              anchorY: { value: -1, interpolation },
            },
          ],
        },
        true
      ) as Promise<void>;
      renderer.render();
      await updatePromise;

      const initialState = renderer.getSpriteState(spriteId);
      const initialElement = initialState.elements[0]!;
      expectCloseTo(initialElement.scale.value, 1);
      expectCloseTo(initialElement.anchorX.value, 0);
      expectCloseTo(initialElement.anchorY.value, 0);
      expect(initialElement.scale.interpolation).toBeDefined();
      expect(initialElement.anchorX.interpolation).toBeDefined();
      expect(initialElement.anchorY.interpolation).toBeDefined();

      timeState.nowMs = 500;
      renderer.render();
      const midState = renderer.getSpriteState(spriteId);
      const midElement = midState.elements[0]!;
      expectCloseTo(midElement.scale.value, 1.5);
      expectCloseTo(midElement.anchorX.value, 0.5);
      expectCloseTo(midElement.anchorY.value, -0.5);
      expect(midElement.scale.interpolation).toBeDefined();

      timeState.nowMs = 1000;
      renderer.render();
      const endState = renderer.getSpriteState(spriteId);
      const endElement = endState.elements[0]!;
      expectCloseTo(endElement.scale.value, 2);
      expectCloseTo(endElement.anchorX.value, 1);
      expectCloseTo(endElement.anchorY.value, -1);
      expect(endElement.scale.interpolation).toBeUndefined();
      expect(endElement.anchorX.interpolation).toBeUndefined();
      expect(endElement.anchorY.interpolation).toBeUndefined();
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('restarts sprite interpolation when omitted', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const interpolation = {
        mode: 'feedback' as const,
        durationMs: 1000,
        easing: { type: 'linear' as const },
      };
      const firstUpdate = renderer.updateSprite(
        spriteId,
        { sx: { value: 100, interpolation } },
        true
      ) as Promise<void>;
      renderer.render();
      await firstUpdate;

      let state = renderer.getSpriteState(spriteId);
      expect(state.sx.interpolation).toBeDefined();

      timeState.nowMs = 500;
      renderer.render();
      state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.sx.value, 50, 1.0);

      const restartUpdate = renderer.updateSprite(
        spriteId,
        { sx: { value: 200 } },
        true
      ) as Promise<void>;
      renderer.render();
      await restartUpdate;

      state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.sx.value, 50, 1.0);
      expect(state.sx.interpolation).toBeDefined();

      timeState.nowMs = 1000;
      renderer.render();
      state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.sx.value, 125, 1.0);

      timeState.nowMs = 1500;
      renderer.render();
      state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.sx.value, 200, 1.0);
      expect(state.sx.interpolation).toBeUndefined();
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('restarts element interpolation when omitted', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite', scale: { value: 1 } }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const interpolation = {
        mode: 'feedback' as const,
        durationMs: 1000,
        easing: { type: 'linear' as const },
      };
      const firstUpdate = renderer.updateSprite(
        spriteId,
        { elements: [{ scale: { value: 2, interpolation } }] },
        true
      ) as Promise<void>;
      renderer.render();
      await firstUpdate;

      let element = renderer.getSpriteState(spriteId).elements[0]!;
      expect(element.scale.interpolation).toBeDefined();

      timeState.nowMs = 500;
      renderer.render();
      element = renderer.getSpriteState(spriteId).elements[0]!;
      expectCloseTo(element.scale.value, 1.5, 1.0);

      const restartUpdate = renderer.updateSprite(
        spriteId,
        { elements: [{ scale: { value: 3 } }] },
        true
      ) as Promise<void>;
      renderer.render();
      await restartUpdate;

      element = renderer.getSpriteState(spriteId).elements[0]!;
      expectCloseTo(element.scale.value, 1.5, 1.0);
      expect(element.scale.interpolation).toBeDefined();

      timeState.nowMs = 1000;
      renderer.render();
      element = renderer.getSpriteState(spriteId).elements[0]!;
      expectCloseTo(element.scale.value, 2.25, 1.0);

      timeState.nowMs = 1500;
      renderer.render();
      element = renderer.getSpriteState(spriteId).elements[0]!;
      expectCloseTo(element.scale.value, 3, 1.0);
      expect(element.scale.interpolation).toBeUndefined();
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('restarts polyline interpolation when omitted', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );

    try {
      const addPromise = renderer.addPolyline(
        {
          nodes: [
            { x: 0, y: 0, thickness: 1 },
            { x: 10, y: 0, thickness: 1 },
          ],
          opacity: { value: 1 },
          color: '#ff0000',
        },
        true
      ) as Promise<number>;
      renderer.render();
      const polylineId = await addPromise;

      const interpolation = {
        mode: 'feedback' as const,
        durationMs: 1000,
        easing: { type: 'linear' as const },
      };
      const firstUpdate = renderer.updatePolyline(
        polylineId,
        { opacity: { value: 0, interpolation } },
        true
      ) as Promise<void>;
      renderer.render();
      await firstUpdate;

      timeState.nowMs = 500;
      renderer.render();
      let state = renderer.getPolylineState(polylineId);
      expectCloseTo(state.opacity.value, 0.5, 0.1);

      const restartUpdate = renderer.updatePolyline(
        polylineId,
        { opacity: { value: 1 } },
        true
      ) as Promise<void>;
      renderer.render();
      await restartUpdate;

      state = renderer.getPolylineState(polylineId);
      expectCloseTo(state.opacity.value, 0.5, 0.1);
      expect(state.opacity.interpolation).toBeDefined();

      timeState.nowMs = 1000;
      renderer.render();
      state = renderer.getPolylineState(polylineId);
      expectCloseTo(state.opacity.value, 0.75, 0.1);

      timeState.nowMs = 1500;
      renderer.render();
      state = renderer.getPolylineState(polylineId);
      expectCloseTo(state.opacity.value, 1, 0.1);
      expect(state.opacity.interpolation).toBeUndefined();
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('updates polyline opacity interpolation parameters without value', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );

    try {
      const addPromise = renderer.addPolyline(
        {
          nodes: [
            { x: 0, y: 0, thickness: 1 },
            { x: 10, y: 0, thickness: 1 },
          ],
          opacity: { value: 0 },
          color: '#ff0000',
        },
        true
      ) as Promise<number>;
      renderer.render();
      const polylineId = await addPromise;

      const interpolation = {
        mode: 'feedback' as const,
        durationMs: 1000,
        easing: { type: 'linear' as const },
      };
      const firstUpdate = renderer.updatePolyline(
        polylineId,
        { opacity: { value: 1, interpolation } },
        true
      ) as Promise<void>;
      renderer.render();
      await firstUpdate;

      timeState.nowMs = 500;
      renderer.render();
      let state = renderer.getPolylineState(polylineId);
      expectCloseTo(state.opacity.value, 0.5, 0.1);

      const updatedInterpolation = {
        mode: 'feedback' as const,
        durationMs: 2000,
        easing: { type: 'linear' as const },
      };
      const updateParams = renderer.updatePolyline(
        polylineId,
        { opacity: { interpolation: updatedInterpolation } },
        true
      ) as Promise<void>;
      renderer.render();
      await updateParams;

      state = renderer.getPolylineState(polylineId);
      expectCloseTo(state.opacity.value, 0.5, 0.1);
      expect(state.opacity.interpolation).toBeDefined();

      timeState.nowMs = 1500;
      renderer.render();
      state = renderer.getPolylineState(polylineId);
      expectCloseTo(state.opacity.value, 0.75, 0.1);

      timeState.nowMs = 2500;
      renderer.render();
      state = renderer.getPolylineState(polylineId);
      expectCloseTo(state.opacity.value, 1, 0.1);
      expect(state.opacity.interpolation).toBeUndefined();
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('reads polyline snapshot timestamp with optional timestamp overrides', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );

    try {
      const addPromise = renderer.addPolyline(
        {
          nodes: [
            { x: 0, y: 0, thickness: 1 },
            { x: 10, y: 0, thickness: 1 },
          ],
          opacity: { value: 1 },
          color: '#ff0000',
        },
        true
      ) as Promise<number>;
      timeState.nowMs = 100;
      renderer.render();
      const polylineId = await addPromise;

      const updatePromise = renderer.updatePolyline(
        polylineId,
        {
          opacity: {
            value: 0,
            interpolation: {
              mode: 'feedback',
              durationMs: 1000,
              easing: { type: 'linear' },
            },
          },
        },
        true
      ) as Promise<void>;
      renderer.render();
      await updatePromise;

      const snapshotState = renderer.getPolylineState(polylineId);
      expect(snapshotState.timestampMs).toBe(100);
      expectCloseTo(snapshotState.opacity.value, 1, 1.0e-3);

      timeState.nowMs = 600;
      const omittedState = renderer.getPolylineState(polylineId);
      const zeroState = renderer.getPolylineState(polylineId, 0);
      const overrideState = renderer.getPolylineState(polylineId, 600);

      expect(omittedState.timestampMs).toBe(100);
      expect(zeroState.timestampMs).toBe(100);
      expectCloseTo(omittedState.opacity.value, 1, 1.0e-3);
      expectCloseTo(zeroState.opacity.value, 1, 1.0e-3);
      expect(overrideState.timestampMs).toBe(600);
      expectCloseTo(overrideState.opacity.value, 0.5, 1.0e-3);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('clears interpolation config when null is specified', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const interpolation = {
        mode: 'feedback' as const,
        durationMs: 1000,
        easing: { type: 'linear' as const },
      };
      const firstUpdate = renderer.updateSprite(
        spriteId,
        { sx: { value: 100, interpolation } },
        true
      ) as Promise<void>;
      renderer.render();
      await firstUpdate;

      const clearUpdate = renderer.updateSprite(
        spriteId,
        { sx: { value: 50, interpolation: null } },
        true
      ) as Promise<void>;
      renderer.render();
      await clearUpdate;

      let state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.sx.value, 50);
      expect(state.sx.interpolation).toBeUndefined();

      const immediateUpdate = renderer.updateSprite(
        spriteId,
        { sx: { value: 150 } },
        true
      ) as Promise<void>;
      renderer.render();
      await immediateUpdate;

      state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.sx.value, 150);
      expect(state.sx.interpolation).toBeUndefined();

      timeState.nowMs = 500;
      renderer.render();
      state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.sx.value, 150);
      expect(state.sx.interpolation).toBeUndefined();
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('ignores updates without value or interpolation', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const interpolation = {
        mode: 'feedback' as const,
        durationMs: 1000,
        easing: { type: 'linear' as const },
      };
      const firstUpdate = renderer.updateSprite(
        spriteId,
        { sx: { value: 100, interpolation } },
        true
      ) as Promise<void>;
      renderer.render();
      await firstUpdate;

      timeState.nowMs = 500;
      renderer.render();
      let state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.sx.value, 50, 1.0);

      const noopUpdate = renderer.updateSprite(
        spriteId,
        { sx: {} },
        true
      ) as Promise<void>;
      renderer.render();
      await noopUpdate;

      timeState.nowMs = 750;
      renderer.render();
      state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.sx.value, 75, 1.0);
      expect(state.sx.interpolation).toBeDefined();
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('updates sprite interpolation parameters without value', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const interpolation = {
        mode: 'feedback' as const,
        durationMs: 1000,
        easing: { type: 'linear' as const },
      };
      const firstUpdate = renderer.updateSprite(
        spriteId,
        { sx: { value: 100, interpolation } },
        true
      ) as Promise<void>;
      renderer.render();
      await firstUpdate;

      timeState.nowMs = 500;
      renderer.render();
      let state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.sx.value, 50, 1.0);

      const updatedInterpolation = {
        mode: 'feedback' as const,
        durationMs: 2000,
        easing: { type: 'linear' as const },
      };
      const updateParams = renderer.updateSprite(
        spriteId,
        { sx: { interpolation: updatedInterpolation } },
        true
      ) as Promise<void>;
      renderer.render();
      await updateParams;

      state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.sx.value, 50, 1.0);
      expect(state.sx.interpolation).toBeDefined();

      timeState.nowMs = 1500;
      renderer.render();
      state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.sx.value, 75, 1.0);

      timeState.nowMs = 2500;
      renderer.render();
      state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.sx.value, 100, 1.0);
      expect(state.sx.interpolation).toBeUndefined();
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('updates sprite opacity interpolation parameters without value', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          opacity: { value: 0 },
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const interpolation = {
        mode: 'feedback' as const,
        durationMs: 1000,
        easing: { type: 'linear' as const },
      };
      const firstUpdate = renderer.updateSprite(
        spriteId,
        { opacity: { value: 1, interpolation } },
        true
      ) as Promise<void>;
      renderer.render();
      await firstUpdate;

      timeState.nowMs = 500;
      renderer.render();
      let state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.opacity.value, 0.5, 0.1);

      const updatedInterpolation = {
        mode: 'feedback' as const,
        durationMs: 2000,
        easing: { type: 'linear' as const },
      };
      const updateParams = renderer.updateSprite(
        spriteId,
        { opacity: { interpolation: updatedInterpolation } },
        true
      ) as Promise<void>;
      renderer.render();
      await updateParams;

      state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.opacity.value, 0.5, 0.1);
      expect(state.opacity.interpolation).toBeDefined();

      timeState.nowMs = 1500;
      renderer.render();
      state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.opacity.value, 0.75, 0.1);

      timeState.nowMs = 2500;
      renderer.render();
      state = renderer.getSpriteState(spriteId);
      expectCloseTo(state.opacity.value, 1, 0.1);
      expect(state.opacity.interpolation).toBeUndefined();
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('updates element rotation interpolation without value', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite', rotation: { value: 0 } }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const interpolation = {
        mode: 'feedback' as const,
        durationMs: 1000,
        easing: { type: 'linear' as const },
      };
      const firstUpdate = renderer.updateSprite(
        spriteId,
        { elements: [{ rotation: { value: 90, interpolation } }] },
        true
      ) as Promise<void>;
      renderer.render();
      await firstUpdate;

      timeState.nowMs = 500;
      renderer.render();
      let element = renderer.getSpriteState(spriteId).elements[0]!;
      expectCloseTo(element.rotation.value, 45, 1.0);

      const updatedInterpolation = {
        mode: 'feedback' as const,
        durationMs: 2000,
        easing: { type: 'linear' as const },
      };
      const updateParams = renderer.updateSprite(
        spriteId,
        { elements: [{ rotation: { interpolation: updatedInterpolation } }] },
        true
      ) as Promise<void>;
      renderer.render();
      await updateParams;

      element = renderer.getSpriteState(spriteId).elements[0]!;
      expectCloseTo(element.rotation.value, 45, 1.0);
      expect(element.rotation.interpolation).toBeDefined();

      timeState.nowMs = 1500;
      renderer.render();
      element = renderer.getSpriteState(spriteId).elements[0]!;
      expectCloseTo(element.rotation.value, 67.5, 1.0);

      timeState.nowMs = 2500;
      renderer.render();
      element = renderer.getSpriteState(spriteId).elements[0]!;
      expectCloseTo(element.rotation.value, 90, 1.0);
      expect(element.rotation.interpolation).toBeUndefined();
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('keeps final rotation interpolation when updating value without interpolation', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [
            {
              imageId: 'sprite',
              rotation: { value: 0 },
              autoDirection: {
                space: 'world',
                mode: { type: 'rotation' },
                minDistance: 0,
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      renderer.render();

      const interpolation = {
        mode: 'feedback' as const,
        durationMs: 1000,
        easing: { type: 'linear' as const },
      };
      const setInterpolation = renderer.updateSprite(
        spriteId,
        { elements: [{ rotation: { value: 0, interpolation } }] },
        true
      ) as Promise<void>;
      renderer.render();
      await setInterpolation;

      const keepInterpolation = renderer.updateSprite(
        spriteId,
        { elements: [{ rotation: { value: 0 } }] },
        true
      ) as Promise<void>;
      renderer.render();
      await keepInterpolation;

      timeState.nowMs = 100;
      const moveSprite = renderer.updateSprite(
        spriteId,
        { sx: { value: 100 } },
        true
      ) as Promise<void>;
      renderer.render();
      await moveSprite;

      let element = renderer.getSpriteState(spriteId).elements[0]!;
      expectCloseTo(Math.abs(element.autoDirection.finalRotateDeg), 0, 1.0);

      timeState.nowMs = 600;
      renderer.render();
      element = renderer.getSpriteState(spriteId).elements[0]!;
      expectCloseTo(Math.abs(element.autoDirection.finalRotateDeg), 45, 5.0);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('detects auto-direction in parent_local space from base local movement only', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    const createPlacement = (
      space: 'world' | 'parent_local'
    ): SpritePlacement => ({
      sx: { value: 0 },
      sy: { value: 0 },
      elements: [
        {
          imageId: 'sprite',
        },
        {
          imageId: 'sprite',
          originLocation: { index: 0 },
          shiftDistance: { value: 10 },
          shiftAngleDeg: { value: 90 },
          rotation: { value: 0 },
          autoDirection: {
            space,
            mode: { type: 'rotation' },
            minDistance: 0,
          },
        },
      ],
    });

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const worldAdd = renderer.addSprite(
        createPlacement('world'),
        true
      ) as Promise<number>;
      const parentLocalAdd = renderer.addSprite(
        createPlacement('parent_local'),
        true
      ) as Promise<number>;
      renderer.render();
      const worldSpriteId = await worldAdd;
      const parentLocalSpriteId = await parentLocalAdd;

      renderer.render();

      const moveWorld = renderer.updateSprite(
        worldSpriteId,
        { sx: { value: 100 } },
        true
      ) as Promise<void>;
      const moveParentLocal = renderer.updateSprite(
        parentLocalSpriteId,
        { sx: { value: 100 } },
        true
      ) as Promise<void>;
      renderer.render();
      await moveWorld;
      await moveParentLocal;

      const worldChild = renderer.getSpriteState(worldSpriteId).elements[1]!;
      expect(worldChild.autoDirection.space).toBe('world');
      expectCloseTo(worldChild.autoDirection.directionDeg, 90, 1.0e-3);
      expectCloseTo(worldChild.autoDirection.finalRotateDeg, 90, 1.0e-3);

      const parentLocalChild =
        renderer.getSpriteState(parentLocalSpriteId).elements[1]!;
      expect(parentLocalChild.autoDirection.space).toBe('parent_local');
      expectCloseTo(parentLocalChild.autoDirection.directionDeg, 0, 1.0e-3);
      expectCloseTo(parentLocalChild.autoDirection.finalRotateDeg, 0, 1.0e-3);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('resets auto-direction runtime when switching observation space', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [
            {
              imageId: 'sprite',
            },
            {
              imageId: 'sprite',
              originLocation: { index: 0 },
              shiftDistance: { value: 10 },
              shiftAngleDeg: { value: 90 },
              rotation: { value: 0 },
              autoDirection: {
                space: 'world',
                mode: { type: 'rotation' },
                minDistance: 0,
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      renderer.render();

      const moveWorld = renderer.updateSprite(
        spriteId,
        { sx: { value: 100 } },
        true
      ) as Promise<void>;
      renderer.render();
      await moveWorld;

      let child = renderer.getSpriteState(spriteId).elements[1]!;
      expectCloseTo(child.autoDirection.directionDeg, 90, 1.0e-3);
      expect(child.autoDirection.space).toBe('world');

      const switchSpace = renderer.updateSprite(
        spriteId,
        {
          elements: [
            undefined,
            {
              autoDirection: {
                space: 'parent_local',
              },
            },
          ],
        },
        true
      ) as Promise<void>;
      renderer.render();
      await switchSpace;

      child = renderer.getSpriteState(spriteId).elements[1]!;
      expect(child.autoDirection.space).toBe('parent_local');
      expectCloseTo(child.autoDirection.directionDeg, 0, 1.0e-3);
      expectCloseTo(child.autoDirection.finalRotateDeg, 0, 1.0e-3);

      const moveParentLocal = renderer.updateSprite(
        spriteId,
        { sx: { value: 200 } },
        true
      ) as Promise<void>;
      renderer.render();
      await moveParentLocal;

      child = renderer.getSpriteState(spriteId).elements[1]!;
      expectCloseTo(child.autoDirection.directionDeg, 0, 1.0e-3);
      expectCloseTo(child.autoDirection.finalRotateDeg, 0, 1.0e-3);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('keeps sprite ids stable after removals', async () => {
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const firstPromise = renderer.addSprite(
        {
          sx: { value: 10 },
          sy: { value: 20 },
          elements: [{ imageId: 'sprite', scale: { value: 1 } }],
        },
        true
      ) as Promise<number>;
      const secondPromise = renderer.addSprite(
        {
          sx: { value: 30 },
          sy: { value: 40 },
          elements: [{ imageId: 'sprite', scale: { value: 1 } }],
        },
        true
      ) as Promise<number>;

      renderer.render();

      const firstId = await firstPromise;
      const secondId = await secondPromise;

      const removePromise = renderer.removeSprite(
        firstId,
        true
      ) as Promise<void>;
      renderer.render();
      await removePromise;

      const state = renderer.getSpriteState(secondId);
      expectCloseTo(state.sx.value, 30);
      expectCloseTo(state.sy.value, 40);
    } finally {
      renderer.release();
    }
  });

  it('keeps polyline ids stable after removals', async () => {
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );

    try {
      const firstPromise = renderer.addPolyline(
        {
          nodes: [
            { x: 0, y: 0, thickness: 1 },
            { x: 10, y: 0, thickness: 1 },
          ],
          color: '#ff0000',
        },
        true
      ) as Promise<number>;
      const secondPromise = renderer.addPolyline(
        {
          nodes: [
            { x: 5, y: 5, thickness: 2 },
            { x: 15, y: 5, thickness: 2 },
            { x: 25, y: 5, thickness: 2 },
          ],
          color: '#00ff00',
        },
        true
      ) as Promise<number>;

      renderer.render();

      const firstId = await firstPromise;
      const secondId = await secondPromise;

      const removePromise = renderer.removePolyline(
        firstId,
        true
      ) as Promise<void>;
      renderer.render();
      await removePromise;

      const state = renderer.getPolylineState(secondId);
      expect(state.nodes.length).toBe(3);
      expectCloseTo(state.nodes[0]!.x, 5);
      expectCloseTo(state.nodes[0]!.y, 5);
    } finally {
      renderer.release();
    }
  });

  it('stores polyline join and cap correction state across updates', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );

    try {
      const addPromise = renderer.addPolyline(
        {
          nodes: [
            { x: 0, y: 0, thickness: 2 },
            { x: 10, y: 0, thickness: 2 },
            { x: 20, y: 10, thickness: 2 },
          ],
          color: '#ff0000',
          joinCorrection: { type: 'fan', intermediatePointCount: 2 },
          capCorrection: { type: 'fan', pointCount: 1 },
        },
        true
      ) as Promise<number>;
      renderer.render();
      const polylineId = await addPromise;

      let state = renderer.getPolylineState(polylineId);
      expect(state.joinCorrection).toEqual({
        type: 'fan',
        intermediatePointCount: 2,
      });
      expect(state.capCorrection).toEqual({
        type: 'fan',
        pointCount: 1,
      });

      const joinUpdate = renderer.updatePolyline(
        polylineId,
        { joinCorrection: { type: 'none' } },
        true
      ) as Promise<void>;
      renderer.render();
      await joinUpdate;

      state = renderer.getPolylineState(polylineId);
      expect(state.joinCorrection).toEqual({ type: 'none' });
      expect(state.capCorrection).toEqual({
        type: 'fan',
        pointCount: 1,
      });

      const capUpdate = renderer.updatePolyline(
        polylineId,
        { capCorrection: { type: 'fan', pointCount: 3 } },
        true
      ) as Promise<void>;
      renderer.render();
      await capUpdate;

      state = renderer.getPolylineState(polylineId);
      expect(state.joinCorrection).toEqual({ type: 'none' });
      expect(state.capCorrection).toEqual({
        type: 'fan',
        pointCount: 3,
      });
    } finally {
      renderer.release();
    }
  });

  it('interpolates camera position and preserves unspecified axes', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(16, 16));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      renderer.updateCamera({
        position: {
          x: { value: 0 },
          y: { value: 0 },
          z: { value: 100 },
        },
        rotation: {
          yaw: { value: 0 },
          pitch: { value: 0 },
          roll: { value: 0 },
        },
        fovY: { value: 45 },
        near: 0.1,
        far: 500,
      });
      renderer.render();

      renderer.updateCamera({
        position: {
          x: {
            value: 100,
            interpolation: {
              mode: 'feedback',
              durationMs: 1000,
              easing: { type: 'linear' },
            },
          },
        },
      });
      renderer.render();

      let camera = renderer.getCameraState();
      expect(camera.position.x.value).toBeCloseTo(0, 6);

      timeState.nowMs = 500;
      renderer.render();
      camera = renderer.getCameraState();
      expect(camera.position.x.value).toBeCloseTo(50, 1);

      renderer.updateCamera({ position: { z: { value: 150 } } });
      renderer.render();
      camera = renderer.getCameraState();
      expect(camera.position.z.value).toBeCloseTo(150, 6);

      timeState.nowMs = 750;
      renderer.render();
      camera = renderer.getCameraState();
      expect(camera.position.x.value).toBeCloseTo(75, 1);

      timeState.nowMs = 1000;
      renderer.render();
      camera = renderer.getCameraState();
      expect(camera.position.x.value).toBeCloseTo(100, 1);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('updates camera position interpolation parameters without value', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(16, 16));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      renderer.updateCamera({
        position: {
          x: { value: 0 },
          y: { value: 0 },
          z: { value: 100 },
        },
        rotation: {
          yaw: { value: 0 },
          pitch: { value: 0 },
          roll: { value: 0 },
        },
        fovY: { value: 45 },
        near: 0.1,
        far: 500,
      });
      renderer.render();

      renderer.updateCamera({
        position: {
          x: {
            value: 100,
            interpolation: {
              mode: 'feedback',
              durationMs: 1000,
              easing: { type: 'linear' },
            },
          },
        },
      });
      renderer.render();

      timeState.nowMs = 500;
      renderer.render();
      let camera = renderer.getCameraState();
      expect(camera.position.x.value).toBeCloseTo(50, 1);

      renderer.updateCamera({
        position: {
          x: {
            interpolation: {
              mode: 'feedback',
              durationMs: 2000,
              easing: { type: 'linear' },
            },
          },
        },
      });
      renderer.render();

      camera = renderer.getCameraState();
      expect(camera.position.x.value).toBeCloseTo(50, 1);
      expect(camera.position.x.interpolation).toBeDefined();

      timeState.nowMs = 1000;
      renderer.render();
      camera = renderer.getCameraState();
      expect(camera.position.x.value).toBeCloseTo(62.5, 1);

      timeState.nowMs = 2500;
      renderer.render();
      camera = renderer.getCameraState();
      expect(camera.position.x.value).toBeCloseTo(100, 1);
      expect(camera.position.x.interpolation).toBeUndefined();
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('interpolates camera fov and keeps interpolation when omitted', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(16, 16));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      renderer.updateCamera({
        position: {
          x: { value: 0 },
          y: { value: 0 },
          z: { value: 100 },
        },
        rotation: {
          yaw: { value: 0 },
          pitch: { value: 0 },
          roll: { value: 0 },
        },
        fovY: { value: 45 },
        near: 0.1,
        far: 500,
      });
      renderer.render();

      renderer.updateCamera({
        fovY: {
          value: 90,
          interpolation: {
            mode: 'feedback',
            durationMs: 1000,
            easing: { type: 'linear' },
          },
        },
      });
      renderer.render();

      let camera = renderer.getCameraState();
      expect(camera.fovY.value).toBeCloseTo(45, 6);
      expect(camera.fovY.interpolation).toBeDefined();

      timeState.nowMs = 250;
      renderer.updateCamera({ position: { x: { value: 10 } } });
      renderer.render();
      camera = renderer.getCameraState();
      expect(camera.fovY.value).toBeCloseTo(56.25, 2);
      expect(camera.fovY.interpolation).toBeDefined();

      timeState.nowMs = 500;
      renderer.render();
      camera = renderer.getCameraState();
      expect(camera.fovY.value).toBeCloseTo(67.5, 2);
      expect(camera.fovY.interpolation).toBeDefined();

      timeState.nowMs = 1000;
      renderer.render();
      camera = renderer.getCameraState();
      expect(camera.fovY.value).toBeCloseTo(90, 2);
      expect(camera.fovY.interpolation).toBeUndefined();
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('updates camera interpolation parameters without value', async () => {
    timeState.nowMs = 0;
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(16, 16));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      renderer.updateCamera({
        position: {
          x: { value: 0 },
          y: { value: 0 },
          z: { value: 100 },
        },
        rotation: {
          yaw: { value: 0 },
          pitch: { value: 0 },
          roll: { value: 0 },
        },
        fovY: { value: 45 },
        near: 0.1,
        far: 500,
      });
      renderer.render();

      renderer.updateCamera({
        fovY: {
          value: 90,
          interpolation: {
            mode: 'feedback',
            durationMs: 1000,
            easing: { type: 'linear' },
          },
        },
      });
      renderer.render();

      timeState.nowMs = 500;
      renderer.render();
      let camera = renderer.getCameraState();
      expect(camera.fovY.value).toBeCloseTo(67.5, 2);

      renderer.updateCamera({
        fovY: {
          interpolation: {
            mode: 'feedback',
            durationMs: 2000,
            easing: { type: 'linear' },
          },
        },
      });
      renderer.render();

      camera = renderer.getCameraState();
      expect(camera.fovY.value).toBeCloseTo(67.5, 2);
      expect(camera.fovY.interpolation).toBeDefined();

      timeState.nowMs = 1500;
      renderer.render();
      camera = renderer.getCameraState();
      expect(camera.fovY.value).toBeCloseTo(78.75, 2);

      timeState.nowMs = 2500;
      renderer.render();
      camera = renderer.getCameraState();
      expect(camera.fovY.value).toBeCloseTo(90, 2);
      expect(camera.fovY.interpolation).toBeUndefined();
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('returns camera state via getCameraState', () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );

    renderer.updateCamera({
      position: {
        x: { value: 1 },
        y: { value: 2 },
        z: { value: 3 },
      },
      rotation: {
        yaw: { value: 10 },
        pitch: { value: 20 },
        roll: { value: 30 },
      },
      fovY: { value: 55 },
      near: 0.25,
      far: 1500,
    });
    renderer.setViewPortSize({ widthPixel: 200, heightPixel: 100 });
    renderer.render();

    const camera = renderer.getCameraState();
    expect(camera.position.x.value).toBeCloseTo(1, 6);
    expect(camera.position.y.value).toBeCloseTo(2, 6);
    expect(camera.position.z.value).toBeCloseTo(3, 6);
    expect(camera.rotation.yaw.value).toBeCloseTo(10, 6);
    expect(camera.rotation.pitch.value).toBeCloseTo(20, 6);
    expect(camera.rotation.roll.value).toBeCloseTo(30, 6);
    expect(camera.fovY.value).toBeCloseTo(55, 6);
    expect(camera.near).toBeCloseTo(0.25, 6);
    expect(camera.far).toBeCloseTo(1500, 6);
    expect(camera.aspectRatio).toBeCloseTo(2.0, 6);
  });
});
