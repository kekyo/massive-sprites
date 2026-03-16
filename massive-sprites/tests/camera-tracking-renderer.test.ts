// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { createObjectRenderer } from '../src/renderer';
import type { CameraUpdate, ObjectRenderer } from '../src/types';
import { loadWasmModule } from '../src/wasm';
import {
  createFakeBitmap,
  createFakeGL,
} from './helpers/object-renderer-test-kit';

const createRenderer = async () => {
  const { gl, calls } = createFakeGL();
  const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
  const bytes = await readFile(wasmPath);
  const instance = await loadWasmModule(bytes);
  const renderer = createObjectRenderer(
    { widthPixel: 320, heightPixel: 320 },
    instance
  );
  renderer.attachWebGL(gl);
  return { renderer, calls };
};

const registerDefaultSprite = async (
  renderer: ObjectRenderer,
  x: number,
  y: number
) => {
  const atlasId = renderer.allocateAtlas({
    widthPixel: 256,
    heightPixel: 256,
  });
  await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
  const spritePromise = renderer.addSprite(
    {
      sx: { value: x },
      sy: { value: y },
      elements: [{ imageId: 'sprite', scale: { value: 0.1 } }],
    },
    true
  ) as Promise<number>;
  renderer.render();
  const spriteId = await spritePromise;
  renderer.render();
  return spriteId;
};

const setCamera = async (renderer: ObjectRenderer, update: CameraUpdate) => {
  const cameraPromise = renderer.updateCamera(update, true) as Promise<void>;
  renderer.render();
  await cameraPromise;
  renderer.render();
};

const registerDefaultImages = async (renderer: ObjectRenderer) => {
  const atlasId = renderer.allocateAtlas({
    widthPixel: 512,
    heightPixel: 512,
  });
  await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
  await renderer.registerImage(atlasId, 'label', createFakeBitmap(400, 100));
};

const registerLabeledSprite = async (
  renderer: ObjectRenderer,
  x: number,
  y: number,
  labelOpacity: number
) => {
  const spritePromise = renderer.addSprite(
    {
      sx: { value: x },
      sy: { value: y },
      elements: [
        { imageId: 'sprite', scale: { value: 0.1 } },
        {
          imageId: 'label',
          scale: { value: 0.5 },
          shiftDistance: { value: 100 },
          shiftAngleDeg: { value: 90 },
          opacity: { value: labelOpacity },
        },
      ],
    },
    true
  ) as Promise<number>;
  renderer.render();
  const spriteId = await spritePromise;
  renderer.render();
  return spriteId;
};

const collectVisibleSpriteIds = (renderer: ObjectRenderer, yPixel: number) => {
  const hits = new Set<number>();
  for (let xPixel = 0; xPixel <= 320; xPixel += 8) {
    const result = renderer.pickAt(xPixel, yPixel);
    if (result?.kind === 'sprite') {
      hits.add(result.spriteId);
    }
  }
  return hits;
};

