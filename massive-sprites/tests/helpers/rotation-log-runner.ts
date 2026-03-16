// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import { isAbsolute, resolve } from 'path';

import { createObjectRenderer as createCoreObjectRenderer } from '../../src/renderer';
import type {
  SizeInPixel,
  CameraUpdate,
  SpriteElementRenderMode,
  ObjectInterpolationEasing,
  ObjectInterpolationParameter,
} from '../../src/types';
import { wrapDegrees } from '../../src/utils';
import { loadWasmModule } from '../../src/wasm';
import { createFakeBitmap, createFakeGL } from './object-renderer-test-kit';
import { getTestResultsDir } from './test-log-paths';

type RotationLogEasingType = ObjectInterpolationEasing['type'] | 'none';

type RotationLogImage = {
  readonly imageId: string;
  readonly width: number;
  readonly height: number;
};

type RotationLogCamera = {
  readonly position: { x: number; y: number; z: number };
  readonly rotation: { yaw: number; pitch: number; roll: number };
  readonly fovY?: number;
  readonly near?: number;
  readonly far?: number;
};

type RotationLogMoveConfig = {
  readonly mode: RotationLogEasingType;
  readonly feedforward: boolean;
  readonly speedScale: number;
};

type RotationLogRotationConfig = {
  readonly mode: RotationLogEasingType;
  readonly feedforward: boolean;
  readonly speedScale: number;
  readonly autoRotation: boolean;
  readonly autoRotationDistance: number;
  readonly renderMode: SpriteElementRenderMode;
};

export type RotationLogScenario = {
  readonly name: string;
  readonly gridSize: number;
  readonly viewSize: SizeInPixel;
  readonly camera: RotationLogCamera;
  readonly images: readonly RotationLogImage[];
  readonly atlasSize?: SizeInPixel;
  readonly logDir?: string;
  readonly logFileName?: string;
  readonly logFileDate?: Date;
  readonly move: RotationLogMoveConfig;
  readonly rotation: RotationLogRotationConfig;
  readonly frames: number;
  readonly frameStepMs?: number;
  readonly updateIntervalMs?: number;
  readonly outputVerbose?: boolean;
  readonly outputEntries?: boolean;
};

export type RotationLogRunResult = {
  readonly logFilePath: string;
  readonly totalSprites: number;
  readonly totalFrames: number;
};

