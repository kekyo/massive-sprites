// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import {
  createObjectCanvasRenderer,
  getConsoleLogger,
  loadWasmModule,
  type ColorRGBA,
  type PolylineCapCorrection,
  type PolylineJoinCorrection,
  type ObjectPlacementValue,
  type ObjectUpdateValue,
  type SpriteElementBorderPlacement,
  type SpriteElementBorderUpdate,
  type SpriteElementLeaderlinePlacement,
  type SpriteElementLeaderlineUpdate,
  type SpriteElementPlacement,
  type SpriteElementUpdate,
  type SpriteElementRenderMode,
  type SpriteBulkUpdate,
  type SpritePlacement,
  type SpriteTextureSamplingOptions,
  type ObjectInterpolationParameter,
  type ObjectPerformanceSnapshot,
  type WasmInputPrecision,
  type ObjectCanvasCameraControlModifiers,
  type ObjectCanvasCameraControlPointerButton,
  type ObjectCanvasCameraControlPointerTrigger,
  type ObjectCanvasRenderer,
  type ObjectCanvasPickEvent,
} from 'massive-sprites';
import {
  buildCheckerGrid,
  clampGridSize,
  computeGridLayout,
  getGridCellSize,
  type SpriteImage,
} from './sprite-grid';
import {
  CAR_IMAGE_ID,
  CAUTION_IMAGE_ID,
  createElementModeElementsUpdate,
  createRotateElementsUpdate,
  toInterpolationOnlyElementUpdate,
  type ElementRotationInterpolations,
  type ElementScaleInterpolations,
  type ElementMode,
  type ElementModes,
  type ElementRotateDegs,
  type ElementShiftInterpolations,
  type ElementTuple,
} from './sprite-elements';
import { createUpdateValue } from './element-params';
import {
  applyOpacityModeToElementUpdate,
  applyRotationModeToElementUpdate,
  shouldAnimateOpacityWaveFromModes,
  shouldAdvanceElementRotatePhase,
  shouldAdvanceElementShiftPhase,
  type OpacityInterpolationMode,
  type OpacityMode,
  type RotationMode,
  type ScaleInterpolationMode,
  type ShiftInterpolationMode,
} from './sprite-element-motion';
import {
  type DemoInterpolationType,
  isDemoInterpolationType,
  resolveDemoInterpolationEasing,
} from './interpolation-easing';
import {
  MOVE_PHASES,
  OPACITY_WAVE_PHASES,
  resolveSpriteMotion,
  type MoveMode,
} from './sprite-motion';
import {
  buildDemoAutoDirectionUpdate,
  type AutoDirectionInterpolationMode,
  type DemoAutoDirectionSpace,
  type AutoDirectionMode,
} from './auto-direction';
import { resolveCameraPositionRange } from './camera-range';
import {
  forEachReverse,
  resolveCameraFar,
  shouldApplyCameraUpdateFromSlider,
  shouldSyncCameraSlidersFromEvent,
} from './demo-utils';
import { buildLabelGlyphSpec, type LabelGlyphSpec } from './label-glyph';
import {
  applyDemoCameraResetValues,
  createAdjustCameraToSpritesOptions,
  createDemoCameraResetValues,
} from './camera-reset';
import {
  DEFAULT_RUNTIME_SCALING_LIMIT_PRESET_ID,
  resolveRuntimeScalingLimitPreset,
  type RuntimeScalingLimitPresetId,
} from './runtime-scaling';

////////////////////////////////////////////////////////////////////////////////////////////////////

const DEFAULT_ATLAS_MIN_SIZE = 8192;
const DEFAULT_ATLAS_PADDING_PIXEL = 2;
const POLYLINE_HUE_SATURATION = 0.7;
const POLYLINE_HUE_LIGHTNESS = 0.55;
const POLYLINE_RANDOM_HUE_SHIFT = 40;

const INTERPOLATION_BASE_INTERVAL_MS = 500;
const CAMERA_CONTROL_POLLING_INTERVAL_MS = 200;
const STATS_UPDATE_INTERVAL_MS = 300;
const BACKDROP_IMAGE_ID = 'demo-backdrop-image';
const BACKDROP_LAYER = 0;

////////////////////////////////////////////////////////////////////////////////////////////////////

const loadImage = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${source}`));
    image.src = source;
  });

const isPowerOfTwo = (value: number) => (value & (value - 1)) === 0;

const getNextPowerOfTwo = (value: number) => {
  let result = 1;
  while (result < value) {
    result <<= 1;
  }
  return result;
};

const clampUnit = (value: number) =>
  Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));

const normalizeHue = (value: number) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const wrapped = value % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
};

const hslToRgb = (hue: number, saturation: number, lightness: number) => {
  const h = normalizeHue(hue) / 60;
  const s = clampUnit(saturation);
  const l = clampUnit(lightness);
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (h >= 0 && h < 1) {
    r1 = c;
    g1 = x;
  } else if (h < 2) {
    r1 = x;
    g1 = c;
  } else if (h < 3) {
    g1 = c;
    b1 = x;
  } else if (h < 4) {
    g1 = x;
    b1 = c;
  } else if (h < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }
  const m = l - c / 2;
  return { r: r1 + m, g: g1 + m, b: b1 + m };
};

const toHex = (value: number) =>
  Math.min(255, Math.max(0, Math.round(value * 255)))
    .toString(16)
    .padStart(2, '0');

const SPRITE_VISIBILITY_DISTANCE_MIN_VALUE = 1;
const SPRITE_VISIBILITY_DISTANCE_MAX_VALUE = 120000;
const SPRITE_VISIBILITY_DISTANCE_DISABLED_VALUE = 120001;

const resolveSpriteVisibilityDistanceValue = (sliderValue: number) =>
  Number.isFinite(sliderValue) &&
  sliderValue >= SPRITE_VISIBILITY_DISTANCE_MIN_VALUE &&
  sliderValue <= SPRITE_VISIBILITY_DISTANCE_MAX_VALUE
    ? Math.trunc(sliderValue)
    : undefined;

const formatSpriteVisibilityDistanceValue = (sliderValue: number) => {
  const resolvedValue = resolveSpriteVisibilityDistanceValue(sliderValue);
  return resolvedValue === undefined ? 'Disabled' : `${resolvedValue} wu`;
};

const resolveHueColor = (
  hue: number,
  saturation: number,
  lightness: number
) => {
  const rgb = hslToRgb(hue, saturation, lightness);
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}` as ColorRGBA;
};

interface AtlasImageCandidate {
  id: string;
  bitmap: { width?: number; height?: number };
}

interface AtlasImageSizing {
  id: string;
  sourceWidth: number;
  sourceHeight: number;
  uploadWidth: number;
  uploadHeight: number;
  paddedWidth: number;
  paddedHeight: number;
  maxPerPage: number;
}

interface AtlasSizingResult {
  widthPixel: number;
  heightPixel: number;
  paddingPixel: number;
  requestedWidth: number | null;
  requestedHeight: number | null;
  requiredWidth: number;
  requiredHeight: number;
  maxTextureSize: number | null;
  cappedByMax: boolean;
  fitsLargest: boolean;
  estimatedPages: number;
  images: AtlasImageSizing[];
}

type CameraInterpolationMode = 'none' | DemoInterpolationType;
type DemoPolylineCorrectionSelectValue = 'none' | 'fan0' | 'fan1' | 'fan5';

const resolveAtlasPageSize = (
  images: AtlasImageCandidate[],
  upScalingToPowerOfTwo: boolean,
  options?: {
    paddingPixel?: number;
    requestedWidth?: number | null;
    requestedHeight?: number | null;
    maxTextureSize?: number | null;
  }
): AtlasSizingResult => {
  const paddingPixel = options?.paddingPixel ?? DEFAULT_ATLAS_PADDING_PIXEL;
  const requestedWidth = options?.requestedWidth ?? null;
  const requestedHeight = options?.requestedHeight ?? null;
  const maxTextureSize = options?.maxTextureSize ?? null;

  let requiredWidth = 0;
  let requiredHeight = 0;
  const baseImages = images.map((entry) => {
    const width = Math.max(0, entry.bitmap.width ?? 0);
    const height = Math.max(0, entry.bitmap.height ?? 0);
    const uploadWidth = upScalingToPowerOfTwo
      ? isPowerOfTwo(width)
        ? width
        : getNextPowerOfTwo(width)
      : width;
    const uploadHeight = upScalingToPowerOfTwo
      ? isPowerOfTwo(height)
        ? height
        : getNextPowerOfTwo(height)
      : height;
    const paddedWidth = uploadWidth + paddingPixel * 2;
    const paddedHeight = uploadHeight + paddingPixel * 2;
    requiredWidth = Math.max(requiredWidth, paddedWidth);
    requiredHeight = Math.max(requiredHeight, paddedHeight);
    return {
      id: entry.id,
      sourceWidth: width,
      sourceHeight: height,
      uploadWidth,
      uploadHeight,
      paddedWidth,
      paddedHeight,
      maxPerPage: 0,
    };
  });

  const fallbackWidth = requestedWidth ?? DEFAULT_ATLAS_MIN_SIZE;
  const fallbackHeight = requestedHeight ?? DEFAULT_ATLAS_MIN_SIZE;
  const baseWidth = Math.max(fallbackWidth, requiredWidth);
  const baseHeight = Math.max(fallbackHeight, requiredHeight);
  const resolvedWidth = upScalingToPowerOfTwo
    ? getNextPowerOfTwo(baseWidth)
    : baseWidth;
  const resolvedHeight = upScalingToPowerOfTwo
    ? getNextPowerOfTwo(baseHeight)
    : baseHeight;
  const cappedWidth =
    typeof maxTextureSize === 'number'
      ? Math.min(resolvedWidth, maxTextureSize)
      : resolvedWidth;
  const cappedHeight =
    typeof maxTextureSize === 'number'
      ? Math.min(resolvedHeight, maxTextureSize)
      : resolvedHeight;
  const cappedByMax =
    typeof maxTextureSize === 'number' &&
    (resolvedWidth > maxTextureSize || resolvedHeight > maxTextureSize);
  const fitsLargest =
    cappedWidth >= requiredWidth && cappedHeight >= requiredHeight;
  const pageArea = Math.max(1, cappedWidth) * Math.max(1, cappedHeight);
  const sizedImages = baseImages.map((image) => {
    const perRow =
      image.paddedWidth > 0 ? Math.floor(cappedWidth / image.paddedWidth) : 0;
    const perCol =
      image.paddedHeight > 0
        ? Math.floor(cappedHeight / image.paddedHeight)
        : 0;
    return {
      ...image,
      maxPerPage: Math.max(0, perRow * perCol),
    };
  });
  const totalArea = sizedImages.reduce(
    (acc, image) => acc + image.paddedWidth * image.paddedHeight,
    0
  );
  const estimatedPages = Math.max(1, Math.ceil(totalArea / pageArea));

  return {
    widthPixel: cappedWidth,
    heightPixel: cappedHeight,
    paddingPixel,
    requestedWidth,
    requestedHeight,
    requiredWidth,
    requiredHeight,
    maxTextureSize,
    cappedByMax,
    fitsLargest,
    estimatedPages,
    images: sizedImages,
  };
};

const resolveMaxTextureSize = (canvas: HTMLCanvasElement) => {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    premultipliedAlpha: false,
  });
  if (!gl) {
    return null;
  }
  const value = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const loadImageBitmap = async (source: string) => {
  const image = await loadImage(source);
  return createImageBitmap(image);
};

const loadImageBitmapFromFile = async (file: File) => createImageBitmap(file);

type RuntimeTextureSampling = Required<SpriteTextureSamplingOptions>;

const DEFAULT_TEXTURE_SAMPLING: RuntimeTextureSampling = {
  minFilter: 'linearMipmapLinear',
  magFilter: 'linear',
  wrapS: 'clampToEdge',
  wrapT: 'clampToEdge',
  npotPolicy: 'fallback',
  maxAnisotropy: 16,
};

const readTextureMinFilter = (
  value: string
): RuntimeTextureSampling['minFilter'] => {
  switch (value) {
    case 'nearest':
    case 'linear':
    case 'nearestMipmapNearest':
    case 'linearMipmapNearest':
    case 'nearestMipmapLinear':
    case 'linearMipmapLinear':
      return value;
    default:
      return DEFAULT_TEXTURE_SAMPLING.minFilter;
  }
};

const readTextureMagFilter = (
  value: string
): RuntimeTextureSampling['magFilter'] => {
  switch (value) {
    case 'nearest':
    case 'linear':
      return value;
    default:
      return DEFAULT_TEXTURE_SAMPLING.magFilter;
  }
};

const readTextureWrapMode = (
  value: string
): RuntimeTextureSampling['wrapS'] => {
  switch (value) {
    case 'clampToEdge':
    case 'repeat':
    case 'mirroredRepeat':
      return value;
    default:
      return DEFAULT_TEXTURE_SAMPLING.wrapS;
  }
};

const readTextureNpotPolicy = (
  value: string
): RuntimeTextureSampling['npotPolicy'] => {
  switch (value) {
    case 'fallback':
    case 'error':
      return value;
    default:
      return DEFAULT_TEXTURE_SAMPLING.npotPolicy;
  }
};

const cloneTextureSampling = (
  sampling: RuntimeTextureSampling
): RuntimeTextureSampling => ({
  minFilter: sampling.minFilter,
  magFilter: sampling.magFilter,
  wrapS: sampling.wrapS,
  wrapT: sampling.wrapT,
  npotPolicy: sampling.npotPolicy,
  maxAnisotropy: sampling.maxAnisotropy,
});

const isSameTextureSampling = (
  lhs: RuntimeTextureSampling,
  rhs: RuntimeTextureSampling
) =>
  lhs.minFilter === rhs.minFilter &&
  lhs.magFilter === rhs.magFilter &&
  lhs.wrapS === rhs.wrapS &&
  lhs.wrapT === rhs.wrapT &&
  lhs.npotPolicy === rhs.npotPolicy &&
  lhs.maxAnisotropy === rhs.maxAnisotropy;

