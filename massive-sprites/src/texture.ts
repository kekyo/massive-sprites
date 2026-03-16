// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  SizeInPixel,
  SpriteAtlasOptions,
  SpriteAtlasPickMaskOptions,
  SpriteImageRegisterOptions,
  SpriteImageResizeOptions,
  SpriteImageResizeMode,
  SpriteImageResizeQuality,
  SpriteTextGlyphDimensions,
  SpriteTextGlyphOptions,
  SpriteTextureMagFilter,
  SpriteTextureMinFilter,
  SpriteTextureSamplingOptions,
  SpriteTextureWrapMode,
} from './types';
import { getNextPowerOfTwo, isPowerOfTwo } from './utils';
import { renderTextGlyphSource } from './text';

///////////////////////////////////////////////////////////////////////////////////

/**
 * High-quality texture sampling preset with mipmaps and anisotropy enabled.
 */
export const MAX_TEXTURE_SAMPLING_OPTIONS: SpriteTextureSamplingOptions = {
  minFilter: 'linearMipmapLinear',
  magFilter: 'linear',
  wrapS: 'clampToEdge',
  wrapT: 'clampToEdge',
  npotPolicy: 'fallback',
  maxAnisotropy: 16,
} as const;

/**
 * Lowest-cost texture sampling preset for pixelated rendering.
 */
export const MIN_TEXTURE_SAMPLING_OPTIONS: SpriteTextureSamplingOptions = {
  minFilter: 'nearest',
  magFilter: 'nearest',
  wrapS: 'clampToEdge',
  wrapT: 'clampToEdge',
  npotPolicy: 'fallback',
  maxAnisotropy: 1,
} as const;

/**
 * Balanced default texture sampling preset used by atlases when not overridden.
 */
export const DEFAULT_TEXTURE_SAMPLING_OPTIONS: SpriteTextureSamplingOptions = {
  minFilter: 'linear',
  magFilter: 'linear',
  wrapS: 'clampToEdge',
  wrapT: 'clampToEdge',
  npotPolicy: 'fallback',
  maxAnisotropy: 4,
} as const;

/**
 * Callback used to synchronize texture slot metadata with WASM state.
 * @param texIndex - Texture slot index.
 * @param width - Logical width of the registered image.
 * @param height - Logical height of the registered image.
 * @param valid - Whether the texture slot currently points at a valid atlas region.
 * @param pageId - Atlas page id.
 * @param u0 - Left UV coordinate.
 * @param v0 - Top UV coordinate.
 * @param u1 - Right UV coordinate.
 * @param v1 - Bottom UV coordinate.
 */
export type QueueSetTextureInfo = (
  texIndex: number,
  width: number,
  height: number,
  valid: boolean,
  pageId: number,
  u0: number,
  v0: number,
  u1: number,
  v1: number
) => void;

/**
 * Callback used to synchronize multi-tile texture metadata with WASM state.
 * @param texIndex - Texture slot index.
 * @param width - Logical width of the registered image.
 * @param height - Logical height of the registered image.
 * @param valid - Whether the texture slot currently points at valid tiles.
 * @param tileCount - Number of tiles backing the image.
 */
export type QueueSetTiledTextureInfo = (
  texIndex: number,
  width: number,
  height: number,
  valid: boolean,
  tileCount: number
) => void;

/**
 * Callback used to synchronize one tile region for a multi-tile texture slot.
 * @param texIndex - Texture slot index.
 * @param tileIndex - Tile index within the texture slot.
 * @param pageId - Backing texture page id.
 * @param u0 - Left UV coordinate.
 * @param v0 - Top UV coordinate.
 * @param u1 - Right UV coordinate.
 * @param v1 - Bottom UV coordinate.
 * @param leftRatio - Left edge within the full logical image, normalized to `[-0.5, 0.5]`.
 * @param topRatio - Top edge within the full logical image, normalized to `[-0.5, 0.5]`.
 * @param rightRatio - Right edge within the full logical image, normalized to `[-0.5, 0.5]`.
 * @param bottomRatio - Bottom edge within the full logical image, normalized to `[-0.5, 0.5]`.
 */
export type QueueSetTextureTileInfo = (
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
) => void;

/**
 * Texture atlas manager used by the renderer implementation.
 */
export interface TextureManager {
  /**
   * Attaches the WebGL context used for texture allocation and uploads.
   * @param gl - WebGL context.
   */
  readonly attachWebGL: (gl: WebGLRenderingContext) => void;
  /**
   * Allocates an atlas and returns its id.
   * @param options - Optional atlas configuration.
   * @returns Allocated atlas id.
   */
  readonly allocateAtlas: (options: SpriteAtlasOptions | undefined) => number;
  /**
   * Releases an atlas and all images registered into it.
   * @param atlasId - Atlas id.
   */
  readonly releaseAtlas: (atlasId: number) => void;
  /**
   * Registers an image and uploads it into an atlas.
   * @param atlasId - Target atlas id.
   * @param imageId - Unique image id.
   * @param imageSource - Image source to upload.
   * @param upScalingToPowerOfTwo - Whether the source may be resized to power-of-two dimensions.
   * @param options - Optional resize and logical-size settings.
   * @returns Uploaded logical image size.
   */
  readonly registerImage: (
    atlasId: number,
    imageId: string,
    imageSource: TexImageSource,
    upScalingToPowerOfTwo: boolean | undefined,
    options: SpriteImageRegisterOptions | undefined
  ) => Promise<SizeInPixel>;
  /**
   * Registers a rendered text glyph and uploads it into an atlas.
   * @param atlasId - Target atlas id.
   * @param imageId - Unique glyph id.
   * @param text - Text content to render.
   * @param dimensions - Glyph sizing constraint.
   * @param options - Optional visual styling.
   * @returns Uploaded logical glyph size.
   */
  readonly registerTextGlyph: (
    atlasId: number,
    imageId: string,
    text: string,
    dimensions: SpriteTextGlyphDimensions,
    options: SpriteTextGlyphOptions | undefined
  ) => Promise<SizeInPixel>;
  /**
   * Unregisters an image from its atlas page.
   * @param imageId - Image id to remove.
   */
  readonly unregisterImage: (imageId: string) => void;
  /**
   * Resolves the texture slot index for an image id.
   * @param imageId - Image id to inspect.
   * @returns Texture slot index, when registered.
   */
  readonly resolveTextureIndex: (imageId: string) => number | undefined;
  /**
   * Resolves the image id currently assigned to a texture slot.
   * @param texIndex - Texture slot index.
   * @returns Registered image id, when one exists.
   */
  readonly resolveImageIdByTexIndex: (texIndex: number) => string | undefined;
  /**
   * Resolves the logical image size stored for an image id.
   * @param imageId - Image id to inspect.
   * @returns Logical image size, when registered.
   */
  readonly resolveImageLogicalSizeById: (
    imageId: string
  ) => SizeInPixel | undefined;
  /**
   * Resolves the number of output quads produced by the texture slot.
   * @param texIndex - Texture slot index.
   * @returns Output quad count for the slot.
   */
  readonly resolveTextureOutputPartCountByTexIndex: (
    texIndex: number
  ) => number;
  /**
   * Resolves the WebGL texture object used by an atlas page id.
   * @param pageId - Atlas page id.
   * @returns WebGL texture object, when allocated.
   */
  readonly resolveTextureByPageId: (pageId: number) => WebGLTexture | undefined;
  /**
   * Generates mipmaps for the page when required.
   * @param pageId - Atlas page id.
   */
  readonly ensureMipmap: (pageId: number) => void;
  /** Releases all atlases, pages, and WebGL textures managed by the instance. */
  readonly release: () => void;
}

///////////////////////////////////////////////////////////////////////////////////

