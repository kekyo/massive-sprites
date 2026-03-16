// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  SizeInPixel,
  SpriteTextGlyphBorderSide,
  SpriteTextGlyphDimensions,
  SpriteTextGlyphHorizontalAlign,
  SpriteTextGlyphOptions,
  SpriteTextGlyphPaddingPixel,
} from './types';

///////////////////////////////////////////////////////////////////////////////////

const DEFAULT_TEXT_GLYPH_FONT_FAMILY = 'sans-serif';
const DEFAULT_TEXT_GLYPH_FONT_STYLE: 'normal' | 'italic' = 'normal';
const DEFAULT_TEXT_GLYPH_FONT_WEIGHT = 'normal';
const DEFAULT_TEXT_GLYPH_COLOR = '#000000';
const DEFAULT_TEXT_GLYPH_ALIGN: SpriteTextGlyphHorizontalAlign = 'center';
const DEFAULT_TEXT_GLYPH_FONT_SIZE = 32;
const DEFAULT_TEXT_GLYPH_RENDER_PIXEL_RATIO = 1;
const MAX_TEXT_GLYPH_RENDER_PIXEL_RATIO = 4;
const MIN_TEXT_GLYPH_FONT_SIZE = 4;

/**
 * Supported 2D rendering contexts used for glyph rasterization.
 */
export type Canvas2DContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;
/**
 * Canvas sources returned by glyph rasterization helpers.
 */
export type Canvas2DSource = OffscreenCanvas | HTMLCanvasElement;

interface ResolvedTextGlyphPadding {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

interface ResolvedBorderSides {
  readonly top: boolean;
  readonly right: boolean;
  readonly bottom: boolean;
  readonly left: boolean;
}

interface ResolvedTextGlyphOptions {
  readonly fontFamily: string;
  readonly fontStyle: 'normal' | 'italic';
  readonly fontWeight: string;
  readonly fontSizePixel: number;
  readonly color: string;
  readonly letterSpacingPixel: number;
  readonly backgroundColor: string | null;
  readonly paddingPixel: ResolvedTextGlyphPadding;
  readonly borderColor: string | null;
  readonly borderWidthPixel: number;
  readonly borderRadiusPixel: number;
  readonly borderSides: ResolvedBorderSides;
  readonly textAlign: SpriteTextGlyphHorizontalAlign;
  readonly renderPixelRatio: number;
}

/**
 * Rendered text glyph source and its logical/upload sizes.
 * @typeParam SourceType - Backing image source type.
 */
export interface TextGlyphRenderResult<
  SourceType extends TexImageSource = TexImageSource,
> {
  /** Image source that can be uploaded to WebGL. */
  readonly source: SourceType;
  /** Logical size used by the sprite layout system. */
  readonly logicalSize: SizeInPixel;
  /** Actual pixel size of the upload source. */
  readonly uploadSize: SizeInPixel;
}

/**
 * Text glyph render result backed by a canvas source.
 */
export type TextGlyphCanvasRenderResult = TextGlyphRenderResult<Canvas2DSource>;

/**
 * Request payload sent to the text glyph worker.
 */
export interface TextGlyphWorkerRequest {
  /** Monotonic request id used to match responses. */
  readonly requestId: number;
  /** Text content to render. */
  readonly text: string;
  /** Glyph sizing constraint. */
  readonly dimensions: SpriteTextGlyphDimensions;
  /** Optional visual styling. */
  readonly options: SpriteTextGlyphOptions | undefined;
}

/**
 * Successful response from the text glyph worker.
 */
export interface TextGlyphWorkerSuccessResponse {
  /** Discriminant for successful responses. */
  readonly type: 'success';
  /** Request id associated with the response. */
  readonly requestId: number;
  /** Rendered bitmap ready for upload. */
  readonly bitmap: ImageBitmap;
  /** Logical size used by the sprite layout system. */
  readonly logicalSize: SizeInPixel;
  /** Actual bitmap size used for upload. */
  readonly uploadSize: SizeInPixel;
}

/**
 * Error response from the text glyph worker.
 */
export interface TextGlyphWorkerErrorResponse {
  /** Discriminant for error responses. */
  readonly type: 'error';
  /** Request id associated with the response. */
  readonly requestId: number;
  /** Error message describing the failure. */
  readonly message: string;
}

/**
 * Response payload produced by the text glyph worker.
 */
export type TextGlyphWorkerResponse =
  | TextGlyphWorkerSuccessResponse
  | TextGlyphWorkerErrorResponse;

///////////////////////////////////////////////////////////////////////////////////

const resolveTextGlyphPadding = (
  padding: SpriteTextGlyphPaddingPixel | undefined
): ResolvedTextGlyphPadding => {
  if (typeof padding === 'number' && Number.isFinite(padding)) {
    const safeValue = Math.max(0, padding);
    return {
      top: safeValue,
      right: safeValue,
      bottom: safeValue,
      left: safeValue,
    };
  }

  if (typeof padding === 'object' && padding !== null) {
    const safe = (value: number | undefined): number =>
      typeof value === 'number' && Number.isFinite(value) && value >= 0
        ? value
        : 0;

    return {
      top: safe(padding.top),
      right: safe(padding.right),
      bottom: safe(padding.bottom),
      left: safe(padding.left),
    };
  }

  return { top: 0, right: 0, bottom: 0, left: 0 };
};

const resolveBorderSides = (
  sides: readonly SpriteTextGlyphBorderSide[] | undefined
): ResolvedBorderSides => {
  if (!Array.isArray(sides) || sides.length === 0) {
    return { top: true, right: true, bottom: true, left: true };
  }

  let top = false;
  let right = false;
  let bottom = false;
  let left = false;

  for (const side of sides) {
    switch (side) {
      case 'top':
        top = true;
        break;
      case 'right':
        right = true;
        break;
      case 'bottom':
        bottom = true;
        break;
      case 'left':
        left = true;
        break;
      default:
        break;
    }
  }

  if (!top && !right && !bottom && !left) {
    return { top: true, right: true, bottom: true, left: true };
  }

  return { top, right, bottom, left };
};

const resolveTextAlign = (
  align: SpriteTextGlyphHorizontalAlign | undefined
): SpriteTextGlyphHorizontalAlign => {
  switch (align) {
    case 'left':
    case 'right':
      return align;
    case 'center':
    default:
      return DEFAULT_TEXT_GLYPH_ALIGN;
  }
};

const resolveFontStyle = (
  style: 'normal' | 'italic' | undefined
): 'normal' | 'italic' =>
  style === 'italic' ? 'italic' : DEFAULT_TEXT_GLYPH_FONT_STYLE;

const resolvePositiveFinite = (value: number | undefined, fallback: number) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return value > 0 ? value : fallback;
};

