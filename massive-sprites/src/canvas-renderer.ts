// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  SizeInPixel,
  ObjectCanvasRenderer,
  ObjectCanvasCameraControlsOptions,
  ObjectCanvasCameraChangeEvent,
  ObjectCanvasCameraChangeSource,
  ObjectCanvasCameraInteractionEvent,
  ObjectCanvasCameraInteractionMode,
  ObjectCanvasCameraInteractionPhase,
  ObjectCanvasPickEvent,
  ObjectPerformanceSnapshot,
  ObjectCameraState,
  ObjectInterpolationParameter,
  ObjectCanvasCameraControlModifiers,
  ObjectCanvasCameraControlPointerButton,
  ObjectCanvasCameraControlPointerTrigger,
  CameraAdjustPositionOptions,
  CameraUpdate,
  CameraUpdateRotationValue,
  ObjectCameraTrackingOptions,
  ObjectRenderer,
  ObjectRendererCommon,
  ObjectRendererOptions,
} from './types';
import { createObjectRenderer } from './renderer';
import type { WasmModule } from './wasm';
import { getNowMs, toRadians } from './utils';
import {
  accumulateCameraControl,
  applyCameraControl,
  clampCameraValue,
  clampCameraPitch,
  resolveCameraDragDelta,
  resolveCameraControlInterpolation,
  resolvePanWorldVelocity,
  resolveWheelTargetPosition,
  resolveWheelInterpolationDuration,
} from './canvas-camera-controls';
import {
  resolveCameraTrackingDistance,
  resolveCameraTrackingSolution,
  resolveCameraTrackingWheelZoomFactor,
} from './camera-tracking';
import {
  COMMON_DEFAULT_CAMERA_FAR,
  COMMON_DEFAULT_CAMERA_NEAR,
} from './generated/wasm-layout.generated';

///////////////////////////////////////////////////////////////////////////////////

const DEFAULT_CAMERA_CONTROL_POLLING_INTERVAL_MS = 100;
const DEFAULT_CAMERA_PAN_RATE_PER_PIXEL = 5.0;
const DEFAULT_CAMERA_ROTATION_RATE_PER_PIXEL = 0.1;
const DEFAULT_CAMERA_WHEEL_SESSION_TIMEOUT_MS = 200;
const DEFAULT_CAMERA_WHEEL_PLANE_Z = 0;
const DEFAULT_CAMERA_WHEEL_DISTANCE_EPSILON = 1.0e-6;
const DEFAULT_CAMERA_WHEEL_LIMIT_RATIO = 0.2;
const DEFAULT_PICK_DRAG_THRESHOLD_PX = 5;
const DEFAULT_CAMERA_PAN_TRIGGER: ObjectCanvasCameraControlPointerTrigger = {
  button: 'right',
  modifiers: { alt: false },
};
const DEFAULT_CAMERA_ROTATION_TRIGGER: ObjectCanvasCameraControlPointerTrigger =
  {
    button: 'right',
    modifiers: { alt: true },
  };

const PERFORMANCE_WINDOW_MS = 1000;

///////////////////////////////////////////////////////////////////////////////////

const getDevicePixelRatio =
  typeof globalThis.devicePixelRatio === 'number'
    ? () => globalThis.devicePixelRatio
    : () => 1;

interface CanvasRenderSample {
  readonly timestampMs: number;
  readonly durationMs: number;
}

const resizeCanvasToDisplaySize = (
  canvas: HTMLCanvasElement,
  cssSize: SizeInPixel,
  dpr: number
) => {
  const displayWidth = Math.max(1, Math.floor(cssSize.widthPixel * dpr));
  const displayHeight = Math.max(1, Math.floor(cssSize.heightPixel * dpr));
  if (canvas.width !== displayWidth || canvas.height !== displayHeight) {
    canvas.width = displayWidth;
    canvas.height = displayHeight;
  }
};

const getCanvasCssSize = (
  canvas: HTMLCanvasElement,
  dpr: number
): SizeInPixel => {
  const widthPixel =
    canvas.clientWidth || Math.max(1, Math.floor(canvas.width / dpr));
  const heightPixel =
    canvas.clientHeight || Math.max(1, Math.floor(canvas.height / dpr));
  return { widthPixel, heightPixel };
};

///////////////////////////////////////////////////////////////////////////////////

/**
 * Creates a canvas-bound renderer with WebGL setup, rendering loop helpers, and camera controls.
 * @param canvas - Target canvas element.
 * @param wasmModule - Loaded or instantiated WASM module.
 * @param options - Renderer options.
 * @returns Canvas renderer instance.
 */
