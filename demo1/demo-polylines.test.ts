// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('demo polylines', () => {
  it('uses polyline controls for style and correction settings', async () => {
    const sourcePath = resolve(import.meta.dirname, './demo.ts');
    const source = await readFile(sourcePath, 'utf8');

    expect(source).toContain('layer: polylineOuterLayerValue');
    expect(source).toContain('opacity: { value: polylineOuterOpacityValue }');
    expect(source).toContain('color: resolvePolylineOuterColor()');
    expect(source).toContain('joinCorrection: resolvePolylineJoinCorrection(');
    expect(source).toContain('polylineOuterJoinCorrectionValue');
    expect(source).toContain('capCorrection: resolvePolylineCapCorrection(');
    expect(source).toContain('polylineOuterCapCorrectionValue');
    expect(source).toContain('layer: polylineRandomLayerValue');
    expect(source).toContain('opacity: { value: polylineRandomOpacityValue }');
    expect(source).toContain('color: resolvePolylineRandomColor()');
    expect(source).toContain('polylineRandomJoinCorrectionValue');
    expect(source).toContain('polylineRandomCapCorrectionValue');
  });
});