const resolveNonNegativeFinite = (
  value: number | undefined,
  fallback: number
) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return fallback;
  }
  return value >= 0 ? value : fallback;
};

const resolveFiniteOrDefault = (
  value: number | undefined,
  fallback: number
): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;

const resolveRenderPixelRatio = (value: number | undefined): number => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_TEXT_GLYPH_RENDER_PIXEL_RATIO;
  }
  return Math.min(
    Math.max(value, DEFAULT_TEXT_GLYPH_RENDER_PIXEL_RATIO),
    MAX_TEXT_GLYPH_RENDER_PIXEL_RATIO
  );
};

const drawRoundedRectPath = (
  ctx: Canvas2DContext,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  const maxRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  if (maxRadius === 0) {
    ctx.rect(x, y, width, height);
    return;
  }

  ctx.moveTo(x + maxRadius, y);
  ctx.lineTo(x + width - maxRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + maxRadius);
  ctx.lineTo(x + width, y + height - maxRadius);
  ctx.quadraticCurveTo(
    x + width,
    y + height,
    x + width - maxRadius,
    y + height
  );
  ctx.lineTo(x + maxRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - maxRadius);
  ctx.lineTo(x, y + maxRadius);
  ctx.quadraticCurveTo(x, y, x + maxRadius, y);
};

const fillRoundedRect = (
  ctx: Canvas2DContext,
  width: number,
  height: number,
  radius: number,
  color: string
) => {
  ctx.save();
  ctx.beginPath();
  drawRoundedRectPath(ctx, 0, 0, width, height, radius);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
};

