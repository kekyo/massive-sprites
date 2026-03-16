// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { appendFileSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { describe, expect, it, vi } from 'vitest';

import * as cl from '../src/generated/command-layout.generated';
import * as wl from '../src/generated/wasm-layout.generated';
import { createObjectRenderer as createCoreObjectRenderer } from '../src/renderer';
import { loadWasmModule } from '../src/wasm';
import { toDegrees } from '../src/utils';
import type {
  PolylinePlacement,
  SpritePlacement,
  ObjectRendererOptions,
  ObjectCameraState,
} from '../src/types';
import { createFakeWasmModule } from './helpers/fake-wasm-module';
import {
  createFakeBitmap,
  createFakeGL,
  createPlacement,
} from './helpers/object-renderer-test-kit';
import { getTestResultsDir } from './helpers/test-log-paths';

const appendAnalysisLog = (outputDir: string, line: string) => {
  appendFileSync(resolve(outputDir, 'analysis.log'), `${line}\n`);
};

const createRendererResources = () => ({
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
});

const createObjectRenderer = (
  viewPortSize: Parameters<typeof createCoreObjectRenderer>[0],
  gl: WebGLRenderingContext,
  resources: ReturnType<typeof createRendererResources>,
  wasmModule: Parameters<typeof createCoreObjectRenderer>[1],
  options?: ObjectRendererOptions
) => {
  void resources;
  const renderer = createCoreObjectRenderer(viewPortSize, wasmModule, options);
  renderer.attachWebGL(gl);
  return renderer;
};

const allocateDefaultAtlas = (
  renderer: ReturnType<typeof createObjectRenderer>
) =>
  renderer.allocateAtlas({
    widthPixel: 512,
    heightPixel: 512,
  });

const createRendererWithSingleSprite = async (
  wasmModule: Parameters<typeof createObjectRenderer>[3],
  placement: SpritePlacement
) => {
  const { gl } = createFakeGL();
  const renderer = createObjectRenderer(
    { widthPixel: 320, heightPixel: 240 },
    gl,
    createRendererResources(),
    wasmModule
  );
  const atlasId = allocateDefaultAtlas(renderer);
  await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(100, 100));
  const addPromise = renderer.addSprite(placement, true) as Promise<number>;
  renderer.render();
  const spriteId = await addPromise;
  renderer.render();
  return { renderer, spriteId };
};

const createRawRgbaSource = (
  width: number,
  height: number,
  alphaAt: (x: number, y: number) => number
) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset + 0] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alphaAt(x, y);
    }
  }
  return { width, height, data } as unknown as TexImageSource;
};

const createCanvasLikeRgbaSource = (
  width: number,
  height: number,
  alphaAt: (x: number, y: number) => number
) => {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const offset = (y * width + x) * 4;
      data[offset + 0] = 255;
      data[offset + 1] = 255;
      data[offset + 2] = 255;
      data[offset + 3] = alphaAt(x, y);
    }
  }
  return {
    width,
    height,
    rgbaData: data,
  } as unknown as TexImageSource;
};

const installPickMaskImageSourceCanvas = () => {
  const FakeOffscreenCanvas = class {
    width: number;
    height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext(type: string) {
      if (type !== '2d') {
        return null;
      }
      let source:
        | {
            readonly rgbaData?: Uint8ClampedArray;
          }
        | undefined;
      return {
        clearRect: () => {
          source = undefined;
        },
        drawImage: (imageSource: { readonly rgbaData?: Uint8ClampedArray }) => {
          source = imageSource;
        },
        getImageData: () => ({
          data:
            source?.rgbaData ??
            new Uint8ClampedArray(this.width * this.height * 4),
        }),
      } as unknown as OffscreenCanvasRenderingContext2D;
    }
  };
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
};

const requireProjectedWorldPoint = (
  renderer: ReturnType<typeof createObjectRenderer>,
  world: { x: number; y: number; z: number }
) => {
  const projected = renderer.projectWorldToViewport(world);
  if (!projected) {
    throw new Error('Expected projected world point.');
  }
  return projected;
};

const getQuadVerticalScreenSamples = (
  renderer: ReturnType<typeof createObjectRenderer>,
  buffer: Float32Array,
  spriteIndex = 0
) => {
  const [lb, rb, lt, rt] = getSpriteVertices(buffer, spriteIndex);
  const projectVertex = (vertex: { x: number; y: number; z: number }) =>
    requireProjectedWorldPoint(renderer, {
      x: vertex.x,
      y: vertex.y,
      z: vertex.z,
    });
  const average = (
    lhs: { xPixel: number; yPixel: number },
    rhs: { xPixel: number; yPixel: number }
  ) => ({
    xPixel: (lhs.xPixel + rhs.xPixel) * 0.5,
    yPixel: (lhs.yPixel + rhs.yPixel) * 0.5,
  });
  const lerp = (
    from: { xPixel: number; yPixel: number },
    to: { xPixel: number; yPixel: number },
    t: number
  ) => ({
    xPixel: from.xPixel + (to.xPixel - from.xPixel) * t,
    yPixel: from.yPixel + (to.yPixel - from.yPixel) * t,
  });

  const projected = [lb, rb, lt, rt]
    .map(projectVertex)
    .sort((lhs, rhs) => lhs.yPixel - rhs.yPixel);
  const upperVertices = projected.slice(0, 2);
  const lowerVertices = projected.slice(2, 4);
  const upper0 = upperVertices[0];
  const upper1 = upperVertices[1];
  const lower0 = lowerVertices[0];
  const lower1 = lowerVertices[1];
  if (!upper0 || !upper1 || !lower0 || !lower1) {
    throw new Error('Expected four projected quad vertices.');
  }

  const topCenter = average(upper0, upper1);
  const bottomCenter = average(lower0, lower1);
  const center = average(bottomCenter, topCenter);

  return {
    upper: lerp(center, topCenter, 0.5),
    lower: lerp(center, bottomCenter, 0.5),
  };
};

const RENDER_FLOATS_PER_VERTEX = 6;
const RENDER_VERTICES_PER_SPRITE = 4;
const RENDER_OUTPUT_STRIDE =
  RENDER_FLOATS_PER_VERTEX * RENDER_VERTICES_PER_SPRITE;

type SpriteVertex = {
  x: number;
  y: number;
  z: number;
  u: number;
  v: number;
  opacity: number;
};

const getSpriteVertices = (
  buffer: Float32Array,
  spriteIndex = 0
): [SpriteVertex, SpriteVertex, SpriteVertex, SpriteVertex] => {
  const base = spriteIndex * RENDER_OUTPUT_STRIDE;
  if (base + RENDER_OUTPUT_STRIDE > buffer.length) {
    throw new Error('Sprite vertex buffer is smaller than expected.');
  }
  const readVertex = (vertexIndex: number) => {
    const offset = base + vertexIndex * RENDER_FLOATS_PER_VERTEX;
    return {
      x: buffer[offset + 0]!,
      y: buffer[offset + 1]!,
      z: buffer[offset + 2]!,
      u: buffer[offset + 3]!,
      v: buffer[offset + 4]!,
      opacity: buffer[offset + 5]!,
    };
  };
  const v0 = readVertex(0);
  const v1 = readVertex(1);
  const v2 = readVertex(2);
  const v3 = readVertex(3);
  return [v0, v1, v2, v3];
};

const getQuadCenter = (buffer: Float32Array, spriteIndex = 0) => {
  const vertices = getSpriteVertices(buffer, spriteIndex);
  const sum = vertices.reduce(
    (acc, vertex) => ({
      x: acc.x + vertex.x,
      y: acc.y + vertex.y,
      z: acc.z + vertex.z,
    }),
    { x: 0, y: 0, z: 0 }
  );
  return {
    x: sum.x / vertices.length,
    y: sum.y / vertices.length,
    z: sum.z / vertices.length,
  };
};

const getQuadExtents = (buffer: Float32Array) => {
  const quads: Array<{
    left: number;
    right: number;
    top: number;
    bottom: number;
  }> = [];
  const spriteCount = Math.floor(buffer.length / RENDER_OUTPUT_STRIDE);
  for (let index = 0; index < spriteCount; index += 1) {
    const vertices = getSpriteVertices(buffer, index);
    const xs = vertices.map((vertex) => vertex.x);
    const ys = vertices.map((vertex) => vertex.y);
    quads.push({
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys),
    });
  }
  return quads;
};

const getCombinedQuadExtents = (buffer: Float32Array) => {
  const quads = getQuadExtents(buffer);
  return quads.reduce(
    (acc, quad) => ({
      left: Math.min(acc.left, quad.left),
      right: Math.max(acc.right, quad.right),
      top: Math.min(acc.top, quad.top),
      bottom: Math.max(acc.bottom, quad.bottom),
    }),
    {
      left: Number.POSITIVE_INFINITY,
      right: Number.NEGATIVE_INFINITY,
      top: Number.POSITIVE_INFINITY,
      bottom: Number.NEGATIVE_INFINITY,
    }
  );
};

const getPolylineExtents = (buffer: Float32Array) => {
  if (buffer.length < wl.POLYLINE_OUTPUT_STRIDE) {
    throw new Error('Polyline vertex buffer is smaller than expected.');
  }
  const stride = wl.POLYLINE_OUTPUT_STRIDE;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let index = 0; index < buffer.length; index += stride) {
    xs.push(buffer[index]!);
    ys.push(buffer[index + 1]!);
  }
  return {
    left: Math.min(...xs),
    right: Math.max(...xs),
    top: Math.min(...ys),
    bottom: Math.max(...ys),
  };
};

const getPolylineVertexCount = (buffer: Float32Array) =>
  Math.floor(buffer.length / wl.POLYLINE_OUTPUT_STRIDE);

type EdgePoint = {
  x: number;
  y: number;
  z: number;
};

type EdgeSegment = {
  start: EdgePoint;
  end: EdgePoint;
};

const midpoint = (lhs: EdgePoint, rhs: EdgePoint): EdgePoint => ({
  x: (lhs.x + rhs.x) * 0.5,
  y: (lhs.y + rhs.y) * 0.5,
  z: (lhs.z + rhs.z) * 0.5,
});

const getBorderSegments = (buffer: Float32Array): EdgeSegment[] => {
  const stride = wl.POLYLINE_OUTPUT_STRIDE;
  const verticesPerSegment = 6;
  const segmentStride = stride * verticesPerSegment;
  const readPoint = (offset: number): EdgePoint => ({
    x: buffer[offset + 0]!,
    y: buffer[offset + 1]!,
    z: buffer[offset + 2]!,
  });
  const segments: EdgeSegment[] = [];
  for (
    let offset = 0;
    offset + segmentStride <= buffer.length;
    offset += segmentStride
  ) {
    const v0 = readPoint(offset);
    const v1 = readPoint(offset + stride);
    const v2 = readPoint(offset + stride * 2);
    const v5 = readPoint(offset + stride * 5);
    segments.push({
      start: midpoint(v0, v1),
      end: midpoint(v2, v5),
    });
  }
  return segments;
};

const getQuadEdges = (buffer: Float32Array, spriteIndex = 0): EdgeSegment[] => {
  const [lb, rb, lt, rt] = getSpriteVertices(buffer, spriteIndex);
  return [
    { start: lb, end: rb },
    { start: rb, end: rt },
    { start: rt, end: lt },
    { start: lt, end: lb },
  ];
};

const pointsClose = (lhs: EdgePoint, rhs: EdgePoint, tolerance = 1.0e-3) =>
  Math.abs(lhs.x - rhs.x) < tolerance &&
  Math.abs(lhs.y - rhs.y) < tolerance &&
  Math.abs(lhs.z - rhs.z) < tolerance;

const expectBorderSegmentsToMatchEdges = (
  borderBuffer: Float32Array,
  expectedEdges: EdgeSegment[]
) => {
  const actualSegments = getBorderSegments(borderBuffer);
  expect(actualSegments).toHaveLength(expectedEdges.length);
  const remaining = [...actualSegments];
  expectedEdges.forEach((expectedEdge) => {
    const matchIndex = remaining.findIndex(
      (segment) =>
        (pointsClose(segment.start, expectedEdge.start) &&
          pointsClose(segment.end, expectedEdge.end)) ||
        (pointsClose(segment.start, expectedEdge.end) &&
          pointsClose(segment.end, expectedEdge.start))
    );
    expect(matchIndex).toBeGreaterThanOrEqual(0);
    remaining.splice(matchIndex, 1);
  });
};

const expectCloseTo = (
  actual: number,
  expected: number,
  tolerance = 1.0e-3
) => {
  expect(Math.abs(actual - expected)).toBeLessThan(tolerance);
};

const normalizeAngle = (value: number) => {
  const twoPi = Math.PI * 2;
  let angle = value % twoPi;
  if (angle > Math.PI) {
    angle -= twoPi;
  } else if (angle < -Math.PI) {
    angle += twoPi;
  }
  return angle;
};

const angleDiff = (lhs: number, rhs: number) =>
  Math.abs(normalizeAngle(lhs - rhs));

const unwrapAngles = (angles: number[]) => {
  if (angles.length === 0) {
    return [];
  }
  const unwrapped = [angles[0]!];
  for (let index = 1; index < angles.length; index += 1) {
    const current = angles[index]!;
    const prevWrapped = angles[index - 1]!;
    const prev = unwrapped[index - 1]!;
    const delta = normalizeAngle(current - prevWrapped);
    unwrapped.push(prev + delta);
  }
  return unwrapped;
};

const buildScreenLerpSvg = (
  samples: Array<{ tMs: number; actualRad: number; expectedRad: number }>,
  title: string
) => {
  const width = 960;
  const plotWidth = 820;
  const plotHeight = 260;
  const leftX = 90;
  const topY = 50;
  const height = topY + plotHeight + 50;
  const values: number[] = [];
  samples.forEach((sample) => {
    values.push(toDegrees(sample.actualRad));
    values.push(toDegrees(sample.expectedRad));
  });
  let minValue = Math.min(...values);
  let maxValue = Math.max(...values);
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
    minValue = -180;
    maxValue = 180;
  } else if (Math.abs(maxValue - minValue) < 1.0e-6) {
    minValue -= 1;
    maxValue += 1;
  }
  const timeMax = Math.max(...samples.map((sample) => sample.tMs), 1);
  const valueToY = (value: number) =>
    topY + plotHeight * (1 - (value - minValue) / (maxValue - minValue));
  const buildPath = (points: Array<[number, number]>) => {
    if (points.length === 0) {
      return '';
    }
    return `M ${points
      .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
      .join(' L ')}`;
  };

  const actualPoints: Array<[number, number]> = [];
  const expectedPoints: Array<[number, number]> = [];
  samples.forEach((sample) => {
    const x = leftX + (sample.tMs / timeMax) * plotWidth;
    actualPoints.push([x, valueToY(toDegrees(sample.actualRad))]);
    expectedPoints.push([x, valueToY(toDegrees(sample.expectedRad))]);
  });

  const svg: string[] = [];
  svg.push(
    `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${width}\" height=\"${height}\">`
  );
  svg.push('<rect width=\"100%\" height=\"100%\" fill=\"#ffffff\"/>');
  svg.push(
    `<text x=\"${leftX}\" y=\"24\" font-size=\"13\" text-anchor=\"start\" font-family=\"monospace\">${title}</text>`
  );
  svg.push(
    `<rect x=\"${leftX}\" y=\"${topY}\" width=\"${plotWidth}\" height=\"${plotHeight}\" fill=\"#fafafa\" stroke=\"#dddddd\"/>`
  );
  svg.push(
    `<line x1=\"${leftX}\" y1=\"${topY + plotHeight}\" x2=\"${
      leftX + plotWidth
    }\" y2=\"${topY + plotHeight}\" stroke=\"#999\"/>`
  );
  svg.push(
    `<line x1=\"${leftX}\" y1=\"${topY}\" x2=\"${leftX}\" y2=\"${
      topY + plotHeight
    }\" stroke=\"#999\"/>`
  );
  svg.push(
    `<text x=\"${(leftX + 4).toFixed(2)}\" y=\"${(topY + 14).toFixed(
      2
    )}\" font-size=\"11\" text-anchor=\"start\" font-family=\"monospace\">angle (deg)</text>`
  );
  svg.push(
    `<path d=\"${buildPath(
      actualPoints
    )}\" fill=\"none\" stroke=\"#0074d9\" stroke-width=\"1.2\" />`
  );
  svg.push(
    `<path d=\"${buildPath(
      expectedPoints
    )}\" fill=\"none\" stroke=\"#ff851b\" stroke-width=\"1.2\" />`
  );
  svg.push(
    `<text x=\"${leftX.toFixed(2)}\" y=\"${(topY + plotHeight + 20).toFixed(
      2
    )}\" font-size=\"10\" text-anchor=\"start\" font-family=\"monospace\">blue: actual, orange: expected</text>`
  );
  svg.push(
    `<text x=\"${(leftX + plotWidth - 4).toFixed(2)}\" y=\"${(
      topY +
      plotHeight +
      34
    ).toFixed(
      2
    )}\" font-size=\"10\" text-anchor=\"end\" font-family=\"monospace\">t (ms, 0..${Math.floor(
      timeMax
    )})</text>`
  );
  svg.push('</svg>');
  return svg.join('\n');
};

const createTranslationMatrix = (x: number, y: number, z: number) => [
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  0,
  0,
  0,
  1,
  0,
  x,
  y,
  z,
  1,
];

const transposeMatrix = (matrix: number[]) => [
  matrix[0]!,
  matrix[4]!,
  matrix[8]!,
  matrix[12]!,
  matrix[1]!,
  matrix[5]!,
  matrix[9]!,
  matrix[13]!,
  matrix[2]!,
  matrix[6]!,
  matrix[10]!,
  matrix[14]!,
  matrix[3]!,
  matrix[7]!,
  matrix[11]!,
  matrix[15]!,
];

const multiplyMatrices = (a: number[], b: number[]) => {
  const out = new Array<number>(16).fill(0);
  const a0 = a[0]!;
  const a1 = a[1]!;
  const a2 = a[2]!;
  const a3 = a[3]!;
  const a4 = a[4]!;
  const a5 = a[5]!;
  const a6 = a[6]!;
  const a7 = a[7]!;
  const a8 = a[8]!;
  const a9 = a[9]!;
  const a10 = a[10]!;
  const a11 = a[11]!;
  const a12 = a[12]!;
  const a13 = a[13]!;
  const a14 = a[14]!;
  const a15 = a[15]!;

  for (let column = 0; column < 4; column += 1) {
    const base = column * 4;
    const b0 = b[base]!;
    const b1 = b[base + 1]!;
    const b2 = b[base + 2]!;
    const b3 = b[base + 3]!;
    out[base] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
    out[base + 1] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
    out[base + 2] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
    out[base + 3] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;
  }
  return out;
};

const createRotationZMatrix = (angle: number) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
};

const createRotationXMatrix = (angle: number) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1];
};

const createRotationYMatrix = (angle: number) => {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1];
};

