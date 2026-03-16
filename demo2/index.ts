// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import {
  createObjectCanvasRenderer,
  getConsoleLogger,
  loadWasmModule,
  MAX_TEXTURE_SAMPLING_OPTIONS,
  ObjectCameraTrackingOptions,
  type ObjectCanvasRenderer,
  type SpriteState,
} from 'massive-sprites';
import {
  buildGraphPolylinePlacements,
  createGraphGeometry,
  createLogicalGraphEntityManager,
} from 'massive-sprites/logical-graph';

import { loadRouteLayout } from './route-utils';
import {
  buildMovingSpritePlacement,
  createMovingSpriteData,
  type MovingSpriteData,
} from './moving-sprite';
import { createWayPointGraphPosition } from './route-motion';
import { createRouteTraversalController } from './route-traversal-controller';
import { createHueShiftedBitmaps, formatRgbHex } from './color-shift';
import {
  buildCarVariantIds,
  clampNumber,
  loadImageBitmap,
  randomBetween,
  requireButton,
  requireCheckboxInput,
  requireRangeInput,
  requireValueLabel,
  resolveCanvasMetrics,
} from './utils';
import {
  createRouteCameraAdjustOptions,
  type CameraContentBounds,
} from './camera-reset';

///////////////////////////////////////////////////////////////////////////////////

const CAR_COUNT_MIN = 1;
const CAR_COUNT_MAX = 1000;

const ROUTE_THICKNESS = 5;
const ROUTE_COLOR = '#808080';
const WAYPOINT_SPRITE_SCALE = 0.1;

const CAMERA_CONTROL_INTERACTION_INTERPOLATION_DURATION_MS = 20;
const TRACKING_INTERVAL_MS = 200;
const TRACKING_MIN_DISTANCE = 100;
const TRACKING_FIT_PADDING = 1.1;
const PICK_MASK_OPTIONS = { enabled: true, alphaThreshold: 1 } as const;

const CAR_IMAGE_SOURCE_ID = 'car.png';
const DROP_IMAGE_ID = 'drop.png';
const BACKDROP_IMAGE_ID = 'backdrop.png';
const CAR_VARIANT_COUNT = 20;

const BACKDROP_LAYER = 0;
const ROUTE_LAYER = 1;
const WAYPOINT_LAYER = 2;
const MOVING_LAYER = 2;

// Adjust these values to fit the backdrop image to the normalized route space.
const BACKDROP_OFFSET_X = -18.0;
const BACKDROP_OFFSET_Y = 40.0;
const BACKDROP_SCALE = 0.46;

const MOVING_INTERVAL_MS_MIN = 120000;
const MOVING_INTERVAL_MS_MAX = 200000;
const MOVING_INTERPOLATION_TICK_INTERVAL_MS = 500;
const WAYPOINT_PAUSE_MAX_MS = 5000;

///////////////////////////////////////////////////////////////////////////////////

const adjustCameraToRoute = (
  renderer: ObjectCanvasRenderer,
  canvas: HTMLCanvasElement,
  bounds: CameraContentBounds
) => {
  const { aspect } = resolveCanvasMetrics(canvas);

  renderer.adjustCameraPosition(createRouteCameraAdjustOptions(aspect, bounds));
};

const bindCarCountControl = (
  input: HTMLInputElement,
  valueLabel: HTMLElement,
  onCountChange: (count: number) => void
) => {
  const parsedMin = Number.parseInt(input.min, 10);
  const parsedMax = Number.parseInt(input.max, 10);
  const minValue = Number.isFinite(parsedMin) ? parsedMin : CAR_COUNT_MIN;
  const maxValue = Number.isFinite(parsedMax) ? parsedMax : CAR_COUNT_MAX;
  const apply = () => {
    const rawValue = Number.parseInt(input.value, 10);
    const safeValue = Number.isFinite(rawValue) ? rawValue : minValue;
    const clamped = Math.round(clampNumber(safeValue, minValue, maxValue));
    input.value = String(clamped);
    valueLabel.textContent = `${clamped} ${clamped === 1 ? 'car' : 'cars'}`;
    onCountChange(clamped);
  };
  input.addEventListener('input', apply);
  input.addEventListener('change', apply);
  apply();
};