const strokeRoundedRect = (
  ctx: Canvas2DContext,
  width: number,
  height: number,
  radius: number,
  color: string,
  lineWidth: number,
  sides: ResolvedBorderSides
) => {
  const { top, right, bottom, left } = sides;
  if (lineWidth <= 0 || (!top && !right && !bottom && !left)) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;

  const cornerRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  const previousCap = ctx.lineCap;
  ctx.lineCap = cornerRadius === 0 ? 'square' : 'butt';

  if (top) {
    const startX = cornerRadius;
    const endX = width - cornerRadius;
    if (endX > startX) {
      ctx.beginPath();
      ctx.moveTo(startX, 0);
      ctx.lineTo(endX, 0);
      ctx.stroke();
    }
  }

  if (right) {
    const startY = cornerRadius;
    const endY = height - cornerRadius;
    if (endY > startY) {
      ctx.beginPath();
      ctx.moveTo(width, startY);
      ctx.lineTo(width, endY);
      ctx.stroke();
    }
  }

  if (bottom) {
    const startX = width - cornerRadius;
    const endX = cornerRadius;
    if (startX > endX) {
      ctx.beginPath();
      ctx.moveTo(startX, height);
      ctx.lineTo(endX, height);
      ctx.stroke();
    }
  }

  if (left) {
    const startY = height - cornerRadius;
    const endY = cornerRadius;
    if (startY > endY) {
      ctx.beginPath();
      ctx.moveTo(0, startY);
      ctx.lineTo(0, endY);
      ctx.stroke();
    }
  }

  ctx.lineCap = previousCap;
  ctx.restore();
};

const measureTextWidthWithSpacing = (
  ctx: Canvas2DContext,
  text: string,
  letterSpacing: number
): number => {
  if (text.length === 0) {
    return 0;
  }
  if (letterSpacing === 0) {
    return ctx.measureText(text).width;
  }

  const glyphs = Array.from(text);
  let total = 0;
  for (const glyph of glyphs) {
    total += ctx.measureText(glyph).width;
  }
  return total + letterSpacing * Math.max(0, glyphs.length - 1);
};

const measureTextHeight = (
  ctx: Canvas2DContext,
  text: string,
  fontSize: number
): number => {
  const metrics = ctx.measureText(text);
  const fallbackAscent = fontSize * 0.8;
  const fallbackDescent = fontSize * 0.2;
  const ascent = Number.isFinite(metrics.actualBoundingBoxAscent)
    ? metrics.actualBoundingBoxAscent
    : fallbackAscent;
  const descent = Number.isFinite(metrics.actualBoundingBoxDescent)
    ? metrics.actualBoundingBoxDescent
    : fallbackDescent;
  const height = ascent + descent;
  if (Number.isFinite(height) && height > 0) {
    return height;
  }
  return Math.max(fontSize, 1);
};

const drawTextWithLetterSpacing = (
  ctx: Canvas2DContext,
  text: string,
  startX: number,
  y: number,
  letterSpacing: number
) => {
  if (text.length === 0) {
    return;
  }
  if (letterSpacing === 0) {
    ctx.fillText(text, startX, y);
    return;
  }

  const glyphs = Array.from(text);
  let cursorX = startX;
  for (const glyph of glyphs) {
    ctx.fillText(glyph, cursorX, y);
    cursorX += ctx.measureText(glyph).width + letterSpacing;
  }
};

const resolveTextGlyphOptions = (
  options: SpriteTextGlyphOptions | undefined,
  preferredLineHeight: number | undefined
): ResolvedTextGlyphOptions => {
  const fallbackFontSize =
    typeof preferredLineHeight === 'number' && preferredLineHeight > 0
      ? preferredLineHeight
      : DEFAULT_TEXT_GLYPH_FONT_SIZE;

  const resolvedFontSize = resolvePositiveFinite(
    options?.fontSizePixelHint,
    fallbackFontSize
  );

  return {
    fontFamily: options?.fontFamily ?? DEFAULT_TEXT_GLYPH_FONT_FAMILY,
    fontStyle: resolveFontStyle(options?.fontStyle),
    fontWeight: options?.fontWeight ?? DEFAULT_TEXT_GLYPH_FONT_WEIGHT,
    fontSizePixel: resolvedFontSize,
    color: options?.color ?? DEFAULT_TEXT_GLYPH_COLOR,
    letterSpacingPixel: resolveFiniteOrDefault(options?.letterSpacingPixel, 0),
    backgroundColor: options?.backgroundColor ?? null,
    paddingPixel: resolveTextGlyphPadding(options?.paddingPixel),
    borderColor: options?.borderColor ?? null,
    borderWidthPixel: resolveNonNegativeFinite(options?.borderWidthPixel, 0),
    borderRadiusPixel: resolveNonNegativeFinite(options?.borderRadiusPixel, 0),
    borderSides: resolveBorderSides(options?.borderSides),
    textAlign: resolveTextAlign(options?.textAlign),
    renderPixelRatio: resolveRenderPixelRatio(options?.renderPixelRatio),
  };
};