const createRotationZXYMatrix = (yaw: number, pitch: number, roll: number) => {
  const rotZ = createRotationZMatrix(yaw);
  const rotX = createRotationXMatrix(pitch);
  const rotZX = multiplyMatrices(rotZ, rotX);
  const rotY = createRotationYMatrix(roll);
  return multiplyMatrices(rotZX, rotY);
};

const createPerspectiveMatrix = (
  fovY: number,
  aspectRatio: number,
  near: number,
  far: number
) => {
  const f = 1.0 / Math.tan(fovY / 2.0);
  const nf = 1.0 / (near - far);
  return [
    f / aspectRatio,
    0,
    0,
    0,
    0,
    f,
    0,
    0,
    0,
    0,
    (far + near) * nf,
    -1,
    0,
    0,
    2.0 * far * near * nf,
    0,
  ];
};

const computeViewProjection = (camera: {
  position: { x: number; y: number; z: number };
  rotation: { yaw: number; pitch: number; roll: number };
  fovY: { value: number };
  near: number;
  far: number;
  aspectRatio: number;
}) => {
  const rotationMatrix = createRotationZXYMatrix(
    (camera.rotation.yaw * Math.PI) / 180.0,
    (camera.rotation.pitch * Math.PI) / 180.0,
    (camera.rotation.roll * Math.PI) / 180.0
  );
  const rotationTranspose = transposeMatrix(rotationMatrix);
  const translationMatrix = createTranslationMatrix(
    -camera.position.x,
    -camera.position.y,
    -camera.position.z
  );
  const viewMatrix = multiplyMatrices(rotationTranspose, translationMatrix);
  const projectionMatrix = createPerspectiveMatrix(
    (camera.fovY.value * Math.PI) / 180.0,
    camera.aspectRatio,
    camera.near,
    camera.far
  );
  const viewProjection = multiplyMatrices(projectionMatrix, viewMatrix);
  return { viewMatrix, viewProjection };
};

const projectToNdc = (
  viewProjection: number[],
  x: number,
  y: number,
  z: number
) => {
  const clipX =
    viewProjection[0]! * x +
    viewProjection[4]! * y +
    viewProjection[8]! * z +
    viewProjection[12]!;
  const clipY =
    viewProjection[1]! * x +
    viewProjection[5]! * y +
    viewProjection[9]! * z +
    viewProjection[13]!;
  const clipW =
    viewProjection[3]! * x +
    viewProjection[7]! * y +
    viewProjection[11]! * z +
    viewProjection[15]!;
  if (!Number.isFinite(clipW) || Math.abs(clipW) < 1.0e-6) {
    return { x: Number.NaN, y: Number.NaN, w: clipW };
  }
  return { x: clipX / clipW, y: clipY / clipW, w: clipW };
};

const resolveScreenAngleFromBuffer = (
  viewProjection: number[],
  buffer: Float32Array,
  aspectRatio: number
) => {
  const [lb, rb, lt, rt] = getSpriteVertices(buffer);
  const lbx = lb.x;
  const lby = lb.y;
  const lbz = lb.z;
  const rbx = rb.x;
  const rby = rb.y;
  const rbz = rb.z;
  const ltx = lt.x;
  const lty = lt.y;
  const ltz = lt.z;
  const rtx = rt.x;
  const rty = rt.y;
  const rtz = rt.z;
  const top = projectToNdc(
    viewProjection,
    (ltx + rtx) / 2,
    (lty + rty) / 2,
    (ltz + rtz) / 2
  );
  const bottom = projectToNdc(
    viewProjection,
    (lbx + rbx) / 2,
    (lby + rby) / 2,
    (lbz + rbz) / 2
  );
  const dx = (top.x - bottom.x) * aspectRatio;
  const dy = top.y - bottom.y;
  return Math.atan2(dy, dx);
};

const resolveScreenDirection = (
  viewProjection: number[],
  pivot: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  aspectRatio: number
) => {
  const clipX =
    viewProjection[0]! * pivot.x +
    viewProjection[4]! * pivot.y +
    viewProjection[8]! * pivot.z +
    viewProjection[12]!;
  const clipY =
    viewProjection[1]! * pivot.x +
    viewProjection[5]! * pivot.y +
    viewProjection[9]! * pivot.z +
    viewProjection[13]!;
  const clipW =
    viewProjection[3]! * pivot.x +
    viewProjection[7]! * pivot.y +
    viewProjection[11]! * pivot.z +
    viewProjection[15]!;
  const eps = 1.0e-9;
  const safeW = Math.abs(clipW) < eps ? (clipW < 0 ? -eps : eps) : clipW;
  const dclipX =
    viewProjection[0]! * dir.x +
    viewProjection[4]! * dir.y +
    viewProjection[8]! * dir.z;
  const dclipY =
    viewProjection[1]! * dir.x +
    viewProjection[5]! * dir.y +
    viewProjection[9]! * dir.z;
  const dclipW =
    viewProjection[3]! * dir.x +
    viewProjection[7]! * dir.y +
    viewProjection[11]! * dir.z;
  const invW2 = 1.0 / (safeW * safeW);
  const x = (dclipX * safeW - clipX * dclipW) * invW2;
  const y = (dclipY * safeW - clipY * dclipW) * invW2;
  return {
    x: x * aspectRatio,
    y,
  };
};

const resolveScreenAngleFromWorld = (
  viewProjection: number[],
  pivot: { x: number; y: number; z: number },
  worldAngle: number,
  aspectRatio: number
) => {
  const dirWorld = {
    x: Math.sin(worldAngle),
    y: -Math.cos(worldAngle),
    z: 0,
  };
  const dirScreen = resolveScreenDirection(
    viewProjection,
    pivot,
    dirWorld,
    aspectRatio
  );
  return Math.atan2(dirScreen.y, dirScreen.x);
};

const resolveBillboardBasisFromForward = (
  forwardX: number,
  forwardY: number,
  forwardZ: number
) => {
  let upX = -forwardX * forwardY;
  let upY = 1.0 - forwardY * forwardY;
  let upZ = -forwardZ * forwardY;
  let upLenSq = upX * upX + upY * upY + upZ * upZ;
  if (upLenSq < 1.0e-6) {
    upX = 1.0 - forwardX * forwardX;
    upY = -forwardY * forwardX;
    upZ = -forwardZ * forwardX;
    upLenSq = upX * upX + upY * upY + upZ * upZ;
  }
  if (upLenSq < 1.0e-6) {
    upX = 0.0;
    upY = 1.0;
    upZ = 0.0;
    upLenSq = 1.0;
  }
  const upInvLen = 1.0 / Math.sqrt(upLenSq);
  upX *= upInvLen;
  upY *= upInvLen;
  upZ *= upInvLen;

  let rightX = upY * forwardZ - upZ * forwardY;
  let rightY = upZ * forwardX - upX * forwardZ;
  let rightZ = upX * forwardY - upY * forwardX;
  const rightLenSq = rightX * rightX + rightY * rightY + rightZ * rightZ;
  if (rightLenSq > 0.0) {
    const rightInvLen = 1.0 / Math.sqrt(rightLenSq);
    rightX *= rightInvLen;
    rightY *= rightInvLen;
    rightZ *= rightInvLen;
  }

  const correctedUpX = forwardY * rightZ - forwardZ * rightY;
  const correctedUpY = forwardZ * rightX - forwardX * rightZ;
  const correctedUpZ = forwardX * rightY - forwardY * rightX;
  return {
    right: { x: rightX, y: rightY, z: rightZ },
    up: { x: correctedUpX, y: correctedUpY, z: correctedUpZ },
  };
};

const resolveBillboardEdgeScreenAngle = (
  viewProjection: number[],
  pivot: { x: number; y: number; z: number },
  base: {
    right: { x: number; y: number; z: number };
    up: { x: number; y: number; z: number };
  },
  localRightOffset: number,
  localTop: number,
  localBottom: number,
  angle: number,
  aspectRatio: number
) => {
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const right = {
    x: base.right.x * c - base.up.x * s,
    y: base.right.y * c - base.up.y * s,
    z: base.right.z * c - base.up.z * s,
  };
  const up = {
    x: base.right.x * s + base.up.x * c,
    y: base.right.y * s + base.up.y * c,
    z: base.right.z * s + base.up.z * c,
  };
  const center = {
    x: pivot.x + right.x * localRightOffset,
    y: pivot.y + right.y * localRightOffset,
    z: pivot.z + right.z * localRightOffset,
  };
  const top = projectToNdc(
    viewProjection,
    center.x + up.x * localTop,
    center.y + up.y * localTop,
    center.z + up.z * localTop
  );
  const bottom = projectToNdc(
    viewProjection,
    center.x + up.x * localBottom,
    center.y + up.y * localBottom,
    center.z + up.z * localBottom
  );
  const dx = (top.x - bottom.x) * aspectRatio;
  const dy = top.y - bottom.y;
  return Math.atan2(dy, dx);
};

