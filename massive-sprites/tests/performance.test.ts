// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type { PerformanceSampleInput } from '../src/performance';
import { createObjectPerformanceTracker } from '../src/performance';

describe('performance', () => {
  it('aggregates render samples into averages', () => {
    const tracker = createObjectPerformanceTracker();

    const baseSample: PerformanceSampleInput = {
      timestampMs: 0,
      spriteRenderDurationMs: 0,
      cameraTrackingDurationMs: 0,
      wasmComputeDurationMs: 0,
      wasmComputeInternalDurationMs: 0,
      wasmComputeProjectionDurationMs: 0,
      wasmComputeSpriteAnimationDurationMs: 0,
      wasmComputeElementAnimationDurationMs: 0,
      wasmComputePivotResolveDurationMs: 0,
      wasmComputeAutoRotationDurationMs: 0,
      wasmComputeCollectEntriesDurationMs: 0,
      wasmComputeSortEntriesDurationMs: 0,
      wasmComputeWriteOutputDurationMs: 0,
      commandApplyDurationMs: 0,
      commandApplyCallDurationMs: 0,
      commandApplyJsDurationMs: 0,
      commandApplyWasmDurationMs: 0,
      commandApplyWasmLoopDurationMs: 0,
      commandApplyWasmSyncSlotsDurationMs: 0,
      commandApplyWasmClearDurationMs: 0,
      drawSetupDurationMs: 0,
      ensureRenderBuffersDurationMs: 0,
      vertexUploadDurationMs: 0,
      drawLoopDurationMs: 0,
      commandCount: 0,
      updateSpriteCommandCount: 0,
      updateFrameCount: 0,
      updateQueueDelayMs: 0,
      activeElementCount: 0,
      drawCallCount: 0,
      textureBindCount: 0,
      skippedDrawCount: 0,
      textureBindDurationMs: 0,
      opacityUniformDurationMs: 0,
      drawCallDurationMs: 0,
    };

    tracker.recordWasmBufferResize(2);
    tracker.pushSample({
      ...baseSample,
      timestampMs: 0,
      spriteRenderDurationMs: 10,
      cameraTrackingDurationMs: 2,
      wasmComputeDurationMs: 4,
      commandCount: 2,
      updateSpriteCommandCount: 1,
      updateFrameCount: 1,
      updateQueueDelayMs: 12,
      activeElementCount: 3,
      drawCallCount: 2,
      textureBindCount: 1,
      skippedDrawCount: 0,
      textureBindDurationMs: 1,
      opacityUniformDurationMs: 2,
      drawCallDurationMs: 3,
    });

    tracker.recordWasmBufferResize(1);
    tracker.pushSample({
      ...baseSample,
      timestampMs: 100,
      spriteRenderDurationMs: 30,
      cameraTrackingDurationMs: 4,
      wasmComputeDurationMs: 6,
      commandCount: 4,
      updateSpriteCommandCount: 0,
      updateFrameCount: 0,
      updateQueueDelayMs: 0,
      activeElementCount: 5,
      drawCallCount: 4,
      textureBindCount: 2,
      skippedDrawCount: 1,
      textureBindDurationMs: 2,
      opacityUniformDurationMs: 1,
      drawCallDurationMs: 4,
    });

    const snapshot = tracker.getPerformanceSnapshot();

    expect(snapshot.sampleCount).toBe(2);
    expect(snapshot.fps).toBeCloseTo(10, 5);
    expect(snapshot.avgFrameIntervalMs).toBeCloseTo(100, 5);
    expect(snapshot.avgSpriteRenderDurationMs).toBeCloseTo(20, 5);
    expect(snapshot.avgCameraTrackingDurationMs).toBeCloseTo(3, 5);
    expect(snapshot.avgCanvasRenderDurationMs).toBeCloseTo(
      snapshot.avgSpriteRenderDurationMs,
      5
    );
    expect(snapshot.avgWasmComputeDurationMs).toBeCloseTo(5, 5);
    expect(snapshot.avgCommandCount).toBeCloseTo(3, 5);
    expect(snapshot.updateFrameRatio).toBeCloseTo(0.5, 5);
    expect(snapshot.avgUpdateQueueDelayMs).toBeCloseTo(12, 5);
    expect(snapshot.avgWasmBufferResizeCount).toBeCloseTo(1.5, 5);
    expect(snapshot.totalWasmBufferResizeCount).toBe(3);
  });

  it('resets samples and totals', () => {
    const tracker = createObjectPerformanceTracker();

    const sample: PerformanceSampleInput = {
      timestampMs: 0,
      spriteRenderDurationMs: 1,
      cameraTrackingDurationMs: 0,
      wasmComputeDurationMs: 1,
      wasmComputeInternalDurationMs: 0,
      wasmComputeProjectionDurationMs: 0,
      wasmComputeSpriteAnimationDurationMs: 0,
      wasmComputeElementAnimationDurationMs: 0,
      wasmComputePivotResolveDurationMs: 0,
      wasmComputeAutoRotationDurationMs: 0,
      wasmComputeCollectEntriesDurationMs: 0,
      wasmComputeSortEntriesDurationMs: 0,
      wasmComputeWriteOutputDurationMs: 0,
      commandApplyDurationMs: 0,
      commandApplyCallDurationMs: 0,
      commandApplyJsDurationMs: 0,
      commandApplyWasmDurationMs: 0,
      commandApplyWasmLoopDurationMs: 0,
      commandApplyWasmSyncSlotsDurationMs: 0,
      commandApplyWasmClearDurationMs: 0,
      drawSetupDurationMs: 0,
      ensureRenderBuffersDurationMs: 0,
      vertexUploadDurationMs: 0,
      drawLoopDurationMs: 0,
      commandCount: 0,
      updateSpriteCommandCount: 0,
      updateFrameCount: 0,
      updateQueueDelayMs: 0,
      activeElementCount: 0,
      drawCallCount: 0,
      textureBindCount: 0,
      skippedDrawCount: 0,
      textureBindDurationMs: 0,
      opacityUniformDurationMs: 0,
      drawCallDurationMs: 0,
    };

    tracker.recordWasmBufferResize(1);
    tracker.pushSample(sample);
    tracker.resetPerformanceSnapshot();

    const snapshot = tracker.getPerformanceSnapshot();

    expect(snapshot.sampleCount).toBe(0);
    expect(snapshot.totalWasmBufferResizeCount).toBe(0);
    expect(snapshot.avgWasmBufferResizeCount).toBe(0);
  });
});