const clampGlyphDimension = (value: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1;
  }
  const rounded = Math.round(value);
  return rounded > 0 ? rounded : 1;
};

/**
 * Creates a default 2D canvas source for text glyph rasterization.
 * @param width - Canvas width in pixels.
 * @param height - Canvas height in pixels.
 * @returns Canvas source and 2D context.
 */
export const createDefaultCanvas2D = (
  width: number,
  height: number
): { canvas: Canvas2DSource; ctx: Canvas2DContext } => {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to acquire 2d context for text glyph rendering.');
    }
    return { canvas, ctx };
  }

  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to acquire 2d context for text glyph rendering.');
    }
    return { canvas, ctx };
  }

  throw new Error('Canvas 2D is not supported in this environment.');
};

const flipCanvasVertically = (
  source: Canvas2DSource,
  width: number,
  height: number
): Canvas2DSource => {
  const { canvas, ctx } = createDefaultCanvas2D(width, height);
  ctx.save();
  ctx.translate(0, height);
  ctx.scale(1, -1);
  ctx.drawImage(source as CanvasImageSource, 0, 0, width, height);
  ctx.restore();
  return canvas;
};

const buildFontString = (options: ResolvedTextGlyphOptions): string =>
  `${options.fontStyle} ${options.fontWeight} ${options.fontSizePixel}px ${options.fontFamily}`;

///////////////////////////////////////////////////////////////////////////////////

/**
 * Renders text into a canvas source for later texture upload.
 * @param text - Text content to render.
 * @param dimensions - Glyph sizing constraint.
 * @param options - Optional visual styling.
 * @param flipForUpload - Whether to vertically flip the canvas for WebGL upload.
 * @returns Rendered text glyph source and size metadata.
 */
