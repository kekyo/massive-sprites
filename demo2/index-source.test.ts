// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('demo2 polyline route settings', () => {
  it('uses fan3 join and cap corrections for route polylines', async () => {
    const sourcePath = resolve(import.meta.dirname, './index.ts');
    const source = await readFile(sourcePath, 'utf8');

    expect(source).toContain(
      "joinCorrection: { type: 'fan', intermediatePointCount: 3 }"
    );
    expect(source).toContain("capCorrection: { type: 'fan', pointCount: 3 }");
  });

  it('always enables atlas pick masks with alpha threshold 1', async () => {
    const sourcePath = resolve(import.meta.dirname, './index.ts');
    const source = await readFile(sourcePath, 'utf8');

    expect(source).toContain(
      'const PICK_MASK_OPTIONS = { enabled: true, alphaThreshold: 1 } as const;'
    );
    expect(source).toContain('pickMask: PICK_MASK_OPTIONS');
  });
});
