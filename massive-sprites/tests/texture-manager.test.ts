// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import {
  __resetTextGlyphWorkerForTests,
  renderTextGlyphSource,
} from '../src/text';
import type {
  TextGlyphWorkerRequest,
  TextGlyphWorkerResponse,
} from '../src/text-renderer';
import { renderTextGlyphCanvasSource } from '../src/text-renderer';
import {
  createTextureManager,
  DEFAULT_TEXTURE_SAMPLING_OPTIONS,
  MAX_TEXTURE_SAMPLING_OPTIONS,
  MIN_TEXTURE_SAMPLING_OPTIONS,
} from '../src/texture';
import {
  createFakeBitmap,
  createFakeGL,
} from './helpers/object-renderer-test-kit';

const createQueueRecorder = () => {
  const calls: Array<{
    texIndex: number;
    width: number;
    height: number;
    valid: boolean;
    pageId: number;
    u0: number;
    v0: number;
    u1: number;
    v1: number;
  }> = [];
  const tiledCalls: Array<{
    texIndex: number;
    width: number;
    height: number;
    valid: boolean;
    tileCount: number;
  }> = [];
  const tileCalls: Array<{
    texIndex: number;
    tileIndex: number;
    pageId: number;
    u0: number;
    v0: number;
    u1: number;
    v1: number;
    leftRatio: number;
    topRatio: number;
    rightRatio: number;
    bottomRatio: number;
  }> = [];
  let pickMaskPageTableBuffer = new Int32Array(4);
  let pickMaskWordBuffer = new Int32Array(4);
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
    calls.push({
      texIndex,
      width,
      height,
      valid,
      pageId,
      u0,
      v0,
      u1,
      v1,
    });
  };
  const queueSetTiledTextureInfo = (
    texIndex: number,
    width: number,
    height: number,
    valid: boolean,
    tileCount: number
  ) => {
    tiledCalls.push({
      texIndex,
      width,
      height,
      valid,
      tileCount,
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
    tileCalls.push({
      texIndex,
      tileIndex,
      pageId,
      u0,
      v0,
      u1,
      v1,
      leftRatio,
      topRatio,
      rightRatio,
      bottomRatio,
    });
  };
  const acquirePickMaskPageTableBuffer = (requiredCount: number) => {
    if (requiredCount > pickMaskPageTableBuffer.length) {
      const next = new Int32Array(requiredCount);
      next.set(pickMaskPageTableBuffer);
      pickMaskPageTableBuffer = next;
    }
    return pickMaskPageTableBuffer;
  };
  const acquirePickMaskWordBuffer = (requiredCount: number) => {
    if (requiredCount > pickMaskWordBuffer.length) {
      const next = new Int32Array(requiredCount);
      next.set(pickMaskWordBuffer);
      pickMaskWordBuffer = next;
    }
    return pickMaskWordBuffer;
  };
  return {
    calls,
    tiledCalls,
    tileCalls,
    get pickMaskPageTableBuffer() {
      return pickMaskPageTableBuffer;
    },
    get pickMaskWordBuffer() {
      return pickMaskWordBuffer;
    },
    queueSetTextureInfo,
    queueSetTiledTextureInfo,
    queueSetTextureTileInfo,
    acquirePickMaskPageTableBuffer,
    acquirePickMaskWordBuffer,
  };
};

const createRawRgbaSource = (
  width: number,
  height: number,
  alphaAt: (x: number, y: number) => number
) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset + 0] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alphaAt(x, y);
    }
  }
  return { width, height, data } as unknown as TexImageSource;
};

