// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('demo2 index html', () => {
  it('positions the operations panel at the top right edge', async () => {
    const htmlPath = resolve(import.meta.dirname, './index.html');
    const html = await readFile(htmlPath, 'utf8');

    expect(html).toContain('.overlay-panel {');
    expect(html).toContain('top: 1rem;');
    expect(html).toContain('right: 1rem;');
    expect(html).not.toContain('left: 50%;');
    expect(html).not.toContain('transform: translateX(-50%);');
  });

  it('places Track All Cars above Reset View in the left control column', async () => {
    const htmlPath = resolve(import.meta.dirname, './index.html');
    const html = await readFile(htmlPath, 'utf8');

    const leftColumnStart = html.indexOf(
      '<div class="panel-column panel-left">'
    );
    const rightColumnStart = html.indexOf(
      '<div class="panel-column panel-right">'
    );
    const trackAllCarsIndex = html.indexOf('id="track-all-cars"');
    const resetViewIndex = html.indexOf('id="reset-view"');

    expect(leftColumnStart).toBeGreaterThanOrEqual(0);
    expect(rightColumnStart).toBeGreaterThan(leftColumnStart);
    expect(trackAllCarsIndex).toBeGreaterThan(leftColumnStart);
    expect(trackAllCarsIndex).toBeLessThan(rightColumnStart);
    expect(resetViewIndex).toBeGreaterThan(trackAllCarsIndex);
  });
});
