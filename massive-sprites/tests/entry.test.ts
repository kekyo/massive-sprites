// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  createObjectCanvasRenderer,
  createObjectRenderer,
  getConsoleLogger,
  getNoOpLogger,
  loadWasmModule,
} from '../src';

describe('entry', () => {
  it('exports expected helpers', () => {
    expect(typeof createObjectCanvasRenderer).toBe('function');
    expect(typeof createObjectRenderer).toBe('function');
    expect(typeof loadWasmModule).toBe('function');
    expect(typeof getNoOpLogger).toBe('function');
    expect(typeof getConsoleLogger).toBe('function');
  });
});