const installFakeOffscreenCanvas = () => {
  const parseFontSize = (font: string | undefined) => {
    if (!font) {
      return 16;
    }
    const match = /([0-9]+(?:\.[0-9]+)?)px/.exec(font);
    if (!match) {
      return 16;
    }
    const parsed = Number.parseFloat(match[1] ?? '');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 16;
  };
  const FakeOffscreenCanvas = class {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext(type: string) {
      if (type !== '2d') {
        return null;
      }
      let currentFont = '16px sans-serif';
      return {
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
        lineCap: 'butt',
        lineWidth: 1,
        fillStyle: '#000000',
        strokeStyle: '#000000',
        textAlign: 'left',
        textBaseline: 'alphabetic',
        beginPath: () => {},
        clearRect: () => {},
        save: () => {},
        translate: () => {},
        scale: () => {},
        rect: () => {},
        moveTo: () => {},
        lineTo: () => {},
        quadraticCurveTo: () => {},
        fill: () => {},
        stroke: () => {},
        drawImage: () => {},
        restore: () => {},
        fillText: () => {},
        measureText: (text: string) => {
          const fontSize = parseFontSize(currentFont);
          const glyphCount = Array.from(text).length;
          const width = fontSize * 0.6 * glyphCount;
          return {
            width,
            actualBoundingBoxAscent: fontSize * 0.8,
            actualBoundingBoxDescent: fontSize * 0.2,
          };
        },
        set font(value: string) {
          currentFont = value;
        },
        get font() {
          return currentFont;
        },
      } as unknown as OffscreenCanvasRenderingContext2D;
    }
  };
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
};

const installRecordingOffscreenCanvas = () => {
  const parseFontSize = (font: string | undefined) => {
    if (!font) {
      return 16;
    }
    const match = /([0-9]+(?:\.[0-9]+)?)px/.exec(font);
    if (!match) {
      return 16;
    }
    const parsed = Number.parseFloat(match[1] ?? '');
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 16;
  };
  const contexts: Array<{ operations: Array<{ op: string; args: number[] }> }> =
    [];
  const FakeOffscreenCanvas = class {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext(type: string) {
      if (type !== '2d') {
        return null;
      }
      let currentFont = '16px sans-serif';
      const operations: Array<{ op: string; args: number[] }> = [];
      contexts.push({ operations });
      return {
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
        lineCap: 'butt',
        lineWidth: 1,
        fillStyle: '#000000',
        strokeStyle: '#000000',
        textAlign: 'left',
        textBaseline: 'alphabetic',
        beginPath: () => {},
        clearRect: () => {},
        save: () => {},
        translate: (x: number, y: number) => {
          operations.push({ op: 'translate', args: [x, y] });
        },
        scale: (x: number, y: number) => {
          operations.push({ op: 'scale', args: [x, y] });
        },
        rect: () => {},
        moveTo: () => {},
        lineTo: () => {},
        quadraticCurveTo: () => {},
        fill: () => {},
        stroke: () => {},
        drawImage: () => {
          operations.push({ op: 'drawImage', args: [] });
        },
        restore: () => {},
        fillText: () => {},
        measureText: (text: string) => {
          const fontSize = parseFontSize(currentFont);
          const glyphCount = Array.from(text).length;
          const width = fontSize * 0.6 * glyphCount;
          return {
            width,
            actualBoundingBoxAscent: fontSize * 0.8,
            actualBoundingBoxDescent: fontSize * 0.2,
          };
        },
        set font(value: string) {
          currentFont = value;
        },
        get font() {
          return currentFont;
        },
      } as unknown as OffscreenCanvasRenderingContext2D;
    }
  };
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  return contexts;
};

