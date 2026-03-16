// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { appendFileSync, readFileSync, statSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SpriteElementRenderMode } from '../src/types';
import {
  analyzeRotationLogSamples,
  buildAngleDtSvg,
  buildEntryBaselineSvg,
  buildEntryDirectionSvg,
  parseRotationLogFile,
  runRotationLogScenario,
  type RotationLogEntryBaselinePoint,
  type RotationLogEntryPoint,
  type RotationLogScenario,
} from './helpers/rotation-log-runner';
import {
  getTestResultsBaseDir,
  getTestResultsDir,
} from './helpers/test-log-paths';

const timeState = vi.hoisted(() => ({ nowMs: 0 }));

vi.mock('../src/utils', async () => {
  const actual =
    await vi.importActual<typeof import('../src/utils')>('../src/utils');
  return {
    ...actual,
    getNowMs: () => timeState.nowMs,
  };
});

const installFakeOffscreenCanvas = () => {
  const FakeOffscreenCanvas = class {
    readonly width: number;
    readonly height: number;
    constructor(width: number, height: number) {
      this.width = width;
      this.height = height;
    }
    getContext(type: string) {
      if (type !== '2d') {
        return null;
      }
      return {
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
        clearRect: () => {},
        save: () => {},
        translate: () => {},
        scale: () => {},
        drawImage: () => {},
        restore: () => {},
      } as unknown as OffscreenCanvasRenderingContext2D;
    }
  };
  vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
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

const appendAnalysisLog = (outputDir: string, line: string) => {
  appendFileSync(resolve(outputDir, 'analysis.log'), `${line}\n`);
};

type RotationLogDetail = {
  readonly frame: number;
  readonly tMs: number;
  readonly dtMs: number;
  readonly angleDeg: number;
  readonly rotateDeg: number;
  readonly finalRotateDeg: number;
  readonly rotationFromDeg: number;
  readonly rotationToDeg: number;
  readonly rotationT: number;
  readonly rotationTEased: number;
  readonly finalFromDeg: number;
  readonly finalToDeg: number;
  readonly finalT: number;
  readonly finalTEased: number;
};

type RotationLogEntrySample = {
  readonly frame: number;
  readonly tMs: number;
  readonly entry: number;
  readonly elementIndex: number;
  readonly solveMode: number;
  readonly entryRotDeg: number;
  readonly entryFinalRotDeg: number;
  readonly entryRotFromDeg: number;
  readonly entryRotToDeg: number;
  readonly entryRotDurMs: number;
  readonly entryFinalFromDeg: number;
  readonly entryFinalToDeg: number;
  readonly entryFinalDurMs: number;
  readonly screenTargetDeg: number;
  readonly screenFromDeg: number;
  readonly screenToDeg: number;
  readonly screenDeltaRawDeg: number;
  readonly screenDeltaDeg: number;
  readonly edgeLeftDeltaDeg: number;
  readonly edgeLeftDir: number;
  readonly edgeLeftFlip: number;
  readonly screenTargetDeltaDeg: number;
  readonly screenTargetDir: number;
  readonly screenTargetFlip: number;
  readonly pivotX: number;
  readonly pivotY: number;
  readonly pivotZ: number;
  readonly pivotNdcX: number;
  readonly pivotNdcY: number;
  readonly pivotClipW: number;
  readonly edgeLeftDeg: number;
  readonly edgeBottomDeg: number;
  readonly pageId: number;
  readonly opacity: number;
};

const parseRotationLogDetails = (content: string): RotationLogDetail[] => {
  const entries: RotationLogDetail[] = [];
  const lines = content.split(/\r?\n/);
  const parseNumber = (value: string | undefined) => {
    if (!value) {
      return Number.NaN;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };
  for (const line of lines) {
    if (!line.includes('[rotation-log]')) {
      continue;
    }
    const fields: Record<string, string> = {};
    for (const match of line.matchAll(/(\w+)=([^\s]+)/g)) {
      const key = match[1];
      const value = match[2];
      if (!key || !value) {
        continue;
      }
      fields[key] = value;
    }
    const frame = parseNumber(fields.frame);
    const tMs = parseNumber(fields.t);
    if (!Number.isFinite(tMs)) {
      continue;
    }
    const dtMs = parseNumber(fields.dt);
    const angleDeg = parseNumber(fields.angleDeg);
    const rotateDeg = parseNumber(fields.rotateDeg);
    const finalRotateDeg = parseNumber(fields.finalRotateDeg);
    const rotationFromDeg = parseNumber(fields.rotFrom);
    const rotationToDeg = parseNumber(fields.rotTo);
    const rotationT = parseNumber(fields.rotT);
    const rotationTEased = parseNumber(fields.rotTEased);
    const finalFromDeg = parseNumber(fields.finalFrom);
    const finalToDeg = parseNumber(fields.finalTo);
    const finalT = parseNumber(fields.finalT);
    const finalTEased = parseNumber(fields.finalTEased);
    entries.push({
      frame: Number.isFinite(frame) ? Math.floor(frame) : 0,
      tMs,
      dtMs: Number.isFinite(dtMs) ? dtMs : 0,
      angleDeg: Number.isFinite(angleDeg) ? angleDeg : 0,
      rotateDeg,
      finalRotateDeg,
      rotationFromDeg,
      rotationToDeg,
      rotationT,
      rotationTEased,
      finalFromDeg,
      finalToDeg,
      finalT,
      finalTEased,
    });
  }
  return entries;
};

const parseRotationLogEntrySamples = (
  content: string
): RotationLogEntrySample[] => {
  const entries: RotationLogEntrySample[] = [];
  const lines = content.split(/\r?\n/);
  const parseNumber = (value: string | undefined) => {
    if (!value) {
      return Number.NaN;
    }
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : Number.NaN;
  };
  for (const line of lines) {
    if (!line.includes('[rotation-log-entry]')) {
      continue;
    }
    const fields: Record<string, string> = {};
    for (const match of line.matchAll(/(\w+)=([^\s]+)/g)) {
      const key = match[1];
      const value = match[2];
      if (!key || !value) {
        continue;
      }
      fields[key] = value;
    }
    const frame = parseNumber(fields.frame);
    const tMs = parseNumber(fields.t);
    const entry = parseNumber(fields.entry);
    if (!Number.isFinite(frame) || !Number.isFinite(tMs)) {
      continue;
    }
    entries.push({
      frame,
      tMs,
      entry: Number.isFinite(entry) ? entry : 0,
      elementIndex: parseNumber(fields.elementIndex),
      solveMode: parseNumber(fields.solveMode),
      entryRotDeg: parseNumber(fields.entryRotDeg),
      entryFinalRotDeg: parseNumber(fields.entryFinalRotDeg),
      entryRotFromDeg: parseNumber(fields.entryRotFrom),
      entryRotToDeg: parseNumber(fields.entryRotTo),
      entryRotDurMs: parseNumber(fields.entryRotDur),
      entryFinalFromDeg: parseNumber(fields.entryFinalFrom),
      entryFinalToDeg: parseNumber(fields.entryFinalTo),
      entryFinalDurMs: parseNumber(fields.entryFinalDur),
      screenTargetDeg: parseNumber(fields.screenTargetDeg),
      screenFromDeg: parseNumber(fields.screenFromDeg),
      screenToDeg: parseNumber(fields.screenToDeg),
      screenDeltaRawDeg: parseNumber(fields.screenDeltaRawDeg),
      screenDeltaDeg: parseNumber(fields.screenDeltaDeg),
      edgeLeftDeltaDeg: parseNumber(fields.edgeLeftDeltaDeg),
      edgeLeftDir: parseNumber(fields.edgeLeftDir),
      edgeLeftFlip: parseNumber(fields.edgeLeftFlip),
      screenTargetDeltaDeg: parseNumber(fields.screenTargetDeltaDeg),
      screenTargetDir: parseNumber(fields.screenTargetDir),
      screenTargetFlip: parseNumber(fields.screenTargetFlip),
      pivotX: parseNumber(fields.pivotX),
      pivotY: parseNumber(fields.pivotY),
      pivotZ: parseNumber(fields.pivotZ),
      pivotNdcX: parseNumber(fields.pivotNdcX),
      pivotNdcY: parseNumber(fields.pivotNdcY),
      pivotClipW: parseNumber(fields.pivotClipW),
      edgeLeftDeg: parseNumber(fields.edgeLeftDeg),
      edgeBottomDeg: parseNumber(fields.edgeBottomDeg),
      pageId: parseNumber(fields.pageId),
      opacity: parseNumber(fields.opacity),
    });
  }
  return entries;
};

const wrapAngleDelta = (delta: number) => {
  let value = delta;
  while (value > 180) {
    value -= 360;
  }
  while (value < -180) {
    value += 360;
  }
  return value;
};

const unwrapAngleSeries = (
  samples: RotationLogEntrySample[],
  selector: (sample: RotationLogEntrySample) => number
) => {
  let prevRaw = Number.NaN;
  let prevUnwrapped = 0;
  return samples.map((sample) => {
    const raw = selector(sample);
    if (!Number.isFinite(raw)) {
      return { sample, angleUnwrapped: Number.NaN };
    }
    if (!Number.isFinite(prevRaw)) {
      prevRaw = raw;
      prevUnwrapped = raw;
    } else {
      prevUnwrapped += wrapAngleDelta(raw - prevRaw);
      prevRaw = raw;
    }
    return { sample, angleUnwrapped: prevUnwrapped };
  });
};

const normalizeUndirectedDelta = (delta: number) => {
  const wrapped = wrapAngleDelta(delta);
  if (Math.abs(wrapped) > 90) {
    return wrapAngleDelta(wrapped + 180);
  }
  return wrapped;
};

const LINEAR_MAX_RESIDUAL_DEG = 0.01;
const LINEAR_RMS_RESIDUAL_DEG = 0.005;
const ENTRY_JITTER_THRESHOLD_DEG = 10;
const ENTRY_JITTER_MAX_COUNT = 0;
const ENTRY_BASELINE_MAX_ERROR_DEG = 1;
const CLOCKWISE_DIRECTION_SIGN = -1;
const ROTATION_DIRECTION_EPS = 1.0e-6;

type DirectionFlipStats = {
  edgeFlipCount: number;
  screenFlipCount: number;
  mismatchCount: number;
  sampleCount: number;
};

const analyzeEntryJitter = (
  entries: RotationLogEntrySample[],
  jitterThreshold = ENTRY_JITTER_THRESHOLD_DEG
) => {
  const byFrame = new Map<number, RotationLogEntrySample[]>();
  entries.forEach((entry) => {
    const list = byFrame.get(entry.frame);
    if (list) {
      list.push(entry);
    } else {
      byFrame.set(entry.frame, [entry]);
    }
  });
  const frames = Array.from(byFrame.keys()).sort((a, b) => a - b);
  const trackStats = new Map<
    string,
    {
      pivotX: number;
      maxJump: number;
      jitterCount: number;
      sampleCount: number;
    }
  >();
  const previousByTrack = new Map<string, RotationLogEntrySample>();
  const quantize = (value: number, step: number) => {
    if (!Number.isFinite(value)) {
      return Number.NaN;
    }
    return Math.round(value / step) * step;
  };

  for (const frame of frames) {
    const frameEntries = byFrame.get(frame) ?? [];
    const byColumn = new Map<string, RotationLogEntrySample[]>();
    for (const entry of frameEntries) {
      const xKeyValue = quantize(entry.pivotX, 0.1);
      const xKey = Number.isFinite(xKeyValue) ? xKeyValue.toFixed(1) : 'NaN';
      const list = byColumn.get(xKey);
      if (list) {
        list.push(entry);
      } else {
        byColumn.set(xKey, [entry]);
      }
    }
    for (const [xKey, columnEntries] of byColumn.entries()) {
      columnEntries.sort((a, b) => b.pivotY - a.pivotY);
      columnEntries.forEach((entry, rowIndex) => {
        const trackKey = `${xKey}|${rowIndex}`;
        const prev = previousByTrack.get(trackKey);
        const stats = trackStats.get(trackKey) ?? {
          pivotX: entry.pivotX,
          maxJump: 0,
          jitterCount: 0,
          sampleCount: 0,
        };
        if (prev) {
          const delta = wrapAngleDelta(entry.edgeLeftDeg - prev.edgeLeftDeg);
          if (Number.isFinite(delta)) {
            const absDelta = Math.abs(delta);
            stats.maxJump = Math.max(stats.maxJump, absDelta);
            if (absDelta > jitterThreshold) {
              stats.jitterCount += 1;
            }
          }
        }
        stats.sampleCount += 1;
        trackStats.set(trackKey, stats);
        previousByTrack.set(trackKey, entry);
      });
    }
  }

  const tracks = Array.from(trackStats.entries()).sort(
    (a, b) => b[1].maxJump - a[1].maxJump
  );
  const topTracks = tracks.slice(0, 5);
  return {
    trackCount: trackStats.size,
    topTracks,
  };
};

const analyzeEntryDirectionFlips = (entries: RotationLogEntrySample[]) => {
  const statsByElement = new Map<
    number,
    {
      edgeFlipCount: number;
      screenFlipCount: number;
      mismatchCount: number;
      sampleCount: number;
    }
  >();
  const coerceKey = (entry: RotationLogEntrySample) => {
    if (Number.isFinite(entry.elementIndex)) {
      return Math.max(0, Math.floor(entry.elementIndex));
    }
    return entry.entry;
  };
  const toDir = (value: number) => (Number.isFinite(value) ? value : 0);

  for (const entry of entries) {
    const key = coerceKey(entry);
    const stats = statsByElement.get(key) ?? {
      edgeFlipCount: 0,
      screenFlipCount: 0,
      mismatchCount: 0,
      sampleCount: 0,
    };
    const edgeFlip = toDir(entry.edgeLeftFlip);
    const screenFlip = toDir(entry.screenTargetFlip);
    const edgeDir = toDir(entry.edgeLeftDir);
    const screenDir = toDir(entry.screenTargetDir);
    stats.edgeFlipCount += edgeFlip > 0 ? 1 : 0;
    stats.screenFlipCount += screenFlip > 0 ? 1 : 0;
    if (edgeDir !== 0 && screenDir !== 0 && edgeDir !== screenDir) {
      stats.mismatchCount += 1;
    }
    stats.sampleCount += 1;
    statsByElement.set(key, stats);
  }

  const ranked = Array.from(statsByElement.entries()).sort((a, b) => {
    const aScore = a[1].edgeFlipCount + a[1].screenFlipCount;
    const bScore = b[1].edgeFlipCount + b[1].screenFlipCount;
    return bScore - aScore;
  });
  return {
    elementCount: statsByElement.size,
    ranked,
  };
};

const analyzeScreenTargetJumps = (entries: RotationLogEntrySample[]) => {
  const resolveDir = (value: number) => {
    if (!Number.isFinite(value)) {
      return 0;
    }
    const eps = 1e-3;
    if (Math.abs(value) < eps) {
      return 0;
    }
    return value > 0 ? 1 : -1;
  };
  const jumpThreshold = 180;
  const statsByElement = new Map<
    number,
    {
      flipCount: number;
      largeDeltaCount: number;
      mismatchCount: number;
      sampleCount: number;
    }
  >();
  const jumpSamples: Array<
    RotationLogEntrySample & {
      rawDir: number;
      targetDir: number;
      reason: string;
    }
  > = [];

  const coerceKey = (entry: RotationLogEntrySample) => {
    if (Number.isFinite(entry.elementIndex)) {
      return Math.max(0, Math.floor(entry.elementIndex));
    }
    return entry.entry;
  };

  entries.forEach((entry) => {
    const key = coerceKey(entry);
    const stats = statsByElement.get(key) ?? {
      flipCount: 0,
      largeDeltaCount: 0,
      mismatchCount: 0,
      sampleCount: 0,
    };
    const targetDelta = entry.screenTargetDeltaDeg;
    const rawDelta = entry.screenDeltaRawDeg;
    const targetDir = resolveDir(targetDelta);
    const rawDir = resolveDir(rawDelta);
    const flip = entry.screenTargetFlip > 0;
    const largeDelta =
      Number.isFinite(targetDelta) && Math.abs(targetDelta) >= jumpThreshold;
    const mismatch = rawDir !== 0 && targetDir !== 0 && rawDir !== targetDir;
    if (flip) {
      stats.flipCount += 1;
    }
    if (largeDelta) {
      stats.largeDeltaCount += 1;
    }
    if (mismatch) {
      stats.mismatchCount += 1;
    }
    stats.sampleCount += 1;
    statsByElement.set(key, stats);

    if (flip || largeDelta || mismatch) {
      const reasonParts: string[] = [];
      if (flip) {
        reasonParts.push('flip');
      }
      if (largeDelta) {
        reasonParts.push('largeDelta');
      }
      if (mismatch) {
        reasonParts.push('rawDirMismatch');
      }
      jumpSamples.push({
        ...entry,
        rawDir,
        targetDir,
        reason: reasonParts.join('+'),
      });
    }
  });

  const ranked = Array.from(statsByElement.entries()).sort((a, b) => {
    const aScore = a[1].flipCount + a[1].largeDeltaCount + a[1].mismatchCount;
    const bScore = b[1].flipCount + b[1].largeDeltaCount + b[1].mismatchCount;
    return bScore - aScore;
  });
  const sortedSamples = jumpSamples.sort((a, b) => a.frame - b.frame);
  return {
    jumpThreshold,
    elementCount: statsByElement.size,
    ranked,
    samples: sortedSamples,
  };
};

const formatFlipStats = (label: string, stats?: DirectionFlipStats) => {
  if (!stats) {
    return `${label}:n/a`;
  }
  return `${label}:edgeFlip=${stats.edgeFlipCount} screenFlip=${stats.screenFlipCount} mismatch=${stats.mismatchCount} samples=${stats.sampleCount}`;
};

const assertLinearResiduals = (
  label: string,
  analysis: ReturnType<typeof analyzeRotationLogSamples>
) => {
  expect(analysis.changeSampleCount, `${label} change samples`).toBeGreaterThan(
    2
  );
  expect(
    analysis.angleMaxResidualDeg,
    `${label} angle max residual`
  ).toBeLessThanOrEqual(LINEAR_MAX_RESIDUAL_DEG);
  expect(
    analysis.angleRmsResidualDeg,
    `${label} angle rms residual`
  ).toBeLessThanOrEqual(LINEAR_RMS_RESIDUAL_DEG);
  expect(
    analysis.finalMaxResidualDeg,
    `${label} final max residual`
  ).toBeLessThanOrEqual(LINEAR_MAX_RESIDUAL_DEG);
  expect(
    analysis.finalRmsResidualDeg,
    `${label} final rms residual`
  ).toBeLessThanOrEqual(LINEAR_RMS_RESIDUAL_DEG);
};

const assertEntryJitterWithin = (
  label: string,
  analysis: ReturnType<typeof analyzeEntryJitter>,
  {
    maxJumpDeg = ENTRY_JITTER_THRESHOLD_DEG,
    maxJitterCount = ENTRY_JITTER_MAX_COUNT,
  }: { maxJumpDeg?: number; maxJitterCount?: number } = {}
) => {
  const topMaxJump = analysis.topTracks.reduce((current, [, stats]) => {
    if (!Number.isFinite(stats.maxJump)) {
      return current;
    }
    return Math.max(current, stats.maxJump);
  }, 0);
  expect(topMaxJump, `${label} max jump`).toBeLessThanOrEqual(maxJumpDeg);
  analysis.topTracks.forEach(([trackKey, stats]) => {
    expect(
      stats.jitterCount,
      `${label} ${trackKey} jitter count`
    ).toBeLessThanOrEqual(maxJitterCount);
  });
};

const assertDirectionConsistency = (
  label: string,
  stats?: DirectionFlipStats
) => {
  expect(stats, `${label} stats`).toBeDefined();
  if (!stats) {
    return;
  }
  expect(stats.edgeFlipCount, `${label} edge flip`).toBe(0);
  expect(stats.screenFlipCount, `${label} screen flip`).toBe(0);
  expect(stats.mismatchCount, `${label} mismatch`).toBe(0);
};

const analyzeRotationDirection = (samples: Array<{ angleDeg: number }>) => {
  let sum = 0;
  let count = 0;
  let pos = 0;
  let neg = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const prev = samples[index - 1];
    const current = samples[index];
    if (!prev || !current) {
      continue;
    }
    const delta = wrapAngleDelta(current.angleDeg - prev.angleDeg);
    if (!Number.isFinite(delta)) {
      continue;
    }
    if (Math.abs(delta) <= ROTATION_DIRECTION_EPS) {
      continue;
    }
    sum += delta;
    count += 1;
    if (delta > 0) {
      pos += 1;
    } else {
      neg += 1;
    }
  }
  const avg = count > 0 ? sum / count : 0;
  const sign = Math.abs(avg) <= ROTATION_DIRECTION_EPS ? 0 : avg > 0 ? 1 : -1;
  return {
    sum,
    count,
    pos,
    neg,
    avg,
    sign,
  };
};

const assertClockwiseRotation = (
  label: string,
  samples: Array<{ angleDeg: number }>
) => {
  const analysis = analyzeRotationDirection(samples);
  expect(analysis.count, `${label} direction sample count`).toBeGreaterThan(0);
  expect(analysis.sign, `${label} direction sign`).toBe(
    CLOCKWISE_DIRECTION_SIGN
  );
};

const assertNonZeroRotationDirection = (
  label: string,
  samples: Array<{ angleDeg: number }>
) => {
  const analysis = analyzeRotationDirection(samples);
  expect(analysis.count, `${label} direction sample count`).toBeGreaterThan(0);
  expect(analysis.sign, `${label} direction sign`).not.toBe(0);
};

const buildEntryBaselinePoints = (
  entries: RotationLogEntrySample[]
): RotationLogEntryBaselinePoint[] => {
  const byElement = new Map<number, RotationLogEntrySample[]>();
  entries.forEach((entry) => {
    const key = Number.isFinite(entry.elementIndex)
      ? Math.max(0, Math.floor(entry.elementIndex))
      : Math.floor(entry.entry);
    const list = byElement.get(key);
    if (list) {
      list.push(entry);
    } else {
      byElement.set(key, [entry]);
    }
  });
  const points: RotationLogEntryBaselinePoint[] = [];
  byElement.forEach((list) => {
    const sorted = list.slice().sort((a, b) => a.frame - b.frame);
    const edgeSeries = unwrapAngleSeries(
      sorted,
      (sample) => sample.edgeLeftDeg
    );
    const screenSeries = unwrapAngleSeries(
      sorted,
      (sample) => sample.screenTargetDeg
    );
    let baseline: number | undefined;
    edgeSeries.forEach(({ sample, angleUnwrapped }, index) => {
      const screenUnwrapped = screenSeries[index]?.angleUnwrapped ?? Number.NaN;
      if (
        !Number.isFinite(angleUnwrapped) ||
        !Number.isFinite(screenUnwrapped)
      ) {
        return;
      }
      if (baseline === undefined) {
        baseline = wrapAngleDelta(angleUnwrapped - screenUnwrapped);
      }
      const error = normalizeUndirectedDelta(
        angleUnwrapped - screenUnwrapped - baseline
      );
      points.push({
        frame: sample.frame,
        tMs: sample.tMs,
        elementIndex: sample.elementIndex,
        entry: sample.entry,
        baselineErrorDeg: error,
      });
    });
  });
  return points;
};

const analyzeEntryBaselineStability = (entries: RotationLogEntrySample[]) => {
  const byElement = new Map<number, RotationLogEntrySample[]>();
  entries.forEach((entry) => {
    const key = Number.isFinite(entry.elementIndex)
      ? Math.max(0, Math.floor(entry.elementIndex))
      : Math.floor(entry.entry);
    const list = byElement.get(key);
    if (list) {
      list.push(entry);
    } else {
      byElement.set(key, [entry]);
    }
  });
  let maxResidual = 0;
  let sampleCount = 0;
  let changeCount = 0;
  byElement.forEach((list) => {
    const sorted = list.slice().sort((a, b) => a.frame - b.frame);
    const edgeSeries = unwrapAngleSeries(
      sorted,
      (sample) => sample.edgeLeftDeg
    );
    const screenSeries = unwrapAngleSeries(
      sorted,
      (sample) => sample.screenTargetDeg
    );
    let baseline: number | undefined;
    let prevRot = Number.NaN;
    edgeSeries.forEach(({ sample, angleUnwrapped }, index) => {
      const screenUnwrapped = screenSeries[index]?.angleUnwrapped ?? Number.NaN;
      if (
        !Number.isFinite(angleUnwrapped) ||
        !Number.isFinite(screenUnwrapped)
      ) {
        return;
      }
      if (baseline === undefined) {
        baseline = wrapAngleDelta(angleUnwrapped - screenUnwrapped);
      }
      const error = normalizeUndirectedDelta(
        angleUnwrapped - screenUnwrapped - baseline
      );
      const absError = Math.abs(error);
      if (absError > maxResidual) {
        maxResidual = absError;
      }
      sampleCount += 1;
      if (Number.isFinite(prevRot)) {
        const delta = wrapAngleDelta(sample.entryFinalRotDeg - prevRot);
        if (Math.abs(delta) > ROTATION_DIRECTION_EPS) {
          changeCount += 1;
        }
      }
      prevRot = sample.entryFinalRotDeg;
    });
  });
  return {
    maxResidual,
    sampleCount,
    changeCount,
    elementCount: byElement.size,
  };
};

describe('rotation log runner', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('writes rotation logs to test_results directory', async () => {
    installFakeOffscreenCanvas();
    timeState.nowMs = 0;

    const viewSize = { widthPixel: 800, heightPixel: 600 };
    const initialFov = 45;
    const initialDistance =
      viewSize.heightPixel / 2 / Math.tan((initialFov * Math.PI) / 360);

    const imageRoot = resolve(
      import.meta.dirname,
      '..',
      '..',
      'demo1',
      'images'
    );
    const curvePng = resolve(imageRoot, 'crystalball-1500.png');
    const walkerPng = resolve(imageRoot, 'globe-1500.png');
    const curveSize = readPngSize(curvePng);
    const walkerSize = readPngSize(walkerPng);

    const makeScenario = (
      renderMode: SpriteElementRenderMode,
      outputDir: string
    ): RotationLogScenario => ({
      name: `rotation-log-${renderMode}`,
      gridSize: 1,
      viewSize,
      camera: {
        position: { x: 0, y: 0, z: initialDistance },
        rotation: { yaw: 0, pitch: 0, roll: 0 },
        fovY: initialFov,
        far: 10000,
      },
      images: [
        { imageId: 'curve', width: curveSize.width, height: curveSize.height },
        {
          imageId: 'walker',
          width: walkerSize.width,
          height: walkerSize.height,
        },
      ],
      logDir: outputDir,
      logFileName: `rotation_${renderMode}.log`,
      move: {
        mode: 'linear',
        feedforward: false,
        speedScale: 1,
      },
      rotation: {
        mode: 'linear',
        feedforward: false,
        speedScale: 0,
        autoRotation: true,
        autoRotationDistance: 0,
        renderMode,
      },
      frames: 120,
      frameStepMs: 1000 / 60,
      updateIntervalMs: 500,
    });

    const outputDir = getTestResultsDir('rotation-log', 'basic');
    const baseDir = getTestResultsBaseDir();
    expect(outputDir).toBe(resolve(baseDir, 'rotation-log', 'basic'));
    const modes: SpriteElementRenderMode[] = [
      'surface',
      'billboard_perspective',
      'billboard',
    ];
    const results: Array<{
      mode: SpriteElementRenderMode;
      logFilePath: string;
      samples: ReturnType<typeof parseRotationLogFile>;
      analysis: ReturnType<typeof analyzeRotationLogSamples>;
    }> = [];

    for (const mode of modes) {
      timeState.nowMs = 0;
      const scenario = makeScenario(mode, outputDir);
      const result = await runRotationLogScenario(scenario, (deltaMs) => {
        timeState.nowMs += deltaMs;
      });
      expect(result.logFilePath.startsWith(outputDir)).toBe(true);
      const stats = statSync(result.logFilePath);
      expect(stats.size).toBeGreaterThan(0);
      const content = readFileSync(result.logFilePath, 'utf-8');
      expect(content).toContain('[rotation-log]');
      const samples = parseRotationLogFile(result.logFilePath);
      const analysis = analyzeRotationLogSamples(samples);
      results.push({
        mode,
        logFilePath: result.logFilePath,
        samples,
        analysis,
      });
      appendAnalysisLog(
        outputDir,
        `[rotation-log-analysis] mode=${mode} samples=${analysis.sampleCount} changeSamples=${analysis.changeSampleCount} angleMaxResidualDeg=${analysis.angleMaxResidualDeg.toFixed(
          3
        )} finalMaxResidualDeg=${analysis.finalMaxResidualDeg.toFixed(3)}`
      );
    }

    const linearModes = new Set<SpriteElementRenderMode>([
      'surface',
      'billboard_perspective',
      'billboard',
    ]);
    results.forEach((result) => {
      if (!linearModes.has(result.mode)) {
        return;
      }
      assertLinearResiduals(`mode=${result.mode}`, result.analysis);
    });

    const svgContent = buildAngleDtSvg(
      results.map((result) => ({
        mode: result.mode,
        samples: result.samples,
      }))
    );
    const svgPath = resolve(outputDir, 'rotation.svg');
    writeFileSync(svgPath, svgContent);
    expect(svgContent).toContain('<svg');
  });

  it('skips entry logs when outputEntries is false', async () => {
    installFakeOffscreenCanvas();
    timeState.nowMs = 0;

    const imageRoot = resolve(
      import.meta.dirname,
      '..',
      '..',
      'demo1',
      'images'
    );
    const curvePng = resolve(imageRoot, 'crystalball-1500.png');
    const curveSize = readPngSize(curvePng);

    const viewSize = {
      widthPixel: curveSize.width,
      heightPixel: curveSize.height,
    };
    const initialFov = 45;
    const initialDistance =
      viewSize.heightPixel / 2 / Math.tan((initialFov * Math.PI) / 360);

    const outputDir = getTestResultsDir('rotation-log', 'entries-disabled');

    const scenario: RotationLogScenario = {
      name: 'rotation-log-entries-disabled',
      gridSize: 1,
      viewSize,
      camera: {
        position: { x: 0, y: 0, z: initialDistance },
        rotation: { yaw: 0, pitch: 0, roll: 0 },
        fovY: initialFov,
        far: 10000,
      },
      images: [
        {
          imageId: 'curve',
          width: curveSize.width,
          height: curveSize.height,
        },
      ],
      logDir: outputDir,
      logFileName: 'rotation_entries_disabled.log',
      move: {
        mode: 'linear',
        feedforward: false,
        speedScale: 0,
      },
      rotation: {
        mode: 'linear',
        feedforward: false,
        speedScale: 0,
        autoRotation: false,
        autoRotationDistance: 0,
        renderMode: 'surface',
      },
      frames: 20,
      frameStepMs: 1000 / 60,
      updateIntervalMs: 500,
      outputEntries: false,
    };

    const result = await runRotationLogScenario(scenario, (deltaMs) => {
      timeState.nowMs += deltaMs;
    });

    const stats = statSync(result.logFilePath);
    expect(stats.size).toBeGreaterThan(0);
    const content = readFileSync(result.logFilePath, 'utf-8');
    expect(content).toContain('[rotation-log]');
    expect(content).not.toContain('[rotation-log-entry]');
  });

  it('preserves rotation easing for autoRotation when rotation value is unchanged', async () => {
    installFakeOffscreenCanvas();
    timeState.nowMs = 0;

    const imageRoot = resolve(
      import.meta.dirname,
      '..',
      '..',
      'demo1',
      'images'
    );
    const curvePng = resolve(imageRoot, 'crystalball-1500.png');
    const curveSize = readPngSize(curvePng);

    const viewSize = {
      widthPixel: curveSize.width,
      heightPixel: curveSize.height,
    };
    const initialFov = 45;
    const initialDistance =
      viewSize.heightPixel / 2 / Math.tan((initialFov * Math.PI) / 360);

    const outputDir = getTestResultsDir('rotation-log', 'auto-rotation-easing');

    const scenario: RotationLogScenario = {
      name: 'rotation-log-auto-rotation-easing',
      gridSize: 1,
      viewSize,
      camera: {
        position: { x: 0, y: 0, z: initialDistance },
        rotation: { yaw: 0, pitch: 0, roll: 0 },
        fovY: initialFov,
        far: 10000,
      },
      images: [
        { imageId: 'curve', width: curveSize.width, height: curveSize.height },
      ],
      logDir: outputDir,
      logFileName: 'rotation_auto_easing.log',
      move: {
        mode: 'linear',
        feedforward: false,
        speedScale: 1,
      },
      rotation: {
        mode: 'sigmoid',
        feedforward: false,
        speedScale: 0,
        autoRotation: true,
        autoRotationDistance: 0,
        renderMode: 'surface',
      },
      frames: 180,
      frameStepMs: 1000 / 60,
      updateIntervalMs: 500,
    };

    const result = await runRotationLogScenario(scenario, (deltaMs) => {
      timeState.nowMs += deltaMs;
    });

    const content = readFileSync(result.logFilePath, 'utf-8');
    const details = parseRotationLogDetails(content);
    const interpolating = details.filter(
      (entry) => entry.finalT > 0 && entry.finalT < 1
    );
    expect(interpolating.length).toBeGreaterThan(0);
    const maxDelta = interpolating.reduce((maxValue, entry) => {
      if (!Number.isFinite(entry.finalTEased)) {
        return maxValue;
      }
      return Math.max(maxValue, Math.abs(entry.finalTEased - entry.finalT));
    }, 0);
    expect(maxDelta).toBeGreaterThan(0.02);
  });

  it('reproduces billboard_perspective auto-rotation jitter during interpolation (screenshot setup)', async () => {
    installFakeOffscreenCanvas();
    timeState.nowMs = 0;

    const imageRoot = resolve(
      import.meta.dirname,
      '..',
      '..',
      'demo1',
      'images'
    );
    const curvePng = resolve(imageRoot, 'crystalball-1500.png');
    const walkerPng = resolve(imageRoot, 'globe-1500.png');
    const curveSize = readPngSize(curvePng);
    const walkerSize = readPngSize(walkerPng);
    const cellWidth = Math.max(curveSize.width, walkerSize.width);
    const cellHeight = Math.max(curveSize.height, walkerSize.height);
    const viewSize = { widthPixel: cellWidth, heightPixel: cellHeight };

    const outputDir = getTestResultsDir('rotation-log', 'screenshot');

    const scenario: RotationLogScenario = {
      name: 'rotation-log-screenshot-billboard-perspective',
      gridSize: 1,
      viewSize,
      camera: {
        position: { x: 0, y: -3547.5, z: 1000 },
        rotation: { yaw: 17, pitch: 72, roll: 5 },
        fovY: 45,
        far: 20000,
      },
      images: [
        { imageId: 'curve', width: curveSize.width, height: curveSize.height },
        {
          imageId: 'walker',
          width: walkerSize.width,
          height: walkerSize.height,
        },
      ],
      logDir: outputDir,
      logFileName: 'rotation_billboard_perspective_screenshot.log',
      move: {
        mode: 'linear',
        feedforward: false,
        speedScale: 1,
      },
      rotation: {
        mode: 'linear',
        feedforward: false,
        speedScale: 0,
        autoRotation: true,
        autoRotationDistance: 32.5,
        renderMode: 'billboard_perspective',
      },
      frames: 240,
      frameStepMs: 1000 / 60,
      updateIntervalMs: 500,
    };

    const result = await runRotationLogScenario(scenario, (deltaMs) => {
      timeState.nowMs += deltaMs;
    });

    const stats = statSync(result.logFilePath);
    expect(stats.size).toBeGreaterThan(0);
    const content = readFileSync(result.logFilePath, 'utf-8');
    expect(content).toContain('[rotation-log]');
    const details = parseRotationLogDetails(content);
    expect(details.length).toBeGreaterThan(0);
    const interpolating = details.filter(
      (entry) => entry.finalT > 0 && entry.finalT < 1
    );
    expect(interpolating.length).toBeGreaterThan(0);

    const interpolationSamples = interpolating.map((entry) => ({
      tMs: entry.tMs,
      dtMs: entry.dtMs,
      angleDeg: entry.angleDeg,
      rotateDeg: entry.rotateDeg,
      finalRotateDeg: entry.finalRotateDeg,
    }));
    const analysis = analyzeRotationLogSamples(interpolationSamples);
    appendAnalysisLog(
      outputDir,
      `[rotation-log-screenshot] samples=${details.length} interpolating=${interpolating.length} finalMaxResidualDeg=${analysis.finalMaxResidualDeg.toFixed(
        3
      )} angleMaxResidualDeg=${analysis.angleMaxResidualDeg.toFixed(3)}`
    );
    const startJumpThreshold = 10;
    for (let i = 1; i < details.length; i += 1) {
      const current = details[i];
      const prev = details[i - 1];
      if (!current || !prev) {
        continue;
      }
      if (!(current.finalT === 0)) {
        continue;
      }
      if (
        !Number.isFinite(current.angleDeg) ||
        !Number.isFinite(prev.angleDeg)
      ) {
        continue;
      }
      const delta = wrapAngleDelta(current.angleDeg - prev.angleDeg);
      expect(Math.abs(delta)).toBeLessThan(startJumpThreshold);
    }

    const samples = parseRotationLogFile(result.logFilePath);
    const svgContent = buildAngleDtSvg([
      {
        mode: 'billboard_perspective',
        samples,
      },
    ]);
    const svgPath = resolve(
      outputDir,
      'rotation_billboard_perspective_screenshot.svg'
    );
    writeFileSync(svgPath, svgContent);
    expect(svgContent).toContain('<svg');
  });

  it('logs billboard_perspective rotation vs movement direction mismatch (screenshot setup)', async () => {
    installFakeOffscreenCanvas();
    timeState.nowMs = 0;

    const imageRoot = resolve(
      import.meta.dirname,
      '..',
      '..',
      'demo1',
      'images'
    );
    const cautionPng = resolve(imageRoot, 'fullmoon-500.png');
    const cautionSize = readPngSize(cautionPng);
    const viewSize = {
      widthPixel: cautionSize.width,
      heightPixel: cautionSize.height,
    };

    const outputDir = getTestResultsDir(
      'rotation-log',
      'billboard-perspective-movement'
    );

    const scenario: RotationLogScenario = {
      name: 'rotation-log-billboard-perspective-movement',
      gridSize: 1,
      viewSize,
      camera: {
        position: { x: 156.5, y: -925.5, z: 860.0 },
        rotation: { yaw: 0, pitch: 49, roll: -10 },
        fovY: 66,
        far: 20000,
      },
      images: [
        {
          imageId: 'caution',
          width: cautionSize.width,
          height: cautionSize.height,
        },
      ],
      logDir: outputDir,
      logFileName: 'rotation_billboard_perspective_movement.log',
      move: {
        mode: 'linear',
        feedforward: false,
        speedScale: 1,
      },
      rotation: {
        mode: 'sigmoid',
        feedforward: false,
        speedScale: 0,
        autoRotation: true,
        autoRotationDistance: 0,
        renderMode: 'billboard_perspective',
      },
      frames: 240,
      frameStepMs: 1000 / 60,
      updateIntervalMs: 500,
      outputVerbose: true,
    };

    const result = await runRotationLogScenario(scenario, (deltaMs) => {
      timeState.nowMs += deltaMs;
    });

    const stats = statSync(result.logFilePath);
    expect(stats.size).toBeGreaterThan(0);
    const content = readFileSync(result.logFilePath, 'utf-8');
    expect(content).toContain('[rotation-log]');
    expect(content).toContain('[rotation-log-verbose]');

    const samples = parseRotationLogFile(result.logFilePath);
    const svgContent = buildAngleDtSvg([
      {
        mode: 'billboard_perspective',
        samples,
      },
    ]);
    const svgPath = resolve(
      outputDir,
      'rotation_billboard_perspective_movement.svg'
    );
    writeFileSync(svgPath, svgContent);
    expect(svgContent).toContain('<svg');
  });

  it('logs billboard_perspective entry orientation jitter for investigation', async () => {
    installFakeOffscreenCanvas();
    timeState.nowMs = 0;

    const imageRoot = resolve(
      import.meta.dirname,
      '..',
      '..',
      'demo1',
      'images'
    );
    const cautionPng = resolve(imageRoot, 'fullmoon-500.png');
    const cautionSize = readPngSize(cautionPng);
    const gridSize = 3;
    const viewSize = {
      widthPixel: cautionSize.width * gridSize,
      heightPixel: cautionSize.height * gridSize,
    };

    const outputDir = getTestResultsDir(
      'rotation-log',
      'billboard-perspective-entry-jitter'
    );

    const scenario: RotationLogScenario = {
      name: 'rotation-log-billboard-perspective-entry-jitter',
      gridSize,
      viewSize,
      camera: {
        position: { x: 156.5, y: -925.5, z: 860.0 },
        rotation: { yaw: 0, pitch: 49, roll: -10 },
        fovY: 66,
        far: 20000,
      },
      images: [
        {
          imageId: 'caution',
          width: cautionSize.width,
          height: cautionSize.height,
        },
      ],
      logDir: outputDir,
      logFileName: 'rotation_billboard_perspective_entry_jitter.log',
      move: {
        mode: 'linear',
        feedforward: false,
        speedScale: 1,
      },
      rotation: {
        mode: 'sigmoid',
        feedforward: false,
        speedScale: 0,
        autoRotation: true,
        autoRotationDistance: 0,
        renderMode: 'billboard_perspective',
      },
      frames: 240,
      frameStepMs: 1000 / 60,
      updateIntervalMs: 500,
      outputEntries: true,
    };

    const result = await runRotationLogScenario(scenario, (deltaMs) => {
      timeState.nowMs += deltaMs;
    });

    const stats = statSync(result.logFilePath);
    expect(stats.size).toBeGreaterThan(0);
    const content = readFileSync(result.logFilePath, 'utf-8');
    expect(content).toContain('[rotation-log-entry]');

    const entrySamples = parseRotationLogEntrySamples(content);
    expect(entrySamples.length).toBeGreaterThan(0);
    const analysis = analyzeEntryJitter(entrySamples);
    appendAnalysisLog(
      outputDir,
      `[rotation-log-entry-analysis] tracks=${analysis.trackCount} top=${analysis.topTracks
        .map(
          ([trackKey, trackStats]) =>
            `${trackKey}:maxJump=${trackStats.maxJump.toFixed(3)} jitter=${trackStats.jitterCount} samples=${trackStats.sampleCount}`
        )
        .join(',')}`
    );
  });

  it('logs billboard_perspective entry jitter for sprite count 4 (camera case)', async () => {
    installFakeOffscreenCanvas();
    timeState.nowMs = 0;

    const viewSize = { widthPixel: 800, heightPixel: 600 };

    const imageRoot = resolve(
      import.meta.dirname,
      '..',
      '..',
      'demo1',
      'images'
    );
    const cautionPng = resolve(imageRoot, 'fullmoon-500.png');
    const walkerPng = resolve(imageRoot, 'globe-1500.png');
    const cautionSize = readPngSize(cautionPng);
    const walkerSize = readPngSize(walkerPng);

    const outputDir = getTestResultsDir(
      'rotation-log',
      'billboard-perspective-entry-jitter-grid4'
    );

    const runCount = 3;
    const framesPerRun = 600;
    const combinedSamples: RotationLogEntrySample[] = [];

    for (let runIndex = 0; runIndex < runCount; runIndex += 1) {
      timeState.nowMs = 0;
      const scenario: RotationLogScenario = {
        name: `rotation-log-billboard-perspective-entry-jitter-grid4-${runIndex + 1}`,
        gridSize: 2,
        viewSize,
        camera: {
          position: { x: 0, y: -1542.5, z: 487.0 },
          rotation: { yaw: 0, pitch: 64, roll: 0 },
          fovY: 45,
          far: 20000,
        },
        images: [
          {
            imageId: 'caution',
            width: cautionSize.width,
            height: cautionSize.height,
          },
          {
            imageId: 'walker',
            width: walkerSize.width,
            height: walkerSize.height,
          },
        ],
        logDir: outputDir,
        logFileName: `rotation_billboard_perspective_entry_jitter_grid4_run${runIndex + 1}.log`,
        move: {
          mode: 'linear',
          feedforward: false,
          speedScale: 1,
        },
        rotation: {
          mode: 'linear',
          feedforward: false,
          speedScale: 0,
          autoRotation: true,
          autoRotationDistance: 0,
          renderMode: 'billboard_perspective',
        },
        frames: framesPerRun,
        frameStepMs: 1000 / 60,
        updateIntervalMs: 500,
        outputEntries: true,
      };

      const result = await runRotationLogScenario(scenario, (deltaMs) => {
        timeState.nowMs += deltaMs;
      });

      const stats = statSync(result.logFilePath);
      expect(stats.size).toBeGreaterThan(0);
      const content = readFileSync(result.logFilePath, 'utf-8');
      expect(content).toContain('[rotation-log-entry]');

      const entrySamples = parseRotationLogEntrySamples(content);
      expect(entrySamples.length).toBeGreaterThan(0);
      const entryPoints: RotationLogEntryPoint[] = entrySamples.map(
        (entry) => ({
          frame: entry.frame,
          tMs: entry.tMs,
          elementIndex: entry.elementIndex,
          entry: entry.entry,
          edgeLeftDeg: entry.edgeLeftDeg,
          edgeLeftDeltaDeg: entry.edgeLeftDeltaDeg,
          edgeLeftDir: entry.edgeLeftDir,
          edgeLeftFlip: entry.edgeLeftFlip,
          screenTargetDeg: entry.screenTargetDeg,
          screenTargetDeltaDeg: entry.screenTargetDeltaDeg,
          screenTargetDir: entry.screenTargetDir,
          screenTargetFlip: entry.screenTargetFlip,
        })
      );
      const entrySvgContent = buildEntryDirectionSvg(entryPoints, {
        title: `grid4 run ${runIndex + 1}`,
      });
      const entrySvgPath = resolve(
        outputDir,
        `rotation_billboard_perspective_entry_jitter_grid4_run${runIndex + 1}_direction.svg`
      );
      writeFileSync(entrySvgPath, entrySvgContent);
      expect(entrySvgContent).toContain('<svg');
      combinedSamples.push(...entrySamples);
      const jitterAnalysis = analyzeEntryJitter(entrySamples);
      const flipAnalysis = analyzeEntryDirectionFlips(entrySamples);
      const jumpAnalysis = analyzeScreenTargetJumps(entrySamples);
      assertEntryJitterWithin(`grid4 run ${runIndex + 1}`, jitterAnalysis);
      appendAnalysisLog(
        outputDir,
        `[rotation-log-entry-grid4-run] run=${runIndex + 1} frames=${framesPerRun} tracks=${jitterAnalysis.trackCount} top=${jitterAnalysis.topTracks
          .map(
            ([trackKey, trackStats]) =>
              `${trackKey}:maxJump=${trackStats.maxJump.toFixed(3)} jitter=${trackStats.jitterCount} samples=${trackStats.sampleCount}`
          )
          .join(',')} flips=${flipAnalysis.ranked
          .slice(0, 4)
          .map(
            ([elementKey, stats]) =>
              `${elementKey}:edgeFlip=${stats.edgeFlipCount} screenFlip=${stats.screenFlipCount} mismatch=${stats.mismatchCount} samples=${stats.sampleCount}`
          )
          .join(',')}`
      );
      appendAnalysisLog(
        outputDir,
        `[rotation-log-entry-grid4-jumps] run=${runIndex + 1} threshold=${jumpAnalysis.jumpThreshold} elements=${jumpAnalysis.elementCount} top=${jumpAnalysis.ranked
          .slice(0, 4)
          .map(
            ([elementKey, stats]) =>
              `${elementKey}:flip=${stats.flipCount} largeDelta=${stats.largeDeltaCount} mismatch=${stats.mismatchCount} samples=${stats.sampleCount}`
          )
          .join(',')}`
      );
      jumpAnalysis.samples.slice(0, 12).forEach((sample) => {
        appendAnalysisLog(
          outputDir,
          `[rotation-log-entry-jump-sample] run=${runIndex + 1} element=${Number.isFinite(sample.elementIndex) ? Math.floor(sample.elementIndex) : sample.entry} frame=${sample.frame} t=${sample.tMs.toFixed(
            2
          )} reason=${sample.reason} screenTargetDeg=${sample.screenTargetDeg.toFixed(
            3
          )} screenTargetDeltaDeg=${sample.screenTargetDeltaDeg.toFixed(
            3
          )} screenFromDeg=${sample.screenFromDeg.toFixed(
            3
          )} screenToDeg=${sample.screenToDeg.toFixed(
            3
          )} screenDeltaRawDeg=${sample.screenDeltaRawDeg.toFixed(
            3
          )} screenDeltaDeg=${sample.screenDeltaDeg.toFixed(
            3
          )} rawDir=${sample.rawDir} targetDir=${sample.targetDir} edgeLeftDeg=${sample.edgeLeftDeg.toFixed(
            3
          )} edgeLeftDeltaDeg=${sample.edgeLeftDeltaDeg.toFixed(3)}`
        );
      });
    }

    const combinedFlipAnalysis = analyzeEntryDirectionFlips(combinedSamples);
    const combinedJumpAnalysis = analyzeScreenTargetJumps(combinedSamples);
    const combinedJitterAnalysis = analyzeEntryJitter(combinedSamples);
    const combinedEntryPoints: RotationLogEntryPoint[] = combinedSamples.map(
      (entry) => ({
        frame: entry.frame,
        tMs: entry.tMs,
        elementIndex: entry.elementIndex,
        entry: entry.entry,
        edgeLeftDeg: entry.edgeLeftDeg,
        edgeLeftDeltaDeg: entry.edgeLeftDeltaDeg,
        edgeLeftDir: entry.edgeLeftDir,
        edgeLeftFlip: entry.edgeLeftFlip,
        screenTargetDeg: entry.screenTargetDeg,
        screenTargetDeltaDeg: entry.screenTargetDeltaDeg,
        screenTargetDir: entry.screenTargetDir,
        screenTargetFlip: entry.screenTargetFlip,
      })
    );
    const combinedEntrySvgContent = buildEntryDirectionSvg(
      combinedEntryPoints,
      {
        title: 'grid4 combined',
      }
    );
    const combinedEntrySvgPath = resolve(
      outputDir,
      'rotation_billboard_perspective_entry_jitter_grid4_combined_direction.svg'
    );
    writeFileSync(combinedEntrySvgPath, combinedEntrySvgContent);
    expect(combinedEntrySvgContent).toContain('<svg');
    assertEntryJitterWithin('grid4 combined', combinedJitterAnalysis);
    appendAnalysisLog(
      outputDir,
      `[rotation-log-entry-grid4-combined] elements=${combinedFlipAnalysis.elementCount} top=${combinedFlipAnalysis.ranked
        .slice(0, 6)
        .map(
          ([elementKey, stats]) =>
            `${elementKey}:edgeFlip=${stats.edgeFlipCount} screenFlip=${stats.screenFlipCount} mismatch=${stats.mismatchCount} samples=${stats.sampleCount}`
        )
        .join(',')}`
    );
    appendAnalysisLog(
      outputDir,
      `[rotation-log-entry-grid4-combined-jumps] threshold=${combinedJumpAnalysis.jumpThreshold} elements=${combinedJumpAnalysis.elementCount} top=${combinedJumpAnalysis.ranked
        .slice(0, 6)
        .map(
          ([elementKey, stats]) =>
            `${elementKey}:flip=${stats.flipCount} largeDelta=${stats.largeDeltaCount} mismatch=${stats.mismatchCount} samples=${stats.sampleCount}`
        )
        .join(',')}`
    );
    combinedJumpAnalysis.samples.slice(0, 12).forEach((sample) => {
      appendAnalysisLog(
        outputDir,
        `[rotation-log-entry-combined-jump-sample] element=${Number.isFinite(sample.elementIndex) ? Math.floor(sample.elementIndex) : sample.entry} frame=${sample.frame} t=${sample.tMs.toFixed(
          2
        )} reason=${sample.reason} screenTargetDeg=${sample.screenTargetDeg.toFixed(
          3
        )} screenTargetDeltaDeg=${sample.screenTargetDeltaDeg.toFixed(
          3
        )} screenFromDeg=${sample.screenFromDeg.toFixed(
          3
        )} screenToDeg=${sample.screenToDeg.toFixed(
          3
        )} screenDeltaRawDeg=${sample.screenDeltaRawDeg.toFixed(
          3
        )} screenDeltaDeg=${sample.screenDeltaDeg.toFixed(
          3
        )} rawDir=${sample.rawDir} targetDir=${sample.targetDir} edgeLeftDeg=${sample.edgeLeftDeg.toFixed(
          3
        )} edgeLeftDeltaDeg=${sample.edgeLeftDeltaDeg.toFixed(3)}`
      );
    });
  });

  it('logs billboard_perspective entry jitter for bounce/back easing (sprite count 4)', async () => {
    installFakeOffscreenCanvas();
    timeState.nowMs = 0;

    const viewSize = { widthPixel: 800, heightPixel: 600 };

    const imageRoot = resolve(
      import.meta.dirname,
      '..',
      '..',
      'demo1',
      'images'
    );
    const cautionPng = resolve(imageRoot, 'fullmoon-500.png');
    const walkerPng = resolve(imageRoot, 'globe-1500.png');
    const cautionSize = readPngSize(cautionPng);
    const walkerSize = readPngSize(walkerPng);

    const outputDir = getTestResultsDir(
      'rotation-log',
      'billboard-perspective-entry-jitter-grid4-bounce-back'
    );

    const easingModes = ['bounce', 'back'] as const;
    for (const easingMode of easingModes) {
      timeState.nowMs = 0;
      const scenario: RotationLogScenario = {
        name: `rotation-log-billboard-perspective-entry-jitter-grid4-${easingMode}`,
        gridSize: 2,
        viewSize,
        camera: {
          position: { x: 0, y: -1542.5, z: 487.0 },
          rotation: { yaw: 0, pitch: 64, roll: 0 },
          fovY: 45,
          far: 20000,
        },
        images: [
          {
            imageId: 'caution',
            width: cautionSize.width,
            height: cautionSize.height,
          },
          {
            imageId: 'walker',
            width: walkerSize.width,
            height: walkerSize.height,
          },
        ],
        logDir: outputDir,
        logFileName: `rotation_billboard_perspective_entry_jitter_grid4_${easingMode}.log`,
        move: {
          mode: 'linear',
          feedforward: false,
          speedScale: 1,
        },
        rotation: {
          mode: easingMode,
          feedforward: false,
          speedScale: 0,
          autoRotation: true,
          autoRotationDistance: 0,
          renderMode: 'billboard_perspective',
        },
        frames: 600,
        frameStepMs: 1000 / 60,
        updateIntervalMs: 500,
        outputEntries: true,
      };

      const result = await runRotationLogScenario(scenario, (deltaMs) => {
        timeState.nowMs += deltaMs;
      });

      const stats = statSync(result.logFilePath);
      expect(stats.size).toBeGreaterThan(0);
      const content = readFileSync(result.logFilePath, 'utf-8');
      expect(content).toContain('[rotation-log]');
      expect(content).toContain('[rotation-log-entry]');

      const entrySamples = parseRotationLogEntrySamples(content);
      expect(entrySamples.length).toBeGreaterThan(0);
      const entryPoints: RotationLogEntryPoint[] = entrySamples.map(
        (entry) => ({
          frame: entry.frame,
          tMs: entry.tMs,
          elementIndex: entry.elementIndex,
          entry: entry.entry,
          edgeLeftDeg: entry.edgeLeftDeg,
          edgeLeftDeltaDeg: entry.edgeLeftDeltaDeg,
          edgeLeftDir: entry.edgeLeftDir,
          edgeLeftFlip: entry.edgeLeftFlip,
          screenTargetDeg: entry.screenTargetDeg,
          screenTargetDeltaDeg: entry.screenTargetDeltaDeg,
          screenTargetDir: entry.screenTargetDir,
          screenTargetFlip: entry.screenTargetFlip,
        })
      );
      const entrySvgContent = buildEntryDirectionSvg(entryPoints, {
        title: `grid4 ${easingMode}`,
      });
      const entrySvgPath = resolve(
        outputDir,
        `rotation_billboard_perspective_entry_jitter_grid4_${easingMode}_direction.svg`
      );
      writeFileSync(entrySvgPath, entrySvgContent);
      expect(entrySvgContent).toContain('<svg');

      const jumpAnalysis = analyzeScreenTargetJumps(entrySamples);
      appendAnalysisLog(
        outputDir,
        `[rotation-log-entry-grid4-${easingMode}-jumps] threshold=${jumpAnalysis.jumpThreshold} elements=${jumpAnalysis.elementCount} top=${jumpAnalysis.ranked
          .slice(0, 4)
          .map(
            ([elementKey, stats]) =>
              `${elementKey}:flip=${stats.flipCount} largeDelta=${stats.largeDeltaCount} mismatch=${stats.mismatchCount} samples=${stats.sampleCount}`
          )
          .join(',')}`
      );

      const samples = parseRotationLogFile(result.logFilePath);
      const svgContent = buildAngleDtSvg([
        {
          mode: `billboard_perspective-${easingMode}`,
          samples,
        },
      ]);
      const svgPath = resolve(
        outputDir,
        `rotation_billboard_perspective_entry_jitter_grid4_${easingMode}_angle.svg`
      );
      writeFileSync(svgPath, svgContent);
      expect(svgContent).toContain('<svg');
    }
  });

  it('compares auto-rotation direction between render modes (0/180 toggle)', async () => {
    installFakeOffscreenCanvas();
    timeState.nowMs = 0;

    const viewSize = { widthPixel: 800, heightPixel: 600 };
    const initialFov = 45;
    const initialDistance =
      viewSize.heightPixel / 2 / Math.tan((initialFov * Math.PI) / 360);

    const imageRoot = resolve(
      import.meta.dirname,
      '..',
      '..',
      'demo1',
      'images'
    );
    const cautionPng = resolve(imageRoot, 'fullmoon-500.png');
    const cautionSize = readPngSize(cautionPng);

    const outputDir = getTestResultsDir(
      'rotation-log',
      'auto-rotation-direction-compare'
    );

    const modes: SpriteElementRenderMode[] = ['surface', 'billboard'];

    for (const mode of modes) {
      timeState.nowMs = 0;
      const scenario: RotationLogScenario = {
        name: `rotation-log-auto-direction-${mode}`,
        gridSize: 1,
        viewSize,
        camera: {
          position: { x: 0, y: 0, z: initialDistance },
          rotation: { yaw: 0, pitch: 0, roll: 0 },
          fovY: initialFov,
          far: 10000,
        },
        images: [
          {
            imageId: 'caution',
            width: cautionSize.width,
            height: cautionSize.height,
          },
        ],
        logDir: outputDir,
        logFileName: `rotation_auto_direction_${mode}.log`,
        move: {
          mode: 'linear',
          feedforward: false,
          speedScale: 1,
        },
        rotation: {
          mode: 'linear',
          feedforward: false,
          speedScale: 0,
          autoRotation: true,
          autoRotationDistance: 0,
          renderMode: mode,
        },
        frames: 480,
        frameStepMs: 1000 / 60,
        updateIntervalMs: 500,
        outputEntries: true,
      };

      const result = await runRotationLogScenario(scenario, (deltaMs) => {
        timeState.nowMs += deltaMs;
      });

      const stats = statSync(result.logFilePath);
      expect(stats.size).toBeGreaterThan(0);
      const content = readFileSync(result.logFilePath, 'utf-8');
      expect(content).toContain('[rotation-log]');
      expect(content).toContain('[rotation-log-entry]');

      const entrySamples = parseRotationLogEntrySamples(content);
      expect(entrySamples.length).toBeGreaterThan(0);
      const flipAnalysis = analyzeEntryDirectionFlips(entrySamples);
      const element0Stats = flipAnalysis.ranked.find(
        ([elementKey]) => elementKey === 0
      )?.[1];
      appendAnalysisLog(
        outputDir,
        `[rotation-log-auto-direction] mode=${mode} ${formatFlipStats(
          'element0',
          element0Stats
        )}`
      );
      assertDirectionConsistency(`mode=${mode} element0`, element0Stats);

      const entryPoints: RotationLogEntryPoint[] = entrySamples.map(
        (entry) => ({
          frame: entry.frame,
          tMs: entry.tMs,
          elementIndex: entry.elementIndex,
          entry: entry.entry,
          edgeLeftDeg: entry.edgeLeftDeg,
          edgeLeftDeltaDeg: entry.edgeLeftDeltaDeg,
          edgeLeftDir: entry.edgeLeftDir,
          edgeLeftFlip: entry.edgeLeftFlip,
          screenTargetDeg: entry.screenTargetDeg,
          screenTargetDeltaDeg: entry.screenTargetDeltaDeg,
          screenTargetDir: entry.screenTargetDir,
          screenTargetFlip: entry.screenTargetFlip,
        })
      );
      const entrySvgContent = buildEntryDirectionSvg(entryPoints, {
        title: `auto-direction ${mode}`,
      });
      const entrySvgPath = resolve(
        outputDir,
        `rotation_auto_direction_${mode}_direction.svg`
      );
      writeFileSync(entrySvgPath, entrySvgContent);
      expect(entrySvgContent).toContain('<svg');

      const samples = parseRotationLogFile(result.logFilePath);
      assertClockwiseRotation(`mode=${mode}`, samples);
      const svgContent = buildAngleDtSvg([
        {
          mode,
          samples,
        },
      ]);
      const svgPath = resolve(
        outputDir,
        `rotation_auto_direction_${mode}_angle.svg`
      );
      writeFileSync(svgPath, svgContent);
      expect(svgContent).toContain('<svg');
    }
  });

  it('compares auto-rotation direction between render modes (billboard_perspective 0/180 toggle)', async () => {
    installFakeOffscreenCanvas();
    timeState.nowMs = 0;

    const viewSize = { widthPixel: 800, heightPixel: 600 };
    const initialFov = 45;
    const initialDistance =
      viewSize.heightPixel / 2 / Math.tan((initialFov * Math.PI) / 360);

    const imageRoot = resolve(
      import.meta.dirname,
      '..',
      '..',
      'demo1',
      'images'
    );
    const cautionPng = resolve(imageRoot, 'fullmoon-500.png');
    const cautionSize = readPngSize(cautionPng);

    const outputDir = getTestResultsDir(
      'rotation-log',
      'auto-rotation-direction-compare-billboard-perspective'
    );

    const mode: SpriteElementRenderMode = 'billboard_perspective';
    const scenario: RotationLogScenario = {
      name: `rotation-log-auto-direction-${mode}`,
      gridSize: 1,
      viewSize,
      camera: {
        position: { x: 0, y: 0, z: initialDistance },
        rotation: { yaw: 0, pitch: 0, roll: 0 },
        fovY: initialFov,
        far: 10000,
      },
      images: [
        {
          imageId: 'caution',
          width: cautionSize.width,
          height: cautionSize.height,
        },
      ],
      logDir: outputDir,
      logFileName: `rotation_auto_direction_${mode}.log`,
      move: {
        mode: 'linear',
        feedforward: false,
        speedScale: 1,
      },
      rotation: {
        mode: 'linear',
        feedforward: false,
        speedScale: 0,
        autoRotation: true,
        autoRotationDistance: 0,
        renderMode: mode,
      },
      frames: 480,
      frameStepMs: 1000 / 60,
      updateIntervalMs: 500,
      outputEntries: true,
    };

    const result = await runRotationLogScenario(scenario, (deltaMs) => {
      timeState.nowMs += deltaMs;
    });

    const stats = statSync(result.logFilePath);
    expect(stats.size).toBeGreaterThan(0);
    const content = readFileSync(result.logFilePath, 'utf-8');
    expect(content).toContain('[rotation-log]');
    expect(content).toContain('[rotation-log-entry]');

    const details = parseRotationLogDetails(content);
    expect(details.length).toBeGreaterThan(0);
    const entrySamples = parseRotationLogEntrySamples(content);
    expect(entrySamples.length).toBeGreaterThan(0);
    const flipAnalysis = analyzeEntryDirectionFlips(entrySamples);
    const element0Stats = flipAnalysis.ranked.find(
      ([elementKey]) => elementKey === 0
    )?.[1];
    appendAnalysisLog(
      outputDir,
      `[rotation-log-auto-direction] mode=${mode} ${formatFlipStats(
        'element0',
        element0Stats
      )}`
    );
    assertDirectionConsistency(`mode=${mode} element0`, element0Stats);

    const entryPoints: RotationLogEntryPoint[] = entrySamples.map((entry) => ({
      frame: entry.frame,
      tMs: entry.tMs,
      elementIndex: entry.elementIndex,
      entry: entry.entry,
      edgeLeftDeg: entry.edgeLeftDeg,
      edgeLeftDeltaDeg: entry.edgeLeftDeltaDeg,
      edgeLeftDir: entry.edgeLeftDir,
      edgeLeftFlip: entry.edgeLeftFlip,
      screenTargetDeg: entry.screenTargetDeg,
      screenTargetDeltaDeg: entry.screenTargetDeltaDeg,
      screenTargetDir: entry.screenTargetDir,
      screenTargetFlip: entry.screenTargetFlip,
    }));
    const entrySvgContent = buildEntryDirectionSvg(entryPoints, {
      title: `auto-direction ${mode}`,
    });
    const entrySvgPath = resolve(
      outputDir,
      `rotation_auto_direction_${mode}_direction.svg`
    );
    writeFileSync(entrySvgPath, entrySvgContent);
    expect(entrySvgContent).toContain('<svg');

    const samples = parseRotationLogFile(result.logFilePath);
    assertNonZeroRotationDirection(`mode=${mode}`, samples);
    const svgContent = buildAngleDtSvg([
      {
        mode,
        samples,
      },
    ]);
    const svgPath = resolve(
      outputDir,
      `rotation_auto_direction_${mode}_angle.svg`
    );
    writeFileSync(svgPath, svgContent);
    expect(svgContent).toContain('<svg');
  });

  it('keeps billboard_perspective baseline stable during linear rotation without auto-rotation', async () => {
    installFakeOffscreenCanvas();
    timeState.nowMs = 0;

    const viewSize = { widthPixel: 800, heightPixel: 600 };
    const imageRoot = resolve(
      import.meta.dirname,
      '..',
      '..',
      'demo1',
      'images'
    );
    const walkerPng = resolve(imageRoot, 'globe-1500.png');
    const walkerSize = readPngSize(walkerPng);

    const outputDir = getTestResultsDir(
      'rotation-log',
      'billboard-perspective-baseline-linear'
    );

    const scenario: RotationLogScenario = {
      name: 'rotation-log-billboard-perspective-baseline-linear',
      gridSize: 3,
      viewSize,
      camera: {
        position: { x: 0, y: -616.5, z: 68.0 },
        rotation: { yaw: 0, pitch: 49, roll: 0 },
        fovY: 45,
        far: 20000,
      },
      images: [
        {
          imageId: 'walker',
          width: walkerSize.width,
          height: walkerSize.height,
        },
      ],
      logDir: outputDir,
      logFileName: 'rotation_billboard_perspective_baseline_linear.log',
      move: {
        mode: 'linear',
        feedforward: false,
        speedScale: 0,
      },
      rotation: {
        mode: 'linear',
        feedforward: false,
        speedScale: 1,
        autoRotation: false,
        autoRotationDistance: 0,
        renderMode: 'billboard_perspective',
      },
      frames: 240,
      frameStepMs: 1000 / 60,
      updateIntervalMs: 500,
      outputEntries: true,
    };

    const result = await runRotationLogScenario(scenario, (deltaMs) => {
      timeState.nowMs += deltaMs;
    });

    const content = readFileSync(result.logFilePath, 'utf-8');
    expect(content).toContain('[rotation-log-entry]');
    const entries = parseRotationLogEntrySamples(content);
    expect(entries.length).toBeGreaterThan(0);

    const baselineAnalysis = analyzeEntryBaselineStability(entries);
    appendAnalysisLog(
      outputDir,
      `[rotation-log-baseline] samples=${baselineAnalysis.sampleCount} elements=${baselineAnalysis.elementCount} changeSamples=${baselineAnalysis.changeCount} maxResidual=${baselineAnalysis.maxResidual.toFixed(
        3
      )}`
    );
    expect(baselineAnalysis.changeCount).toBeGreaterThan(0);
    expect(baselineAnalysis.maxResidual).toBeLessThan(
      ENTRY_BASELINE_MAX_ERROR_DEG
    );

    const baselinePoints = buildEntryBaselinePoints(entries);
    const baselineSvg = buildEntryBaselineSvg(baselinePoints, {
      title: 'billboard_perspective baseline linear (autoRotation off)',
    });
    writeFileSync(
      resolve(outputDir, 'rotation_billboard_perspective_baseline_entry.svg'),
      baselineSvg
    );
    expect(baselineSvg).toContain('<svg');
  });

  it('detects billboard_perspective without auto-rotation matching billboard', async () => {
    installFakeOffscreenCanvas();
    timeState.nowMs = 0;

    const viewSize = { widthPixel: 800, heightPixel: 600 };
    const imageRoot = resolve(
      import.meta.dirname,
      '..',
      '..',
      'demo1',
      'images'
    );
    const cautionPng = resolve(imageRoot, 'fullmoon-500.png');
    const cautionSize = readPngSize(cautionPng);

    const outputDir = getTestResultsDir(
      'rotation-log',
      'billboard-perspective-auto-rotation-off'
    );

    const makeScenario = (
      renderMode: SpriteElementRenderMode,
      logFileName: string
    ): RotationLogScenario => ({
      name: `rotation-log-billboard-perspective-auto-off-${renderMode}`,
      gridSize: 5,
      viewSize,
      camera: {
        position: { x: 0, y: -3547.5, z: 1000 },
        rotation: { yaw: 17, pitch: 72, roll: 5 },
        fovY: 45,
        far: 20000,
      },
      images: [
        {
          imageId: 'caution',
          width: cautionSize.width,
          height: cautionSize.height,
        },
      ],
      logDir: outputDir,
      logFileName,
      move: {
        mode: 'linear',
        feedforward: false,
        speedScale: 1,
      },
      rotation: {
        mode: 'linear',
        feedforward: false,
        speedScale: 0,
        autoRotation: false,
        autoRotationDistance: 0,
        renderMode,
      },
      frames: 240,
      frameStepMs: 1000 / 60,
      updateIntervalMs: 500,
      outputEntries: true,
    });

    const billboardPerspectiveScenario = makeScenario(
      'billboard_perspective',
      'rotation_billboard_perspective_auto_off.log'
    );
    const billboardScenario = makeScenario(
      'billboard',
      'rotation_billboard_auto_off.log'
    );

    timeState.nowMs = 0;
    const billboardPerspectiveResult = await runRotationLogScenario(
      billboardPerspectiveScenario,
      (deltaMs) => {
        timeState.nowMs += deltaMs;
      }
    );
    timeState.nowMs = 0;
    const billboardResult = await runRotationLogScenario(
      billboardScenario,
      (deltaMs) => {
        timeState.nowMs += deltaMs;
      }
    );

    const billboardPerspectiveContent = readFileSync(
      billboardPerspectiveResult.logFilePath,
      'utf-8'
    );
    const billboardContent = readFileSync(billboardResult.logFilePath, 'utf-8');
    expect(billboardPerspectiveContent).toContain('[rotation-log-entry]');
    expect(billboardContent).toContain('[rotation-log-entry]');

    const billboardPerspectiveEntries = parseRotationLogEntrySamples(
      billboardPerspectiveContent
    );
    const billboardEntries = parseRotationLogEntrySamples(billboardContent);
    expect(billboardPerspectiveEntries.length).toBeGreaterThan(0);
    expect(billboardEntries.length).toBeGreaterThan(0);

    const billboardEdgeByKey = new Map<string, number>();
    billboardEntries.forEach((entry) => {
      if (!Number.isFinite(entry.edgeLeftDeg)) {
        return;
      }
      const key = `${Math.floor(entry.frame)}:${Math.floor(
        Number.isFinite(entry.elementIndex) ? entry.elementIndex : entry.entry
      )}`;
      billboardEdgeByKey.set(key, entry.edgeLeftDeg);
    });
    const diffPoints: RotationLogEntryBaselinePoint[] = [];
    let diffSum = 0;
    let diffCount = 0;
    let diffMax = 0;
    billboardPerspectiveEntries.forEach((entry) => {
      if (!Number.isFinite(entry.edgeLeftDeg)) {
        return;
      }
      const key = `${Math.floor(entry.frame)}:${Math.floor(
        Number.isFinite(entry.elementIndex) ? entry.elementIndex : entry.entry
      )}`;
      const billboardEdge = billboardEdgeByKey.get(key);
      if (billboardEdge === undefined || !Number.isFinite(billboardEdge)) {
        return;
      }
      const diff = wrapAngleDelta(entry.edgeLeftDeg - billboardEdge);
      const absDiff = Math.abs(diff);
      diffSum += absDiff;
      diffCount += 1;
      if (absDiff > diffMax) {
        diffMax = absDiff;
      }
      diffPoints.push({
        frame: entry.frame,
        tMs: entry.tMs,
        elementIndex: entry.elementIndex,
        entry: entry.entry,
        baselineErrorDeg: diff,
      });
    });
    const diffAverage = diffCount > 0 ? diffSum / diffCount : 0;
    appendAnalysisLog(
      outputDir,
      `[rotation-log-billboard_perspective-auto-off] samples=${diffCount} diffAvg=${diffAverage.toFixed(
        3
      )} diffMax=${diffMax.toFixed(3)}`
    );

    const entryPointsBillboardPerspective: RotationLogEntryPoint[] =
      billboardPerspectiveEntries.map((entry) => ({
        frame: entry.frame,
        tMs: entry.tMs,
        elementIndex: entry.elementIndex,
        entry: entry.entry,
        edgeLeftDeg: entry.edgeLeftDeg,
        edgeLeftDeltaDeg: entry.edgeLeftDeltaDeg,
        edgeLeftDir: entry.edgeLeftDir,
        edgeLeftFlip: entry.edgeLeftFlip,
        screenTargetDeg: entry.screenTargetDeg,
        screenTargetDeltaDeg: entry.screenTargetDeltaDeg,
        screenTargetDir: entry.screenTargetDir,
        screenTargetFlip: entry.screenTargetFlip,
      }));
    const entryPointsBillboard: RotationLogEntryPoint[] = billboardEntries.map(
      (entry) => ({
        frame: entry.frame,
        tMs: entry.tMs,
        elementIndex: entry.elementIndex,
        entry: entry.entry,
        edgeLeftDeg: entry.edgeLeftDeg,
        edgeLeftDeltaDeg: entry.edgeLeftDeltaDeg,
        edgeLeftDir: entry.edgeLeftDir,
        edgeLeftFlip: entry.edgeLeftFlip,
        screenTargetDeg: entry.screenTargetDeg,
        screenTargetDeltaDeg: entry.screenTargetDeltaDeg,
        screenTargetDir: entry.screenTargetDir,
        screenTargetFlip: entry.screenTargetFlip,
      })
    );
    const entrySvgBillboardPerspective = buildEntryDirectionSvg(
      entryPointsBillboardPerspective,
      {
        title: 'billboard_perspective autoRotation off',
      }
    );
    const entrySvgBillboard = buildEntryDirectionSvg(entryPointsBillboard, {
      title: 'billboard autoRotation off',
    });
    writeFileSync(
      resolve(outputDir, 'rotation_billboard_perspective_auto_off_entry.svg'),
      entrySvgBillboardPerspective
    );
    writeFileSync(
      resolve(outputDir, 'rotation_billboard_auto_off_entry.svg'),
      entrySvgBillboard
    );
    expect(entrySvgBillboardPerspective).toContain('<svg');
    expect(entrySvgBillboard).toContain('<svg');
    const diffSvg = buildEntryBaselineSvg(diffPoints, {
      title: 'billboard_perspective vs billboard (autoRotation off)',
    });
    writeFileSync(
      resolve(outputDir, 'rotation_billboard_perspective_auto_off_diff.svg'),
      diffSvg
    );
    expect(diffSvg).toContain('<svg');

    expect(diffAverage).toBeGreaterThan(2);
    expect(diffMax).toBeGreaterThan(2);
  });
});