describe('renderer camera tracking', () => {
  it('applies single-target tracking in the same frame as a sprite update', async () => {
    const { renderer } = await createRenderer();
    try {
      const spriteId = await registerDefaultSprite(renderer, 0, 0);
      const cameraPromise = renderer.updateCamera(
        { position: { z: { value: 10 } } },
        true
      ) as Promise<void>;
      renderer.render();
      await cameraPromise;
      renderer.render();

      renderer.setCameraTracking({ spriteIds: [spriteId] });
      renderer.render();

      renderer.updateSprite(spriteId, {
        sx: { value: 50 },
        sy: { value: 70 },
      });
      renderer.render();

      expect(renderer.pickAt(160, 160)).toMatchObject({
        kind: 'sprite',
        spriteId,
      });
    } finally {
      renderer.release();
    }
  });

  it('fits multiple targets while keeping the current rotation', async () => {
    const { renderer } = await createRenderer();
    try {
      const atlasId = renderer.allocateAtlas({
        widthPixel: 256,
        heightPixel: 256,
      });
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const spritePromise0 = renderer.addSprite(
        {
          sx: { value: -50 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite', scale: { value: 0.1 } }],
        },
        true
      ) as Promise<number>;
      const spritePromise1 = renderer.addSprite(
        {
          sx: { value: 50 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite', scale: { value: 0.1 } }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId0 = await spritePromise0;
      const spriteId1 = await spritePromise1;
      renderer.render();

      const cameraPromise = renderer.updateCamera(
        {
          position: { z: { value: 10 } },
          fovY: { value: 90 },
        },
        true
      ) as Promise<void>;
      renderer.render();
      await cameraPromise;
      renderer.render();
      expect(collectVisibleSpriteIds(renderer, 160).size).toBe(0);

      renderer.setCameraTracking({
        spriteIds: [spriteId0, spriteId1],
        fitPadding: 1,
        fitZoomBias: 1,
      });
      renderer.render();

      const visibleSpriteIds = collectVisibleSpriteIds(renderer, 160);
      expect(visibleSpriteIds.has(spriteId0)).toBe(true);
      expect(visibleSpriteIds.has(spriteId1)).toBe(true);
    } finally {
      renderer.release();
    }
  });

  it('does not restart fit interpolation every frame', async () => {
    const { renderer } = await createRenderer();
    try {
      const atlasId = renderer.allocateAtlas({
        widthPixel: 256,
        heightPixel: 256,
      });
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const spritePromise0 = renderer.addSprite(
        {
          sx: { value: -50 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite', scale: { value: 0.1 } }],
        },
        true
      ) as Promise<number>;
      const spritePromise1 = renderer.addSprite(
        {
          sx: { value: 50 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite', scale: { value: 0.1 } }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId0 = await spritePromise0;
      const spriteId1 = await spritePromise1;
      renderer.render();

      const cameraPromise = renderer.updateCamera(
        {
          position: { z: { value: 200 } },
          fovY: { value: 90 },
        },
        true
      ) as Promise<void>;
      renderer.render();
      await cameraPromise;
      renderer.render();

      renderer.setCameraTracking({
        spriteIds: [spriteId0, spriteId1],
        fitPadding: 1,
        fitZoomBias: 1,
        interpolation: {
          mode: 'feedback',
          durationMs: 40,
          easing: { type: 'linear' },
        },
      });
      renderer.render();
      const firstZ = renderer.getCameraState().position.z.value;

      await new Promise((resolve) => setTimeout(resolve, 30));
      renderer.render();
      const secondZ = renderer.getCameraState().position.z.value;

      await new Promise((resolve) => setTimeout(resolve, 30));
      renderer.render();
      const thirdZ = renderer.getCameraState().position.z.value;

      expect(secondZ).toBeLessThan(firstZ);
      expect(thirdZ).toBeLessThan(secondZ);
      expect(thirdZ).toBeLessThan(100);
    } finally {
      renderer.release();
    }
  });

  it('advances fit tracking while tracked sprites keep moving', async () => {
    const { renderer } = await createRenderer();
    try {
      const atlasId = renderer.allocateAtlas({
        widthPixel: 256,
        heightPixel: 256,
      });
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const spritePromise0 = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite', scale: { value: 0.1 } }],
        },
        true
      ) as Promise<number>;
      const spritePromise1 = renderer.addSprite(
        {
          sx: { value: 100 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite', scale: { value: 0.1 } }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId0 = await spritePromise0;
      const spriteId1 = await spritePromise1;
      renderer.render();

      const cameraPromise = renderer.updateCamera(
        {
          position: {
            x: { value: 0 },
            y: { value: 0 },
            z: { value: 400 },
          },
          fovY: { value: 90 },
        },
        true
      ) as Promise<void>;
      renderer.render();
      await cameraPromise;
      renderer.render();

      renderer.setCameraTracking({
        spriteIds: [spriteId0, spriteId1],
        fitPadding: 1,
        fitZoomBias: 1,
        interpolation: {
          mode: 'feedback',
          durationMs: 60,
          easing: { type: 'linear' },
        },
      });
      renderer.render();
      const firstState = renderer.getCameraState();

      renderer.updateSprites([
        {
          spriteId: spriteId0,
          sx: {
            value: 200,
            interpolation: {
              mode: 'feedback',
              durationMs: 120,
              easing: { type: 'linear' },
            },
          },
        },
        {
          spriteId: spriteId1,
          sx: {
            value: 300,
            interpolation: {
              mode: 'feedback',
              durationMs: 120,
              easing: { type: 'linear' },
            },
          },
        },
      ]);
      renderer.render();

      await new Promise((resolve) => setTimeout(resolve, 40));
      renderer.render();
      const secondState = renderer.getCameraState();

      await new Promise((resolve) => setTimeout(resolve, 40));
      renderer.render();
      const thirdState = renderer.getCameraState();

      expect(secondState.position.x.value).toBeGreaterThan(
        firstState.position.x.value
      );
      expect(thirdState.position.x.value).toBeGreaterThan(
        secondState.position.x.value
      );
      expect(thirdState.position.z.value).toBeLessThan(
        firstState.position.z.value
      );
    } finally {
      renderer.release();
    }
  });

  it('enforces minDistance for clustered fit targets', async () => {
    const { renderer } = await createRenderer();
    try {
      const atlasId = renderer.allocateAtlas({
        widthPixel: 256,
        heightPixel: 256,
      });
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const spritePromise0 = renderer.addSprite(
        {
          sx: { value: -1 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite', scale: { value: 0.1 } }],
        },
        true
      ) as Promise<number>;
      const spritePromise1 = renderer.addSprite(
        {
          sx: { value: 1 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite', scale: { value: 0.1 } }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId0 = await spritePromise0;
      const spriteId1 = await spritePromise1;
      renderer.render();

      const cameraPromise = renderer.updateCamera(
        {
          position: { z: { value: 200 } },
          fovY: { value: 90 },
        },
        true
      ) as Promise<void>;
      renderer.render();
      await cameraPromise;
      renderer.render();

      renderer.setCameraTracking({
        spriteIds: [spriteId0, spriteId1],
        minDistance: 50,
        fitPadding: 1,
        fitZoomBias: 1,
      });
      renderer.render();

      expect(renderer.getCameraTrackingState()?.resolvedDistance).toBeCloseTo(
        50,
        6
      );
      expect(renderer.getCameraState().position.z.value).toBeCloseTo(50, 6);
    } finally {
      renderer.release();
    }
  });

  it('skips fully transparent sprites in base tracking', async () => {
    const { renderer } = await createRenderer();
    try {
      const atlasId = renderer.allocateAtlas({
        widthPixel: 256,
        heightPixel: 256,
      });
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const spritePromise0 = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite', scale: { value: 0.1 } }],
        },
        true
      ) as Promise<number>;
      const spritePromise1 = renderer.addSprite(
        {
          sx: { value: 200 },
          sy: { value: 0 },
          opacity: { value: 0 },
          elements: [{ imageId: 'sprite', scale: { value: 0.1 } }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId0 = await spritePromise0;
      const spriteId1 = await spritePromise1;
      renderer.render();

      await setCamera(renderer, {
        position: { x: { value: 0 }, y: { value: 0 }, z: { value: 100 } },
        fovY: { value: 90 },
      });

      renderer.setCameraTracking({
        spriteIds: [spriteId0, spriteId1],
        targetMode: 'base',
        fitPadding: 1,
        fitZoomBias: 1,
      });
      renderer.render();

      expect(renderer.getCameraState().position.x.value).toBeCloseTo(0, 6);
    } finally {
      renderer.release();
    }
  });

  it('expands single-target distance when contentApprox includes shifted elements', async () => {
    const { renderer } = await createRenderer();
    try {
      await registerDefaultImages(renderer);
      const spriteId = await registerLabeledSprite(renderer, 0, 0, 1);

      await setCamera(renderer, {
        position: { z: { value: 10 } },
        fovY: { value: 90 },
      });

      renderer.setCameraTracking({
        spriteIds: [spriteId],
        targetMode: 'base',
        distance: 10,
      });
      renderer.render();
      const baseDistance =
        renderer.getCameraTrackingState()?.resolvedDistance ?? Number.NaN;

      renderer.clearCameraTracking();
      renderer.setCameraTracking({
        spriteIds: [spriteId],
        targetMode: 'contentApprox',
        distance: 10,
      });
      renderer.render();
      const contentApproxDistance =
        renderer.getCameraTrackingState()?.resolvedDistance ?? Number.NaN;

      expect(baseDistance).toBeCloseTo(10, 6);
      expect(contentApproxDistance).toBeGreaterThan(baseDistance);
    } finally {
      renderer.release();
    }
  });

  it('ignores fully transparent child elements in contentApprox tracking', async () => {
    const { renderer } = await createRenderer();
    try {
      await registerDefaultImages(renderer);
      const visibleLabelSpriteId = await registerLabeledSprite(
        renderer,
        0,
        0,
        1
      );
      const hiddenLabelSpriteId = await registerLabeledSprite(
        renderer,
        0,
        0,
        0
      );

      await setCamera(renderer, {
        position: { z: { value: 10 } },
        fovY: { value: 90 },
      });

      renderer.setCameraTracking({
        spriteIds: [visibleLabelSpriteId],
        targetMode: 'contentApprox',
        distance: 10,
      });
      renderer.render();
      const visibleLabelDistance =
        renderer.getCameraTrackingState()?.resolvedDistance ?? Number.NaN;

      renderer.clearCameraTracking();
      await setCamera(renderer, {
        position: { x: { value: 0 }, y: { value: 0 }, z: { value: 10 } },
        fovY: { value: 90 },
      });
      renderer.setCameraTracking({
        spriteIds: [hiddenLabelSpriteId],
        targetMode: 'contentApprox',
        distance: 10,
      });
      renderer.render();
      const hiddenLabelDistance =
        renderer.getCameraTrackingState()?.resolvedDistance ?? Number.NaN;

      expect(hiddenLabelDistance).toBeCloseTo(10, 6);
      expect(visibleLabelDistance).toBeGreaterThan(hiddenLabelDistance);
    } finally {
      renderer.release();
    }
  });

  it('keeps tracking state while all contentApprox targets are hidden', async () => {
    const { renderer } = await createRenderer();
    try {
      const spriteId = await registerDefaultSprite(renderer, 0, 0);

      await setCamera(renderer, {
        position: { z: { value: 100 } },
        fovY: { value: 90 },
      });

      renderer.setCameraTracking({
        spriteIds: [spriteId],
        targetMode: 'contentApprox',
        distance: 100,
      });
      renderer.render();
      const cameraBeforeHide = renderer.getCameraState();

      renderer.updateSprite(spriteId, {
        opacity: { value: 0 },
      });
      renderer.render();
      const cameraAfterHide = renderer.getCameraState();

      renderer.render();
      const cameraAfterSecondRender = renderer.getCameraState();

      expect(renderer.getCameraTrackingState()).not.toBeNull();
      expect(cameraAfterHide.position.x.value).toBeCloseTo(
        cameraBeforeHide.position.x.value,
        6
      );
      expect(cameraAfterHide.position.y.value).toBeCloseTo(
        cameraBeforeHide.position.y.value,
        6
      );
      expect(cameraAfterHide.position.z.value).toBeCloseTo(
        cameraBeforeHide.position.z.value,
        6
      );
      expect(cameraAfterSecondRender.position.z.value).toBeCloseTo(
        cameraAfterHide.position.z.value,
        6
      );
    } finally {
      renderer.release();
    }
  });
});