const installFakeTextGlyphWorker = (
  resolveResponse: (
    request: TextGlyphWorkerRequest
  ) => Promise<TextGlyphWorkerResponse> | TextGlyphWorkerResponse
) => {
  const workers: Array<{
    readonly postedMessages: TextGlyphWorkerRequest[];
    terminated: boolean;
  }> = [];

  if (typeof OffscreenCanvas !== 'function') {
    const FakeOffscreenCanvas = class {
      constructor(_width: number, _height: number) {}
      getContext() {
        throw new Error('Main-thread canvas rendering should not be used.');
      }
    };
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
  }

  const FakeWorker = class {
    readonly postedMessages: TextGlyphWorkerRequest[] = [];
    readonly listeners = new Map<string, Set<(event: unknown) => void>>();
    terminated = false;

    constructor(_source: string | URL, _options?: WorkerOptions) {
      workers.push(this);
    }

    addEventListener(type: string, listener: (event: unknown) => void) {
      const existing = this.listeners.get(type);
      if (existing) {
        existing.add(listener);
        return;
      }
      this.listeners.set(type, new Set([listener]));
    }

    postMessage(message: TextGlyphWorkerRequest) {
      this.postedMessages.push(message);
      Promise.resolve(resolveResponse(message))
        .then((response) => {
          this.emit('message', { data: response });
        })
        .catch((error) => {
          this.emit('error', {
            error,
            message: error instanceof Error ? error.message : String(error),
          });
        });
    }

    terminate() {
      this.terminated = true;
    }

    emit(type: string, event: unknown) {
      const listeners = this.listeners.get(type);
      if (!listeners) {
        return;
      }
      for (const listener of listeners) {
        listener(event);
      }
    }
  };

  vi.stubGlobal('Worker', FakeWorker as unknown as typeof Worker);

  return workers;
};