describe('sprite renderer', () => {
  it('returns undefined when render is called before attach', () => {
    const { instance } = createFakeWasmModule();
    const renderer = createCoreObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      instance
    );
    try {
      expect(renderer.render()).toBeUndefined();
    } finally {
      renderer.release();
    }
  });

  it('returns timestamp when render is called after attach', () => {
    const { instance } = createFakeWasmModule();
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    try {
      const timestamp = renderer.render();
      expect(typeof timestamp).toBe('number');
      expect(Number.isFinite(timestamp)).toBe(true);
    } finally {
      renderer.release();
    }
  });

  it('projects world coordinates to viewport space', () => {
    const { instance } = createFakeWasmModule();
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    try {
      const projected = renderer.projectWorldToViewport({
        x: 12,
        y: 34,
        z: 0,
      });
      expect(projected).toEqual({ xPixel: 12, yPixel: 34 });
    } finally {
      renderer.release();
    }
  });

  it('returns undefined when viewportToWorldOnPlane fails', () => {
    const { instance } = createFakeWasmModule();
    const exports = instance.exports as Record<string, unknown>;
    exports.screen_to_world_on_plane_f32 = () => 0;
    exports.screen_to_world_on_plane_with_camera_f32 = () => 0;
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    try {
      const result = renderer.viewportToWorldOnPlane(
        10,
        20,
        { widthPixel: 320, heightPixel: 240 },
        0
      );
      expect(result).toBeUndefined();
    } finally {
      renderer.release();
    }
  });

  it('returns undefined when projectWorldToViewport fails', () => {
    const { instance } = createFakeWasmModule();
    const exports = instance.exports as Record<string, unknown>;
    exports.project_world_to_viewport_f32 = () => 0;
    exports.project_world_to_viewport_with_camera_f32 = () => 0;
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    try {
      const projected = renderer.projectWorldToViewport({
        x: 12,
        y: 34,
        z: 0,
      });
      expect(projected).toBeUndefined();
    } finally {
      renderer.release();
    }
  });

  it('returns undefined when pickAt misses', () => {
    const { instance } = createFakeWasmModule();
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    try {
      expect(renderer.pickAt(10, 20)).toBeUndefined();
    } finally {
      renderer.release();
    }
  });

  it('includes timestamp in pickAt results', async () => {
    const { instance } = createFakeWasmModule();
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);
    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const spritePromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      const renderTimestamp = renderer.render();
      await spritePromise;
      const result = renderer.pickAt(10, 20);
      if (!result || result.kind !== 'sprite') {
        throw new Error('Expected sprite pick result.');
      }
      expect(result.timestampMs).toBe(renderTimestamp);
    } finally {
      renderer.release();
    }
  });

  it('throws getMaxAtlasSize before attach', () => {
    const { instance } = createFakeWasmModule();
    const renderer = createCoreObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      instance
    );
    try {
      expect(() => renderer.getMaxAtlasSize()).toThrow();
    } finally {
      renderer.release();
    }
  });

  it('reports max atlas size from WebGL', () => {
    const { instance } = createFakeWasmModule();
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    try {
      const maxSize = renderer.getMaxAtlasSize();
      expect(maxSize.widthPixel).toBe(4096);
      expect(maxSize.heightPixel).toBe(4096);
    } finally {
      renderer.release();
    }
  });

  it('keeps render output stable for no-op updates', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const addPromise = renderer.addSprite(
        {
          sx: { value: 10 },
          sy: { value: 20 },
          elements: [{ imageId: 'sprite', scale: { value: 1 } }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const initialBuffer =
        calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(initialBuffer).not.toBeNull();
      const baseline = new Float32Array(initialBuffer!);

      const interpolation = {
        mode: 'feedback' as const,
        durationMs: 1000,
        easing: { type: 'linear' as const },
      };
      const updatePromise = renderer.updateSprite(
        spriteId,
        {
          sx: { value: 10, interpolation },
          sy: { value: 20, interpolation },
          elements: [
            {
              scale: { value: 1, interpolation },
              anchorX: { value: 0, interpolation },
              anchorY: { value: 0, interpolation },
            },
          ],
        },
        true
      ) as Promise<void>;
      renderer.render();
      await updatePromise;

      const updatedBuffer =
        calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(updatedBuffer).not.toBeNull();
      expect(updatedBuffer!.length).toBe(baseline.length);
      for (let i = 0; i < baseline.length; i += 1) {
        expectCloseTo(updatedBuffer![i]!, baseline[i]!);
      }
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('resolves pivots without basis elements', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(
        atlasId,
        'sprite',
        createFakeBitmap(100, 100)
      );
      const addPromise = renderer.addSprite(
        {
          sx: { value: 10 },
          sy: { value: 20 },
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      const buffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(buffer).not.toBeNull();
      expect(buffer!.length).toBe(RENDER_OUTPUT_STRIDE);
      const quad = getQuadExtents(buffer!)[0];
      expect(quad).toBeDefined();
      expectCloseTo(quad!.left, -40);
      expectCloseTo(quad!.right, 60);
      expectCloseTo(quad!.top, -30);
      expectCloseTo(quad!.bottom, 70);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('renders tiled huge sprites with the same transform semantics as normal sprites', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(
        async (
          _source: CanvasImageSource,
          _x: number,
          _y: number,
          width: number,
          height: number
        ) => createFakeBitmap(width, height)
      )
    );
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls, setMaxTextureSize } = createFakeGL();
    setMaxTextureSize(64);
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = renderer.allocateAtlas({
      widthPixel: 32,
      heightPixel: 32,
    });

    try {
      await renderer.registerImage(atlasId, 'giant', createFakeBitmap(150, 90));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 200 },
          sy: { value: 120 },
          elements: [
            {
              imageId: 'giant',
              shiftDistance: { value: 20 },
              shiftAngleDeg: { value: 0 },
              scale: { value: 1.5 },
              opacity: { value: 0.75 },
              anchorX: { value: 1 },
              anchorY: { value: -1 },
              rotation: {
                value: 30,
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      calls.bufferData.length = 0;
      calls.drawSequence.length = 0;
      renderer.render();

      const buffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(buffer).not.toBeNull();
      expect(buffer!.length).toBe(RENDER_OUTPUT_STRIDE * 6);
      const combined = getCombinedQuadExtents(buffer!);

      const pivotX = 200;
      const pivotY = 140;
      const width = 150 * 1.5;
      const height = 90 * 1.5;
      const halfWidth = width * 0.5;
      const halfHeight = height * 0.5;
      const anchorOffsetX = halfWidth;
      const anchorOffsetY = -halfHeight;
      const localLeft = -halfWidth - anchorOffsetX;
      const localTop = -halfHeight - anchorOffsetY;
      const localRight = halfWidth - anchorOffsetX;
      const localBottom = halfHeight - anchorOffsetY;
      const angle = (-30 * Math.PI) / 180.0;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const rotatePoint = (x: number, y: number) => ({
        x: pivotX + x * cos - y * sin,
        y: pivotY + x * sin + y * cos,
      });
      const corners = [
        rotatePoint(localLeft, localBottom),
        rotatePoint(localRight, localBottom),
        rotatePoint(localLeft, localTop),
        rotatePoint(localRight, localTop),
      ];
      const expected = {
        left: Math.min(...corners.map((corner) => corner.x)),
        right: Math.max(...corners.map((corner) => corner.x)),
        top: Math.min(...corners.map((corner) => corner.y)),
        bottom: Math.max(...corners.map((corner) => corner.y)),
      };

      expectCloseTo(combined.left, expected.left);
      expectCloseTo(combined.right, expected.right);
      expectCloseTo(combined.top, expected.top);
      expectCloseTo(combined.bottom, expected.bottom);
      for (let index = 5; index < buffer!.length; index += 6) {
        expectCloseTo(buffer![index]!, 0.75);
      }

      const spriteDraws = calls.drawSequence.filter(
        (entry) => entry.kind === 'sprite'
      );
      expect(spriteDraws).toHaveLength(6);
      expect(spriteDraws.every((entry) => entry.count === 6)).toBe(true);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('picks tiled huge sprites as a single logical element across tiles', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(
        async (
          _source: CanvasImageSource,
          _x: number,
          _y: number,
          width: number,
          height: number
        ) => createFakeBitmap(width, height)
      )
    );
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls, setMaxTextureSize } = createFakeGL();
    setMaxTextureSize(64);
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = renderer.allocateAtlas({
      widthPixel: 32,
      heightPixel: 32,
    });

    try {
      await renderer.registerImage(atlasId, 'giant', createFakeBitmap(150, 90));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 100 },
          sy: { value: 50 },
          elements: [{ imageId: 'giant' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;
      renderer.render();

      const buffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(buffer).not.toBeNull();
      expect(buffer!.length).toBe(RENDER_OUTPUT_STRIDE * 6);
      const resolveProjectedQuadCenter = (spriteIndex: number) => {
        const vertices = getSpriteVertices(buffer!, spriteIndex);
        const projected = vertices.map((vertex) =>
          renderer.projectWorldToViewport({
            x: vertex.x,
            y: vertex.y,
            z: vertex.z,
          })
        );
        if (projected.some((point) => !point)) {
          throw new Error('Expected projected quad vertices.');
        }
        let xPixel = 0;
        let yPixel = 0;
        for (const point of projected) {
          xPixel += point?.xPixel ?? 0;
          yPixel += point?.yPixel ?? 0;
        }
        return {
          xPixel: xPixel / projected.length,
          yPixel: yPixel / projected.length,
        };
      };
      const leftPoint = resolveProjectedQuadCenter(0);
      const rightPoint = resolveProjectedQuadCenter(5);
      if (!leftPoint || !rightPoint) {
        throw new Error('Expected projected hit points.');
      }

      const leftPick = renderer.pickAt(leftPoint.xPixel, leftPoint.yPixel);
      const rightPick = renderer.pickAt(rightPoint.xPixel, rightPoint.yPixel);

      expect(leftPick).toMatchObject({
        kind: 'sprite',
        spriteId,
        elementIndex: 0,
      });
      expect(rightPick).toMatchObject({
        kind: 'sprite',
        spriteId,
        elementIndex: 0,
      });
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('respects sprite scale when picking surface sprites', async () => {
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const baseline = await createRendererWithSingleSprite(instance, {
      sx: { value: 0 },
      sy: { value: 0 },
      elements: [{ imageId: 'sprite', scale: { value: 1 } }],
    });
    const scaled = await createRendererWithSingleSprite(instance, {
      sx: { value: 0 },
      sy: { value: 0 },
      elements: [{ imageId: 'sprite', scale: { value: 2 } }],
    });

    try {
      const hitPoint = requireProjectedWorldPoint(scaled.renderer, {
        x: 70,
        y: 0,
        z: 0,
      });
      const baselinePick = baseline.renderer.pickAt(
        hitPoint.xPixel,
        hitPoint.yPixel
      );
      const scaledPick = scaled.renderer.pickAt(
        hitPoint.xPixel,
        hitPoint.yPixel
      );
      expect(baselinePick).toBeUndefined();
      expect(scaledPick).toMatchObject({
        kind: 'sprite',
        spriteId: scaled.spriteId,
        elementIndex: 0,
      });
    } finally {
      baseline.renderer.release();
      scaled.renderer.release();
    }
  });

  it('respects sprite anchor offsets when picking surface sprites', async () => {
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const baseline = await createRendererWithSingleSprite(instance, {
      sx: { value: 0 },
      sy: { value: 0 },
      elements: [{ imageId: 'sprite' }],
    });
    const anchored = await createRendererWithSingleSprite(instance, {
      sx: { value: 0 },
      sy: { value: 0 },
      elements: [{ imageId: 'sprite', anchorX: { value: 1 } }],
    });

    try {
      const hitPoint = requireProjectedWorldPoint(baseline.renderer, {
        x: 25,
        y: 0,
        z: 0,
      });
      const baselinePick = baseline.renderer.pickAt(
        hitPoint.xPixel,
        hitPoint.yPixel
      );
      const anchoredPick = anchored.renderer.pickAt(
        hitPoint.xPixel,
        hitPoint.yPixel
      );
      expect(baselinePick).toMatchObject({
        kind: 'sprite',
        spriteId: baseline.spriteId,
        elementIndex: 0,
      });
      expect(anchoredPick).toBeUndefined();
    } finally {
      baseline.renderer.release();
      anchored.renderer.release();
    }
  });

  it('respects sprite rotation when picking surface sprites', async () => {
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const baseline = await createRendererWithSingleSprite(instance, {
      sx: { value: 0 },
      sy: { value: 0 },
      elements: [{ imageId: 'sprite' }],
    });
    const rotated = await createRendererWithSingleSprite(instance, {
      sx: { value: 0 },
      sy: { value: 0 },
      elements: [
        {
          imageId: 'sprite',
          rotation: {
            value: 45,
          },
        },
      ],
    });

    try {
      const hitPoint = requireProjectedWorldPoint(rotated.renderer, {
        x: 0,
        y: 60,
        z: 0,
      });
      const baselinePick = baseline.renderer.pickAt(
        hitPoint.xPixel,
        hitPoint.yPixel
      );
      const rotatedPick = rotated.renderer.pickAt(
        hitPoint.xPixel,
        hitPoint.yPixel
      );
      expect(baselinePick).toBeUndefined();
      expect(rotatedPick).toMatchObject({
        kind: 'sprite',
        spriteId: rotated.spriteId,
        elementIndex: 0,
      });
    } finally {
      baseline.renderer.release();
      rotated.renderer.release();
    }
  });

  it('respects atlas pick-mask alpha thresholds when picking surface sprites', async () => {
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const source = createRawRgbaSource(100, 100, (x, y) =>
      x >= 20 && x < 80 && y >= 20 && y < 80 ? 255 : 0
    );
    const createMaskedRenderer = async (
      pickMask:
        | {
            readonly alphaThreshold?: number;
          }
        | undefined
    ) => {
      const { gl } = createFakeGL();
      const renderer = createObjectRenderer(
        { widthPixel: 320, heightPixel: 240 },
        gl,
        createRendererResources(),
        instance
      );
      const atlasId = renderer.allocateAtlas(
        pickMask
          ? {
              widthPixel: 128,
              heightPixel: 128,
              paddingPixel: 0,
              pickMask,
            }
          : {
              widthPixel: 128,
              heightPixel: 128,
              paddingPixel: 0,
            }
      );
      await renderer.registerImage(atlasId, 'sprite', source);
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;
      renderer.render();
      return { renderer, spriteId };
    };
    const baseline = await createMaskedRenderer(undefined);
    const masked = await createMaskedRenderer({ alphaThreshold: 1 });

    try {
      const opaquePoint = requireProjectedWorldPoint(masked.renderer, {
        x: 0,
        y: 0,
        z: 0,
      });
      const transparentPoint = requireProjectedWorldPoint(masked.renderer, {
        x: 45,
        y: 0,
        z: 0,
      });

      expect(
        baseline.renderer.pickAt(
          transparentPoint.xPixel,
          transparentPoint.yPixel
        )
      ).toMatchObject({
        kind: 'sprite',
        spriteId: baseline.spriteId,
        elementIndex: 0,
      });
      expect(
        masked.renderer.pickAt(opaquePoint.xPixel, opaquePoint.yPixel)
      ).toMatchObject({
        kind: 'sprite',
        spriteId: masked.spriteId,
        elementIndex: 0,
      });
      expect(
        masked.renderer.pickAt(transparentPoint.xPixel, transparentPoint.yPixel)
      ).toBeUndefined();
    } finally {
      baseline.renderer.release();
      masked.renderer.release();
    }
  });

  it('keeps pick-mask vertical orientation for surface sprites', async () => {
    installPickMaskImageSourceCanvas();
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const source = createCanvasLikeRgbaSource(100, 100, (_x, y) =>
      y < 50 ? 255 : 0
    );
    const createMaskedRenderer = async (
      pickMask:
        | {
            readonly alphaThreshold?: number;
          }
        | undefined
    ) => {
      const { gl, calls } = createFakeGL();
      const renderer = createObjectRenderer(
        { widthPixel: 320, heightPixel: 240 },
        gl,
        createRendererResources(),
        instance
      );
      const atlasId = renderer.allocateAtlas(
        pickMask
          ? {
              widthPixel: 128,
              heightPixel: 128,
              paddingPixel: 0,
              pickMask,
            }
          : {
              widthPixel: 128,
              heightPixel: 128,
              paddingPixel: 0,
            }
      );
      await renderer.registerImage(atlasId, 'sprite', source);
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;
      renderer.render();
      const buffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      if (!buffer) {
        throw new Error('Expected sprite vertex buffer.');
      }
      return { renderer, spriteId, buffer };
    };
    const baseline = await createMaskedRenderer(undefined);
    const masked = await createMaskedRenderer({ alphaThreshold: 1 });

    try {
      const baselineSamples = getQuadVerticalScreenSamples(
        baseline.renderer,
        baseline.buffer
      );
      const maskedSamples = getQuadVerticalScreenSamples(
        masked.renderer,
        masked.buffer
      );

      expect(
        baseline.renderer.pickAt(
          baselineSamples.upper.xPixel,
          baselineSamples.upper.yPixel
        )
      ).toMatchObject({
        kind: 'sprite',
        spriteId: baseline.spriteId,
        elementIndex: 0,
      });
      expect(
        baseline.renderer.pickAt(
          baselineSamples.lower.xPixel,
          baselineSamples.lower.yPixel
        )
      ).toMatchObject({
        kind: 'sprite',
        spriteId: baseline.spriteId,
        elementIndex: 0,
      });
      expect(
        masked.renderer.pickAt(
          maskedSamples.upper.xPixel,
          maskedSamples.upper.yPixel
        )
      ).toMatchObject({
        kind: 'sprite',
        spriteId: masked.spriteId,
        elementIndex: 0,
      });
      expect(
        masked.renderer.pickAt(
          maskedSamples.lower.xPixel,
          maskedSamples.lower.yPixel
        )
      ).toBeUndefined();
    } finally {
      baseline.renderer.release();
      masked.renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('keeps pick-mask vertical orientation for billboard sprites with anchor offsets', async () => {
    installPickMaskImageSourceCanvas();
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const source = createCanvasLikeRgbaSource(100, 100, (_x, y) =>
      y < 50 ? 255 : 0
    );
    const createMaskedRenderer = async (
      pickMask:
        | {
            readonly alphaThreshold?: number;
          }
        | undefined
    ) => {
      const { gl, calls } = createFakeGL();
      const renderer = createObjectRenderer(
        { widthPixel: 320, heightPixel: 240 },
        gl,
        createRendererResources(),
        instance
      );
      const atlasId = renderer.allocateAtlas(
        pickMask
          ? {
              widthPixel: 128,
              heightPixel: 128,
              paddingPixel: 0,
              pickMask,
            }
          : {
              widthPixel: 128,
              heightPixel: 128,
              paddingPixel: 0,
            }
      );
      await renderer.registerImage(atlasId, 'sprite', source);
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [
            {
              imageId: 'sprite',
              mode: 'billboard',
              anchorY: { value: -0.9 },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;
      renderer.render();
      const buffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      if (!buffer) {
        throw new Error('Expected sprite vertex buffer.');
      }
      return { renderer, spriteId, buffer };
    };
    const baseline = await createMaskedRenderer(undefined);
    const masked = await createMaskedRenderer({ alphaThreshold: 1 });

    try {
      const baselineSamples = getQuadVerticalScreenSamples(
        baseline.renderer,
        baseline.buffer
      );
      const maskedSamples = getQuadVerticalScreenSamples(
        masked.renderer,
        masked.buffer
      );

      expect(
        baseline.renderer.pickAt(
          baselineSamples.upper.xPixel,
          baselineSamples.upper.yPixel
        )
      ).toMatchObject({
        kind: 'sprite',
        spriteId: baseline.spriteId,
        elementIndex: 0,
      });
      expect(
        baseline.renderer.pickAt(
          baselineSamples.lower.xPixel,
          baselineSamples.lower.yPixel
        )
      ).toMatchObject({
        kind: 'sprite',
        spriteId: baseline.spriteId,
        elementIndex: 0,
      });
      expect(
        masked.renderer.pickAt(
          maskedSamples.upper.xPixel,
          maskedSamples.upper.yPixel
        )
      ).toMatchObject({
        kind: 'sprite',
        spriteId: masked.spriteId,
        elementIndex: 0,
      });
      expect(
        masked.renderer.pickAt(
          maskedSamples.lower.xPixel,
          maskedSamples.lower.yPixel
        )
      ).toBeUndefined();
    } finally {
      baseline.renderer.release();
      masked.renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('renders leaderline before sprites with expected geometry', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(10, 10));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [
            {
              imageId: 'sprite',
              shiftDistance: { value: 10 },
              shiftAngleDeg: { value: 90 },
              leaderline: {
                width: { value: 2 },
                color: '#ff0000',
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      expect(calls.bufferData.length).toBeGreaterThanOrEqual(2);
      const leaderlineBuffer = calls.bufferData[0] ?? null;
      expect(leaderlineBuffer).not.toBeNull();
      expect(leaderlineBuffer!.length).toBe(wl.POLYLINE_OUTPUT_STRIDE * 6);
      const stride = wl.POLYLINE_OUTPUT_STRIDE;
      const xs: number[] = [];
      const ys: number[] = [];
      for (let i = 0; i < leaderlineBuffer!.length; i += stride) {
        xs.push(leaderlineBuffer![i]!);
        ys.push(leaderlineBuffer![i + 1]!);
      }
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      expectCloseTo(minX, 0);
      expectCloseTo(maxX, 10);
      expectCloseTo(minY, -1);
      expectCloseTo(maxY, 1);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('draws leaderline between lower and higher order sprites', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasFront = allocateDefaultAtlas(renderer);
    const atlasBack = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(
        atlasFront,
        'front',
        createFakeBitmap(10, 10)
      );
      await renderer.registerImage(
        atlasBack,
        'parent',
        createFakeBitmap(10, 10)
      );
      await renderer.registerImage(
        atlasBack,
        'child',
        createFakeBitmap(10, 10)
      );
      const frontPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'front', order: 1 }],
        },
        true
      ) as Promise<number>;
      const leaderPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [
            { imageId: 'parent', order: 2 },
            {
              imageId: 'child',
              order: 4,
              originLocation: { index: 0 },
              shiftDistance: { value: 10 },
              shiftAngleDeg: { value: 90 },
              leaderline: {
                width: { value: 2 },
                color: '#ffffff',
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await Promise.all([frontPromise, leaderPromise]);

      const sequence = calls.drawSequence;
      const polylineIndex = sequence.findIndex(
        (entry) => entry.kind === 'polyline'
      );
      expect(polylineIndex).toBeGreaterThanOrEqual(0);
      const spriteIndices = sequence
        .map((entry, index) => (entry.kind === 'sprite' ? index : -1))
        .filter((index) => index >= 0);
      expect(spriteIndices.length).toBeGreaterThanOrEqual(2);
      const firstSprite = Math.min(...spriteIndices);
      const lastSprite = Math.max(...spriteIndices);
      expect(polylineIndex).toBeGreaterThan(firstSprite);
      expect(polylineIndex).toBeLessThan(lastSprite);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('renders border segments on transformed surface sprite edges', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(
        atlasId,
        'sprite',
        createFakeBitmap(100, 100)
      );
      const addPromise = renderer.addSprite(
        {
          sx: { value: 25 },
          sy: { value: -10 },
          elements: [
            {
              imageId: 'sprite',
              scale: { value: 1.5 },
              anchorX: { value: 0.4 },
              anchorY: { value: -0.2 },
              rotation: { value: 35 },
              border: {
                width: 6,
                color: '#ff6600',
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      calls.bufferData.length = 0;
      renderer.render();

      expect(calls.bufferData.length).toBeGreaterThanOrEqual(2);
      const borderBuffer =
        calls.bufferData.find(
          (buffer) => buffer.length === wl.POLYLINE_OUTPUT_STRIDE * 24
        ) ?? null;
      const spriteBuffer =
        calls.bufferData.find(
          (buffer) => buffer.length === RENDER_OUTPUT_STRIDE
        ) ?? null;
      expect(borderBuffer).not.toBeNull();
      expect(spriteBuffer).not.toBeNull();
      expect(getPolylineVertexCount(borderBuffer!)).toBe(24);
      expectBorderSegmentsToMatchEdges(
        borderBuffer!,
        getQuadEdges(spriteBuffer!)
      );
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('renders border segments on transformed billboard perspective edges', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(
        atlasId,
        'sprite',
        createFakeBitmap(80, 120)
      );
      const addPromise = renderer.addSprite(
        {
          sx: { value: 40 },
          sy: { value: 30 },
          elements: [
            {
              imageId: 'sprite',
              mode: 'billboard_perspective',
              scale: { value: 1.2 },
              anchorX: { value: -0.3 },
              anchorY: { value: 0.25 },
              rotation: { value: -20 },
              border: {
                width: 4,
                color: '#22aaee',
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      calls.bufferData.length = 0;
      renderer.render();

      expect(calls.bufferData.length).toBeGreaterThanOrEqual(2);
      const borderBuffer =
        calls.bufferData.find(
          (buffer) => buffer.length === wl.POLYLINE_OUTPUT_STRIDE * 24
        ) ?? null;
      const spriteBuffer =
        calls.bufferData.find(
          (buffer) => buffer.length === RENDER_OUTPUT_STRIDE
        ) ?? null;
      expect(borderBuffer).not.toBeNull();
      expect(spriteBuffer).not.toBeNull();
      expect(getPolylineVertexCount(borderBuffer!)).toBe(24);
      expectBorderSegmentsToMatchEdges(
        borderBuffer!,
        getQuadEdges(spriteBuffer!)
      );
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('renders one logical border around tiled huge sprites', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(
        async (
          _source: CanvasImageSource,
          _x: number,
          _y: number,
          width: number,
          height: number
        ) => createFakeBitmap(width, height)
      )
    );
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls, setMaxTextureSize } = createFakeGL();
    setMaxTextureSize(64);
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = renderer.allocateAtlas({
      widthPixel: 32,
      heightPixel: 32,
    });

    try {
      await renderer.registerImage(atlasId, 'giant', createFakeBitmap(150, 90));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 200 },
          sy: { value: 120 },
          elements: [
            {
              imageId: 'giant',
              shiftDistance: { value: 20 },
              shiftAngleDeg: { value: 0 },
              scale: { value: 1.5 },
              anchorX: { value: 1 },
              anchorY: { value: -1 },
              rotation: { value: 30 },
              border: {
                width: 4,
                color: '#ffffff',
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      calls.bufferData.length = 0;
      renderer.render();

      expect(calls.bufferData.length).toBeGreaterThanOrEqual(2);
      const borderBuffer =
        calls.bufferData.find(
          (buffer) => buffer.length === wl.POLYLINE_OUTPUT_STRIDE * 24
        ) ?? null;
      const spriteBuffer =
        calls.bufferData.find(
          (buffer) => buffer.length === RENDER_OUTPUT_STRIDE * 6
        ) ?? null;
      expect(borderBuffer).not.toBeNull();
      expect(spriteBuffer).not.toBeNull();
      expect(spriteBuffer!.length).toBe(RENDER_OUTPUT_STRIDE * 6);
      expect(getPolylineVertexCount(borderBuffer!)).toBe(24);

      const pivotX = 200;
      const pivotY = 140;
      const width = 150 * 1.5;
      const height = 90 * 1.5;
      const halfWidth = width * 0.5;
      const halfHeight = height * 0.5;
      const anchorOffsetX = halfWidth;
      const anchorOffsetY = -halfHeight;
      const localLeft = -halfWidth - anchorOffsetX;
      const localTop = -halfHeight - anchorOffsetY;
      const localRight = halfWidth - anchorOffsetX;
      const localBottom = halfHeight - anchorOffsetY;
      const angle = (-30 * Math.PI) / 180.0;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      const rotatePoint = (x: number, y: number): EdgePoint => ({
        x: pivotX + x * cos - y * sin,
        y: pivotY + x * sin + y * cos,
        z: 0,
      });
      const lb = rotatePoint(localLeft, localBottom);
      const rb = rotatePoint(localRight, localBottom);
      const lt = rotatePoint(localLeft, localTop);
      const rt = rotatePoint(localRight, localTop);
      expectBorderSegmentsToMatchEdges(borderBuffer!, [
        { start: lb, end: rb },
        { start: rb, end: rt },
        { start: rt, end: lt },
        { start: lt, end: lb },
      ]);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('draws border immediately after its sprite before higher-order sprites', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const lowAtlas = allocateDefaultAtlas(renderer);
    const midAtlas = allocateDefaultAtlas(renderer);
    const highAtlas = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(lowAtlas, 'low', createFakeBitmap(20, 20));
      await renderer.registerImage(midAtlas, 'mid', createFakeBitmap(20, 20));
      await renderer.registerImage(highAtlas, 'high', createFakeBitmap(20, 20));
      const lowPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'low', order: 1 }],
        },
        true
      ) as Promise<number>;
      const midPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [
            {
              imageId: 'mid',
              order: 2,
              border: {
                width: 2,
                color: '#ff00ff',
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      const highPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'high', order: 3 }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await Promise.all([lowPromise, midPromise, highPromise]);

      calls.drawSequence.length = 0;
      renderer.render();

      expect(calls.drawSequence.map((entry) => entry.kind)).toEqual([
        'sprite',
        'sprite',
        'polyline',
        'sprite',
      ]);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('writes leaderline vertices with pivot z for billboard parent', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const camera = {
      position: { x: 0, y: -40, z: 120 },
      rotation: { yaw: 0, pitch: 25, roll: 0 },
      fovY: { value: 45 },
      near: 0.1,
      far: 500,
    };
    renderer.updateCamera({
      position: {
        x: { value: camera.position.x },
        y: { value: camera.position.y },
        z: { value: camera.position.z },
      },
      rotation: {
        yaw: { value: camera.rotation.yaw },
        pitch: { value: camera.rotation.pitch },
        roll: { value: camera.rotation.roll },
      },
      fovY: camera.fovY,
      near: camera.near,
      far: camera.far,
    });
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(16, 16));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          sz: 0,
          elements: [
            {
              imageId: 'sprite',
              mode: 'billboard_perspective',
              order: 0,
            },
            {
              imageId: 'sprite',
              originLocation: { index: 0 },
              mode: 'surface',
              order: 1,
              shiftDistance: { value: 12 },
              shiftAngleDeg: { value: 0 },
              leaderline: {
                width: { value: 2 },
                color: '#00ff00',
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;
      calls.bufferData.length = 0;
      renderer.render();

      const leaderlineBuffer = calls.bufferData[0] ?? null;
      expect(leaderlineBuffer).not.toBeNull();
      const stride = wl.POLYLINE_OUTPUT_STRIDE;
      const zs: number[] = [];
      for (let i = 0; i < leaderlineBuffer!.length; i += stride) {
        zs.push(leaderlineBuffer![i + 2]!);
      }
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      expect(maxZ - minZ).toBeGreaterThan(1.0e-3);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('applies leaderline thickness on parent plane', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    renderer.updateCamera({
      position: {
        x: { value: 0 },
        y: { value: -40 },
        z: { value: 120 },
      },
      rotation: {
        yaw: { value: 0 },
        pitch: { value: 25 },
        roll: { value: 0 },
      },
      fovY: { value: 45 },
      near: 0.1,
      far: 500,
    });
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(16, 16));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          sz: 0,
          elements: [
            {
              imageId: 'sprite',
              mode: 'billboard_perspective',
              order: 0,
            },
            {
              imageId: 'sprite',
              originLocation: { index: 0 },
              mode: 'surface',
              order: 1,
              shiftDistance: { value: 12 },
              shiftAngleDeg: { value: 90 },
              leaderline: {
                width: { value: 2 },
                color: '#00ff00',
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;
      calls.bufferData.length = 0;
      renderer.render();

      const leaderlineBuffer = calls.bufferData[0] ?? null;
      expect(leaderlineBuffer).not.toBeNull();
      const stride = wl.POLYLINE_OUTPUT_STRIDE;
      const v0z = leaderlineBuffer![2]!;
      const v1z = leaderlineBuffer![2 + stride]!;
      const v2z = leaderlineBuffer![2 + stride * 2]!;
      const v3z = leaderlineBuffer![2 + stride * 5]!;
      const midStartZ = (v0z + v1z) * 0.5;
      const midEndZ = (v2z + v3z) * 0.5;
      expectCloseTo(midStartZ, midEndZ, 1.0e-3);
      expect(Math.abs(v0z - v1z)).toBeGreaterThan(1.0e-3);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('clamps sprite size at near distances', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance,
      {
        spriteScaling: {
          minScaleDistance: 20,
        },
      }
    );
    renderer.updateCamera({
      position: {
        x: { value: 0 },
        y: { value: 0 },
        z: { value: 10 },
      },
    });
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(10, 10));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          sz: 0,
          elements: [{ imageId: 'sprite', mode: 'surface' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      const buffer = calls.bufferData[0] ?? null;
      expect(buffer).not.toBeNull();
      const quad = getQuadExtents(buffer!)[0]!;
      expectCloseTo(quad.left, -2.5);
      expectCloseTo(quad.right, 2.5);
      expectCloseTo(quad.top, -2.5);
      expectCloseTo(quad.bottom, 2.5);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('clamps sprite growth at far distances', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance,
      {
        spriteScaling: {
          maxScaleDistance: 20,
        },
      }
    );
    renderer.updateCamera({
      position: {
        x: { value: 0 },
        y: { value: 0 },
        z: { value: 40 },
      },
    });
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(10, 10));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          sz: 0,
          elements: [{ imageId: 'sprite', mode: 'surface' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      const buffer = calls.bufferData[0] ?? null;
      expect(buffer).not.toBeNull();
      const quad = getQuadExtents(buffer!)[0]!;
      expectCloseTo(quad.left, -10);
      expectCloseTo(quad.right, 10);
      expectCloseTo(quad.top, -10);
      expectCloseTo(quad.bottom, 10);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('scales leaderline width with sprite scaling', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance,
      {
        spriteScaling: {
          minScaleDistance: 20,
        },
      }
    );
    renderer.updateCamera({
      position: {
        x: { value: 0 },
        y: { value: 0 },
        z: { value: 10 },
      },
    });
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(10, 10));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          sz: 0,
          elements: [
            {
              imageId: 'sprite',
              mode: 'surface',
              shiftDistance: { value: 10 },
              shiftAngleDeg: { value: 90 },
              leaderline: {
                width: { value: 4 },
                color: '#ff0000',
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      const buffer = calls.bufferData[0] ?? null;
      expect(buffer).not.toBeNull();
      const extents = getPolylineExtents(buffer!);
      expectCloseTo(extents.left, 0);
      expectCloseTo(extents.right, 10);
      expectCloseTo(extents.top, -1);
      expectCloseTo(extents.bottom, 1);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('fades sprite and leaderline with sprite visibilityDistance', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    renderer.updateCamera({
      position: {
        x: { value: 0 },
        y: { value: 0 },
        z: { value: 10 },
      },
    });
    const atlasId = allocateDefaultAtlas(renderer);
    const interpolation = {
      mode: 'feedback' as const,
      durationMs: 1000,
      easing: { type: 'linear' as const },
    };
    const getLeaderlineBuffer = () =>
      calls.bufferData.find(
        (buffer) => buffer.length === wl.POLYLINE_OUTPUT_STRIDE * 6
      ) ?? null;
    const getSpriteBuffer = () =>
      calls.bufferData.find(
        (buffer) => buffer.length === RENDER_OUTPUT_STRIDE * 2
      ) ?? null;
    const sampleSpriteOpacity = (sampleNowMs: number) => {
      nowMs = sampleNowMs;
      calls.bufferData.length = 0;
      calls.drawSequence.length = 0;
      renderer.render();
      if (calls.drawSequence.length === 0) {
        return undefined;
      }
      const leaderlineBuffer = getLeaderlineBuffer();
      const spriteBuffer = getSpriteBuffer();
      if (spriteBuffer === null) {
        expect(leaderlineBuffer).toBeNull();
        return undefined;
      }
      expect(leaderlineBuffer).not.toBeNull();
      const vertices = getSpriteVertices(spriteBuffer);
      return (
        vertices.reduce((sum, vertex) => sum + vertex.opacity, 0) /
        vertices.length
      );
    };

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(16, 16));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          sz: 0,
          opacity: { value: 1, interpolation },
          visibilityDistance: 20,
          elements: [
            {
              imageId: 'sprite',
              mode: 'surface',
              order: 0,
            },
            {
              imageId: 'sprite',
              originLocation: { index: 0 },
              mode: 'surface',
              order: 1,
              shiftDistance: { value: 12 },
              shiftAngleDeg: { value: 90 },
              leaderline: {
                width: { value: 2 },
                color: '#00ff00',
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      calls.bufferData.length = 0;
      renderer.render();
      let leaderlineBuffer = getLeaderlineBuffer();
      let spriteBuffer = getSpriteBuffer();
      expect(leaderlineBuffer).not.toBeNull();
      expect(spriteBuffer).not.toBeNull();
      for (const vertex of getSpriteVertices(spriteBuffer!)) {
        expectCloseTo(vertex.opacity, 1, 1.0e-3);
      }

      renderer.updateSprite(spriteId, {
        visibilityDistance: 5,
      });
      calls.bufferData.length = 0;
      renderer.render();

      const fadeOutSamples = [250, 500, 750, 1000, 1250, 1500].map(
        sampleSpriteOpacity
      );
      expect(
        fadeOutSamples.some(
          (opacity) => opacity !== undefined && opacity > 0.01 && opacity < 0.99
        )
      ).toBe(true);
      expect(fadeOutSamples.some((opacity) => opacity === undefined)).toBe(
        true
      );

      nowMs = 1500;

      renderer.updateSprite(spriteId, {
        visibilityDistance: 20,
      });
      calls.bufferData.length = 0;
      renderer.render();

      const fadeInSamples = [1750, 2000, 2250, 2500, 2750, 3000].map(
        sampleSpriteOpacity
      );
      expect(
        fadeInSamples.some(
          (opacity) => opacity !== undefined && opacity > 0.01 && opacity < 0.99
        )
      ).toBe(true);
      expect(
        fadeInSamples.some((opacity) => opacity !== undefined && opacity > 0.99)
      ).toBe(true);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('fades each sprite element with its own opacity interpolation when visibilityDistance changes', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    renderer.updateCamera({
      position: {
        x: { value: 0 },
        y: { value: 0 },
        z: { value: 10 },
      },
    });
    const atlasId = allocateDefaultAtlas(renderer);
    const interpolation = {
      mode: 'feedback' as const,
      durationMs: 1000,
      easing: { type: 'linear' as const },
    };
    const getSpriteBuffer = () =>
      calls.bufferData.find(
        (buffer) => buffer.length === RENDER_OUTPUT_STRIDE * 2
      ) ?? null;
    const sampleElementOpacities = (sampleNowMs: number) => {
      nowMs = sampleNowMs;
      calls.bufferData.length = 0;
      calls.drawSequence.length = 0;
      renderer.render();
      const spriteBuffer = getSpriteBuffer();
      if (spriteBuffer === null) {
        return undefined;
      }
      return [0, 1].map((spriteIndex) => {
        const vertices = getSpriteVertices(spriteBuffer, spriteIndex);
        return (
          vertices.reduce((sum, vertex) => sum + vertex.opacity, 0) /
          vertices.length
        );
      });
    };

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(16, 16));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          sz: 0,
          opacity: { value: 1 },
          visibilityDistance: 20,
          elements: [
            {
              imageId: 'sprite',
              mode: 'surface',
              order: 0,
            },
            {
              imageId: 'sprite',
              mode: 'surface',
              order: 1,
              shiftDistance: { value: 12 },
              shiftAngleDeg: { value: 90 },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const opacityUpdate = renderer.updateSprite(
        spriteId,
        {
          elements: [
            { opacity: { value: 0.8, interpolation } },
            { opacity: { value: 0.8, interpolation } },
          ],
        },
        true
      ) as Promise<void>;
      renderer.render();
      await opacityUpdate;

      nowMs = 1000;
      calls.bufferData.length = 0;
      renderer.render();
      const initialBuffer = getSpriteBuffer();
      expect(initialBuffer).not.toBeNull();
      expectCloseTo(
        getSpriteVertices(initialBuffer!, 0).reduce(
          (sum, vertex) => sum + vertex.opacity,
          0
        ) / RENDER_VERTICES_PER_SPRITE,
        0.8,
        1.0e-3
      );
      expectCloseTo(
        getSpriteVertices(initialBuffer!, 1).reduce(
          (sum, vertex) => sum + vertex.opacity,
          0
        ) / RENDER_VERTICES_PER_SPRITE,
        0.8,
        1.0e-3
      );

      renderer.updateSprite(spriteId, {
        visibilityDistance: 5,
      });
      calls.bufferData.length = 0;
      renderer.render();

      const fadeOutSamples = [1250, 1500, 1750, 2000, 2250, 2500].map(
        sampleElementOpacities
      );
      expect(
        fadeOutSamples.some(
          (sample) =>
            sample !== undefined &&
            sample.every((opacity) => opacity > 0.01 && opacity < 0.79)
        )
      ).toBe(true);
      expect(fadeOutSamples.some((sample) => sample === undefined)).toBe(true);

      nowMs = 2500;

      renderer.updateSprite(spriteId, {
        visibilityDistance: 20,
      });
      calls.bufferData.length = 0;
      renderer.render();

      const fadeInSamples = [2750, 3000, 3250, 3500, 3750, 4000].map(
        sampleElementOpacities
      );
      expect(
        fadeInSamples.some(
          (sample) =>
            sample !== undefined &&
            sample[0]! > 0.01 &&
            sample[0]! < 0.79 &&
            sample[1]! > 0.01 &&
            sample[1]! < 0.79
        )
      ).toBe(true);
      expect(
        fadeInSamples.some(
          (sample) =>
            sample !== undefined && sample[0]! > 0.79 && sample[1]! > 0.79
        )
      ).toBe(true);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('fades sprite elements when the camera crosses visibilityDistance in the SIMD path', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);
    const interpolation = {
      mode: 'feedback' as const,
      durationMs: 1000,
      easing: { type: 'linear' as const },
    };
    const elementCount = 8;
    const getSpriteBuffer = () =>
      calls.bufferData.find(
        (buffer) => buffer.length === RENDER_OUTPUT_STRIDE * elementCount
      ) ?? null;
    const sampleFirstElementOpacity = (sampleNowMs: number) => {
      nowMs = sampleNowMs;
      calls.bufferData.length = 0;
      calls.drawSequence.length = 0;
      renderer.render();
      const spriteBuffer = getSpriteBuffer();
      if (spriteBuffer === null) {
        return undefined;
      }
      const vertices = getSpriteVertices(spriteBuffer, 0);
      return (
        vertices.reduce((sum, vertex) => sum + vertex.opacity, 0) /
        vertices.length
      );
    };

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(16, 16));
      renderer.updateCamera({
        position: {
          x: { value: 0 },
          y: { value: 0 },
          z: { value: 10 },
        },
      });
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          sz: 0,
          opacity: { value: 1 },
          visibilityDistance: 20,
          elements: Array.from({ length: elementCount }, (_, index) => ({
            imageId: 'sprite',
            mode: 'surface' as const,
            order: index,
            shiftDistance: { value: index * 4 },
            shiftAngleDeg: { value: index * 20 },
          })),
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const opacityUpdate = renderer.updateSprite(
        spriteId,
        {
          elements: Array.from({ length: elementCount }, () => ({
            opacity: { value: 0.8, interpolation },
          })),
        },
        true
      ) as Promise<void>;
      renderer.render();
      await opacityUpdate;

      nowMs = 1000;
      calls.bufferData.length = 0;
      renderer.render();
      const initialBuffer = getSpriteBuffer();
      expect(initialBuffer).not.toBeNull();
      expectCloseTo(
        getSpriteVertices(initialBuffer!, 0).reduce(
          (sum, vertex) => sum + vertex.opacity,
          0
        ) / RENDER_VERTICES_PER_SPRITE,
        0.8,
        1.0e-3
      );

      renderer.updateCamera({
        position: {
          x: { value: 0 },
          y: { value: 0 },
          z: { value: 40 },
        },
      });

      const fadeOutSamples = [1000, 1250, 1500, 1750].map(
        sampleFirstElementOpacity
      );
      expect(fadeOutSamples[0]).toBeDefined();
      expect(fadeOutSamples[1]).toBeDefined();
      expect(fadeOutSamples[2]).toBeDefined();
      expect(
        fadeOutSamples.some(
          (opacity) => opacity !== undefined && opacity > 0.01 && opacity < 0.79
        )
      ).toBe(true);

      renderer.updateCamera({
        position: {
          x: { value: 0 },
          y: { value: 0 },
          z: { value: 10 },
        },
      });

      const fadeInSamples = [2000, 2250, 2500, 3000].map(
        sampleFirstElementOpacity
      );
      expect(fadeInSamples[0]).toBeDefined();
      expect(
        fadeInSamples.some(
          (opacity) => opacity !== undefined && opacity > 0.01 && opacity < 0.79
        )
      ).toBe(true);
      expect(
        fadeInSamples.some((opacity) => opacity !== undefined && opacity > 0.79)
      ).toBe(true);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('scales polyline thickness per node and narrows picking', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const createScaledRenderer = () => {
      const { gl, calls } = createFakeGL();
      const renderer = createObjectRenderer(
        { widthPixel: 320, heightPixel: 240 },
        gl,
        createRendererResources(),
        instance,
        {
          polylineScaling: {
            minScaleDistance: 20,
          },
        }
      );
      renderer.updateCamera({
        position: {
          x: { value: 0 },
          y: { value: 0 },
          z: { value: 10 },
        },
      });
      return { renderer, calls };
    };
    const createUnlimitedRenderer = () => {
      const { gl } = createFakeGL();
      const renderer = createObjectRenderer(
        { widthPixel: 320, heightPixel: 240 },
        gl,
        createRendererResources(),
        instance
      );
      renderer.updateCamera({
        position: {
          x: { value: 0 },
          y: { value: 0 },
          z: { value: 10 },
        },
      });
      return renderer;
    };
    const { renderer, calls } = createScaledRenderer();
    const baselineRenderer = createUnlimitedRenderer();

    try {
      const placement: PolylinePlacement = {
        nodes: [
          { x: 0, y: 0, thickness: 4 },
          { x: 10, y: 0, thickness: 4 },
        ],
        color: '#00ff00',
      };
      const addPromise = renderer.addPolyline(
        placement,
        true
      ) as Promise<number>;
      const baselineAddPromise = baselineRenderer.addPolyline(
        placement,
        true
      ) as Promise<number>;
      renderer.render();
      baselineRenderer.render();
      await Promise.all([addPromise, baselineAddPromise]);

      const buffer = calls.bufferData[0] ?? null;
      expect(buffer).not.toBeNull();
      const extents = getPolylineExtents(buffer!);
      expectCloseTo(extents.left, 0);
      expectCloseTo(extents.right, 10);
      const stride = wl.POLYLINE_OUTPUT_STRIDE;
      const startHalfWidth = Math.max(
        Math.abs(buffer![1]!),
        Math.abs(buffer![stride + 1]!)
      );
      const endHalfWidth = Math.max(
        Math.abs(buffer![stride * 2 + 1]!),
        Math.abs(buffer![stride * 5 + 1]!)
      );
      expectCloseTo(startHalfWidth, 1);
      expectCloseTo(endHalfWidth, Math.SQRT2);

      renderer.render();
      baselineRenderer.render();
      const hitPoint = baselineRenderer.projectWorldToViewport({
        x: 5,
        y: 1.5,
        z: 0,
      });
      if (!hitPoint) {
        throw new Error('Expected projected hit point.');
      }
      const baselinePick = baselineRenderer.pickAt(
        hitPoint.xPixel,
        hitPoint.yPixel
      );
      const scaledPick = renderer.pickAt(hitPoint.xPixel, hitPoint.yPixel);
      expect(baselinePick?.kind).toBe('polyline');
      expect(scaledPick).toBeUndefined();
    } finally {
      renderer.release();
      baselineRenderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('renders configurable polyline join fan corrections', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const createRendererWithCalls = () => {
      const { gl, calls } = createFakeGL();
      const renderer = createObjectRenderer(
        { widthPixel: 320, heightPixel: 240 },
        gl,
        createRendererResources(),
        instance
      );
      renderer.updateCamera({
        position: {
          x: { value: 0 },
          y: { value: 0 },
          z: { value: 10 },
        },
      });
      return { renderer, calls };
    };
    const withoutJoin = createRendererWithCalls();
    const defaultJoin = createRendererWithCalls();
    const denseJoin = createRendererWithCalls();

    try {
      const basePlacement: PolylinePlacement = {
        nodes: [
          { x: 0, y: 0, thickness: 4 },
          { x: 10, y: 0, thickness: 4 },
          { x: 20, y: 10, thickness: 4 },
        ],
        color: '#00ff00',
      };
      const withoutJoinPromise = withoutJoin.renderer.addPolyline(
        {
          ...basePlacement,
          joinCorrection: { type: 'none' },
        },
        true
      ) as Promise<number>;
      const defaultJoinPromise = defaultJoin.renderer.addPolyline(
        basePlacement,
        true
      ) as Promise<number>;
      const denseJoinPromise = denseJoin.renderer.addPolyline(
        {
          ...basePlacement,
          joinCorrection: { type: 'fan', intermediatePointCount: 2 },
        },
        true
      ) as Promise<number>;

      withoutJoin.renderer.render();
      defaultJoin.renderer.render();
      denseJoin.renderer.render();
      await Promise.all([
        withoutJoinPromise,
        defaultJoinPromise,
        denseJoinPromise,
      ]);

      const withoutJoinBuffer = withoutJoin.calls.bufferData[0] ?? null;
      const defaultJoinBuffer = defaultJoin.calls.bufferData[0] ?? null;
      const denseJoinBuffer = denseJoin.calls.bufferData[0] ?? null;
      expect(withoutJoinBuffer).not.toBeNull();
      expect(defaultJoinBuffer).not.toBeNull();
      expect(denseJoinBuffer).not.toBeNull();
      expect(getPolylineVertexCount(withoutJoinBuffer!)).toBe(12);
      expect(getPolylineVertexCount(defaultJoinBuffer!)).toBe(15);
      expect(getPolylineVertexCount(denseJoinBuffer!)).toBe(21);
    } finally {
      withoutJoin.renderer.release();
      defaultJoin.renderer.release();
      denseJoin.renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('picks outer corners covered by polyline join fan corrections', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const createRenderer = () => {
      const { gl } = createFakeGL();
      const renderer = createObjectRenderer(
        { widthPixel: 320, heightPixel: 240 },
        gl,
        createRendererResources(),
        instance
      );
      renderer.updateCamera({
        position: {
          x: { value: 0 },
          y: { value: 0 },
          z: { value: 10 },
        },
      });
      return renderer;
    };
    const withoutJoin = createRenderer();
    const withJoin = createRenderer();

    try {
      const placement: PolylinePlacement = {
        nodes: [
          { x: 0, y: 10, thickness: 4 },
          { x: 0, y: 0, thickness: 4 },
          { x: -10, y: 0, thickness: 4 },
        ],
        color: '#00ff00',
      };
      const withoutJoinPromise = withoutJoin.addPolyline(
        {
          ...placement,
          joinCorrection: { type: 'none' },
        },
        true
      ) as Promise<number>;
      const withJoinPromise = withJoin.addPolyline(
        placement,
        true
      ) as Promise<number>;

      withoutJoin.render();
      withJoin.render();
      await Promise.all([withoutJoinPromise, withJoinPromise]);

      const hitPoint = withJoin.projectWorldToViewport({
        x: 0.75,
        y: -0.75,
        z: 0,
      });
      if (!hitPoint) {
        throw new Error('Expected projected join corner hit point.');
      }

      expect(
        withoutJoin.pickAt(hitPoint.xPixel, hitPoint.yPixel)
      ).toBeUndefined();
      expect(withJoin.pickAt(hitPoint.xPixel, hitPoint.yPixel)?.kind).toBe(
        'polyline'
      );
    } finally {
      withoutJoin.release();
      withJoin.release();
      vi.unstubAllGlobals();
    }
  });

  it('renders configurable polyline cap fans and updates picking', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const createRendererWithCalls = () => {
      const { gl, calls } = createFakeGL();
      const renderer = createObjectRenderer(
        { widthPixel: 320, heightPixel: 240 },
        gl,
        createRendererResources(),
        instance
      );
      renderer.updateCamera({
        position: {
          x: { value: 0 },
          y: { value: 0 },
          z: { value: 10 },
        },
      });
      return { renderer, calls };
    };
    const buttRenderer = createRendererWithCalls();
    const capRenderer = createRendererWithCalls();

    try {
      const basePlacement: PolylinePlacement = {
        nodes: [
          { x: 0, y: 0, thickness: 4 },
          { x: 10, y: 0, thickness: 4 },
        ],
        color: '#00ff00',
        joinCorrection: { type: 'none' },
      };
      const buttPromise = buttRenderer.renderer.addPolyline(
        basePlacement,
        true
      ) as Promise<number>;
      const capPromise = capRenderer.renderer.addPolyline(
        {
          ...basePlacement,
          capCorrection: { type: 'fan', pointCount: 1 },
        },
        true
      ) as Promise<number>;

      buttRenderer.renderer.render();
      capRenderer.renderer.render();
      const capPolylineId = await capPromise;
      await buttPromise;

      const buttBuffer = buttRenderer.calls.bufferData[0] ?? null;
      const capBuffer = capRenderer.calls.bufferData[0] ?? null;
      expect(buttBuffer).not.toBeNull();
      expect(capBuffer).not.toBeNull();
      expect(getPolylineVertexCount(buttBuffer!)).toBe(6);
      expect(getPolylineVertexCount(capBuffer!)).toBe(18);

      const buttExtents = getPolylineExtents(buttBuffer!);
      const capExtents = getPolylineExtents(capBuffer!);
      expectCloseTo(buttExtents.left, 0);
      expectCloseTo(buttExtents.right, 10);
      expectCloseTo(capExtents.left, -2);
      expectCloseTo(capExtents.right, 12);
      expectCloseTo(capExtents.top, -2);
      expectCloseTo(capExtents.bottom, 2);

      const hitPoint = capRenderer.renderer.projectWorldToViewport({
        x: -1,
        y: 0,
        z: 0,
      });
      if (!hitPoint) {
        throw new Error('Expected projected hit point.');
      }
      const buttPick = buttRenderer.renderer.pickAt(
        hitPoint.xPixel,
        hitPoint.yPixel
      );
      const capPick = capRenderer.renderer.pickAt(
        hitPoint.xPixel,
        hitPoint.yPixel
      );
      expect(buttPick).toBeUndefined();
      expect(capPick?.kind).toBe('polyline');

      capRenderer.calls.bufferData.length = 0;
      capRenderer.renderer.updatePolyline(capPolylineId, {
        capCorrection: { type: 'fan', pointCount: 3 },
      });
      capRenderer.renderer.render();
      const updatedBuffer =
        capRenderer.calls.bufferData[capRenderer.calls.bufferData.length - 1] ??
        null;
      expect(updatedBuffer).not.toBeNull();
      expect(getPolylineVertexCount(updatedBuffer!)).toBe(30);
    } finally {
      buttRenderer.renderer.release();
      capRenderer.renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('applies anchor offsets to sprite quad corners', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(
        atlasId,
        'sprite',
        createFakeBitmap(100, 100)
      );
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite', anchorY: { value: 1 } }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      const buffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(buffer).not.toBeNull();
      expect(buffer!.length).toBe(RENDER_OUTPUT_STRIDE);
      const quad = getQuadExtents(buffer!)[0];
      expect(quad).toBeDefined();
      expectCloseTo(quad!.left, -50);
      expectCloseTo(quad!.right, 50);
      expectCloseTo(quad!.top, -100);
      expectCloseTo(quad!.bottom, 0);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('collapses sprite width while auto-direction flipX interpolation crosses zero', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);
    const measureHorizontalFlip = (buffer: Float32Array) => {
      const vertices = getSpriteVertices(buffer);
      const xs = vertices.map((vertex) => vertex.x);
      const leftX = Math.min(...xs);
      const rightX = Math.max(...xs);
      const epsilon = 1.0e-4;
      const average = (values: number[]) =>
        values.reduce((sum, value) => sum + value, 0) / values.length;
      const leftU = average(
        vertices
          .filter((vertex) => Math.abs(vertex.x - leftX) <= epsilon)
          .map((vertex) => vertex.u)
      );
      const rightU = average(
        vertices
          .filter((vertex) => Math.abs(vertex.x - rightX) <= epsilon)
          .map((vertex) => vertex.u)
      );
      return {
        width: rightX - leftX,
        leftU,
        rightU,
      };
    };

    try {
      await renderer.registerImage(
        atlasId,
        'sprite',
        createFakeBitmap(100, 100)
      );
      const addPromise = renderer.addSprite(
        {
          sx: { value: 100 },
          sy: { value: 0 },
          elements: [
            {
              imageId: 'sprite',
              autoDirection: {
                space: 'world',
                mode: {
                  type: 'flipping',
                  flipX: true,
                  interpolation: {
                    mode: 'feedback',
                    durationMs: 1000,
                    easing: { type: 'linear' },
                  },
                },
                minDistance: 0,
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;
      renderer.render();

      const initialBuffer =
        calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(initialBuffer).not.toBeNull();
      const initial = measureHorizontalFlip(initialBuffer!);
      expectCloseTo(initial.width, 100);
      expect(initial.leftU).toBeLessThan(initial.rightU);

      const movePromise = renderer.updateSprite(
        spriteId,
        { sx: { value: 0 } },
        true
      ) as Promise<void>;
      renderer.render();
      await movePromise;

      nowMs = 500;
      renderer.render();
      const midBuffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(midBuffer).not.toBeNull();
      const mid = measureHorizontalFlip(midBuffer!);
      expect(mid.width).toBeLessThan(1.0e-3);

      const midElement = renderer.getSpriteState(spriteId).elements[0]!;
      if (midElement.autoDirection.mode?.type !== 'flipping') {
        throw new Error('Expected flipping autoDirection mode.');
      }
      expectCloseTo(
        Math.abs(midElement.autoDirection.mode.flipX.value),
        0,
        1.0e-3
      );

      nowMs = 1000;
      renderer.render();
      const endBuffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(endBuffer).not.toBeNull();
      const end = measureHorizontalFlip(endBuffer!);
      expectCloseTo(end.width, 100);
      expect(end.leftU).toBeGreaterThan(end.rightU);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('collapses sprite height while auto-direction flipY interpolation crosses zero', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);
    const measureVerticalFlip = (buffer: Float32Array) => {
      const vertices = getSpriteVertices(buffer);
      const ys = vertices.map((vertex) => vertex.y);
      const topY = Math.min(...ys);
      const bottomY = Math.max(...ys);
      const epsilon = 1.0e-4;
      const average = (values: number[]) =>
        values.reduce((sum, value) => sum + value, 0) / values.length;
      const topV = average(
        vertices
          .filter((vertex) => Math.abs(vertex.y - topY) <= epsilon)
          .map((vertex) => vertex.v)
      );
      const bottomV = average(
        vertices
          .filter((vertex) => Math.abs(vertex.y - bottomY) <= epsilon)
          .map((vertex) => vertex.v)
      );
      return {
        height: bottomY - topY,
        topV,
        bottomV,
      };
    };

    try {
      await renderer.registerImage(
        atlasId,
        'sprite',
        createFakeBitmap(100, 100)
      );
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 100 },
          elements: [
            {
              imageId: 'sprite',
              autoDirection: {
                space: 'world',
                mode: {
                  type: 'flipping',
                  flipY: true,
                  interpolation: {
                    mode: 'feedback',
                    durationMs: 1000,
                    easing: { type: 'linear' },
                  },
                },
                minDistance: 0,
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;
      renderer.render();

      const initialBuffer =
        calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(initialBuffer).not.toBeNull();
      const initial = measureVerticalFlip(initialBuffer!);
      expectCloseTo(initial.height, 100);
      expect(initial.topV).toBeGreaterThan(initial.bottomV);

      const movePromise = renderer.updateSprite(
        spriteId,
        { sy: { value: 0 } },
        true
      ) as Promise<void>;
      renderer.render();
      await movePromise;

      nowMs = 500;
      renderer.render();
      const midBuffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(midBuffer).not.toBeNull();
      const mid = measureVerticalFlip(midBuffer!);
      expect(mid.height).toBeLessThan(1.0e-3);

      const midElement = renderer.getSpriteState(spriteId).elements[0]!;
      if (midElement.autoDirection.mode?.type !== 'flipping') {
        throw new Error('Expected flipping autoDirection mode.');
      }
      expectCloseTo(
        Math.abs(midElement.autoDirection.mode.flipY.value),
        0,
        1.0e-3
      );

      nowMs = 1000;
      renderer.render();
      const endBuffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(endBuffer).not.toBeNull();
      const end = measureVerticalFlip(endBuffer!);
      expectCloseTo(end.height, 100);
      expect(end.topV).toBeLessThan(end.bottomV);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('ignores local shift interpolation when auto shift-angle rotation samples direction', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);
    const interpolation = {
      mode: 'feedback' as const,
      durationMs: 1000,
      easing: { type: 'linear' as const },
    };

    try {
      await renderer.registerImage(
        atlasId,
        'sprite',
        createFakeBitmap(100, 100)
      );
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [
            {
              imageId: 'sprite',
              shiftDistance: { value: 100, interpolation },
              shiftAngleDeg: { value: 90, interpolation },
              autoDirection: {
                space: 'world',
                shiftAngleRotation: true,
                minDistance: 0,
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      [0, 250, 500, 750, 1000].forEach((sampleMs) => {
        nowMs = sampleMs;
        renderer.render();
        const element = renderer.getSpriteState(spriteId).elements[0]!;
        expectCloseTo(element.autoDirection.directionDeg, 0, 1.0e-3);
      });
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('keeps shift-angle auto-direction when updating flip axes only', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [
            {
              imageId: 'sprite',
              shiftAngleDeg: { value: 0 },
              autoDirection: {
                space: 'world',
                mode: {
                  type: 'flipping',
                  flipX: true,
                  flipY: false,
                },
                shiftAngleRotation: true,
                minDistance: 0,
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      renderer.render();

      nowMs = 100;
      const moveSprite = renderer.updateSprite(
        spriteId,
        { sx: { value: 100 } },
        true
      ) as Promise<void>;
      renderer.render();
      await moveSprite;

      let element = renderer.getSpriteState(spriteId).elements[0]!;
      expectCloseTo(element.autoDirection.directionDeg, 90, 1.0e-3);
      expectCloseTo(element.autoDirection.finalShiftAngleDeg, 90, 1.0e-3);

      const updateFlipAxes = renderer.updateSprite(
        spriteId,
        {
          elements: [
            {
              autoDirection: {
                mode: {
                  type: 'flipping',
                  flipX: false,
                },
              },
            },
          ],
        },
        true
      ) as Promise<void>;
      renderer.render();
      await updateFlipAxes;

      element = renderer.getSpriteState(spriteId).elements[0]!;
      expectCloseTo(element.autoDirection.directionDeg, 90, 1.0e-3);
      expectCloseTo(element.autoDirection.finalShiftAngleDeg, 90, 1.0e-3);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('selects origin location coordinates before or after anchor resolution', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(
        atlasId,
        'sprite',
        createFakeBitmap(100, 100)
      );
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [
            {
              imageId: 'sprite',
              anchorX: { value: 1 },
              anchorY: { value: 0 },
              order: 0,
            },
            {
              imageId: 'sprite',
              originLocation: { index: 0 },
              anchorX: { value: 0 },
              anchorY: { value: 0 },
              order: 1,
            },
            {
              imageId: 'sprite',
              originLocation: { index: 0, useResolvedAnchor: true },
              anchorX: { value: 0 },
              anchorY: { value: 0 },
              order: 2,
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      const buffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(buffer).not.toBeNull();
      expect(buffer!.length).toBe(RENDER_OUTPUT_STRIDE * 3);
      const preAnchorCenter = getQuadCenter(buffer!, 1);
      const resolvedCenter = getQuadCenter(buffer!, 2);
      expectCloseTo(preAnchorCenter.x, -50);
      expectCloseTo(resolvedCenter.x, 0);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('skips wasm compute when no changes are pending', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(
        atlasId,
        'sprite',
        createFakeBitmap(100, 100)
      );
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      renderer.resetPerformanceSnapshot();
      renderer.render();

      const snapshot = renderer.getPerformanceSnapshot();
      expect(snapshot.sampleCount).toBe(1);
      expect(snapshot.avgWasmComputeInternalDurationMs).toBe(0);
      expect(snapshot.avgWasmComputeWriteOutputDurationMs).toBe(0);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('resolves pivots with basis elements', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'base', createFakeBitmap(100, 100));
      await renderer.registerImage(
        atlasId,
        'child',
        createFakeBitmap(100, 100)
      );
      const addPromise = renderer.addSprite(
        {
          sx: { value: 10 },
          sy: { value: 20 },
          elements: [
            { imageId: 'base' },
            {
              imageId: 'child',
              originLocation: { index: 0 },
              shiftDistance: { value: 10 },
              shiftAngleDeg: { value: 90 },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      const buffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(buffer).not.toBeNull();
      expect(buffer!.length).toBe(RENDER_OUTPUT_STRIDE * 2);
      const quads = getQuadExtents(buffer!);
      expect(quads).toHaveLength(2);
      const lefts = quads.map((quad) => quad.left).sort((a, b) => a - b);
      const rights = quads.map((quad) => quad.right).sort((a, b) => a - b);
      expectCloseTo(lefts[0]!, -40);
      expectCloseTo(lefts[1]!, -30);
      expectCloseTo(rights[0]!, 60);
      expectCloseTo(rights[1]!, 70);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('orders elements by layer before depth', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(
        atlasId,
        'sprite',
        createFakeBitmap(100, 100)
      );
      const frontPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          sz: 0,
          elements: [{ imageId: 'sprite', layer: 1 }],
        },
        true
      ) as Promise<number>;
      const backPromise = renderer.addSprite(
        {
          sx: { value: 100 },
          sy: { value: 0 },
          sz: 10,
          elements: [{ imageId: 'sprite', layer: 0 }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await Promise.all([frontPromise, backPromise]);

      const buffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(buffer).not.toBeNull();
      const quads = getQuadExtents(buffer!);
      expect(quads).toHaveLength(2);
      const lefts = quads.map((quad) => quad.left);
      expectCloseTo(lefts[0]!, 50);
      expectCloseTo(lefts[1]!, -50);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('orders elements by sprite depth before order across sprites', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(
        atlasId,
        'sprite',
        createFakeBitmap(100, 100)
      );
      const frontPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          sz: 0,
          elements: [{ imageId: 'sprite', layer: 0, order: 7 }],
        },
        true
      ) as Promise<number>;
      const backPromise = renderer.addSprite(
        {
          sx: { value: 100 },
          sy: { value: 0 },
          sz: 10,
          elements: [{ imageId: 'sprite', layer: 0, order: 0 }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await Promise.all([frontPromise, backPromise]);

      const buffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(buffer).not.toBeNull();
      const quads = getQuadExtents(buffer!);
      expect(quads).toHaveLength(2);
      const lefts = quads.map((quad) => quad.left);
      expectCloseTo(lefts[0]!, -50);
      expectCloseTo(lefts[1]!, 50);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('orders elements by order within a sprite', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'wide', createFakeBitmap(80, 80));
      await renderer.registerImage(atlasId, 'narrow', createFakeBitmap(40, 40));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [
            {
              imageId: 'wide',
              order: 0,
              shiftDistance: { value: 0 },
              shiftAngleDeg: { value: 0 },
              anchorX: { value: 0 },
              anchorY: { value: 0 },
            },
            {
              imageId: 'narrow',
              order: 1,
              shiftDistance: { value: 0 },
              shiftAngleDeg: { value: 0 },
              anchorX: { value: 0 },
              anchorY: { value: 0 },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      const buffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(buffer).not.toBeNull();
      const quads = getQuadExtents(buffer!);
      expect(quads).toHaveLength(2);
      const lefts = quads.map((quad) => quad.left);
      expectCloseTo(lefts[0]!, -40);
      expectCloseTo(lefts[1]!, -20);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('orders elements by order within a sprite in f64', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance,
      { precision: 'f64' }
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'wide', createFakeBitmap(80, 80));
      await renderer.registerImage(atlasId, 'narrow', createFakeBitmap(40, 40));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [
            {
              imageId: 'wide',
              order: 0,
              shiftDistance: { value: 0 },
              shiftAngleDeg: { value: 0 },
              anchorX: { value: 0 },
              anchorY: { value: 0 },
            },
            {
              imageId: 'narrow',
              order: 1,
              shiftDistance: { value: 0 },
              shiftAngleDeg: { value: 0 },
              anchorX: { value: 0 },
              anchorY: { value: 0 },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;

      const buffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(buffer).not.toBeNull();
      const quads = getQuadExtents(buffer!);
      expect(quads).toHaveLength(2);
      const lefts = quads.map((quad) => quad.left);
      expectCloseTo(lefts[0]!, -40);
      expectCloseTo(lefts[1]!, -20);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('updates pivots with basis elements when sprite position changes', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'base', createFakeBitmap(100, 100));
      await renderer.registerImage(
        atlasId,
        'child',
        createFakeBitmap(100, 100)
      );
      const addPromise = renderer.addSprite(
        {
          sx: { value: 10 },
          sy: { value: 20 },
          elements: [
            { imageId: 'base' },
            {
              imageId: 'child',
              originLocation: { index: 0 },
              shiftDistance: { value: 10 },
              shiftAngleDeg: { value: 90 },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const initialBuffer =
        calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(initialBuffer).not.toBeNull();
      const initialQuads = getQuadExtents(initialBuffer!);
      expect(initialQuads).toHaveLength(2);

      const updatePromise = renderer.updateSprite(
        spriteId,
        {
          sx: { value: 20 },
          sy: { value: 30 },
        },
        true
      ) as Promise<void>;
      renderer.render();
      await updatePromise;

      const updatedBuffer =
        calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(updatedBuffer).not.toBeNull();
      const updatedQuads = getQuadExtents(updatedBuffer!);
      expect(updatedQuads).toHaveLength(2);

      for (let i = 0; i < updatedQuads.length; i += 1) {
        const before = initialQuads[i];
        const after = updatedQuads[i];
        if (!before || !after) {
          continue;
        }
        expectCloseTo(after.left - before.left, 10);
        expectCloseTo(after.right - before.right, 10);
        expectCloseTo(after.top - before.top, 10);
        expectCloseTo(after.bottom - before.bottom, 10);
      }
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('updates pivots when sprite position changes', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(
        atlasId,
        'sprite',
        createFakeBitmap(100, 100)
      );
      const addPromise = renderer.addSprite(
        {
          sx: { value: 10 },
          sy: { value: 20 },
          elements: [{ imageId: 'sprite' }],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const initialBuffer =
        calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(initialBuffer).not.toBeNull();
      const initialQuad = getQuadExtents(initialBuffer!)[0];
      expect(initialQuad).toBeDefined();

      const updatePromise = renderer.updateSprite(
        spriteId,
        {
          sx: { value: 20 },
          sy: { value: 30 },
        },
        true
      ) as Promise<void>;
      renderer.render();
      await updatePromise;

      const updatedBuffer =
        calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(updatedBuffer).not.toBeNull();
      const updatedQuad = getQuadExtents(updatedBuffer!)[0];
      expect(updatedQuad).toBeDefined();

      expectCloseTo(updatedQuad!.left - initialQuad!.left, 10);
      expectCloseTo(updatedQuad!.right - initialQuad!.right, 10);
      expectCloseTo(updatedQuad!.top - initialQuad!.top, 10);
      expectCloseTo(updatedQuad!.bottom - initialQuad!.bottom, 10);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('animates rotation without autoRotation enabled', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const placement = createPlacement(10, 20);
      const addPromise = renderer.addSprite(placement, true) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const updatePromise = renderer.updateSprite(
        spriteId,
        {
          elements: [
            {
              rotation: {
                value: 90,
                interpolation: {
                  mode: 'feedback',
                  durationMs: 1000,
                  easing: { type: 'linear' },
                },
              },
            },
          ],
        },
        true
      ) as Promise<void>;
      renderer.render();
      await updatePromise;

      const initialBuffer =
        calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(initialBuffer).not.toBeNull();

      nowMs = 500;
      renderer.render();
      const midBuffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(midBuffer).not.toBeNull();

      const hasBufferDifference = (lhs: Float32Array, rhs: Float32Array) => {
        if (lhs.length !== rhs.length) {
          return true;
        }
        return lhs.some((value: number, index: number) => {
          const other = rhs[index];
          if (other === undefined) {
            return false;
          }
          return Math.abs(value - other) > 1.0e-4;
        });
      };

      expect(hasBufferDifference(initialBuffer!, midBuffer!)).toBe(true);

      nowMs = 1000;
      renderer.render();
      const endBuffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(endBuffer).not.toBeNull();
      expect(hasBufferDifference(midBuffer!, endBuffer!)).toBe(true);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('resolves awaitable addSprite after render', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
    const placement = createPlacement(10, 20);
    const promise = renderer.addSprite(placement, true) as Promise<number>;

    renderer.render();

    await expect(promise).resolves.toBe(0);
  });

  it('resolves awaitable bulk sprite commands after render', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const placements = [createPlacement(10, 20), createPlacement(30, 40)];
      const addPromise = renderer.addSprites(placements, true) as Promise<
        number[]
      >;

      renderer.render();

      const spriteIds = await addPromise;
      expect(spriteIds).toEqual([0, 1]);

      const updatePromise = renderer.updateSprites(
        spriteIds.map((spriteId) => ({
          spriteId,
          opacity: { value: 0.5 },
        })),
        true
      ) as Promise<void>;

      renderer.render();

      await expect(updatePromise).resolves.toBeUndefined();

      const removePromise = renderer.removeSprites(
        spriteIds,
        true
      ) as Promise<void>;

      renderer.render();

      await expect(removePromise).resolves.toBeUndefined();
    } finally {
      renderer.release();
    }
  });

  it('rejects addSprites when placement is invalid', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    try {
      const promise = renderer.addSprites(
        [null as unknown as SpritePlacement],
        true
      ) as Promise<number[]>;

      await expect(promise).rejects.toMatchObject({
        message: 'Placement is required.',
      });
    } finally {
      renderer.release();
    }
  });

  it('uploads sprite vertices once per frame across sprite commands', async () => {
    const { gl, calls } = createFakeGL();
    const spriteOutput = new Float32Array(wl.WASM_OUTPUT_STRIDE * 2);
    const drawCommands = new Int32Array(
      wl.DRAW_COMMAND_HEADER_FIELDS + wl.DRAW_COMMAND_FIELDS * 2
    );
    drawCommands[wl.DRAW_COMMAND_COMMAND_COUNT_OFFSET] = 2;
    drawCommands[wl.DRAW_COMMAND_POLYLINE_VERTEX_COUNT_OFFSET] = 0;
    drawCommands[wl.DRAW_COMMAND_SPRITE_OUTPUT_COUNT_OFFSET] = 2;
    let commandBase = wl.DRAW_COMMAND_HEADER_FIELDS;
    drawCommands[commandBase + wl.DRAW_COMMAND_KIND_FIELD_OFFSET] =
      wl.DRAW_COMMAND_KIND_SPRITE;
    drawCommands[commandBase + wl.DRAW_COMMAND_START_FIELD_OFFSET] = 0;
    drawCommands[commandBase + wl.DRAW_COMMAND_COUNT_FIELD_OFFSET] = 1;
    drawCommands[commandBase + wl.DRAW_COMMAND_EXTRA_FIELD_OFFSET] = 0;
    commandBase += wl.DRAW_COMMAND_FIELDS;
    drawCommands[commandBase + wl.DRAW_COMMAND_KIND_FIELD_OFFSET] =
      wl.DRAW_COMMAND_KIND_SPRITE;
    drawCommands[commandBase + wl.DRAW_COMMAND_START_FIELD_OFFSET] = 1;
    drawCommands[commandBase + wl.DRAW_COMMAND_COUNT_FIELD_OFFSET] = 1;
    drawCommands[commandBase + wl.DRAW_COMMAND_EXTRA_FIELD_OFFSET] = 0;

    const { instance } = createFakeWasmModule({
      computeVertices: {
        spriteOutput,
        drawCommands,
        activeCount: 2,
      },
    });
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const placement: SpritePlacement = {
        sx: { value: 10 },
        sy: { value: 20 },
        elements: [
          { imageId: 'sprite', scale: { value: 1 } },
          { imageId: 'sprite', scale: { value: 1 } },
        ],
      };
      const promise = renderer.addSprite(placement, true) as Promise<number>;
      renderer.render();
      await promise;

      expect(calls.bufferData.length).toBe(1);
      expect(calls.bufferData[0]?.length).toBe(spriteOutput.length);
      expect(calls.drawElements).toBe(2);
    } finally {
      renderer.release();
    }
  });

  it('resolves awaitable addPolyline after render', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );

    try {
      const placement: PolylinePlacement = {
        nodes: [
          { x: 0, y: 0, thickness: 1 },
          { x: 10, y: 0, thickness: 1 },
        ],
        color: '#ff0000',
      };
      const promise = renderer.addPolyline(placement, true) as Promise<number>;
      renderer.render();
      await expect(promise).resolves.toBe(0);
    } finally {
      renderer.release();
    }
  });

  it('resolves awaitable bulk polyline commands after render', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );

    try {
      const placements: PolylinePlacement[] = [
        {
          nodes: [
            { x: 0, y: 0, thickness: 1 },
            { x: 10, y: 0, thickness: 1 },
          ],
          color: '#ff0000',
        },
        {
          nodes: [
            { x: 5, y: 5, thickness: 1 },
            { x: 15, y: 5, thickness: 1 },
          ],
          color: '#00ff00',
        },
      ];

      const addPromise = renderer.addPolylines(placements, true) as Promise<
        number[]
      >;
      renderer.render();
      const polylineIds = await addPromise;
      expect(polylineIds).toEqual([0, 1]);

      const updatePromise = renderer.updatePolylines(
        polylineIds.map((polylineId) => ({
          polylineId,
          opacity: { value: 0.5 },
        })),
        true
      ) as Promise<void>;

      renderer.render();

      await expect(updatePromise).resolves.toBeUndefined();

      const removePromise = renderer.removePolylines(
        polylineIds,
        true
      ) as Promise<void>;

      renderer.render();

      await expect(removePromise).resolves.toBeUndefined();
    } finally {
      renderer.release();
    }
  });

  it('keeps polyline ids consistent when removing multiple polylines in order', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );

    try {
      const placements: PolylinePlacement[] = [
        {
          nodes: [
            { x: 0, y: 0, thickness: 1 },
            { x: 10, y: 0, thickness: 1 },
          ],
          color: '#ff0000',
        },
        {
          nodes: [
            { x: 5, y: 5, thickness: 1 },
            { x: 15, y: 5, thickness: 1 },
          ],
          color: '#00ff00',
        },
        {
          nodes: [
            { x: 10, y: 10, thickness: 1 },
            { x: 20, y: 10, thickness: 1 },
          ],
          color: '#0000ff',
        },
      ];

      const addPromise = renderer.addPolylines(placements, true) as Promise<
        number[]
      >;
      renderer.render();
      const polylineIds = await addPromise;
      const [firstId, secondId, thirdId] = polylineIds;
      if (
        firstId === undefined ||
        secondId === undefined ||
        thirdId === undefined
      ) {
        throw new Error('Expected three polylines to be added.');
      }

      const removePromise = renderer.removePolylines(
        [firstId, secondId],
        true
      ) as Promise<void>;

      renderer.render();

      await expect(removePromise).resolves.toBeUndefined();

      const remainingUpdate = renderer.updatePolyline(
        thirdId,
        { opacity: { value: 0.5 } },
        true
      ) as Promise<void>;

      renderer.render();

      await expect(remainingUpdate).resolves.toBeUndefined();

      const removedUpdate = renderer.updatePolyline(
        secondId,
        { opacity: { value: 0.5 } },
        true
      ) as Promise<void>;

      await expect(removedUpdate).rejects.toMatchObject({
        polylineId: secondId,
      });
    } finally {
      renderer.release();
    }
  });

  it('refreshes command buffer view after render buffer expansion', async () => {
    const { gl } = createFakeGL();
    const { instance, state } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const nodes = Array.from({ length: 5000 }, (_, index) => ({
        x: index,
        y: 0,
        thickness: 1,
      }));
      const addPolylinePromise = renderer.addPolyline(
        { nodes, color: '#ff0000' },
        true
      ) as Promise<number>;

      const beforeRenderBuffer = state.memory.buffer;
      renderer.render();
      await addPolylinePromise;

      expect(state.memory.buffer).not.toBe(beforeRenderBuffer);

      const addSpritePromise = renderer.addSprite(
        createPlacement(10, 20),
        true
      ) as Promise<number>;

      renderer.render();

      await expect(addSpritePromise).resolves.toBeDefined();
    } finally {
      renderer.release();
    }
  });

  it('rejects addPolyline when color format is invalid', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    try {
      const placement: PolylinePlacement = {
        nodes: [
          { x: 0, y: 0, thickness: 1 },
          { x: 10, y: 0, thickness: 1 },
        ],
        color: '#zz0000',
      };

      const promise = renderer.addPolyline(placement, true) as Promise<number>;

      await expect(promise).rejects.toMatchObject({
        message: 'Color must be in #RRGGBB or #RRGGBBAA format.',
        placement,
      });
    } finally {
      renderer.release();
    }
  });

  it('resolves awaitable addSprite within initializeScope without render', async () => {
    const { gl, calls } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const placement = createPlacement(10, 20);
      let resolvedId: number | null = null;
      await renderer.initializeScope(async () => {
        const promise = renderer.addSprite(placement, true) as Promise<number>;
        resolvedId = await promise;
      });
      expect(resolvedId).toBe(0);
      expect(calls.bufferData.length).toBe(0);
    } finally {
      renderer.release();
    }
  });

  it('resolves awaitable addSprite without render via command pump', async () => {
    const { gl, calls } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const promise = renderer.addSprite(
        createPlacement(10, 20),
        true
      ) as Promise<number>;
      await expect(promise).resolves.toBe(0);
      expect(calls.bufferData.length).toBe(0);
    } finally {
      renderer.release();
    }
  });

  it('rejects pending awaitable commands on release', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
    const placement = createPlacement(10, 20);
    const promise = renderer.addSprite(placement, true) as Promise<number>;
    renderer.release();

    await expect(promise).rejects.toMatchObject({
      message: 'Renderer has been released.',
      placement,
    });
  });

  it('splits large awaitable bulk sprite commands across multiple wasm applies', async () => {
    const { gl } = createFakeGL();
    const { instance, state } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const placements = Array.from({ length: 5000 }, (_, index) =>
        createPlacement(index, index)
      );
      const spriteIds = await (renderer.addSprites(placements, true) as Promise<
        number[]
      >);
      const contextPtr = [...state.contexts.keys()][0];
      if (contextPtr === undefined) {
        throw new Error('Expected fake wasm context to exist.');
      }
      const applyCounts = state.getApplyCommandCounts(contextPtr);
      expect(spriteIds).toHaveLength(5000);
      expect(applyCounts.length).toBeGreaterThan(1);
      expect(Math.max(...applyCounts)).toBeLessThanOrEqual(4096);
    } finally {
      renderer.release();
    }
  });

  it('rejects addSprite when layer is out of range', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
    const placement: SpritePlacement = {
      sx: { value: 10 },
      sy: { value: 20 },
      elements: [{ imageId: 'sprite', layer: 32 }],
    };

    const promise = renderer.addSprite(placement, true) as Promise<number>;

    await expect(promise).rejects.toMatchObject({
      message: 'Layer must be between 0 and 31.',
      placement,
    });
  });

  it('rejects addSprite when order is out of range', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
    const placement: SpritePlacement = {
      sx: { value: 10 },
      sy: { value: 20 },
      elements: [{ imageId: 'sprite', order: 8 }],
    };

    const promise = renderer.addSprite(placement, true) as Promise<number>;

    await expect(promise).rejects.toMatchObject({
      message: 'Order must be between 0 and 7.',
      placement,
    });
  });

  it('rejects awaitable addSprite when wasm reports failure', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule({ failAddSprite: true });
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
    const placement = createPlacement(10, 20);
    const promise = renderer.addSprite(placement, true) as Promise<number>;

    renderer.render();

    await expect(promise).rejects.toMatchObject({ placement });
  });

  it('logs wasm command failures via logger', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule({ failAddSprite: true });
    const warnMessages: unknown[][] = [];
    const logger = {
      debug: () => {},
      info: () => {},
      warn: (message: string, ...args: unknown[]) => {
        warnMessages.push([message, ...args]);
      },
      error: () => {},
    };
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance,
      { logger }
    );
    const atlasId = allocateDefaultAtlas(renderer);

    await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
    const placement = createPlacement(10, 20);
    const promise = renderer.addSprite(placement, true) as Promise<number>;

    renderer.render();

    await expect(promise).rejects.toMatchObject({ placement });
    expect(
      warnMessages.some(
        ([message]) => message === 'Wasm command failures detected.'
      )
    ).toBe(true);
    const failureEntry = warnMessages.find(
      ([message]) => message === 'Wasm command failures detected.'
    );
    expect(failureEntry?.[1]).toMatchObject({
      commands: [
        expect.objectContaining({
          opName: 'addSprite',
        }),
      ],
    });
  });

  it('logs missing results when wasm reports zero result count', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule({ forceZeroResults: true });
    const warnMessages: unknown[][] = [];
    const logger = {
      debug: () => {},
      info: () => {},
      warn: (message: string, ...args: unknown[]) => {
        warnMessages.push([message, ...args]);
      },
      error: () => {},
    };
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance,
      { logger }
    );
    const atlasId = allocateDefaultAtlas(renderer);

    await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
    const placement = createPlacement(10, 20);
    const promise = renderer.addSprite(placement, true) as Promise<number>;

    renderer.render();

    await expect(promise).rejects.toMatchObject({ placement });
    expect(
      warnMessages.some(
        ([message]) => message === 'Wasm result buffer returned no results.'
      )
    ).toBe(true);
  });

  it('recovers results after wasm memory grows', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule({
      growMemoryAfterWrite: true,
    });
    const warnMessages: unknown[][] = [];
    const logger = {
      debug: () => {},
      info: () => {},
      warn: (message: string, ...args: unknown[]) => {
        warnMessages.push([message, ...args]);
      },
      error: () => {},
    };
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance,
      { logger }
    );
    const atlasId = allocateDefaultAtlas(renderer);

    await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
    const placement = createPlacement(10, 20);
    const promise = renderer.addSprite(placement, true) as Promise<number>;

    renderer.render();

    await expect(promise).resolves.toBe(0);
    expect(
      warnMessages.some(
        ([message]) => message === 'Wasm result buffer returned no results.'
      )
    ).toBe(false);
  });

  it('tracks command apply stats for updateSprite commands', async () => {
    const nowSpy = vi.spyOn(globalThis.performance, 'now');
    let now = 0;
    nowSpy.mockImplementation(() => {
      now += 1;
      return now;
    });

    try {
      const { gl } = createFakeGL();
      const { instance } = createFakeWasmModule();
      const renderer = createObjectRenderer(
        { widthPixel: 320, heightPixel: 240 },
        gl,
        createRendererResources(),
        instance
      );
      const atlasId = allocateDefaultAtlas(renderer);

      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const placement = createPlacement(10, 20);
      const promise = renderer.addSprite(placement, true) as Promise<number>;

      renderer.render();

      const spriteId = await promise;
      renderer.updateSprite(spriteId, { opacity: { value: 0.5 } });
      renderer.render();

      const snapshot = renderer.getPerformanceSnapshot();
      expect(snapshot.sampleCount).toBeGreaterThanOrEqual(2);
      expect(snapshot.avgCommandCount).toBeGreaterThan(0);
      expect(snapshot.avgUpdateSpriteCommandCount).toBeGreaterThan(0);
      expect(snapshot.avgCommandApplyDurationMs).toBeGreaterThanOrEqual(0);
      expect(snapshot.avgCommandApplyCallDurationMs).toBeGreaterThanOrEqual(0);
      expect(snapshot.avgCommandApplyJsDurationMs).toBeGreaterThanOrEqual(0);
      expect(snapshot.avgCommandApplyWasmDurationMs).toBeCloseTo(1, 5);
      expect(snapshot.avgCommandApplyWasmLoopDurationMs).toBeCloseTo(2, 5);
      expect(snapshot.avgCommandApplyWasmSyncSlotsDurationMs).toBeCloseTo(3, 5);
      expect(snapshot.avgCommandApplyWasmClearDurationMs).toBeCloseTo(4, 5);
      expect(snapshot.avgDrawSetupDurationMs).toBeGreaterThanOrEqual(0);
      expect(snapshot.avgEnsureRenderBuffersDurationMs).toBeGreaterThanOrEqual(
        0
      );
      expect(snapshot.avgVertexUploadDurationMs).toBeGreaterThanOrEqual(0);
      expect(snapshot.avgDrawLoopDurationMs).toBeGreaterThanOrEqual(0);
      expect(snapshot.avgWasmComputeInternalDurationMs).toBeCloseTo(10, 5);
      expect(snapshot.avgWasmComputeProjectionDurationMs).toBeCloseTo(11, 5);
      expect(snapshot.avgWasmComputeSpriteAnimationDurationMs).toBeCloseTo(
        12,
        5
      );
      expect(snapshot.avgWasmComputeElementAnimationDurationMs).toBeCloseTo(
        13,
        5
      );
      expect(snapshot.avgWasmComputePivotResolveDurationMs).toBeCloseTo(14, 5);
      expect(snapshot.avgWasmComputeAutoRotationDurationMs).toBeCloseTo(15, 5);
      expect(snapshot.avgWasmComputeCollectEntriesDurationMs).toBeCloseTo(
        16,
        5
      );
      expect(snapshot.avgWasmComputeSortEntriesDurationMs).toBeCloseTo(17, 5);
      expect(snapshot.avgWasmComputeWriteOutputDurationMs).toBeCloseTo(18, 5);
      expect(snapshot.avgTextureBindCount).toBeGreaterThanOrEqual(0);
      expect(snapshot.avgSkippedDrawCount).toBeGreaterThanOrEqual(0);
      expect(snapshot.avgTextureBindDurationMs).toBeGreaterThanOrEqual(0);
      expect(snapshot.avgOpacityUniformDurationMs).toBeGreaterThanOrEqual(0);
      expect(snapshot.avgDrawCallDurationMs).toBeGreaterThanOrEqual(0);
      expect(snapshot.updateFrameRatio).toBeGreaterThan(0);
      expect(snapshot.updateFrameRatio).toBeLessThanOrEqual(1);
      expect(snapshot.avgUpdateQueueDelayMs).toBeGreaterThanOrEqual(0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  it('resolves awaitable updateSprite after render', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
    const placement = createPlacement(10, 20);
    const addPromise = renderer.addSprite(placement, true) as Promise<number>;

    renderer.render();

    const spriteId = await addPromise;
    const updatePromise = renderer.updateSprite(
      spriteId,
      { opacity: { value: 0.5 } },
      true
    ) as Promise<void>;

    renderer.render();

    await expect(updatePromise).resolves.toBeUndefined();
  });

  it('rejects awaitable updateSprite when wasm reports failure', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule({ failUpdateSprite: true });
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
    const placement = createPlacement(10, 20);
    const addPromise = renderer.addSprite(placement, true) as Promise<number>;

    renderer.render();

    const spriteId = await addPromise;
    const updatePromise = renderer.updateSprite(
      spriteId,
      { opacity: { value: 0.5 } },
      true
    ) as Promise<void>;

    renderer.render();

    await expect(updatePromise).rejects.toMatchObject({ spriteId });
  });

  it('resolves awaitable updateCamera after render', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const updatePromise = renderer.updateCamera(
      {
        position: {
          x: { value: 1 },
          y: { value: 2 },
          z: { value: 3 },
        },
      },
      true
    ) as Promise<void>;

    renderer.render();

    await expect(updatePromise).resolves.toBeUndefined();
  });

  it('rejects awaitable updateCamera when wasm reports failure', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule({ failUpdateCamera: true });
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const camera = { position: { x: { value: 1 } } };
    const updatePromise = renderer.updateCamera(camera, true) as Promise<void>;

    renderer.render();

    await expect(updatePromise).rejects.toMatchObject({ camera });
  });

  it('resolves awaitable adjustCameraPosition after render', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );

    const adjustPromise = renderer.adjustCameraPosition(
      {
        pitch: { value: 30 },
        fov: { value: 50 },
        near: 0.5,
        far: 5000,
      },
      true
    ) as Promise<void>;

    renderer.render();

    await expect(adjustPromise).resolves.toBeUndefined();
    const cameraState = renderer.getCameraState();
    expect(cameraState.rotation.pitch.value).toBe(30);
    expect(cameraState.rotation.yaw.value).toBe(0);
    expect(cameraState.rotation.roll.value).toBe(0);
    expect(cameraState.fovY.value).toBe(50);
    expect(cameraState.near).toBe(0.5);
    expect(cameraState.far).toBe(5000);
  });

  it('rejects awaitable adjustCameraPosition when wasm reports failure', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule({
      failAdjustCameraPosition: true,
    });
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );

    const adjustPromise = renderer.adjustCameraPosition(
      { pitch: { value: 30 }, fov: { value: 50 } },
      true
    ) as Promise<void>;

    renderer.render();

    await expect(adjustPromise).rejects.toMatchObject({
      payload: expect.any(Object),
    });
  });

  it('uses provided camera state for viewportToWorldOnPlane', () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    try {
      const cameraValue = (value: number) => ({
        value,
        interpolation: undefined,
      });
      const cameraState: ObjectCameraState = {
        position: {
          x: cameraValue(12),
          y: cameraValue(34),
          z: cameraValue(56),
        },
        rotation: {
          yaw: cameraValue(1),
          pitch: cameraValue(2),
          roll: cameraValue(3),
        },
        fovY: cameraValue(45),
        near: 0.1,
        far: 500,
        aspectRatio: 1.25,
      };
      const result = renderer.viewportToWorldOnPlane(
        10,
        20,
        { widthPixel: 120, heightPixel: 80 },
        0,
        cameraState
      );
      expect(result).toEqual({ x: 12, y: 34, z: 0 });
    } finally {
      renderer.release();
    }
  });

  it('resolves awaitable removeSprite after render', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
    const placement = createPlacement(10, 20);
    const addPromise = renderer.addSprite(placement, true) as Promise<number>;

    renderer.render();

    const spriteId = await addPromise;
    const removePromise = renderer.removeSprite(
      spriteId,
      true
    ) as Promise<void>;

    renderer.render();

    await expect(removePromise).resolves.toBeUndefined();
  });

  it('rejects awaitable removeSprite when wasm reports failure', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule({ failRemoveSprite: true });
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
    const placement = createPlacement(10, 20);
    const addPromise = renderer.addSprite(placement, true) as Promise<number>;

    renderer.render();

    const spriteId = await addPromise;
    const removePromise = renderer.removeSprite(
      spriteId,
      true
    ) as Promise<void>;

    renderer.render();

    await expect(removePromise).rejects.toMatchObject({ spriteId });
  });

  it('keeps sprite ids consistent when removing multiple sprites in order', async () => {
    const { gl } = createFakeGL();
    const { instance } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap());
      const addPromise = renderer.addSprites(
        [
          createPlacement(10, 20),
          createPlacement(30, 40),
          createPlacement(50, 60),
        ],
        true
      ) as Promise<number[]>;

      renderer.render();

      const spriteIds = await addPromise;
      const [firstId, secondId, thirdId] = spriteIds;
      if (
        firstId === undefined ||
        secondId === undefined ||
        thirdId === undefined
      ) {
        throw new Error('Expected three sprites to be added.');
      }
      const removePromise = renderer.removeSprites(
        [firstId, secondId],
        true
      ) as Promise<void>;

      renderer.render();

      await expect(removePromise).resolves.toBeUndefined();

      const remainingUpdate = renderer.updateSprite(
        thirdId,
        { opacity: { value: 0.5 } },
        true
      ) as Promise<void>;

      renderer.render();

      await expect(remainingUpdate).resolves.toBeUndefined();

      const removedUpdate = renderer.updateSprite(
        secondId,
        { opacity: { value: 0.5 } },
        true
      ) as Promise<void>;

      await expect(removedUpdate).rejects.toMatchObject({ spriteId: secondId });
    } finally {
      renderer.release();
    }
  });

  it('applies billboard_perspective rotation in billboard space with perspective', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const camera = {
      position: { x: -25, y: -40, z: 120 },
      rotation: { yaw: 15, pitch: 35, roll: -10 },
      fovY: { value: 45 },
      near: 0.1,
      far: 500,
    };
    renderer.updateCamera({
      position: {
        x: { value: camera.position.x },
        y: { value: camera.position.y },
        z: { value: camera.position.z },
      },
      rotation: {
        yaw: { value: camera.rotation.yaw },
        pitch: { value: camera.rotation.pitch },
        roll: { value: camera.rotation.roll },
      },
      fovY: camera.fovY,
      near: camera.near,
      far: camera.far,
    });
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      const bitmap = createFakeBitmap(64, 48);
      await renderer.registerImage(atlasId, 'sprite', bitmap);
      const rotateDeg = 30;
      const addPromise = renderer.addSprite(
        {
          sx: { value: 40 },
          sy: { value: -25 },
          elements: [
            {
              imageId: 'sprite',
              mode: 'billboard_perspective',
              rotation: {
                value: rotateDeg,
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;
      renderer.render();

      const buffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(buffer).not.toBeNull();
      const [lb, rb, lt, rt] = getSpriteVertices(buffer!);
      const lbx = lb.x;
      const lby = lb.y;
      const lbz = lb.z;
      const rbx = rb.x;
      const rby = rb.y;
      const rbz = rb.z;
      const ltx = lt.x;
      const lty = lt.y;
      const ltz = lt.z;
      const rtx = rt.x;
      const rty = rt.y;
      const rtz = rt.z;

      const pivotX = (lbx + rbx + ltx + rtx) / 4;
      const pivotY = (lby + rby + lty + rty) / 4;
      const pivotZ = (lbz + rbz + ltz + rtz) / 4;

      const aspectRatio = 320 / 240;
      const { viewProjection } = computeViewProjection({
        ...camera,
        aspectRatio,
      });

      const pivotNdc = projectToNdc(viewProjection, pivotX, pivotY, pivotZ);
      expect(Number.isFinite(pivotNdc.x)).toBe(true);
      expect(Number.isFinite(pivotNdc.y)).toBe(true);

      const angleWorld = (-rotateDeg * Math.PI) / 180.0;
      const basis = resolveBillboardBasisFromForward(
        camera.position.x - pivotX,
        camera.position.y - pivotY,
        camera.position.z - pivotZ
      );
      const localOffset = 0;
      const localTop = -bitmap.height / 2;
      const localBottom = bitmap.height / 2;
      const ldeg = resolveBillboardEdgeScreenAngle(
        viewProjection,
        { x: pivotX, y: pivotY, z: pivotZ },
        basis,
        localOffset,
        localTop,
        localBottom,
        0,
        aspectRatio
      );
      let expectedAngle = ldeg + angleWorld;
      if (localTop < localBottom) {
        expectedAngle = normalizeAngle(expectedAngle + Math.PI);
      }

      const actualTop = projectToNdc(
        viewProjection,
        (ltx + rtx) / 2,
        (lty + rty) / 2,
        (ltz + rtz) / 2
      );
      const actualBottom = projectToNdc(
        viewProjection,
        (lbx + rbx) / 2,
        (lby + rby) / 2,
        (lbz + rbz) / 2
      );
      const actualAngle = Math.atan2(
        actualTop.y - actualBottom.y,
        (actualTop.x - actualBottom.x) * aspectRatio
      );

      expect(angleDiff(actualAngle, expectedAngle)).toBeLessThan(0.05);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('moves child pivot with billboard parent when camera position changes', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const camera = {
      position: { x: 0, y: -40, z: 120 },
      rotation: { yaw: 0, pitch: 25, roll: 0 },
      fovY: { value: 45 },
      near: 0.1,
      far: 500,
    };
    renderer.updateCamera({
      position: {
        x: { value: camera.position.x },
        y: { value: camera.position.y },
        z: { value: camera.position.z },
      },
      rotation: {
        yaw: { value: camera.rotation.yaw },
        pitch: { value: camera.rotation.pitch },
        roll: { value: camera.rotation.roll },
      },
      fovY: camera.fovY,
      near: camera.near,
      far: camera.far,
    });
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      await renderer.registerImage(atlasId, 'sprite', createFakeBitmap(16, 16));
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          sz: 0,
          elements: [
            {
              imageId: 'sprite',
              mode: 'billboard_perspective',
              order: 0,
            },
            {
              imageId: 'sprite',
              originLocation: { index: 0 },
              mode: 'surface',
              order: 1,
              shiftDistance: { value: 12 },
              shiftAngleDeg: { value: 0 },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;
      calls.bufferData.length = 0;
      renderer.render();

      const buffer1 = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(buffer1).not.toBeNull();
      const childCenter1 = getQuadCenter(buffer1!, 1);

      renderer.updateCamera({
        position: {
          x: { value: camera.position.x + 30 },
          y: { value: camera.position.y },
          z: { value: camera.position.z },
        },
      });
      calls.bufferData.length = 0;
      renderer.render();
      const buffer2 = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(buffer2).not.toBeNull();
      const childCenter2 = getQuadCenter(buffer2!, 1);

      const delta = Math.hypot(
        childCenter2.x - childCenter1.x,
        childCenter2.y - childCenter1.y,
        childCenter2.z - childCenter1.z
      );
      expect(delta).toBeGreaterThan(1.0e-3);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('aligns billboard rotation to screen direction', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const camera = {
      position: { x: 0, y: 0, z: 120 },
      rotation: { yaw: 0, pitch: 0, roll: 0 },
      fovY: { value: 45 },
      near: 0.1,
      far: 500,
    };
    renderer.updateCamera({
      position: {
        x: { value: camera.position.x },
        y: { value: camera.position.y },
        z: { value: camera.position.z },
      },
      rotation: {
        yaw: { value: camera.rotation.yaw },
        pitch: { value: camera.rotation.pitch },
        roll: { value: camera.rotation.roll },
      },
      fovY: camera.fovY,
      near: camera.near,
      far: camera.far,
    });
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      const bitmap = createFakeBitmap(64, 48);
      await renderer.registerImage(atlasId, 'sprite', bitmap);
      const rotateDeg = 45;
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [
            {
              imageId: 'sprite',
              mode: 'billboard',
              rotation: {
                value: rotateDeg,
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;
      renderer.render();

      const buffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(buffer).not.toBeNull();
      const [lb, rb, lt, rt] = getSpriteVertices(buffer!);
      const lbx = lb.x;
      const lby = lb.y;
      const lbz = lb.z;
      const rbx = rb.x;
      const rby = rb.y;
      const rbz = rb.z;
      const ltx = lt.x;
      const lty = lt.y;
      const ltz = lt.z;
      const rtx = rt.x;
      const rty = rt.y;
      const rtz = rt.z;

      const pivot = {
        x: (lbx + rbx + ltx + rtx) / 4,
        y: (lby + rby + lty + rty) / 4,
        z: (lbz + rbz + ltz + rtz) / 4,
      };
      const aspectRatio = 320 / 240;
      const { viewProjection } = computeViewProjection({
        ...camera,
        aspectRatio,
      });
      const top = projectToNdc(
        viewProjection,
        (ltx + rtx) / 2,
        (lty + rty) / 2,
        (ltz + rtz) / 2
      );
      const bottom = projectToNdc(
        viewProjection,
        (lbx + rbx) / 2,
        (lby + rby) / 2,
        (lbz + rbz) / 2
      );
      const actualAngle = Math.atan2(
        top.y - bottom.y,
        (top.x - bottom.x) * aspectRatio
      );

      const expectedAngle = resolveScreenAngleFromWorld(
        viewProjection,
        pivot,
        (-rotateDeg * Math.PI) / 180.0,
        aspectRatio
      );

      expect(angleDiff(actualAngle, expectedAngle)).toBeLessThan(0.05);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('writes billboard_perspective UVs consistently across quad vertices', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const camera = {
      position: { x: 0, y: 0, z: 120 },
      rotation: { yaw: 0, pitch: 0, roll: 0 },
      fovY: { value: 45 },
      near: 0.1,
      far: 500,
    };
    renderer.updateCamera({
      position: {
        x: { value: camera.position.x },
        y: { value: camera.position.y },
        z: { value: camera.position.z },
      },
      rotation: {
        yaw: { value: camera.rotation.yaw },
        pitch: { value: camera.rotation.pitch },
        roll: { value: camera.rotation.roll },
      },
      fovY: camera.fovY,
      near: camera.near,
      far: camera.far,
    });
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      const bitmap = createFakeBitmap(64, 48);
      await renderer.registerImage(atlasId, 'sprite', bitmap);
      const addPromise = renderer.addSprite(
        {
          sx: { value: 0 },
          sy: { value: 0 },
          elements: [
            {
              imageId: 'sprite',
              mode: 'billboard_perspective',
              rotation: {
                value: 0,
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      await addPromise;
      renderer.render();

      const buffer = calls.bufferData[calls.bufferData.length - 1] ?? null;
      expect(buffer).not.toBeNull();
      const [lb, rb, lt, rt] = getSpriteVertices(buffer!);
      const u0 = lb.u;
      const v0 = lb.v;
      const u1 = rb.u;
      const v0b = rb.v;
      const u0b = lt.u;
      const v1 = lt.v;
      const u1b = rt.u;
      const v1b = rt.v;

      expect(u0).toBeCloseTo(u0b, 6);
      expect(u1).toBeCloseTo(u1b, 6);
      expect(v0).toBeCloseTo(v0b, 6);
      expect(v1).toBeCloseTo(v1b, 6);
      expect(u1).toBeGreaterThan(u0);
      expect(v1).toBeGreaterThan(v0);
    } finally {
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('interpolates billboard_perspective rotation linearly in screen space', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const globalWithRotationLog = globalThis as typeof globalThis & {
      outputRotationLog?: boolean;
      outputRotationLogEntries?: boolean;
      rotationLogSink?: (message: string) => void;
    };
    const prevOutputRotationLog = globalWithRotationLog.outputRotationLog;
    const prevOutputRotationLogEntries =
      globalWithRotationLog.outputRotationLogEntries;
    const prevRotationLogSink = globalWithRotationLog.rotationLogSink;
    const camera = {
      position: { x: -25, y: -40, z: 120 },
      rotation: { yaw: 15, pitch: 35, roll: -10 },
      fovY: { value: 45 },
      near: 0.1,
      far: 500,
    };
    renderer.updateCamera({
      position: {
        x: { value: camera.position.x },
        y: { value: camera.position.y },
        z: { value: camera.position.z },
      },
      rotation: {
        yaw: { value: camera.rotation.yaw },
        pitch: { value: camera.rotation.pitch },
        roll: { value: camera.rotation.roll },
      },
      fovY: camera.fovY,
      near: camera.near,
      far: camera.far,
    });
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      const rotationLogLines: string[] = [];
      globalWithRotationLog.outputRotationLog = true;
      globalWithRotationLog.outputRotationLogEntries = true;
      globalWithRotationLog.rotationLogSink = (message: string) => {
        rotationLogLines.push(message);
      };
      const bitmap = createFakeBitmap(64, 48);
      await renderer.registerImage(atlasId, 'sprite', bitmap);
      const addPromise = renderer.addSprite(
        {
          sx: { value: 40 },
          sy: { value: -25 },
          elements: [
            {
              imageId: 'sprite',
              mode: 'billboard_perspective',
              rotation: {
                value: 0,
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const updatePromise = renderer.updateSprite(
        spriteId,
        {
          elements: [
            {
              rotation: {
                value: 90,
                interpolation: {
                  mode: 'feedback',
                  durationMs: 1000,
                  easing: { type: 'linear' },
                },
              },
            },
          ],
        },
        true
      ) as Promise<void>;
      renderer.render();
      await updatePromise;

      const aspectRatio = 320 / 240;
      const { viewProjection } = computeViewProjection({
        ...camera,
        aspectRatio,
      });
      const sampleTimes = [0, 250, 500, 750, 1000];
      const samples: Array<{ t: number; angle: number }> = [];
      for (const sampleMs of sampleTimes) {
        nowMs = sampleMs;
        renderer.render();
        const buffer = calls.bufferData[calls.bufferData.length - 1];
        if (!buffer) {
          throw new Error('Missing sprite buffer data.');
        }
        const actualAngle = resolveScreenAngleFromBuffer(
          viewProjection,
          buffer,
          aspectRatio
        );
        samples.push({ t: sampleMs, angle: actualAngle });
      }
      const unwrapped = unwrapAngles(samples.map((sample) => sample.angle));
      const screenFrom = unwrapped[0]!;
      const screenTo = unwrapped[unwrapped.length - 1]!;
      const screenDelta = screenTo - screenFrom;
      const lerpSamples: Array<{
        tMs: number;
        actualRad: number;
        expectedRad: number;
      }> = [];
      const errors: number[] = [];
      let maxErrorRad = 0;
      samples.forEach((sample, index) => {
        const t = Math.min(1, Math.max(0, sample.t / 1000));
        const expectedAngle = screenFrom + screenDelta * t;
        const actualAngle = unwrapped[index]!;
        lerpSamples.push({
          tMs: sample.t,
          actualRad: actualAngle,
          expectedRad: expectedAngle,
        });
        const error = Math.abs(actualAngle - expectedAngle);
        errors.push(error);
        maxErrorRad = Math.max(maxErrorRad, error);
      });

      const outputDir = getTestResultsDir(
        'object-renderer',
        'screen-lerp-small'
      );
      const svgContent = buildScreenLerpSvg(
        lerpSamples,
        'billboard_perspective linear screen lerp (small sprite)'
      );
      writeFileSync(
        resolve(outputDir, 'billboard_perspective_screen_lerp_small.svg'),
        svgContent
      );
      writeFileSync(
        resolve(outputDir, 'billboard_perspective_screen_lerp_small.log'),
        rotationLogLines.join('\n')
      );
      appendAnalysisLog(
        outputDir,
        `[object-renderer-screen-lerp] case=small samples=${lerpSamples.length} maxErrorRad=${maxErrorRad.toFixed(
          6
        )} maxErrorDeg=${toDegrees(maxErrorRad).toFixed(3)} screenFrom=${screenFrom.toFixed(
          6
        )} screenTo=${screenTo.toFixed(6)} samplesDeg=${lerpSamples
          .map(
            (sample) =>
              `${sample.tMs}:${toDegrees(sample.actualRad).toFixed(
                2
              )}/${toDegrees(sample.expectedRad).toFixed(2)}`
          )
          .join(',')}`
      );
      errors.forEach((error) => {
        expect(error).toBeLessThan(0.05);
      });
    } finally {
      if (prevOutputRotationLog === undefined) {
        delete globalWithRotationLog.outputRotationLog;
      } else {
        globalWithRotationLog.outputRotationLog = prevOutputRotationLog;
      }
      if (prevOutputRotationLogEntries === undefined) {
        delete globalWithRotationLog.outputRotationLogEntries;
      } else {
        globalWithRotationLog.outputRotationLogEntries =
          prevOutputRotationLogEntries;
      }
      if (prevRotationLogSink === undefined) {
        delete globalWithRotationLog.rotationLogSink;
      } else {
        globalWithRotationLog.rotationLogSink = prevRotationLogSink;
      }
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('interpolates billboard_perspective rotation linearly for large sprites', async () => {
    let nowMs = 0;
    vi.stubGlobal('performance', { now: () => nowMs });
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const instance = await loadWasmModule(bytes);
    const { gl, calls } = createFakeGL();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );
    const globalWithRotationLog = globalThis as typeof globalThis & {
      outputRotationLog?: boolean;
      outputRotationLogEntries?: boolean;
      rotationLogSink?: (message: string) => void;
    };
    const prevOutputRotationLog = globalWithRotationLog.outputRotationLog;
    const prevOutputRotationLogEntries =
      globalWithRotationLog.outputRotationLogEntries;
    const prevRotationLogSink = globalWithRotationLog.rotationLogSink;
    const camera = {
      position: { x: -80, y: -60, z: 200 },
      rotation: { yaw: 20, pitch: 55, roll: -15 },
      fovY: { value: 45 },
      near: 0.1,
      far: 500,
    };
    renderer.updateCamera({
      position: {
        x: { value: camera.position.x },
        y: { value: camera.position.y },
        z: { value: camera.position.z },
      },
      rotation: {
        yaw: { value: camera.rotation.yaw },
        pitch: { value: camera.rotation.pitch },
        roll: { value: camera.rotation.roll },
      },
      fovY: camera.fovY,
      near: camera.near,
      far: camera.far,
    });
    const atlasId = allocateDefaultAtlas(renderer);

    try {
      const rotationLogLines: string[] = [];
      globalWithRotationLog.outputRotationLog = true;
      globalWithRotationLog.outputRotationLogEntries = true;
      globalWithRotationLog.rotationLogSink = (message: string) => {
        rotationLogLines.push(message);
      };
      const bitmap = createFakeBitmap(128, 256);
      await renderer.registerImage(atlasId, 'sprite', bitmap);
      const addPromise = renderer.addSprite(
        {
          sx: { value: 60 },
          sy: { value: -40 },
          elements: [
            {
              imageId: 'sprite',
              mode: 'billboard_perspective',
              scale: { value: 3 },
              rotation: {
                value: 0,
              },
            },
          ],
        },
        true
      ) as Promise<number>;
      renderer.render();
      const spriteId = await addPromise;

      const updatePromise = renderer.updateSprite(
        spriteId,
        {
          elements: [
            {
              rotation: {
                value: 120,
                interpolation: {
                  mode: 'feedback',
                  durationMs: 1000,
                  easing: { type: 'linear' },
                },
              },
            },
          ],
        },
        true
      ) as Promise<void>;
      renderer.render();
      await updatePromise;

      const aspectRatio = 320 / 240;
      const { viewProjection } = computeViewProjection({
        ...camera,
        aspectRatio,
      });
      const sampleTimes = [0, 250, 500, 750, 1000];
      const samples: Array<{ t: number; angle: number }> = [];
      for (const sampleMs of sampleTimes) {
        nowMs = sampleMs;
        renderer.render();
        const buffer = calls.bufferData[calls.bufferData.length - 1];
        if (!buffer) {
          throw new Error('Missing sprite buffer data.');
        }
        const actualAngle = resolveScreenAngleFromBuffer(
          viewProjection,
          buffer,
          aspectRatio
        );
        samples.push({ t: sampleMs, angle: actualAngle });
      }
      const unwrapped = unwrapAngles(samples.map((sample) => sample.angle));
      const screenFrom = unwrapped[0]!;
      const screenTo = unwrapped[unwrapped.length - 1]!;
      const screenDelta = screenTo - screenFrom;
      const lerpSamples: Array<{
        tMs: number;
        actualRad: number;
        expectedRad: number;
      }> = [];
      const errors: number[] = [];
      let maxErrorRad = 0;
      samples.forEach((sample, index) => {
        const t = Math.min(1, Math.max(0, sample.t / 1000));
        const expectedAngle = screenFrom + screenDelta * t;
        const actualAngle = unwrapped[index]!;
        lerpSamples.push({
          tMs: sample.t,
          actualRad: actualAngle,
          expectedRad: expectedAngle,
        });
        const error = Math.abs(actualAngle - expectedAngle);
        errors.push(error);
        maxErrorRad = Math.max(maxErrorRad, error);
      });

      const outputDir = getTestResultsDir(
        'object-renderer',
        'screen-lerp-large'
      );
      const svgContent = buildScreenLerpSvg(
        lerpSamples,
        'billboard_perspective linear screen lerp (large sprite)'
      );
      writeFileSync(
        resolve(outputDir, 'billboard_perspective_screen_lerp_large.svg'),
        svgContent
      );
      writeFileSync(
        resolve(outputDir, 'billboard_perspective_screen_lerp_large.log'),
        rotationLogLines.join('\n')
      );
      appendAnalysisLog(
        outputDir,
        `[object-renderer-screen-lerp] case=large samples=${lerpSamples.length} maxErrorRad=${maxErrorRad.toFixed(
          6
        )} maxErrorDeg=${toDegrees(maxErrorRad).toFixed(3)} screenFrom=${screenFrom.toFixed(
          6
        )} screenTo=${screenTo.toFixed(6)} samplesDeg=${lerpSamples
          .map(
            (sample) =>
              `${sample.tMs}:${toDegrees(sample.actualRad).toFixed(
                2
              )}/${toDegrees(sample.expectedRad).toFixed(2)}`
          )
          .join(',')}`
      );
      errors.forEach((error) => {
        expect(error).toBeLessThan(0.03);
      });
    } finally {
      if (prevOutputRotationLog === undefined) {
        delete globalWithRotationLog.outputRotationLog;
      } else {
        globalWithRotationLog.outputRotationLog = prevOutputRotationLog;
      }
      if (prevOutputRotationLogEntries === undefined) {
        delete globalWithRotationLog.outputRotationLogEntries;
      } else {
        globalWithRotationLog.outputRotationLogEntries =
          prevOutputRotationLogEntries;
      }
      if (prevRotationLogSink === undefined) {
        delete globalWithRotationLog.rotationLogSink;
      } else {
        globalWithRotationLog.rotationLogSink = prevRotationLogSink;
      }
      renderer.release();
      vi.unstubAllGlobals();
    }
  });

  it('preserves queued camera aspect ratio when updateCamera follows setViewPortSize', () => {
    const { gl } = createFakeGL();
    const { instance, state } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );

    renderer.setViewPortSize({ widthPixel: 200, heightPixel: 100 });
    renderer.updateCamera({
      position: {
        x: { value: 1 },
        y: { value: 2 },
        z: { value: 3 },
      },
    });

    const context = Array.from(state.contexts.values())[0];
    if (!context) {
      throw new Error('Missing wasm context state.');
    }
    const commandBuffer = new Float32Array(
      state.memory.buffer,
      context.commandPtr,
      context.commandCount
    );
    const commandCount = Math.trunc(
      commandBuffer[cl.COMMAND_BUFFER_COMMAND_COUNT_OFFSET]!
    );
    let cursor = cl.COMMAND_BUFFER_HEADER_FIELDS;
    const updateOffsets: number[] = [];
    for (let index = 0; index < commandCount; index += 1) {
      const op = Math.trunc(
        commandBuffer[cursor + cl.COMMAND_HEADER_OP_OFFSET]!
      );
      const size = Math.trunc(
        commandBuffer[cursor + cl.COMMAND_HEADER_SIZE_OFFSET]!
      );
      if (op === cl.COMMAND_OP_UPDATE_CAMERA) {
        updateOffsets.push(cursor);
      }
      cursor += size;
    }
    if (updateOffsets.length === 0) {
      throw new Error('Missing update camera command.');
    }
    const aspectUpdates = updateOffsets.filter(
      (offset) =>
        commandBuffer[
          offset + cl.COMMAND_UPDATE_CAMERA_VIEWPORT_ASPECT_HAS_OFFSET
        ] !== 0
    );
    expect(aspectUpdates.length).toBeGreaterThan(0);
    const aspectRatio =
      commandBuffer[
        aspectUpdates[aspectUpdates.length - 1]! +
          cl.COMMAND_UPDATE_CAMERA_VIEWPORT_ASPECT_VALUE_OFFSET
      ]!;
    expect(aspectRatio).toBeCloseTo(2.0, 6);
    const lastUpdateOffset = updateOffsets[updateOffsets.length - 1]!;
    expect(
      commandBuffer[
        lastUpdateOffset + cl.COMMAND_UPDATE_CAMERA_VIEWPORT_ASPECT_HAS_OFFSET
      ]
    ).toBe(0);
  });

  it('updates only provided camera fields for position', () => {
    const { gl } = createFakeGL();
    const { instance, state } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );

    renderer.updateCamera({
      position: {
        x: { value: 10 },
        y: { value: 20 },
        z: { value: 30 },
      },
      rotation: {
        yaw: { value: 5 },
        pitch: { value: 6 },
        roll: { value: 7 },
      },
      fovY: { value: 60 },
      near: 0.5,
      far: 900,
    });
    renderer.setViewPortSize({ widthPixel: 200, heightPixel: 100 });
    renderer.render();

    renderer.updateCamera({ position: { x: { value: 100 } } });
    renderer.render();

    const context = Array.from(state.contexts.values())[0];
    if (!context) {
      throw new Error('Missing wasm context state.');
    }
    const camera = context.cameraState;
    expect(camera[wl.CAMERA_POSITION_X_OFFSET]).toBe(100);
    expect(camera[wl.CAMERA_POSITION_Y_OFFSET]).toBe(20);
    expect(camera[wl.CAMERA_POSITION_Z_OFFSET]).toBe(30);
    expect(camera[wl.CAMERA_ROTATION_YAW_OFFSET]).toBe(5);
    expect(camera[wl.CAMERA_ROTATION_PITCH_OFFSET]).toBe(6);
    expect(camera[wl.CAMERA_ROTATION_ROLL_OFFSET]).toBe(7);
    expect(camera[wl.CAMERA_FOV_Y_OFFSET]).toBe(60);
    expect(camera[wl.CAMERA_NEAR_OFFSET]).toBe(0.5);
    expect(camera[wl.CAMERA_FAR_OFFSET]).toBe(900);
    expect(camera[wl.CAMERA_VIEWPORT_ASPECT_OFFSET]).toBeCloseTo(2.0, 6);
  });

  it('updates only provided camera fields for near', () => {
    const { gl } = createFakeGL();
    const { instance, state } = createFakeWasmModule();
    const renderer = createObjectRenderer(
      { widthPixel: 320, heightPixel: 240 },
      gl,
      createRendererResources(),
      instance
    );

    renderer.updateCamera({
      position: {
        x: { value: -1 },
        y: { value: -2 },
        z: { value: -3 },
      },
      rotation: {
        yaw: { value: 10 },
        pitch: { value: 20 },
        roll: { value: 30 },
      },
      fovY: { value: 45 },
      near: 0.25,
      far: 700,
    });
    renderer.setViewPortSize({ widthPixel: 150, heightPixel: 100 });
    renderer.render();

    renderer.updateCamera({ near: 1.2 });
    renderer.render();

    const context = Array.from(state.contexts.values())[0];
    if (!context) {
      throw new Error('Missing wasm context state.');
    }
    const camera = context.cameraState;
    expect(camera[wl.CAMERA_NEAR_OFFSET]).toBeCloseTo(1.2, 6);
    expect(camera[wl.CAMERA_FAR_OFFSET]).toBe(700);
    expect(camera[wl.CAMERA_FOV_Y_OFFSET]).toBe(45);
    expect(camera[wl.CAMERA_POSITION_X_OFFSET]).toBe(-1);
    expect(camera[wl.CAMERA_POSITION_Y_OFFSET]).toBe(-2);
    expect(camera[wl.CAMERA_POSITION_Z_OFFSET]).toBe(-3);
    expect(camera[wl.CAMERA_ROTATION_YAW_OFFSET]).toBe(10);
    expect(camera[wl.CAMERA_ROTATION_PITCH_OFFSET]).toBe(20);
    expect(camera[wl.CAMERA_ROTATION_ROLL_OFFSET]).toBe(30);
    expect(camera[wl.CAMERA_VIEWPORT_ASPECT_OFFSET]).toBeCloseTo(1.5, 6);
  });
});
