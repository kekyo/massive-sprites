// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  SpriteTextGlyphDimensions,
  SpriteTextGlyphOptions,
} from 'massive-sprites';

const LABEL_BORDER_WIDTH_PIXEL = 30;
const LABEL_PADDING_PIXEL = 50;
const LABEL_LINE_HEIGHT_PIXEL = 190;

export type LabelGlyphSpec = {
  readonly dimensions: SpriteTextGlyphDimensions;
  readonly options: SpriteTextGlyphOptions;
};

const LABEL_BASE_OPTIONS: SpriteTextGlyphOptions = {
  fontFamily: 'sans-serif',
  fontWeight: '400',
  color: '#ffffff',
  backgroundColor: '#3a3a3a',
  borderColor: '#55b022',
  borderWidthPixel: LABEL_BORDER_WIDTH_PIXEL,
  borderSides: ['top', 'bottom'],
  textAlign: 'center',
  paddingPixel: LABEL_PADDING_PIXEL,
};

export const buildLabelGlyphSpec = (): LabelGlyphSpec => {
  return {
    dimensions: { lineHeightPixel: LABEL_LINE_HEIGHT_PIXEL },
    options: LABEL_BASE_OPTIONS,
  };
};