describe('texture manager', () => {
  it('exposes anisotropy defaults on sampling presets', () => {
    expect(MAX_TEXTURE_SAMPLING_OPTIONS.maxAnisotropy).toBe(16);
    expect(MIN_TEXTURE_SAMPLING_OPTIONS.maxAnisotropy).toBe(1);
    expect(DEFAULT_TEXTURE_SAMPLING_OPTIONS.maxAnisotropy).toBe(4);
  });

  it('registers and unregisters images with lookups', async () => {
    const { gl, calls: glCalls } = createFakeGL();
    const recorder = createQueueRecorder();
    const { calls: textureCalls } = recorder;
    const manager = createTextureManager(recorder);
    manager.attachWebGL(gl);
    const atlasId = manager.allocateAtlas({
      widthPixel: 128,
      heightPixel: 128,
    });

    await manager.registerImage(
      atlasId,
      'sprite',
      createFakeBitmap(16, 16),
      false,
      undefined
    );

    const texIndex = manager.resolveTextureIndex('sprite');
    expect(typeof texIndex).toBe('number');
    expect(texIndex).not.toBeUndefined();
    expect(manager.resolveImageIdByTexIndex(texIndex as number)).toBe('sprite');

    const lastRegistered = textureCalls[textureCalls.length - 1];
    expect(lastRegistered).toBeDefined();
    expect(lastRegistered?.valid).toBe(true);

    const pageId = lastRegistered?.pageId ?? -1;
    expect(manager.resolveTextureByPageId(pageId)).not.toBeUndefined();

    manager.unregisterImage('sprite');

    expect(manager.resolveTextureIndex('sprite')).toBeUndefined();
    if (texIndex !== undefined) {
      expect(manager.resolveImageIdByTexIndex(texIndex)).toBeUndefined();
    }

    const lastUnregistered = textureCalls[textureCalls.length - 1];
    expect(lastUnregistered?.valid).toBe(false);
    expect(lastUnregistered?.pageId).toBe(-1);

    manager.releaseAtlas(atlasId);
    expect(glCalls.deleteTexture).toBe(1);

    manager.release();
  });

  it('builds and clears atlas pick-mask buffers from alpha-thresholded uploads', async () => {
    const recorder = createQueueRecorder();
    const manager = createTextureManager(recorder);
    const atlasId = manager.allocateAtlas({
      widthPixel: 4,
      heightPixel: 4,
      paddingPixel: 0,
      pickMask: { alphaThreshold: 128 },
    });

    await manager.registerImage(
      atlasId,
      'masked',
      createRawRgbaSource(4, 4, (x, y) => {
        const alphas = [
          [255, 0, 255, 0],
          [0, 255, 0, 255],
          [255, 255, 0, 0],
          [0, 0, 255, 255],
        ];
        return alphas[y]?.[x] ?? 0;
      }),
      false,
      undefined
    );

    expect(Array.from(recorder.pickMaskPageTableBuffer.slice(0, 4))).toEqual([
      0, 4, 4, 4,
    ]);
    expect(Array.from(recorder.pickMaskWordBuffer.slice(0, 16))).toEqual([
      5, 0, 0, 0, 10, 0, 0, 0, 3, 0, 0, 0, 12, 0, 0, 0,
    ]);

    manager.unregisterImage('masked');

    expect(Array.from(recorder.pickMaskWordBuffer.slice(0, 16))).toEqual(
      new Array<number>(16).fill(0)
    );

    manager.release();
  });

  it('uploads pending images when attaching WebGL', async () => {
    const { gl, calls: glCalls } = createFakeGL();
    const manager = createTextureManager(createQueueRecorder());
    const atlasId = manager.allocateAtlas({
      widthPixel: 128,
      heightPixel: 128,
    });

    await manager.registerImage(
      atlasId,
      'sprite',
      createFakeBitmap(16, 16),
      false,
      undefined
    );

    expect(glCalls.texSubImage2D).toBe(0);
    expect(manager.resolveTextureByPageId(0)).toBeUndefined();

    manager.attachWebGL(gl);

    expect(glCalls.texSubImage2D).toBe(1);
    expect(manager.resolveTextureByPageId(0)).not.toBeUndefined();

    manager.release();
  });

  it('applies atlas default resize when registering images', async () => {
    installFakeOffscreenCanvas();
    const { gl, calls: glCalls } = createFakeGL();
    const manager = createTextureManager(createQueueRecorder());
    manager.attachWebGL(gl);
    const atlasId = manager.allocateAtlas({
      widthPixel: 256,
      heightPixel: 256,
      defaultImageResize: {
        maxWidth: 32,
        maxHeight: 32,
        mode: 'contain',
      },
    });

    try {
      await manager.registerImage(
        atlasId,
        'sprite',
        createFakeBitmap(64, 32),
        false,
        undefined
      );
      const latest =
        glCalls.texSubImageSizes[glCalls.texSubImageSizes.length - 1];
      expect(latest).toEqual({ width: 32, height: 16 });
    } finally {
      manager.release();
      vi.unstubAllGlobals();
    }
  });

  it('uses logical size while resizing uploads', async () => {
    installFakeOffscreenCanvas();
    const { gl, calls: glCalls } = createFakeGL();
    const recorder = createQueueRecorder();
    const { calls: textureCalls } = recorder;
    const manager = createTextureManager(recorder);
    manager.attachWebGL(gl);
    const atlasId = manager.allocateAtlas({
      widthPixel: 256,
      heightPixel: 256,
    });

    try {
      await manager.registerImage(
        atlasId,
        'sprite',
        createFakeBitmap(100, 100),
        false,
        {
          resize: { maxWidth: 50, maxHeight: 50, mode: 'contain' },
          logicalSize: { widthPixel: 80, heightPixel: 40 },
        }
      );

      const latest =
        glCalls.texSubImageSizes[glCalls.texSubImageSizes.length - 1];
      expect(latest).toEqual({ width: 50, height: 50 });

      const lastTextureCall = textureCalls[textureCalls.length - 1];
      expect(lastTextureCall?.width).toBe(80);
      expect(lastTextureCall?.height).toBe(40);
    } finally {
      manager.release();
      vi.unstubAllGlobals();
    }
  });

  it('registers text glyphs with logical size', async () => {
    installFakeOffscreenCanvas();
    const { gl, calls: glCalls } = createFakeGL();
    const recorder = createQueueRecorder();
    const { calls: textureCalls } = recorder;
    const manager = createTextureManager(recorder);
    manager.attachWebGL(gl);
    const atlasId = manager.allocateAtlas({
      widthPixel: 256,
      heightPixel: 256,
    });

    try {
      await manager.registerTextGlyph(
        atlasId,
        'label',
        'Hello',
        { lineHeightPixel: 20 },
        { fontSizePixelHint: 10, renderPixelRatio: 2 }
      );

      const latestUpload =
        glCalls.texSubImageSizes[glCalls.texSubImageSizes.length - 1];
      expect(latestUpload).toEqual({ width: 60, height: 40 });

      const lastTextureCall = textureCalls[textureCalls.length - 1];
      expect(lastTextureCall?.width).toBe(30);
      expect(lastTextureCall?.height).toBe(20);
    } finally {
      manager.release();
      vi.unstubAllGlobals();
    }
  });

  it('flips text glyph sources vertically before upload', async () => {
    const contexts = installRecordingOffscreenCanvas();
    try {
      await renderTextGlyphSource(
        'Flip',
        { lineHeightPixel: 20 },
        { fontSizePixelHint: 10 }
      );
      const flipContext = contexts.find((ctx) =>
        ctx.operations.some(
          (entry) => entry.op === 'scale' && entry.args[1] === -1
        )
      );
      expect(flipContext).toBeTruthy();
      expect(
        flipContext?.operations.some((entry) => entry.op === 'drawImage')
      ).toBe(true);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('skips pre-flip when preparing worker bitmap source', () => {
    const contexts = installRecordingOffscreenCanvas();
    try {
      renderTextGlyphCanvasSource(
        'Flip',
        { lineHeightPixel: 20 },
        { fontSizePixelHint: 10 },
        false
      );
      const flipContext = contexts.find((ctx) =>
        ctx.operations.some(
          (entry) => entry.op === 'scale' && entry.args[1] === -1
        )
      );
      expect(flipContext).toBeFalsy();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses text glyph worker when supported', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 });

    const fakeBitmap = { width: 12, height: 34 } as unknown as ImageBitmap;
    const workers = installFakeTextGlyphWorker((request) => ({
      type: 'success',
      requestId: request.requestId,
      bitmap: fakeBitmap,
      logicalSize: { widthPixel: 11, heightPixel: 22 },
      uploadSize: { widthPixel: 12, heightPixel: 34 },
    }));

    try {
      const result = await renderTextGlyphSource(
        'Worker',
        { lineHeightPixel: 20 },
        undefined
      );

      expect(result.source).toBe(fakeBitmap);
      expect(result.logicalSize).toEqual({ widthPixel: 11, heightPixel: 22 });
      expect(result.uploadSize).toEqual({ widthPixel: 12, heightPixel: 34 });
      expect(workers).toHaveLength(1);
      expect(workers[0]?.postedMessages[0]?.text).toBe('Worker');
      expect(workers[0]?.terminated).toBe(false);
    } finally {
      __resetTextGlyphWorkerForTests();
      vi.unstubAllGlobals();
    }
  });

  it('distributes concurrent text glyph requests across worker pool', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 16 });

    const fakeBitmap = { width: 12, height: 34 } as unknown as ImageBitmap;
    const resolveResponses: Array<() => void> = [];
    const workers = installFakeTextGlyphWorker(
      (request) =>
        new Promise<TextGlyphWorkerResponse>((resolve) => {
          resolveResponses.push(() => {
            resolve({
              type: 'success',
              requestId: request.requestId,
              bitmap: fakeBitmap,
              logicalSize: { widthPixel: 11, heightPixel: 22 },
              uploadSize: { widthPixel: 12, heightPixel: 34 },
            });
          });
        })
    );

    try {
      const tasks = Array.from({ length: 5 }, (_, index) =>
        renderTextGlyphSource(
          `Worker-${index}`,
          { lineHeightPixel: 20 },
          undefined
        )
      );

      expect(workers).toHaveLength(4);
      expect(workers.map((worker) => worker.postedMessages.length)).toEqual([
        2, 1, 1, 1,
      ]);

      for (const resolveResponse of resolveResponses) {
        resolveResponse();
      }

      const results = await Promise.all(tasks);
      expect(results).toHaveLength(5);
    } finally {
      __resetTextGlyphWorkerForTests();
      vi.unstubAllGlobals();
    }
  });

  it('falls back to current-thread rendering when text glyph worker fails', async () => {
    vi.stubGlobal('navigator', { hardwareConcurrency: 2 });
    installFakeOffscreenCanvas();
    const workers = installFakeTextGlyphWorker((request) => ({
      type: 'error',
      requestId: request.requestId,
      message: 'worker failed',
    }));

    try {
      const result = await renderTextGlyphSource(
        'Hello',
        { lineHeightPixel: 20 },
        { fontSizePixelHint: 10 }
      );

      expect(result.logicalSize).toEqual({ widthPixel: 30, heightPixel: 20 });
      expect(result.uploadSize).toEqual({ widthPixel: 30, heightPixel: 20 });
      expect(workers).toHaveLength(1);
      expect(workers[0]?.terminated).toBe(true);
    } finally {
      __resetTextGlyphWorkerForTests();
      vi.unstubAllGlobals();
    }
  });

  it('queues set_texture_info values on registerImage', async () => {
    const recorder = createQueueRecorder();
    const { calls: textureCalls } = recorder;
    const manager = createTextureManager(recorder);
    const atlasId = manager.allocateAtlas({
      widthPixel: 128,
      heightPixel: 128,
    });

    await manager.registerImage(
      atlasId,
      'sprite',
      createFakeBitmap(64, 32),
      false,
      undefined
    );

    expect(textureCalls.length).toBe(1);
    const call = textureCalls[0]!;
    expect(call.valid).toBe(true);
    expect(call.width).toBe(64);
    expect(call.height).toBe(32);
    expect(call.pageId).toBe(0);
    expect(call.u0).toBeGreaterThanOrEqual(0);
    expect(call.v0).toBeGreaterThanOrEqual(0);
    expect(call.u1).toBeGreaterThan(call.u0);
    expect(call.v1).toBeGreaterThan(call.v0);

    manager.release();
  });

  it('uses a standalone page when the image exceeds the atlas but fits MAX_TEXTURE_SIZE', async () => {
    const { gl, calls: glCalls, setMaxTextureSize } = createFakeGL();
    setMaxTextureSize(128);
    const recorder = createQueueRecorder();
    const { calls: textureCalls, tiledCalls, tileCalls } = recorder;
    const manager = createTextureManager(recorder);
    manager.attachWebGL(gl);
    const atlasId = manager.allocateAtlas({
      widthPixel: 32,
      heightPixel: 32,
    });

    try {
      await manager.registerImage(
        atlasId,
        'standalone',
        createFakeBitmap(96, 80),
        false,
        undefined
      );

      expect(textureCalls).toHaveLength(1);
      expect(textureCalls[0]?.valid).toBe(true);
      expect(textureCalls[0]?.width).toBe(96);
      expect(textureCalls[0]?.height).toBe(80);
      expect(tiledCalls).toHaveLength(0);
      expect(tileCalls).toHaveLength(0);
      expect(glCalls.texImageSizes[0]).toEqual({ width: 96, height: 80 });
      expect(glCalls.texSubImageSizes[0]).toEqual({ width: 96, height: 80 });
    } finally {
      manager.release();
    }
  });

  it('tiles images that exceed MAX_TEXTURE_SIZE and clears tiled metadata on unregister', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(
        async (
          _source: CanvasImageSource,
          _x: number,
          _y: number,
          width: number,
          height: number
        ) => createFakeBitmap(width, height)
      )
    );
    const { gl, calls: glCalls, setMaxTextureSize } = createFakeGL();
    setMaxTextureSize(64);
    const recorder = createQueueRecorder();
    const { calls: textureCalls, tiledCalls, tileCalls } = recorder;
    const manager = createTextureManager(recorder);
    manager.attachWebGL(gl);
    const atlasId = manager.allocateAtlas({
      widthPixel: 32,
      heightPixel: 32,
    });

    try {
      await manager.registerImage(
        atlasId,
        'giant',
        createFakeBitmap(150, 90),
        false,
        undefined
      );

      const texIndex = manager.resolveTextureIndex('giant');
      expect(texIndex).toBeTypeOf('number');
      expect(textureCalls).toHaveLength(0);
      expect(tiledCalls).toHaveLength(1);
      expect(tiledCalls[0]).toMatchObject({
        width: 150,
        height: 90,
        valid: true,
        tileCount: 6,
      });
      expect(tileCalls).toHaveLength(6);
      expect(
        tileCalls.every(
          (call) =>
            call.pageId >= 0 &&
            call.u1 > call.u0 &&
            call.v1 > call.v0 &&
            call.leftRatio < call.rightRatio &&
            call.topRatio < call.bottomRatio
        )
      ).toBe(true);
      expect(glCalls.texImageSizes).toHaveLength(6);
      expect(
        glCalls.texImageSizes.every(
          (size) => size.width <= 64 && size.height <= 64
        )
      ).toBe(true);
      expect(glCalls.texSubImageSizes).toHaveLength(6);
      expect(
        texIndex !== undefined
          ? manager.resolveTextureOutputPartCountByTexIndex(texIndex)
          : 0
      ).toBe(6);

      manager.unregisterImage('giant');

      expect(tiledCalls[tiledCalls.length - 1]).toMatchObject({
        texIndex,
        width: 0,
        height: 0,
        valid: false,
        tileCount: 0,
      });
      expect(manager.resolveTextureIndex('giant')).toBeUndefined();
      expect(glCalls.deleteTexture).toBe(6);
    } finally {
      manager.release();
      vi.unstubAllGlobals();
    }
  });

  it('generates mipmaps lazily per atlas', async () => {
    const { gl, calls: glCalls } = createFakeGL();
    const recorder = createQueueRecorder();
    const { calls: textureCalls } = recorder;
    const manager = createTextureManager(recorder);
    manager.attachWebGL(gl);

    const mipmapAtlasId = manager.allocateAtlas({
      widthPixel: 128,
      heightPixel: 128,
      textureSampling: { minFilter: 'linearMipmapLinear' },
    });
    const linearAtlasId = manager.allocateAtlas({
      widthPixel: 128,
      heightPixel: 128,
      textureSampling: { minFilter: 'linear' },
    });

    await manager.registerImage(
      mipmapAtlasId,
      'sprite-mipmap',
      createFakeBitmap(16, 16),
      false,
      undefined
    );
    await manager.registerImage(
      linearAtlasId,
      'sprite-linear',
      createFakeBitmap(16, 16),
      false,
      undefined
    );

    const mipmapPageId = textureCalls[0]?.pageId ?? -1;
    const linearPageId = textureCalls[1]?.pageId ?? -1;

    expect(glCalls.generateMipmap).toBe(0);

    manager.ensureMipmap(mipmapPageId);
    expect(glCalls.generateMipmap).toBe(1);

    manager.ensureMipmap(mipmapPageId);
    expect(glCalls.generateMipmap).toBe(1);

    manager.ensureMipmap(linearPageId);
    expect(glCalls.generateMipmap).toBe(1);

    manager.release();
  });

  it('applies anisotropy factor when extension is available', async () => {
    const { gl, calls: glCalls, setAnisotropyExtension } = createFakeGL();
    setAnisotropyExtension(4);
    const manager = createTextureManager(createQueueRecorder());
    manager.attachWebGL(gl);

    const atlasId = manager.allocateAtlas({
      widthPixel: 128,
      heightPixel: 128,
      textureSampling: { maxAnisotropy: 8 },
    });

    await manager.registerImage(
      atlasId,
      'sprite',
      createFakeBitmap(16, 16),
      false,
      undefined
    );

    expect(glCalls.texParameterf).toEqual([[gl.TEXTURE_2D, 0x84fe, 4]]);

    manager.release();
  });

  it('skips anisotropy factor when extension is unavailable', async () => {
    const { gl, calls: glCalls } = createFakeGL();
    const manager = createTextureManager(createQueueRecorder());
    manager.attachWebGL(gl);

    const atlasId = manager.allocateAtlas({
      widthPixel: 128,
      heightPixel: 128,
      textureSampling: { maxAnisotropy: 8 },
    });

    await manager.registerImage(
      atlasId,
      'sprite',
      createFakeBitmap(16, 16),
      false,
      undefined
    );

    expect(glCalls.texParameterf).toEqual([]);

    manager.release();
  });
});