const enableCameraInteraction = (renderer: ObjectCanvasRenderer) => {
  renderer.attachCameraControls({
    interactionInterpolation: {
      mode: 'feedback',
      durationMs: CAMERA_CONTROL_INTERACTION_INTERPOLATION_DURATION_MS,
      easing: { type: 'linear' },
    },
    pan: {
      mode: 'distance',
      ratePerPixel: 1.0,
      trigger: {
        button: 'right',
        modifiers: {
          ctrl: false,
        },
      },
      x: {
        invert: true,
      },
      y: {
        invert: true,
      },
    },
    rotation: {
      mode: 'focusPlane',
      trigger: {
        button: 'right',
        modifiers: {
          ctrl: true,
        },
      },
      yaw: {
        invert: true,
      },
      pitch: {
        invert: true,
      },
    },
  });
};

const createBackdropPlacement = (centerX: number, centerY: number) => ({
  sx: { value: centerX + BACKDROP_OFFSET_X },
  sy: { value: centerY + BACKDROP_OFFSET_Y },
  elements: [
    {
      imageId: BACKDROP_IMAGE_ID,
      layer: BACKDROP_LAYER,
      scale: { value: BACKDROP_SCALE },
      mode: 'surface' as const,
    },
  ],
});

const registerSpriteImages = async (renderer: ObjectCanvasRenderer) => {
  const imageAtlasId = renderer.allocateAtlas({
    textureSampling: MAX_TEXTURE_SAMPLING_OPTIONS,
    pickMask: PICK_MASK_OPTIONS,
  });
  const carVariantIds = buildCarVariantIds(CAR_VARIANT_COUNT);
  const carImageUrl = new URL(
    `./images/${CAR_IMAGE_SOURCE_ID}`,
    import.meta.url
  ).toString();
  const carBitmap = await loadImageBitmap(carImageUrl);
  const carBitmaps = await createHueShiftedBitmaps(
    carBitmap,
    carVariantIds.length
  );
  await Promise.all(
    carBitmaps.map(({ bitmap }, index) => {
      const imageId = carVariantIds[index];
      if (!imageId) {
        throw new Error('Missing car image id.');
      }
      return renderer.registerImage(imageAtlasId, imageId, bitmap);
    })
  );

  const carVariants = carBitmaps.map(({ accentColor }, index) => {
    const imageId = carVariantIds[index];
    if (!imageId) {
      throw new Error('Missing car image id.');
    }
    return {
      imageId,
      labelColor: formatRgbHex(accentColor),
    };
  });

  const dropImageUrl = new URL(
    `./images/${DROP_IMAGE_ID}`,
    import.meta.url
  ).toString();
  const dropBitmap = await loadImageBitmap(dropImageUrl);
  await renderer.registerImage(imageAtlasId, DROP_IMAGE_ID, dropBitmap);
  const backdropImageUrl = new URL(
    `./images/${BACKDROP_IMAGE_ID}`,
    import.meta.url
  ).toString();
  const backdropBitmap = await loadImageBitmap(backdropImageUrl);
  await renderer.registerImage(imageAtlasId, BACKDROP_IMAGE_ID, backdropBitmap);
  return { imageAtlasId, carVariants };
};

///////////////////////////////////////////////////////////////////////////////////

const resolveControls = () => ({
  carCountInput: requireRangeInput('car-count'),
  carCountValue: requireValueLabel('car-count-value'),
  waypointsToggle: requireCheckboxInput('waypoints-toggle'),
  resetViewButton: requireButton('reset-view'),
  trackAllCarsButton: requireButton('track-all-cars'),
  clearTrackingButton: requireButton('clear-tracking'),
  trackingStatus: requireValueLabel('tracking-status'),
  trackingSpriteId: requireValueLabel('tracking-sprite-id'),
  trackingCarId: requireValueLabel('tracking-car-id'),
  trackingElementIndex: requireValueLabel('tracking-element-index'),
  trackingImageId: requireValueLabel('tracking-image-id'),
  trackingWorld: requireValueLabel('tracking-world'),
  trackingCanvas: requireValueLabel('tracking-canvas'),
});