const DEFAULT_ATLAS_WIDTH_PIXEL = 2048;
const DEFAULT_ATLAS_HEIGHT_PIXEL = 2048;
const DEFAULT_ATLAS_PADDING_PIXEL = 2;
const DEFAULT_ATLAS_UV_INSET_PIXEL = 0.5;
const DEFAULT_IMAGE_RESIZE_MODE: SpriteImageResizeMode = 'contain';
const DEFAULT_IMAGE_RESIZE_QUALITY: SpriteImageResizeQuality = 'high';
const DEFAULT_PICK_MASK_ALPHA_THRESHOLD = 1;
const PICK_MASK_PAGE_OFFSET_WORDS = 0;
const PICK_MASK_PAGE_WORD_STRIDE = 1;
const PICK_MASK_PAGE_WIDTH_PIXEL = 2;
const PICK_MASK_PAGE_HEIGHT_PIXEL = 3;
const PICK_MASK_PAGE_FIELDS = 4;
const PICK_MASK_SIMD_WORDS = 4;

interface ResolvedAtlasPickMaskOptions {
  readonly alphaThreshold: number;
}

interface ImageResource {
  width: number;
  height: number;
  texIndex: number;
  atlasId: number;
  regions: ImageRegion[];
}

interface ImageRegion {
  pageId: number;
  page: TexturePage;
  allocRect: AtlasRect | null;
  imageRect: AtlasRect;
  uploadWidth: number;
  uploadHeight: number;
  uploadSource: TexImageSource;
  localLeftRatio: number;
  localTopRatio: number;
  localRightRatio: number;
  localBottomRatio: number;
}

interface AtlasRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TexturePage {
  id: number;
  atlasId: number;
  texture: WebGLTexture | null;
  width: number;
  height: number;
  freeRects: AtlasRect[] | null;
  allocatedCount: number;
  usesMipmap: boolean;
  mipmapDirty: boolean;
  pickMaskOffsetWords: number;
  pickMaskWordStride: number;
  pickMaskWordCount: number;
}

interface Atlas {
  id: number;
  width: number;
  height: number;
  padding: number;
  uvInset: number;
  maxPages: number | null;
  defaultImageResize: ResolvedImageResizeOptions | null;
  sampling: ResolvedTextureSamplingOptions;
  pickMask: ResolvedAtlasPickMaskOptions | null;
  pages: TexturePage[];
}

interface AtlasAllocation {
  page: TexturePage;
  rect: AtlasRect;
}

interface PickMaskWordSpan {
  offsetWords: number;
  wordCount: number;
}

interface TextureFilterAnisotropicExtension {
  readonly TEXTURE_MAX_ANISOTROPY_EXT: number;
  readonly MAX_TEXTURE_MAX_ANISOTROPY_EXT: number;
}

type ResolvedTextureSamplingOptions = Required<SpriteTextureSamplingOptions>;

interface ResolvedTextureParameters {
  readonly minFilter: SpriteTextureMinFilter;
  readonly magFilter: SpriteTextureMagFilter;
  readonly wrapS: SpriteTextureWrapMode;
  readonly wrapT: SpriteTextureWrapMode;
  readonly maxAnisotropy: number;
  readonly usesMipmap: boolean;
}

const getImageSize = (imageSource: TexImageSource): SizeInPixel => {
  const candidate = imageSource as {
    width?: number;
    height?: number;
    videoWidth?: number;
    videoHeight?: number;
    displayWidth?: number;
    displayHeight?: number;
  };
  return {
    widthPixel:
      candidate.width ?? candidate.videoWidth ?? candidate.displayWidth ?? 0,
    heightPixel:
      candidate.height ?? candidate.videoHeight ?? candidate.displayHeight ?? 0,
  };
};

const createResizedImageSource = (
  imageSource: TexImageSource,
  width: number,
  height: number,
  quality: SpriteImageResizeQuality
): TexImageSource => {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to create 2d rendering context.');
    }
    if ('imageSmoothingEnabled' in context) {
      context.imageSmoothingEnabled = true;
    }
    if ('imageSmoothingQuality' in context) {
      context.imageSmoothingQuality = quality;
    }
    // UNPACK_FLIP_Y_WEBGL related: Mirror Y-flip when resizing.
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(0, height);
    context.scale(1, -1);
    context.drawImage(imageSource as CanvasImageSource, 0, 0, width, height);
    context.restore();
    return canvas;
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to create 2d rendering context.');
    }
    if ('imageSmoothingEnabled' in context) {
      context.imageSmoothingEnabled = true;
    }
    if ('imageSmoothingQuality' in context) {
      context.imageSmoothingQuality = quality;
    }
    // UNPACK_FLIP_Y_WEBGL related: Mirror Y-flip when resizing.
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(0, height);
    context.scale(1, -1);
    context.drawImage(imageSource as CanvasImageSource, 0, 0, width, height);
    context.restore();
    return canvas;
  }
  throw new Error('Canvas is not available in this environment.');
};

const createCroppedImageSource = async (
  imageSource: TexImageSource,
  x: number,
  y: number,
  width: number,
  height: number
): Promise<TexImageSource> => {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(
        imageSource as CanvasImageSource,
        x,
        y,
        width,
        height
      );
    } catch {
      // Fall back to canvas extraction when the source type is unsupported.
    }
  }
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to create 2d rendering context.');
    }
    // UNPACK_FLIP_Y_WEBGL related: Mirror Y-flip when cropping into canvas.
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(0, height);
    context.scale(1, -1);
    context.drawImage(
      imageSource as CanvasImageSource,
      x,
      y,
      width,
      height,
      0,
      0,
      width,
      height
    );
    context.restore();
    return canvas;
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to create 2d rendering context.');
    }
    // UNPACK_FLIP_Y_WEBGL related: Mirror Y-flip when cropping into canvas.
    context.clearRect(0, 0, width, height);
    context.save();
    context.translate(0, height);
    context.scale(1, -1);
    context.drawImage(
      imageSource as CanvasImageSource,
      x,
      y,
      width,
      height,
      0,
      0,
      width,
      height
    );
    context.restore();
    return canvas;
  }
  throw new Error('Canvas is not available in this environment.');
};

const releaseUploadSource = (imageSource: TexImageSource) => {
  const candidate = imageSource as { close?: () => void };
  if (typeof candidate.close === 'function') {
    candidate.close();
  }
};

const resolvePickMaskWordStride = (widthPixel: number) => {
  const wordsPerRow = Math.max(1, Math.ceil(Math.max(0, widthPixel) / 32));
  return Math.max(
    PICK_MASK_SIMD_WORDS,
    Math.ceil(wordsPerRow / PICK_MASK_SIMD_WORDS) * PICK_MASK_SIMD_WORDS
  );
};

const createMaskCanvas2D = (width: number, height: number) => {
  if (typeof OffscreenCanvas === 'function') {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to create 2d rendering context.');
    }
    return context;
  }
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) {
      throw new Error('Failed to create 2d rendering context.');
    }
    return context;
  }
  throw new Error('Canvas is not available in this environment.');
};