export const renderTextGlyphCanvasSource = (
  text: string,
  dimensions: SpriteTextGlyphDimensions,
  options: SpriteTextGlyphOptions | undefined,
  flipForUpload: boolean
): TextGlyphCanvasRenderResult => {
  let lineHeight: number | undefined;
  let maxWidth: number | undefined;
  const isLineHeightMode = 'lineHeightPixel' in dimensions;
  if (isLineHeightMode) {
    lineHeight = clampGlyphDimension(dimensions.lineHeightPixel);
  } else {
    maxWidth = clampGlyphDimension(dimensions.maxWidthPixel);
  }

  const resolved = resolveTextGlyphOptions(options, lineHeight);
  let fontSize = resolved.fontSizePixel;

  const { ctx: measureCtx } = createDefaultCanvas2D(1, 1);
  const applyFontSize = (ctx: Canvas2DContext, size: number) => {
    ctx.font = buildFontString({ ...resolved, fontSizePixel: size });
  };
  applyFontSize(measureCtx, fontSize);
  measureCtx.textBaseline = 'alphabetic';

  const letterSpacing = resolved.letterSpacingPixel;
  let measuredWidth = measureTextWidthWithSpacing(
    measureCtx,
    text,
    letterSpacing
  );

  let contentWidthLimit: number | undefined;
  if (!isLineHeightMode && typeof maxWidth === 'number') {
    const padding = resolved.paddingPixel;
    const borderWidth = resolved.borderWidthPixel;
    const glyphCount = Array.from(text).length;
    const letterSpacingTotal = letterSpacing * Math.max(glyphCount - 1, 0);

    contentWidthLimit = Math.max(
      1,
      maxWidth - borderWidth - padding.left - padding.right
    );
    if (contentWidthLimit < letterSpacingTotal) {
      contentWidthLimit = letterSpacingTotal;
    }

    if (text.length > 0 && measuredWidth > contentWidthLimit) {
      const initialRatio = contentWidthLimit / measuredWidth;
      fontSize = Math.max(
        MIN_TEXT_GLYPH_FONT_SIZE,
        Math.floor(fontSize * initialRatio)
      );
      applyFontSize(measureCtx, fontSize);
      measuredWidth = measureTextWidthWithSpacing(
        measureCtx,
        text,
        letterSpacing
      );

      let guard = 0;
      while (
        measuredWidth > contentWidthLimit &&
        fontSize > MIN_TEXT_GLYPH_FONT_SIZE &&
        guard < 12
      ) {
        const ratio = contentWidthLimit / measuredWidth;
        const nextFontSize = Math.max(
          MIN_TEXT_GLYPH_FONT_SIZE,
          Math.floor(fontSize * Math.max(ratio, 0.75))
        );
        if (nextFontSize === fontSize) {
          fontSize = Math.max(MIN_TEXT_GLYPH_FONT_SIZE, fontSize - 1);
        } else {
          fontSize = nextFontSize;
        }
        applyFontSize(measureCtx, fontSize);
        measuredWidth = measureTextWidthWithSpacing(
          measureCtx,
          text,
          letterSpacing
        );
        guard += 1;
      }
    }
  }

  applyFontSize(measureCtx, fontSize);
  measuredWidth = measureTextWidthWithSpacing(measureCtx, text, letterSpacing);
  const measuredHeight = measureTextHeight(measureCtx, text, fontSize);

  const paddingPixel = resolved.paddingPixel;
  const borderWidthPixel = resolved.borderWidthPixel;

  const contentHeight = isLineHeightMode
    ? lineHeight!
    : clampGlyphDimension(Math.ceil(measuredHeight));

  const totalWidth = clampGlyphDimension(
    Math.ceil(
      borderWidthPixel + paddingPixel.left + paddingPixel.right + measuredWidth
    )
  );
  const totalHeight = clampGlyphDimension(
    Math.ceil(
      borderWidthPixel + paddingPixel.top + paddingPixel.bottom + contentHeight
    )
  );

  const renderPixelRatio = resolved.renderPixelRatio;
  const renderWidth = Math.max(1, Math.round(totalWidth * renderPixelRatio));
  const renderHeight = Math.max(1, Math.round(totalHeight * renderPixelRatio));

  const { canvas, ctx } = createDefaultCanvas2D(renderWidth, renderHeight);
  ctx.clearRect(0, 0, renderWidth, renderHeight);
  ctx.save();
  if (renderPixelRatio !== 1) {
    ctx.scale(renderPixelRatio, renderPixelRatio);
  }
  ctx.imageSmoothingEnabled = true;

  if (resolved.backgroundColor) {
    fillRoundedRect(
      ctx,
      totalWidth,
      totalHeight,
      resolved.borderRadiusPixel,
      resolved.backgroundColor
    );
  }

  if (resolved.borderColor && borderWidthPixel > 0) {
    const inset = borderWidthPixel / 2;
    const strokeWidth = Math.max(0, totalWidth - borderWidthPixel);
    const strokeHeight = Math.max(0, totalHeight - borderWidthPixel);
    const strokeRadius = Math.max(0, resolved.borderRadiusPixel - inset);
    ctx.save();
    ctx.translate(inset, inset);
    strokeRoundedRect(
      ctx,
      strokeWidth,
      strokeHeight,
      strokeRadius,
      resolved.borderColor,
      borderWidthPixel,
      resolved.borderSides
    );
    ctx.restore();
  }

  const borderInset = borderWidthPixel / 2;
  const contentWidth = Math.max(
    0,
    totalWidth - borderWidthPixel - paddingPixel.left - paddingPixel.right
  );
  const contentHeightInner = Math.max(
    0,
    totalHeight - borderWidthPixel - paddingPixel.top - paddingPixel.bottom
  );
  const contentLeft = borderInset + paddingPixel.left;
  const contentTop = borderInset + paddingPixel.top;
  const textY = contentTop + contentHeightInner / 2;

  const renderOptions = { ...resolved, fontSizePixel: fontSize };
  ctx.font = buildFontString(renderOptions);
  ctx.fillStyle = resolved.color;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  const totalTextWidth = measureTextWidthWithSpacing(ctx, text, letterSpacing);

  let textStartX = contentLeft;
  switch (resolved.textAlign) {
    case 'right':
      textStartX = contentLeft + (contentWidth - totalTextWidth);
      break;
    case 'center':
      textStartX = contentLeft + (contentWidth - totalTextWidth) / 2;
      break;
    case 'left':
    default:
      textStartX = contentLeft;
      break;
  }

  drawTextWithLetterSpacing(ctx, text, textStartX, textY, letterSpacing);

  ctx.restore();

  const uploadSource = flipForUpload
    ? // Keep text glyphs aligned with texture uploads using UNPACK_FLIP_Y_WEBGL.
      flipCanvasVertically(canvas, renderWidth, renderHeight)
    : canvas;

  return {
    source: uploadSource,
    logicalSize: { widthPixel: totalWidth, heightPixel: totalHeight },
    uploadSize: { widthPixel: renderWidth, heightPixel: renderHeight },
  };
};
