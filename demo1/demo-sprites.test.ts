// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('demo sprites', () => {
  it('wires the pseudo lod slider to sprite placement and updates', async () => {
    const sourcePath = resolve(import.meta.dirname, './demo.ts');
    const source = await readFile(sourcePath, 'utf8');

    expect(source).toContain(
      'const SPRITE_VISIBILITY_DISTANCE_DISABLED_VALUE = 120001;'
    );
    expect(source).toContain(
      'const spriteVisibilityDistance = createRangeControl('
    );
    expect(source).toContain("'sprite-visibility-distance',");
    expect(source).toContain("'sprite-visibility-distance-value',");
    expect(source).toContain(
      'visibilityDistance: spriteVisibilityDistanceValue'
    );
    expect(source).toContain('visibilityDistance: null');
    expect(source).toContain(
      "spriteVisibilityDistance.input.addEventListener('input', () => {"
    );
  });
});
