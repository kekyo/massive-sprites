// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it, vi } from 'vitest';

import { createObjectCanvasRenderer } from '../src/canvas-renderer';
import type {
  CameraUpdatePosition,
  ObjectCanvasCameraChangeEvent,
  ObjectCanvasCameraInteractionEvent,
  ObjectCanvasPickEvent,
} from '../src/types';
import { createFakeWasmModule } from './helpers/fake-wasm-module';
import {
  createFakeBitmap,
  createFakeGL,
} from './helpers/object-renderer-test-kit';

const ensureRenderableSprite = async (
  renderer: ReturnType<typeof createObjectCanvasRenderer>
) => {
  const atlasId = renderer.allocateAtlas();
  await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
  renderer.addSprite({
    sx: { value: 0 },
    sy: { value: 0 },
    elements: [{ imageId: 'sprite' }],
  });
};

const queueRenderableSprite = async (
  renderer: ReturnType<typeof createObjectCanvasRenderer>,
  x: number = 0,
  y: number = 0
) => {
  const atlasId = renderer.allocateAtlas();
  await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
  return renderer.addSprite(
    {
      sx: { value: x },
      sy: { value: y },
      elements: [{ imageId: 'sprite' }],
    },
    true
  ) as Promise<number>;
};

const createCanvas = (gl: WebGLRenderingContext) => {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const width = 200;
  const height = 150;
  const canvas = {
    width,
    height,
    clientWidth: width,
    clientHeight: height,
    getContext: (contextId: string) => (contextId === 'webgl' ? gl : null),
    addEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      const target =
        typeof listener === 'function'
          ? listener
          : listener.handleEvent.bind(listener);
      const set = listeners.get(type) ?? new Set();
      set.add(target);
      listeners.set(type, set);
    },
    removeEventListener: (
      type: string,
      listener: EventListenerOrEventListenerObject
    ) => {
      const set = listeners.get(type);
      if (!set) {
        return;
      }
      const target =
        typeof listener === 'function'
          ? listener
          : listener.handleEvent.bind(listener);
      set.delete(target);
    },
    dispatchEvent: (event: Event) => {
      const set = listeners.get(event.type);
      if (!set) {
        return false;
      }
      set.forEach((handler) => {
        handler(event);
      });
      return true;
    },
    getBoundingClientRect: () =>
      ({
        left: 0,
        top: 0,
        right: width,
        bottom: height,
        width,
        height,
      }) as DOMRect,
    setPointerCapture: () => {},
    releasePointerCapture: () => {},
  } as unknown as HTMLCanvasElement;
  return canvas;
};

const createPointerEvent = (
  type: string,
  options: {
    readonly button?: number;
    readonly pointerId?: number;
    readonly clientX?: number;
    readonly clientY?: number;
    readonly altKey?: boolean;
  }
) => {
  const event = {
    type,
    button: options.button ?? 0,
    pointerId: options.pointerId ?? 1,
    clientX: options.clientX ?? 0,
    clientY: options.clientY ?? 0,
    altKey: options.altKey ?? false,
    preventDefault: () => {},
  };
  return event as unknown as PointerEvent;
};

const createWheelEvent = (
  type: string,
  options: {
    readonly deltaY?: number;
    readonly deltaMode?: number;
    readonly clientX?: number;
    readonly clientY?: number;
  }
) => {
  const event = {
    type,
    deltaY: options.deltaY ?? 0,
    deltaMode: options.deltaMode ?? 0,
    ...(typeof options.clientX === 'number'
      ? { clientX: options.clientX }
      : {}),
    ...(typeof options.clientY === 'number'
      ? { clientY: options.clientY }
      : {}),
    preventDefault: () => {},
  };
  return event as unknown as WheelEvent;
};

const withRafOnce = () => {
  const globalRaf = globalThis as unknown as {
    requestAnimationFrame?: unknown;
    cancelAnimationFrame?: unknown;
  };
  const originalRequest = globalRaf.requestAnimationFrame;
  const originalCancel = globalRaf.cancelAnimationFrame;
  let rafId = 0;
  globalRaf.requestAnimationFrame = (callback: (time: number) => void) => {
    rafId += 1;
    if (rafId === 1) {
      callback(0);
    }
    return rafId;
  };
  globalRaf.cancelAnimationFrame = () => {};
  return () => {
    globalRaf.requestAnimationFrame = originalRequest;
    globalRaf.cancelAnimationFrame = originalCancel;
  };
};

