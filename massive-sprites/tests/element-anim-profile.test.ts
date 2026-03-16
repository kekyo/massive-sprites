// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { appendFileSync, readFileSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

import { createObjectRenderer as createCoreObjectRenderer } from '../src/renderer';
import type {
  SizeInPixel,
  SpriteElementPlacement,
  SpriteElementRenderMode,
  ObjectInterpolationParameter,
  ObjectInterpolationSigmoidEasing,
} from '../src/types';
import { loadWasmModule } from '../src/wasm';
import {
  createFakeBitmap,
  createFakeGL,
} from './helpers/object-renderer-test-kit';
import { getTestResultsDir } from './helpers/test-log-paths';

type ElementAnimSample = {
  frame: number;
  tMs: number;
  totalMs: number;
  ownerMs: number;
  opacityMs: number;
  rotationMs: number;
  scaleMs: number;
  anchorMs: number;
  shiftMs: number;
  pivotMs: number;
  mergeMs: number;
  scalarMs: number;
  simdMs: number;
  simdOtherMs: number;
  setupOtherMs: number;
  otherMs: number;
  elements: number;
  active: number;
};

const readPngSize = (filePath: string) => {
  const buffer = readFileSync(filePath);
  const signature = buffer.subarray(0, 8);
  const pngSignature = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  if (!signature.equals(pngSignature)) {
    throw new Error(`Invalid PNG signature: ${filePath}`);
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return { width, height };
};

const getGridPosition = (
  gridSize: number,
  cellWidth: number,
  cellHeight: number,
  xIndex: number,
  yIndex: number
) => {
  const startX = (-gridSize * cellWidth) / 2 + cellWidth / 2;
  const startY = (gridSize * cellHeight) / 2 - cellHeight / 2;
  return {
    x: startX + cellWidth * xIndex,
    y: startY - cellHeight * yIndex,
  };
};

const nextPowerOfTwo = (value: number) => {
  let result = 1;
  while (result < value) {
    result <<= 1;
  }
  return result;
};

const resolveAtlasSize = (
  images: readonly { width: number; height: number }[]
) => {
  const maxWidth = Math.max(...images.map((image) => image.width));
  const maxHeight = Math.max(...images.map((image) => image.height));
  const size = Math.max(512, nextPowerOfTwo(Math.max(maxWidth, maxHeight)));
  return { widthPixel: size, heightPixel: size };
};

const createObjectRenderer = (
  viewPortSize: Parameters<typeof createCoreObjectRenderer>[0],
  gl: WebGLRenderingContext,
  resources: unknown,
  wasmModule: Parameters<typeof createCoreObjectRenderer>[1]
) => {
  void resources;
  const renderer = createCoreObjectRenderer(viewPortSize, wasmModule);
  renderer.attachWebGL(gl);
  return renderer;
};

const parseElementAnimLog = (content: string): ElementAnimSample[] => {
  const samples: ElementAnimSample[] = [];
  const pattern =
    /\[element-anim\] frame=(\d+) t=([0-9.]+) total=([0-9.]+) owner=([0-9.]+) opacity=([0-9.]+) rotation=([0-9.]+) scale=([0-9.]+) anchor=([0-9.]+) shift=([0-9.]+) pivot=([0-9.]+) merge=([0-9.]+) scalar=([0-9.]+) simd=([0-9.]+) simd_other=([0-9.]+) setup_other=([0-9.]+) other=([0-9.]+) elements=(\d+) active=(\d+)/;
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const match = pattern.exec(line);
    if (!match) {
      continue;
    }
    samples.push({
      frame: Number.parseInt(match[1] ?? '0', 10),
      tMs: Number.parseFloat(match[2] ?? '0'),
      totalMs: Number.parseFloat(match[3] ?? '0'),
      ownerMs: Number.parseFloat(match[4] ?? '0'),
      opacityMs: Number.parseFloat(match[5] ?? '0'),
      rotationMs: Number.parseFloat(match[6] ?? '0'),
      scaleMs: Number.parseFloat(match[7] ?? '0'),
      anchorMs: Number.parseFloat(match[8] ?? '0'),
      shiftMs: Number.parseFloat(match[9] ?? '0'),
      pivotMs: Number.parseFloat(match[10] ?? '0'),
      mergeMs: Number.parseFloat(match[11] ?? '0'),
      scalarMs: Number.parseFloat(match[12] ?? '0'),
      simdMs: Number.parseFloat(match[13] ?? '0'),
      simdOtherMs: Number.parseFloat(match[14] ?? '0'),
      setupOtherMs: Number.parseFloat(match[15] ?? '0'),
      otherMs: Number.parseFloat(match[16] ?? '0'),
      elements: Number.parseInt(match[17] ?? '0', 10),
      active: Number.parseInt(match[18] ?? '0', 10),
    });
  }
  return samples;
};