export type RotationLogSample = {
  readonly tMs: number;
  readonly dtMs: number;
  readonly angleDeg: number;
  readonly rotateDeg: number;
  readonly finalRotateDeg: number;
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

const toCameraUpdate = (camera: RotationLogCamera): CameraUpdate => ({
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
  ...(camera.fovY !== undefined ? { fovY: { value: camera.fovY } } : {}),
  ...(camera.near !== undefined ? { near: camera.near } : {}),
  ...(camera.far !== undefined ? { far: camera.far } : {}),
});

export type RotationLogAnalysis = {
  readonly sampleCount: number;
  readonly changeSampleCount: number;
  readonly angleMaxResidualDeg: number;
  readonly angleRmsResidualDeg: number;
  readonly finalMaxResidualDeg: number;
  readonly finalRmsResidualDeg: number;
};

const ROTATE_STEP_DEG = 45;
const MOVE_PHASES = [1, 2, 1, 0, -1, -2, -1, 0] as const;

const resolveDemoInterpolationEasing = (
  type: Exclude<RotationLogEasingType, 'none'>
): ObjectInterpolationEasing => {
  switch (type) {
    case 'linear':
      return { type: 'linear' };
    case 'sigmoid':
      return { type: 'sigmoid', k: 14, mid: 0.35 };
    case 'ease':
      return { type: 'ease', power: 9, mode: 'out' };
    case 'exponential':
      return { type: 'exponential', exponent: 4, mode: 'in' };
    case 'quadratic':
      return { type: 'quadratic', mode: 'out' };
    case 'cubic':
      return { type: 'cubic', mode: 'in' };
    case 'sine':
      return { type: 'sine', mode: 'out', amplitude: 1 };
    case 'bounce':
      return { type: 'bounce', bounces: 2, decay: 0.1 };
    case 'back':
      return { type: 'back', overshoot: 2 };
  }
};

const buildInterpolation = (
  mode: RotationLogEasingType,
  feedforward: boolean
): ObjectInterpolationParameter | undefined => {
  if (mode === 'none') {
    return undefined;
  }
  return {
    mode: feedforward ? 'feedforward' : 'feedback',
    durationMs: 500,
    easing: resolveDemoInterpolationEasing(mode),
  };
};

const normalizeRotateDeg = (rotateDeg: number) => {
  if (rotateDeg >= 360 || rotateDeg <= -360) {
    return rotateDeg % 360;
  }
  return rotateDeg;
};

const clampGridSize = (size: number, min = 1, max = 400) => {
  if (!Number.isFinite(size)) {
    return min;
  }
  const rounded = Math.round(size);
  return Math.min(max, Math.max(min, rounded));
};

const getGridCellSize = (images: readonly RotationLogImage[]) => {
  if (images.length === 0) {
    throw new Error('Grid images are required.');
  }
  const cellWidth = Math.max(...images.map((image) => image.width));
  const cellHeight = Math.max(...images.map((image) => image.height));
  return { cellWidth, cellHeight };
};

const resolveAtlasSize = (
  images: readonly RotationLogImage[],
  minSize = 512
): SizeInPixel => {
  const maxWidth = Math.max(...images.map((image) => image.width));
  const maxHeight = Math.max(...images.map((image) => image.height));
  const nextPowerOfTwo = (value: number) => {
    let result = 1;
    while (result < value) {
      result <<= 1;
    }
    return result;
  };
  return {
    widthPixel: Math.max(minSize, nextPowerOfTwo(maxWidth)),
    heightPixel: Math.max(minSize, nextPowerOfTwo(maxHeight)),
  };
};

const computeGridLayout = (
  gridSize: number,
  viewWidth: number,
  viewHeight: number,
  cellWidth: number,
  cellHeight: number
) => {
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

const getGridPosition = (
  layout: ReturnType<typeof computeGridLayout>,
  xIndex: number,
  yIndex: number
) => ({
  x: layout.startX + layout.stepX * xIndex,
  y: layout.startY - layout.stepY * yIndex,
});

const formatTimestamp = (date: Date) => {
  const pad = (value: number) => String(value).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hour = pad(date.getHours());
  const minute = pad(date.getMinutes());
  const second = pad(date.getSeconds());
  return `${year}${month}${day}_${hour}${minute}${second}`;
};

const resolveLogOutputDir = (logDir?: string) => {
  const baseDir = getTestResultsDir('rotation-log');
  if (!logDir) {
    return baseDir;
  }
  return isAbsolute(logDir) ? logDir : resolve(baseDir, logDir);
};

const createRotationLogFile = (
  date?: Date,
  logDir?: string,
  logFileName?: string
) => {
  const outputDir = resolveLogOutputDir(logDir);
  mkdirSync(outputDir, { recursive: true });
  const fileName = logFileName ?? `${formatTimestamp(date ?? new Date())}.log`;
  const filePath = resolve(outputDir, fileName);
  writeFileSync(filePath, '');
  return filePath;
};

export const formatRotationLogTimestamp = formatTimestamp;

export const parseRotationLogFile = (filePath: string): RotationLogSample[] => {
  const content = readFileSync(filePath, 'utf-8');
  const lines = content.split(/\r?\n/);
  const samples: RotationLogSample[] = [];
  const pattern =
    /\[rotation-log\] frame=\d+ t=([0-9.]+) dt=([0-9.]+) angleDeg=(-?[0-9.]+) rotateDeg=(-?[0-9.]+|NaN) finalRotateDeg=(-?[0-9.]+|NaN)/;
  for (const line of lines) {
    const match = pattern.exec(line);
    if (!match) {
      continue;
    }
    const tMs = Number.parseFloat(match[1] ?? '0');
    const dtMs = Number.parseFloat(match[2] ?? '0');
    const angleDeg = Number.parseFloat(match[3] ?? '0');
    const rotateDeg = Number.parseFloat(match[4] ?? 'NaN');
    const finalRotateDeg = Number.parseFloat(match[5] ?? 'NaN');
    samples.push({
      tMs,
      dtMs,
      angleDeg,
      rotateDeg,
      finalRotateDeg,
    });
  }
  return samples;
};

const fitLine = (xs: number[], ys: number[]) => {
  const count = xs.length;
  if (count === 0) {
    return { slope: 0, intercept: 0, maxAbs: 0, rms: 0 };
  }
  const xMean = xs.reduce((sum, value) => sum + value, 0) / count;
  const yMean = ys.reduce((sum, value) => sum + value, 0) / count;
  let numerator = 0;
  let denominator = 0;
  xs.forEach((xValue, index) => {
    const dx = xValue - xMean;
    numerator += dx * (ys[index]! - yMean);
    denominator += dx * dx;
  });
  const slope = denominator === 0 ? 0 : numerator / denominator;
  const intercept = yMean - slope * xMean;
  const residuals = xs.map((xValue, index) => {
    const expected = slope * xValue + intercept;
    return ys[index]! - expected;
  });
  const maxAbs = residuals.reduce(
    (maxValue, value) => Math.max(maxValue, Math.abs(value)),
    0
  );
  const rms = Math.sqrt(
    residuals.reduce((sum, value) => sum + value * value, 0) / count
  );
  return { slope, intercept, maxAbs, rms };
};

const unwrapDegrees = (angles: number[]) => {
  if (angles.length === 0) {
    return [];
  }
  const unwrapped = [angles[0]!];
  for (let i = 1; i < angles.length; i += 1) {
    const current = angles[i]!;
    const prevWrapped = angles[i - 1]!;
    const prev = unwrapped[i - 1]!;
    const delta = wrapDegrees(current - prevWrapped);
    unwrapped.push(prev + delta);
  }
  return unwrapped;
};

export const analyzeRotationLogSamples = (
  samples: RotationLogSample[]
): RotationLogAnalysis => {
  if (samples.length === 0) {
    return {
      sampleCount: 0,
      changeSampleCount: 0,
      angleMaxResidualDeg: 0,
      angleRmsResidualDeg: 0,
      finalMaxResidualDeg: 0,
      finalRmsResidualDeg: 0,
    };
  }
  const eps = 0.01;
  const changeSamples = samples.filter((sample, index) => {
    if (index === 0) {
      return false;
    }
    const prev = samples[index - 1];
    return (
      prev !== undefined &&
      Math.abs(sample.finalRotateDeg - prev.finalRotateDeg) > eps
    );
  });
  if (changeSamples.length < 3) {
    return {
      sampleCount: samples.length,
      changeSampleCount: changeSamples.length,
      angleMaxResidualDeg: 0,
      angleRmsResidualDeg: 0,
      finalMaxResidualDeg: 0,
      finalRmsResidualDeg: 0,
    };
  }
  const times = changeSamples.map((sample) => sample.tMs);
  const angleValues = unwrapDegrees(
    changeSamples.map((sample) => sample.angleDeg)
  );
  const finalValues = changeSamples.map((sample) => sample.finalRotateDeg);
  const angleFit = fitLine(times, angleValues);
  const finalFit = fitLine(times, finalValues);
  return {
    sampleCount: samples.length,
    changeSampleCount: changeSamples.length,
    angleMaxResidualDeg: angleFit.maxAbs,
    angleRmsResidualDeg: angleFit.rms,
    finalMaxResidualDeg: finalFit.maxAbs,
    finalRmsResidualDeg: finalFit.rms,
  };
};

export const buildAngleDtSvg = (
  entries: readonly { mode: string; samples: RotationLogSample[] }[]
) => {
  const width = 1120;
  const plotWidth = 520;
  const plotHeight = 220;
  const rowHeight = 238;
  const leftX = 40;
  const rightX = 600;
  const rowCount = Math.max(1, entries.length);
  const height = 44 + (rowCount - 1) * rowHeight + plotHeight + 54;
  const svg: string[] = [];
  svg.push(
    `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${width}\" height=\"${height}\">`
  );
  svg.push('<rect width=\"100%\" height=\"100%\" fill=\"#ffffff\"/>');

  const angleToY = (angle: number, y0: number) =>
    y0 + plotHeight * (1 - (angle + 180) / 360);
  const dtToY = (dt: number, y0: number) =>
    y0 + plotHeight * (1 - Math.min(Math.max(dt, 0), 55) / 55);

  const buildPath = (points: Array<[number, number]>) => {
    if (points.length === 0) {
      return '';
    }
    return `M ${points
      .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
      .join(' L ')}`;
  };

  entries.forEach((entry, index) => {
    const y0 = 44 + index * rowHeight;
    const labelY = 34 + index * rowHeight;
    const samples = entry.samples;
    const timeBase = samples[0]?.tMs ?? 0;
    const times = samples.map((sample) => sample.tMs - timeBase);
    const timeMax = Math.max(...times, 1);

    svg.push(
      `<text x=\"${leftX.toFixed(2)}\" y=\"${labelY.toFixed(
        2
      )}\" font-size=\"13\" text-anchor=\"start\" font-family=\"monospace\">mode: ${
        entry.mode
      }</text>`
    );
    svg.push(
      `<rect x=\"${leftX}\" y=\"${y0}\" width=\"${plotWidth}\" height=\"${plotHeight}\" fill=\"#fafafa\" stroke=\"#dddddd\"/>`
    );
    svg.push(
      `<line x1=\"${leftX}\" y1=\"${y0 + plotHeight}\" x2=\"${leftX + plotWidth}\" y2=\"${
        y0 + plotHeight
      }\" stroke=\"#999\"/>`
    );
    svg.push(
      `<line x1=\"${leftX}\" y1=\"${y0}\" x2=\"${leftX}\" y2=\"${
        y0 + plotHeight
      }\" stroke=\"#999\"/>`
    );
    svg.push(
      `<text x=\"${(leftX + 4).toFixed(2)}\" y=\"${(y0 + 14).toFixed(
        2
      )}\" font-size=\"11\" text-anchor=\"start\" font-family=\"monospace\">angle (deg)</text>`
    );

    const angleTicks: Array<[number, number]> = [
      [-180, plotHeight - 11],
      [-90, plotHeight - 61.5],
      [0, plotHeight - 110],
      [90, plotHeight - 159.5],
      [180, plotHeight - 209],
    ];
    angleTicks.forEach(([deg, offset]) => {
      const y = y0 + offset;
      svg.push(
        `<line x1=\"${leftX}\" y1=\"${y.toFixed(
          2
        )}\" x2=\"${leftX + plotWidth}\" y2=\"${y.toFixed(
          2
        )}\" stroke=\"#eee\"/>`
      );
      svg.push(
        `<text x=\"${(leftX - 6).toFixed(2)}\" y=\"${(y + 4).toFixed(
          2
        )}\" font-size=\"10\" text-anchor=\"end\" font-family=\"monospace\">${deg}</text>`
      );
    });

    const anglePoints: Array<[number, number]> = samples.map((sample, i) => {
      const x = leftX + (times[i]! / timeMax) * plotWidth;
      return [x, angleToY(sample.angleDeg, y0)];
    });
    svg.push(
      `<path d=\"${buildPath(
        anglePoints
      )}\" fill=\"none\" stroke=\"#0074d9\" stroke-width=\"1.0\" />`
    );
    svg.push(
      `<text x=\"${(leftX + plotWidth - 4).toFixed(2)}\" y=\"${(
        y0 +
        plotHeight +
        14
      ).toFixed(
        2
      )}\" font-size=\"10\" text-anchor=\"end\" font-family=\"monospace\">t (ms, 0..${Math.floor(
        timeMax
      )})</text>`
    );

    svg.push(
      `<rect x=\"${rightX}\" y=\"${y0}\" width=\"${plotWidth}\" height=\"${plotHeight}\" fill=\"#fafafa\" stroke=\"#dddddd\"/>`
    );
    svg.push(
      `<line x1=\"${rightX}\" y1=\"${y0 + plotHeight}\" x2=\"${
        rightX + plotWidth
      }\" y2=\"${y0 + plotHeight}\" stroke=\"#999\"/>`
    );
    svg.push(
      `<line x1=\"${rightX}\" y1=\"${y0}\" x2=\"${rightX}\" y2=\"${
        y0 + plotHeight
      }\" stroke=\"#999\"/>`
    );
    svg.push(
      `<text x=\"${(rightX + 4).toFixed(2)}\" y=\"${(y0 + 14).toFixed(
        2
      )}\" font-size=\"11\" text-anchor=\"start\" font-family=\"monospace\">frame dt (ms)</text>`
    );
    const dtTicks: Array<[number, number]> = [
      [0, plotHeight],
      [28, plotHeight / 2],
      [55, 0],
    ];
    dtTicks.forEach(([value, offset]) => {
      const y = y0 + offset;
      svg.push(
        `<line x1=\"${rightX}\" y1=\"${y.toFixed(
          2
        )}\" x2=\"${rightX + plotWidth}\" y2=\"${y.toFixed(
          2
        )}\" stroke=\"#eee\"/>`
      );
      svg.push(
        `<text x=\"${(rightX - 6).toFixed(2)}\" y=\"${(y + 4).toFixed(
          2
        )}\" font-size=\"10\" text-anchor=\"end\" font-family=\"monospace\">${value}</text>`
      );
    });
    const dtPoints: Array<[number, number]> = samples.map((sample, i) => {
      const x = rightX + (times[i]! / timeMax) * plotWidth;
      return [x, dtToY(sample.dtMs, y0)];
    });
    svg.push(
      `<path d=\"${buildPath(
        dtPoints
      )}\" fill=\"none\" stroke=\"#ff4136\" stroke-width=\"1.0\" />`
    );
    svg.push(
      `<text x=\"${(rightX + plotWidth - 4).toFixed(2)}\" y=\"${(
        y0 +
        plotHeight +
        14
      ).toFixed(
        2
      )}\" font-size=\"10\" text-anchor=\"end\" font-family=\"monospace\">t (ms, 0..${Math.floor(
        timeMax
      )})</text>`
    );
  });

  svg.push('</svg>');
  return svg.join('\n');
};

export type RotationLogEntryPoint = {
  readonly frame: number;
  readonly tMs: number;
  readonly elementIndex: number;
  readonly entry: number;
  readonly edgeLeftDeg: number;
  readonly edgeLeftDeltaDeg: number;
  readonly edgeLeftDir: number;
  readonly edgeLeftFlip: number;
  readonly screenTargetDeg: number;
  readonly screenTargetDeltaDeg: number;
  readonly screenTargetDir: number;
  readonly screenTargetFlip: number;
};

type EntryDirectionSvgOptions = {
  readonly title?: string;
};

export const buildEntryDirectionSvg = (
  entries: readonly RotationLogEntryPoint[],
  options: EntryDirectionSvgOptions = {}
) => {
  const width = 1120;
  const plotWidth = 1000;
  const plotHeight = 200;
  const rowHeight = 232;
  const leftX = 70;
  const rowGroups = new Map<number, RotationLogEntryPoint[]>();
  entries.forEach((entry) => {
    const key = Number.isFinite(entry.elementIndex)
      ? Math.max(0, Math.floor(entry.elementIndex))
      : entry.entry;
    const list = rowGroups.get(key);
    if (list) {
      list.push(entry);
    } else {
      rowGroups.set(key, [entry]);
    }
  });
  const groupKeys = Array.from(rowGroups.keys()).sort((a, b) => a - b);
  const rowCount = Math.max(1, groupKeys.length);
  const height = 48 + (rowCount - 1) * rowHeight + plotHeight + 36;
  const svg: string[] = [];
  svg.push(
    `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${width}\" height=\"${height}\">`
  );
  svg.push('<rect width=\"100%\" height=\"100%\" fill=\"#ffffff\"/>');

  if (options.title) {
    svg.push(
      `<text x=\"${leftX}\" y=\"24\" font-size=\"13\" text-anchor=\"start\" font-family=\"monospace\">${options.title}</text>`
    );
  }

  const deltaToY = (value: number, y0: number) => {
    const clamped = Math.max(-180, Math.min(180, value));
    return y0 + plotHeight * (1 - (clamped + 180) / 360);
  };

  const buildPath = (points: Array<[number, number]>) => {
    if (points.length === 0) {
      return '';
    }
    return `M ${points
      .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
      .join(' L ')}`;
  };

  groupKeys.forEach((key, rowIndex) => {
    const y0 = 40 + rowIndex * rowHeight;
    const labelY = y0 - 10;
    const samples = rowGroups.get(key) ?? [];
    const sorted = samples.slice().sort((a, b) => a.frame - b.frame);
    const timeBase = sorted[0]?.tMs ?? 0;
    const times = sorted.map((entry) => entry.tMs - timeBase);
    const timeMax = Math.max(...times, 1);

    svg.push(
      `<text x=\"${leftX.toFixed(2)}\" y=\"${labelY.toFixed(
        2
      )}\" font-size=\"12\" text-anchor=\"start\" font-family=\"monospace\">element=${key}</text>`
    );
    svg.push(
      `<rect x=\"${leftX}\" y=\"${y0}\" width=\"${plotWidth}\" height=\"${plotHeight}\" fill=\"#fafafa\" stroke=\"#dddddd\"/>`
    );
    svg.push(
      `<line x1=\"${leftX}\" y1=\"${y0 + plotHeight}\" x2=\"${leftX + plotWidth}\" y2=\"${
        y0 + plotHeight
      }\" stroke=\"#999\"/>`
    );
    svg.push(
      `<line x1=\"${leftX}\" y1=\"${y0}\" x2=\"${leftX}\" y2=\"${
        y0 + plotHeight
      }\" stroke=\"#999\"/>`
    );
    svg.push(
      `<text x=\"${(leftX + 4).toFixed(2)}\" y=\"${(y0 + 14).toFixed(
        2
      )}\" font-size=\"11\" text-anchor=\"start\" font-family=\"monospace\">delta (deg)</text>`
    );

    const deltaTicks: Array<[number, number]> = [
      [-180, plotHeight - 8],
      [-90, plotHeight - 58],
      [0, plotHeight - 108],
      [90, plotHeight - 158],
      [180, plotHeight - 208],
    ];
    deltaTicks.forEach(([deg, offset]) => {
      const y = y0 + offset;
      svg.push(
        `<line x1=\"${leftX}\" y1=\"${y.toFixed(
          2
        )}\" x2=\"${leftX + plotWidth}\" y2=\"${y.toFixed(
          2
        )}\" stroke=\"#eee\"/>`
      );
      svg.push(
        `<text x=\"${(leftX - 6).toFixed(2)}\" y=\"${(y + 4).toFixed(
          2
        )}\" font-size=\"10\" text-anchor=\"end\" font-family=\"monospace\">${deg}</text>`
      );
    });

    const screenPoints: Array<[number, number]> = [];
    const edgePoints: Array<[number, number]> = [];
    sorted.forEach((entry, i) => {
      const x = leftX + (times[i]! / timeMax) * plotWidth;
      if (Number.isFinite(entry.screenTargetDeltaDeg)) {
        screenPoints.push([x, deltaToY(entry.screenTargetDeltaDeg, y0)]);
      }
      if (Number.isFinite(entry.edgeLeftDeltaDeg)) {
        edgePoints.push([x, deltaToY(entry.edgeLeftDeltaDeg, y0)]);
      }
    });

    svg.push(
      `<path d=\"${buildPath(
        screenPoints
      )}\" fill=\"none\" stroke=\"#0074d9\" stroke-width=\"1.0\" />`
    );
    svg.push(
      `<path d=\"${buildPath(
        edgePoints
      )}\" fill=\"none\" stroke=\"#2ecc40\" stroke-width=\"1.0\" />`
    );

    sorted.forEach((entry, i) => {
      const x = leftX + (times[i]! / timeMax) * plotWidth;
      if (entry.screenTargetFlip > 0) {
        svg.push(
          `<line x1=\"${x.toFixed(2)}\" y1=\"${y0}\" x2=\"${x.toFixed(
            2
          )}\" y2=\"${(y0 + plotHeight).toFixed(
            2
          )}\" stroke=\"#ff4136\" stroke-width=\"0.7\"/>`
        );
      }
      if (
        entry.edgeLeftDir !== 0 &&
        entry.screenTargetDir !== 0 &&
        entry.edgeLeftDir !== entry.screenTargetDir
      ) {
        svg.push(
          `<line x1=\"${x.toFixed(2)}\" y1=\"${y0}\" x2=\"${x.toFixed(
            2
          )}\" y2=\"${(y0 + plotHeight).toFixed(
            2
          )}\" stroke=\"#ff851b\" stroke-width=\"0.7\"/>`
        );
      }
    });

    const legendY = y0 + plotHeight + 14;
    svg.push(
      `<text x=\"${leftX.toFixed(2)}\" y=\"${legendY.toFixed(
        2
      )}\" font-size=\"10\" text-anchor=\"start\" font-family=\"monospace\">blue: screenTargetDelta, green: edgeLeftDelta, red: screenTargetFlip, orange: dirMismatch</text>`
    );
    svg.push(
      `<text x=\"${(leftX + plotWidth - 4).toFixed(2)}\" y=\"${(
        y0 +
        plotHeight +
        28
      ).toFixed(
        2
      )}\" font-size=\"10\" text-anchor=\"end\" font-family=\"monospace\">t (ms, 0..${Math.floor(
        timeMax
      )})</text>`
    );
  });

  svg.push('</svg>');
  return svg.join('\n');
};

export type RotationLogEntryBaselinePoint = {
  readonly frame: number;
  readonly tMs: number;
  readonly elementIndex: number;
  readonly entry: number;
  readonly baselineErrorDeg: number;
};

export type RotationLogEntryScreenLerpPoint = {
  readonly frame: number;
  readonly tMs: number;
  readonly elementIndex: number;
  readonly entry: number;
  readonly errorDeg: number;
  readonly expectedDeg: number;
  readonly actualDeg: number;
  readonly solveMode: number;
};

type EntryBaselineSvgOptions = {
  readonly title?: string;
};

export const buildEntryBaselineSvg = (
  entries: readonly RotationLogEntryBaselinePoint[],
  options: EntryBaselineSvgOptions = {}
) => {
  const width = 1120;
  const plotWidth = 1000;
  const plotHeight = 200;
  const rowHeight = 232;
  const leftX = 70;
  const rowGroups = new Map<number, RotationLogEntryBaselinePoint[]>();
  entries.forEach((entry) => {
    const key = Number.isFinite(entry.elementIndex)
      ? Math.max(0, Math.floor(entry.elementIndex))
      : entry.entry;
    const list = rowGroups.get(key);
    if (list) {
      list.push(entry);
    } else {
      rowGroups.set(key, [entry]);
    }
  });
  const groupKeys = Array.from(rowGroups.keys()).sort((a, b) => a - b);
  const rowCount = Math.max(1, groupKeys.length);
  const height = 48 + (rowCount - 1) * rowHeight + plotHeight + 36;
  const svg: string[] = [];
  svg.push(
    `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${width}\" height=\"${height}\">`
  );
  svg.push('<rect width=\"100%\" height=\"100%\" fill=\"#ffffff\"/>');

  if (options.title) {
    svg.push(
      `<text x=\"${leftX}\" y=\"24\" font-size=\"13\" text-anchor=\"start\" font-family=\"monospace\">${options.title}</text>`
    );
  }

  const deltaToY = (value: number, y0: number) => {
    const clamped = Math.max(-180, Math.min(180, value));
    return y0 + plotHeight * (1 - (clamped + 180) / 360);
  };

  const buildPath = (points: Array<[number, number]>) => {
    if (points.length === 0) {
      return '';
    }
    return `M ${points
      .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
      .join(' L ')}`;
  };

  groupKeys.forEach((key, rowIndex) => {
    const y0 = 40 + rowIndex * rowHeight;
    const labelY = y0 - 10;
    const samples = rowGroups.get(key) ?? [];
    const sorted = samples.slice().sort((a, b) => a.frame - b.frame);
    const timeBase = sorted[0]?.tMs ?? 0;
    const times = sorted.map((entry) => entry.tMs - timeBase);
    const timeMax = Math.max(...times, 1);

    svg.push(
      `<text x=\"${leftX.toFixed(2)}\" y=\"${labelY.toFixed(
        2
      )}\" font-size=\"12\" text-anchor=\"start\" font-family=\"monospace\">element=${key}</text>`
    );
    svg.push(
      `<rect x=\"${leftX}\" y=\"${y0}\" width=\"${plotWidth}\" height=\"${plotHeight}\" fill=\"#fafafa\" stroke=\"#dddddd\"/>`
    );
    svg.push(
      `<line x1=\"${leftX}\" y1=\"${y0 + plotHeight}\" x2=\"${leftX + plotWidth}\" y2=\"${
        y0 + plotHeight
      }\" stroke=\"#999\"/>`
    );
    svg.push(
      `<line x1=\"${leftX}\" y1=\"${y0}\" x2=\"${leftX}\" y2=\"${
        y0 + plotHeight
      }\" stroke=\"#999\"/>`
    );
    svg.push(
      `<text x=\"${(leftX + 4).toFixed(2)}\" y=\"${(y0 + 14).toFixed(
        2
      )}\" font-size=\"11\" text-anchor=\"start\" font-family=\"monospace\">baseline error (deg)</text>`
    );

    const deltaTicks: Array<[number, number]> = [
      [-180, plotHeight - 8],
      [-90, plotHeight - 58],
      [0, plotHeight - 108],
      [90, plotHeight - 158],
      [180, plotHeight - 208],
    ];
    deltaTicks.forEach(([deg, offset]) => {
      const y = y0 + offset;
      svg.push(
        `<line x1=\"${leftX}\" y1=\"${y.toFixed(
          2
        )}\" x2=\"${leftX + plotWidth}\" y2=\"${y.toFixed(
          2
        )}\" stroke=\"#eee\"/>`
      );
      svg.push(
        `<text x=\"${(leftX - 6).toFixed(2)}\" y=\"${(y + 4).toFixed(
          2
        )}\" font-size=\"10\" text-anchor=\"end\" font-family=\"monospace\">${deg}</text>`
      );
    });

    const baselinePoints: Array<[number, number]> = [];
    sorted.forEach((entry, i) => {
      const x = leftX + (times[i]! / timeMax) * plotWidth;
      if (Number.isFinite(entry.baselineErrorDeg)) {
        baselinePoints.push([x, deltaToY(entry.baselineErrorDeg, y0)]);
      }
    });

    svg.push(
      `<path d=\"${buildPath(
        baselinePoints
      )}\" fill=\"none\" stroke=\"#2ecc40\" stroke-width=\"1.0\" />`
    );

    svg.push(
      `<text x=\"${(leftX + plotWidth - 4).toFixed(2)}\" y=\"${(
        y0 +
        plotHeight +
        28
      ).toFixed(
        2
      )}\" font-size=\"10\" text-anchor=\"end\" font-family=\"monospace\">t (ms, 0..${Math.floor(
        timeMax
      )})</text>`
    );
  });

  svg.push('</svg>');
  return svg.join('\n');
};

type EntryScreenLerpSvgOptions = {
  readonly title?: string;
};

export const buildEntryScreenLerpSvg = (
  entries: readonly RotationLogEntryScreenLerpPoint[],
  options: EntryScreenLerpSvgOptions = {}
) => {
  const width = 1120;
  const plotWidth = 1000;
  const plotHeight = 200;
  const rowHeight = 232;
  const leftX = 70;
  const rowGroups = new Map<number, RotationLogEntryScreenLerpPoint[]>();
  entries.forEach((entry) => {
    const key = Number.isFinite(entry.elementIndex)
      ? Math.max(0, Math.floor(entry.elementIndex))
      : entry.entry;
    const list = rowGroups.get(key);
    if (list) {
      list.push(entry);
    } else {
      rowGroups.set(key, [entry]);
    }
  });
  const groupKeys = Array.from(rowGroups.keys()).sort((a, b) => a - b);
  const rowCount = Math.max(1, groupKeys.length);
  const height = 48 + (rowCount - 1) * rowHeight + plotHeight + 36;
  const svg: string[] = [];
  svg.push(
    `<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"${width}\" height=\"${height}\">`
  );
  svg.push('<rect width=\"100%\" height=\"100%\" fill=\"#ffffff\"/>');

  if (options.title) {
    svg.push(
      `<text x=\"${leftX}\" y=\"24\" font-size=\"13\" text-anchor=\"start\" font-family=\"monospace\">${options.title}</text>`
    );
  }

  const errorToY = (value: number, y0: number) => {
    const clamped = Math.max(-180, Math.min(180, value));
    return y0 + plotHeight * (1 - (clamped + 180) / 360);
  };

  const buildPath = (points: Array<[number, number]>) => {
    if (points.length === 0) {
      return '';
    }
    return `M ${points
      .map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`)
      .join(' L ')}`;
  };

  groupKeys.forEach((key, rowIndex) => {
    const y0 = 40 + rowIndex * rowHeight;
    const labelY = y0 - 10;
    const samples = rowGroups.get(key) ?? [];
    const sorted = samples.slice().sort((a, b) => a.frame - b.frame);
    const timeBase = sorted[0]?.tMs ?? 0;
    const times = sorted.map((entry) => entry.tMs - timeBase);
    const timeMax = Math.max(...times, 1);

    svg.push(
      `<text x=\"${leftX.toFixed(2)}\" y=\"${labelY.toFixed(
        2
      )}\" font-size=\"12\" text-anchor=\"start\" font-family=\"monospace\">element=${key}</text>`
    );
    svg.push(
      `<rect x=\"${leftX}\" y=\"${y0}\" width=\"${plotWidth}\" height=\"${plotHeight}\" fill=\"#fafafa\" stroke=\"#dddddd\"/>`
    );
    svg.push(
      `<line x1=\"${leftX}\" y1=\"${y0 + plotHeight}\" x2=\"${leftX + plotWidth}\" y2=\"${
        y0 + plotHeight
      }\" stroke=\"#999\"/>`
    );
    svg.push(
      `<line x1=\"${leftX}\" y1=\"${y0}\" x2=\"${leftX}\" y2=\"${
        y0 + plotHeight
      }\" stroke=\"#999\"/>`
    );
    svg.push(
      `<text x=\"${(leftX + 4).toFixed(2)}\" y=\"${(y0 + 14).toFixed(
        2
      )}\" font-size=\"11\" text-anchor=\"start\" font-family=\"monospace\">screen lerp error (deg)</text>`
    );

    const pathPoints: Array<[number, number]> = [];
    sorted.forEach((entry, index) => {
      const time = times[index]!;
      const x = leftX + (time / timeMax) * plotWidth;
      const y = errorToY(entry.errorDeg, y0);
      pathPoints.push([x, y]);
    });
    svg.push(
      `<path d=\"${buildPath(
        pathPoints
      )}\" fill=\"none\" stroke=\"#0074d9\" stroke-width=\"1.0\" />`
    );

    const legendY = y0 + plotHeight + 14;
    svg.push(
      `<text x=\"${leftX.toFixed(2)}\" y=\"${legendY.toFixed(
        2
      )}\" font-size=\"10\" text-anchor=\"start\" font-family=\"monospace\">blue: error (actual - expected)</text>`
    );
    svg.push(
      `<text x=\"${(leftX + plotWidth - 4).toFixed(2)}\" y=\"${(
        y0 +
        plotHeight +
        28
      ).toFixed(
        2
      )}\" font-size=\"10\" text-anchor=\"end\" font-family=\"monospace\">t (ms, 0..${Math.floor(
        timeMax
      )})</text>`
    );
  });

  svg.push('</svg>');
  return svg.join('\n');
};

