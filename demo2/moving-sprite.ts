// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  ColorRGBA,
  SpritePlacement,
  SpriteTextGlyphDimensions,
  SpriteTextGlyphOptions,
  ObjectRendererCommon,
} from 'massive-sprites';

///////////////////////////////////////////////////////////////////////////////////

const LABEL_BORDER_WIDTH_PIXEL = 10;
const LABEL_PADDING_PIXEL = 20;
const LABEL_LINE_HEIGHT_PIXEL = 70;
const CAR_SPRITE_SCALE = 0.1;
const CAR_LABEL_SCALE = 0.1;
const CAR_LABEL_SHIFT_DISTANCE = 30;
const CAR_LABEL_SHIFT_ANGLE_DEG = 225;
const CAR_LABEL_LEADERLINE_WIDTH = 1;
const CAR_AUTO_FLIP_INTERPOLATION_DURATION_MS = 500;
const CAR_SHIFT_ANGLE_INTERPOLATION_DURATION_MS = 500;

///////////////////////////////////////////////////////////////////////////////////

type LabelGlyphSpec = {
  readonly dimensions: SpriteTextGlyphDimensions;
  readonly options: SpriteTextGlyphOptions;
};

const LABEL_BASE_OPTIONS: SpriteTextGlyphOptions = {
  fontFamily: 'sans-serif',
  fontWeight: '400',
  color: '#ffffff',
  backgroundColor: '#3a3a3a',
  borderWidthPixel: LABEL_BORDER_WIDTH_PIXEL,
  borderSides: ['top', 'bottom'],
  textAlign: 'center',
  paddingPixel: LABEL_PADDING_PIXEL,
};

const buildLabelGlyphSpec = (borderColor: string): LabelGlyphSpec => {
  return {
    dimensions: { lineHeightPixel: LABEL_LINE_HEIGHT_PIXEL },
    options: {
      ...LABEL_BASE_OPTIONS,
      borderColor,
    },
  };
};

const labelImageIds = new Set<string>();

const ensureCarLabelImage = async (
  renderer: ObjectRendererCommon,
  labelAtlasId: number,
  labelText: string,
  labelColor: ColorRGBA
) => {
  const normalizedColor = labelColor.replace('#', '');
  const labelId = `label-${labelText}-${normalizedColor}`;
  if (labelImageIds.has(labelId)) {
    return labelId;
  }
  labelImageIds.add(labelId);
  const labelGlyphSpec = buildLabelGlyphSpec(labelColor);
  try {
    await renderer.registerTextGlyph(
      labelAtlasId,
      labelId,
      labelText,
      labelGlyphSpec.dimensions,
      labelGlyphSpec.options
    );
    return labelId;
  } catch (error) {
    labelImageIds.delete(labelId);
    throw error;
  }
};

export type MovingSpriteData = {
  readonly carLabel: string;
  readonly imageId: string;
  readonly labelId: string;
  readonly labelColor: ColorRGBA;
};

let movingCarId = 0;
export const createMovingSpriteData = async (
  renderer: ObjectRendererCommon,
  labelAtlasId: number,
  imageId: string,
  labelColor: ColorRGBA
): Promise<MovingSpriteData> => {
  const carLabel = `Car-${movingCarId++}`;
  const labelId = await ensureCarLabelImage(
    renderer,
    labelAtlasId,
    carLabel,
    labelColor
  );
  return {
    carLabel,
    imageId,
    labelId,
    labelColor,
  };
};

export const buildMovingSpritePlacement = (
  data: MovingSpriteData,
  layer: number,
  initialX: number,
  initialY: number
): SpritePlacement => ({
  sx: { value: initialX },
  sy: { value: initialY },
  elements: [
    {
      imageId: data.imageId,
      layer,
      scale: { value: CAR_SPRITE_SCALE },
      anchorY: { value: -0.8 },
      mode: 'billboard',
      autoDirection: {
        space: 'world',
        mode: {
          type: 'flipping',
          flipX: true,
          flipY: false,
          interpolation: {
            mode: 'feedback',
            durationMs: CAR_AUTO_FLIP_INTERPOLATION_DURATION_MS,
            easing: { type: 'sigmoid', k: 14, mid: 0.35 },
          },
        },
        minDistance: 0,
      },
    },
    {
      imageId: data.labelId,
      layer,
      mode: 'billboard',
      originLocation: { index: 0 },
      scale: { value: CAR_LABEL_SCALE },
      shiftDistance: { value: CAR_LABEL_SHIFT_DISTANCE },
      shiftAngleDeg: {
        value: CAR_LABEL_SHIFT_ANGLE_DEG,
        interpolation: {
          mode: 'feedback',
          durationMs: CAR_SHIFT_ANGLE_INTERPOLATION_DURATION_MS,
          easing: { type: 'linear' },
        },
      },
      autoDirection: {
        space: 'world',
        shiftAngleRotation: true,
        minDistance: 0,
      },
      leaderline: {
        width: { value: CAR_LABEL_LEADERLINE_WIDTH },
        color: data.labelColor,
      },
    },
  ],
});