const withRafManual = () => {
  const globalRaf = globalThis as unknown as {
    requestAnimationFrame?: unknown;
    cancelAnimationFrame?: unknown;
  };
  const originalRequest = globalRaf.requestAnimationFrame;
  const originalCancel = globalRaf.cancelAnimationFrame;
  let rafId = 0;
  const callbacks = new Map<number, (time: number) => void>();
  globalRaf.requestAnimationFrame = (callback: (time: number) => void) => {
    rafId += 1;
    callbacks.set(rafId, callback);
    return rafId;
  };
  globalRaf.cancelAnimationFrame = (id: number) => {
    callbacks.delete(id);
  };
  const flush = (time: number = 0) => {
    const pending = [...callbacks.values()];
    callbacks.clear();
    pending.forEach((callback) => {
      callback(time);
    });
  };
  const restore = () => {
    callbacks.clear();
    globalRaf.requestAnimationFrame = originalRequest;
    globalRaf.cancelAnimationFrame = originalCancel;
  };
  return { flush, restore };
};

describe('canvas renderer events', () => {
  it('notifies camera change listeners on update requests', async () => {
    const { gl } = createFakeGL();
    const canvas = createCanvas(gl);
    const { instance } = createFakeWasmModule();
    const renderer = createObjectCanvasRenderer(canvas, instance);
    const restoreRaf = withRafOnce();

    const events: ObjectCanvasCameraChangeEvent[] = [];
    const detach = renderer.onCameraChange((event) => {
      events.push(event);
    });

    await ensureRenderableSprite(renderer);

    const updatePromise = renderer.updateCamera({
      position: { x: { value: 10 } },
    }) as unknown as Promise<void>;
    const stop = renderer.start();
    stop();
    await updatePromise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    restoreRaf();

    expect(events).toHaveLength(1);
    expect(events[0]?.source).toBe('external');
    expect(events[0]?.cameraUpdate.position?.x?.value).toBe(10);

    detach();
    renderer.updateCamera({
      position: { x: { value: 20 } },
    });
    expect(events).toHaveLength(1);
  });

  it('notifies camera interaction listeners during rotation drag', async () => {
    vi.useFakeTimers();
    const { gl } = createFakeGL();
    const canvas = createCanvas(gl);
    const { instance } = createFakeWasmModule();
    const renderer = createObjectCanvasRenderer(canvas, instance);
    const restoreRaf = withRafOnce();
    const globalEvents = globalThis as unknown as {
      addEventListener?: unknown;
      removeEventListener?: unknown;
    };
    const originalAddEventListener = globalEvents.addEventListener;
    const originalRemoveEventListener = globalEvents.removeEventListener;
    globalEvents.addEventListener = () => {};
    globalEvents.removeEventListener = () => {};
    const detachControls = renderer.attachCameraControls({
      pollingIntervalMs: 10,
    });

    await ensureRenderableSprite(renderer);

    const interactionEvents: ObjectCanvasCameraInteractionEvent[] = [];
    const changeEvents: ObjectCanvasCameraChangeEvent[] = [];
    const detachInteraction = renderer.onCameraInteraction((event) => {
      interactionEvents.push(event);
    });
    const detachChange = renderer.onCameraChange((event) => {
      changeEvents.push(event);
    });

    canvas.dispatchEvent(
      createPointerEvent('pointerdown', {
        button: 2,
        pointerId: 1,
        clientX: 20,
        clientY: 30,
        altKey: true,
      })
    );
    canvas.dispatchEvent(
      createPointerEvent('pointermove', {
        button: 2,
        pointerId: 1,
        clientX: 20,
        clientY: 60,
        altKey: true,
      })
    );
    vi.advanceTimersByTime(15);
    const stop = renderer.start();
    stop();
    await Promise.resolve();
    canvas.dispatchEvent(
      createPointerEvent('pointerup', {
        button: 2,
        pointerId: 1,
        clientX: 20,
        clientY: 60,
        altKey: true,
      })
    );
    vi.runOnlyPendingTimers();

    expect(interactionEvents.some((event) => event.phase === 'start')).toBe(
      true
    );
    expect(interactionEvents.some((event) => event.phase === 'update')).toBe(
      true
    );
    expect(interactionEvents.some((event) => event.phase === 'end')).toBe(true);
    expect(interactionEvents.some((event) => event.mode === 'rotate')).toBe(
      true
    );
    expect(changeEvents.some((event) => event.source === 'interaction')).toBe(
      true
    );

    detachChange();
    detachInteraction();
    detachControls();
    restoreRaf();
    globalEvents.addEventListener = originalAddEventListener;
    globalEvents.removeEventListener = originalRemoveEventListener;
    vi.useRealTimers();
  });

  it('keeps focus point on plane during focus-plane rotation', async () => {
    vi.useFakeTimers();
    const { gl } = createFakeGL();
    const canvas = createCanvas(gl);
    const { instance } = createFakeWasmModule();
    const renderer = createObjectCanvasRenderer(canvas, instance);
    const restoreRaf = withRafOnce();
    const globalEvents = globalThis as unknown as {
      addEventListener?: unknown;
      removeEventListener?: unknown;
    };
    const originalAddEventListener = globalEvents.addEventListener;
    const originalRemoveEventListener = globalEvents.removeEventListener;
    globalEvents.addEventListener = () => {};
    globalEvents.removeEventListener = () => {};
    const detachControls = renderer.attachCameraControls({
      pollingIntervalMs: 10,
      interactionInterpolation: null,
      rotation: {
        mode: 'focusPlane',
        yaw: { enable: true, invert: false },
        pitch: { enable: true, invert: false, minDeg: 1, maxDeg: 90 },
      },
    });

    await ensureRenderableSprite(renderer);

    const updatePromise = renderer.updateCamera(
      { position: { z: { value: 10 } } },
      true
    );
    const updateStop = renderer.start();
    updateStop();
    await updatePromise;
    await Promise.resolve();
    vi.runOnlyPendingTimers();

    const startCameraState = renderer.getCameraState();

    const interactionEvents: ObjectCanvasCameraInteractionEvent[] = [];
    const detachInteraction = renderer.onCameraInteraction((event) => {
      if (event.mode === 'rotate' && event.phase === 'update') {
        interactionEvents.push(event);
      }
    });

    canvas.dispatchEvent(
      createPointerEvent('pointerdown', {
        button: 2,
        pointerId: 1,
        clientX: 100,
        clientY: 75,
        altKey: true,
      })
    );
    canvas.dispatchEvent(
      createPointerEvent('pointermove', {
        button: 2,
        pointerId: 1,
        clientX: 120,
        clientY: 105,
        altKey: true,
      })
    );
    vi.advanceTimersByTime(15);
    const stop = renderer.start();
    stop();
    await Promise.resolve();
    canvas.dispatchEvent(
      createPointerEvent('pointerup', {
        button: 2,
        pointerId: 1,
        clientX: 120,
        clientY: 105,
        altKey: true,
      })
    );
    vi.runOnlyPendingTimers();

    expect(interactionEvents.length).toBeGreaterThan(0);
    const lastEvent = interactionEvents[interactionEvents.length - 1];
    const positionUpdate = lastEvent?.cameraUpdate?.position;
    if (!positionUpdate) {
      throw new Error('Expected position update.');
    }
    const expectedX = startCameraState.position.x.value;
    const expectedY = startCameraState.position.y.value;
    const expectedZ = startCameraState.position.z.value;
    expect(positionUpdate.x?.value).toBeCloseTo(expectedX, 5);
    expect(positionUpdate.y?.value).toBeCloseTo(expectedY, 5);
    expect(positionUpdate.z?.value).toBeCloseTo(expectedZ, 5);

    detachInteraction();
    detachControls();
    restoreRaf();
    globalEvents.addEventListener = originalAddEventListener;
    globalEvents.removeEventListener = originalRemoveEventListener;
    vi.useRealTimers();
  });

  it('handles wheel zoom when camera is on the plane', async () => {
    const { gl } = createFakeGL();
    const canvas = createCanvas(gl);
    const { instance } = createFakeWasmModule();
    const renderer = createObjectCanvasRenderer(canvas, instance);
    const restoreRaf = withRafOnce();
    const globalEvents = globalThis as unknown as {
      addEventListener?: unknown;
      removeEventListener?: unknown;
    };
    const originalAddEventListener = globalEvents.addEventListener;
    const originalRemoveEventListener = globalEvents.removeEventListener;
    globalEvents.addEventListener = () => {};
    globalEvents.removeEventListener = () => {};
    const detachControls = renderer.attachCameraControls();

    await ensureRenderableSprite(renderer);

    const changeEvents: ObjectCanvasCameraChangeEvent[] = [];
    const detachChange = renderer.onCameraChange((event) => {
      changeEvents.push(event);
    });

    canvas.dispatchEvent(
      createWheelEvent('wheel', {
        deltaY: 120,
        deltaMode: 0,
        clientX: 100,
        clientY: 75,
      })
    );

    const stop = renderer.start();
    stop();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(changeEvents.some((event) => event.source === 'interaction')).toBe(
      true
    );

    detachChange();
    detachControls();
    restoreRaf();
    globalEvents.addEventListener = originalAddEventListener;
    globalEvents.removeEventListener = originalRemoveEventListener;
  });

  it('applies exponential wheel zoom scaling', async () => {
    const { gl } = createFakeGL();
    const canvas = createCanvas(gl);
    const { instance } = createFakeWasmModule();
    const renderer = createObjectCanvasRenderer(canvas, instance);
    const restoreRaf = withRafOnce();
    const globalEvents = globalThis as unknown as {
      addEventListener?: unknown;
      removeEventListener?: unknown;
    };
    const originalAddEventListener = globalEvents.addEventListener;
    const originalRemoveEventListener = globalEvents.removeEventListener;
    globalEvents.addEventListener = () => {};
    globalEvents.removeEventListener = () => {};
    const detachControls = renderer.attachCameraControls({
      interactionInterpolation: null,
    });

    await ensureRenderableSprite(renderer);
    const updatePromise = renderer.updateCamera(
      { position: { z: { value: 10 } } },
      true
    );
    const updateStop = renderer.start();
    updateStop();
    await updatePromise;
    await new Promise((resolve) => setTimeout(resolve, 0));

    const startCameraState = renderer.getCameraState();
    const toRadians = (deg: number) => (deg * Math.PI) / 180;
    const resolveForwardDirection = () => {
      const yawRad = toRadians(startCameraState.rotation.yaw.value);
      const pitchRad = toRadians(startCameraState.rotation.pitch.value);
      const rollRad = toRadians(startCameraState.rotation.roll.value);
      const cosZ = Math.cos(yawRad);
      const sinZ = Math.sin(yawRad);
      const cosX = Math.cos(pitchRad);
      const sinX = Math.sin(pitchRad);
      const cosY = Math.cos(rollRad);
      const sinY = Math.sin(rollRad);
      const forwardX = -cosZ * sinY - sinZ * sinX * cosY;
      const forwardY = -sinZ * sinY + cosZ * sinX * cosY;
      const forwardZ = -cosX * cosY;
      const length = Math.hypot(forwardX, forwardY, forwardZ);
      if (!Number.isFinite(length) || length <= 0) {
        throw new Error('Expected valid forward direction.');
      }
      return {
        x: forwardX / length,
        y: forwardY / length,
        z: forwardZ / length,
      };
    };
    const direction = resolveForwardDirection();
    if (!Number.isFinite(direction.z) || direction.z === 0) {
      throw new Error('Expected forward direction to intersect the plane.');
    }
    const planeZ = 0;
    const distanceToPlane =
      (planeZ - startCameraState.position.z.value) / direction.z;
    if (!Number.isFinite(distanceToPlane)) {
      throw new Error('Expected valid plane distance.');
    }
    const focus = {
      x: startCameraState.position.x.value + direction.x * distanceToPlane,
      y: startCameraState.position.y.value + direction.y * distanceToPlane,
      z: planeZ,
    };
    const startDistance = Math.hypot(
      focus.x - startCameraState.position.x.value,
      focus.y - startCameraState.position.y.value,
      focus.z - startCameraState.position.z.value
    );

    const updates: ObjectCanvasCameraInteractionEvent[] = [];
    const detachInteraction = renderer.onCameraInteraction((event) => {
      if (event.mode === 'wheel' && event.phase === 'update') {
        updates.push(event);
      }
    });

    const readPosition = (position: CameraUpdatePosition | undefined) => {
      if (!position) {
        throw new Error('Expected position update.');
      }
      const x = position.x?.value;
      const y = position.y?.value;
      const z = position.z?.value;
      if (x === undefined || y === undefined || z === undefined) {
        throw new Error('Expected full position update.');
      }
      return { x, y, z };
    };

    const dispatchWheel = async () => {
      canvas.dispatchEvent(
        createWheelEvent('wheel', {
          deltaY: 120,
          deltaMode: 0,
          clientX: 100,
          clientY: 75,
        })
      );
      const stop = renderer.start();
      stop();
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };

    await dispatchWheel();
    await dispatchWheel();

    expect(updates).toHaveLength(2);
    const firstPosition = readPosition(updates[0]?.cameraUpdate?.position);
    const secondPosition = readPosition(updates[1]?.cameraUpdate?.position);
    const firstDistance = Math.hypot(
      focus.x - firstPosition.x,
      focus.y - firstPosition.y,
      focus.z - firstPosition.z
    );
    const secondDistance = Math.hypot(
      focus.x - secondPosition.x,
      focus.y - secondPosition.y,
      focus.z - secondPosition.z
    );
    const ratio1 = firstDistance / startDistance;
    const ratio2 = secondDistance / firstDistance;
    expect(ratio2).toBeCloseTo(ratio1, 5);

    detachInteraction();
    detachControls();
    restoreRaf();
    globalEvents.addEventListener = originalAddEventListener;
    globalEvents.removeEventListener = originalRemoveEventListener;
  });

  it('updates tracking distance on wheel and emits tracking camera changes', async () => {
    const { gl } = createFakeGL();
    const canvas = createCanvas(gl);
    const { instance } = createFakeWasmModule();
    const renderer = createObjectCanvasRenderer(canvas, instance);
    const { flush, restore } = withRafManual();
    const globalEvents = globalThis as unknown as {
      addEventListener?: unknown;
      removeEventListener?: unknown;
    };
    const originalAddEventListener = globalEvents.addEventListener;
    const originalRemoveEventListener = globalEvents.removeEventListener;
    globalEvents.addEventListener = () => {};
    globalEvents.removeEventListener = () => {};
    const detachControls = renderer.attachCameraControls({
      interactionInterpolation: null,
    });

    const spritePromise = queueRenderableSprite(renderer);
    const spriteStart = renderer.start();
    flush();
    spriteStart();
    const spriteId = await spritePromise;
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const updatePromise = renderer.updateCamera(
      { position: { z: { value: 10 } } },
      true
    ) as Promise<void>;
    const updateStop = renderer.start();
    flush();
    updateStop();
    await updatePromise;
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    renderer.setCameraTracking({ spriteIds: [spriteId] });
    const trackingStop = renderer.start();
    flush();
    trackingStop();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const startDistance =
      renderer.getCameraTrackingState()?.resolvedDistance ?? Number.NaN;
    const changeEvents: ObjectCanvasCameraChangeEvent[] = [];
    const detachChange = renderer.onCameraChange((event) => {
      changeEvents.push(event);
    });

    canvas.dispatchEvent(
      createWheelEvent('wheel', {
        deltaY: 120,
        deltaMode: 0,
        clientX: 100,
        clientY: 75,
      })
    );
    const stop = renderer.start();
    flush();
    stop();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const nextDistance =
      renderer.getCameraTrackingState()?.resolvedDistance ?? Number.NaN;
    expect(nextDistance).toBeGreaterThan(startDistance);
    expect(changeEvents.some((event) => event.source === 'tracking')).toBe(
      true
    );

    detachChange();
    detachControls();
    restore();
    globalEvents.addEventListener = originalAddEventListener;
    globalEvents.removeEventListener = originalRemoveEventListener;
  });

  it('updates fit tracking zoom beyond minDistance on wheel', async () => {
    const { gl } = createFakeGL();
    const canvas = createCanvas(gl);
    const { instance } = createFakeWasmModule();
    const renderer = createObjectCanvasRenderer(canvas, instance);
    const { flush, restore } = withRafManual();
    const globalEvents = globalThis as unknown as {
      addEventListener?: unknown;
      removeEventListener?: unknown;
    };
    const originalAddEventListener = globalEvents.addEventListener;
    const originalRemoveEventListener = globalEvents.removeEventListener;
    globalEvents.addEventListener = () => {};
    globalEvents.removeEventListener = () => {};
    const detachControls = renderer.attachCameraControls({
      interactionInterpolation: null,
    });

    const spritePromise0 = queueRenderableSprite(renderer, -1, 0);
    const spritePromise1 = queueRenderableSprite(renderer, 1, 0);
    const spriteStart = renderer.start();
    flush();
    spriteStart();
    const spriteId0 = await spritePromise0;
    const spriteId1 = await spritePromise1;
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const updatePromise = renderer.updateCamera(
      {
        position: { z: { value: 200 } },
        fovY: { value: 90 },
      },
      true
    ) as Promise<void>;
    const updateStop = renderer.start();
    flush();
    updateStop();
    await updatePromise;
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    renderer.setCameraTracking({
      spriteIds: [spriteId0, spriteId1],
      minDistance: 50,
      fitPadding: 1,
      fitZoomBias: 1,
    });
    const trackingStop = renderer.start();
    flush();
    trackingStop();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const startDistance =
      renderer.getCameraTrackingState()?.resolvedDistance ?? Number.NaN;
    expect(startDistance).toBeCloseTo(50, 6);

    canvas.dispatchEvent(
      createWheelEvent('wheel', {
        deltaY: 120,
        deltaMode: 0,
        clientX: 100,
        clientY: 75,
      })
    );
    const stop = renderer.start();
    flush();
    stop();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    const trackingState = renderer.getCameraTrackingState();
    const nextDistance = trackingState?.resolvedDistance ?? Number.NaN;
    expect(nextDistance).toBeGreaterThan(startDistance);
    expect(trackingState?.fitZoomBias ?? 0).toBeGreaterThan(1);

    detachControls();
    restore();
    globalEvents.addEventListener = originalAddEventListener;
    globalEvents.removeEventListener = originalRemoveEventListener;
  });

  it('clears tracking when pan starts', async () => {
    const { gl } = createFakeGL();
    const canvas = createCanvas(gl);
    const { instance } = createFakeWasmModule();
    const renderer = createObjectCanvasRenderer(canvas, instance);
    const { flush, restore } = withRafManual();
    const globalEvents = globalThis as unknown as {
      addEventListener?: unknown;
      removeEventListener?: unknown;
    };
    const originalAddEventListener = globalEvents.addEventListener;
    const originalRemoveEventListener = globalEvents.removeEventListener;
    globalEvents.addEventListener = () => {};
    globalEvents.removeEventListener = () => {};
    const detachControls = renderer.attachCameraControls();

    const spritePromise = queueRenderableSprite(renderer);
    const spriteStop = renderer.start();
    flush();
    spriteStop();
    const spriteId = await spritePromise;
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    renderer.setCameraTracking({ spriteIds: [spriteId] });
    expect(renderer.getCameraTrackingState()).not.toBeNull();

    canvas.dispatchEvent(
      createPointerEvent('pointerdown', {
        button: 2,
        pointerId: 1,
        clientX: 20,
        clientY: 30,
      })
    );

    expect(renderer.getCameraTrackingState()).toBeNull();

    detachControls();
    restore();
    globalEvents.addEventListener = originalAddEventListener;
    globalEvents.removeEventListener = originalRemoveEventListener;
  });

  it('emits pick events on click', async () => {
    const { gl } = createFakeGL();
    const canvas = createCanvas(gl);
    const { instance } = createFakeWasmModule();
    const renderer = createObjectCanvasRenderer(canvas, instance);
    const restoreRaf = withRafOnce();

    const atlasId = renderer.allocateAtlas();
    await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
    const spritePromise = renderer.addSprite(
      {
        sx: { value: 0 },
        sy: { value: 0 },
        elements: [{ imageId: 'sprite' }],
      },
      true
    ) as Promise<number>;

    const pickEvents: ObjectCanvasPickEvent[] = [];
    const detachPick = renderer.onPick((event) => {
      pickEvents.push(event);
    });

    const stop = renderer.start();
    stop();
    const spriteId = await spritePromise;
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    canvas.dispatchEvent(
      createPointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 75,
      })
    );
    canvas.dispatchEvent(
      createPointerEvent('pointerup', {
        button: 0,
        pointerId: 1,
        clientX: 100,
        clientY: 75,
      })
    );

    expect(pickEvents).toHaveLength(1);
    const pickEvent = pickEvents[0];
    if (!pickEvent || pickEvent.kind !== 'sprite') {
      throw new Error('Expected sprite pick event.');
    }
    expect(pickEvent.spriteId).toBe(spriteId);
    expect(pickEvent.elementIndex).toBe(0);
    expect(pickEvent.screen.xPixel).toBe(100);
    expect(pickEvent.screen.yPixel).toBe(75);
    expect(pickEvent.canvas).toBe(canvas);

    detachPick();
    restoreRaf();
  });

  it('uses canvas-local pixels for pick events', async () => {
    const { gl } = createFakeGL();
    const canvas = createCanvas(gl);
    canvas.getBoundingClientRect = () =>
      ({
        left: 20,
        top: 40,
        right: 220,
        bottom: 190,
        width: 200,
        height: 150,
      }) as DOMRect;
    const { instance } = createFakeWasmModule();
    const renderer = createObjectCanvasRenderer(canvas, instance);
    const restoreRaf = withRafOnce();

    const atlasId = renderer.allocateAtlas();
    await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
    const spritePromise = renderer.addSprite(
      {
        sx: { value: 0 },
        sy: { value: 0 },
        elements: [{ imageId: 'sprite' }],
      },
      true
    ) as Promise<number>;

    const pickEvents: ObjectCanvasPickEvent[] = [];
    const detachPick = renderer.onPick((event) => {
      pickEvents.push(event);
    });

    const stop = renderer.start();
    stop();
    await spritePromise;
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    canvas.dispatchEvent(
      createPointerEvent('pointerdown', {
        button: 0,
        pointerId: 1,
        clientX: 120,
        clientY: 115,
      })
    );
    canvas.dispatchEvent(
      createPointerEvent('pointerup', {
        button: 0,
        pointerId: 1,
        clientX: 120,
        clientY: 115,
      })
    );

    expect(pickEvents).toHaveLength(1);
    const pickEvent = pickEvents[0];
    if (!pickEvent || pickEvent.kind !== 'sprite') {
      throw new Error('Expected sprite pick event.');
    }
    expect(pickEvent.screen.xPixel).toBe(100);
    expect(pickEvent.screen.yPixel).toBe(75);

    detachPick();
    restoreRaf();
  });

  it('projects world coordinates to canvas and page', () => {
    const { gl } = createFakeGL();
    const canvas = createCanvas(gl);
    canvas.getBoundingClientRect = () =>
      ({
        left: 20,
        top: 40,
        right: 220,
        bottom: 190,
        width: 200,
        height: 150,
      }) as DOMRect;
    const { instance } = createFakeWasmModule();
    const renderer = createObjectCanvasRenderer(canvas, instance);
    try {
      const canvasPoint = renderer.worldToCanvas({ x: 5, y: 7, z: 0 });
      const pagePoint = renderer.worldToPage({ x: 5, y: 7, z: 0 });
      expect(canvasPoint).toEqual({ xPixel: 5, yPixel: 7 });
      expect(pagePoint).toEqual({ xPixel: 25, yPixel: 47 });
    } finally {
      renderer.release();
    }
  });

  it('returns undefined from world projection helpers when projection fails', () => {
    const { gl } = createFakeGL();
    const canvas = createCanvas(gl);
    const { instance } = createFakeWasmModule();
    const exports = instance.exports as Record<string, unknown>;
    exports.project_world_to_viewport_f32 = () => 0;
    exports.project_world_to_viewport_with_camera_f32 = () => 0;
    const renderer = createObjectCanvasRenderer(canvas, instance);
    try {
      expect(renderer.worldToCanvas({ x: 5, y: 7, z: 0 })).toBeUndefined();
      expect(renderer.worldToPage({ x: 5, y: 7, z: 0 })).toBeUndefined();
    } finally {
      renderer.release();
    }
  });
});