export const runRotationLogScenario = async (
  scenario: RotationLogScenario,
  advanceTime: (deltaMs: number) => void
): Promise<RotationLogRunResult> => {
  const logFilePath = createRotationLogFile(
    scenario.logFileDate,
    scenario.logDir,
    scenario.logFileName
  );
  const logSink = (message: string) => {
    appendFileSync(logFilePath, `${message}\n`);
  };

  const globalWithRotationLog = globalThis as typeof globalThis & {
    outputRotationLog?: boolean;
    outputRotationLogVerbose?: boolean;
    outputRotationLogEntries?: boolean;
    rotationLogSink?: (message: string) => void;
  };
  const previousOutputRotationLog = globalWithRotationLog.outputRotationLog;
  const previousOutputRotationLogVerbose =
    globalWithRotationLog.outputRotationLogVerbose;
  const previousOutputRotationLogEntries =
    globalWithRotationLog.outputRotationLogEntries;
  const previousRotationLogSink = globalWithRotationLog.rotationLogSink;
  globalWithRotationLog.outputRotationLog = false;
  globalWithRotationLog.outputRotationLogVerbose = false;
  globalWithRotationLog.outputRotationLogEntries = false;

  const frameStepMs = scenario.frameStepMs ?? 1000 / 60;
  const updateIntervalMs = scenario.updateIntervalMs ?? 500;

  const wasmPath = resolve(
    import.meta.dirname,
    '..',
    '..',
    'src',
    'wasm',
    'compute.wasm'
  );
  const bytes = await readFile(wasmPath);
  const wasmInstance = await loadWasmModule(bytes);

  const { gl } = createFakeGL();
  const renderer = createObjectRenderer(
    scenario.viewSize,
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
    renderer.updateCamera(toCameraUpdate(scenario.camera));

    const atlasSize = scenario.atlasSize ?? resolveAtlasSize(scenario.images);
    const atlasId = renderer.allocateAtlas({
      widthPixel: atlasSize.widthPixel,
      heightPixel: atlasSize.heightPixel,
    });

    for (const image of scenario.images) {
      await renderer.registerImage(
        atlasId,
        image.imageId,
        createFakeBitmap(image.width, image.height)
      );
    }

    const gridSize = clampGridSize(scenario.gridSize);
    const { cellWidth, cellHeight } = getGridCellSize(scenario.images);
    const layout = computeGridLayout(
      gridSize,
      scenario.viewSize.widthPixel,
      scenario.viewSize.heightPixel,
      cellWidth,
      cellHeight
    );

    const rotationInterpolation = buildInterpolation(
      scenario.rotation.mode,
      scenario.rotation.feedforward
    );
    const moveInterpolation = buildInterpolation(
      scenario.move.mode,
      scenario.move.feedforward
    );

    type SpriteState = {
      id: number;
      baseY: number;
      stepY: number;
      rotateDeg: number;
      rotateDir: number;
      columnIndex: number;
    };

    const sprites: SpriteState[] = [];
    for (let yIndex = 0; yIndex < gridSize; yIndex += 1) {
      for (let xIndex = 0; xIndex < gridSize; xIndex += 1) {
        const image =
          scenario.images[(xIndex + yIndex) % scenario.images.length];
        if (!image) {
          continue;
        }
        const pos = getGridPosition(layout, xIndex, yIndex);
        const addPromise = renderer.addSprite(
          {
            sx: { value: pos.x },
            sy: { value: pos.y },
            elements: [
              {
                imageId: image.imageId,
                mode: scenario.rotation.renderMode,
                rotation: {
                  value: 0,
                  ...(rotationInterpolation
                    ? { interpolation: rotationInterpolation }
                    : {}),
                },
                ...(scenario.rotation.autoRotation
                  ? {
                      autoDirection: {
                        space: 'world',
                        mode: { type: 'rotation' as const },
                        minDistance: scenario.rotation.autoRotationDistance,
                      },
                    }
                  : {}),
              },
            ],
          },
          true
        );
        if (!addPromise) {
          continue;
        }
        renderer.render();
        const id = await addPromise;
        sprites.push({
          id,
          baseY: pos.y,
          stepY: image.height * 0.25,
          rotateDeg: 0,
          rotateDir: (xIndex + yIndex) % 2 === 0 ? 1 : -1,
          columnIndex: xIndex,
        });
      }
    }

    globalWithRotationLog.outputRotationLog = true;
    globalWithRotationLog.outputRotationLogVerbose =
      scenario.outputVerbose === true;
    globalWithRotationLog.outputRotationLogEntries =
      scenario.outputEntries === true;
    globalWithRotationLog.rotationLogSink = logSink;

    let bounceIndex = 0;
    let nextUpdateMs = updateIntervalMs;
    let elapsedMs = 0;
    for (let frame = 0; frame < scenario.frames; frame += 1) {
      while (elapsedMs + 1e-6 >= nextUpdateMs) {
        const shouldMove = scenario.move.speedScale > 0;
        const phase = shouldMove
          ? (MOVE_PHASES[bounceIndex % MOVE_PHASES.length] ?? MOVE_PHASES[0])
          : 0;
        const shouldRotate = scenario.rotation.mode !== 'none';
        const rotateStep = ROTATE_STEP_DEG * scenario.rotation.speedScale;

        sprites.forEach((sprite) => {
          const direction = sprite.columnIndex % 2 === 0 ? 1 : -1;
          const offset =
            direction * sprite.stepY * phase * scenario.move.speedScale;
          const nextRotate = shouldRotate
            ? normalizeRotateDeg(
                sprite.rotateDeg + sprite.rotateDir * rotateStep
              )
            : sprite.rotateDeg;
          sprite.rotateDeg = nextRotate;

          renderer.updateSprite(sprite.id, {
            sy: {
              value: sprite.baseY + offset,
              interpolation: moveInterpolation ?? null,
            },
            elements: [
              {
                rotation: {
                  value: nextRotate,
                  interpolation: rotationInterpolation ?? null,
                },
                ...(scenario.rotation.autoRotation
                  ? {
                      autoDirection: {
                        mode: { type: 'rotation' as const },
                        minDistance: scenario.rotation.autoRotationDistance,
                      },
                    }
                  : { autoDirection: null }),
              },
            ],
          });
        });

        if (shouldMove) {
          bounceIndex += 1;
        }
        nextUpdateMs += updateIntervalMs;
      }

      renderer.render();
      advanceTime(frameStepMs);
      elapsedMs += frameStepMs;
    }

    return {
      logFilePath,
      totalSprites: sprites.length,
      totalFrames: scenario.frames,
    };
  } finally {
    if (previousOutputRotationLog === undefined) {
      delete globalWithRotationLog.outputRotationLog;
    } else {
      globalWithRotationLog.outputRotationLog = previousOutputRotationLog;
    }
    if (previousOutputRotationLogVerbose === undefined) {
      delete globalWithRotationLog.outputRotationLogVerbose;
    } else {
      globalWithRotationLog.outputRotationLogVerbose =
        previousOutputRotationLogVerbose;
    }
    if (previousOutputRotationLogEntries === undefined) {
      delete globalWithRotationLog.outputRotationLogEntries;
    } else {
      globalWithRotationLog.outputRotationLogEntries =
        previousOutputRotationLogEntries;
    }
    if (previousRotationLogSink === undefined) {
      delete globalWithRotationLog.rotationLogSink;
    } else {
      globalWithRotationLog.rotationLogSink = previousRotationLogSink;
    }
    renderer.release();
  }
};