describe('element animation profiling', () => {
  it('profiles element animation hotspots under demo-like settings', async () => {
    const outputDir = getTestResultsDir('element-anim-profile', 'demo-default');
    const logPath = resolve(outputDir, 'element-anim-profile.log');
    const analysisPath = resolve(outputDir, 'analysis.log');
    writeFileSync(logPath, '');
    writeFileSync(analysisPath, '');

    const globalWithElementAnimProfile = globalThis as typeof globalThis & {
      outputElementAnimProfile?: boolean | undefined;
      elementAnimProfileSink?: ((message: string) => void) | undefined;
    };
    const previousOutput =
      globalWithElementAnimProfile.outputElementAnimProfile;
    const previousSink = globalWithElementAnimProfile.elementAnimProfileSink;

    const wasmPath = resolve(
      import.meta.dirname,
      '..',
      'src',
      'wasm',
      'compute.wasm'
    );
    const wasmBytes = await readFile(wasmPath);
    const wasmInstance = await loadWasmModule(wasmBytes);

    const viewSize: SizeInPixel = { widthPixel: 1280, heightPixel: 720 };
    const curveSize = readPngSize(
      resolve(
        import.meta.dirname,
        '..',
        '..',
        'demo1',
        'images',
        'crystalball-1500.png'
      )
    );
    const walkerSize = readPngSize(
      resolve(
        import.meta.dirname,
        '..',
        '..',
        'demo1',
        'images',
        'globe-1500.png'
      )
    );
    const cautionSize = readPngSize(
      resolve(
        import.meta.dirname,
        '..',
        '..',
        'demo1',
        'images',
        'fullmoon-500.png'
      )
    );
    const carSize = readPngSize(
      resolve(
        import.meta.dirname,
        '..',
        '..',
        'demo1',
        'images',
        'star-300.png'
      )
    );

    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      viewSize,
      gl,
      {
        program: {} as WebGLProgram,
        buffer: {} as WebGLBuffer,
        indexBuffer: {} as WebGLBuffer,
        indexBufferSpriteCapacity: 16383,
        positionLocation: 0,
        texCoordLocation: 1,
        opacityAttributeLocation: 2,
        textureLocation: {} as WebGLUniformLocation,
        opacityLocation: {} as WebGLUniformLocation,
        viewProjectionLocation: {} as WebGLUniformLocation,
      },
      wasmInstance
    );

    try {
      const images = [
        { imageId: 'curve', ...curveSize },
        { imageId: 'walker', ...walkerSize },
        { imageId: 'caution', ...cautionSize },
        { imageId: 'car', ...carSize },
      ] as const;
      const atlasSize = resolveAtlasSize(images);
      const atlasId = renderer.allocateAtlas(atlasSize);
      await renderer.registerImage(
        atlasId,
        images[0].imageId,
        createFakeBitmap(images[0].width, images[0].height)
      );
      await renderer.registerImage(
        atlasId,
        images[1].imageId,
        createFakeBitmap(images[1].width, images[1].height)
      );
      await renderer.registerImage(
        atlasId,
        images[2].imageId,
        createFakeBitmap(images[2].width, images[2].height)
      );
      await renderer.registerImage(
        atlasId,
        images[3].imageId,
        createFakeBitmap(images[3].width, images[3].height)
      );

      const baseImages = [images[0], images[1]] as const;
      const cellWidth = Math.max(baseImages[0].width, baseImages[1].width);
      const cellHeight = Math.max(baseImages[0].height, baseImages[1].height);
      const gridSize = 205;
      const spriteCount = gridSize * gridSize;
      const sceneHalfExtent = Math.max(cellWidth, cellHeight) * gridSize * 0.5;
      const initialFov = 45;
      const initialDistance =
        viewSize.heightPixel / 2 / Math.tan((initialFov * Math.PI) / 360);
      const layoutScale = Math.min(
        viewSize.widthPixel / (gridSize * cellWidth),
        viewSize.heightPixel / (gridSize * cellHeight)
      );
      const cameraScaleCompensation = layoutScale > 0 ? 1 / layoutScale : 1;
      renderer.updateCamera({
        position: {
          x: { value: 0 },
          y: { value: 0 },
          z: { value: initialDistance * cameraScaleCompensation },
        },
        rotation: {
          yaw: { value: 0 },
          pitch: { value: 0 },
          roll: { value: 0 },
        },
        fovY: { value: initialFov },
        near: 0.1,
        far: Math.max(10000, Math.abs(initialDistance) + sceneHalfExtent * 4),
      });

      const moveInterpolation: ObjectInterpolationParameter = {
        mode: 'feedback',
        durationMs: 500,
        easing: { type: 'linear' },
      };
      const rotationInterpolation: ObjectInterpolationParameter = {
        mode: 'feedback',
        durationMs: 500,
        easing: {
          type: 'sigmoid',
          k: 14,
          mid: 0.35,
        } satisfies ObjectInterpolationSigmoidEasing,
      };

      const elementRenderMode: SpriteElementRenderMode = 'billboard';
      const elementScale = 1;
      const hiddenElement = (
        imageId: string,
        originLocationIndex: number
      ): SpriteElementPlacement => ({
        imageId,
        originLocation: { index: originLocationIndex },
        scale: { value: elementScale },
        anchorX: { value: 0 },
        anchorY: { value: 0 },
        shiftDistance: { value: 0 },
        shiftAngleDeg: { value: 0 },
        opacity: { value: 0 },
        rotation: { value: 0 },
        layer: 0,
        mode: 'surface',
      });

      const spriteMeta: Array<{
        baseY: number;
        stepY: number;
        columnIndex: number;
        imageId: string;
      }> = [];
      const addPromises: Promise<number>[] = [];
      for (let yIndex = 0; yIndex < gridSize; yIndex += 1) {
        for (let xIndex = 0; xIndex < gridSize; xIndex += 1) {
          const image =
            (xIndex + yIndex) % 2 === 0 ? baseImages[0] : baseImages[1];
          const position = getGridPosition(
            gridSize,
            cellWidth,
            cellHeight,
            xIndex,
            yIndex
          );
          const elements: SpriteElementPlacement[] = [
            {
              imageId: image.imageId,
              scale: { value: elementScale },
              layer: 0,
              mode: elementRenderMode,
            },
            hiddenElement('caution', 0),
            hiddenElement('car', 1),
          ];
          const addPromise = renderer.addSprite(
            {
              sx: { value: position.x },
              sy: { value: position.y },
              opacity: { value: 1 },
              elements,
            },
            true
          );
          addPromises.push(addPromise);
          spriteMeta.push({
            baseY: position.y,
            stepY: image.height * 0.25,
            columnIndex: xIndex,
            imageId: image.imageId,
          });
        }
      }

      appendFileSync(
        analysisPath,
        `sprites=${spriteCount} gridSize=${gridSize} view=${viewSize.widthPixel}x${viewSize.heightPixel}\n`
      );
      renderer.render();
      const spriteIds = await Promise.all(addPromises);
      expect(spriteIds.length).toBe(spriteCount);

      for (let index = 0; index < spriteIds.length; index += 1) {
        const spriteId = spriteIds[index]!;
        const meta = spriteMeta[index]!;
        const direction = meta.columnIndex % 2 === 0 ? 1 : -1;
        const offset = direction * meta.stepY * 1 * 1;
        renderer.updateSprite(spriteId, {
          sy: {
            value: meta.baseY + offset,
            interpolation: moveInterpolation,
          },
          opacity: { value: 1, interpolation: null },
          elements: [
            {
              imageId: meta.imageId,
              layer: 0,
              mode: elementRenderMode,
              shiftDistance: { value: 0, interpolation: null },
              shiftAngleDeg: { value: 0, interpolation: null },
              scale: { value: elementScale, interpolation: null },
              rotation: {
                value: 0,
                interpolation: rotationInterpolation,
              },
              autoDirection: {
                space: 'world',
                mode: { type: 'rotation' },
                minDistance: 0,
              },
            },
          ],
        });
      }
      renderer.render();

      globalWithElementAnimProfile.outputElementAnimProfile = true;
      globalWithElementAnimProfile.elementAnimProfileSink = (message) => {
        appendFileSync(logPath, `${message}\n`);
      };

      const frames = 20;
      const frameStepMs = 16;
      for (let frame = 0; frame < frames; frame += 1) {
        renderer.render();
        await new Promise((resolve) => setTimeout(resolve, frameStepMs));
      }

      globalWithElementAnimProfile.outputElementAnimProfile = false;
      globalWithElementAnimProfile.elementAnimProfileSink = undefined;

      const logContent = readFileSync(logPath, 'utf-8');
      const samples = parseElementAnimLog(logContent);
      expect(samples.length).toBeGreaterThan(0);

      const totals = {
        totalMs: 0,
        ownerMs: 0,
        opacityMs: 0,
        rotationMs: 0,
        scaleMs: 0,
        anchorMs: 0,
        shiftMs: 0,
        pivotMs: 0,
        mergeMs: 0,
        scalarMs: 0,
        simdMs: 0,
        simdOtherMs: 0,
        setupOtherMs: 0,
        otherMs: 0,
      };
      samples.forEach((sample) => {
        totals.totalMs += sample.totalMs;
        totals.ownerMs += sample.ownerMs;
        totals.opacityMs += sample.opacityMs;
        totals.rotationMs += sample.rotationMs;
        totals.scaleMs += sample.scaleMs;
        totals.anchorMs += sample.anchorMs;
        totals.shiftMs += sample.shiftMs;
        totals.pivotMs += sample.pivotMs;
        totals.mergeMs += sample.mergeMs;
        totals.scalarMs += sample.scalarMs;
        totals.simdMs += sample.simdMs;
        totals.simdOtherMs += sample.simdOtherMs;
        totals.setupOtherMs += sample.setupOtherMs;
        totals.otherMs += sample.otherMs;
      });
      const count = samples.length;
      const averages = {
        totalMs: totals.totalMs / count,
        ownerMs: totals.ownerMs / count,
        opacityMs: totals.opacityMs / count,
        rotationMs: totals.rotationMs / count,
        scaleMs: totals.scaleMs / count,
        anchorMs: totals.anchorMs / count,
        shiftMs: totals.shiftMs / count,
        pivotMs: totals.pivotMs / count,
        mergeMs: totals.mergeMs / count,
        scalarMs: totals.scalarMs / count,
        simdMs: totals.simdMs / count,
        simdOtherMs: totals.simdOtherMs / count,
        setupOtherMs: totals.setupOtherMs / count,
        otherMs: totals.otherMs / count,
      };
      const breakdown = [
        { label: 'owner', value: averages.ownerMs },
        { label: 'opacity', value: averages.opacityMs },
        { label: 'rotation', value: averages.rotationMs },
        { label: 'scale', value: averages.scaleMs },
        { label: 'anchor', value: averages.anchorMs },
        { label: 'shift', value: averages.shiftMs },
        { label: 'pivot', value: averages.pivotMs },
        { label: 'merge', value: averages.mergeMs },
        { label: 'scalar', value: averages.scalarMs },
        { label: 'simd_other', value: averages.simdOtherMs },
        { label: 'setup_other', value: averages.setupOtherMs },
      ]
        .map((entry) => ({
          ...entry,
          ratio: averages.totalMs > 0 ? entry.value / averages.totalMs : 0,
        }))
        .sort((a, b) => b.value - a.value);

      appendFileSync(analysisPath, `samples=${count}\n`);
      appendFileSync(
        analysisPath,
        `avg_total_ms=${averages.totalMs.toFixed(3)}\n`
      );
      appendFileSync(
        analysisPath,
        `avg_simd_ms=${averages.simdMs.toFixed(3)}\n`
      );
      appendFileSync(
        analysisPath,
        `avg_simd_other_ms=${averages.simdOtherMs.toFixed(3)}\n`
      );
      appendFileSync(
        analysisPath,
        `avg_setup_other_ms=${averages.setupOtherMs.toFixed(3)}\n`
      );
      appendFileSync(
        analysisPath,
        `avg_other_ms=${averages.otherMs.toFixed(3)}\n`
      );
      breakdown.forEach((entry) => {
        appendFileSync(
          analysisPath,
          `avg_${entry.label}_ms=${entry.value.toFixed(3)} (${(
            entry.ratio * 100
          ).toFixed(1)}%)\n`
        );
      });
    } finally {
      globalWithElementAnimProfile.outputElementAnimProfile = previousOutput;
      globalWithElementAnimProfile.elementAnimProfileSink = previousSink;
      renderer.release();
    }
  }, 120000);
});