const resolveImageSourceRgba = (
  imageSource: TexImageSource,
  width: number,
  height: number
) => {
  const rawSource = imageSource as {
    width?: number;
    height?: number;
    data?: Uint8ClampedArray | Uint8Array;
  };
  if (
    rawSource.width === width &&
    rawSource.height === height &&
    rawSource.data instanceof Uint8ClampedArray &&
    rawSource.data.length >= width * height * 4
  ) {
    return rawSource.data;
  }
  if (
    rawSource.width === width &&
    rawSource.height === height &&
    rawSource.data instanceof Uint8Array &&
    rawSource.data.length >= width * height * 4
  ) {
    return new Uint8ClampedArray(
      rawSource.data.buffer,
      rawSource.data.byteOffset,
      width * height * 4
    );
  }
  const context = createMaskCanvas2D(width, height);
  context.clearRect(0, 0, width, height);
  context.drawImage(imageSource as CanvasImageSource, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
};

const normalizeTextureSamplingOptions = (
  options: SpriteTextureSamplingOptions | undefined
): ResolvedTextureSamplingOptions => {
  const maxAnisotropy = options?.maxAnisotropy;
  return {
    minFilter:
      options?.minFilter ?? DEFAULT_TEXTURE_SAMPLING_OPTIONS.minFilter!,
    magFilter:
      options?.magFilter ?? DEFAULT_TEXTURE_SAMPLING_OPTIONS.magFilter!,
    wrapS: options?.wrapS ?? DEFAULT_TEXTURE_SAMPLING_OPTIONS.wrapS!,
    wrapT: options?.wrapT ?? DEFAULT_TEXTURE_SAMPLING_OPTIONS.wrapT!,
    npotPolicy:
      options?.npotPolicy ?? DEFAULT_TEXTURE_SAMPLING_OPTIONS.npotPolicy!,
    maxAnisotropy:
      typeof maxAnisotropy === 'number' &&
      Number.isFinite(maxAnisotropy) &&
      maxAnisotropy >= 1
        ? maxAnisotropy
        : DEFAULT_TEXTURE_SAMPLING_OPTIONS.maxAnisotropy!,
  };
};

interface ResolvedImageResizeOptions {
  readonly maxWidth: number | null;
  readonly maxHeight: number | null;
  readonly mode: SpriteImageResizeMode;
  readonly allowUpscale: boolean;
  readonly quality: SpriteImageResizeQuality;
}

const normalizeImageResizeOptions = (
  options: SpriteImageResizeOptions | null | undefined
): ResolvedImageResizeOptions | null => {
  if (!options) {
    return null;
  }
  const maxWidthRaw = options.maxWidth ?? null;
  const maxHeightRaw = options.maxHeight ?? null;
  const maxWidth =
    typeof maxWidthRaw === 'number' &&
    Number.isFinite(maxWidthRaw) &&
    maxWidthRaw > 0
      ? Math.floor(maxWidthRaw)
      : null;
  const maxHeight =
    typeof maxHeightRaw === 'number' &&
    Number.isFinite(maxHeightRaw) &&
    maxHeightRaw > 0
      ? Math.floor(maxHeightRaw)
      : null;
  let mode = options.mode ?? DEFAULT_IMAGE_RESIZE_MODE;
  if (mode !== 'contain' && mode !== 'cover' && mode !== 'stretch') {
    mode = DEFAULT_IMAGE_RESIZE_MODE;
  }
  const allowUpscale = options.allowUpscale === true;
  let quality = options.quality ?? DEFAULT_IMAGE_RESIZE_QUALITY;
  if (quality !== 'low' && quality !== 'medium' && quality !== 'high') {
    quality = DEFAULT_IMAGE_RESIZE_QUALITY;
  }
  return {
    maxWidth,
    maxHeight,
    mode,
    allowUpscale,
    quality,
  };
};

const resolveResizeTargetSize = (
  sourceWidth: number,
  sourceHeight: number,
  resize: ResolvedImageResizeOptions | null
) => {
  if (!resize) {
    return { widthPixel: sourceWidth, heightPixel: sourceHeight };
  }
  const { maxWidth, maxHeight, mode, allowUpscale } = resize;
  const hasWidthLimit = maxWidth !== null;
  const hasHeightLimit = maxHeight !== null;
  if (!hasWidthLimit && !hasHeightLimit) {
    return { widthPixel: sourceWidth, heightPixel: sourceHeight };
  }
  let targetWidth = sourceWidth;
  let targetHeight = sourceHeight;
  if (mode === 'stretch') {
    if (hasWidthLimit) {
      targetWidth = maxWidth as number;
    }
    if (hasHeightLimit) {
      targetHeight = maxHeight as number;
    }
    if (!allowUpscale) {
      targetWidth = Math.min(targetWidth, sourceWidth);
      targetHeight = Math.min(targetHeight, sourceHeight);
    }
  } else {
    const scaleX = hasWidthLimit
      ? (maxWidth as number) / sourceWidth
      : Number.POSITIVE_INFINITY;
    const scaleY = hasHeightLimit
      ? (maxHeight as number) / sourceHeight
      : Number.POSITIVE_INFINITY;
    let scale = 1;
    if (hasWidthLimit && hasHeightLimit) {
      scale =
        mode === 'cover' ? Math.max(scaleX, scaleY) : Math.min(scaleX, scaleY);
    } else if (hasWidthLimit) {
      scale = scaleX;
    } else {
      scale = scaleY;
    }
    if (!allowUpscale) {
      scale = Math.min(scale, 1);
    }
    targetWidth = Math.max(1, Math.floor(sourceWidth * scale));
    targetHeight = Math.max(1, Math.floor(sourceHeight * scale));
  }
  return { widthPixel: targetWidth, heightPixel: targetHeight };
};

const normalizeAtlasPickMaskOptions = (
  options: SpriteAtlasPickMaskOptions | undefined
): ResolvedAtlasPickMaskOptions | null => {
  if (!options || options.enabled === false) {
    return null;
  }
  const alphaThresholdRaw =
    options.alphaThreshold ?? DEFAULT_PICK_MASK_ALPHA_THRESHOLD;
  const alphaThreshold = Number.isFinite(alphaThresholdRaw)
    ? Math.max(0, Math.min(255, Math.floor(alphaThresholdRaw)))
    : DEFAULT_PICK_MASK_ALPHA_THRESHOLD;
  return { alphaThreshold };
};

const normalizeAtlasOptions = (options: SpriteAtlasOptions | undefined) => {
  const widthPixel = Math.floor(
    options?.widthPixel ?? DEFAULT_ATLAS_WIDTH_PIXEL
  );
  const heightPixel = Math.floor(
    options?.heightPixel ?? DEFAULT_ATLAS_HEIGHT_PIXEL
  );
  const paddingPixel = Math.floor(
    options?.paddingPixel ?? DEFAULT_ATLAS_PADDING_PIXEL
  );
  const fallbackInset = paddingPixel > 0 ? DEFAULT_ATLAS_UV_INSET_PIXEL : 0;
  let uvInsetPixel = options?.uvInsetPixel ?? fallbackInset;
  if (!Number.isFinite(uvInsetPixel)) {
    uvInsetPixel = fallbackInset;
  }
  if (uvInsetPixel < 0) {
    uvInsetPixel = 0;
  }
  const maxInset = Math.max(0, paddingPixel);
  if (uvInsetPixel > maxInset) {
    uvInsetPixel = maxInset;
  }
  const maxPagesRaw = options?.maxPages ?? 0;
  const maxPages =
    Number.isFinite(maxPagesRaw) && maxPagesRaw > 0
      ? Math.floor(maxPagesRaw)
      : null;
  return {
    widthPixel,
    heightPixel,
    paddingPixel: Math.max(0, paddingPixel),
    uvInsetPixel,
    maxPages,
    defaultImageResize: normalizeImageResizeOptions(
      options?.defaultImageResize
    ),
    pickMask: normalizeAtlasPickMaskOptions(options?.pickMask),
  };
};

const createAtlasRect = (
  x: number,
  y: number,
  width: number,
  height: number
): AtlasRect => ({ x, y, width, height });

const rectContains = (outer: AtlasRect, inner: AtlasRect) =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;

const pruneFreeRects = (rects: AtlasRect[]) => {
  for (let i = 0; i < rects.length; i += 1) {
    const a = rects[i];
    if (!a) {
      continue;
    }
    for (let j = i + 1; j < rects.length; j += 1) {
      const b = rects[j];
      if (!b) {
        continue;
      }
      if (rectContains(a, b)) {
        rects.splice(j, 1);
        j -= 1;
        continue;
      }
      if (rectContains(b, a)) {
        rects.splice(i, 1);
        i -= 1;
        break;
      }
    }
  }
};

const mergeFreeRects = (rects: AtlasRect[]) => {
  let merged = true;
  while (merged) {
    merged = false;
    for (let i = 0; i < rects.length; i += 1) {
      const a = rects[i];
      if (!a) {
        continue;
      }
      for (let j = i + 1; j < rects.length; j += 1) {
        const b = rects[j];
        if (!b) {
          continue;
        }
        if (a.x === b.x && a.width === b.width) {
          if (a.y + a.height === b.y) {
            a.height += b.height;
            rects.splice(j, 1);
            merged = true;
            break;
          }
          if (b.y + b.height === a.y) {
            a.y = b.y;
            a.height += b.height;
            rects.splice(j, 1);
            merged = true;
            break;
          }
        }
        if (a.y === b.y && a.height === b.height) {
          if (a.x + a.width === b.x) {
            a.width += b.width;
            rects.splice(j, 1);
            merged = true;
            break;
          }
          if (b.x + b.width === a.x) {
            a.x = b.x;
            a.width += b.width;
            rects.splice(j, 1);
            merged = true;
            break;
          }
        }
      }
      if (merged) {
        break;
      }
    }
  }
  pruneFreeRects(rects);
};

const allocateRect = (
  rects: AtlasRect[],
  width: number,
  height: number
): AtlasRect | null => {
  let bestIndex = -1;
  let bestArea = Number.POSITIVE_INFINITY;
  for (let i = 0; i < rects.length; i += 1) {
    const rect = rects[i];
    if (!rect) {
      continue;
    }
    if (rect.width < width || rect.height < height) {
      continue;
    }
    const area = rect.width * rect.height;
    if (area < bestArea) {
      bestArea = area;
      bestIndex = i;
    }
  }
  if (bestIndex < 0) {
    return null;
  }
  const target = rects[bestIndex] as AtlasRect;
  const allocated = createAtlasRect(target.x, target.y, width, height);
  const remainingRight = target.width - width;
  const remainingTop = target.height - height;
  rects.splice(bestIndex, 1);
  if (remainingRight > 0) {
    rects.push(
      createAtlasRect(target.x + width, target.y, remainingRight, height)
    );
  }
  if (remainingTop > 0) {
    rects.push(
      createAtlasRect(target.x, target.y + height, target.width, remainingTop)
    );
  }
  pruneFreeRects(rects);
  return allocated;
};

const releaseRect = (rects: AtlasRect[], rect: AtlasRect) => {
  rects.push(createAtlasRect(rect.x, rect.y, rect.width, rect.height));
  mergeFreeRects(rects);
};

const isWebGL2Context = (
  context: WebGLRenderingContext
): context is WebGL2RenderingContext =>
  typeof WebGL2RenderingContext !== 'undefined' &&
  context instanceof WebGL2RenderingContext;

const isMipmapMinFilter = (minFilter: SpriteTextureMinFilter) =>
  minFilter === 'nearestMipmapNearest' ||
  minFilter === 'linearMipmapNearest' ||
  minFilter === 'nearestMipmapLinear' ||
  minFilter === 'linearMipmapLinear';

const resolveMinFilter = (
  gl: WebGLRenderingContext,
  minFilter: SpriteTextureMinFilter
) => {
  switch (minFilter) {
    case 'nearest':
      return gl.NEAREST;
    case 'nearestMipmapNearest':
      return gl.NEAREST_MIPMAP_NEAREST;
    case 'linearMipmapNearest':
      return gl.LINEAR_MIPMAP_NEAREST;
    case 'nearestMipmapLinear':
      return gl.NEAREST_MIPMAP_LINEAR;
    case 'linearMipmapLinear':
      return gl.LINEAR_MIPMAP_LINEAR;
    case 'linear':
    default:
      return gl.LINEAR;
  }
};

const resolveMagFilter = (
  gl: WebGLRenderingContext,
  magFilter: SpriteTextureMagFilter
) => (magFilter === 'nearest' ? gl.NEAREST : gl.LINEAR);

const resolveWrapMode = (
  gl: WebGLRenderingContext,
  mode: SpriteTextureWrapMode
) => {
  switch (mode) {
    case 'repeat':
      return gl.REPEAT;
    case 'mirroredRepeat':
      return gl.MIRRORED_REPEAT;
    case 'clampToEdge':
    default:
      return gl.CLAMP_TO_EDGE;
  }
};

const TEXTURE_FILTER_ANISOTROPIC_EXTENSION_NAMES = [
  'EXT_texture_filter_anisotropic',
  'MOZ_EXT_texture_filter_anisotropic',
  'WEBKIT_EXT_texture_filter_anisotropic',
] as const;

const resolveTextureFilterAnisotropicExtension = (
  context: WebGLRenderingContext
): {
  readonly extension: TextureFilterAnisotropicExtension | null;
  readonly maxSupportedAnisotropy: number;
} => {
  for (const name of TEXTURE_FILTER_ANISOTROPIC_EXTENSION_NAMES) {
    const extension = context.getExtension(
      name
    ) as TextureFilterAnisotropicExtension | null;
    if (!extension) {
      continue;
    }
    const rawMaxAnisotropy = context.getParameter(
      extension.MAX_TEXTURE_MAX_ANISOTROPY_EXT
    );
    return {
      extension,
      maxSupportedAnisotropy:
        typeof rawMaxAnisotropy === 'number' &&
        Number.isFinite(rawMaxAnisotropy) &&
        rawMaxAnisotropy >= 1
          ? rawMaxAnisotropy
          : 1,
    };
  }
  return {
    extension: null,
    maxSupportedAnisotropy: 1,
  };
};

///////////////////////////////////////////////////////////////////////////////////

const resolveTextureParameters = (
  isWebGL2: boolean,
  widthPixel: number,
  heightPixel: number,
  resolvedSampling: ResolvedTextureSamplingOptions
): ResolvedTextureParameters => {
  const isNpotTexture =
    !isWebGL2 && (!isPowerOfTwo(widthPixel) || !isPowerOfTwo(heightPixel));
  let effectiveMinFilter = resolvedSampling.minFilter;
  let effectiveWrapS = resolvedSampling.wrapS;
  let effectiveWrapT = resolvedSampling.wrapT;
  const usesMipmap = isMipmapMinFilter(effectiveMinFilter);
  const usesNpotUnsupportedWrap =
    effectiveWrapS !== 'clampToEdge' || effectiveWrapT !== 'clampToEdge';
  if (isNpotTexture && (usesMipmap || usesNpotUnsupportedWrap)) {
    if (resolvedSampling.npotPolicy === 'error') {
      throw new Error(
        'NPOT textures in WebGL1 require clampToEdge wrap and non-mipmap minFilter.'
      );
    }
    if (usesMipmap) {
      effectiveMinFilter = 'linear';
    }
    if (usesNpotUnsupportedWrap) {
      effectiveWrapS = 'clampToEdge';
      effectiveWrapT = 'clampToEdge';
    }
  }
  return {
    minFilter: effectiveMinFilter,
    magFilter: resolvedSampling.magFilter,
    wrapS: effectiveWrapS,
    wrapT: effectiveWrapT,
    maxAnisotropy: resolvedSampling.maxAnisotropy,
    usesMipmap: isMipmapMinFilter(effectiveMinFilter),
  };
};

///////////////////////////////////////////////////////////////////////////////////

/**
 * Creates the texture atlas manager used by the renderer.
 * @param options - Texture manager dependencies.
 * @returns Texture manager instance.
 */
export const createTextureManager = ({
  queueSetTextureInfo,
  queueSetTiledTextureInfo,
  queueSetTextureTileInfo,
  acquirePickMaskPageTableBuffer,
  acquirePickMaskWordBuffer,
}: {
  readonly queueSetTextureInfo: QueueSetTextureInfo;
  readonly queueSetTiledTextureInfo: QueueSetTiledTextureInfo;
  readonly queueSetTextureTileInfo: QueueSetTextureTileInfo;
  readonly acquirePickMaskPageTableBuffer: (
    requiredCount: number
  ) => Int32Array;
  readonly acquirePickMaskWordBuffer: (requiredCount: number) => Int32Array;
}): TextureManager => {
  let gl: WebGLRenderingContext | null = null;
  let isWebGL2 = false;
  let textureFilterAnisotropicExtension: TextureFilterAnisotropicExtension | null =
    null;
  let maxSupportedTextureAnisotropy = 1;

  const images = new Map<string, ImageResource>();
  const imageIdsByTexIndex: (string | undefined)[] = [];
  const texturesByPageId: (WebGLTexture | undefined)[] = [];
  const pagesById: (TexturePage | undefined)[] = [];
  const freeTextureIndices: number[] = [];
  const freePageIds: number[] = [];
  const freePickMaskWordSpans: PickMaskWordSpan[] = [];
  let nextTextureIndex = 0;
  const atlases = new Map<number, Atlas>();
  let nextAtlasId = 0;
  let nextPageId = 0;
  let nextPickMaskWordOffset = 0;

  const ensureWebGL = () => {
    if (!gl) {
      throw new Error('WebGL context is not attached.');
    }
    return gl;
  };

  const resolveMaxTextureSize = () => {
    if (!gl) {
      return 0;
    }
    const raw = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    return typeof raw === 'number' && Number.isFinite(raw)
      ? Math.max(0, Math.floor(raw))
      : 0;
  };

  const allocatePageId = () =>
    freePageIds.length > 0 ? (freePageIds.pop() as number) : nextPageId++;

  const mergePickMaskWordSpans = () => {
    freePickMaskWordSpans.sort((lhs, rhs) => lhs.offsetWords - rhs.offsetWords);
    for (let index = 0; index + 1 < freePickMaskWordSpans.length; ) {
      const current = freePickMaskWordSpans[index]!;
      const next = freePickMaskWordSpans[index + 1]!;
      if (current.offsetWords + current.wordCount < next.offsetWords) {
        index += 1;
        continue;
      }
      const mergedEnd = Math.max(
        current.offsetWords + current.wordCount,
        next.offsetWords + next.wordCount
      );
      current.wordCount = mergedEnd - current.offsetWords;
      freePickMaskWordSpans.splice(index + 1, 1);
    }
  };

  const allocatePickMaskWordSpan = (wordCount: number) => {
    for (let index = 0; index < freePickMaskWordSpans.length; index += 1) {
      const span = freePickMaskWordSpans[index]!;
      if (span.wordCount < wordCount) {
        continue;
      }
      const offsetWords = span.offsetWords;
      span.offsetWords += wordCount;
      span.wordCount -= wordCount;
      if (span.wordCount <= 0) {
        freePickMaskWordSpans.splice(index, 1);
      }
      const buffer = acquirePickMaskWordBuffer(offsetWords + wordCount);
      buffer.fill(0, offsetWords, offsetWords + wordCount);
      return { offsetWords, wordCount };
    }
    const offsetWords = nextPickMaskWordOffset;
    nextPickMaskWordOffset += wordCount;
    const buffer = acquirePickMaskWordBuffer(nextPickMaskWordOffset);
    buffer.fill(0, offsetWords, nextPickMaskWordOffset);
    return { offsetWords, wordCount };
  };

  const releasePickMaskWordSpan = (offsetWords: number, wordCount: number) => {
    if (offsetWords < 0 || wordCount <= 0) {
      return;
    }
    const buffer = acquirePickMaskWordBuffer(offsetWords + wordCount);
    buffer.fill(0, offsetWords, offsetWords + wordCount);
    freePickMaskWordSpans.push({ offsetWords, wordCount });
    mergePickMaskWordSpans();
  };

  const writePickMaskPageEntry = (page: TexturePage) => {
    const pageTable = acquirePickMaskPageTableBuffer(
      (page.id + 1) * PICK_MASK_PAGE_FIELDS
    );
    const base = page.id * PICK_MASK_PAGE_FIELDS;
    const enabled = page.pickMaskOffsetWords >= 0 && page.pickMaskWordCount > 0;
    pageTable[base + PICK_MASK_PAGE_OFFSET_WORDS] = enabled
      ? page.pickMaskOffsetWords
      : -1;
    pageTable[base + PICK_MASK_PAGE_WORD_STRIDE] = enabled
      ? page.pickMaskWordStride
      : 0;
    pageTable[base + PICK_MASK_PAGE_WIDTH_PIXEL] = enabled ? page.width : 0;
    pageTable[base + PICK_MASK_PAGE_HEIGHT_PIXEL] = enabled ? page.height : 0;
  };

  const clearPickMaskRect = (
    page: TexturePage,
    x: number,
    y: number,
    width: number,
    height: number
  ) => {
    if (page.pickMaskOffsetWords < 0 || page.pickMaskWordCount <= 0) {
      return;
    }
    const wordBuffer = acquirePickMaskWordBuffer(
      page.pickMaskOffsetWords + page.pickMaskWordCount
    );
    for (let localY = 0; localY < height; localY += 1) {
      const rowOffset =
        page.pickMaskOffsetWords + (y + localY) * page.pickMaskWordStride;
      for (let localX = 0; localX < width; localX += 1) {
        const pixelX = x + localX;
        const wordIndex = rowOffset + (pixelX >> 5);
        wordBuffer[wordIndex] =
          (wordBuffer[wordIndex] ?? 0) & ~(1 << (pixelX & 31));
      }
    }
  };

  const writePickMaskRegion = (
    page: TexturePage,
    region: ImageRegion,
    pickMask: ResolvedAtlasPickMaskOptions
  ) => {
    if (page.pickMaskOffsetWords < 0 || page.pickMaskWordCount <= 0) {
      return;
    }
    clearPickMaskRect(
      page,
      region.imageRect.x,
      region.imageRect.y,
      region.uploadWidth,
      region.uploadHeight
    );
    const rgba = resolveImageSourceRgba(
      region.uploadSource,
      region.uploadWidth,
      region.uploadHeight
    );
    const wordBuffer = acquirePickMaskWordBuffer(
      page.pickMaskOffsetWords + page.pickMaskWordCount
    );
    for (let localY = 0; localY < region.uploadHeight; localY += 1) {
      const rowOffset =
        page.pickMaskOffsetWords +
        (region.imageRect.y + localY) * page.pickMaskWordStride;
      for (let localX = 0; localX < region.uploadWidth; localX += 1) {
        const alpha = rgba[(localY * region.uploadWidth + localX) * 4 + 3] ?? 0;
        if (alpha < pickMask.alphaThreshold) {
          continue;
        }
        const pixelX = region.imageRect.x + localX;
        const wordIndex = rowOffset + (pixelX >> 5);
        wordBuffer[wordIndex] =
          (wordBuffer[wordIndex] ?? 0) | (1 << (pixelX & 31));
      }
    }
  };

  const releasePickMaskPage = (page: TexturePage) => {
    releasePickMaskWordSpan(page.pickMaskOffsetWords, page.pickMaskWordCount);
    page.pickMaskOffsetWords = -1;
    page.pickMaskWordStride = 0;
    page.pickMaskWordCount = 0;
    writePickMaskPageEntry(page);
  };

  const createPageTexture = (
    width: number,
    height: number,
    samplingOptions: ResolvedTextureSamplingOptions
  ) => {
    const glContext = ensureWebGL();
    const texture = glContext.createTexture();
    if (!texture) {
      throw new Error('Failed to create texture.');
    }
    const sampling = resolveTextureParameters(
      isWebGL2,
      width,
      height,
      samplingOptions
    );
    glContext.bindTexture(glContext.TEXTURE_2D, texture);
    glContext.texParameteri(
      glContext.TEXTURE_2D,
      glContext.TEXTURE_WRAP_S,
      resolveWrapMode(glContext, sampling.wrapS)
    );
    glContext.texParameteri(
      glContext.TEXTURE_2D,
      glContext.TEXTURE_WRAP_T,
      resolveWrapMode(glContext, sampling.wrapT)
    );
    glContext.texImage2D(
      glContext.TEXTURE_2D,
      0,
      glContext.RGBA,
      width,
      height,
      0,
      glContext.RGBA,
      glContext.UNSIGNED_BYTE,
      null
    );
    glContext.texParameteri(
      glContext.TEXTURE_2D,
      glContext.TEXTURE_MIN_FILTER,
      resolveMinFilter(glContext, sampling.minFilter)
    );
    glContext.texParameteri(
      glContext.TEXTURE_2D,
      glContext.TEXTURE_MAG_FILTER,
      resolveMagFilter(glContext, sampling.magFilter)
    );
    if (textureFilterAnisotropicExtension) {
      glContext.texParameterf(
        glContext.TEXTURE_2D,
        textureFilterAnisotropicExtension.TEXTURE_MAX_ANISOTROPY_EXT,
        Math.min(maxSupportedTextureAnisotropy, sampling.maxAnisotropy)
      );
    }
    return { texture, usesMipmap: sampling.usesMipmap };
  };

  const createAtlasPage = (atlas: Atlas): TexturePage => {
    if (atlas.maxPages !== null && atlas.pages.length >= atlas.maxPages) {
      throw new Error('Atlas page limit exceeded.');
    }
    const pageId = allocatePageId();
    const pickMaskWordStride =
      atlas.pickMask !== null ? resolvePickMaskWordStride(atlas.width) : 0;
    const pickMaskWordCount =
      atlas.pickMask !== null ? pickMaskWordStride * atlas.height : 0;
    const pickMaskSpan =
      pickMaskWordCount > 0
        ? allocatePickMaskWordSpan(pickMaskWordCount)
        : { offsetWords: -1, wordCount: 0 };
    const page: TexturePage = {
      id: pageId,
      atlasId: atlas.id,
      texture: null,
      width: atlas.width,
      height: atlas.height,
      freeRects: [createAtlasRect(0, 0, atlas.width, atlas.height)],
      allocatedCount: 0,
      usesMipmap: false,
      mipmapDirty: false,
      pickMaskOffsetWords: pickMaskSpan.offsetWords,
      pickMaskWordStride,
      pickMaskWordCount: pickMaskSpan.wordCount,
    };
    if (gl) {
      const created = createPageTexture(
        atlas.width,
        atlas.height,
        atlas.sampling
      );
      page.texture = created.texture;
      page.usesMipmap = created.usesMipmap;
      texturesByPageId[pageId] = created.texture;
    }
    pagesById[pageId] = page;
    writePickMaskPageEntry(page);
    atlas.pages.push(page);
    return page;
  };

  const createStandalonePage = (
    atlas: Atlas,
    width: number,
    height: number
  ): TexturePage => {
    if (atlas.maxPages !== null && atlas.pages.length >= atlas.maxPages) {
      throw new Error('Atlas page limit exceeded.');
    }
    const pageId = allocatePageId();
    const pickMaskWordStride =
      atlas.pickMask !== null ? resolvePickMaskWordStride(width) : 0;
    const pickMaskWordCount =
      atlas.pickMask !== null ? pickMaskWordStride * height : 0;
    const pickMaskSpan =
      pickMaskWordCount > 0
        ? allocatePickMaskWordSpan(pickMaskWordCount)
        : { offsetWords: -1, wordCount: 0 };
    const page: TexturePage = {
      id: pageId,
      atlasId: atlas.id,
      texture: null,
      width,
      height,
      freeRects: null,
      allocatedCount: 1,
      usesMipmap: false,
      mipmapDirty: false,
      pickMaskOffsetWords: pickMaskSpan.offsetWords,
      pickMaskWordStride,
      pickMaskWordCount: pickMaskSpan.wordCount,
    };
    if (gl) {
      const created = createPageTexture(width, height, atlas.sampling);
      page.texture = created.texture;
      page.usesMipmap = created.usesMipmap;
      texturesByPageId[pageId] = created.texture;
    }
    pagesById[pageId] = page;
    writePickMaskPageEntry(page);
    atlas.pages.push(page);
    return page;
  };

  const allocateAtlasRect = (
    atlas: Atlas,
    width: number,
    height: number
  ): AtlasAllocation => {
    if (width <= 0 || height <= 0) {
      throw new Error('Image dimensions must be greater than zero.');
    }
    if (width > atlas.width || height > atlas.height) {
      throw new Error('Image size exceeds atlas page dimensions.');
    }
    for (const page of atlas.pages) {
      if (!page.freeRects) {
        continue;
      }
      const rect = allocateRect(page.freeRects, width, height);
      if (rect) {
        page.allocatedCount += 1;
        return { page, rect };
      }
    }
    const page = createAtlasPage(atlas);
    const rect = allocateRect(page.freeRects ?? [], width, height);
    if (!rect) {
      throw new Error('Image size exceeds atlas page dimensions.');
    }
    page.allocatedCount += 1;
    return { page, rect };
  };

  const getAtlasOrThrow = (atlasId: number) => {
    const atlas = atlases.get(atlasId);
    if (!atlas) {
      throw new Error('Atlas id is invalid.');
    }
    return atlas;
  };

  const removePage = (page: TexturePage) => {
    const atlas = atlases.get(page.atlasId);
    if (atlas) {
      const pageIndex = atlas.pages.indexOf(page);
      if (pageIndex >= 0) {
        atlas.pages.splice(pageIndex, 1);
      }
    }
    releasePickMaskPage(page);
    texturesByPageId[page.id] = undefined;
    pagesById[page.id] = undefined;
    freePageIds.push(page.id);
    if (page.texture && gl) {
      gl.deleteTexture(page.texture);
    }
    page.texture = null;
  };

  const uploadRegion = (region: ImageRegion) => {
    const glContext = ensureWebGL();
    const texture = region.page.texture;
    if (!texture) {
      throw new Error('Texture is not available.');
    }

    glContext.bindTexture(glContext.TEXTURE_2D, texture);

    // ==============================================================================
    // Texture Y axis flip flag (UNPACK_FLIP_Y_WEBGL):
    // DO NOT CHANGE THIS FLAG, WILL BREAK MANY OTHER CALCULATION.
    // Keep the texture origin at the bottom-left (V=0 is bottom); flip on upload.
    glContext.pixelStorei(glContext.UNPACK_FLIP_Y_WEBGL, 1);
    // ==============================================================================

    glContext.texSubImage2D(
      glContext.TEXTURE_2D,
      0,
      region.imageRect.x,
      region.imageRect.y,
      glContext.RGBA,
      glContext.UNSIGNED_BYTE,
      region.uploadSource
    );
    if (region.page.usesMipmap) {
      region.page.mipmapDirty = true;
    }
  };

  const releaseImageResource = (
    resource: ImageResource,
    recycleTextureIndex: boolean
  ) => {
    for (const region of resource.regions) {
      clearPickMaskRect(
        region.page,
        region.imageRect.x,
        region.imageRect.y,
        region.imageRect.width,
        region.imageRect.height
      );
      if (region.page.freeRects && region.allocRect) {
        releaseRect(region.page.freeRects, region.allocRect);
        region.page.allocatedCount = Math.max(
          0,
          region.page.allocatedCount - 1
        );
      } else {
        removePage(region.page);
      }
      releaseUploadSource(region.uploadSource);
    }
    images.delete(imageIdsByTexIndex[resource.texIndex] ?? '');
    imageIdsByTexIndex[resource.texIndex] = undefined;
    if (recycleTextureIndex) {
      freeTextureIndices.push(resource.texIndex);
    }
  };

  const queueImageResource = (resource: ImageResource) => {
    const resolveRegionUvs = (region: ImageRegion) => {
      const atlas = atlases.get(region.page.atlasId);
      const inset =
        region.page.freeRects && atlas
          ? Math.min(
              atlas.uvInset,
              region.imageRect.width * 0.5,
              region.imageRect.height * 0.5
            )
          : 0;
      return {
        u0: (region.imageRect.x + inset) / region.page.width,
        v0: (region.imageRect.y + inset) / region.page.height,
        u1:
          (region.imageRect.x + region.imageRect.width - inset) /
          region.page.width,
        v1:
          (region.imageRect.y + region.imageRect.height - inset) /
          region.page.height,
      };
    };
    if (resource.regions.length <= 1) {
      const region = resource.regions[0];
      if (!region) {
        queueSetTextureInfo(resource.texIndex, 0, 0, false, -1, 0, 0, 0, 0);
        return;
      }
      const { u0, v0, u1, v1 } = resolveRegionUvs(region);
      queueSetTextureInfo(
        resource.texIndex,
        resource.width,
        resource.height,
        true,
        region.pageId,
        u0,
        v0,
        u1,
        v1
      );
      return;
    }
    queueSetTiledTextureInfo(
      resource.texIndex,
      resource.width,
      resource.height,
      true,
      resource.regions.length
    );
    for (let index = 0; index < resource.regions.length; index += 1) {
      const region = resource.regions[index]!;
      const { u0, v0, u1, v1 } = resolveRegionUvs(region);
      queueSetTextureTileInfo(
        resource.texIndex,
        index,
        region.pageId,
        u0,
        v0,
        u1,
        v1,
        region.localLeftRatio,
        region.localTopRatio,
        region.localRightRatio,
        region.localBottomRatio
      );
    }
  };

  const allocateAtlas = (options: SpriteAtlasOptions | undefined) => {
    const normalized = normalizeAtlasOptions(options);
    const sampling = normalizeTextureSamplingOptions(options?.textureSampling);
    if (!Number.isFinite(normalized.widthPixel) || normalized.widthPixel <= 0) {
      throw new Error('Atlas width must be greater than zero.');
    }
    if (
      !Number.isFinite(normalized.heightPixel) ||
      normalized.heightPixel <= 0
    ) {
      throw new Error('Atlas height must be greater than zero.');
    }
    const atlas: Atlas = {
      id: nextAtlasId++,
      width: normalized.widthPixel,
      height: normalized.heightPixel,
      padding: normalized.paddingPixel,
      uvInset: normalized.uvInsetPixel,
      maxPages: normalized.maxPages,
      defaultImageResize: normalized.defaultImageResize,
      sampling,
      pickMask: normalized.pickMask,
      pages: [],
    };
    atlases.set(atlas.id, atlas);
    return atlas.id;
  };

  const registerImage = async (
    atlasId: number,
    imageId: string,
    imageSource: TexImageSource,
    upScalingToPowerOfTwo: boolean | undefined,
    options: SpriteImageRegisterOptions | undefined
  ): Promise<SizeInPixel> => {
    if (!Number.isFinite(atlasId)) {
      throw new Error('Atlas id is required.');
    }
    if (!imageId) {
      throw new Error('Image id is required.');
    }
    if (
      upScalingToPowerOfTwo !== undefined &&
      typeof upScalingToPowerOfTwo !== 'boolean'
    ) {
      throw new Error('upScalingToPowerOfTwo must be a boolean.');
    }
    const atlas = getAtlasOrThrow(atlasId);
    const { widthPixel: sourceWidthPixel, heightPixel: sourceHeightPixel } =
      getImageSize(imageSource);
    if (sourceWidthPixel <= 0 || sourceHeightPixel <= 0) {
      throw new Error('Image dimensions must be greater than zero.');
    }

    const logicalWidthPixel =
      options?.logicalSize?.widthPixel ?? sourceWidthPixel;
    const logicalHeightPixel =
      options?.logicalSize?.heightPixel ?? sourceHeightPixel;
    if (
      !Number.isFinite(logicalWidthPixel) ||
      !Number.isFinite(logicalHeightPixel) ||
      logicalWidthPixel <= 0 ||
      logicalHeightPixel <= 0
    ) {
      throw new Error('Logical image dimensions must be greater than zero.');
    }

    const hasResizeOverride =
      !!options && Object.prototype.hasOwnProperty.call(options, 'resize');
    const resolvedResize = hasResizeOverride
      ? normalizeImageResizeOptions(options?.resize)
      : atlas.defaultImageResize;
    const resizeTarget = resolveResizeTargetSize(
      sourceWidthPixel,
      sourceHeightPixel,
      resolvedResize
    );

    let uploadWidthPixel = sourceWidthPixel;
    let uploadHeightPixel = sourceHeightPixel;
    let uploadSource = imageSource;
    uploadWidthPixel = resizeTarget.widthPixel;
    uploadHeightPixel = resizeTarget.heightPixel;

    const shouldUpscale = upScalingToPowerOfTwo === true;
    if (
      shouldUpscale &&
      (!isPowerOfTwo(uploadWidthPixel) || !isPowerOfTwo(uploadHeightPixel))
    ) {
      uploadWidthPixel = getNextPowerOfTwo(uploadWidthPixel);
      uploadHeightPixel = getNextPowerOfTwo(uploadHeightPixel);
    }

    if (
      uploadWidthPixel !== sourceWidthPixel ||
      uploadHeightPixel !== sourceHeightPixel
    ) {
      const resizeQuality =
        resolvedResize?.quality ?? DEFAULT_IMAGE_RESIZE_QUALITY;
      uploadSource = createResizedImageSource(
        imageSource,
        uploadWidthPixel,
        uploadHeightPixel,
        resizeQuality
      );
    }

    const previous = images.get(imageId);
    const texIndex =
      previous?.texIndex ??
      (freeTextureIndices.length > 0
        ? (freeTextureIndices.pop() as number)
        : nextTextureIndex++);
    if (previous) {
      releaseImageResource(previous, false);
    }
    const paddedWidthPixel = uploadWidthPixel + atlas.padding * 2;
    const paddedHeightPixel = uploadHeightPixel + atlas.padding * 2;

    const regions: ImageRegion[] = [];
    if (paddedWidthPixel <= atlas.width && paddedHeightPixel <= atlas.height) {
      const allocation = allocateAtlasRect(
        atlas,
        paddedWidthPixel,
        paddedHeightPixel
      );
      regions.push({
        pageId: allocation.page.id,
        page: allocation.page,
        allocRect: allocation.rect,
        imageRect: createAtlasRect(
          allocation.rect.x + atlas.padding,
          allocation.rect.y + atlas.padding,
          uploadWidthPixel,
          uploadHeightPixel
        ),
        uploadWidth: uploadWidthPixel,
        uploadHeight: uploadHeightPixel,
        uploadSource,
        localLeftRatio: -0.5,
        localTopRatio: -0.5,
        localRightRatio: 0.5,
        localBottomRatio: 0.5,
      });
    } else {
      const maxTextureSize = resolveMaxTextureSize();
      if (maxTextureSize <= 0) {
        throw new Error(
          'WebGL context must be attached before registering images that exceed atlas page dimensions.'
        );
      }
      if (
        uploadWidthPixel <= maxTextureSize &&
        uploadHeightPixel <= maxTextureSize
      ) {
        const page = createStandalonePage(
          atlas,
          uploadWidthPixel,
          uploadHeightPixel
        );
        regions.push({
          pageId: page.id,
          page,
          allocRect: null,
          imageRect: createAtlasRect(0, 0, uploadWidthPixel, uploadHeightPixel),
          uploadWidth: uploadWidthPixel,
          uploadHeight: uploadHeightPixel,
          uploadSource,
          localLeftRatio: -0.5,
          localTopRatio: -0.5,
          localRightRatio: 0.5,
          localBottomRatio: 0.5,
        });
      } else {
        const tileWidthPixel = Math.max(1, maxTextureSize);
        const tileHeightPixel = Math.max(1, maxTextureSize);
        for (
          let tileY = 0;
          tileY < uploadHeightPixel;
          tileY += tileHeightPixel
        ) {
          for (
            let tileX = 0;
            tileX < uploadWidthPixel;
            tileX += tileWidthPixel
          ) {
            const regionWidth = Math.min(
              tileWidthPixel,
              uploadWidthPixel - tileX
            );
            const regionHeight = Math.min(
              tileHeightPixel,
              uploadHeightPixel - tileY
            );
            const tileSource =
              tileX === 0 &&
              tileY === 0 &&
              regionWidth === uploadWidthPixel &&
              regionHeight === uploadHeightPixel
                ? uploadSource
                : await createCroppedImageSource(
                    uploadSource,
                    tileX,
                    tileY,
                    regionWidth,
                    regionHeight
                  );
            const page = createStandalonePage(atlas, regionWidth, regionHeight);
            regions.push({
              pageId: page.id,
              page,
              allocRect: null,
              imageRect: createAtlasRect(0, 0, regionWidth, regionHeight),
              uploadWidth: regionWidth,
              uploadHeight: regionHeight,
              uploadSource: tileSource,
              localLeftRatio: tileX / uploadWidthPixel - 0.5,
              localTopRatio: tileY / uploadHeightPixel - 0.5,
              localRightRatio: (tileX + regionWidth) / uploadWidthPixel - 0.5,
              localBottomRatio:
                (tileY + regionHeight) / uploadHeightPixel - 0.5,
            });
          }
        }
        if (uploadSource !== imageSource) {
          releaseUploadSource(uploadSource);
        }
      }
    }

    const resource: ImageResource = {
      width: logicalWidthPixel,
      height: logicalHeightPixel,
      texIndex,
      atlasId: atlas.id,
      regions,
    };
    if (atlas.pickMask) {
      for (const region of resource.regions) {
        writePickMaskRegion(region.page, region, atlas.pickMask);
      }
    }
    images.set(imageId, resource);
    imageIdsByTexIndex[texIndex] = imageId;
    queueImageResource(resource);

    if (gl) {
      for (const region of resource.regions) {
        uploadRegion(region);
      }
    }

    return { widthPixel: uploadWidthPixel, heightPixel: uploadHeightPixel };
  };

  const registerTextGlyph = async (
    atlasId: number,
    imageId: string,
    text: string,
    dimensions: SpriteTextGlyphDimensions,
    options: SpriteTextGlyphOptions | undefined
  ): Promise<SizeInPixel> => {
    const result = await renderTextGlyphSource(text, dimensions, options);
    return registerImage(atlasId, imageId, result.source, false, {
      logicalSize: result.logicalSize,
    });
  };

  const attachWebGL = (context: WebGLRenderingContext) => {
    if (!context) {
      throw new Error('WebGL context is required.');
    }
    if (gl) {
      throw new Error('WebGL context is already attached.');
    }
    gl = context;
    isWebGL2 = isWebGL2Context(gl);
    const anisotropyState = resolveTextureFilterAnisotropicExtension(gl);
    textureFilterAnisotropicExtension = anisotropyState.extension;
    maxSupportedTextureAnisotropy = anisotropyState.maxSupportedAnisotropy;

    for (const atlas of atlases.values()) {
      for (const page of atlas.pages) {
        if (page.texture) {
          continue;
        }
        const created = createPageTexture(
          page.width,
          page.height,
          atlas.sampling
        );
        page.texture = created.texture;
        page.usesMipmap = created.usesMipmap;
        texturesByPageId[page.id] = created.texture;
      }
    }

    for (const resource of images.values()) {
      for (const region of resource.regions) {
        uploadRegion(region);
      }
    }
  };

  const unregisterImage = (imageId: string) => {
    const resource = images.get(imageId);
    if (!resource) {
      return;
    }
    const outputPartCount = resource.regions.length;
    releaseImageResource(resource, true);
    if (outputPartCount > 1) {
      queueSetTiledTextureInfo(resource.texIndex, 0, 0, false, 0);
    } else {
      queueSetTextureInfo(resource.texIndex, 0, 0, false, -1, 0, 0, 0, 0);
    }
  };

  const releaseAtlas = (atlasId: number) => {
    const atlas = atlases.get(atlasId);
    if (!atlas) {
      return;
    }
    const imageIdsToRemove: string[] = [];
    for (const [imageId, resource] of images.entries()) {
      if (resource.atlasId === atlasId) {
        imageIdsToRemove.push(imageId);
      }
    }
    for (const imageId of imageIdsToRemove) {
      unregisterImage(imageId);
    }
    for (const page of atlas.pages) {
      releasePickMaskPage(page);
      if (page.texture && gl) {
        gl.deleteTexture(page.texture);
      }
      texturesByPageId[page.id] = undefined;
      pagesById[page.id] = undefined;
      freePageIds.push(page.id);
      page.texture = null;
    }
    atlases.delete(atlasId);
  };

  const resolveTextureIndex = (imageId: string) =>
    images.get(imageId)?.texIndex;

  const resolveImageIdByTexIndex = (texIndex: number) =>
    imageIdsByTexIndex[texIndex];

  const resolveImageLogicalSizeById = (imageId: string) => {
    const resource = images.get(imageId);
    if (!resource) {
      return undefined;
    }
    return {
      widthPixel: resource.width,
      heightPixel: resource.height,
    };
  };

  const resolveTextureOutputPartCountByTexIndex = (texIndex: number) => {
    const imageId = imageIdsByTexIndex[texIndex];
    if (!imageId) {
      return 0;
    }
    return images.get(imageId)?.regions.length ?? 0;
  };

  const resolveTextureByPageId = (pageId: number) => texturesByPageId[pageId];

  const ensureMipmap = (pageId: number) => {
    const page = pagesById[pageId];
    if (!page || !page.texture || !page.usesMipmap || !page.mipmapDirty) {
      return;
    }
    const glContext = ensureWebGL();
    glContext.bindTexture(glContext.TEXTURE_2D, page.texture);
    glContext.generateMipmap(glContext.TEXTURE_2D);
    page.mipmapDirty = false;
  };

  const release = () => {
    if (gl) {
      for (const atlas of atlases.values()) {
        for (const page of atlas.pages) {
          if (page.texture) {
            gl.deleteTexture(page.texture);
            page.texture = null;
          }
        }
      }
    }
    atlases.clear();
    images.clear();
    imageIdsByTexIndex.length = 0;
    texturesByPageId.length = 0;
    pagesById.length = 0;
    freeTextureIndices.length = 0;
    freePageIds.length = 0;
    freePickMaskWordSpans.length = 0;
    nextPageId = 0;
    nextPickMaskWordOffset = 0;
    gl = null;
    isWebGL2 = false;
    textureFilterAnisotropicExtension = null;
    maxSupportedTextureAnisotropy = 1;
  };

  return {
    attachWebGL,
    allocateAtlas,
    releaseAtlas,
    registerImage,
    registerTextGlyph,
    unregisterImage,
    resolveTextureIndex,
    resolveImageIdByTexIndex,
    resolveImageLogicalSizeById,
    resolveTextureOutputPartCountByTexIndex,
    resolveTextureByPageId,
    ensureMipmap,
    release,
  };
};
