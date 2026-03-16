// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

export type SpriteImage = {
  imageId: string;
  width: number;
  height: number;
};

export type GridCell = SpriteImage & {
  xIndex: number;
  yIndex: number;
};

export type GridLayout = {
  scale: number;
  stepX: number;
  stepY: number;
  startX: number;
  startY: number;
};

export const clampGridSize = (size: number, min = 1, max = 400) => {
  if (!Number.isFinite(size)) {
    return min;
  }
  const rounded = Math.round(size);
  return Math.min(max, Math.max(min, rounded));
};

export const getGridCellSize = (images: readonly SpriteImage[]) => {
  if (images.length === 0) {
    throw new Error('Grid images are required.');
  }
  const cellWidth = Math.max(...images.map((image) => image.width));
  const cellHeight = Math.max(...images.map((image) => image.height));
  return { cellWidth, cellHeight };
};

export const buildCheckerGrid = (
  gridSize: number,
  images: readonly [SpriteImage, SpriteImage]
): GridCell[] => {
  const cells: GridCell[] = [];
  for (let yIndex = 0; yIndex < gridSize; yIndex += 1) {
    for (let xIndex = 0; xIndex < gridSize; xIndex += 1) {
      const image = (xIndex + yIndex) % 2 === 0 ? images[0] : images[1];
      cells.push({
        imageId: image.imageId,
        width: image.width,
        height: image.height,
        xIndex,
        yIndex,
      });
    }
  }
  return cells;
};

export const computeGridLayout = (
  gridSize: number,
  viewWidth: number,
  viewHeight: number,
  cellWidth: number,
  cellHeight: number
): GridLayout => {
  const safeGridSize = Math.max(1, gridSize);
  const safeWidth = Math.max(1, viewWidth);
  const safeHeight = Math.max(1, viewHeight);
  const safeCellWidth = Math.max(1, cellWidth);
  const safeCellHeight = Math.max(1, cellHeight);
  const scale = Math.min(
    safeWidth / (safeGridSize * safeCellWidth),
    safeHeight / (safeGridSize * safeCellHeight)
  );
  const stepX = safeCellWidth * scale;
  const stepY = safeCellHeight * scale;
  const gridWidth = stepX * safeGridSize;
  const gridHeight = stepY * safeGridSize;
  const startX = -gridWidth / 2 + stepX / 2;
  const startY = gridHeight / 2 - stepY / 2;
  return {
    scale,
    stepX,
    stepY,
    startX,
    startY,
  };
};

export const getGridPosition = (
  layout: GridLayout,
  xIndex: number,
  yIndex: number
) => ({
  x: layout.startX + layout.stepX * xIndex,
  y: layout.startY - layout.stepY * yIndex,
});