const initialize = async () => {
  const canvas = document.getElementById('main-canvas');
  if (!(canvas instanceof HTMLCanvasElement)) {
    throw new Error('Missing canvas element.');
  }
  const controls = resolveControls();

  const wasmUrl = new URL(
    '../massive-sprites/dist/wasm/compute.wasm',
    import.meta.url
  ).toString();
  const wasmInstance = await loadWasmModule(wasmUrl);

  const renderer = createObjectCanvasRenderer(canvas, wasmInstance, {
    logger: getConsoleLogger(),
  });

  const formatCoordinate = (value: number) =>
    Number.isFinite(value) ? value.toFixed(2) : '-';

  const formatVector2 = (x: number, y: number) =>
    `${formatCoordinate(x)}, ${formatCoordinate(y)}`;

  const formatVector3 = (x: number, y: number, z: number) =>
    `${formatCoordinate(x)}, ${formatCoordinate(y)}, ${formatCoordinate(z)}`;

  type SingleTrackingState = {
    readonly kind: 'single';
    readonly spriteId: number;
    readonly elementIndex: number;
  };
  type GroupTrackingState = {
    readonly kind: 'moving-group';
  };
  type TrackingState = SingleTrackingState | GroupTrackingState;
  type TrackedSpriteState = {
    readonly spriteId: number;
    readonly spriteState: SpriteState;
  };

  let trackingState: TrackingState | null = null;
  let trackingTimerId: number | undefined = undefined;
  const spriteLabelMap = new Map<number, string>();

  const updateTrackingStatus = (state: TrackingState | null) => {
    if (!state) {
      controls.trackingStatus.textContent = 'Not tracking';
      return;
    }
    if (state.kind === 'single') {
      controls.trackingStatus.textContent = `Tracking sprite #${state.spriteId}`;
      return;
    }
    const count = renderer.getCameraTrackingState()?.spriteIds.length ?? 0;
    controls.trackingStatus.textContent =
      count > 0
        ? `Tracking ${count} ${count === 1 ? 'car' : 'cars'}`
        : 'Tracking moving cars';
  };

  const resetTrackingPanel = () => {
    updateTrackingStatus(null);
    controls.trackingSpriteId.textContent = '-';
    controls.trackingCarId.textContent = '-';
    controls.trackingElementIndex.textContent = '-';
    controls.trackingImageId.textContent = '-';
    controls.trackingWorld.textContent = '-';
    controls.trackingCanvas.textContent = '-';
  };

  const stopTrackingLoop = () => {
    if (trackingTimerId !== undefined) {
      window.clearInterval(trackingTimerId);
      trackingTimerId = undefined;
    }
  };

  const updateTrackingPanel = () => {
    if (!trackingState) {
      return;
    }
    const rendererTrackingState = renderer.getCameraTrackingState();
    if (!rendererTrackingState) {
      trackingState = null;
      stopTrackingLoop();
      resetTrackingPanel();
      return;
    }
    updateTrackingStatus(trackingState);
    if (trackingState.kind === 'single') {
      let spriteState;
      try {
        spriteState = renderer.getSpriteState(trackingState.spriteId);
      } catch {
        trackingState = null;
        stopTrackingLoop();
        resetTrackingPanel();
        return;
      }
      const element = spriteState.elements[trackingState.elementIndex];
      const worldX = spriteState.sx.value;
      const worldY = spriteState.sy.value;
      const worldZ = spriteState.sz;
      const canvasPosition = spriteState.viewportBasePosition;

      controls.trackingSpriteId.textContent = String(trackingState.spriteId);
      controls.trackingCarId.textContent =
        spriteLabelMap.get(trackingState.spriteId) ?? '-';
      controls.trackingElementIndex.textContent = String(
        trackingState.elementIndex
      );
      controls.trackingImageId.textContent = element?.imageId ?? '-';
      controls.trackingWorld.textContent = formatVector3(
        worldX,
        worldY,
        worldZ
      );
      controls.trackingCanvas.textContent = canvasPosition
        ? formatVector2(canvasPosition.xPixel, canvasPosition.yPixel)
        : '-';
      return;
    }

    const trackedStates = rendererTrackingState.spriteIds
      .map((spriteId: number) => {
        try {
          return {
            spriteId,
            spriteState: renderer.getSpriteState(spriteId),
          };
        } catch {
          return undefined;
        }
      })
      .filter(
        (entry: TrackedSpriteState | undefined): entry is TrackedSpriteState =>
          entry !== undefined
      );
    if (trackedStates.length === 0) {
      trackingState = null;
      stopTrackingLoop();
      resetTrackingPanel();
      return;
    }
    const aggregate = trackedStates.reduce(
      (
        acc: {
          readonly worldX: number;
          readonly worldY: number;
          readonly worldZ: number;
          readonly canvasX: number;
          readonly canvasY: number;
          readonly canvasCount: number;
        },
        entry: TrackedSpriteState
      ) => ({
        worldX: acc.worldX + entry.spriteState.sx.value,
        worldY: acc.worldY + entry.spriteState.sy.value,
        worldZ: acc.worldZ + entry.spriteState.sz,
        canvasX:
          acc.canvasX + (entry.spriteState.viewportBasePosition?.xPixel ?? 0),
        canvasY:
          acc.canvasY + (entry.spriteState.viewportBasePosition?.yPixel ?? 0),
        canvasCount:
          acc.canvasCount + (entry.spriteState.viewportBasePosition ? 1 : 0),
      }),
      {
        worldX: 0,
        worldY: 0,
        worldZ: 0,
        canvasX: 0,
        canvasY: 0,
        canvasCount: 0,
      }
    );
    const count = trackedStates.length;
    controls.trackingSpriteId.textContent =
      count === 1
        ? String(trackedStates[0]!.spriteId)
        : `${count} tracked sprites`;
    controls.trackingCarId.textContent =
      count === 1
        ? (spriteLabelMap.get(trackedStates[0]!.spriteId) ?? '-')
        : `${count} moving cars`;
    controls.trackingElementIndex.textContent = '-';
    controls.trackingImageId.textContent = '-';
    controls.trackingWorld.textContent = formatVector3(
      aggregate.worldX / count,
      aggregate.worldY / count,
      aggregate.worldZ / count
    );
    controls.trackingCanvas.textContent =
      aggregate.canvasCount > 0
        ? formatVector2(
            aggregate.canvasX / aggregate.canvasCount,
            aggregate.canvasY / aggregate.canvasCount
          )
        : '-';
  };

  const startTrackingLoop = () => {
    if (trackingTimerId !== undefined) {
      return;
    }
    trackingTimerId = window.setInterval(
      updateTrackingPanel,
      TRACKING_INTERVAL_MS
    );
  };

  const buildTrackingInterpolation = () => ({
    mode: 'feedback' as const,
    durationMs: CAMERA_CONTROL_INTERACTION_INTERPOLATION_DURATION_MS,
    easing: { type: 'linear' as const },
  });

  const buildTrackingOptions = (
    state: TrackingState
  ): ObjectCameraTrackingOptions | null => {
    if (state.kind === 'single') {
      return {
        spriteIds: [state.spriteId],
        minDistance: TRACKING_MIN_DISTANCE,
        interpolation: buildTrackingInterpolation(),
      };
    }
    const spriteIds = movingSprites.map((controller) => controller.spriteId);
    if (spriteIds.length === 0) {
      return null;
    }
    return {
      targetMode: 'contentApprox',
      spriteIds,
      minDistance: TRACKING_MIN_DISTANCE,
      fitPadding: TRACKING_FIT_PADDING,
      fitZoomBias: 1,
      interpolation: buildTrackingInterpolation(),
    };
  };

  const setTrackingState = (state: TrackingState | null) => {
    trackingState = state;
    if (!trackingState) {
      renderer.clearCameraTracking();
      stopTrackingLoop();
      resetTrackingPanel();
      return;
    }
    const nextTracking = buildTrackingOptions(trackingState);
    if (!nextTracking) {
      trackingState = null;
      renderer.clearCameraTracking();
      stopTrackingLoop();
      resetTrackingPanel();
      return;
    }
    renderer.setCameraTracking(nextTracking);
    updateTrackingPanel();
    startTrackingLoop();
  };

  resetTrackingPanel();

  const { carVariants } = await registerSpriteImages(renderer);
  const labelAtlasId = renderer.allocateAtlas({
    pickMask: PICK_MASK_OPTIONS,
  });
  const routeLayout = await loadRouteLayout(
    new URL('./route-real.json', window.location.href).toString()
  );

  const graph = routeLayout.graph;
  const geometry = createGraphGeometry(graph);
  const routeWayPointList = graph.routeWayPointList;
  if (routeWayPointList.length === 0) {
    throw new Error('Graph does not have route way points.');
  }

  renderer.addSprite(
    createBackdropPlacement(
      routeLayout.bounds.minX + routeLayout.bounds.width * 0.5,
      routeLayout.bounds.minY + routeLayout.bounds.height * 0.5
    )
  );

  const polylinePlacements = buildGraphPolylinePlacements(
    geometry,
    (wayGeometry) => ({
      nodes: wayGeometry.nodeList.map((node) => ({
        x: node.lng,
        y: node.lat,
        thickness: ROUTE_THICKNESS,
      })),
      color: ROUTE_COLOR,
      layer: ROUTE_LAYER,
      joinCorrection: { type: 'fan', intermediatePointCount: 3 },
      capCorrection: { type: 'fan', pointCount: 3 },
    })
  );
  renderer.addPolylines(polylinePlacements.map(({ placement }) => placement));

  const initialWayPointOpacity = controls.waypointsToggle.checked ? 1 : 0;
  const routeWayPointIdSet = new Set(
    routeWayPointList.map((wayPoint) => wayPoint.id)
  );
  const wayPointPlacements = routeWayPointList.map((routeWayPoint) => ({
    placement: {
      sx: { value: routeWayPoint.lng },
      sy: { value: routeWayPoint.lat },
      opacity: { value: initialWayPointOpacity },
      elements: [
        {
          imageId: routeWayPoint.image,
          layer: WAYPOINT_LAYER,
          scale: { value: WAYPOINT_SPRITE_SCALE },
          anchorY: { value: -0.9 },
          mode: 'billboard' as const,
        },
      ],
    },
  }));

  const totalRouteLength = [...geometry.wayGeometryById.values()].reduce(
    (total, wayGeometry) => total + wayGeometry.totalLength,
    0
  );
  if (!Number.isFinite(totalRouteLength) || totalRouteLength <= 0) {
    throw new Error('Graph length is invalid.');
  }

  const pickPauseDurationMs = () =>
    Math.round(randomBetween(0, WAYPOINT_PAUSE_MAX_MS));

  const resolveTravelDurationMs = (wayId: string, speed: number) => {
    const wayGeometry = geometry.wayGeometryById.get(wayId);
    if (!wayGeometry) {
      throw new Error(`Unknown route way: ${wayId}`);
    }
    if (!Number.isFinite(speed) || speed <= 0) {
      return 0;
    }
    return Math.max(0, Math.round(wayGeometry.totalLength / speed));
  };

  const movingEntityManager = createLogicalGraphEntityManager<MovingSpriteData>(
    {
      geometry,
      renderer,
      tickIntervalMs: MOVING_INTERPOLATION_TICK_INTERVAL_MS,
      interpolation: {
        mode: 'feedback',
        easing: { type: 'linear' },
      },
      createSpritePlacement: (entity, position) =>
        buildMovingSpritePlacement(
          entity.data,
          MOVING_LAYER,
          position.point.lng,
          position.point.lat
        ),
    }
  );

  renderer.start();

  const wayPointSpriteIds = (await renderer.addSprites(
    wayPointPlacements.map(({ placement }) => placement),
    true
  )) as number[];

  interface MovingSpriteController {
    entityId: string;
    spriteId: number;
    carLabel: string;
    stop: () => void;
  }

  const movingSprites: MovingSpriteController[] = [];

  const resolveCarVariant = (index: number) => {
    if (carVariants.length === 0) {
      throw new Error('Missing car variants.');
    }
    const safeIndex = index % carVariants.length;
    const variant = carVariants[safeIndex];
    if (!variant) {
      throw new Error('Missing car variant.');
    }
    return variant;
  };

  const createMovingSpriteController = async (
    carIndex: number
  ): Promise<MovingSpriteController> => {
    const baseDurationMs = Math.round(
      randomBetween(MOVING_INTERVAL_MS_MIN, MOVING_INTERVAL_MS_MAX)
    );
    const speed = totalRouteLength / baseDurationMs;
    const startWayPoint =
      routeWayPointList[Math.floor(Math.random() * routeWayPointList.length)];
    if (!startWayPoint) {
      throw new Error('Route way point is missing.');
    }
    const { imageId, labelColor } = resolveCarVariant(carIndex);
    const movingSprite = await createMovingSpriteData(
      renderer,
      labelAtlasId,
      imageId,
      labelColor
    );
    const carLabel = movingSprite.carLabel;
    const entityId = carLabel;
    const spriteId = await movingEntityManager.registerEntity({
      entityId,
      data: movingSprite,
      position: createWayPointGraphPosition(startWayPoint.id),
      timestampMs: Date.now(),
    });
    spriteLabelMap.set(spriteId, carLabel);
    const { stop } = createRouteTraversalController({
      geometry,
      entityManager: movingEntityManager,
      entityId,
      speed,
      incomingWayId: undefined,
      routeWayPointIdSet,
      pickPauseDurationMs,
      resolveTravelDurationMs,
      random: () => Math.random(),
      retryDelayMs: MOVING_INTERPOLATION_TICK_INTERVAL_MS,
      timer: {
        now: () => Date.now(),
        setTimeout: (handler, timeoutMs) =>
          window.setTimeout(handler, timeoutMs),
        clearTimeout: (timeoutId) => window.clearTimeout(timeoutId),
      },
    });
    return { entityId, spriteId, carLabel, stop };
  };

  const applyCarCount = async (count: number) => {
    const targetCount = Math.round(
      clampNumber(count, CAR_COUNT_MIN, CAR_COUNT_MAX)
    );
    let removedTrackedSprite = false;
    while (movingSprites.length < targetCount) {
      const controller = await createMovingSpriteController(
        movingSprites.length
      );
      movingSprites.push(controller);
    }
    while (movingSprites.length > targetCount) {
      const controller = movingSprites.pop();
      if (!controller) {
        continue;
      }
      controller.stop();
      movingEntityManager.unregisterEntity(controller.entityId);
      spriteLabelMap.delete(controller.spriteId);
      removedTrackedSprite =
        removedTrackedSprite ||
        (trackingState?.kind === 'single' &&
          trackingState.spriteId === controller.spriteId);
    }
    if (removedTrackedSprite) {
      setTrackingState(null);
      return;
    }
    if (trackingState?.kind === 'moving-group') {
      setTrackingState(trackingState);
    }
  };

  let pendingCarCount: number | undefined = undefined;
  let carCountUpdating = false;

  const requestCarCountUpdate = (count: number) => {
    pendingCarCount = count;
    if (carCountUpdating) {
      return;
    }
    carCountUpdating = true;
    const run = async () => {
      while (pendingCarCount !== undefined) {
        const nextCount = pendingCarCount;
        pendingCarCount = undefined;
        await applyCarCount(nextCount);
      }
      carCountUpdating = false;
    };
    void run();
  };

  const setWayPointVisibility = (visible: boolean) => {
    const opacityValue = visible ? 1 : 0;
    const updates = wayPointSpriteIds.map((spriteId) => ({
      spriteId,
      opacity: { value: opacityValue },
    }));
    renderer.updateSprites(updates);
  };

  const updateWayPointVisibility = () => {
    setWayPointVisibility(controls.waypointsToggle.checked);
  };

  controls.waypointsToggle.addEventListener('change', updateWayPointVisibility);
  updateWayPointVisibility();

  bindCarCountControl(
    controls.carCountInput,
    controls.carCountValue,
    requestCarCountUpdate
  );

  controls.resetViewButton.addEventListener('click', () => {
    adjustCameraToRoute(renderer, canvas, routeLayout.bounds);
  });
  controls.trackAllCarsButton.addEventListener('click', () => {
    setTrackingState({ kind: 'moving-group' });
  });
  controls.clearTrackingButton.addEventListener('click', () => {
    setTrackingState(null);
  });

  const resolveCanvasPosition = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  };

  canvas.addEventListener('pointerup', (event) => {
    if (event.button !== 0) {
      return;
    }
    const { x, y } = resolveCanvasPosition(event);
    const result = renderer.pickAt(x, y);
    if (result && result.kind === 'sprite') {
      setTrackingState({
        kind: 'single',
        spriteId: result.spriteId,
        elementIndex: result.elementIndex,
      });
    } else {
      setTrackingState(null);
    }
  });

  adjustCameraToRoute(renderer, canvas, routeLayout.bounds);
  enableCameraInteraction(renderer);
};

void initialize();
