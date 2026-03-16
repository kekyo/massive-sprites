// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it, vi, afterEach } from 'vitest';

import { createRotationLogger } from '../src/debug-logs';

const globalWithRotationLog = globalThis as typeof globalThis & {
  outputRotationLog: boolean | undefined;
  outputRotationLogVerbose: boolean | undefined;
  rotationLogSink: ((message: string) => void) | undefined;
};

const identityMatrix = () =>
  new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const OUTPUT_STRIDE = 24;

const makeVertices = (
  x0: number,
  y0: number,
  z0: number,
  x1: number,
  y1: number,
  z1: number
) =>
  new Float32Array([
    x0,
    y0,
    z0,
    0,
    0,
    1,
    x1,
    y1,
    z1,
    0,
    0,
    1,
    x0,
    y0 + 1,
    z0,
    0,
    0,
    1,
    x1,
    y1 + 1,
    z1,
    0,
    0,
    1,
  ]);

describe('rotation log helper', () => {
  afterEach(() => {
    globalWithRotationLog.outputRotationLog = undefined;
    globalWithRotationLog.outputRotationLogVerbose = undefined;
    globalWithRotationLog.rotationLogSink = undefined;
    vi.restoreAllMocks();
  });

  it('logs angle and dt when enabled', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    globalWithRotationLog.outputRotationLog = true;
    globalWithRotationLog.rotationLogSink = console.log;
    const logger = createRotationLogger();
    const viewProjection = identityMatrix();
    const vertices = makeVertices(0, 0, 0, 1, 0, 0);

    logger({
      viewProjection,
      vertices,
      nowMs: 1000,
      entryStride: OUTPUT_STRIDE,
      rotateDeg: 12.5,
      finalRotateDeg: 45.25,
      rotationFromDeg: 10,
      rotationToDeg: 20,
      rotationStartMs: 900,
      rotationDurationMs: 200,
      rotationT: 0.5,
      rotationTEased: 0.5,
      rotationDeltaDeg: 10,
      finalRotationFromDeg: 11,
      finalRotationToDeg: 21,
      finalRotationStartMs: 905,
      finalRotationDurationMs: 205,
      finalRotationT: 0.25,
      finalRotationTEased: 0.25,
      finalRotationDeltaDeg: 10,
    });
    logger({
      viewProjection,
      vertices,
      nowMs: 1016,
      entryStride: OUTPUT_STRIDE,
      rotateDeg: 13.5,
      finalRotateDeg: 46.75,
      rotationFromDeg: 10,
      rotationToDeg: 20,
      rotationStartMs: 900,
      rotationDurationMs: 200,
      rotationT: 0.58,
      rotationTEased: 0.58,
      rotationDeltaDeg: 10,
      finalRotationFromDeg: 11,
      finalRotationToDeg: 21,
      finalRotationStartMs: 905,
      finalRotationDurationMs: 205,
      finalRotationT: 0.32,
      finalRotationTEased: 0.32,
      finalRotationDeltaDeg: 10,
    });

    expect(logSpy).toHaveBeenCalledTimes(2);
    const last = logSpy.mock.calls[1]?.[0] ?? '';
    const match =
      /dt=([0-9.]+) angleDeg=([0-9.\\-]+) rotateDeg=([0-9.\\-]+) finalRotateDeg=([0-9.\\-]+)/.exec(
        last
      );
    expect(match).not.toBeNull();
    if (match) {
      const dt = Number.parseFloat(match[1]!);
      const angle = Number.parseFloat(match[2]!);
      const rotateDeg = Number.parseFloat(match[3]!);
      const finalRotateDeg = Number.parseFloat(match[4]!);
      expect(dt).toBeCloseTo(16, 5);
      expect(angle).toBeCloseTo(90, 5);
      expect(rotateDeg).toBeCloseTo(13.5, 5);
      expect(finalRotateDeg).toBeCloseTo(46.75, 5);
    }
    expect(last).toContain('rotFrom=10.000');
    expect(last).toContain('rotTo=20.000');
    expect(last).toContain('rotDelta=10.000');
    expect(last).toContain('rotStart=900.00');
    expect(last).toContain('rotDur=200.00');
    expect(last).toContain('rotT=0.58000');
    expect(last).toContain('rotTEased=0.58000');
    expect(last).toContain('finalFrom=11.000');
    expect(last).toContain('finalTo=21.000');
    expect(last).toContain('finalDelta=10.000');
    expect(last).toContain('finalStart=905.00');
    expect(last).toContain('finalDur=205.00');
    expect(last).toContain('finalT=0.32000');
    expect(last).toContain('finalTEased=0.32000');
  });

  it('does not log when disabled', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    globalWithRotationLog.outputRotationLog = false;
    globalWithRotationLog.rotationLogSink = console.log;
    const logger = createRotationLogger();
    const viewProjection = identityMatrix();
    const vertices = makeVertices(0, 0, 0, 1, 0, 0);

    logger({
      viewProjection,
      vertices,
      nowMs: 1000,
      entryStride: OUTPUT_STRIDE,
    });

    expect(logSpy).not.toHaveBeenCalled();
  });

  it('logs verbose diagnostics when enabled', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    globalWithRotationLog.outputRotationLog = true;
    globalWithRotationLog.outputRotationLogVerbose = true;
    globalWithRotationLog.rotationLogSink = console.log;
    const logger = createRotationLogger();
    const viewProjection = identityMatrix();
    const viewMatrix = identityMatrix();
    const vertices = makeVertices(0, 0, 0, 1, 0, 0);

    logger({
      viewProjection,
      viewMatrix,
      vertices,
      nowMs: 1000,
      entryStride: OUTPUT_STRIDE,
      rotateDeg: 15,
      finalRotateDeg: 45,
      rotationFromDeg: 10,
      rotationToDeg: 20,
      rotationStartMs: 900,
      rotationDurationMs: 200,
      rotationT: 0.5,
      rotationTEased: 0.5,
      finalRotationFromDeg: 30,
      finalRotationToDeg: 60,
      finalRotationStartMs: 905,
      finalRotationDurationMs: 205,
      finalRotationT: 0.25,
      finalRotationTEased: 0.25,
      renderMode: 1,
    });

    expect(logSpy).toHaveBeenCalled();
    const messages = logSpy.mock.calls.map((call) => String(call[0] ?? ''));
    expect(messages.some((line) => line.includes('[rotation-log]'))).toBe(true);
    expect(
      messages.some((line) => line.includes('[rotation-log-verbose]'))
    ).toBe(true);
    const verboseLine = messages.find((line) =>
      line.includes('[rotation-log-verbose]')
    );
    expect(verboseLine).toBeTruthy();
    if (verboseLine) {
      expect(verboseLine).toContain('edgeBottomDeg=');
      expect(verboseLine).toContain('screenFromRotDeg=');
      expect(verboseLine).toContain('billboardFinalDeg=');
    }
  });
});