export const createObjectCanvasRenderer = (
  canvas: HTMLCanvasElement,
  wasmModule: WasmModule,
  options: ObjectRendererOptions = {}
): ObjectCanvasRenderer => {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: false,
  });
  if (!gl) {
    throw new Error('WebGL is not supported in this environment.');
  }

  let latestDpr = getDevicePixelRatio();
  let latestViewPortSize = getCanvasCssSize(canvas, latestDpr);
  resizeCanvasToDisplaySize(canvas, latestViewPortSize, latestDpr);
  let latestRenderTimestampMs: number | null = null;
  const objectRenderer: ObjectRenderer = createObjectRenderer(
    latestViewPortSize,
    wasmModule,
    options
  );
  objectRenderer.attachWebGL(gl);

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  let rafId = 0;
  const canvasRenderSamples: CanvasRenderSample[] = [];
  let canvasRenderDurationMsSum = 0;
  let detachCameraControls:
    | ((releaseInterpolation?: ObjectInterpolationParameter | null) => void)
    | null = null;
  let detachPickHandlers: (() => void) | null = null;
  const cameraInteractionListeners = new Set<
    (event: ObjectCanvasCameraInteractionEvent) => void
  >();
  const cameraChangeListeners = new Set<
    (event: ObjectCanvasCameraChangeEvent) => void
  >();
  const pickListeners = new Set<(event: ObjectCanvasPickEvent) => void>();

  const resolveCanvasClientPosition = (event: {
    readonly clientX?: number;
    readonly clientY?: number;
  }) => {
    if (!Number.isFinite(event.clientX) || !Number.isFinite(event.clientY)) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX as number) - rect.left,
      y: (event.clientY as number) - rect.top,
    };
  };

  const onCameraInteraction: ObjectCanvasRenderer['onCameraInteraction'] = (
    listener
  ) => {
    cameraInteractionListeners.add(listener);
    return () => {
      cameraInteractionListeners.delete(listener);
    };
  };

  const onCameraChange: ObjectCanvasRenderer['onCameraChange'] = (listener) => {
    cameraChangeListeners.add(listener);
    return () => {
      cameraChangeListeners.delete(listener);
    };
  };

  const onPick: ObjectCanvasRenderer['onPick'] = (listener) => {
    pickListeners.add(listener);
    return () => {
      pickListeners.delete(listener);
    };
  };

  const clearCanvasRenderSamples = () => {
    canvasRenderSamples.length = 0;
    canvasRenderDurationMsSum = 0;
  };

  const pruneCanvasRenderSamples = (latestTimestampMs: number) => {
    const cutoffTimestampMs = latestTimestampMs - PERFORMANCE_WINDOW_MS;
    while (
      canvasRenderSamples.length > 0 &&
      (canvasRenderSamples[0]?.timestampMs ?? Number.NEGATIVE_INFINITY) <
        cutoffTimestampMs
    ) {
      const removed = canvasRenderSamples.shift();
      if (!removed) {
        continue;
      }
      canvasRenderDurationMsSum -= removed.durationMs;
    }
  };

  const pushCanvasRenderSample = (timestampMs: number, durationMs: number) => {
    const resolvedDurationMs = Math.max(0, durationMs);
    canvasRenderSamples.push({
      timestampMs,
      durationMs: resolvedDurationMs,
    });
    canvasRenderDurationMsSum += resolvedDurationMs;
    pruneCanvasRenderSamples(timestampMs);
  };

  const getAverageCanvasRenderDurationMs = () =>
    canvasRenderSamples.length > 0
      ? Math.max(0, canvasRenderDurationMsSum / canvasRenderSamples.length)
      : 0;

  const getPerformanceSnapshot = (): ObjectPerformanceSnapshot => {
    const snapshot = objectRenderer.getPerformanceSnapshot();
    return {
      ...snapshot,
      avgCanvasRenderDurationMs: getAverageCanvasRenderDurationMs(),
    };
  };

  const resetPerformanceSnapshot = () => {
    clearCanvasRenderSamples();
    objectRenderer.resetPerformanceSnapshot();
  };

  const pickDragThresholdSq =
    DEFAULT_PICK_DRAG_THRESHOLD_PX * DEFAULT_PICK_DRAG_THRESHOLD_PX;
  let pickPointerId: number | null = null;
  let pickStartPointer: { x: number; y: number } | null = null;
  let pickLatestPointer: { x: number; y: number } | null = null;
  let pickMoved = false;
  let pickIgnored = false;

  const resetPickState = () => {
    pickPointerId = null;
    pickStartPointer = null;
    pickLatestPointer = null;
    pickMoved = false;
    pickIgnored = false;
  };

  const handlePickPointerDown = (event: PointerEvent) => {
    if (event.button !== 0) {
      return;
    }
    const pointer = resolveCanvasClientPosition(event);
    if (!pointer) {
      return;
    }
    pickPointerId = event.pointerId;
    pickStartPointer = pointer;
    pickLatestPointer = pointer;
    pickMoved = false;
    pickIgnored = event.defaultPrevented;
  };

  const handlePickPointerMove = (event: PointerEvent) => {
    if (pickPointerId === null || event.pointerId !== pickPointerId) {
      return;
    }
    const pointer = resolveCanvasClientPosition(event);
    if (!pointer || !pickStartPointer) {
      return;
    }
    pickLatestPointer = pointer;
    if (!pickMoved) {
      const dx = pointer.x - pickStartPointer.x;
      const dy = pointer.y - pickStartPointer.y;
      if (dx * dx + dy * dy >= pickDragThresholdSq) {
        pickMoved = true;
      }
    }
  };

  const handlePickPointerUp = (event: PointerEvent) => {
    if (pickPointerId === null || event.pointerId !== pickPointerId) {
      return;
    }
    const pointer =
      resolveCanvasClientPosition(event) ??
      pickLatestPointer ??
      pickStartPointer;
    const shouldPick =
      !pickIgnored && !pickMoved && !!pointer && pickListeners.size > 0;
    if (shouldPick && pointer) {
      const result = pickAt(pointer.x, pointer.y);
      if (result) {
        emitPick({
          ...result,
          canvas,
          timestampMs: result.timestampMs,
        });
      }
    }
    resetPickState();
  };

  const handlePickPointerCancel = (event: PointerEvent) => {
    if (pickPointerId === null || event.pointerId !== pickPointerId) {
      return;
    }
    resetPickState();
  };

  const attachPickHandlers = () => {
    if (detachPickHandlers) {
      return;
    }
    canvas.addEventListener('pointerdown', handlePickPointerDown);
    canvas.addEventListener('pointermove', handlePickPointerMove);
    canvas.addEventListener('pointerup', handlePickPointerUp);
    canvas.addEventListener('pointercancel', handlePickPointerCancel);
    detachPickHandlers = () => {
      canvas.removeEventListener('pointerdown', handlePickPointerDown);
      canvas.removeEventListener('pointermove', handlePickPointerMove);
      canvas.removeEventListener('pointerup', handlePickPointerUp);
      canvas.removeEventListener('pointercancel', handlePickPointerCancel);
      detachPickHandlers = null;
    };
  };

  attachPickHandlers();

  const getMaxAtlasSize: ObjectRendererCommon['getMaxAtlasSize'] = () =>
    objectRenderer.getMaxAtlasSize();

  const allocateAtlas: ObjectRendererCommon['allocateAtlas'] = (options) =>
    objectRenderer.allocateAtlas(options);

  const releaseAtlas: ObjectRendererCommon['releaseAtlas'] = (atlasId) => {
    objectRenderer.releaseAtlas(atlasId);
  };

  const registerImage: ObjectRendererCommon['registerImage'] = (
    atlasId,
    imageId,
    imageSource,
    upScalingToPowerOfTwo,
    options
  ) =>
    objectRenderer.registerImage(
      atlasId,
      imageId,
      imageSource,
      upScalingToPowerOfTwo,
      options
    );

  const registerTextGlyph: ObjectRendererCommon['registerTextGlyph'] = (
    atlasId,
    imageId,
    text,
    dimensions,
    options
  ) =>
    objectRenderer.registerTextGlyph(
      atlasId,
      imageId,
      text,
      dimensions,
      options
    );

  const unregisterImage: ObjectRendererCommon['unregisterImage'] = (id) => {
    objectRenderer.unregisterImage(id);
  };

  const addSprite: ObjectRendererCommon['addSprite'] = objectRenderer.addSprite;

  const addSprites: ObjectRendererCommon['addSprites'] =
    objectRenderer.addSprites;

  const updateSprite: ObjectRendererCommon['updateSprite'] =
    objectRenderer.updateSprite;

  const updateSprites: ObjectRendererCommon['updateSprites'] =
    objectRenderer.updateSprites;

  const getSpriteState: ObjectRendererCommon['getSpriteState'] =
    objectRenderer.getSpriteState;

  const addPolyline: ObjectRendererCommon['addPolyline'] =
    objectRenderer.addPolyline;

  const addPolylines: ObjectRendererCommon['addPolylines'] =
    objectRenderer.addPolylines;

  const updatePolyline: ObjectRendererCommon['updatePolyline'] =
    objectRenderer.updatePolyline;

  const updatePolylines: ObjectRendererCommon['updatePolylines'] =
    objectRenderer.updatePolylines;

  const getPolylineState: ObjectRendererCommon['getPolylineState'] =
    objectRenderer.getPolylineState;

  const pickAt: ObjectCanvasRenderer['pickAt'] = (
    canvasXPixel,
    canvasYPixel,
    timestampMs
  ) => {
    const hasTimestamp =
      Number.isFinite(timestampMs ?? Number.NaN) && timestampMs !== undefined;
    const resolvedTimestamp = hasTimestamp
      ? (timestampMs as number)
      : (latestRenderTimestampMs ?? undefined);
    return objectRenderer.pickAt(canvasXPixel, canvasYPixel, resolvedTimestamp);
  };

  const worldToCanvas: ObjectCanvasRenderer['worldToCanvas'] = (
    world,
    cameraState
  ) => objectRenderer.projectWorldToViewport(world, cameraState);

  const worldToPage: ObjectCanvasRenderer['worldToPage'] = (
    world,
    cameraState
  ) => {
    const screen = worldToCanvas(world, cameraState);
    if (!screen) {
      return undefined;
    }
    const rect = canvas.getBoundingClientRect();
    return {
      xPixel: screen.xPixel + rect.left,
      yPixel: screen.yPixel + rect.top,
    };
  };

  const getCameraState: ObjectRendererCommon['getCameraState'] =
    objectRenderer.getCameraState;

  const setCameraTracking: ObjectRendererCommon['setCameraTracking'] = (
    tracking
  ) => {
    objectRenderer.setCameraTracking(tracking);
  };

  const clearCameraTracking: ObjectRendererCommon['clearCameraTracking'] =
    () => {
      objectRenderer.clearCameraTracking();
    };

  const getCameraTrackingState: ObjectRendererCommon['getCameraTrackingState'] =
    objectRenderer.getCameraTrackingState;

  const emitCameraInteraction = (event: ObjectCanvasCameraInteractionEvent) => {
    cameraInteractionListeners.forEach((listener) => {
      listener(event);
    });
  };

  const emitCameraChange = (event: ObjectCanvasCameraChangeEvent) => {
    cameraChangeListeners.forEach((listener) => {
      listener(event);
    });
  };

  const emitPick = (event: ObjectCanvasPickEvent) => {
    pickListeners.forEach((listener) => {
      listener(event);
    });
  };

  const notifyCameraInteraction = (
    phase: ObjectCanvasCameraInteractionPhase,
    mode: ObjectCanvasCameraInteractionMode,
    cameraUpdate?: CameraUpdate
  ) => {
    if (cameraInteractionListeners.size === 0) {
      return;
    }
    emitCameraInteraction({
      phase,
      mode,
      cameraState: getCameraState(),
      ...(cameraUpdate !== undefined ? { cameraUpdate } : {}),
      timestampMs: getNowMs(),
    });
  };

  const notifyCameraChange = (
    source: ObjectCanvasCameraChangeSource,
    cameraUpdate: CameraUpdate,
    cameraState: ObjectCameraState | undefined,
    timestampMs: number | undefined
  ) => {
    if (cameraChangeListeners.size === 0) {
      return;
    }
    emitCameraChange({
      source,
      cameraState: cameraState ?? getCameraState(),
      cameraUpdate,
      timestampMs: timestampMs ?? getNowMs(),
    });
  };

  const removeSprite: ObjectRendererCommon['removeSprite'] =
    objectRenderer.removeSprite;

  const removeSprites: ObjectRendererCommon['removeSprites'] =
    objectRenderer.removeSprites;

  const removePolyline: ObjectRendererCommon['removePolyline'] =
    objectRenderer.removePolyline;

  const removePolylines: ObjectRendererCommon['removePolylines'] =
    objectRenderer.removePolylines;

  let latestCameraNear = COMMON_DEFAULT_CAMERA_NEAR;
  let latestCameraFar = COMMON_DEFAULT_CAMERA_FAR;

  let latestCameraChangeSource: ObjectCanvasCameraChangeSource = 'external';
  let latestCameraUpdate: CameraUpdate = {};

  const updateCameraWithSource = (
    camera: CameraUpdate,
    source: ObjectCanvasCameraChangeSource
  ) => {
    latestCameraChangeSource = source;
    latestCameraUpdate = camera;
    const inner = async () => {
      await objectRenderer.updateCamera(camera, true);
      if (camera && typeof camera === 'object') {
        if (Number.isFinite(camera.near)) {
          latestCameraNear = camera.near as number;
        }
        if (Number.isFinite(camera.far)) {
          latestCameraFar = camera.far as number;
        }
      }
    };
    return inner();
  };

  function updateCamera(camera: CameraUpdate): void;
  function updateCamera(camera: CameraUpdate, awaitable: false): void;
  function updateCamera(camera: CameraUpdate, awaitable: true): Promise<void>;
  function updateCamera(
    camera: CameraUpdate,
    _awaitable?: boolean
  ): void | Promise<void> {
    return updateCameraWithSource(camera, 'external');
  }

  function adjustCameraPosition(options: CameraAdjustPositionOptions): void;
  function adjustCameraPosition(
    options: CameraAdjustPositionOptions,
    awaitable: false
  ): void;
  function adjustCameraPosition(
    options: CameraAdjustPositionOptions,
    awaitable: true
  ): Promise<void>;
  function adjustCameraPosition(
    options: CameraAdjustPositionOptions,
    _awaitable?: boolean
  ): void | Promise<void> {
    latestCameraChangeSource = 'external';
    const interpolation = options.interpolation;
    const moveRotation =
      interpolation === undefined ? { value: 0 } : { value: 0, interpolation };
    const rotationUpdate = {
      yaw: moveRotation,
      roll: moveRotation,
      ...(options.pitch !== undefined ? { pitch: options.pitch } : {}),
    };
    latestCameraUpdate = {
      rotation: rotationUpdate,
      ...(options.fov !== undefined ? { fovY: options.fov } : {}),
      ...(options.near !== undefined ? { near: options.near } : {}),
      ...(options.far !== undefined ? { far: options.far } : {}),
    };
    if (options.near !== undefined) {
      latestCameraNear = options.near;
    }
    if (options.far !== undefined) {
      latestCameraFar = options.far;
    }
    return objectRenderer.adjustCameraPosition(options, true);
  }

  const detachCameraStateChange = objectRenderer.onCameraStateChange(
    (event) => {
      if (event.source === 'tracking') {
        notifyCameraChange(
          'tracking',
          event.cameraUpdate ?? {},
          event.cameraState,
          event.timestampMs
        );
        return;
      }
      notifyCameraChange(
        latestCameraChangeSource,
        latestCameraUpdate,
        event.cameraState,
        event.timestampMs
      );
    }
  );

  const updateViewPort = (viewPortSize: SizeInPixel) => {
    if (
      viewPortSize.widthPixel !== latestViewPortSize.widthPixel ||
      viewPortSize.heightPixel !== latestViewPortSize.heightPixel
    ) {
      latestViewPortSize = viewPortSize;
      objectRenderer.setViewPortSize(viewPortSize);
    }
  };

  const initializeScope = (body: () => Promise<void>) =>
    objectRenderer.initializeScope(body);

  const renderFrame = () => {
    const renderStartMs = getNowMs();
    const currentDpr = getDevicePixelRatio();
    if (currentDpr !== latestDpr) {
      latestDpr = currentDpr;
    }
    const cssSize = getCanvasCssSize(canvas, latestDpr);
    resizeCanvasToDisplaySize(canvas, cssSize, latestDpr);
    updateViewPort(cssSize);

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const renderTimestampMs = objectRenderer.render();
    if (renderTimestampMs !== undefined) {
      latestRenderTimestampMs = renderTimestampMs;
    }

    const renderEndMs = getNowMs();
    pushCanvasRenderSample(renderEndMs, renderEndMs - renderStartMs);
  };

  const start = () => {
    if (rafId) {
      return () => {};
    }
    const loop = () => {
      renderFrame();
      rafId = requestAnimationFrame(loop);
    };
    rafId = requestAnimationFrame(loop);
    return () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };
  };

  const release = () => {
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    if (detachCameraControls) {
      detachCameraControls();
      detachCameraControls = null;
    }
    if (detachPickHandlers) {
      detachPickHandlers();
      detachPickHandlers = null;
    }
    detachCameraStateChange();
    objectRenderer.release();
    clearCanvasRenderSamples();
  };

  const attachCameraControls: ObjectCanvasRenderer['attachCameraControls'] = (
    options?: ObjectCanvasCameraControlsOptions
  ) => {
    if (detachCameraControls) {
      return detachCameraControls;
    }

    type CameraControlVector = { x: number; y: number };
    type CameraControlVector3 = { x: number; y: number; z: number };
    type WheelSession = {
      focus: CameraControlVector3;
      direction: CameraControlVector3;
      startDistance: number;
      worldPerPixel: number;
      accumulatedDelta: number;
    };
    const pollingIntervalMs =
      options?.pollingIntervalMs ?? DEFAULT_CAMERA_CONTROL_POLLING_INTERVAL_MS;
    const interactionInterpolation =
      options?.interactionInterpolation !== undefined
        ? options?.interactionInterpolation
        : ({
            mode: 'feedback',
            durationMs: pollingIntervalMs,
            easing: { type: 'linear' },
          } as ObjectInterpolationParameter);
    const updateCameraFromInteraction = (camera: CameraUpdate) =>
      updateCameraWithSource(camera, 'interaction');
    const resolveFiniteNumber = (
      value: number | undefined,
      fallback: number
    ) =>
      typeof value === 'number' && Number.isFinite(value) ? value : fallback;
    const panOptions = options?.pan;
    const rotationOptions = options?.rotation;
    const wheelOptions = options?.wheel;
    const yawOptions = rotationOptions?.yaw;
    const pitchOptions = rotationOptions?.pitch;
    const panTrigger = panOptions?.trigger ?? DEFAULT_CAMERA_PAN_TRIGGER;
    const rotationTrigger =
      rotationOptions?.trigger ?? DEFAULT_CAMERA_ROTATION_TRIGGER;

    const panMode = panOptions?.mode ?? 'speed';
    const rotationMode = rotationOptions?.mode ?? 'free';
    const rotationYawMode = yawOptions?.mode ?? 'distance';
    const rotationPitchMode = pitchOptions?.mode ?? 'distance';
    const panRatePerPixel = resolveFiniteNumber(
      panOptions?.ratePerPixel,
      DEFAULT_CAMERA_PAN_RATE_PER_PIXEL
    );
    const rotationYawRatePerPixel = resolveFiniteNumber(
      yawOptions?.ratePerPixel,
      DEFAULT_CAMERA_ROTATION_RATE_PER_PIXEL
    );
    const rotationPitchRatePerPixel = resolveFiniteNumber(
      pitchOptions?.ratePerPixel,
      DEFAULT_CAMERA_ROTATION_RATE_PER_PIXEL
    );
    const panInvertX = panOptions?.x?.invert ?? false;
    const panInvertY = panOptions?.y?.invert ?? false;
    const rotationYawInvert = yawOptions?.invert ?? false;
    const rotationPitchInvert = pitchOptions?.invert ?? true;
    const enableYaw = yawOptions?.enable ?? false;
    const enablePitch = pitchOptions?.enable ?? true;
    const wheelSessionTimeoutMs = Math.max(
      0,
      resolveFiniteNumber(
        wheelOptions?.sessionTimeoutMs,
        DEFAULT_CAMERA_WHEEL_SESSION_TIMEOUT_MS
      )
    );
    const wheelPlaneZ = resolveFiniteNumber(
      wheelOptions?.planeZ,
      DEFAULT_CAMERA_WHEEL_PLANE_Z
    );
    const rotationFocusPlane = rotationMode === 'focusPlane';

    let activePointerId: number | null = null;
    let panActive = false;
    let rotationActive = false;
    let startPointer: CameraControlVector | null = null;
    let latestPointer: CameraControlVector | null = null;
    let startCameraState: ObjectCameraState | undefined;
    let startCameraPosition: CameraControlVector | null = null;
    let startCameraRotation: CameraControlVector | null = null;
    let startPanWorld: CameraControlVector | null = null;
    let rotationFocusPoint: CameraControlVector3 | null = null;
    let rotationFocusDistance: number | null = null;
    let panWorldPerPixelX: CameraControlVector | null = null;
    let panWorldPerPixelY: CameraControlVector | null = null;
    let wheelSession: WheelSession | null = null;
    let wheelSessionTimeoutId: ReturnType<typeof setTimeout> | null = null;
    let accumulatedPan: CameraControlVector = { x: 0, y: 0 };
    let accumulatedRotation: CameraControlVector = { x: 0, y: 0 };
    let lastTickMs = 0;
    let intervalId: ReturnType<typeof setInterval> | null = null;

    const resolvePointerPosition = (event: PointerEvent) =>
      resolveCanvasClientPosition(event) ?? {
        x: latestViewPortSize.widthPixel * 0.5,
        y: latestViewPortSize.heightPixel * 0.5,
      };

    const matchesModifier = (expected: boolean | undefined, actual: boolean) =>
      expected === undefined || expected === actual;

    const matchesModifiers = (
      modifiers: ObjectCanvasCameraControlModifiers | undefined,
      event: PointerEvent
    ) =>
      !modifiers ||
      (matchesModifier(modifiers.alt, event.altKey) &&
        matchesModifier(modifiers.ctrl, event.ctrlKey) &&
        matchesModifier(modifiers.shift, event.shiftKey) &&
        matchesModifier(modifiers.meta, event.metaKey));

    const resolvePointerButton = (
      button: number
    ): ObjectCanvasCameraControlPointerButton | null => {
      if (button === 0) {
        return 'left';
      }
      if (button === 1) {
        return 'middle';
      }
      if (button === 2) {
        return 'right';
      }
      if (button === 3) {
        return 'back';
      }
      if (button === 4) {
        return 'forward';
      }
      return null;
    };

    const matchesTrigger = (
      trigger: ObjectCanvasCameraControlPointerTrigger,
      event: PointerEvent
    ) => {
      const resolvedButton = resolvePointerButton(event.button);
      const buttonMatches =
        trigger.button === undefined || trigger.button === resolvedButton;
      return buttonMatches && matchesModifiers(trigger.modifiers, event);
    };

    const resolveControlState = (event: PointerEvent) => ({
      pan: matchesTrigger(panTrigger, event),
      rotate: matchesTrigger(rotationTrigger, event),
    });

    const buildTrackingOptions = (
      trackingState: ReturnType<typeof getCameraTrackingState>,
      overrides: Partial<ObjectCameraTrackingOptions> | undefined = undefined
    ): ObjectCameraTrackingOptions | null => {
      if (!trackingState) {
        return null;
      }
      return {
        spriteIds: [...trackingState.spriteIds],
        ...(trackingState.targetMode !== undefined
          ? { targetMode: trackingState.targetMode }
          : {}),
        ...(trackingState.distance !== undefined
          ? { distance: trackingState.distance }
          : {}),
        ...(trackingState.minDistance !== undefined
          ? { minDistance: trackingState.minDistance }
          : {}),
        ...(trackingState.fitPadding !== undefined
          ? { fitPadding: trackingState.fitPadding }
          : {}),
        ...(trackingState.fitZoomBias !== undefined
          ? { fitZoomBias: trackingState.fitZoomBias }
          : {}),
        ...(trackingState.interpolation !== undefined
          ? { interpolation: trackingState.interpolation }
          : {}),
        ...(overrides ?? {}),
      };
    };

    const resolveTrackingFocusPoint = () => {
      const trackingState = getCameraTrackingState();
      if (!trackingState) {
        return null;
      }
      const targets = resolveTrackingTargets(trackingState);
      if (targets.length === 0) {
        return null;
      }
      const count = targets.length;
      const sum = targets.reduce(
        (acc, target) => ({
          x: acc.x + target.x,
          y: acc.y + target.y,
          z: acc.z + target.z,
        }),
        { x: 0, y: 0, z: 0 }
      );
      return {
        x: sum.x / count,
        y: sum.y / count,
        z: sum.z / count,
      };
    };

    const resolveTrackingTargets = (
      trackingState: ReturnType<typeof getCameraTrackingState>
    ) => {
      if (!trackingState) {
        return [];
      }
      return trackingState.spriteIds
        .map((spriteId) => {
          try {
            const spriteState = getSpriteState(
              spriteId,
              latestRenderTimestampMs ?? undefined
            );
            if (!(spriteState.opacity.value > 0)) {
              return undefined;
            }
            return {
              x: spriteState.sx.value,
              y: spriteState.sy.value,
              z: spriteState.sz,
            };
          } catch {
            return undefined;
          }
        })
        .filter(
          (target): target is CameraControlVector3 => target !== undefined
        );
    };

    const applyTrackingWheelDelta = (
      deltaPixels: number,
      cameraState: ObjectCameraState
    ) => {
      const trackingState = getCameraTrackingState();
      if (!trackingState) {
        return false;
      }
      const zoomFactor = resolveCameraTrackingWheelZoomFactor(
        deltaPixels,
        cameraState.fovY.value,
        latestViewPortSize.heightPixel
      );
      if (!Number.isFinite(zoomFactor) || zoomFactor <= 0) {
        return false;
      }
      if (trackingState.mode === 'single') {
        const distance = Math.max(
          resolveCameraTrackingDistance(0, trackingState),
          (trackingState.resolvedDistance ?? trackingState.distance ?? 1) *
            zoomFactor
        );
        const nextTracking = buildTrackingOptions(trackingState, { distance });
        if (!nextTracking) {
          return false;
        }
        setCameraTracking(nextTracking);
        return true;
      }
      const targets = resolveTrackingTargets(trackingState);
      if (targets.length === 0) {
        return false;
      }
      let baseDistance: number | undefined;
      if (trackingState.targetMode === 'contentApprox') {
        const resolvedDistance = trackingState.resolvedDistance;
        if (Number.isFinite(resolvedDistance) && resolvedDistance! > 0) {
          const zoomBias =
            Number.isFinite(trackingState.fitZoomBias ?? undefined) &&
            (trackingState.fitZoomBias ?? 0) > 0
              ? (trackingState.fitZoomBias ?? 1)
              : 1;
          baseDistance = Math.max(
            DEFAULT_CAMERA_WHEEL_DISTANCE_EPSILON,
            resolvedDistance! / zoomBias
          );
        }
      }
      if (baseDistance === undefined) {
        const baseSolution = resolveCameraTrackingSolution(
          cameraState,
          {
            ...trackingState,
            fitZoomBias: 1,
            resolvedDistance: undefined,
          },
          targets
        );
        baseDistance = baseSolution?.baseDistance;
      }
      if (
        !Number.isFinite(baseDistance) ||
        !baseDistance ||
        baseDistance <= 0
      ) {
        return false;
      }
      const nextDistance = Math.max(
        resolveCameraTrackingDistance(0, trackingState),
        (trackingState.resolvedDistance ??
          resolveCameraTrackingDistance(baseDistance, trackingState)) *
          zoomFactor
      );
      const fitZoomBias = Math.max(
        DEFAULT_CAMERA_WHEEL_DISTANCE_EPSILON,
        nextDistance / baseDistance
      );
      const nextTracking = buildTrackingOptions(trackingState, {
        fitZoomBias,
      });
      if (!nextTracking) {
        return false;
      }
      setCameraTracking(nextTracking);
      return true;
    };

    const stopInterval = () => {
      if (intervalId === null) {
        return;
      }
      clearInterval(intervalId);
      intervalId = null;
    };

    const clearWheelSessionTimeout = () => {
      if (wheelSessionTimeoutId === null) {
        return;
      }
      clearTimeout(wheelSessionTimeoutId);
      wheelSessionTimeoutId = null;
    };

    const endWheelSession = () => {
      if (!wheelSession) {
        clearWheelSessionTimeout();
        return;
      }
      wheelSession = null;
      notifyCameraInteraction('end', 'wheel');
      clearWheelSessionTimeout();
    };

    const resetActiveState = () => {
      stopInterval();
      if (activePointerId !== null) {
        try {
          canvas.releasePointerCapture(activePointerId);
        } catch {
          // Ignore pointer capture errors.
        }
      }
      activePointerId = null;
      panActive = false;
      rotationActive = false;
      startPointer = null;
      latestPointer = null;
      startCameraState = undefined;
      startCameraPosition = null;
      startCameraRotation = null;
      startPanWorld = null;
      panWorldPerPixelX = null;
      panWorldPerPixelY = null;
      rotationFocusPoint = null;
      rotationFocusDistance = null;
      accumulatedPan = { x: 0, y: 0 };
      accumulatedRotation = { x: 0, y: 0 };
      lastTickMs = 0;
    };

    const resolveWheelDeltaPixels = (event: WheelEvent) => {
      const delta = event.deltaY;
      if (!Number.isFinite(delta)) {
        return 0;
      }
      if (event.deltaMode === 1) {
        return delta * 16;
      }
      if (event.deltaMode === 2) {
        return delta * latestViewPortSize.heightPixel;
      }
      return delta;
    };

    const resolveForwardDirectionFromRotation = (
      yawDeg: number,
      pitchDeg: number,
      rollDeg: number
    ) => {
      const yawRad = toRadians(yawDeg);
      const pitchRad = toRadians(pitchDeg);
      const rollRad = toRadians(rollDeg);
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
      if (
        !Number.isFinite(length) ||
        length <= DEFAULT_CAMERA_WHEEL_DISTANCE_EPSILON
      ) {
        return null;
      }
      return {
        x: forwardX / length,
        y: forwardY / length,
        z: forwardZ / length,
      };
    };

    const resolveRayDirectionFromScreen = (
      screenPoint: CameraControlVector,
      cameraState: ObjectCameraState,
      yawDeg: number,
      pitchDeg: number
    ) => {
      if (!Number.isFinite(screenPoint.x) || !Number.isFinite(screenPoint.y)) {
        return null;
      }
      const cameraStateWithRotation: ObjectCameraState = {
        ...cameraState,
        rotation: {
          ...cameraState.rotation,
          yaw: { ...cameraState.rotation.yaw, value: yawDeg },
          pitch: { ...cameraState.rotation.pitch, value: pitchDeg },
        },
      };
      const world = objectRenderer.viewportToWorldOnPlane(
        screenPoint.x,
        screenPoint.y,
        latestViewPortSize,
        wheelPlaneZ,
        cameraStateWithRotation
      );
      if (!world) {
        return null;
      }
      const dirX = world.x - cameraState.position.x.value;
      const dirY = world.y - cameraState.position.y.value;
      const dirZ = wheelPlaneZ - cameraState.position.z.value;
      const length = Math.hypot(dirX, dirY, dirZ);
      if (
        !Number.isFinite(length) ||
        length <= DEFAULT_CAMERA_WHEEL_DISTANCE_EPSILON
      ) {
        return null;
      }
      return {
        x: dirX / length,
        y: dirY / length,
        z: dirZ / length,
      };
    };

    const resolveForwardDirection = (cameraState: ObjectCameraState) =>
      resolveForwardDirectionFromRotation(
        cameraState.rotation.yaw.value,
        cameraState.rotation.pitch.value,
        cameraState.rotation.roll.value
      ) ?? { x: 0, y: 0, z: -1 };

    const ensureWheelSession = (
      cameraState: ObjectCameraState,
      screenPoint: CameraControlVector | null
    ) => {
      if (wheelSession) {
        return wheelSession;
      }

      const resolveWorldPerPixelFromFov = (distance: number) => {
        if (!Number.isFinite(distance) || distance <= 0) {
          return Number.NaN;
        }
        const fovYRad = toRadians(cameraState.fovY.value);
        if (!Number.isFinite(fovYRad) || fovYRad <= 0) {
          return Number.NaN;
        }
        const viewHeight = Math.max(1, latestViewPortSize.heightPixel);
        const worldHeight = 2 * Math.tan(fovYRad / 2) * distance;
        return worldHeight / viewHeight;
      };

      const resolveWheelSession = (
        focus: CameraControlVector3,
        direction: CameraControlVector3,
        distance: number,
        worldPerPixel: number
      ) => {
        if (
          !Number.isFinite(distance) ||
          distance <= DEFAULT_CAMERA_WHEEL_DISTANCE_EPSILON ||
          !Number.isFinite(worldPerPixel) ||
          worldPerPixel <= 0
        ) {
          return null;
        }
        wheelSession = {
          focus,
          direction,
          startDistance: distance,
          worldPerPixel,
          accumulatedDelta: 0,
        };
        return wheelSession;
      };

      const centerX = latestViewPortSize.widthPixel * 0.5;
      const centerY = latestViewPortSize.heightPixel * 0.5;
      const resolvedScreenPoint =
        screenPoint &&
        Number.isFinite(screenPoint.x) &&
        Number.isFinite(screenPoint.y)
          ? screenPoint
          : { x: centerX, y: centerY };
      const focus = objectRenderer.viewportToWorldOnPlane(
        resolvedScreenPoint.x,
        resolvedScreenPoint.y,
        latestViewPortSize,
        wheelPlaneZ,
        cameraState
      );
      if (focus) {
        const dirX = focus.x - cameraState.position.x.value;
        const dirY = focus.y - cameraState.position.y.value;
        const dirZ = wheelPlaneZ - cameraState.position.z.value;
        const distance = Math.hypot(dirX, dirY, dirZ);
        if (
          Number.isFinite(distance) &&
          distance > DEFAULT_CAMERA_WHEEL_DISTANCE_EPSILON
        ) {
          const invDistance = 1 / distance;
          const direction = {
            x: dirX * invDistance,
            y: dirY * invDistance,
            z: dirZ * invDistance,
          };
          const worldAtX = objectRenderer.viewportToWorldOnPlane(
            resolvedScreenPoint.x + 1,
            resolvedScreenPoint.y,
            latestViewPortSize,
            wheelPlaneZ,
            cameraState
          );
          const worldAtY = objectRenderer.viewportToWorldOnPlane(
            resolvedScreenPoint.x,
            resolvedScreenPoint.y + 1,
            latestViewPortSize,
            wheelPlaneZ,
            cameraState
          );
          const lengthX =
            worldAtX !== undefined
              ? Math.hypot(worldAtX.x - focus.x, worldAtX.y - focus.y)
              : Number.NaN;
          const lengthY =
            worldAtY !== undefined
              ? Math.hypot(worldAtY.x - focus.x, worldAtY.y - focus.y)
              : Number.NaN;
          const worldPerPixelFromPlane =
            Number.isFinite(lengthX) && Number.isFinite(lengthY)
              ? (lengthX + lengthY) * 0.5
              : Number.isFinite(lengthX)
                ? lengthX
                : Number.isFinite(lengthY)
                  ? lengthY
                  : Number.NaN;
          const worldPerPixel =
            Number.isFinite(worldPerPixelFromPlane) &&
            worldPerPixelFromPlane > 0
              ? worldPerPixelFromPlane
              : resolveWorldPerPixelFromFov(distance);
          const resolved = resolveWheelSession(
            { x: focus.x, y: focus.y, z: wheelPlaneZ },
            direction,
            distance,
            worldPerPixel
          );
          if (resolved) {
            return resolved;
          }
        }
      }

      const fallbackDistance = Math.max(
        0,
        resolveFiniteNumber(
          wheelOptions?.minDistance,
          latestCameraNear * (1 + DEFAULT_CAMERA_WHEEL_LIMIT_RATIO)
        )
      );
      if (
        !Number.isFinite(fallbackDistance) ||
        fallbackDistance <= DEFAULT_CAMERA_WHEEL_DISTANCE_EPSILON
      ) {
        return null;
      }
      const fallbackDirection = resolveForwardDirection(cameraState);
      const fallbackFocus = {
        x:
          cameraState.position.x.value + fallbackDirection.x * fallbackDistance,
        y:
          cameraState.position.y.value + fallbackDirection.y * fallbackDistance,
        z:
          cameraState.position.z.value + fallbackDirection.z * fallbackDistance,
      };
      const fallbackWorldPerPixel =
        resolveWorldPerPixelFromFov(fallbackDistance);
      return resolveWheelSession(
        fallbackFocus,
        fallbackDirection,
        fallbackDistance,
        fallbackWorldPerPixel
      );
    };

    const tick = () => {
      if (!startPointer || !latestPointer || activePointerId === null) {
        return;
      }
      if (!panActive && !rotationActive) {
        return;
      }

      const now = getNowMs();
      const deltaMs = now - lastTickMs;
      lastTickMs = now;
      const deltaSeconds =
        Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs / 1000 : 0;
      const interpolationDurationMs = Math.max(
        1,
        Math.round(
          Number.isFinite(deltaMs) && deltaMs > 0 ? deltaMs : pollingIntervalMs
        )
      );
      const resolvedInterpolation = resolveCameraControlInterpolation(
        interactionInterpolation,
        interpolationDurationMs
      );
      const resolveUpdateValue = (value: number) =>
        resolvedInterpolation === undefined
          ? { value }
          : { value, interpolation: resolvedInterpolation };

      const dx = latestPointer.x - startPointer.x;
      const dy = latestPointer.y - startPointer.y;

      if (panActive && startCameraPosition) {
        if (panWorldPerPixelX && panWorldPerPixelY) {
          const panInvertYFinal = panInvertY ?? false;
          if (panMode === 'speed') {
            if (deltaSeconds) {
              const worldVelocity = resolvePanWorldVelocity(
                dx,
                dy,
                panWorldPerPixelX,
                panWorldPerPixelY,
                panRatePerPixel,
                panInvertX,
                panInvertYFinal
              );
              accumulatedPan = {
                x: accumulatedPan.x + worldVelocity.x * deltaSeconds,
                y: accumulatedPan.y + worldVelocity.y * deltaSeconds,
              };
              const nextPosition = applyCameraControl(
                startCameraPosition,
                accumulatedPan
              );
              const clampedPosition = {
                x: clampCameraValue(
                  nextPosition.x,
                  panOptions?.x?.minValue,
                  panOptions?.x?.maxValue
                ),
                y: clampCameraValue(
                  nextPosition.y,
                  panOptions?.y?.minValue,
                  panOptions?.y?.maxValue
                ),
              };
              const cameraUpdate: CameraUpdate = {
                position: {
                  x: resolveUpdateValue(clampedPosition.x),
                  y: resolveUpdateValue(clampedPosition.y),
                },
              };
              updateCameraFromInteraction(cameraUpdate);
              notifyCameraInteraction('update', 'pan', cameraUpdate);
            }
          } else {
            const panSignX = panInvertX ? -1 : 1;
            const panSignY = panInvertYFinal ? -1 : 1;
            const worldDelta = {
              x:
                (panWorldPerPixelX.x * dx * panSignX +
                  panWorldPerPixelY.x * dy * panSignY) *
                panRatePerPixel,
              y:
                (panWorldPerPixelX.y * dx * panSignX +
                  panWorldPerPixelY.y * dy * panSignY) *
                panRatePerPixel,
            };
            const nextPosition = applyCameraControl(
              startCameraPosition,
              worldDelta
            );
            const clampedPosition = {
              x: clampCameraValue(
                nextPosition.x,
                panOptions?.x?.minValue,
                panOptions?.x?.maxValue
              ),
              y: clampCameraValue(
                nextPosition.y,
                panOptions?.y?.minValue,
                panOptions?.y?.maxValue
              ),
            };
            const cameraUpdate: CameraUpdate = {
              position: {
                x: resolveUpdateValue(clampedPosition.x),
                y: resolveUpdateValue(clampedPosition.y),
              },
            };
            updateCameraFromInteraction(cameraUpdate);
            notifyCameraInteraction('update', 'pan', cameraUpdate);
          }
        } else {
          let panDx = dx;
          let panDy = dy;
          let panInvertYResolved = true;
          if (startPanWorld) {
            const currentWorld = objectRenderer.viewportToWorldOnPlane(
              latestPointer.x,
              latestPointer.y,
              latestViewPortSize,
              0,
              startCameraState
            );
            if (currentWorld) {
              const worldDeltaX = currentWorld.x - startPanWorld.x;
              const worldDeltaY = currentWorld.y - startPanWorld.y;
              const worldDistance = Math.hypot(worldDeltaX, worldDeltaY);
              const screenDistance = Math.hypot(dx, dy);
              if (worldDistance > 0 && screenDistance > 0) {
                const scale = screenDistance / worldDistance;
                panDx = worldDeltaX * scale;
                panDy = worldDeltaY * scale;
                panInvertYResolved = false;
              }
            }
          }
          const panSignX = panInvertX ? -1 : 1;
          const panDxResolved = panDx * panSignX;
          const panInvertYFinal =
            panInvertY !== undefined ? panInvertY : panInvertYResolved;
          let nextPosition: CameraControlVector;
          if (panMode === 'speed') {
            accumulatedPan = accumulateCameraControl(
              accumulatedPan,
              panDxResolved,
              panDy,
              panRatePerPixel,
              deltaMs,
              panInvertYFinal
            );
            nextPosition = applyCameraControl(
              startCameraPosition,
              accumulatedPan
            );
          } else {
            const panDelta = resolveCameraDragDelta(
              panDxResolved,
              panDy,
              panRatePerPixel,
              panInvertYFinal
            );
            nextPosition = applyCameraControl(startCameraPosition, panDelta);
          }
          const clampedPosition = {
            x: clampCameraValue(
              nextPosition.x,
              panOptions?.x?.minValue,
              panOptions?.x?.maxValue
            ),
            y: clampCameraValue(
              nextPosition.y,
              panOptions?.y?.minValue,
              panOptions?.y?.maxValue
            ),
          };
          const cameraUpdate: CameraUpdate = {
            position: {
              x: resolveUpdateValue(clampedPosition.x),
              y: resolveUpdateValue(clampedPosition.y),
            },
          };
          updateCameraFromInteraction(cameraUpdate);
          notifyCameraInteraction('update', 'pan', cameraUpdate);
        }
      }

      if (rotationActive && startCameraRotation && (enableYaw || enablePitch)) {
        let nextAccumulatedRotation = accumulatedRotation;
        let yawUpdate: CameraUpdateRotationValue | undefined;
        let pitchUpdate: CameraUpdateRotationValue | undefined;
        let nextYaw = startCameraRotation.x;
        let nextPitch = startCameraRotation.y;
        const pitchMinDeg =
          pitchOptions?.minDeg ?? (rotationFocusPlane ? 1 : undefined);
        const pitchMaxDeg =
          pitchOptions?.maxDeg ?? (rotationFocusPlane ? 90 : undefined);
        if (enableYaw) {
          const yawSign = rotationYawInvert ? -1 : 1;
          if (rotationYawMode === 'speed') {
            if (deltaSeconds) {
              const yawVelocity = dx * rotationYawRatePerPixel * yawSign;
              nextAccumulatedRotation = {
                x: nextAccumulatedRotation.x + yawVelocity * deltaSeconds,
                y: nextAccumulatedRotation.y,
              };
            }
            nextYaw = clampCameraValue(
              startCameraRotation.x + nextAccumulatedRotation.x,
              yawOptions?.minDeg,
              yawOptions?.maxDeg
            );
            yawUpdate = resolveUpdateValue(nextYaw);
          } else {
            nextYaw = clampCameraValue(
              startCameraRotation.x + dx * rotationYawRatePerPixel * yawSign,
              yawOptions?.minDeg,
              yawOptions?.maxDeg
            );
            yawUpdate = resolveUpdateValue(nextYaw);
          }
        }
        if (enablePitch) {
          const pitchSign = rotationPitchInvert ? -1 : 1;
          if (rotationPitchMode === 'speed') {
            if (deltaSeconds) {
              const pitchVelocity = dy * rotationPitchRatePerPixel * pitchSign;
              nextAccumulatedRotation = {
                x: nextAccumulatedRotation.x,
                y: nextAccumulatedRotation.y + pitchVelocity * deltaSeconds,
              };
            }
            nextPitch = clampCameraPitch(
              startCameraRotation.y + nextAccumulatedRotation.y,
              pitchMinDeg,
              pitchMaxDeg
            );
            pitchUpdate = resolveUpdateValue(nextPitch);
          } else {
            nextPitch = clampCameraPitch(
              startCameraRotation.y +
                dy * rotationPitchRatePerPixel * pitchSign,
              pitchMinDeg,
              pitchMaxDeg
            );
            pitchUpdate = resolveUpdateValue(nextPitch);
          }
        }
        accumulatedRotation = nextAccumulatedRotation;
        const rotationUpdate: CameraUpdate['rotation'] = {
          ...(yawUpdate !== undefined ? { yaw: yawUpdate } : {}),
          ...(pitchUpdate !== undefined ? { pitch: pitchUpdate } : {}),
        };
        let positionUpdate: CameraUpdate['position'] | undefined;
        if (
          rotationFocusPlane &&
          rotationFocusPoint &&
          rotationFocusDistance &&
          startCameraState &&
          startPointer
        ) {
          const direction = resolveRayDirectionFromScreen(
            startPointer,
            startCameraState,
            nextYaw,
            nextPitch
          );
          if (direction) {
            const nextPosition = {
              x: rotationFocusPoint.x - direction.x * rotationFocusDistance,
              y: rotationFocusPoint.y - direction.y * rotationFocusDistance,
              z: rotationFocusPoint.z - direction.z * rotationFocusDistance,
            };
            positionUpdate = {
              x: resolveUpdateValue(nextPosition.x),
              y: resolveUpdateValue(nextPosition.y),
              z: resolveUpdateValue(nextPosition.z),
            };
          }
        }
        const cameraUpdate: CameraUpdate = {
          rotation: rotationUpdate,
          ...(positionUpdate !== undefined ? { position: positionUpdate } : {}),
        };
        updateCameraFromInteraction(cameraUpdate);
        notifyCameraInteraction('update', 'rotate', cameraUpdate);
      }
    };

    const startInterval = () => {
      if (intervalId !== null) {
        return;
      }
      intervalId = setInterval(tick, pollingIntervalMs);
    };

    const handlePointerDown = (event: PointerEvent) => {
      const { pan: nextPanActive, rotate: nextRotationActive } =
        resolveControlState(event);
      if (!nextPanActive && !nextRotationActive) {
        return;
      }
      if (activePointerId !== null) {
        return;
      }
      event.preventDefault();
      endWheelSession();
      if (nextPanActive && getCameraTrackingState()) {
        clearCameraTracking();
      }
      activePointerId = event.pointerId;
      canvas.setPointerCapture(event.pointerId);

      const pointer = resolvePointerPosition(event);
      startPointer = pointer;
      latestPointer = pointer;

      const cameraState = getCameraState();
      startCameraState = cameraState;
      startCameraPosition = {
        x: cameraState.position.x.value,
        y: cameraState.position.y.value,
      };
      startCameraRotation = {
        x: cameraState.rotation.yaw.value,
        y: cameraState.rotation.pitch.value,
      };

      accumulatedPan = { x: 0, y: 0 };
      accumulatedRotation = { x: 0, y: 0 };
      rotationFocusPoint = null;
      rotationFocusDistance = null;
      lastTickMs = getNowMs();
      panActive = nextPanActive;
      rotationActive = nextRotationActive;
      if (panActive) {
        notifyCameraInteraction('start', 'pan');
      }
      if (rotationActive) {
        notifyCameraInteraction('start', 'rotate');
      }
      startPanWorld = panActive
        ? (objectRenderer.viewportToWorldOnPlane(
            pointer.x,
            pointer.y,
            latestViewPortSize,
            0,
            startCameraState
          ) ?? null)
        : null;
      panWorldPerPixelX = null;
      panWorldPerPixelY = null;
      if (startPanWorld) {
        const worldAtX = objectRenderer.viewportToWorldOnPlane(
          pointer.x + 1,
          pointer.y,
          latestViewPortSize,
          0,
          startCameraState
        );
        const worldAtY = objectRenderer.viewportToWorldOnPlane(
          pointer.x,
          pointer.y + 1,
          latestViewPortSize,
          0,
          startCameraState
        );
        if (worldAtX && worldAtY) {
          panWorldPerPixelX = {
            x: worldAtX.x - startPanWorld.x,
            y: worldAtX.y - startPanWorld.y,
          };
          panWorldPerPixelY = {
            x: worldAtY.x - startPanWorld.x,
            y: worldAtY.y - startPanWorld.y,
          };
        }
      }
      if (rotationActive && rotationFocusPlane && startCameraState) {
        const trackingFocus = getCameraTrackingState()
          ? resolveTrackingFocusPoint()
          : null;
        const focusPoint = trackingFocus
          ? trackingFocus
          : objectRenderer.viewportToWorldOnPlane(
              pointer.x,
              pointer.y,
              latestViewPortSize,
              wheelPlaneZ,
              startCameraState
            );
        if (focusPoint) {
          const distance = Math.hypot(
            startCameraState.position.x.value - focusPoint.x,
            startCameraState.position.y.value - focusPoint.y,
            startCameraState.position.z.value -
              (trackingFocus ? focusPoint.z : wheelPlaneZ)
          );
          if (
            Number.isFinite(distance) &&
            distance > DEFAULT_CAMERA_WHEEL_DISTANCE_EPSILON
          ) {
            rotationFocusPoint = trackingFocus
              ? focusPoint
              : { x: focusPoint.x, y: focusPoint.y, z: wheelPlaneZ };
            rotationFocusDistance = distance;
          }
        }
      }
      startInterval();
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (activePointerId === null || event.pointerId !== activePointerId) {
        return;
      }
      latestPointer = resolvePointerPosition(event);
    };

    const scheduleWheelSessionTimeout = () => {
      clearWheelSessionTimeout();
      wheelSessionTimeoutId = setTimeout(() => {
        endWheelSession();
      }, wheelSessionTimeoutMs);
    };

    const handleWheel = (event: WheelEvent) => {
      if (activePointerId !== null) {
        return;
      }
      const deltaPixels = resolveWheelDeltaPixels(event);
      if (!deltaPixels) {
        return;
      }
      event.preventDefault();

      const interpolationDurationMs =
        resolveWheelInterpolationDuration(pollingIntervalMs);
      const resolvedInterpolation = resolveCameraControlInterpolation(
        interactionInterpolation,
        interpolationDurationMs
      );
      const resolveUpdateValue = (value: number) => ({
        value,
        interpolation: resolvedInterpolation,
      });

      const hadWheelSession = !!wheelSession;
      const cameraState = getCameraState();
      if (!wheelSession) {
        const wheelPointer = resolveCanvasClientPosition(event);
        if (!ensureWheelSession(cameraState, wheelPointer)) {
          return;
        }
      }
      if (!hadWheelSession) {
        notifyCameraInteraction('start', 'wheel');
      }
      if (getCameraTrackingState()) {
        if (!applyTrackingWheelDelta(deltaPixels, cameraState)) {
          return;
        }
        notifyCameraInteraction('update', 'wheel');
        scheduleWheelSessionTimeout();
        return;
      }

      const session = wheelSession;
      if (!session) {
        return;
      }
      session.accumulatedDelta += deltaPixels;
      const minDistance = Math.max(
        0,
        resolveFiniteNumber(
          wheelOptions?.minDistance,
          latestCameraNear * (1 + DEFAULT_CAMERA_WHEEL_LIMIT_RATIO)
        )
      );
      const maxDistance = Math.max(
        0,
        resolveFiniteNumber(
          wheelOptions?.maxDistance,
          latestCameraFar * (1 - DEFAULT_CAMERA_WHEEL_LIMIT_RATIO)
        )
      );
      const zoomRate = session.worldPerPixel / session.startDistance;
      const unclampedDistance = Number.isFinite(zoomRate)
        ? session.startDistance * Math.exp(session.accumulatedDelta * zoomRate)
        : session.startDistance +
          session.accumulatedDelta * session.worldPerPixel;
      const targetDistance = clampCameraValue(
        unclampedDistance,
        minDistance,
        maxDistance
      );
      const targetPosition = resolveWheelTargetPosition(
        session.focus,
        session.direction,
        targetDistance
      );
      const cameraUpdate: CameraUpdate = {
        position: {
          x: resolveUpdateValue(targetPosition.x),
          y: resolveUpdateValue(targetPosition.y),
          z: resolveUpdateValue(targetPosition.z),
        },
      };
      updateCameraFromInteraction(cameraUpdate);
      notifyCameraInteraction('update', 'wheel', cameraUpdate);
      scheduleWheelSessionTimeout();
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (activePointerId === null || event.pointerId !== activePointerId) {
        return;
      }
      if (panActive) {
        notifyCameraInteraction('end', 'pan');
      }
      if (rotationActive) {
        notifyCameraInteraction('end', 'rotate');
      }
      resetActiveState();
    };

    const handlePointerCancel = (event: PointerEvent) => {
      if (activePointerId === null || event.pointerId !== activePointerId) {
        return;
      }
      if (panActive) {
        notifyCameraInteraction('end', 'pan');
      }
      if (rotationActive) {
        notifyCameraInteraction('end', 'rotate');
      }
      resetActiveState();
    };

    const handleWindowBlur = () => {
      if (wheelSession) {
        endWheelSession();
      }
      if (activePointerId === null) {
        return;
      }
      if (panActive) {
        notifyCameraInteraction('end', 'pan');
      }
      if (rotationActive) {
        notifyCameraInteraction('end', 'rotate');
      }
      resetActiveState();
    };

    const handleContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };

    canvas.addEventListener('pointerdown', handlePointerDown);
    canvas.addEventListener('pointermove', handlePointerMove);
    canvas.addEventListener('pointerup', handlePointerUp);
    canvas.addEventListener('pointercancel', handlePointerCancel);
    canvas.addEventListener('contextmenu', handleContextMenu);
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    globalThis.addEventListener('pointerup', handlePointerUp);
    globalThis.addEventListener('pointercancel', handlePointerCancel);
    globalThis.addEventListener('blur', handleWindowBlur);

    detachCameraControls = () => {
      endWheelSession();
      resetActiveState();
      canvas.removeEventListener('pointerdown', handlePointerDown);
      canvas.removeEventListener('pointermove', handlePointerMove);
      canvas.removeEventListener('pointerup', handlePointerUp);
      canvas.removeEventListener('pointercancel', handlePointerCancel);
      canvas.removeEventListener('contextmenu', handleContextMenu);
      canvas.removeEventListener('wheel', handleWheel);
      globalThis.removeEventListener('pointerup', handlePointerUp);
      globalThis.removeEventListener('pointercancel', handlePointerCancel);
      globalThis.removeEventListener('blur', handleWindowBlur);
      detachCameraControls = null;
    };

    return detachCameraControls;
  };

  return {
    canvas,
    worldToCanvas,
    worldToPage,
    getPerformanceSnapshot,
    resetPerformanceSnapshot,
    getMaxAtlasSize,
    allocateAtlas,
    releaseAtlas,
    registerImage,
    registerTextGlyph,
    unregisterImage,
    addSprite,
    addSprites,
    updateSprite,
    updateSprites,
    getSpriteState,
    addPolyline,
    addPolylines,
    updatePolyline,
    updatePolylines,
    getPolylineState,
    pickAt,
    getCameraState,
    setCameraTracking,
    clearCameraTracking,
    getCameraTrackingState,
    removeSprite,
    removeSprites,
    removePolyline,
    removePolylines,
    updateCamera,
    adjustCameraPosition,
    initializeScope,
    onCameraInteraction,
    onCameraChange,
    onPick,
    attachCameraControls,
    start,
    release,
    [Symbol.dispose]: release,
  };
};
