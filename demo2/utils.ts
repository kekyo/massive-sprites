// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

///////////////////////////////////////////////////////////////////////////////////

const CAR_VARIANT_ID_PREFIX = 'car-variant';

///////////////////////////////////////////////////////////////////////////////////

export const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

const loadImage = (source: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${source}`));
    image.src = source;
  });

export const loadImageBitmap = async (source: string) => {
  const image = await loadImage(source);
  return createImageBitmap(image);
};

export const resolveCanvasMetrics = (canvas: HTMLCanvasElement) => {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, rect.width || canvas.clientWidth || canvas.width);
  const height = Math.max(
    1,
    rect.height || canvas.clientHeight || canvas.height
  );
  return {
    width,
    height,
    aspect: width / height,
  };
};

export const clampNumber = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const randomBetween = (min: number, max: number) =>
  min + Math.random() * (max - min);

export const buildCarVariantIds = (count: number) => {
  const safeCount = Math.max(1, Math.floor(count));
  return Array.from(
    { length: safeCount },
    (_, index) => `${CAR_VARIANT_ID_PREFIX}-${index}`
  );
};

const requireElement = (id: string) => {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLElement)) {
    throw new Error(`Missing element: ${id}`);
  }
  return element;
};

const requireInput = (id: string) => {
  const element = requireElement(id);
  if (!(element instanceof HTMLInputElement)) {
    throw new Error(`Missing input element: ${id}`);
  }
  return element;
};

export const requireRangeInput = (id: string) => {
  const input = requireInput(id);
  if (input.type !== 'range') {
    throw new Error(`Expected range input: ${id}`);
  }
  return input;
};

export const requireCheckboxInput = (id: string) => {
  const input = requireInput(id);
  if (input.type !== 'checkbox') {
    throw new Error(`Expected checkbox input: ${id}`);
  }
  return input;
};

export const requireButton = (id: string) => {
  const element = requireElement(id);
  if (!(element instanceof HTMLButtonElement)) {
    throw new Error(`Missing button element: ${id}`);
  }
  return element;
};

export const requireValueLabel = (id: string) => requireElement(id);