document.addEventListener('DOMContentLoaded', async () => {
  console.log('DOM loaded, initializing application...');

  try {
    const curveUrl = new URL(
      './images/crystalball-1500.png',
      import.meta.url
    ).toString();
    const walkerUrl = new URL(
      './images/globe-1500.png',
      import.meta.url
    ).toString();
    const cautionUrl = new URL(
      './images/fullmoon-500.png',
      import.meta.url
    ).toString();
    const carUrl = new URL('./images/star-300.png', import.meta.url).toString();

    const canvas = document.querySelector<HTMLCanvasElement>('#main-canvas');
    if (!canvas) {
      throw new Error('Canvas not found: main-canvas');
    }
    const wasmUrl = new URL(
      '../massive-sprites/dist/wasm/compute.wasm',
      import.meta.url
    ).toString();
    const rect = canvas.getBoundingClientRect();
    const viewWidth = Math.max(
      1,
      rect.width || canvas.clientWidth || canvas.width
    );
    const viewHeight = Math.max(
      1,
      rect.height || canvas.clientHeight || canvas.height
    );

    const [curveBitmap, walkerBitmap, cautionBitmap, carBitmap] =
      await Promise.all([
        loadImageBitmap(curveUrl),
        loadImageBitmap(walkerUrl),
        loadImageBitmap(cautionUrl),
        loadImageBitmap(carUrl),
      ]);

    const spriteImages: [SpriteImage, SpriteImage] = [
      {
        imageId: 'curve',
        width: curveBitmap.width,
        height: curveBitmap.height,
      },
      {
        imageId: 'walker',
        width: walkerBitmap.width,
        height: walkerBitmap.height,
      },
    ];
    const { cellWidth, cellHeight } = getGridCellSize(spriteImages);
    const labelGlyphSpecs = new Map<string, LabelGlyphSpec>();

    type ElementImageMode = 'image' | 'label';
    type SpriteInstance = {
      id: number;
      imageId: string;
      baseX: number;
      baseY: number;
      stepY: number;
      shiftDegs: ElementRotateDegs;
      rotateDegs: ElementRotateDegs;
      rotateDir: number;
      columnIndex: number;
    };
    type BackdropImageSource = {
      name: string;
      bitmap: ImageBitmap;
    };

    let elementModes: ElementModes = ['none', 'none', 'none'];
    let spriteInstances: SpriteInstance[] = [];
    let rendererEpoch = 0;
    let pendingGridSize: number | null = null;
    let rebuildChain: Promise<void> = Promise.resolve();
    let cameraScaleCompensation = 1;
    let currentGridSize = 1;
    let movementSpeedScale = 1;
    let elementRotationSpeedScales: ElementTuple<number> = [0, 0, 0];
    let elementScales: ElementTuple<number> = [1, 1, 1];
    let elementAnchorXs: ElementTuple<number> = [0, 0, 0];
    let elementAnchorYs: ElementTuple<number> = [0, 0, 0];
    let elementBorderWidths: ElementTuple<number> = [0, 0, 0];
    let elementBorderHueValues: ElementTuple<number> = [350, 80, 200];
    let elementLeaderlineWidths: ElementTuple<number> = [0, 0, 0];
    let elementLeaderlineHueValues: ElementTuple<number> = [30, 140, 220];
    let spriteOpacityValue = 1;
    let spriteVisibilityDistanceValue: number | undefined = undefined;
    let polylineOuterOpacityValue = 1;
    let polylineOuterLayerValue = 1;
    let polylineOuterHueValue = 10;
    let polylineOuterJoinCorrectionValue: DemoPolylineCorrectionSelectValue =
      'fan5';
    let polylineOuterCapCorrectionValue: DemoPolylineCorrectionSelectValue =
      'fan5';
    let polylineRandomOpacityValue = 1;
    let polylineRandomLayerValue = 2;
    let polylineRandomHueValue = 200;
    let polylineRandomJoinCorrectionValue: DemoPolylineCorrectionSelectValue =
      'fan5';
    let polylineRandomCapCorrectionValue: DemoPolylineCorrectionSelectValue =
      'fan5';
    let spriteOpacityInterpolationMode: OpacityInterpolationMode = 'none';
    let useSpriteOpacityFeedforward = false;
    let currentPrecision: WasmInputPrecision = 'f32';
    let currentTextureSampling = cloneTextureSampling(DEFAULT_TEXTURE_SAMPLING);
    let currentScalingLimitPresetId: RuntimeScalingLimitPresetId =
      DEFAULT_RUNTIME_SCALING_LIMIT_PRESET_ID;
    let currentPickMaskEnabled = true;
    let currentUpscalingToPowerOfTwo = true;
    let renderer: ObjectCanvasRenderer | null = null;
    let stopRenderer: (() => void) | null = null;
    let detachCameraControls: (() => void) | null = null;
    let detachCameraEvents: (() => void) | null = null;
    let detachPickEvents: (() => void) | null = null;
    let isCameraInteracting = false;
    let wasmInstancePromise: ReturnType<typeof loadWasmModule> | null = null;
    let squarePolylineId: number | null = null;
    let randomPolylineId: number | null = null;
    let backdropSpriteId: number | null = null;
    let backdropImageSource: BackdropImageSource | null = null;
    const rendererLogger = getConsoleLogger();

    const getWasmInstance = () => {
      if (!wasmInstancePromise) {
        wasmInstancePromise = loadWasmModule(wasmUrl);
      }
      return wasmInstancePromise;
    };

    const resolvePolylineOuterColor = () =>
      resolveHueColor(
        polylineOuterHueValue,
        POLYLINE_HUE_SATURATION,
        POLYLINE_HUE_LIGHTNESS
      );

    const resolvePolylineRandomColor = () => ({
      color0: resolveHueColor(
        polylineRandomHueValue,
        POLYLINE_HUE_SATURATION,
        POLYLINE_HUE_LIGHTNESS
      ),
      color1: resolveHueColor(
        polylineRandomHueValue + POLYLINE_RANDOM_HUE_SHIFT,
        POLYLINE_HUE_SATURATION,
        POLYLINE_HUE_LIGHTNESS
      ),
      repeatLength: Math.max(cellWidth, cellHeight),
    });

    const resolveLeaderlineColor = (hue: number) =>
      resolveHueColor(hue, POLYLINE_HUE_SATURATION, POLYLINE_HUE_LIGHTNESS);
    const resolveBorderColor = (hue: number) =>
      resolveHueColor(hue, POLYLINE_HUE_SATURATION, POLYLINE_HUE_LIGHTNESS);
    const readPolylineCorrectionSelectValue = (
      select: HTMLSelectElement
    ): DemoPolylineCorrectionSelectValue => {
      const value = select.value;
      if (
        value === 'none' ||
        value === 'fan0' ||
        value === 'fan1' ||
        value === 'fan5'
      ) {
        return value;
      }
      return 'none';
    };
    const resolvePolylineJoinCorrection = (
      value: DemoPolylineCorrectionSelectValue
    ): PolylineJoinCorrection => {
      switch (value) {
        case 'fan0':
          return { type: 'fan', intermediatePointCount: 0 };
        case 'fan1':
          return { type: 'fan', intermediatePointCount: 1 };
        case 'fan5':
          return { type: 'fan', intermediatePointCount: 5 };
        case 'none':
        default:
          return { type: 'none' };
      }
    };
    const resolvePolylineCapCorrection = (
      value: DemoPolylineCorrectionSelectValue
    ): PolylineCapCorrection => {
      // The runtime starts cap fans at pointCount=1, so demo fan0 falls back to none.
      switch (value) {
        case 'fan1':
          return { type: 'fan', pointCount: 1 };
        case 'fan5':
          return { type: 'fan', pointCount: 5 };
        case 'fan0':
        case 'none':
        default:
          return { type: 'none' };
      }
    };

    const resolveLabelGlyphSpec = (imageId: string): LabelGlyphSpec => {
      const cached = labelGlyphSpecs.get(imageId);
      if (cached) {
        return cached;
      }
      const spec = buildLabelGlyphSpec();
      labelGlyphSpecs.set(imageId, spec);
      return spec;
    };
    const buildLabelImageId = (spriteId: number, imageId: string) =>
      `label-${spriteId}-${imageId}`;
    const resolveElementBaseImageId = (
      sprite: SpriteInstance,
      elementIndex: 0 | 1 | 2
    ) => {
      switch (elementIndex) {
        case 1:
          return CAUTION_IMAGE_ID;
        case 2:
          return CAR_IMAGE_ID;
        case 0:
        default:
          return sprite.imageId;
      }
    };
    const resolveElementImageIds = (
      sprite: SpriteInstance
    ): ElementTuple<string> => {
      return [
        elementImageModes[0] === 'label'
          ? buildLabelImageId(sprite.id, resolveElementBaseImageId(sprite, 0))
          : sprite.imageId,
        elementImageModes[1] === 'label'
          ? buildLabelImageId(sprite.id, resolveElementBaseImageId(sprite, 1))
          : CAUTION_IMAGE_ID,
        elementImageModes[2] === 'label'
          ? buildLabelImageId(sprite.id, resolveElementBaseImageId(sprite, 2))
          : CAR_IMAGE_ID,
      ];
    };
    const ensureLabelImage = async (
      spriteId: number,
      labelText: string,
      imageId: string
    ) => {
      const activeRenderer = renderer;
      if (!activeRenderer || currentAtlasId === null) {
        return;
      }
      const labelId = buildLabelImageId(spriteId, imageId);
      if (labelImageIds.has(labelId)) {
        return;
      }
      labelImageIds.add(labelId);
      const { dimensions, options } = resolveLabelGlyphSpec(imageId);
      try {
        await activeRenderer.registerTextGlyph(
          currentAtlasId,
          labelId,
          labelText,
          dimensions,
          options
        );
      } catch (error) {
        labelImageIds.delete(labelId);
        throw error;
      }
    };
    const ensureLabelImagesForSprites = async () => {
      const activeRenderer = renderer;
      if (!activeRenderer || currentAtlasId === null) {
        return;
      }
      if (!elementImageModes.includes('label')) {
        return;
      }
      const epoch = rendererEpoch;
      const pending: Promise<void>[] = [];
      spriteInstances.forEach((sprite) => {
        const labelText = `Label-${sprite.id}`;
        if (elementImageModes[0] === 'label') {
          const imageId = resolveElementBaseImageId(sprite, 0);
          pending.push(
            ensureLabelImage(sprite.id, labelText, imageId).catch((error) => {
              if (epoch === rendererEpoch) {
                console.error('Failed to register label glyph.', error);
              }
            })
          );
        }
        if (elementImageModes[1] === 'label') {
          const imageId = resolveElementBaseImageId(sprite, 1);
          pending.push(
            ensureLabelImage(sprite.id, labelText, imageId).catch((error) => {
              if (epoch === rendererEpoch) {
                console.error('Failed to register label glyph.', error);
              }
            })
          );
        }
        if (elementImageModes[2] === 'label') {
          const imageId = resolveElementBaseImageId(sprite, 2);
          pending.push(
            ensureLabelImage(sprite.id, labelText, imageId).catch((error) => {
              if (epoch === rendererEpoch) {
                console.error('Failed to register label glyph.', error);
              }
            })
          );
        }
      });
      await Promise.all(pending);
    };

    const applyPolylineStyleUpdates = () => {
      const activeRenderer = renderer;
      if (!activeRenderer) {
        return;
      }
      if (squarePolylineId !== null) {
        activeRenderer.updatePolyline(squarePolylineId, {
          layer: polylineOuterLayerValue,
          opacity: { value: polylineOuterOpacityValue },
          color: resolvePolylineOuterColor(),
          joinCorrection: resolvePolylineJoinCorrection(
            polylineOuterJoinCorrectionValue
          ),
          capCorrection: resolvePolylineCapCorrection(
            polylineOuterCapCorrectionValue
          ),
        });
      }
      if (randomPolylineId !== null) {
        activeRenderer.updatePolyline(randomPolylineId, {
          layer: polylineRandomLayerValue,
          opacity: { value: polylineRandomOpacityValue },
          color: resolvePolylineRandomColor(),
          joinCorrection: resolvePolylineJoinCorrection(
            polylineRandomJoinCorrectionValue
          ),
          capCorrection: resolvePolylineCapCorrection(
            polylineRandomCapCorrectionValue
          ),
        });
      }
    };

    const rebuildSprites = async (gridSize: number, epoch: number) => {
      const activeRenderer = renderer;
      if (!activeRenderer || epoch !== rendererEpoch) {
        spriteInstances = [];
        return;
      }
      const currentSprites = [...spriteInstances];
      spriteInstances = [];
      if (currentSprites.length > 0) {
        const removeIds = [...currentSprites]
          .reverse()
          .map((sprite) => sprite.id);
        activeRenderer.removeSprites(removeIds);
      }

      const safeGridSize = clampGridSize(gridSize);
      const fittedLayout = computeGridLayout(
        safeGridSize,
        viewWidth,
        viewHeight,
        cellWidth,
        cellHeight
      );
      const nextCameraScaleCompensation =
        fittedLayout.scale > 0 ? 1 / fittedLayout.scale : 1;
      const gridSprites = buildCheckerGrid(safeGridSize, spriteImages);
      const startX = (-safeGridSize * cellWidth) / 2 + cellWidth / 2;
      const startY = (safeGridSize * cellHeight) / 2 - cellHeight / 2;
      const moveInterpolation = buildMoveInterpolation();
      const spriteOpacityInterpolation = buildSpriteOpacityInterpolation();
      const elementShiftInterpolations = buildElementShiftInterpolations();
      const elementRotationInterpolations =
        buildElementRotationInterpolations();
      const elementScaleInterpolations = buildElementScaleInterpolations();
      const elementOpacityInterpolations = buildElementOpacityInterpolations();
      const shouldAnimateOpacityWave =
        shouldAnimateOpacityWaveFromModes(elementOpacityModes);
      const opacityPhase = shouldAnimateOpacityWave ? currentOpacityPhase : 1;
      const initialShiftDegs: ElementRotateDegs = [0, 0, 0];
      const initialRotateDegs: ElementRotateDegs = [0, 0, 0];
      const placements: SpritePlacement[] = [];
      const placementMeta = gridSprites.map((sprite, index) => {
        const position = {
          x: startX + cellWidth * sprite.xIndex,
          y: startY - cellHeight * sprite.yIndex,
        };
        const elementImageIds: ElementTuple<string> = [
          sprite.imageId,
          CAUTION_IMAGE_ID,
          CAR_IMAGE_ID,
        ];
        const modeElements = createElementModeElementsUpdate(
          elementImageIds,
          elementModes,
          initialShiftDegs,
          initialRotateDegs,
          elementShiftInterpolations,
          elementRotationInterpolations,
          elementScaleInterpolations,
          elementScales,
          elementOriginUseResolvedAnchors,
          elementAnchorXs,
          elementAnchorYs
        );
        const elementUpdates = applyElementVisualModesToElements(
          modeElements,
          elementOpacityInterpolations,
          opacityPhase,
          shouldAnimateOpacityWave
        );
        const placementElements = applyElementOrderingToElements(
          applyElementRenderModesToElements(
            applyElementLeaderlinesToPlacements(
              applyElementBordersToPlacements(
                toPlacementElements(elementUpdates)
              )
            )
          )
        );
        placements.push({
          sx: createPlacementValue(position.x, undefined),
          sy: createPlacementValue(position.y, moveInterpolation),
          opacity: createPlacementValue(
            spriteOpacityValue,
            spriteOpacityInterpolation
          ),
          ...(spriteVisibilityDistanceValue !== undefined
            ? { visibilityDistance: spriteVisibilityDistanceValue }
            : {}),
          elements: placementElements,
        });
        return {
          sprite,
          position,
          index,
        };
      });

      try {
        const spriteIds = (await activeRenderer.addSprites(
          placements,
          true
        )) as number[];
        if (epoch !== rendererEpoch) {
          return;
        }
        spriteIds.forEach((spriteId, index) => {
          const meta = placementMeta[index];
          if (!meta) {
            return;
          }
          const { sprite, position } = meta;
          spriteInstances.push({
            id: spriteId,
            imageId: sprite.imageId,
            baseX: position.x,
            baseY: position.y,
            stepY: sprite.height * 0.25,
            shiftDegs: [0, 0, 0],
            rotateDegs: [0, 0, 0],
            rotateDir: meta.index % 2 === 0 ? 1 : -1,
            columnIndex: sprite.xIndex,
          });
        });
      } catch (error) {
        if (epoch !== rendererEpoch) {
          return;
        }
        console.error('Failed to add sprites.', error);
      }
      if (epoch !== rendererEpoch) {
        return;
      }
      await ensureLabelImagesForSprites();
      const removeDemoPolylines = () => {
        const polylineIds: number[] = [];
        if (squarePolylineId !== null) {
          polylineIds.push(squarePolylineId);
        }
        if (randomPolylineId !== null) {
          polylineIds.push(randomPolylineId);
        }
        squarePolylineId = null;
        randomPolylineId = null;
        forEachReverse(polylineIds, (polylineId) => {
          activeRenderer.removePolyline(polylineId);
        });
      };
      const resolvePolylineThickness = () =>
        Math.max(8, Math.min(cellWidth, cellHeight) * 0.08);
      const buildSquareNodes = () => {
        if (spriteInstances.length === 0) {
          return [] as Array<{ x: number; y: number; thickness: number }>;
        }
        let minX = spriteInstances[0]!.baseX;
        let maxX = spriteInstances[0]!.baseX;
        let minY = spriteInstances[0]!.baseY;
        let maxY = spriteInstances[0]!.baseY;
        spriteInstances.forEach((sprite) => {
          minX = Math.min(minX, sprite.baseX);
          maxX = Math.max(maxX, sprite.baseX);
          minY = Math.min(minY, sprite.baseY);
          maxY = Math.max(maxY, sprite.baseY);
        });
        const thickness = resolvePolylineThickness();
        return [
          { x: maxX, y: maxY, thickness },
          { x: maxX, y: minY, thickness },
          { x: minX, y: minY, thickness },
          { x: minX, y: maxY, thickness },
          { x: maxX, y: maxY, thickness },
        ];
      };
      const buildRandomNodes = () => {
        const spriteCount = spriteInstances.length;
        const sampleCount = Math.floor(Math.sqrt(spriteCount));
        if (sampleCount < 2) {
          return [] as Array<{ x: number; y: number; thickness: number }>;
        }
        const indices = spriteInstances.map((_, index) => index);
        for (let i = indices.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [indices[i], indices[j]] = [indices[j]!, indices[i]!];
        }
        const thickness = resolvePolylineThickness() * 0.7;
        return indices.slice(0, sampleCount).map((index) => {
          const sprite = spriteInstances[index]!;
          return { x: sprite.baseX, y: sprite.baseY, thickness };
        });
      };
      const rebuildDemoPolylines = async () => {
        removeDemoPolylines();
        const squareNodes = buildSquareNodes();
        if (squareNodes.length >= 2) {
          try {
            const id = await activeRenderer.addPolyline(
              {
                nodes: squareNodes,
                layer: polylineOuterLayerValue,
                opacity: { value: polylineOuterOpacityValue },
                color: resolvePolylineOuterColor(),
                joinCorrection: resolvePolylineJoinCorrection(
                  polylineOuterJoinCorrectionValue
                ),
                capCorrection: resolvePolylineCapCorrection(
                  polylineOuterCapCorrectionValue
                ),
              },
              true
            );
            if (epoch === rendererEpoch) {
              squarePolylineId = id;
            }
          } catch (error) {
            console.error('Failed to add square polyline.', error);
          }
        }
        const randomNodes = buildRandomNodes();
        if (randomNodes.length >= 2) {
          try {
            const id = await activeRenderer.addPolyline(
              {
                nodes: randomNodes,
                layer: polylineRandomLayerValue,
                opacity: { value: polylineRandomOpacityValue },
                color: resolvePolylineRandomColor(),
                joinCorrection: resolvePolylineJoinCorrection(
                  polylineRandomJoinCorrectionValue
                ),
                capCorrection: resolvePolylineCapCorrection(
                  polylineRandomCapCorrectionValue
                ),
              },
              true
            );
            if (epoch === rendererEpoch) {
              randomPolylineId = id;
            }
          } catch (error) {
            console.error('Failed to add random polyline.', error);
          }
        }
      };
      await rebuildDemoPolylines();
      if (epoch !== rendererEpoch) {
        return;
      }
      currentGridSize = safeGridSize;
      cameraScaleCompensation = nextCameraScaleCompensation;
    };

    const scheduleRebuildSprites = (gridSize: number) => {
      pendingGridSize = gridSize;
      rebuildChain = rebuildChain
        .then(async () => {
          const nextSize = pendingGridSize;
          if (nextSize === null) {
            return;
          }
          pendingGridSize = null;
          await rebuildSprites(nextSize, rendererEpoch);
        })
        .catch((error) => {
          console.error('Failed to rebuild sprites.', error);
        });
      return rebuildChain;
    };

    const requireInput = (id: string) => {
      const input = document.querySelector<HTMLInputElement>(`#${id}`);
      if (!input) {
        throw new Error(`Input not found: ${id}`);
      }
      return input;
    };
    const requireSelect = (id: string) => {
      const select = document.querySelector<HTMLSelectElement>(`#${id}`);
      if (!select) {
        throw new Error(`Select not found: ${id}`);
      }
      return select;
    };

    const requireOutput = (id: string) => {
      const output = document.querySelector<HTMLSpanElement>(`#${id}`);
      if (!output) {
        throw new Error(`Output not found: ${id}`);
      }
      return output;
    };
    const requireButton = (id: string) => {
      const button = document.querySelector<HTMLButtonElement>(`#${id}`);
      if (!button) {
        throw new Error(`Button not found: ${id}`);
      }
      return button;
    };

    const elementIndices = [0, 1, 2] as const;
    type ElementIndex = (typeof elementIndices)[number];
    type InterpolationUpdate = ObjectInterpolationParameter | null | undefined;
    type InterpolationTuple = ElementTuple<InterpolationUpdate>;
    type ElementOpacityInterpolations = ElementTuple<InterpolationUpdate>;
    const resolveInterpolationUpdate = (
      interpolation: ObjectInterpolationParameter | null | undefined,
      updateInterpolation: boolean
    ): InterpolationUpdate =>
      updateInterpolation ? (interpolation ?? null) : undefined;
    const resolveElementInterpolationUpdates = (
      interpolations: Readonly<InterpolationTuple>,
      updateInterpolation: boolean
    ): InterpolationTuple => [
      resolveInterpolationUpdate(interpolations[0], updateInterpolation),
      resolveInterpolationUpdate(interpolations[1], updateInterpolation),
      resolveInterpolationUpdate(interpolations[2], updateInterpolation),
    ];
    const createPlacementValue = (
      value: number,
      interpolation: ObjectInterpolationParameter | undefined
    ): ObjectPlacementValue<number> =>
      interpolation ? { value, interpolation } : { value };
    const toPlacementValue = (
      value: ObjectUpdateValue<number> | undefined
    ): ObjectPlacementValue<number> | undefined => {
      if (!value || value.value === undefined) {
        return undefined;
      }
      const interpolation = value.interpolation ?? undefined;
      return interpolation
        ? { value: value.value, interpolation }
        : { value: value.value };
    };
    const toPlacementRotation = (
      value: ObjectUpdateValue<number> | undefined
    ): ObjectPlacementValue<number> | undefined => {
      if (!value || value.value === undefined) {
        return undefined;
      }
      const interpolation = value.interpolation ?? undefined;
      return {
        value: value.value,
        ...(interpolation !== undefined ? { interpolation } : {}),
      };
    };
    const toPlacementAutoDirection = (
      value: SpriteElementUpdate['autoDirection']
    ): SpriteElementPlacement['autoDirection'] => {
      if (!value) {
        return undefined;
      }
      const mode = value.mode;
      const placementMode =
        mode === null || mode === undefined
          ? undefined
          : mode.type === 'rotation'
            ? ({ type: 'rotation' } as const)
            : ({
                type: 'flipping',
                ...(mode.flipX !== undefined ? { flipX: mode.flipX } : {}),
                ...(mode.flipY !== undefined ? { flipY: mode.flipY } : {}),
                ...(mode.interpolation !== undefined &&
                mode.interpolation !== null
                  ? { interpolation: mode.interpolation }
                  : {}),
              } as const);
      return {
        space: value.space ?? 'world',
        ...(placementMode !== undefined ? { mode: placementMode } : {}),
        ...(value.shiftAngleRotation !== undefined
          ? { shiftAngleRotation: value.shiftAngleRotation }
          : {}),
        ...(value.minDistance !== undefined
          ? { minDistance: value.minDistance }
          : {}),
      };
    };
    const toPlacementLeaderline = (
      leaderline: SpriteElementLeaderlineUpdate | undefined
    ): SpriteElementLeaderlinePlacement | undefined => {
      if (!leaderline) {
        return undefined;
      }
      const width = toPlacementValue(leaderline.width);
      return {
        ...(width ? { width } : {}),
        color: leaderline.color,
      };
    };
    const toPlacementBorder = (
      border: SpriteElementBorderUpdate | null | undefined
    ): SpriteElementBorderPlacement | undefined => {
      if (!border || border.width === undefined || border.color === undefined) {
        return undefined;
      }
      return {
        width: border.width,
        color: border.color,
      };
    };
    const toPlacementElement = (
      element: SpriteElementUpdate | null | undefined
    ): SpriteElementPlacement | null | undefined => {
      if (!element) {
        return element;
      }
      if (element.imageId === undefined || element.imageId === null) {
        return null;
      }
      const shiftDistance = toPlacementValue(element.shiftDistance);
      const shiftAngleDeg = toPlacementValue(element.shiftAngleDeg);
      const scale = toPlacementValue(element.scale);
      const opacity = toPlacementValue(element.opacity);
      const anchorX = toPlacementValue(element.anchorX);
      const anchorY = toPlacementValue(element.anchorY);
      const rotation = toPlacementRotation(element.rotation);
      const autoDirection = toPlacementAutoDirection(element.autoDirection);
      const border = toPlacementBorder(element.border ?? undefined);
      const leaderline = toPlacementLeaderline(element.leaderline ?? undefined);
      return {
        imageId: element.imageId,
        ...(element.originLocation !== undefined
          ? { originLocation: element.originLocation }
          : {}),
        ...(element.mode !== undefined ? { mode: element.mode } : {}),
        ...(element.layer !== undefined ? { layer: element.layer } : {}),
        ...(element.order !== undefined ? { order: element.order } : {}),
        ...(shiftDistance ? { shiftDistance } : {}),
        ...(shiftAngleDeg ? { shiftAngleDeg } : {}),
        ...(scale ? { scale } : {}),
        ...(opacity ? { opacity } : {}),
        ...(anchorX ? { anchorX } : {}),
        ...(anchorY ? { anchorY } : {}),
        ...(rotation ? { rotation } : {}),
        ...(autoDirection !== undefined ? { autoDirection } : {}),
        ...(border ? { border } : {}),
        ...(leaderline ? { leaderline } : {}),
      };
    };
    const toPlacementElements = (
      elements: Readonly<(SpriteElementUpdate | null | undefined)[]>
    ): Array<SpriteElementPlacement | null | undefined> =>
      elements.map((element) => toPlacementElement(element));
    const syncBackdropImageName = () => {
      backdropImageNameOutput.textContent = backdropImageSource?.name ?? 'None';
      backdropClearButton.disabled = backdropImageSource === null;
    };
    const createBackdropElementUpdate = (): SpriteElementUpdate => ({
      imageId: BACKDROP_IMAGE_ID,
      mode: backdropRenderMode,
      layer: BACKDROP_LAYER,
      shiftDistance: { value: backdropShiftDistanceValue },
      shiftAngleDeg: { value: backdropShiftAngleValue },
      scale: { value: backdropScaleValue },
      opacity: { value: backdropOpacityValue },
      anchorX: { value: backdropAnchorXValue },
      anchorY: { value: backdropAnchorYValue },
      rotation: { value: backdropRotationValue },
    });
    const createBackdropPlacement = (): SpritePlacement => ({
      sx: createPlacementValue(0, undefined),
      sy: createPlacementValue(0, undefined),
      elements: [toPlacementElement(createBackdropElementUpdate())],
    });
    const createBackdropSpriteUpdate = () => ({
      sx: { value: 0 },
      sy: { value: 0 },
      elements: [createBackdropElementUpdate()],
    });
    const removeBackdropSprite = () => {
      const activeRenderer = renderer;
      if (!activeRenderer || backdropSpriteId === null) {
        backdropSpriteId = null;
        return;
      }
      activeRenderer.removeSprite(backdropSpriteId);
      backdropSpriteId = null;
    };
    const syncBackdropSprite = async (
      epoch: number = rendererEpoch,
      upScalingToPowerOfTwo: boolean = currentUpscalingToPowerOfTwo
    ) => {
      const activeRenderer = renderer;
      if (!activeRenderer || epoch !== rendererEpoch) {
        return;
      }
      if (!backdropImageSource || currentAtlasId === null) {
        removeBackdropSprite();
        activeRenderer.unregisterImage(BACKDROP_IMAGE_ID);
        return;
      }
      await activeRenderer.registerImage(
        currentAtlasId,
        BACKDROP_IMAGE_ID,
        backdropImageSource.bitmap,
        upScalingToPowerOfTwo
      );
      if (epoch !== rendererEpoch || renderer !== activeRenderer) {
        return;
      }
      if (backdropSpriteId === null) {
        backdropSpriteId = (await activeRenderer.addSprite(
          createBackdropPlacement(),
          true
        )) as number;
        return;
      }
      activeRenderer.updateSprite(
        backdropSpriteId,
        createBackdropSpriteUpdate()
      );
    };
    const applyBackdropSettings = () => {
      const activeRenderer = renderer;
      if (!activeRenderer || !backdropImageSource) {
        return;
      }
      if (backdropSpriteId === null) {
        void syncBackdropSprite(rendererEpoch).catch((error) => {
          console.error('Failed to add backdrop sprite.', error);
        });
        return;
      }
      activeRenderer.updateSprite(
        backdropSpriteId,
        createBackdropSpriteUpdate()
      );
    };
    const setBackdropImageSource = async (
      nextSource: BackdropImageSource | null
    ) => {
      const previousSource = backdropImageSource;
      backdropImageSource = nextSource;
      syncBackdropImageName();
      try {
        await syncBackdropSprite(rendererEpoch);
      } catch (error) {
        backdropImageSource = previousSource;
        syncBackdropImageName();
        if (nextSource) {
          nextSource.bitmap.close();
        }
        throw error;
      }
      if (previousSource && previousSource !== nextSource) {
        previousSource.bitmap.close();
      }
    };

    const moveEasingSelect = requireSelect('interp-move-easing-select');
    const moveFeedforwardInput = requireInput('interp-move-feedforward');
    const spriteOpacityInterpolationSelect = requireSelect(
      'sprite-opacity-interpolation'
    );
    const spriteOpacityFeedforwardInput = requireInput(
      'sprite-opacity-feedforward'
    );
    const backdropFileInput = requireInput('backdrop-file');
    const backdropLoadButton = requireButton('backdrop-load');
    const backdropClearButton = requireButton('backdrop-clear');
    const backdropImageNameOutput = requireOutput('backdrop-image-name');
    const backdropRenderModeSelect = requireSelect('backdrop-render-mode');
    const cameraInterpolationSelect = requireSelect('camera-interpolation');
    const cameraInteractionInterpolationSelect = requireSelect(
      'camera-interaction-interpolation'
    );
    const cameraFeedforwardInput = requireInput('camera-feedforward');
    const cameraInteractionInput = requireInput('camera-interaction');
    const cameraResetButton = requireButton('camera-reset');
    const cameraPanButtonSelect = requireSelect('camera-pan-button');
    const cameraPanAltSelect = requireSelect('camera-pan-alt');
    const cameraPanShiftSelect = requireSelect('camera-pan-shift');
    const cameraPanCtrlSelect = requireSelect('camera-pan-ctrl');
    const cameraPanMetaSelect = requireSelect('camera-pan-meta');
    const cameraRotateButtonSelect = requireSelect('camera-rotate-button');
    const cameraRotateAltSelect = requireSelect('camera-rotate-alt');
    const cameraRotateShiftSelect = requireSelect('camera-rotate-shift');
    const cameraRotateCtrlSelect = requireSelect('camera-rotate-ctrl');
    const cameraRotateMetaSelect = requireSelect('camera-rotate-meta');
    const cameraTriggerSelects = [
      cameraPanButtonSelect,
      cameraPanAltSelect,
      cameraPanShiftSelect,
      cameraPanCtrlSelect,
      cameraPanMetaSelect,
      cameraRotateButtonSelect,
      cameraRotateAltSelect,
      cameraRotateShiftSelect,
      cameraRotateCtrlSelect,
      cameraRotateMetaSelect,
    ];
    const wasmF64Input = requireInput('wasm-f64');
    const pickMaskInput = requireInput('runtime-pick-mask');
    const scalingLimitPresetSelect = requireSelect('scaling-limit-preset');
    const textureMinFilterSelect = requireSelect('texture-min-filter');
    const textureMagFilterSelect = requireSelect('texture-mag-filter');
    const textureWrapSSelect = requireSelect('texture-wrap-s');
    const textureWrapTSelect = requireSelect('texture-wrap-t');
    const textureNpotPolicySelect = requireSelect('texture-npot-policy');
    const upScalingToPowerOfTwoInput = requireInput('sprites-upscaling-to-pot');
    const atlasWidthInput = requireInput('atlas-width');
    const atlasHeightInput = requireInput('atlas-height');
    const atlasResolvedOutput = requireOutput('atlas-resolved');
    const atlasMaxOutput = requireOutput('atlas-max-size');
    const elementImageModeSelects: ElementTuple<HTMLSelectElement> = [
      requireSelect('element-0-image-mode'),
      requireSelect('element-1-image-mode'),
      requireSelect('element-2-image-mode'),
    ];
    const elementModeSelects: ElementTuple<HTMLSelectElement> = [
      requireSelect('element-0-mode'),
      requireSelect('element-1-mode'),
      requireSelect('element-2-mode'),
    ];
    const elementRenderModeSelects: ElementTuple<HTMLSelectElement> = [
      requireSelect('element-0-render-mode'),
      requireSelect('element-1-render-mode'),
      requireSelect('element-2-render-mode'),
    ];
    const elementShiftInterpolationSelects: ElementTuple<HTMLSelectElement> = [
      requireSelect('element-0-shift-interpolation'),
      requireSelect('element-1-shift-interpolation'),
      requireSelect('element-2-shift-interpolation'),
    ];
    const elementRotationSelects: ElementTuple<HTMLSelectElement> = [
      requireSelect('element-0-rotation'),
      requireSelect('element-1-rotation'),
      requireSelect('element-2-rotation'),
    ];
    const elementOpacitySelects: ElementTuple<HTMLSelectElement> = [
      requireSelect('element-0-opacity'),
      requireSelect('element-1-opacity'),
      requireSelect('element-2-opacity'),
    ];
    const elementOpacityInterpolationSelects: ElementTuple<HTMLSelectElement> =
      [
        requireSelect('element-0-opacity-interpolation'),
        requireSelect('element-1-opacity-interpolation'),
        requireSelect('element-2-opacity-interpolation'),
      ];
    const elementScaleInterpolationSelects: ElementTuple<HTMLSelectElement> = [
      requireSelect('element-0-scale-interpolation'),
      requireSelect('element-1-scale-interpolation'),
      requireSelect('element-2-scale-interpolation'),
    ];
    const elementShiftFeedforwardInputs: ElementTuple<HTMLInputElement> = [
      requireInput('element-0-shift-feedforward'),
      requireInput('element-1-shift-feedforward'),
      requireInput('element-2-shift-feedforward'),
    ];
    const elementRotationFeedforwardInputs: ElementTuple<HTMLInputElement> = [
      requireInput('element-0-rotation-feedforward'),
      requireInput('element-1-rotation-feedforward'),
      requireInput('element-2-rotation-feedforward'),
    ];
    const elementAutoDirectionModeSelects: ElementTuple<HTMLSelectElement> = [
      requireSelect('element-0-auto-direction-mode'),
      requireSelect('element-1-auto-direction-mode'),
      requireSelect('element-2-auto-direction-mode'),
    ];
    const elementAutoDirectionSpaceSelects: ElementTuple<HTMLSelectElement> = [
      requireSelect('element-0-auto-direction-space'),
      requireSelect('element-1-auto-direction-space'),
      requireSelect('element-2-auto-direction-space'),
    ];
    const elementAutoDirectionShiftAngleRotationInputs: ElementTuple<HTMLInputElement> =
      [
        requireInput('element-0-auto-direction-shift-angle-rotation'),
        requireInput('element-1-auto-direction-shift-angle-rotation'),
        requireInput('element-2-auto-direction-shift-angle-rotation'),
      ];
    const elementAutoDirectionFlipXInputs: ElementTuple<HTMLInputElement> = [
      requireInput('element-0-auto-direction-flip-x'),
      requireInput('element-1-auto-direction-flip-x'),
      requireInput('element-2-auto-direction-flip-x'),
    ];
    const elementAutoDirectionFlipYInputs: ElementTuple<HTMLInputElement> = [
      requireInput('element-0-auto-direction-flip-y'),
      requireInput('element-1-auto-direction-flip-y'),
      requireInput('element-2-auto-direction-flip-y'),
    ];
    const elementAutoDirectionInterpolationSelects: ElementTuple<HTMLSelectElement> =
      [
        requireSelect('element-0-auto-direction-interpolation'),
        requireSelect('element-1-auto-direction-interpolation'),
        requireSelect('element-2-auto-direction-interpolation'),
      ];
    const elementAutoDirectionFeedforwardInputs: ElementTuple<HTMLInputElement> =
      [
        requireInput('element-0-auto-direction-feedforward'),
        requireInput('element-1-auto-direction-feedforward'),
        requireInput('element-2-auto-direction-feedforward'),
      ];
    const elementOpacityFeedforwardInputs: ElementTuple<HTMLInputElement> = [
      requireInput('element-0-opacity-feedforward'),
      requireInput('element-1-opacity-feedforward'),
      requireInput('element-2-opacity-feedforward'),
    ];
    const elementScaleFeedforwardInputs: ElementTuple<HTMLInputElement> = [
      requireInput('element-0-scale-feedforward'),
      requireInput('element-1-scale-feedforward'),
      requireInput('element-2-scale-feedforward'),
    ];
    const elementOriginUseResolvedAnchorInputs: ElementTuple<HTMLInputElement> =
      [
        requireInput('element-0-origin-use-resolved-anchor'),
        requireInput('element-1-origin-use-resolved-anchor'),
        requireInput('element-2-origin-use-resolved-anchor'),
      ];

    const readMoveMode = (select: HTMLSelectElement): MoveMode => {
      const value = select.value;
      if (value === 'none') {
        return value;
      }
      if (isDemoInterpolationType(value)) {
        return value;
      }
      return 'linear';
    };
    const readElementImageMode = (
      select: HTMLSelectElement
    ): ElementImageMode => {
      const value = select.value;
      return value === 'label' ? 'label' : 'image';
    };
    const readRotationMode = (select: HTMLSelectElement): RotationMode => {
      const value = select.value;
      if (value === 'none') {
        return value;
      }
      if (isDemoInterpolationType(value)) {
        return value;
      }
      return 'linear';
    };
    const readAutoDirectionMode = (
      select: HTMLSelectElement
    ): AutoDirectionMode => {
      const value = select.value;
      if (value === 'rotation' || value === 'flipping') {
        return value;
      }
      return 'none';
    };
    const readAutoDirectionSpace = (
      select: HTMLSelectElement
    ): DemoAutoDirectionSpace => {
      return select.value === 'parent_local' ? 'parent_local' : 'world';
    };
    const readAutoDirectionInterpolationMode = (
      select: HTMLSelectElement
    ): AutoDirectionInterpolationMode => {
      const value = select.value;
      if (value === 'none') {
        return value;
      }
      if (isDemoInterpolationType(value)) {
        return value;
      }
      return 'linear';
    };
    const readCameraInterpolationMode = (
      select: HTMLSelectElement
    ): CameraInterpolationMode => {
      const value = select.value;
      if (value === 'none') {
        return value;
      }
      if (isDemoInterpolationType(value)) {
        return value;
      }
      return 'linear';
    };
    const readModifierRequirement = (
      select: HTMLSelectElement
    ): boolean | undefined => {
      const value = select.value;
      if (value === 'require') {
        return true;
      }
      if (value === 'block') {
        return false;
      }
      return undefined;
    };
    const buildModifiers = (
      altSelect: HTMLSelectElement,
      shiftSelect: HTMLSelectElement,
      ctrlSelect: HTMLSelectElement,
      metaSelect: HTMLSelectElement
    ): ObjectCanvasCameraControlModifiers | undefined => {
      const alt = readModifierRequirement(altSelect);
      const shift = readModifierRequirement(shiftSelect);
      const ctrl = readModifierRequirement(ctrlSelect);
      const meta = readModifierRequirement(metaSelect);
      if (
        alt === undefined &&
        shift === undefined &&
        ctrl === undefined &&
        meta === undefined
      ) {
        return undefined;
      }
      return {
        ...(alt === undefined ? {} : { alt }),
        ...(shift === undefined ? {} : { shift }),
        ...(ctrl === undefined ? {} : { ctrl }),
        ...(meta === undefined ? {} : { meta }),
      };
    };
    const readPointerButton = (
      select: HTMLSelectElement
    ): ObjectCanvasCameraControlPointerButton => {
      const value = select.value;
      if (
        value === 'left' ||
        value === 'middle' ||
        value === 'right' ||
        value === 'back' ||
        value === 'forward'
      ) {
        return value;
      }
      return 'right';
    };
    const buildControlTrigger = (
      buttonSelect: HTMLSelectElement,
      altSelect: HTMLSelectElement,
      shiftSelect: HTMLSelectElement,
      ctrlSelect: HTMLSelectElement,
      metaSelect: HTMLSelectElement
    ): ObjectCanvasCameraControlPointerTrigger => {
      const modifiers = buildModifiers(
        altSelect,
        shiftSelect,
        ctrlSelect,
        metaSelect
      );
      return {
        button: readPointerButton(buttonSelect),
        ...(modifiers ? { modifiers } : {}),
      };
    };
    const readShiftInterpolationMode = (
      select: HTMLSelectElement
    ): ShiftInterpolationMode => {
      const value = select.value;
      if (value === 'none') {
        return value;
      }
      if (isDemoInterpolationType(value)) {
        return value;
      }
      return 'linear';
    };
    const readScaleInterpolationMode = (
      select: HTMLSelectElement
    ): ScaleInterpolationMode => {
      const value = select.value;
      if (value === 'none') {
        return value;
      }
      if (isDemoInterpolationType(value)) {
        return value;
      }
      return 'linear';
    };
    const readElementMode = (select: HTMLSelectElement): ElementMode => {
      const value = select.value;
      if (value === 'fixed' || value === 'orbit') {
        return value;
      }
      return 'none';
    };
    const readElementRenderMode = (
      select: HTMLSelectElement
    ): SpriteElementRenderMode => {
      const value = select.value;
      if (value === 'billboard_perspective') {
        return 'billboard_perspective';
      }
      if (value === 'billboard') {
        return 'billboard';
      }
      return 'surface';
    };
    const readOpacityMode = (select: HTMLSelectElement): OpacityMode => {
      const value = select.value;
      if (value === 'wave') {
        return value;
      }
      return 'none';
    };
    const readOpacityInterpolationMode = (
      select: HTMLSelectElement
    ): OpacityInterpolationMode => {
      const value = select.value;
      if (isDemoInterpolationType(value)) {
        return value;
      }
      return 'none';
    };

    const readTextureSamplingFromControls = (): RuntimeTextureSampling => ({
      minFilter: readTextureMinFilter(textureMinFilterSelect.value),
      magFilter: readTextureMagFilter(textureMagFilterSelect.value),
      wrapS: readTextureWrapMode(textureWrapSSelect.value),
      wrapT: readTextureWrapMode(textureWrapTSelect.value),
      npotPolicy: readTextureNpotPolicy(textureNpotPolicySelect.value),
      maxAnisotropy: DEFAULT_TEXTURE_SAMPLING.maxAnisotropy,
    });
    const readScalingLimitPresetFromControls =
      (): RuntimeScalingLimitPresetId =>
        resolveRuntimeScalingLimitPreset(scalingLimitPresetSelect.value).id;
    const readPickMaskEnabledFromControls = () => pickMaskInput.checked;

    type AtlasUiSize = { widthPixel: number; heightPixel: number };
    const readAtlasSizeFromControls = (): AtlasUiSize => {
      const widthRaw = Number(atlasWidthInput.value);
      const heightRaw = Number(atlasHeightInput.value);
      const widthPixel =
        Number.isFinite(widthRaw) && widthRaw > 0
          ? Math.floor(widthRaw)
          : DEFAULT_ATLAS_MIN_SIZE;
      const heightPixel =
        Number.isFinite(heightRaw) && heightRaw > 0
          ? Math.floor(heightRaw)
          : DEFAULT_ATLAS_MIN_SIZE;
      return { widthPixel, heightPixel };
    };
    const isSameAtlasSize = (a: AtlasUiSize, b: AtlasUiSize) =>
      a.widthPixel === b.widthPixel && a.heightPixel === b.heightPixel;

    const applyTextureSamplingToControls = (
      sampling: RuntimeTextureSampling
    ) => {
      textureMinFilterSelect.value = sampling.minFilter;
      textureMagFilterSelect.value = sampling.magFilter;
      textureWrapSSelect.value = sampling.wrapS;
      textureWrapTSelect.value = sampling.wrapT;
      textureNpotPolicySelect.value = sampling.npotPolicy;
    };

    const defaultAtlasSize = (() => {
      const maxTextureSize = resolveMaxTextureSize(canvas);
      if (
        typeof maxTextureSize === 'number' &&
        Number.isFinite(maxTextureSize) &&
        maxTextureSize > 0
      ) {
        return Math.min(DEFAULT_ATLAS_MIN_SIZE, maxTextureSize);
      }
      return DEFAULT_ATLAS_MIN_SIZE;
    })();
    atlasWidthInput.value = `${defaultAtlasSize}`;
    atlasHeightInput.value = `${defaultAtlasSize}`;
    scalingLimitPresetSelect.value = DEFAULT_RUNTIME_SCALING_LIMIT_PRESET_ID;
    let currentAtlasSize = readAtlasSizeFromControls();
    let currentAtlasId: number | null = null;
    const labelImageIds = new Set<string>();

    let moveMode: MoveMode = readMoveMode(moveEasingSelect);
    let useMoveFeedforward = moveFeedforwardInput.checked;
    let pendingMoveInterpolationUpdate = true;
    let cameraInterpolationMode: CameraInterpolationMode =
      readCameraInterpolationMode(cameraInterpolationSelect);
    let cameraInteractionInterpolationMode: CameraInterpolationMode =
      readCameraInterpolationMode(cameraInteractionInterpolationSelect);
    let useCameraFeedforward = cameraFeedforwardInput.checked;
    spriteOpacityInterpolationMode = readOpacityInterpolationMode(
      spriteOpacityInterpolationSelect
    );
    useSpriteOpacityFeedforward = spriteOpacityFeedforwardInput.checked;
    let elementImageModes: ElementTuple<ElementImageMode> = [
      readElementImageMode(elementImageModeSelects[0]),
      readElementImageMode(elementImageModeSelects[1]),
      readElementImageMode(elementImageModeSelects[2]),
    ];
    let elementShiftInterpolationModes: ElementTuple<ShiftInterpolationMode> = [
      readShiftInterpolationMode(elementShiftInterpolationSelects[0]),
      readShiftInterpolationMode(elementShiftInterpolationSelects[1]),
      readShiftInterpolationMode(elementShiftInterpolationSelects[2]),
    ];
    let elementRotationModes: ElementTuple<RotationMode> = [
      readRotationMode(elementRotationSelects[0]),
      readRotationMode(elementRotationSelects[1]),
      readRotationMode(elementRotationSelects[2]),
    ];
    let elementOpacityModes: ElementTuple<OpacityMode> = [
      readOpacityMode(elementOpacitySelects[0]),
      readOpacityMode(elementOpacitySelects[1]),
      readOpacityMode(elementOpacitySelects[2]),
    ];
    let elementLayers: ElementTuple<number> = [3, 3, 3];
    let elementOrders: ElementTuple<number> = [0, 0, 0];
    let elementOpacityInterpolationModes: ElementTuple<OpacityInterpolationMode> =
      [
        readOpacityInterpolationMode(elementOpacityInterpolationSelects[0]),
        readOpacityInterpolationMode(elementOpacityInterpolationSelects[1]),
        readOpacityInterpolationMode(elementOpacityInterpolationSelects[2]),
      ];
    let elementScaleInterpolationModes: ElementTuple<ScaleInterpolationMode> = [
      readScaleInterpolationMode(elementScaleInterpolationSelects[0]),
      readScaleInterpolationMode(elementScaleInterpolationSelects[1]),
      readScaleInterpolationMode(elementScaleInterpolationSelects[2]),
    ];
    let useElementShiftFeedforward: ElementTuple<boolean> = [
      elementShiftFeedforwardInputs[0].checked,
      elementShiftFeedforwardInputs[1].checked,
      elementShiftFeedforwardInputs[2].checked,
    ];
    let useElementRotationFeedforward: ElementTuple<boolean> = [
      elementRotationFeedforwardInputs[0].checked,
      elementRotationFeedforwardInputs[1].checked,
      elementRotationFeedforwardInputs[2].checked,
    ];
    let elementAutoDirectionModes: ElementTuple<AutoDirectionMode> = [
      readAutoDirectionMode(elementAutoDirectionModeSelects[0]),
      readAutoDirectionMode(elementAutoDirectionModeSelects[1]),
      readAutoDirectionMode(elementAutoDirectionModeSelects[2]),
    ];
    let elementAutoDirectionSpaces: ElementTuple<DemoAutoDirectionSpace> = [
      readAutoDirectionSpace(elementAutoDirectionSpaceSelects[0]),
      readAutoDirectionSpace(elementAutoDirectionSpaceSelects[1]),
      readAutoDirectionSpace(elementAutoDirectionSpaceSelects[2]),
    ];
    let elementAutoDirectionShiftAngleRotations: ElementTuple<boolean> = [
      elementAutoDirectionShiftAngleRotationInputs[0].checked,
      elementAutoDirectionShiftAngleRotationInputs[1].checked,
      elementAutoDirectionShiftAngleRotationInputs[2].checked,
    ];
    let elementAutoDirectionFlipXs: ElementTuple<boolean> = [
      elementAutoDirectionFlipXInputs[0].checked,
      elementAutoDirectionFlipXInputs[1].checked,
      elementAutoDirectionFlipXInputs[2].checked,
    ];
    let elementAutoDirectionFlipYs: ElementTuple<boolean> = [
      elementAutoDirectionFlipYInputs[0].checked,
      elementAutoDirectionFlipYInputs[1].checked,
      elementAutoDirectionFlipYInputs[2].checked,
    ];
    let elementAutoDirectionInterpolationModes: ElementTuple<AutoDirectionInterpolationMode> =
      [
        readAutoDirectionInterpolationMode(
          elementAutoDirectionInterpolationSelects[0]
        ),
        readAutoDirectionInterpolationMode(
          elementAutoDirectionInterpolationSelects[1]
        ),
        readAutoDirectionInterpolationMode(
          elementAutoDirectionInterpolationSelects[2]
        ),
      ];
    let useElementAutoDirectionFeedforward: ElementTuple<boolean> = [
      elementAutoDirectionFeedforwardInputs[0].checked,
      elementAutoDirectionFeedforwardInputs[1].checked,
      elementAutoDirectionFeedforwardInputs[2].checked,
    ];
    let elementAutoDirectionMinDistances: ElementTuple<number> = [0, 0, 0];
    let useElementOpacityFeedforward: ElementTuple<boolean> = [
      elementOpacityFeedforwardInputs[0].checked,
      elementOpacityFeedforwardInputs[1].checked,
      elementOpacityFeedforwardInputs[2].checked,
    ];
    let useElementScaleFeedforward: ElementTuple<boolean> = [
      elementScaleFeedforwardInputs[0].checked,
      elementScaleFeedforwardInputs[1].checked,
      elementScaleFeedforwardInputs[2].checked,
    ];
    let elementOriginUseResolvedAnchors: ElementTuple<boolean> = [
      elementOriginUseResolvedAnchorInputs[0].checked,
      elementOriginUseResolvedAnchorInputs[1].checked,
      elementOriginUseResolvedAnchorInputs[2].checked,
    ];
    elementModes = [
      readElementMode(elementModeSelects[0]),
      readElementMode(elementModeSelects[1]),
      readElementMode(elementModeSelects[2]),
    ];
    let elementRenderModes: ElementTuple<SpriteElementRenderMode> = [
      readElementRenderMode(elementRenderModeSelects[0]),
      readElementRenderMode(elementRenderModeSelects[1]),
      readElementRenderMode(elementRenderModeSelects[2]),
    ];
    let backdropRenderMode: SpriteElementRenderMode = readElementRenderMode(
      backdropRenderModeSelect
    );
    let backdropScaleValue = 1;
    let backdropOpacityValue = 1;
    let backdropRotationValue = 0;
    let backdropAnchorXValue = 0;
    let backdropAnchorYValue = 0;
    let backdropShiftDistanceValue = 0;
    let backdropShiftAngleValue = 0;

    const statsFpsOutput = requireOutput('stats-fps');
    const statsFrameMsOutput = requireOutput('stats-frame-ms');
    const statsCanvasRenderMsOutput = requireOutput('stats-canvas-render-ms');
    const statsSpriteRenderMsOutput = requireOutput('stats-sprite-render-ms');
    const statsWasmMsOutput = requireOutput('stats-wasm-ms');
    const statsWasmInternalMsOutput = requireOutput('stats-wasm-internal-ms');
    const statsWasmProjectionMsOutput = requireOutput(
      'stats-wasm-projection-ms'
    );
    const statsWasmSpriteAnimMsOutput = requireOutput(
      'stats-wasm-sprite-anim-ms'
    );
    const statsWasmElementAnimMsOutput = requireOutput(
      'stats-wasm-element-anim-ms'
    );
    const statsWasmPivotResolveMsOutput = requireOutput(
      'stats-wasm-pivot-resolve-ms'
    );
    const statsWasmAutoRotationMsOutput = requireOutput(
      'stats-wasm-auto-rotation-ms'
    );
    const statsWasmCollectEntriesMsOutput = requireOutput(
      'stats-wasm-collect-entries-ms'
    );
    const statsWasmSortEntriesMsOutput = requireOutput(
      'stats-wasm-sort-entries-ms'
    );
    const statsWasmWriteOutputMsOutput = requireOutput(
      'stats-wasm-write-output-ms'
    );
    const statsCpuMsOutput = requireOutput('stats-cpu-ms');
    const statsWasmRatioOutput = requireOutput('stats-wasm-ratio');
    const statsPickOutput = requireOutput('stats-pick');
    const statsCommandApplyMsOutput = requireOutput('stats-command-apply-ms');
    const statsCommandApplyCallMsOutput = requireOutput(
      'stats-command-apply-call-ms'
    );
    const statsCommandApplyJsMsOutput = requireOutput(
      'stats-command-apply-js-ms'
    );
    const statsCommandApplyWasmMsOutput = requireOutput(
      'stats-command-apply-wasm-ms'
    );
    const statsCommandApplyWasmLoopMsOutput = requireOutput(
      'stats-command-apply-wasm-loop-ms'
    );
    const statsCommandApplyWasmSyncMsOutput = requireOutput(
      'stats-command-apply-wasm-sync-ms'
    );
    const statsCommandApplyWasmClearMsOutput = requireOutput(
      'stats-command-apply-wasm-clear-ms'
    );
    const statsDrawSetupMsOutput = requireOutput('stats-draw-setup-ms');
    const statsEnsureRenderBuffersMsOutput = requireOutput(
      'stats-ensure-render-buffers-ms'
    );
    const statsVertexUploadMsOutput = requireOutput('stats-vertex-upload-ms');
    const statsDrawLoopMsOutput = requireOutput('stats-draw-loop-ms');
    const statsTextureBindMsOutput = requireOutput('stats-texture-bind-ms');
    const statsOpacityUniformMsOutput = requireOutput(
      'stats-opacity-uniform-ms'
    );
    const statsDrawCallMsOutput = requireOutput('stats-draw-call-ms');
    const statsCommandCountOutput = requireOutput('stats-command-count');
    const statsUpdateCommandCountOutput = requireOutput(
      'stats-update-command-count'
    );
    const statsUpdateFrameRatioOutput = requireOutput(
      'stats-update-frame-ratio'
    );
    const statsUpdateQueueDelayOutput = requireOutput(
      'stats-update-queue-delay'
    );
    const statsActiveElementsOutput = requireOutput('stats-active-elements');
    const statsDrawCallsOutput = requireOutput('stats-draw-calls');
    const statsTextureBindsOutput = requireOutput('stats-texture-binds');
    const statsSkippedDrawsOutput = requireOutput('stats-skipped-draws');
    const statsBufferResizesOutput = requireOutput('stats-buffer-resizes');
    const statsOutputs = [
      statsFpsOutput,
      statsFrameMsOutput,
      statsCanvasRenderMsOutput,
      statsSpriteRenderMsOutput,
      statsWasmMsOutput,
      statsWasmInternalMsOutput,
      statsWasmProjectionMsOutput,
      statsWasmSpriteAnimMsOutput,
      statsWasmElementAnimMsOutput,
      statsWasmPivotResolveMsOutput,
      statsWasmAutoRotationMsOutput,
      statsWasmCollectEntriesMsOutput,
      statsWasmSortEntriesMsOutput,
      statsWasmWriteOutputMsOutput,
      statsCpuMsOutput,
      statsWasmRatioOutput,
      statsCommandApplyMsOutput,
      statsCommandApplyCallMsOutput,
      statsCommandApplyJsMsOutput,
      statsCommandApplyWasmMsOutput,
      statsCommandApplyWasmLoopMsOutput,
      statsCommandApplyWasmSyncMsOutput,
      statsCommandApplyWasmClearMsOutput,
      statsDrawSetupMsOutput,
      statsEnsureRenderBuffersMsOutput,
      statsVertexUploadMsOutput,
      statsDrawLoopMsOutput,
      statsTextureBindMsOutput,
      statsOpacityUniformMsOutput,
      statsDrawCallMsOutput,
      statsCommandCountOutput,
      statsUpdateCommandCountOutput,
      statsUpdateFrameRatioOutput,
      statsUpdateQueueDelayOutput,
      statsActiveElementsOutput,
      statsDrawCallsOutput,
      statsTextureBindsOutput,
      statsSkippedDrawsOutput,
      statsBufferResizesOutput,
    ] as const;
    const clearStatsOutputs = () => {
      statsOutputs.forEach((output) => {
        output.textContent = '-';
      });
    };
    const clearPickOutput = () => {
      statsPickOutput.textContent = '-';
    };
    const formatNumber = (value: number, digits: number, suffix = ''): string =>
      `${value.toFixed(digits)}${suffix}`;
    const formatPickOutput = (event: ObjectCanvasPickEvent) => {
      const screen = `${formatNumber(event.screen.xPixel, 1)}, ${formatNumber(
        event.screen.yPixel,
        1
      )}`;
      const world = event.world
        ? `${formatNumber(event.world.x, 2)}, ${formatNumber(
            event.world.y,
            2
          )}, ${formatNumber(event.world.z, 2)}`
        : '-';
      if (event.kind === 'sprite') {
        return `sprite ${event.spriteId}:${event.elementIndex} s(${screen}) w(${world})`;
      }
      return `polyline ${event.polylineId}:${event.segmentIndex} s(${screen}) w(${world})`;
    };
    const applyPickOutput = (event: ObjectCanvasPickEvent) => {
      statsPickOutput.textContent = formatPickOutput(event);
    };
    const applyStatsSnapshot = (snapshot: ObjectPerformanceSnapshot) => {
      statsFpsOutput.textContent = formatNumber(snapshot.fps, 1);
      statsFrameMsOutput.textContent = formatNumber(
        snapshot.avgFrameIntervalMs,
        2,
        ' ms'
      );
      statsCanvasRenderMsOutput.textContent = formatNumber(
        snapshot.avgCanvasRenderDurationMs,
        3,
        ' ms'
      );
      statsSpriteRenderMsOutput.textContent = formatNumber(
        snapshot.avgSpriteRenderDurationMs,
        3,
        ' ms'
      );
      statsWasmMsOutput.textContent = formatNumber(
        snapshot.avgWasmComputeDurationMs,
        3,
        ' ms'
      );
      statsWasmInternalMsOutput.textContent = formatNumber(
        snapshot.avgWasmComputeInternalDurationMs,
        3,
        ' ms'
      );
      statsWasmProjectionMsOutput.textContent = formatNumber(
        snapshot.avgWasmComputeProjectionDurationMs,
        3,
        ' ms'
      );
      statsWasmSpriteAnimMsOutput.textContent = formatNumber(
        snapshot.avgWasmComputeSpriteAnimationDurationMs,
        3,
        ' ms'
      );
      statsWasmElementAnimMsOutput.textContent = formatNumber(
        snapshot.avgWasmComputeElementAnimationDurationMs,
        3,
        ' ms'
      );
      statsWasmPivotResolveMsOutput.textContent = formatNumber(
        snapshot.avgWasmComputePivotResolveDurationMs,
        3,
        ' ms'
      );
      statsWasmAutoRotationMsOutput.textContent = formatNumber(
        snapshot.avgWasmComputeAutoRotationDurationMs,
        3,
        ' ms'
      );
      statsWasmCollectEntriesMsOutput.textContent = formatNumber(
        snapshot.avgWasmComputeCollectEntriesDurationMs,
        3,
        ' ms'
      );
      statsWasmSortEntriesMsOutput.textContent = formatNumber(
        snapshot.avgWasmComputeSortEntriesDurationMs,
        3,
        ' ms'
      );
      statsWasmWriteOutputMsOutput.textContent = formatNumber(
        snapshot.avgWasmComputeWriteOutputDurationMs,
        3,
        ' ms'
      );
      statsCpuMsOutput.textContent = formatNumber(
        snapshot.avgCpuDurationMs,
        3,
        ' ms'
      );
      statsWasmRatioOutput.textContent = formatNumber(
        snapshot.wasmComputeRatio * 100,
        1,
        '%'
      );
      statsCommandApplyMsOutput.textContent = formatNumber(
        snapshot.avgCommandApplyDurationMs,
        3,
        ' ms'
      );
      statsCommandApplyCallMsOutput.textContent = formatNumber(
        snapshot.avgCommandApplyCallDurationMs,
        3,
        ' ms'
      );
      statsCommandApplyJsMsOutput.textContent = formatNumber(
        snapshot.avgCommandApplyJsDurationMs,
        3,
        ' ms'
      );
      statsCommandApplyWasmMsOutput.textContent = formatNumber(
        snapshot.avgCommandApplyWasmDurationMs,
        3,
        ' ms'
      );
      statsCommandApplyWasmLoopMsOutput.textContent = formatNumber(
        snapshot.avgCommandApplyWasmLoopDurationMs,
        3,
        ' ms'
      );
      statsCommandApplyWasmSyncMsOutput.textContent = formatNumber(
        snapshot.avgCommandApplyWasmSyncSlotsDurationMs,
        3,
        ' ms'
      );
      statsCommandApplyWasmClearMsOutput.textContent = formatNumber(
        snapshot.avgCommandApplyWasmClearDurationMs,
        3,
        ' ms'
      );
      statsDrawSetupMsOutput.textContent = formatNumber(
        snapshot.avgDrawSetupDurationMs,
        3,
        ' ms'
      );
      statsEnsureRenderBuffersMsOutput.textContent = formatNumber(
        snapshot.avgEnsureRenderBuffersDurationMs,
        3,
        ' ms'
      );
      statsVertexUploadMsOutput.textContent = formatNumber(
        snapshot.avgVertexUploadDurationMs,
        3,
        ' ms'
      );
      statsDrawLoopMsOutput.textContent = formatNumber(
        snapshot.avgDrawLoopDurationMs,
        3,
        ' ms'
      );
      statsTextureBindMsOutput.textContent = formatNumber(
        snapshot.avgTextureBindDurationMs,
        3,
        ' ms'
      );
      statsOpacityUniformMsOutput.textContent = formatNumber(
        snapshot.avgOpacityUniformDurationMs,
        3,
        ' ms'
      );
      statsDrawCallMsOutput.textContent = formatNumber(
        snapshot.avgDrawCallDurationMs,
        3,
        ' ms'
      );
      statsCommandCountOutput.textContent = formatNumber(
        snapshot.avgCommandCount,
        2
      );
      statsUpdateCommandCountOutput.textContent = formatNumber(
        snapshot.avgUpdateSpriteCommandCount,
        2
      );
      statsUpdateFrameRatioOutput.textContent = formatNumber(
        snapshot.updateFrameRatio * 100,
        1,
        '%'
      );
      statsUpdateQueueDelayOutput.textContent = formatNumber(
        snapshot.avgUpdateQueueDelayMs,
        3,
        ' ms'
      );
      statsActiveElementsOutput.textContent = formatNumber(
        snapshot.avgActiveElementCount,
        2
      );
      statsDrawCallsOutput.textContent = formatNumber(
        snapshot.avgDrawCallCount,
        2
      );
      statsTextureBindsOutput.textContent = formatNumber(
        snapshot.avgTextureBindCount,
        2
      );
      statsSkippedDrawsOutput.textContent = formatNumber(
        snapshot.avgSkippedDrawCount,
        2
      );
      statsBufferResizesOutput.textContent = `${snapshot.avgWasmBufferResizeCount.toFixed(2)} avg / ${snapshot.totalWasmBufferResizeCount.toFixed(0)} total`;
    };
    const updateStats = () => {
      const activeRenderer = renderer;
      if (!activeRenderer) {
        clearStatsOutputs();
        clearPickOutput();
        return;
      }
      const snapshot = activeRenderer.getPerformanceSnapshot();
      if (snapshot.sampleCount <= 0) {
        clearStatsOutputs();
        return;
      }
      applyStatsSnapshot(snapshot);
    };
    clearStatsOutputs();
    clearPickOutput();
    syncBackdropImageName();

    let backdropLoadRequestId = 0;
    const handleBackdropFileSelection = async () => {
      const file = backdropFileInput.files?.[0];
      if (!file) {
        return;
      }
      const requestId = ++backdropLoadRequestId;
      try {
        const bitmap = await loadImageBitmapFromFile(file);
        if (requestId !== backdropLoadRequestId) {
          bitmap.close();
          return;
        }
        await setBackdropImageSource({
          name: file.name,
          bitmap,
        });
      } catch (error) {
        console.error('Failed to load backdrop image.', error);
      } finally {
        backdropFileInput.value = '';
      }
    };
    const clearBackdropImage = async () => {
      backdropLoadRequestId += 1;
      try {
        await setBackdropImageSource(null);
      } catch (error) {
        console.error('Failed to clear backdrop image.', error);
      } finally {
        backdropFileInput.value = '';
      }
    };

    moveEasingSelect.addEventListener('change', () => {
      moveMode = readMoveMode(moveEasingSelect);
      applyMoveInterpolationSettings();
      applyElementModeSettings(false);
    });
    moveFeedforwardInput.addEventListener('change', () => {
      useMoveFeedforward = moveFeedforwardInput.checked;
      applyMoveInterpolationSettings();
    });
    spriteOpacityInterpolationSelect.addEventListener('change', () => {
      spriteOpacityInterpolationMode = readOpacityInterpolationMode(
        spriteOpacityInterpolationSelect
      );
      applyElementInterpolationSettings();
    });
    spriteOpacityFeedforwardInput.addEventListener('change', () => {
      useSpriteOpacityFeedforward = spriteOpacityFeedforwardInput.checked;
      applyElementInterpolationSettings();
    });
    backdropLoadButton.addEventListener('click', () => {
      backdropFileInput.click();
    });
    backdropClearButton.addEventListener('click', () => {
      void clearBackdropImage();
    });
    backdropFileInput.addEventListener('change', () => {
      void handleBackdropFileSelection();
    });
    backdropRenderModeSelect.addEventListener('change', () => {
      backdropRenderMode = readElementRenderMode(backdropRenderModeSelect);
      applyBackdropSettings();
    });
    cameraInterpolationSelect.addEventListener('change', () => {
      cameraInterpolationMode = readCameraInterpolationMode(
        cameraInterpolationSelect
      );
      updateCamera(true, false);
      applyCameraInteraction();
    });
    cameraInteractionInterpolationSelect.addEventListener('change', () => {
      cameraInteractionInterpolationMode = readCameraInterpolationMode(
        cameraInteractionInterpolationSelect
      );
      applyCameraInteraction();
    });
    cameraFeedforwardInput.addEventListener('change', () => {
      useCameraFeedforward = cameraFeedforwardInput.checked;
      updateCamera(true, false);
      applyCameraInteraction();
    });
    cameraInteractionInput.addEventListener('change', () => {
      applyCameraInteraction();
    });
    cameraResetButton.addEventListener('click', () => {
      applyDemoCameraResetValues(
        {
          yaw,
          pitch,
          roll,
          fov,
        },
        initialCameraResetValues
      );
      adjustCameraToSprites(true);
    });
    cameraTriggerSelects.forEach((select) => {
      select.addEventListener('change', () => {
        applyCameraInteraction();
      });
    });
    const syncElementAutoDirectionControlState = (index: ElementIndex) => {
      const isFlipping = elementAutoDirectionModes[index] === 'flipping';
      const hasInterpolation =
        elementAutoDirectionInterpolationModes[index] !== 'none';
      elementAutoDirectionFlipXInputs[index].disabled = !isFlipping;
      elementAutoDirectionFlipYInputs[index].disabled = !isFlipping;
      elementAutoDirectionInterpolationSelects[index].disabled = !isFlipping;
      elementAutoDirectionFeedforwardInputs[index].disabled =
        !isFlipping || !hasInterpolation;
    };
    elementIndices.forEach((index: ElementIndex) => {
      elementImageModeSelects[index].addEventListener('change', () => {
        elementImageModes[index] = readElementImageMode(
          elementImageModeSelects[index]
        );
        void applyElementImageModeSettings();
      });
      elementModeSelects[index].addEventListener('change', () => {
        elementModes[index] = readElementMode(elementModeSelects[index]);
        applyElementModeSettings(false);
      });
      elementRenderModeSelects[index].addEventListener('change', () => {
        elementRenderModes[index] = readElementRenderMode(
          elementRenderModeSelects[index]
        );
        applyElementModeSettings(false);
      });
      elementShiftInterpolationSelects[index].addEventListener('change', () => {
        elementShiftInterpolationModes[index] = readShiftInterpolationMode(
          elementShiftInterpolationSelects[index]
        );
        applyElementInterpolationSettings();
      });
      elementShiftFeedforwardInputs[index].addEventListener('change', () => {
        useElementShiftFeedforward[index] =
          elementShiftFeedforwardInputs[index].checked;
        applyElementInterpolationSettings();
      });
      elementRotationSelects[index].addEventListener('change', () => {
        elementRotationModes[index] = readRotationMode(
          elementRotationSelects[index]
        );
        applyElementInterpolationSettings();
      });
      elementOpacitySelects[index].addEventListener('change', () => {
        elementOpacityModes[index] = readOpacityMode(
          elementOpacitySelects[index]
        );
        applyElementModeSettings(false);
      });
      elementOpacityInterpolationSelects[index].addEventListener(
        'change',
        () => {
          elementOpacityInterpolationModes[index] =
            readOpacityInterpolationMode(
              elementOpacityInterpolationSelects[index]
            );
          applyElementInterpolationSettings();
        }
      );
      elementScaleInterpolationSelects[index].addEventListener('change', () => {
        elementScaleInterpolationModes[index] = readScaleInterpolationMode(
          elementScaleInterpolationSelects[index]
        );
        applyElementInterpolationSettings();
      });
      elementRotationFeedforwardInputs[index].addEventListener('change', () => {
        useElementRotationFeedforward[index] =
          elementRotationFeedforwardInputs[index].checked;
        applyElementInterpolationSettings();
      });
      elementAutoDirectionModeSelects[index].addEventListener('change', () => {
        elementAutoDirectionModes[index] = readAutoDirectionMode(
          elementAutoDirectionModeSelects[index]
        );
        syncElementAutoDirectionControlState(index);
        applyElementModeSettings(false);
      });
      elementAutoDirectionSpaceSelects[index].addEventListener('change', () => {
        elementAutoDirectionSpaces[index] = readAutoDirectionSpace(
          elementAutoDirectionSpaceSelects[index]
        );
        applyElementModeSettings(false);
      });
      elementAutoDirectionShiftAngleRotationInputs[index].addEventListener(
        'change',
        () => {
          elementAutoDirectionShiftAngleRotations[index] =
            elementAutoDirectionShiftAngleRotationInputs[index].checked;
          applyElementModeSettings(false);
        }
      );
      elementAutoDirectionFlipXInputs[index].addEventListener('change', () => {
        elementAutoDirectionFlipXs[index] =
          elementAutoDirectionFlipXInputs[index].checked;
        applyElementModeSettings(false);
      });
      elementAutoDirectionFlipYInputs[index].addEventListener('change', () => {
        elementAutoDirectionFlipYs[index] =
          elementAutoDirectionFlipYInputs[index].checked;
        applyElementModeSettings(false);
      });
      elementAutoDirectionInterpolationSelects[index].addEventListener(
        'change',
        () => {
          elementAutoDirectionInterpolationModes[index] =
            readAutoDirectionInterpolationMode(
              elementAutoDirectionInterpolationSelects[index]
            );
          syncElementAutoDirectionControlState(index);
          applyElementModeSettings(false);
        }
      );
      elementAutoDirectionFeedforwardInputs[index].addEventListener(
        'change',
        () => {
          useElementAutoDirectionFeedforward[index] =
            elementAutoDirectionFeedforwardInputs[index].checked;
          applyElementModeSettings(false);
        }
      );
      elementOpacityFeedforwardInputs[index].addEventListener('change', () => {
        useElementOpacityFeedforward[index] =
          elementOpacityFeedforwardInputs[index].checked;
        applyElementInterpolationSettings();
      });
      elementScaleFeedforwardInputs[index].addEventListener('change', () => {
        useElementScaleFeedforward[index] =
          elementScaleFeedforwardInputs[index].checked;
        applyElementInterpolationSettings();
      });
      elementOriginUseResolvedAnchorInputs[index].addEventListener(
        'change',
        () => {
          elementOriginUseResolvedAnchors[index] =
            elementOriginUseResolvedAnchorInputs[index].checked;
          applyElementModeSettings(false);
        }
      );
    });

    const buildMoveInterpolation = ():
      | ObjectInterpolationParameter
      | undefined => {
      if (moveMode === 'none') {
        return undefined;
      }
      return {
        mode: useMoveFeedforward ? 'feedforward' : 'feedback',
        durationMs: INTERPOLATION_BASE_INTERVAL_MS,
        easing: resolveDemoInterpolationEasing(moveMode),
      };
    };
    const buildCameraInterpolation = ():
      | ObjectInterpolationParameter
      | undefined => {
      if (cameraInterpolationMode === 'none') {
        return undefined;
      }
      return {
        mode: useCameraFeedforward ? 'feedforward' : 'feedback',
        durationMs: INTERPOLATION_BASE_INTERVAL_MS,
        easing: resolveDemoInterpolationEasing(cameraInterpolationMode),
      };
    };
    const buildCameraInteractionInterpolation =
      (): ObjectInterpolationParameter | null => {
        if (cameraInteractionInterpolationMode === 'none') {
          return null;
        }
        return {
          mode: useCameraFeedforward ? 'feedforward' : 'feedback',
          durationMs: CAMERA_CONTROL_POLLING_INTERVAL_MS,
          easing: resolveDemoInterpolationEasing(
            cameraInteractionInterpolationMode
          ),
        };
      };
    const buildRotationInterpolation = (
      rotationMode: RotationMode,
      useFeedforward: boolean
    ): ObjectInterpolationParameter | undefined => {
      if (rotationMode === 'none') {
        return undefined;
      }
      return {
        mode: useFeedforward ? 'feedforward' : 'feedback',
        durationMs: INTERPOLATION_BASE_INTERVAL_MS,
        easing: resolveDemoInterpolationEasing(rotationMode),
      };
    };
    const buildShiftInterpolation = (
      interpolationMode: ShiftInterpolationMode,
      useFeedforward: boolean
    ): ObjectInterpolationParameter | undefined => {
      if (interpolationMode === 'none') {
        return undefined;
      }
      return {
        mode: useFeedforward ? 'feedforward' : 'feedback',
        durationMs: INTERPOLATION_BASE_INTERVAL_MS,
        easing: resolveDemoInterpolationEasing(interpolationMode),
      };
    };
    const buildScaleInterpolation = (
      interpolationMode: ScaleInterpolationMode,
      useFeedforward: boolean
    ): ObjectInterpolationParameter | undefined => {
      if (interpolationMode === 'none') {
        return undefined;
      }
      return {
        mode: useFeedforward ? 'feedforward' : 'feedback',
        durationMs: INTERPOLATION_BASE_INTERVAL_MS,
        easing: resolveDemoInterpolationEasing(interpolationMode),
      };
    };
    const buildOpacityInterpolation = (
      interpolationMode: OpacityInterpolationMode,
      useFeedforward: boolean
    ): ObjectInterpolationParameter | undefined => {
      if (interpolationMode === 'none') {
        return undefined;
      }
      return {
        mode: useFeedforward ? 'feedforward' : 'feedback',
        durationMs: INTERPOLATION_BASE_INTERVAL_MS,
        easing: resolveDemoInterpolationEasing(interpolationMode),
      };
    };
    const buildSpriteOpacityInterpolation = () =>
      buildOpacityInterpolation(
        spriteOpacityInterpolationMode,
        useSpriteOpacityFeedforward
      );
    const buildElementShiftInterpolations = (): ElementShiftInterpolations => [
      buildShiftInterpolation(
        elementShiftInterpolationModes[0],
        useElementShiftFeedforward[0]
      ),
      buildShiftInterpolation(
        elementShiftInterpolationModes[1],
        useElementShiftFeedforward[1]
      ),
      buildShiftInterpolation(
        elementShiftInterpolationModes[2],
        useElementShiftFeedforward[2]
      ),
    ];
    const buildElementOpacityInterpolations =
      (): ElementOpacityInterpolations => [
        buildOpacityInterpolation(
          elementOpacityInterpolationModes[0],
          useElementOpacityFeedforward[0]
        ),
        buildOpacityInterpolation(
          elementOpacityInterpolationModes[1],
          useElementOpacityFeedforward[1]
        ),
        buildOpacityInterpolation(
          elementOpacityInterpolationModes[2],
          useElementOpacityFeedforward[2]
        ),
      ];
    const buildElementRotationInterpolations =
      (): ElementRotationInterpolations => [
        buildRotationInterpolation(
          elementRotationModes[0],
          useElementRotationFeedforward[0]
        ),
        buildRotationInterpolation(
          elementRotationModes[1],
          useElementRotationFeedforward[1]
        ),
        buildRotationInterpolation(
          elementRotationModes[2],
          useElementRotationFeedforward[2]
        ),
      ];
    const buildElementScaleInterpolations = (): ElementScaleInterpolations => [
      buildScaleInterpolation(
        elementScaleInterpolationModes[0],
        useElementScaleFeedforward[0]
      ),
      buildScaleInterpolation(
        elementScaleInterpolationModes[1],
        useElementScaleFeedforward[1]
      ),
      buildScaleInterpolation(
        elementScaleInterpolationModes[2],
        useElementScaleFeedforward[2]
      ),
    ];
    const shouldAdvanceElementShiftDeg = (index: ElementIndex) =>
      shouldAdvanceElementShiftPhase(index, elementModes[index]);
    const shouldAdvanceElementRotateDeg = (index: ElementIndex) =>
      shouldAdvanceElementRotatePhase(
        index,
        elementModes[index],
        elementRotationModes[index]
      );
    const applyRotationModesToElements = (
      elements: Readonly<(SpriteElementUpdate | null | undefined)[]>
    ) => [
      applyRotationModeToElementUpdate(elementRotationModes[0], elements[0]),
      applyRotationModeToElementUpdate(elementRotationModes[1], elements[1]),
      applyRotationModeToElementUpdate(elementRotationModes[2], elements[2]),
    ];
    const createAutoDirectionUpdate = (
      index: ElementIndex
    ): Exclude<SpriteElementUpdate['autoDirection'], undefined> => {
      return buildDemoAutoDirectionUpdate({
        space: elementAutoDirectionSpaces[index],
        mode: elementAutoDirectionModes[index],
        shiftAngleRotation: elementAutoDirectionShiftAngleRotations[index],
        minDistance: elementAutoDirectionMinDistances[index],
        flipX: elementAutoDirectionFlipXs[index],
        flipY: elementAutoDirectionFlipYs[index],
        interpolationMode: elementAutoDirectionInterpolationModes[index],
        useFeedforward: useElementAutoDirectionFeedforward[index],
        durationMs: INTERPOLATION_BASE_INTERVAL_MS,
      });
    };
    const applyAutoDirectionToElementUpdate = (
      index: ElementIndex,
      elementUpdate: SpriteElementUpdate | null | undefined
    ) => {
      if (!elementUpdate) {
        return elementUpdate;
      }
      return {
        ...elementUpdate,
        autoDirection: createAutoDirectionUpdate(index),
      };
    };
    const applyAutoDirectionToElements = (
      elements: Readonly<(SpriteElementUpdate | null | undefined)[]>
    ) => [
      applyAutoDirectionToElementUpdate(0, elements[0]),
      applyAutoDirectionToElementUpdate(1, elements[1]),
      applyAutoDirectionToElementUpdate(2, elements[2]),
    ];
    const applyOpacityModesToElements = (
      elements: Readonly<(SpriteElementUpdate | null | undefined)[]>,
      opacityInterpolations: Readonly<ElementOpacityInterpolations>,
      opacityPhase: number,
      shouldAnimateOpacityWave: boolean
    ) => [
      applyOpacityModeToElementUpdate(
        elementOpacityModes[0],
        opacityInterpolations[0],
        opacityPhase,
        shouldAnimateOpacityWave,
        elements[0]
      ),
      applyOpacityModeToElementUpdate(
        elementOpacityModes[1],
        opacityInterpolations[1],
        opacityPhase,
        shouldAnimateOpacityWave,
        elements[1]
      ),
      applyOpacityModeToElementUpdate(
        elementOpacityModes[2],
        opacityInterpolations[2],
        opacityPhase,
        shouldAnimateOpacityWave,
        elements[2]
      ),
    ];
    const applyElementVisualModesToElements = (
      elements: Readonly<(SpriteElementUpdate | null | undefined)[]>,
      opacityInterpolations: Readonly<ElementOpacityInterpolations>,
      opacityPhase: number,
      shouldAnimateOpacityWave: boolean
    ) =>
      applyOpacityModesToElements(
        applyAutoDirectionToElements(applyRotationModesToElements(elements)),
        opacityInterpolations,
        opacityPhase,
        shouldAnimateOpacityWave
      );
    const applyElementRenderModesToElements = <
      T extends { mode?: SpriteElementRenderMode },
    >(
      elements: Readonly<(T | null | undefined)[]>
    ): Array<T | null | undefined> =>
      elements.map((element, index) =>
        element
          ? ({ ...element, mode: elementRenderModes[index] } as T)
          : element
      );
    const applyElementOrderingToElements = <
      T extends { layer?: number; order?: number },
    >(
      elements: Readonly<(T | null | undefined)[]>
    ): Array<T | null | undefined> =>
      elements.map((element, index) =>
        element
          ? ({
              ...element,
              layer: elementLayers[index],
              order: elementOrders[index],
            } as T)
          : element
      );
    const createLeaderlinePlacement = (
      index: ElementIndex
    ): SpriteElementLeaderlinePlacement => ({
      width: { value: elementLeaderlineWidths[index] },
      color: resolveLeaderlineColor(elementLeaderlineHueValues[index]),
    });
    const createBorderPlacement = (
      index: ElementIndex
    ): SpriteElementBorderPlacement | undefined =>
      elementBorderWidths[index] > 0
        ? {
            width: elementBorderWidths[index],
            color: resolveBorderColor(elementBorderHueValues[index]),
          }
        : undefined;
    const createBorderUpdate = (
      index: ElementIndex
    ): SpriteElementBorderUpdate | null =>
      elementBorderWidths[index] > 0
        ? {
            width: elementBorderWidths[index],
            color: resolveBorderColor(elementBorderHueValues[index]),
          }
        : null;
    const createLeaderlineUpdate = (
      index: ElementIndex
    ): SpriteElementLeaderlineUpdate => ({
      width: { value: elementLeaderlineWidths[index] },
      color: resolveLeaderlineColor(elementLeaderlineHueValues[index]),
    });
    const applyElementBordersToPlacements = (
      elements: Readonly<(SpriteElementPlacement | null | undefined)[]>
    ): Array<SpriteElementPlacement | null | undefined> =>
      elements.map((element, index) => {
        if (!element) {
          return element;
        }
        const elementIndex = elementIndices[index];
        if (elementIndex === undefined) {
          return element;
        }
        const border = createBorderPlacement(elementIndex);
        return {
          ...element,
          ...(border ? { border } : {}),
        };
      });
    const applyElementLeaderlinesToPlacements = (
      elements: Readonly<(SpriteElementPlacement | null | undefined)[]>
    ): Array<SpriteElementPlacement | null | undefined> =>
      elements.map((element, index) => {
        if (!element) {
          return element;
        }
        const elementIndex = elementIndices[index];
        if (elementIndex === undefined) {
          return element;
        }
        return {
          ...element,
          leaderline: createLeaderlinePlacement(elementIndex),
        };
      });
    const buildBorderOnlyUpdates = (): ElementTuple<SpriteElementUpdate> => [
      { border: createBorderUpdate(0) },
      { border: createBorderUpdate(1) },
      { border: createBorderUpdate(2) },
    ];
    const buildLeaderlineOnlyUpdates =
      (): ElementTuple<SpriteElementUpdate> => [
        { leaderline: createLeaderlineUpdate(0) },
        { leaderline: createLeaderlineUpdate(1) },
        { leaderline: createLeaderlineUpdate(2) },
      ];
    const applyBorderSettings = () => {
      const activeRenderer = renderer;
      if (!activeRenderer) {
        return;
      }
      const borderUpdates = buildBorderOnlyUpdates();
      if (spriteInstances.length === 0) {
        return;
      }
      const updates: SpriteBulkUpdate[] = spriteInstances.map((sprite) => ({
        spriteId: sprite.id,
        elements: borderUpdates,
      }));
      activeRenderer.updateSprites(updates);
    };
    const applyLeaderlineSettings = () => {
      const activeRenderer = renderer;
      if (!activeRenderer) {
        return;
      }
      const leaderlineUpdates = buildLeaderlineOnlyUpdates();
      if (spriteInstances.length === 0) {
        return;
      }
      const updates: SpriteBulkUpdate[] = spriteInstances.map((sprite) => ({
        spriteId: sprite.id,
        elements: leaderlineUpdates,
      }));
      activeRenderer.updateSprites(updates);
    };
    const normalizeRotateDeg = (rotateDeg: number) => {
      if (rotateDeg >= 360 || rotateDeg <= -360) {
        return rotateDeg % 360;
      }
      return rotateDeg;
    };
    const normalizeSpriteElementShiftDegs = (
      shiftDegs: Readonly<ElementRotateDegs>
    ): ElementRotateDegs => [
      normalizeRotateDeg(shiftDegs[0]),
      normalizeRotateDeg(shiftDegs[1]),
      normalizeRotateDeg(shiftDegs[2]),
    ];
    const normalizeSpriteElementRotations = (
      rotateDegs: Readonly<ElementRotateDegs>
    ): ElementRotateDegs => [
      shouldAdvanceElementRotateDeg(0) ? normalizeRotateDeg(rotateDegs[0]) : 0,
      shouldAdvanceElementRotateDeg(1) ? normalizeRotateDeg(rotateDegs[1]) : 0,
      shouldAdvanceElementRotateDeg(2) ? normalizeRotateDeg(rotateDegs[2]) : 0,
    ];

    const applyElementModeSettings = (
      updateInterpolation: boolean,
      updateValues: boolean = true
    ) => {
      const activeRenderer = renderer;
      if (!activeRenderer) {
        return;
      }
      const shouldAnimateOpacityWave =
        shouldAnimateOpacityWaveFromModes(elementOpacityModes);
      const opacityPhase = shouldAnimateOpacityWave ? currentOpacityPhase : 1;
      const elementShiftInterpolations = resolveElementInterpolationUpdates(
        buildElementShiftInterpolations(),
        updateInterpolation
      );
      const elementRotationInterpolations = resolveElementInterpolationUpdates(
        buildElementRotationInterpolations(),
        updateInterpolation
      );
      const elementOpacityInterpolations = resolveElementInterpolationUpdates(
        buildElementOpacityInterpolations(),
        updateInterpolation
      );
      const elementScaleInterpolations = resolveElementInterpolationUpdates(
        buildElementScaleInterpolations(),
        updateInterpolation
      );
      const spriteOpacityInterpolation = resolveInterpolationUpdate(
        buildSpriteOpacityInterpolation(),
        updateInterpolation
      );
      if (spriteInstances.length === 0) {
        return;
      }
      const updates: SpriteBulkUpdate[] = [];
      spriteInstances.forEach((sprite) => {
        const shiftDegs = normalizeSpriteElementShiftDegs(sprite.shiftDegs);
        const rotateDegs = normalizeSpriteElementRotations(sprite.rotateDegs);
        sprite.shiftDegs = shiftDegs;
        sprite.rotateDegs = rotateDegs;
        const elementImageIds = resolveElementImageIds(sprite);
        const modeElements = createElementModeElementsUpdate(
          elementImageIds,
          elementModes,
          shiftDegs,
          rotateDegs,
          elementShiftInterpolations,
          elementRotationInterpolations,
          elementScaleInterpolations,
          elementScales,
          elementOriginUseResolvedAnchors,
          elementAnchorXs,
          elementAnchorYs
        );
        const elementUpdates = applyElementOrderingToElements(
          applyElementRenderModesToElements(
            applyElementVisualModesToElements(
              modeElements,
              elementOpacityInterpolations,
              opacityPhase,
              shouldAnimateOpacityWave
            )
          )
        );
        const resolvedElements = updateValues
          ? elementUpdates
          : elementUpdates.map((element) =>
              toInterpolationOnlyElementUpdate(element)
            );
        const opacityUpdate = createUpdateValue(
          updateValues ? spriteOpacityValue : undefined,
          spriteOpacityInterpolation
        );
        const visibilityDistanceUpdate = updateValues
          ? spriteVisibilityDistanceValue === undefined
            ? { visibilityDistance: null }
            : {
                visibilityDistance: spriteVisibilityDistanceValue,
              }
          : undefined;
        updates.push({
          spriteId: sprite.id,
          ...(opacityUpdate ? { opacity: opacityUpdate } : {}),
          ...(visibilityDistanceUpdate ?? {}),
          elements: resolvedElements,
        });
      });
      if (updates.length > 0) {
        activeRenderer.updateSprites(updates);
      }
    };
    const applyElementImageModeSettings = async () => {
      await ensureLabelImagesForSprites();
      applyElementModeSettings(false);
    };
    const applyElementInterpolationSettings = () => {
      applyElementModeSettings(true, false);
    };
    const applyMoveInterpolationSettings = () => {
      const activeRenderer = renderer;
      if (!activeRenderer || spriteInstances.length === 0) {
        pendingMoveInterpolationUpdate = true;
        return;
      }
      const moveInterpolation = resolveInterpolationUpdate(
        buildMoveInterpolation(),
        true
      );
      const moveUpdate = createUpdateValue(undefined, moveInterpolation);
      if (!moveUpdate) {
        pendingMoveInterpolationUpdate = true;
        return;
      }
      const updates: SpriteBulkUpdate[] = spriteInstances.map((sprite) => ({
        spriteId: sprite.id,
        sy: moveUpdate,
      }));
      activeRenderer.updateSprites(updates);
      pendingMoveInterpolationUpdate = false;
    };
    const movePhases = MOVE_PHASES;
    const opacityWavePhases = OPACITY_WAVE_PHASES;
    let bounceIndex = 0;
    let currentOpacityPhase = 1;
    const spriteTimer = window.setInterval(() => {
      const activeRenderer = renderer;
      if (!activeRenderer) {
        return;
      }
      const motion = resolveSpriteMotion(moveMode, movementSpeedScale);
      const shouldMove = motion.shouldMove;
      const shouldAnimateOpacityWave =
        shouldAnimateOpacityWaveFromModes(elementOpacityModes);
      const phase = shouldMove
        ? movePhases[bounceIndex % movePhases.length]!
        : 0;
      const opacityPhase = shouldAnimateOpacityWave
        ? (opacityWavePhases[bounceIndex % opacityWavePhases.length] ?? 1)
        : 1;
      currentOpacityPhase = opacityPhase;
      if (shouldMove || shouldAnimateOpacityWave) {
        bounceIndex += 1;
      }
      const shouldUpdateMoveInterpolation =
        pendingMoveInterpolationUpdate && spriteInstances.length > 0;
      const moveInterpolation = resolveInterpolationUpdate(
        buildMoveInterpolation(),
        shouldUpdateMoveInterpolation
      );
      const elementShiftInterpolations = resolveElementInterpolationUpdates(
        buildElementShiftInterpolations(),
        false
      );
      const elementRotationInterpolations = resolveElementInterpolationUpdates(
        buildElementRotationInterpolations(),
        false
      );
      const elementScaleInterpolations = resolveElementInterpolationUpdates(
        buildElementScaleInterpolations(),
        false
      );
      const elementOpacityInterpolations = resolveElementInterpolationUpdates(
        buildElementOpacityInterpolations(),
        false
      );
      const spriteOpacityInterpolation = resolveInterpolationUpdate(
        buildSpriteOpacityInterpolation(),
        false
      );
      const updates: SpriteBulkUpdate[] = [];
      spriteInstances.forEach((sprite) => {
        const direction = sprite.columnIndex % 2 === 0 ? 1 : -1;
        const offset = shouldMove
          ? direction * sprite.stepY * phase * motion.moveSpeedScale
          : 0;
        const currentShiftDegs = normalizeSpriteElementShiftDegs(
          sprite.shiftDegs
        );
        const currentRotateDegs = normalizeSpriteElementRotations(
          sprite.rotateDegs
        );
        const rotateStep = sprite.rotateDir * motion.rotateStepDeg;
        const nextShiftDegs: ElementRotateDegs = [
          shouldAdvanceElementShiftDeg(0)
            ? normalizeRotateDeg(currentShiftDegs[0] + rotateStep)
            : currentShiftDegs[0],
          shouldAdvanceElementShiftDeg(1)
            ? normalizeRotateDeg(currentShiftDegs[1] + rotateStep)
            : currentShiftDegs[1],
          shouldAdvanceElementShiftDeg(2)
            ? normalizeRotateDeg(currentShiftDegs[2] + rotateStep)
            : currentShiftDegs[2],
        ];
        const nextRotateDegs: ElementRotateDegs = [
          shouldAdvanceElementRotateDeg(0)
            ? normalizeRotateDeg(
                currentRotateDegs[0] +
                  rotateStep * elementRotationSpeedScales[0]
              )
            : 0,
          shouldAdvanceElementRotateDeg(1)
            ? normalizeRotateDeg(
                currentRotateDegs[1] +
                  rotateStep * elementRotationSpeedScales[1]
              )
            : 0,
          shouldAdvanceElementRotateDeg(2)
            ? normalizeRotateDeg(
                currentRotateDegs[2] +
                  rotateStep * elementRotationSpeedScales[2]
              )
            : 0,
        ];
        sprite.shiftDegs = nextShiftDegs;
        sprite.rotateDegs = nextRotateDegs;
        const elementImageIds = resolveElementImageIds(sprite);
        const rotateElements = createRotateElementsUpdate(
          elementImageIds,
          elementModes,
          nextShiftDegs,
          nextRotateDegs,
          elementShiftInterpolations,
          elementRotationInterpolations,
          elementScaleInterpolations,
          elementScales,
          elementOriginUseResolvedAnchors,
          elementAnchorXs,
          elementAnchorYs
        );
        const moveValue = shouldUpdateMoveInterpolation
          ? undefined
          : sprite.baseY + offset;
        const moveUpdate = createUpdateValue(moveValue, moveInterpolation);
        const opacityUpdate = createUpdateValue(
          spriteOpacityValue,
          spriteOpacityInterpolation
        );
        updates.push({
          spriteId: sprite.id,
          ...(moveUpdate ? { sy: moveUpdate } : {}),
          ...(opacityUpdate ? { opacity: opacityUpdate } : {}),
          elements: applyElementOrderingToElements(
            applyElementRenderModesToElements(
              applyElementVisualModesToElements(
                rotateElements,
                elementOpacityInterpolations,
                opacityPhase,
                shouldAnimateOpacityWave
              )
            )
          ),
        });
      });
      if (updates.length > 0) {
        activeRenderer.updateSprites(updates);
      }
      if (shouldUpdateMoveInterpolation) {
        pendingMoveInterpolationUpdate = false;
      }
    }, INTERPOLATION_BASE_INTERVAL_MS);
    const statsTimer = window.setInterval(() => {
      updateStats();
    }, STATS_UPDATE_INTERVAL_MS);

    const createRangeControl = (
      inputId: string,
      outputId: string,
      formatter: (value: number) => string
    ) => {
      const input = requireInput(inputId);
      const output = requireOutput(outputId);
      const setValue = (value: number) => {
        input.value = value.toString();
        output.textContent = formatter(value);
      };
      const getValue = () => Number(input.value);
      const setRange = (min: number, max: number, step: number) => {
        input.min = min.toString();
        input.max = max.toString();
        input.step = step.toString();
      };
      const syncOutput = () => {
        output.textContent = formatter(getValue());
      };
      return {
        input,
        output,
        setValue,
        getValue,
        setRange,
        syncOutput,
      };
    };

    const spriteGrid = createRangeControl(
      'sprite-grid',
      'sprite-grid-value',
      (value) => `${value * value} sprites`
    );
    const moveSpeed = createRangeControl(
      'move-speed',
      'move-speed-value',
      (value) => `${value.toFixed(1)}x`
    );
    const backdropScale = createRangeControl(
      'backdrop-scale',
      'backdrop-scale-value',
      (value) => `${value.toFixed(2)}x`
    );
    const backdropOpacity = createRangeControl(
      'backdrop-opacity',
      'backdrop-opacity-value',
      (value) => value.toFixed(2)
    );
    const backdropRotation = createRangeControl(
      'backdrop-rotation',
      'backdrop-rotation-value',
      (value) => `${value.toFixed(0)}°`
    );
    const backdropAnchorX = createRangeControl(
      'backdrop-anchor-x',
      'backdrop-anchor-x-value',
      (value) => value.toFixed(2)
    );
    const backdropAnchorY = createRangeControl(
      'backdrop-anchor-y',
      'backdrop-anchor-y-value',
      (value) => value.toFixed(2)
    );
    const backdropShiftDistance = createRangeControl(
      'backdrop-shift-distance',
      'backdrop-shift-distance-value',
      (value) => value.toFixed(0)
    );
    const backdropShiftAngle = createRangeControl(
      'backdrop-shift-angle',
      'backdrop-shift-angle-value',
      (value) => `${value.toFixed(0)}°`
    );
    const elementScaleControls = [
      createRangeControl(
        'element-0-scale',
        'element-0-scale-value',
        (value) => `${value.toFixed(2)}x`
      ),
      createRangeControl(
        'element-1-scale',
        'element-1-scale-value',
        (value) => `${value.toFixed(2)}x`
      ),
      createRangeControl(
        'element-2-scale',
        'element-2-scale-value',
        (value) => `${value.toFixed(2)}x`
      ),
    ] as const;
    const elementAnchorXControls = [
      createRangeControl(
        'element-0-anchor-x',
        'element-0-anchor-x-value',
        (value) => value.toFixed(2)
      ),
      createRangeControl(
        'element-1-anchor-x',
        'element-1-anchor-x-value',
        (value) => value.toFixed(2)
      ),
      createRangeControl(
        'element-2-anchor-x',
        'element-2-anchor-x-value',
        (value) => value.toFixed(2)
      ),
    ] as const;
    const elementAnchorYControls = [
      createRangeControl(
        'element-0-anchor-y',
        'element-0-anchor-y-value',
        (value) => value.toFixed(2)
      ),
      createRangeControl(
        'element-1-anchor-y',
        'element-1-anchor-y-value',
        (value) => value.toFixed(2)
      ),
      createRangeControl(
        'element-2-anchor-y',
        'element-2-anchor-y-value',
        (value) => value.toFixed(2)
      ),
    ] as const;
    const elementLeaderlineWidthControls = [
      createRangeControl(
        'element-0-leaderline-width',
        'element-0-leaderline-width-value',
        (value) => value.toFixed(1)
      ),
      createRangeControl(
        'element-1-leaderline-width',
        'element-1-leaderline-width-value',
        (value) => value.toFixed(1)
      ),
      createRangeControl(
        'element-2-leaderline-width',
        'element-2-leaderline-width-value',
        (value) => value.toFixed(1)
      ),
    ] as const;
    const elementLeaderlineHueControls = [
      createRangeControl(
        'element-0-leaderline-hue',
        'element-0-leaderline-hue-value',
        (value) => `${value.toFixed(0)}°`
      ),
      createRangeControl(
        'element-1-leaderline-hue',
        'element-1-leaderline-hue-value',
        (value) => `${value.toFixed(0)}°`
      ),
      createRangeControl(
        'element-2-leaderline-hue',
        'element-2-leaderline-hue-value',
        (value) => `${value.toFixed(0)}°`
      ),
    ] as const;
    const elementBorderWidthControls = [
      createRangeControl(
        'element-0-border-width',
        'element-0-border-width-value',
        (value) => value.toFixed(2)
      ),
      createRangeControl(
        'element-1-border-width',
        'element-1-border-width-value',
        (value) => value.toFixed(2)
      ),
      createRangeControl(
        'element-2-border-width',
        'element-2-border-width-value',
        (value) => value.toFixed(2)
      ),
    ] as const;
    const elementBorderHueControls = [
      createRangeControl(
        'element-0-border-hue',
        'element-0-border-hue-value',
        (value) => `${value.toFixed(0)}°`
      ),
      createRangeControl(
        'element-1-border-hue',
        'element-1-border-hue-value',
        (value) => `${value.toFixed(0)}°`
      ),
      createRangeControl(
        'element-2-border-hue',
        'element-2-border-hue-value',
        (value) => `${value.toFixed(0)}°`
      ),
    ] as const;
    const elementRotationSpeeds = [
      createRangeControl(
        'element-0-rotation-speed',
        'element-0-rotation-speed-value',
        (value) => `${value.toFixed(1)}x`
      ),
      createRangeControl(
        'element-1-rotation-speed',
        'element-1-rotation-speed-value',
        (value) => `${value.toFixed(1)}x`
      ),
      createRangeControl(
        'element-2-rotation-speed',
        'element-2-rotation-speed-value',
        (value) => `${value.toFixed(1)}x`
      ),
    ] as const;
    const elementAutoDirectionMinDistanceControls = [
      createRangeControl(
        'element-0-auto-direction-min-distance',
        'element-0-auto-direction-min-distance-value',
        (value) => value.toFixed(1)
      ),
      createRangeControl(
        'element-1-auto-direction-min-distance',
        'element-1-auto-direction-min-distance-value',
        (value) => value.toFixed(1)
      ),
      createRangeControl(
        'element-2-auto-direction-min-distance',
        'element-2-auto-direction-min-distance-value',
        (value) => value.toFixed(1)
      ),
    ] as const;
    const elementLayerControls = [
      createRangeControl('element-0-layer', 'element-0-layer-value', (value) =>
        value.toFixed(0)
      ),
      createRangeControl('element-1-layer', 'element-1-layer-value', (value) =>
        value.toFixed(0)
      ),
      createRangeControl('element-2-layer', 'element-2-layer-value', (value) =>
        value.toFixed(0)
      ),
    ] as const;
    const elementOrderControls = [
      createRangeControl('element-0-order', 'element-0-order-value', (value) =>
        value.toFixed(0)
      ),
      createRangeControl('element-1-order', 'element-1-order-value', (value) =>
        value.toFixed(0)
      ),
      createRangeControl('element-2-order', 'element-2-order-value', (value) =>
        value.toFixed(0)
      ),
    ] as const;
    const spriteOpacity = createRangeControl(
      'sprite-opacity',
      'sprite-opacity-value',
      (value) => value.toFixed(2)
    );
    const spriteVisibilityDistance = createRangeControl(
      'sprite-visibility-distance',
      'sprite-visibility-distance-value',
      (value) => formatSpriteVisibilityDistanceValue(value)
    );
    const polylineOuterOpacity = createRangeControl(
      'polyline-outer-opacity',
      'polyline-outer-opacity-value',
      (value) => value.toFixed(2)
    );
    const polylineOuterLayer = createRangeControl(
      'polyline-outer-layer',
      'polyline-outer-layer-value',
      (value) => value.toFixed(0)
    );
    const polylineOuterHue = createRangeControl(
      'polyline-outer-hue',
      'polyline-outer-hue-value',
      (value) => `${value.toFixed(0)}°`
    );
    const polylineOuterJoinCorrectionSelect = requireSelect(
      'polyline-outer-join-correction'
    );
    const polylineOuterCapCorrectionSelect = requireSelect(
      'polyline-outer-cap-correction'
    );
    const polylineRandomOpacity = createRangeControl(
      'polyline-random-opacity',
      'polyline-random-opacity-value',
      (value) => value.toFixed(2)
    );
    const polylineRandomLayer = createRangeControl(
      'polyline-random-layer',
      'polyline-random-layer-value',
      (value) => value.toFixed(0)
    );
    const polylineRandomHue = createRangeControl(
      'polyline-random-hue',
      'polyline-random-hue-value',
      (value) => `${value.toFixed(0)}°`
    );
    const polylineRandomJoinCorrectionSelect = requireSelect(
      'polyline-random-join-correction'
    );
    const polylineRandomCapCorrectionSelect = requireSelect(
      'polyline-random-cap-correction'
    );
    const positionX = createRangeControl(
      'camera-pos-x',
      'camera-pos-x-value',
      (value) => value.toFixed(1)
    );
    const positionY = createRangeControl(
      'camera-pos-y',
      'camera-pos-y-value',
      (value) => value.toFixed(1)
    );
    const positionZ = createRangeControl(
      'camera-pos-z',
      'camera-pos-z-value',
      (value) => value.toFixed(1)
    );
    const yaw = createRangeControl(
      'camera-yaw',
      'camera-yaw-value',
      (value) => `${value.toFixed(0)}°`
    );
    const pitch = createRangeControl(
      'camera-pitch',
      'camera-pitch-value',
      (value) => `${value.toFixed(0)}°`
    );
    const roll = createRangeControl(
      'camera-roll',
      'camera-roll-value',
      (value) => `${value.toFixed(0)}°`
    );
    const fov = createRangeControl(
      'camera-fov',
      'camera-fov-value',
      (value) => `${value.toFixed(0)}°`
    );

    const initialFov = 45;
    const initialYaw = 0;
    const initialPitch = 0;
    const initialRoll = 0;
    const initialCameraResetValues = createDemoCameraResetValues(
      initialYaw,
      initialPitch,
      initialRoll,
      initialFov
    );
    const initialDistance =
      viewHeight / 2 / Math.tan((initialFov * Math.PI) / 360);
    const cameraPositionRange = resolveCameraPositionRange(
      viewWidth,
      viewHeight,
      initialDistance
    );

    spriteGrid.setRange(1, 400, 1);
    moveSpeed.setRange(0, 3, 0.1);
    backdropScale.setRange(0.05, 50, 0.05);
    backdropOpacity.setRange(0, 1, 0.05);
    backdropRotation.setRange(-180, 180, 1);
    backdropAnchorX.setRange(-1, 1, 0.05);
    backdropAnchorY.setRange(-1, 1, 0.05);
    backdropShiftDistance.setRange(0, 4000, 5);
    backdropShiftAngle.setRange(-180, 180, 1);
    elementScaleControls.forEach((control) => {
      control.setRange(0.1, 3, 0.1);
    });
    elementAnchorXControls.forEach((control) => {
      control.setRange(-1, 1, 0.05);
    });
    elementAnchorYControls.forEach((control) => {
      control.setRange(-1, 1, 0.05);
    });
    elementLeaderlineWidthControls.forEach((control) => {
      control.setRange(0, 60, 0.5);
    });
    elementLeaderlineHueControls.forEach((control) => {
      control.setRange(0, 360, 1);
    });
    elementBorderWidthControls.forEach((control) => {
      control.setRange(0, 12, 0.1);
    });
    elementBorderHueControls.forEach((control) => {
      control.setRange(0, 360, 1);
    });
    elementRotationSpeeds.forEach((control) => {
      control.setRange(0, 3, 0.1);
    });
    elementAutoDirectionMinDistanceControls.forEach((control) => {
      control.setRange(0, 200, 0.5);
    });
    elementLayerControls.forEach((control) => {
      control.setRange(1, 31, 1);
    });
    elementOrderControls.forEach((control) => {
      control.setRange(0, 7, 1);
    });
    spriteOpacity.setRange(0, 1, 0.05);
    spriteVisibilityDistance.setRange(
      SPRITE_VISIBILITY_DISTANCE_MIN_VALUE,
      SPRITE_VISIBILITY_DISTANCE_DISABLED_VALUE,
      1
    );
    polylineOuterOpacity.setRange(0, 1, 0.05);
    polylineOuterLayer.setRange(1, 31, 1);
    polylineOuterHue.setRange(0, 360, 1);
    polylineRandomOpacity.setRange(0, 1, 0.05);
    polylineRandomLayer.setRange(1, 31, 1);
    polylineRandomHue.setRange(0, 360, 1);
    positionX.setRange(cameraPositionRange.minX, cameraPositionRange.maxX, 1);
    positionY.setRange(cameraPositionRange.minY, cameraPositionRange.maxY, 1);
    positionZ.setRange(cameraPositionRange.minZ, cameraPositionRange.maxZ, 1);
    yaw.setRange(-180, 180, 1);
    pitch.setRange(-89, 89, 1);
    roll.setRange(-180, 180, 1);
    fov.setRange(20, 90, 1);

    spriteGrid.setValue(2);
    moveSpeed.setValue(1);
    movementSpeedScale = moveSpeed.getValue();
    backdropScale.setValue(1);
    backdropOpacity.setValue(1);
    backdropRotation.setValue(0);
    backdropAnchorX.setValue(0);
    backdropAnchorY.setValue(0);
    backdropShiftDistance.setValue(0);
    backdropShiftAngle.setValue(0);
    backdropScaleValue = backdropScale.getValue();
    backdropOpacityValue = backdropOpacity.getValue();
    backdropRotationValue = backdropRotation.getValue();
    backdropAnchorXValue = backdropAnchorX.getValue();
    backdropAnchorYValue = backdropAnchorY.getValue();
    backdropShiftDistanceValue = backdropShiftDistance.getValue();
    backdropShiftAngleValue = backdropShiftAngle.getValue();
    elementScaleControls.forEach((control) => {
      control.setValue(1);
    });
    elementAnchorXControls.forEach((control) => {
      control.setValue(0);
    });
    elementAnchorYControls.forEach((control) => {
      control.setValue(0);
    });
    elementLeaderlineWidthControls.forEach((control) => {
      control.setValue(0);
    });
    elementLeaderlineHueControls[0].setValue(30);
    elementLeaderlineHueControls[1].setValue(140);
    elementLeaderlineHueControls[2].setValue(220);
    elementBorderWidthControls.forEach((control) => {
      control.setValue(0);
    });
    elementBorderHueControls[0].setValue(350);
    elementBorderHueControls[1].setValue(80);
    elementBorderHueControls[2].setValue(200);
    elementRotationSpeeds.forEach((control) => {
      control.setValue(0);
    });
    elementAutoDirectionMinDistanceControls.forEach((control) => {
      control.setValue(0);
    });
    elementLayerControls.forEach((control) => {
      control.setValue(3);
    });
    elementOrderControls.forEach((control) => {
      control.setValue(0);
    });
    elementRotationSpeedScales = [
      elementRotationSpeeds[0].getValue(),
      elementRotationSpeeds[1].getValue(),
      elementRotationSpeeds[2].getValue(),
    ];
    elementScales = [
      elementScaleControls[0].getValue(),
      elementScaleControls[1].getValue(),
      elementScaleControls[2].getValue(),
    ];
    elementAnchorXs = [
      elementAnchorXControls[0].getValue(),
      elementAnchorXControls[1].getValue(),
      elementAnchorXControls[2].getValue(),
    ];
    elementAnchorYs = [
      elementAnchorYControls[0].getValue(),
      elementAnchorYControls[1].getValue(),
      elementAnchorYControls[2].getValue(),
    ];
    elementLeaderlineWidths = [
      elementLeaderlineWidthControls[0].getValue(),
      elementLeaderlineWidthControls[1].getValue(),
      elementLeaderlineWidthControls[2].getValue(),
    ];
    elementLeaderlineHueValues = [
      elementLeaderlineHueControls[0].getValue(),
      elementLeaderlineHueControls[1].getValue(),
      elementLeaderlineHueControls[2].getValue(),
    ];
    elementBorderWidths = [
      elementBorderWidthControls[0].getValue(),
      elementBorderWidthControls[1].getValue(),
      elementBorderWidthControls[2].getValue(),
    ];
    elementBorderHueValues = [
      elementBorderHueControls[0].getValue(),
      elementBorderHueControls[1].getValue(),
      elementBorderHueControls[2].getValue(),
    ];
    elementAutoDirectionMinDistances = [
      elementAutoDirectionMinDistanceControls[0].getValue(),
      elementAutoDirectionMinDistanceControls[1].getValue(),
      elementAutoDirectionMinDistanceControls[2].getValue(),
    ];
    elementIndices.forEach((index) => {
      syncElementAutoDirectionControlState(index);
    });
    elementLayers = [
      elementLayerControls[0].getValue(),
      elementLayerControls[1].getValue(),
      elementLayerControls[2].getValue(),
    ];
    elementOrders = [
      elementOrderControls[0].getValue(),
      elementOrderControls[1].getValue(),
      elementOrderControls[2].getValue(),
    ];
    spriteOpacity.setValue(1);
    spriteOpacityValue = spriteOpacity.getValue();
    spriteVisibilityDistance.setValue(
      SPRITE_VISIBILITY_DISTANCE_DISABLED_VALUE
    );
    spriteVisibilityDistanceValue = resolveSpriteVisibilityDistanceValue(
      spriteVisibilityDistance.getValue()
    );
    polylineOuterOpacity.setValue(1);
    polylineOuterLayer.setValue(1);
    polylineOuterHue.setValue(10);
    polylineOuterJoinCorrectionSelect.value = 'fan5';
    polylineOuterCapCorrectionSelect.value = 'fan5';
    polylineRandomOpacity.setValue(1);
    polylineRandomLayer.setValue(2);
    polylineRandomHue.setValue(200);
    polylineRandomJoinCorrectionSelect.value = 'fan5';
    polylineRandomCapCorrectionSelect.value = 'fan5';
    polylineOuterOpacityValue = polylineOuterOpacity.getValue();
    polylineOuterLayerValue = polylineOuterLayer.getValue();
    polylineOuterHueValue = polylineOuterHue.getValue();
    polylineOuterJoinCorrectionValue = readPolylineCorrectionSelectValue(
      polylineOuterJoinCorrectionSelect
    );
    polylineOuterCapCorrectionValue = readPolylineCorrectionSelectValue(
      polylineOuterCapCorrectionSelect
    );
    polylineRandomOpacityValue = polylineRandomOpacity.getValue();
    polylineRandomLayerValue = polylineRandomLayer.getValue();
    polylineRandomHueValue = polylineRandomHue.getValue();
    polylineRandomJoinCorrectionValue = readPolylineCorrectionSelectValue(
      polylineRandomJoinCorrectionSelect
    );
    polylineRandomCapCorrectionValue = readPolylineCorrectionSelectValue(
      polylineRandomCapCorrectionSelect
    );
    positionX.setValue(0);
    positionY.setValue(0);
    positionZ.setValue(initialDistance);
    applyDemoCameraResetValues(
      {
        yaw,
        pitch,
        roll,
        fov,
      },
      initialCameraResetValues
    );

    const updateCamera = (
      updateInterpolation: boolean,
      updateValues: boolean = true
    ) => {
      const activeRenderer = renderer;
      if (!activeRenderer) {
        return;
      }
      const cameraInterpolation = resolveInterpolationUpdate(
        buildCameraInterpolation(),
        updateInterpolation
      );
      const compensatedX = positionX.getValue() * cameraScaleCompensation;
      const compensatedY = positionY.getValue() * cameraScaleCompensation;
      const compensatedZ = positionZ.getValue() * cameraScaleCompensation;
      const far = resolveCameraFar(
        compensatedZ,
        cellWidth,
        cellHeight,
        currentGridSize
      );
      const positionXUpdate = createUpdateValue(
        updateValues ? compensatedX : undefined,
        cameraInterpolation
      );
      const positionYUpdate = createUpdateValue(
        updateValues ? compensatedY : undefined,
        cameraInterpolation
      );
      const positionZUpdate = createUpdateValue(
        updateValues ? compensatedZ : undefined,
        cameraInterpolation
      );
      const rotationYawUpdate = createUpdateValue(
        updateValues ? yaw.getValue() : undefined,
        cameraInterpolation
      );
      const rotationPitchUpdate = createUpdateValue(
        updateValues ? pitch.getValue() : undefined,
        cameraInterpolation
      );
      const rotationRollUpdate = createUpdateValue(
        updateValues ? roll.getValue() : undefined,
        cameraInterpolation
      );
      const fovUpdate = createUpdateValue(
        updateValues ? fov.getValue() : undefined,
        cameraInterpolation
      );
      const positionUpdate =
        positionXUpdate || positionYUpdate || positionZUpdate
          ? {
              ...(positionXUpdate ? { x: positionXUpdate } : {}),
              ...(positionYUpdate ? { y: positionYUpdate } : {}),
              ...(positionZUpdate ? { z: positionZUpdate } : {}),
            }
          : undefined;
      const rotationUpdate =
        rotationYawUpdate || rotationPitchUpdate || rotationRollUpdate
          ? {
              ...(rotationYawUpdate ? { yaw: rotationYawUpdate } : {}),
              ...(rotationPitchUpdate ? { pitch: rotationPitchUpdate } : {}),
              ...(rotationRollUpdate ? { roll: rotationRollUpdate } : {}),
            }
          : undefined;
      activeRenderer.updateCamera({
        ...(positionUpdate ? { position: positionUpdate } : {}),
        ...(rotationUpdate ? { rotation: rotationUpdate } : {}),
        ...(fovUpdate ? { fovY: fovUpdate } : {}),
        ...(updateValues ? { far } : {}),
      });
    };

    const adjustCameraToSprites = (updateInterpolation: boolean) => {
      const activeRenderer = renderer;
      if (!activeRenderer) {
        return;
      }
      const cameraInterpolation = resolveInterpolationUpdate(
        buildCameraInterpolation(),
        updateInterpolation
      );
      const compensatedZ = positionZ.getValue() * cameraScaleCompensation;
      const far = resolveCameraFar(
        compensatedZ,
        cellWidth,
        cellHeight,
        currentGridSize
      );
      activeRenderer.adjustCameraPosition(
        createAdjustCameraToSpritesOptions(
          pitch.getValue(),
          fov.getValue(),
          far,
          cameraInterpolation
        )
      );
    };

    const applyCameraInteraction = () => {
      if (detachCameraControls) {
        detachCameraControls();
        detachCameraControls = null;
      }
      isCameraInteracting = false;
      if (!cameraInteractionInput.checked) {
        return;
      }
      const activeRenderer = renderer;
      if (!activeRenderer) {
        return;
      }
      const panTrigger = buildControlTrigger(
        cameraPanButtonSelect,
        cameraPanAltSelect,
        cameraPanShiftSelect,
        cameraPanCtrlSelect,
        cameraPanMetaSelect
      );
      const rotationTrigger = buildControlTrigger(
        cameraRotateButtonSelect,
        cameraRotateAltSelect,
        cameraRotateShiftSelect,
        cameraRotateCtrlSelect,
        cameraRotateMetaSelect
      );
      detachCameraControls = activeRenderer.attachCameraControls({
        interactionInterpolation: buildCameraInteractionInterpolation(),
        pollingIntervalMs: CAMERA_CONTROL_POLLING_INTERVAL_MS,
        pan: { trigger: panTrigger },
        rotation: { trigger: rotationTrigger },
      });
    };

    const applyCameraEventListeners = () => {
      if (detachCameraEvents) {
        detachCameraEvents();
        detachCameraEvents = null;
      }
      const activeRenderer = renderer;
      if (!activeRenderer) {
        return;
      }
      const detachInteraction = activeRenderer.onCameraInteraction((event) => {
        if (event.phase === 'end') {
          isCameraInteracting = false;
          return;
        }
        isCameraInteracting = true;
      });
      const detachChange = activeRenderer.onCameraChange((event) => {
        if (!shouldSyncCameraSlidersFromEvent(event.source)) {
          return;
        }
        const compensation =
          Number.isFinite(cameraScaleCompensation) &&
          cameraScaleCompensation !== 0
            ? cameraScaleCompensation
            : 1;
        positionX.setValue(event.cameraState.position.x.value / compensation);
        positionY.setValue(event.cameraState.position.y.value / compensation);
        positionZ.setValue(event.cameraState.position.z.value / compensation);
        yaw.setValue(event.cameraState.rotation.yaw.value);
        pitch.setValue(event.cameraState.rotation.pitch.value);
        roll.setValue(event.cameraState.rotation.roll.value);
      });
      detachCameraEvents = () => {
        detachChange();
        detachInteraction();
        isCameraInteracting = false;
      };
    };

    const applyPickEventListeners = () => {
      if (detachPickEvents) {
        detachPickEvents();
        detachPickEvents = null;
      }
      const activeRenderer = renderer;
      if (!activeRenderer) {
        clearPickOutput();
        return;
      }
      clearPickOutput();
      const handleCanvasClick = (event: MouseEvent) => {
        if (
          !Number.isFinite(event.clientX) ||
          !Number.isFinite(event.clientY)
        ) {
          return;
        }
        const rect = canvas.getBoundingClientRect();
        const pointer = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
        if (!activeRenderer.pickAt(pointer.x, pointer.y)) {
          clearPickOutput();
        }
      };
      const detachPick = activeRenderer.onPick((event) => {
        applyPickOutput(event);
        rendererLogger.debug('[pick]', {
          kind: event.kind,
          ...(event.kind === 'sprite'
            ? { spriteId: event.spriteId, elementIndex: event.elementIndex }
            : {
                polylineId: event.polylineId,
                segmentIndex: event.segmentIndex,
              }),
          screen: event.screen,
          world: event.world ?? null,
          timestampMs: event.timestampMs,
        });
      });
      canvas.addEventListener('click', handleCanvasClick);
      detachPickEvents = () => {
        detachPick();
        canvas.removeEventListener('click', handleCanvasClick);
      };
    };

    const createRendererForRuntimeOptions = async (
      precision: WasmInputPrecision,
      scalingLimitPresetId: RuntimeScalingLimitPresetId,
      pickMaskEnabled: boolean,
      textureSampling: RuntimeTextureSampling,
      upScalingToPowerOfTwo: boolean,
      atlasSize: AtlasUiSize
    ) => {
      const previousRenderer = renderer;
      const previousStop = stopRenderer;
      const previousSquarePolylineId = squarePolylineId;
      const previousRandomPolylineId = randomPolylineId;
      const previousDetachCameraControls = detachCameraControls;
      const previousDetachCameraEvents = detachCameraEvents;
      const previousDetachPickEvents = detachPickEvents;
      let nextRenderer: ObjectCanvasRenderer | null = null;
      let nextStop: (() => void) | null = null;

      if (previousStop) {
        previousStop();
        stopRenderer = null;
      }
      if (previousDetachCameraControls) {
        previousDetachCameraControls();
        detachCameraControls = null;
      }
      if (previousDetachCameraEvents) {
        previousDetachCameraEvents();
        detachCameraEvents = null;
      }
      if (previousDetachPickEvents) {
        previousDetachPickEvents();
        detachPickEvents = null;
      }
      rendererEpoch += 1;
      pendingGridSize = null;
      rebuildChain = Promise.resolve();
      spriteInstances = [];
      squarePolylineId = null;
      randomPolylineId = null;
      backdropSpriteId = null;
      renderer = null;
      currentAtlasId = null;
      labelImageIds.clear();

      try {
        const wasmInstance = await getWasmInstance();
        const scalingLimitPreset =
          resolveRuntimeScalingLimitPreset(scalingLimitPresetId);
        nextRenderer = createObjectCanvasRenderer(canvas, wasmInstance, {
          precision,
          logger: rendererLogger,
          spriteScaling: scalingLimitPreset.spriteScaling,
          polylineScaling: scalingLimitPreset.polylineScaling,
        });
        renderer = nextRenderer;
        nextStop = nextRenderer.start();
        stopRenderer = nextStop;
        applyCameraInteraction();
        applyCameraEventListeners();
        applyPickEventListeners();
        const maxTextureSize = resolveMaxTextureSize(canvas);
        const atlasConfig = resolveAtlasPageSize(
          [
            { id: 'curve', bitmap: curveBitmap },
            { id: 'walker', bitmap: walkerBitmap },
            { id: CAUTION_IMAGE_ID, bitmap: cautionBitmap },
            { id: CAR_IMAGE_ID, bitmap: carBitmap },
          ],
          upScalingToPowerOfTwo,
          {
            paddingPixel: DEFAULT_ATLAS_PADDING_PIXEL,
            requestedWidth: atlasSize.widthPixel,
            requestedHeight: atlasSize.heightPixel,
            maxTextureSize,
          }
        );
        atlasResolvedOutput.textContent = `${atlasConfig.widthPixel}x${atlasConfig.heightPixel}`;
        atlasMaxOutput.textContent =
          maxTextureSize !== null ? `${maxTextureSize}` : '-';
        rendererLogger.debug('[atlas] max texture size', {
          maxTextureSize,
        });
        rendererLogger.debug('[atlas] sizing', {
          requestedWidth: atlasConfig.requestedWidth,
          requestedHeight: atlasConfig.requestedHeight,
          requiredWidth: atlasConfig.requiredWidth,
          requiredHeight: atlasConfig.requiredHeight,
          resolvedWidth: atlasConfig.widthPixel,
          resolvedHeight: atlasConfig.heightPixel,
          paddingPixel: atlasConfig.paddingPixel,
          upScalingToPowerOfTwo,
          cappedByMax: atlasConfig.cappedByMax,
          fitsLargest: atlasConfig.fitsLargest,
          estimatedPages: atlasConfig.estimatedPages,
        });
        if (atlasConfig.cappedByMax) {
          rendererLogger.debug('[atlas] size capped by MAX_TEXTURE_SIZE', {
            maxTextureSize,
            resolvedWidth: atlasConfig.widthPixel,
            resolvedHeight: atlasConfig.heightPixel,
          });
        }
        if (!atlasConfig.fitsLargest) {
          rendererLogger.debug('[atlas] largest image exceeds page', {
            requiredWidth: atlasConfig.requiredWidth,
            requiredHeight: atlasConfig.requiredHeight,
          });
        }
        atlasConfig.images.forEach((image) => {
          rendererLogger.debug('[atlas] image', image);
        });
        const atlasId = nextRenderer.allocateAtlas({
          widthPixel: atlasConfig.widthPixel,
          heightPixel: atlasConfig.heightPixel,
          paddingPixel: atlasConfig.paddingPixel,
          textureSampling,
          ...(pickMaskEnabled
            ? {
                pickMask: { enabled: true, alphaThreshold: 1 } as const,
              }
            : {}),
        });
        currentAtlasId = atlasId;
        await nextRenderer.registerImage(
          atlasId,
          'curve',
          curveBitmap,
          upScalingToPowerOfTwo
        );
        await nextRenderer.registerImage(
          atlasId,
          'walker',
          walkerBitmap,
          upScalingToPowerOfTwo
        );
        await nextRenderer.registerImage(
          atlasId,
          CAUTION_IMAGE_ID,
          cautionBitmap,
          upScalingToPowerOfTwo
        );
        await nextRenderer.registerImage(
          atlasId,
          CAR_IMAGE_ID,
          carBitmap,
          upScalingToPowerOfTwo
        );
        await syncBackdropSprite(rendererEpoch, upScalingToPowerOfTwo);

        currentPrecision = precision;
        currentScalingLimitPresetId = scalingLimitPreset.id;
        currentPickMaskEnabled = pickMaskEnabled;
        currentTextureSampling = cloneTextureSampling(textureSampling);
        currentUpscalingToPowerOfTwo = upScalingToPowerOfTwo;
        currentAtlasSize = atlasSize;
        wasmF64Input.checked = precision === 'f64';
        pickMaskInput.checked = currentPickMaskEnabled;
        scalingLimitPresetSelect.value = currentScalingLimitPresetId;
        upScalingToPowerOfTwoInput.checked = currentUpscalingToPowerOfTwo;
        applyTextureSamplingToControls(currentTextureSampling);
        const size = clampGridSize(spriteGrid.getValue());
        spriteGrid.setValue(size);
        await scheduleRebuildSprites(size);
        await ensureLabelImagesForSprites();
        applyMoveInterpolationSettings();
        applyElementModeSettings(true, false);
        updateCamera(true);
        updateStats();

        if (previousRenderer) {
          previousRenderer.release();
        }
      } catch (error) {
        if (nextStop) {
          nextStop();
        }
        if (nextRenderer) {
          nextRenderer.release();
        }
        renderer = previousRenderer;
        squarePolylineId = previousSquarePolylineId;
        randomPolylineId = previousRandomPolylineId;
        if (previousRenderer) {
          stopRenderer = previousRenderer.start();
        }
        applyCameraInteraction();
        applyCameraEventListeners();
        applyPickEventListeners();
        updateStats();
        throw error;
      }
    };

    const updateSpriteGrid = () => {
      const size = clampGridSize(spriteGrid.getValue());
      spriteGrid.setValue(size);
      void scheduleRebuildSprites(size).then(() => {
        applyMoveInterpolationSettings();
        applyElementModeSettings(true, false);
        adjustCameraToSprites(false);
      });
    };

    spriteGrid.input.addEventListener('input', updateSpriteGrid);
    moveSpeed.input.addEventListener('input', () => {
      moveSpeed.syncOutput();
      movementSpeedScale = moveSpeed.getValue();
      applyElementModeSettings(false);
    });
    backdropScale.input.addEventListener('input', () => {
      backdropScale.syncOutput();
      backdropScaleValue = backdropScale.getValue();
      applyBackdropSettings();
    });
    backdropOpacity.input.addEventListener('input', () => {
      backdropOpacity.syncOutput();
      backdropOpacityValue = backdropOpacity.getValue();
      applyBackdropSettings();
    });
    backdropRotation.input.addEventListener('input', () => {
      backdropRotation.syncOutput();
      backdropRotationValue = backdropRotation.getValue();
      applyBackdropSettings();
    });
    backdropAnchorX.input.addEventListener('input', () => {
      backdropAnchorX.syncOutput();
      backdropAnchorXValue = backdropAnchorX.getValue();
      applyBackdropSettings();
    });
    backdropAnchorY.input.addEventListener('input', () => {
      backdropAnchorY.syncOutput();
      backdropAnchorYValue = backdropAnchorY.getValue();
      applyBackdropSettings();
    });
    backdropShiftDistance.input.addEventListener('input', () => {
      backdropShiftDistance.syncOutput();
      backdropShiftDistanceValue = backdropShiftDistance.getValue();
      applyBackdropSettings();
    });
    backdropShiftAngle.input.addEventListener('input', () => {
      backdropShiftAngle.syncOutput();
      backdropShiftAngleValue = backdropShiftAngle.getValue();
      applyBackdropSettings();
    });
    elementIndices.forEach((index: ElementIndex) => {
      elementScaleControls[index].input.addEventListener('input', () => {
        elementScaleControls[index].syncOutput();
        elementScales[index] = elementScaleControls[index].getValue();
        applyElementModeSettings(false);
      });
      elementAnchorXControls[index].input.addEventListener('input', () => {
        elementAnchorXControls[index].syncOutput();
        elementAnchorXs[index] = elementAnchorXControls[index].getValue();
        applyElementModeSettings(false);
      });
      elementAnchorYControls[index].input.addEventListener('input', () => {
        elementAnchorYControls[index].syncOutput();
        elementAnchorYs[index] = elementAnchorYControls[index].getValue();
        applyElementModeSettings(false);
      });
      elementLeaderlineWidthControls[index].input.addEventListener(
        'input',
        () => {
          elementLeaderlineWidthControls[index].syncOutput();
          elementLeaderlineWidths[index] =
            elementLeaderlineWidthControls[index].getValue();
          applyLeaderlineSettings();
        }
      );
      elementLeaderlineHueControls[index].input.addEventListener(
        'input',
        () => {
          elementLeaderlineHueControls[index].syncOutput();
          elementLeaderlineHueValues[index] =
            elementLeaderlineHueControls[index].getValue();
          applyLeaderlineSettings();
        }
      );
      elementBorderWidthControls[index].input.addEventListener('input', () => {
        elementBorderWidthControls[index].syncOutput();
        elementBorderWidths[index] =
          elementBorderWidthControls[index].getValue();
        applyBorderSettings();
      });
      elementBorderHueControls[index].input.addEventListener('input', () => {
        elementBorderHueControls[index].syncOutput();
        elementBorderHueValues[index] =
          elementBorderHueControls[index].getValue();
        applyBorderSettings();
      });
      elementRotationSpeeds[index].input.addEventListener('input', () => {
        elementRotationSpeeds[index].syncOutput();
        elementRotationSpeedScales[index] =
          elementRotationSpeeds[index].getValue();
        applyElementModeSettings(false);
      });
      elementAutoDirectionMinDistanceControls[index].input.addEventListener(
        'input',
        () => {
          elementAutoDirectionMinDistanceControls[index].syncOutput();
          elementAutoDirectionMinDistances[index] =
            elementAutoDirectionMinDistanceControls[index].getValue();
          applyElementModeSettings(false);
        }
      );
      elementLayerControls[index].input.addEventListener('input', () => {
        elementLayerControls[index].syncOutput();
        elementLayers[index] = elementLayerControls[index].getValue();
        applyElementModeSettings(false);
      });
      elementOrderControls[index].input.addEventListener('input', () => {
        elementOrderControls[index].syncOutput();
        elementOrders[index] = elementOrderControls[index].getValue();
        applyElementModeSettings(false);
      });
    });
    spriteOpacity.input.addEventListener('input', () => {
      spriteOpacity.syncOutput();
      spriteOpacityValue = spriteOpacity.getValue();
      applyElementModeSettings(false);
    });
    spriteVisibilityDistance.input.addEventListener('input', () => {
      spriteVisibilityDistance.syncOutput();
      spriteVisibilityDistanceValue = resolveSpriteVisibilityDistanceValue(
        spriteVisibilityDistance.getValue()
      );
      applyElementModeSettings(false);
    });
    polylineOuterOpacity.input.addEventListener('input', () => {
      polylineOuterOpacity.syncOutput();
      polylineOuterOpacityValue = polylineOuterOpacity.getValue();
      applyPolylineStyleUpdates();
    });
    polylineOuterLayer.input.addEventListener('input', () => {
      polylineOuterLayer.syncOutput();
      polylineOuterLayerValue = polylineOuterLayer.getValue();
      applyPolylineStyleUpdates();
    });
    polylineOuterHue.input.addEventListener('input', () => {
      polylineOuterHue.syncOutput();
      polylineOuterHueValue = polylineOuterHue.getValue();
      applyPolylineStyleUpdates();
    });
    polylineOuterJoinCorrectionSelect.addEventListener('change', () => {
      polylineOuterJoinCorrectionValue = readPolylineCorrectionSelectValue(
        polylineOuterJoinCorrectionSelect
      );
      applyPolylineStyleUpdates();
    });
    polylineOuterCapCorrectionSelect.addEventListener('change', () => {
      polylineOuterCapCorrectionValue = readPolylineCorrectionSelectValue(
        polylineOuterCapCorrectionSelect
      );
      applyPolylineStyleUpdates();
    });
    polylineRandomOpacity.input.addEventListener('input', () => {
      polylineRandomOpacity.syncOutput();
      polylineRandomOpacityValue = polylineRandomOpacity.getValue();
      applyPolylineStyleUpdates();
    });
    polylineRandomLayer.input.addEventListener('input', () => {
      polylineRandomLayer.syncOutput();
      polylineRandomLayerValue = polylineRandomLayer.getValue();
      applyPolylineStyleUpdates();
    });
    polylineRandomHue.input.addEventListener('input', () => {
      polylineRandomHue.syncOutput();
      polylineRandomHueValue = polylineRandomHue.getValue();
      applyPolylineStyleUpdates();
    });
    polylineRandomJoinCorrectionSelect.addEventListener('change', () => {
      polylineRandomJoinCorrectionValue = readPolylineCorrectionSelectValue(
        polylineRandomJoinCorrectionSelect
      );
      applyPolylineStyleUpdates();
    });
    polylineRandomCapCorrectionSelect.addEventListener('change', () => {
      polylineRandomCapCorrectionValue = readPolylineCorrectionSelectValue(
        polylineRandomCapCorrectionSelect
      );
      applyPolylineStyleUpdates();
    });
    [positionX, positionY, positionZ, yaw, pitch, roll, fov].forEach(
      (control) => {
        control.input.addEventListener('input', () => {
          control.syncOutput();
          if (!shouldApplyCameraUpdateFromSlider(isCameraInteracting)) {
            return;
          }
          updateCamera(false);
        });
      }
    );

    let isSwitchingRuntimeOptions = false;
    wasmF64Input.checked = false;
    pickMaskInput.checked = true;
    upScalingToPowerOfTwoInput.checked = true;
    applyTextureSamplingToControls(currentTextureSampling);

    const runtimeTextureSamplingSelects = [
      textureMinFilterSelect,
      textureMagFilterSelect,
      textureWrapSSelect,
      textureWrapTSelect,
      textureNpotPolicySelect,
    ] as const;

    const switchRendererRuntimeOptions = (
      requestedPrecision: WasmInputPrecision,
      requestedScalingLimitPresetId: RuntimeScalingLimitPresetId,
      requestedPickMaskEnabled: boolean,
      requestedTextureSampling: RuntimeTextureSampling,
      requestedUpscalingToPowerOfTwo: boolean,
      requestedAtlasSize: AtlasUiSize
    ) => {
      if (isSwitchingRuntimeOptions) {
        return;
      }
      if (
        requestedPrecision === currentPrecision &&
        requestedScalingLimitPresetId === currentScalingLimitPresetId &&
        requestedPickMaskEnabled === currentPickMaskEnabled &&
        isSameTextureSampling(
          requestedTextureSampling,
          currentTextureSampling
        ) &&
        requestedUpscalingToPowerOfTwo === currentUpscalingToPowerOfTwo &&
        isSameAtlasSize(requestedAtlasSize, currentAtlasSize)
      ) {
        return;
      }
      isSwitchingRuntimeOptions = true;
      wasmF64Input.disabled = true;
      pickMaskInput.disabled = true;
      scalingLimitPresetSelect.disabled = true;
      upScalingToPowerOfTwoInput.disabled = true;
      atlasWidthInput.disabled = true;
      atlasHeightInput.disabled = true;
      runtimeTextureSamplingSelects.forEach((select) => {
        select.disabled = true;
      });
      void createRendererForRuntimeOptions(
        requestedPrecision,
        requestedScalingLimitPresetId,
        requestedPickMaskEnabled,
        requestedTextureSampling,
        requestedUpscalingToPowerOfTwo,
        requestedAtlasSize
      )
        .catch((error) => {
          console.error('Failed to switch renderer runtime options:', error);
          wasmF64Input.checked = currentPrecision === 'f64';
          pickMaskInput.checked = currentPickMaskEnabled;
          scalingLimitPresetSelect.value = currentScalingLimitPresetId;
          upScalingToPowerOfTwoInput.checked = currentUpscalingToPowerOfTwo;
          atlasWidthInput.value = `${currentAtlasSize.widthPixel}`;
          atlasHeightInput.value = `${currentAtlasSize.heightPixel}`;
          applyTextureSamplingToControls(currentTextureSampling);
        })
        .finally(() => {
          isSwitchingRuntimeOptions = false;
          wasmF64Input.disabled = false;
          pickMaskInput.disabled = false;
          scalingLimitPresetSelect.disabled = false;
          upScalingToPowerOfTwoInput.disabled = false;
          atlasWidthInput.disabled = false;
          atlasHeightInput.disabled = false;
          runtimeTextureSamplingSelects.forEach((select) => {
            select.disabled = false;
          });
        });
    };

    wasmF64Input.addEventListener('change', () => {
      const requestedPrecision: WasmInputPrecision = wasmF64Input.checked
        ? 'f64'
        : 'f32';
      switchRendererRuntimeOptions(
        requestedPrecision,
        readScalingLimitPresetFromControls(),
        readPickMaskEnabledFromControls(),
        readTextureSamplingFromControls(),
        upScalingToPowerOfTwoInput.checked,
        readAtlasSizeFromControls()
      );
    });
    pickMaskInput.addEventListener('change', () => {
      switchRendererRuntimeOptions(
        currentPrecision,
        readScalingLimitPresetFromControls(),
        readPickMaskEnabledFromControls(),
        readTextureSamplingFromControls(),
        upScalingToPowerOfTwoInput.checked,
        readAtlasSizeFromControls()
      );
    });
    scalingLimitPresetSelect.addEventListener('change', () => {
      switchRendererRuntimeOptions(
        currentPrecision,
        readScalingLimitPresetFromControls(),
        readPickMaskEnabledFromControls(),
        readTextureSamplingFromControls(),
        upScalingToPowerOfTwoInput.checked,
        readAtlasSizeFromControls()
      );
    });
    runtimeTextureSamplingSelects.forEach((select) => {
      select.addEventListener('change', () => {
        switchRendererRuntimeOptions(
          currentPrecision,
          readScalingLimitPresetFromControls(),
          readPickMaskEnabledFromControls(),
          readTextureSamplingFromControls(),
          upScalingToPowerOfTwoInput.checked,
          readAtlasSizeFromControls()
        );
      });
    });
    upScalingToPowerOfTwoInput.addEventListener('change', () => {
      switchRendererRuntimeOptions(
        currentPrecision,
        readScalingLimitPresetFromControls(),
        readPickMaskEnabledFromControls(),
        readTextureSamplingFromControls(),
        upScalingToPowerOfTwoInput.checked,
        readAtlasSizeFromControls()
      );
    });
    atlasWidthInput.addEventListener('change', () => {
      switchRendererRuntimeOptions(
        currentPrecision,
        readScalingLimitPresetFromControls(),
        readPickMaskEnabledFromControls(),
        readTextureSamplingFromControls(),
        upScalingToPowerOfTwoInput.checked,
        readAtlasSizeFromControls()
      );
    });
    atlasHeightInput.addEventListener('change', () => {
      switchRendererRuntimeOptions(
        currentPrecision,
        readScalingLimitPresetFromControls(),
        readPickMaskEnabledFromControls(),
        readTextureSamplingFromControls(),
        upScalingToPowerOfTwoInput.checked,
        readAtlasSizeFromControls()
      );
    });

    await createRendererForRuntimeOptions(
      'f32',
      readScalingLimitPresetFromControls(),
      readPickMaskEnabledFromControls(),
      cloneTextureSampling(DEFAULT_TEXTURE_SAMPLING),
      true,
      readAtlasSizeFromControls()
    );

    window.addEventListener('beforeunload', () => {
      window.clearInterval(spriteTimer);
      window.clearInterval(statsTimer);
      if (stopRenderer) {
        stopRenderer();
        stopRenderer = null;
      }
      if (renderer) {
        renderer.release();
        renderer = null;
      }
      if (backdropImageSource) {
        backdropImageSource.bitmap.close();
        backdropImageSource = null;
      }
      clearStatsOutputs();
    });
  } catch (error) {
    console.error('Failed to initialize application:', error);
  }
});
