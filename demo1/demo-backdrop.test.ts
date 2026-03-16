// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

describe('demo backdrop', () => {
  it('manages backdrop image registration and sprite updates separately', async () => {
    const sourcePath = resolve(import.meta.dirname, './demo.ts');
    const source = await readFile(sourcePath, 'utf8');

    expect(source).toContain(
      "const BACKDROP_IMAGE_ID = 'demo-backdrop-image';"
    );
    expect(source).toContain('const BACKDROP_LAYER = 0;');
    expect(source).toContain('let backdropSpriteId: number | null = null;');
    expect(source).toContain('await activeRenderer.registerImage(');
    expect(source).toContain('BACKDROP_IMAGE_ID,');
    expect(source).toContain('backdropImageSource.bitmap,');
    expect(source).toContain(
      'backdropSpriteId = (await activeRenderer.addSprite('
    );
    expect(source).toContain('activeRenderer.updateSprite(');
    expect(source).toContain('createBackdropSpriteUpdate()');
    expect(source).toContain(
      "console.error('Failed to add backdrop sprite.', error);"
    );
    expect(source).toContain(
      "backdropLoadButton.addEventListener('click', () => {"
    );
    expect(source).toContain(
      "backdropFileInput.addEventListener('change', () => {"
    );
    expect(source).toContain(
      "backdropClearButton.addEventListener('click', () => {"
    );
  });

  it('reserves layer 0 for the backdrop and shifts demo defaults above it', async () => {
    const sourcePath = resolve(import.meta.dirname, './demo.ts');
    const source = await readFile(sourcePath, 'utf8');

    expect(source).toContain(
      'let elementLayers: ElementTuple<number> = [3, 3, 3];'
    );
    expect(source).toContain('polylineOuterLayer.setRange(1, 31, 1);');
    expect(source).toContain('polylineRandomLayer.setRange(1, 31, 1);');
    expect(source).toContain('control.setRange(1, 31, 1);');
    expect(source).toContain('control.setValue(3);');
    expect(source).toContain('polylineOuterLayer.setValue(1);');
    expect(source).toContain(
      'let polylineOuterJoinCorrectionValue: DemoPolylineCorrectionSelectValue ='
    );
    expect(source).toContain(
      "polylineOuterJoinCorrectionSelect.value = 'fan5';"
    );
    expect(source).toContain(
      "polylineOuterCapCorrectionSelect.value = 'fan5';"
    );
    expect(source).toContain('let polylineRandomLayerValue = 2;');
    expect(source).toContain('polylineRandomLayer.setValue(2);');
    expect(source).toContain(
      "polylineRandomJoinCorrectionSelect.value = 'fan5';"
    );
    expect(source).toContain(
      "polylineRandomCapCorrectionSelect.value = 'fan5';"
    );
  });
});
