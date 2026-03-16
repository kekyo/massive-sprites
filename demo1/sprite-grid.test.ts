// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { describe, expect, it } from 'vitest';
import {
  buildCheckerGrid,
  clampGridSize,
  computeGridLayout,
  getGridCellSize,
  getGridPosition,
} from './sprite-grid';

describe('sprite-grid helpers', () => {
  it('clamps grid size into the 1-400 range', () => {
    expect(clampGridSize(0)).toBe(1);
    expect(clampGridSize(401)).toBe(400);
    expect(clampGridSize(4.2)).toBe(4);
  });

  it('builds checkerboard cells', () => {
    const images = [
      { imageId: 'curve', width: 10, height: 10 },
      { imageId: 'walker', width: 12, height: 8 },
    ] as const;
    const cells = buildCheckerGrid(2, images);
    expect(cells).toHaveLength(4);
    const cellAt = (xIndex: number, yIndex: number) =>
      cells.find((cell) => cell.xIndex === xIndex && cell.yIndex === yIndex);
    expect(cellAt(0, 0)?.imageId).toBe('curve');
    expect(cellAt(1, 0)?.imageId).toBe('walker');
    expect(cellAt(0, 1)?.imageId).toBe('walker');
    expect(cellAt(1, 1)?.imageId).toBe('curve');
  });

  it('centers positions inside the grid layout', () => {
    const images = [
      { imageId: 'curve', width: 10, height: 20 },
      { imageId: 'walker', width: 8, height: 12 },
    ] as const;
    const { cellWidth, cellHeight } = getGridCellSize(images);
    const layout = computeGridLayout(2, 100, 60, cellWidth, cellHeight);
    expect(layout.scale).toBeCloseTo(1.5);
    const topLeft = getGridPosition(layout, 0, 0);
    const bottomRight = getGridPosition(layout, 1, 1);
    expect(topLeft.x).toBeCloseTo(-bottomRight.x);
    expect(topLeft.y).toBeCloseTo(-bottomRight.y);
  });
});
