// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import * as colorCore from 'color-core';
import type { RGB } from 'color-core';
import type { ColorRGBA } from 'massive-sprites';

///////////////////////////////////////////////////////////////////////////////////

const { oklchToRgb, rgbToOklch } = colorCore;

const clampByte = (value: number) =>
  Math.min(255, Math.max(0, Math.round(value)));

const normalizeHue = (value: number) => ((value % 360) + 360) % 360;

export const buildHueShiftOffsets = (variantCount: number) => {
  const safeCount = Math.max(1, Math.floor(variantCount));
  const step = 360 / safeCount;
  return Array.from({ length: safeCount }, (_, index) => index * step);
};

export const formatRgbHex = (rgb: RGB): ColorRGBA => {
  const toHex = (value: number) =>
    clampByte(value).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}` as ColorRGBA;
};

export const shiftRgbHueOklch = (rgb: RGB, hueShiftDeg: number): RGB => {
  const oklch = rgbToOklch({ r: rgb.r, g: rgb.g, b: rgb.b });
  const shiftedHue = normalizeHue(oklch.h + hueShiftDeg);
  const shifted = oklchToRgb({ L: oklch.L, C: oklch.C, h: shiftedHue });
  const base = {
    r: clampByte(shifted.r),
    g: clampByte(shifted.g),
    b: clampByte(shifted.b),
  };
  return rgb.a === undefined ? base : { ...base, a: rgb.a };
};

const buildAverageRgb = (
  sum: { r: number; g: number; b: number },
  count: number
): RGB => {
  if (count <= 0) {
    return { r: 255, g: 255, b: 255 };
  }
  return {
    r: clampByte(sum.r / count),
    g: clampByte(sum.g / count),
    b: clampByte(sum.b / count),
  };
};

const resolveAccentColor = (imageData: ImageData): RGB => {
  const data = imageData.data;
  const chromaSum = { r: 0, g: 0, b: 0 };
  let chromaCount = 0;
  const fallbackSum = { r: 0, g: 0, b: 0 };
  let fallbackCount = 0;

  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] ?? 0;
    if (alpha === 0) {
      continue;
    }
    const r = data[i] ?? 0;
    const g = data[i + 1] ?? 0;
    const b = data[i + 2] ?? 0;
    fallbackSum.r += r;
    fallbackSum.g += g;
    fallbackSum.b += b;
    fallbackCount += 1;

    const { C } = rgbToOklch({ r, g, b });
    if (C < 8) {
      continue;
    }
    chromaSum.r += r;
    chromaSum.g += g;
    chromaSum.b += b;
    chromaCount += 1;
  }

  if (chromaCount > 0) {
    return buildAverageRgb(chromaSum, chromaCount);
  }
  return buildAverageRgb(fallbackSum, fallbackCount);
};

export const shiftImageDataHueOklch = (
  data: Uint8ClampedArray,
  hueShiftDeg: number
) => {
  const result = new Uint8ClampedArray(data.length);
  for (let i = 0; i < data.length; i += 4) {
    const alpha = data[i + 3] ?? 0;
    if (alpha === 0) {
      result[i] = data[i] ?? 0;
      result[i + 1] = data[i + 1] ?? 0;
      result[i + 2] = data[i + 2] ?? 0;
      result[i + 3] = alpha;
      continue;
    }

    const shifted = shiftRgbHueOklch(
      {
        r: data[i] ?? 0,
        g: data[i + 1] ?? 0,
        b: data[i + 2] ?? 0,
      },
      hueShiftDeg
    );
    result[i] = shifted.r;
    result[i + 1] = shifted.g;
    result[i + 2] = shifted.b;
    result[i + 3] = alpha;
  }
  return result;
};

export const createHueShiftedImageData = (
  imageData: ImageData,
  hueShiftDeg: number
) => {
  const shifted = shiftImageDataHueOklch(imageData.data, hueShiftDeg);
  return new ImageData(shifted, imageData.width, imageData.height);
};

export type HueShiftedBitmap = {
  bitmap: ImageBitmap;
  accentColor: RGB;
};

export const createHueShiftedBitmaps = async (
  source: ImageBitmap,
  variantCount: number
) => {
  const canvas = document.createElement('canvas');
  canvas.width = source.width;
  canvas.height = source.height;
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Missing 2D canvas context.');
  }

  context.drawImage(source, 0, 0);
  const baseData = context.getImageData(0, 0, canvas.width, canvas.height);
  const hueOffsets = buildHueShiftOffsets(variantCount);
  const baseAccent = resolveAccentColor(baseData);
  const results: HueShiftedBitmap[] = [];

  for (const hueShift of hueOffsets) {
    const shiftedData = createHueShiftedImageData(baseData, hueShift);
    context.putImageData(shiftedData, 0, 0);
    const bitmap = await createImageBitmap(canvas);
    results.push({
      bitmap,
      accentColor: shiftRgbHueOklch(baseAccent, hueShift),
    });
  }

  return results;
};
