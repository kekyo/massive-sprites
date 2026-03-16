// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type { ObjectPerformanceSnapshot } from './types';
import { getNowMs } from './utils';

///////////////////////////////////////////////////////////////////////////////////

const PERFORMANCE_WINDOW_MS = 1000;

/**
 * Raw per-frame metrics consumed by the performance tracker.
 */
export interface PerformanceSampleInput {
  /** Timestamp associated with the sample. */
  readonly timestampMs: number;
  /** Total object renderer duration for the frame. */
  readonly spriteRenderDurationMs: number;
  /** Duration spent resolving camera tracking on the JS side. */
  readonly cameraTrackingDurationMs: number;
  /** Duration spent in the WASM compute call. */
  readonly wasmComputeDurationMs: number;
  /** Duration reported by WASM for internal compute work. */
  readonly wasmComputeInternalDurationMs: number;
  /** Duration spent updating projection data in WASM. */
  readonly wasmComputeProjectionDurationMs: number;
  /** Duration spent updating sprite animation state in WASM. */
  readonly wasmComputeSpriteAnimationDurationMs: number;
  /** Duration spent updating element animation state in WASM. */
  readonly wasmComputeElementAnimationDurationMs: number;
  /** Duration spent resolving element pivots in WASM. */
  readonly wasmComputePivotResolveDurationMs: number;
  /** Duration spent applying auto rotation in WASM. */
  readonly wasmComputeAutoRotationDurationMs: number;
  /** Duration spent collecting draw entries in WASM. */
  readonly wasmComputeCollectEntriesDurationMs: number;
  /** Duration spent sorting draw entries in WASM. */
  readonly wasmComputeSortEntriesDurationMs: number;
  /** Duration spent writing output vertices in WASM. */
  readonly wasmComputeWriteOutputDurationMs: number;
  /** End-to-end duration of command application. */
  readonly commandApplyDurationMs: number;
  /** Duration of the JS-to-WASM command application call. */
  readonly commandApplyCallDurationMs: number;
  /** JS-side duration after WASM command application. */
  readonly commandApplyJsDurationMs: number;
  /** Duration spent inside WASM command application. */
  readonly commandApplyWasmDurationMs: number;
  /** Duration spent in the WASM command loop. */
  readonly commandApplyWasmLoopDurationMs: number;
  /** Duration spent synchronizing slot ownership in WASM. */
  readonly commandApplyWasmSyncSlotsDurationMs: number;
  /** Duration spent clearing the WASM command buffer. */
  readonly commandApplyWasmClearDurationMs: number;
  /** Duration spent setting up draw state on the JS side. */
  readonly drawSetupDurationMs: number;
  /** Duration spent ensuring render buffer capacity. */
  readonly ensureRenderBuffersDurationMs: number;
  /** Duration spent uploading vertex data to WebGL. */
  readonly vertexUploadDurationMs: number;
  /** Duration spent issuing draw calls. */
  readonly drawLoopDurationMs: number;
  /** Number of commands processed in the frame. */
  readonly commandCount: number;
  /** Number of `updateSprite` commands processed in the frame. */
  readonly updateSpriteCommandCount: number;
  /** Whether the frame processed queued sprite updates, expressed as `0` or `1`. */
  readonly updateFrameCount: number;
  /** Delay between enqueuing and applying sprite updates. */
  readonly updateQueueDelayMs: number;
  /** Active element count returned by WASM. */
  readonly activeElementCount: number;
  /** Number of draw calls issued. */
  readonly drawCallCount: number;
  /** Number of texture binds issued. */
  readonly textureBindCount: number;
  /** Number of active elements skipped during drawing. */
  readonly skippedDrawCount: number;
  /** Time spent in texture bind calls. */
  readonly textureBindDurationMs: number;
  /** Time spent updating opacity uniforms. */
  readonly opacityUniformDurationMs: number;
  /** Time spent in draw calls. */
  readonly drawCallDurationMs: number;
}

interface PerformanceSample extends PerformanceSampleInput {
  readonly wasmBufferResizeCount: number;
}

/**
 * Rolling performance tracker used by the renderer implementation.
 */
export interface ObjectPerformanceTracker {
  /** Records how many WASM buffer resize events occurred since the previous sample. */
  readonly recordWasmBufferResize: (resizeCount: number) => void;
  /** Pushes one raw frame sample into the rolling window. */
  readonly pushSample: (sample: PerformanceSampleInput) => void;
  /** Returns the current rolling performance snapshot. */
  readonly getPerformanceSnapshot: () => ObjectPerformanceSnapshot;
  /** Clears the rolling window while keeping cumulative resize totals. */
  readonly resetPerformanceSnapshot: () => void;
}

///////////////////////////////////////////////////////////////////////////////////

/**
 * Creates a rolling performance tracker for render samples and WASM buffer resizes.
 * @returns Performance tracker instance.
 */
export const createObjectPerformanceTracker = (): ObjectPerformanceTracker => {
  const performanceSamples: PerformanceSample[] = [];
  let spriteRenderDurationMsSum = 0;
  let cameraTrackingDurationMsSum = 0;
  let wasmComputeDurationMsSum = 0;
  let wasmComputeInternalDurationMsSum = 0;
  let wasmComputeProjectionDurationMsSum = 0;
  let wasmComputeSpriteAnimationDurationMsSum = 0;
  let wasmComputeElementAnimationDurationMsSum = 0;
  let wasmComputePivotResolveDurationMsSum = 0;
  let wasmComputeAutoRotationDurationMsSum = 0;
  let wasmComputeCollectEntriesDurationMsSum = 0;
  let wasmComputeSortEntriesDurationMsSum = 0;
  let wasmComputeWriteOutputDurationMsSum = 0;
  let commandApplyDurationMsSum = 0;
  let commandApplyCallDurationMsSum = 0;
  let commandApplyJsDurationMsSum = 0;
  let commandApplyWasmDurationMsSum = 0;
  let commandApplyWasmLoopDurationMsSum = 0;
  let commandApplyWasmSyncSlotsDurationMsSum = 0;
  let commandApplyWasmClearDurationMsSum = 0;
  let drawSetupDurationMsSum = 0;
  let ensureRenderBuffersDurationMsSum = 0;
  let vertexUploadDurationMsSum = 0;
  let drawLoopDurationMsSum = 0;
  let commandCountSum = 0;
  let updateSpriteCommandCountSum = 0;
  let updateFrameCountSum = 0;
  let updateQueueDelayMsSum = 0;
  let activeElementCountSum = 0;
  let drawCallCountSum = 0;
  let textureBindCountSum = 0;
  let skippedDrawCountSum = 0;
  let textureBindDurationMsSum = 0;
  let opacityUniformDurationMsSum = 0;
  let drawCallDurationMsSum = 0;
  let wasmBufferResizeCountSum = 0;
  let pendingWasmBufferResizeCount = 0;
  let totalWasmBufferResizeCount = 0;

  const clearSamples = () => {
    performanceSamples.length = 0;
    spriteRenderDurationMsSum = 0;
    cameraTrackingDurationMsSum = 0;
    wasmComputeDurationMsSum = 0;
    wasmComputeInternalDurationMsSum = 0;
    wasmComputeProjectionDurationMsSum = 0;
    wasmComputeSpriteAnimationDurationMsSum = 0;
    wasmComputeElementAnimationDurationMsSum = 0;
    wasmComputePivotResolveDurationMsSum = 0;
    wasmComputeAutoRotationDurationMsSum = 0;
    wasmComputeCollectEntriesDurationMsSum = 0;
    wasmComputeSortEntriesDurationMsSum = 0;
    wasmComputeWriteOutputDurationMsSum = 0;
    commandApplyDurationMsSum = 0;
    commandApplyCallDurationMsSum = 0;
    commandApplyJsDurationMsSum = 0;
    commandApplyWasmDurationMsSum = 0;
    commandApplyWasmLoopDurationMsSum = 0;
    commandApplyWasmSyncSlotsDurationMsSum = 0;
    commandApplyWasmClearDurationMsSum = 0;
    drawSetupDurationMsSum = 0;
    ensureRenderBuffersDurationMsSum = 0;
    vertexUploadDurationMsSum = 0;
    drawLoopDurationMsSum = 0;
    commandCountSum = 0;
    updateSpriteCommandCountSum = 0;
    updateFrameCountSum = 0;
    updateQueueDelayMsSum = 0;
    activeElementCountSum = 0;
    drawCallCountSum = 0;
    textureBindCountSum = 0;
    skippedDrawCountSum = 0;
    textureBindDurationMsSum = 0;
    opacityUniformDurationMsSum = 0;
    drawCallDurationMsSum = 0;
    wasmBufferResizeCountSum = 0;
  };

  const pruneSamples = (latestTimestampMs: number) => {
    const cutoffTimestampMs = latestTimestampMs - PERFORMANCE_WINDOW_MS;
    while (
      performanceSamples.length > 0 &&
      (performanceSamples[0]?.timestampMs ?? Number.NEGATIVE_INFINITY) <
        cutoffTimestampMs
    ) {
      const removed = performanceSamples.shift();
      if (!removed) {
        continue;
      }
      spriteRenderDurationMsSum -= removed.spriteRenderDurationMs;
      cameraTrackingDurationMsSum -= removed.cameraTrackingDurationMs;
      wasmComputeDurationMsSum -= removed.wasmComputeDurationMs;
      wasmComputeInternalDurationMsSum -= removed.wasmComputeInternalDurationMs;
      wasmComputeProjectionDurationMsSum -=
        removed.wasmComputeProjectionDurationMs;
      wasmComputeSpriteAnimationDurationMsSum -=
        removed.wasmComputeSpriteAnimationDurationMs;
      wasmComputeElementAnimationDurationMsSum -=
        removed.wasmComputeElementAnimationDurationMs;
      wasmComputePivotResolveDurationMsSum -=
        removed.wasmComputePivotResolveDurationMs;
      wasmComputeAutoRotationDurationMsSum -=
        removed.wasmComputeAutoRotationDurationMs;
      wasmComputeCollectEntriesDurationMsSum -=
        removed.wasmComputeCollectEntriesDurationMs;
      wasmComputeSortEntriesDurationMsSum -=
        removed.wasmComputeSortEntriesDurationMs;
      wasmComputeWriteOutputDurationMsSum -=
        removed.wasmComputeWriteOutputDurationMs;
      commandApplyDurationMsSum -= removed.commandApplyDurationMs;
      commandApplyCallDurationMsSum -= removed.commandApplyCallDurationMs;
      commandApplyJsDurationMsSum -= removed.commandApplyJsDurationMs;
      commandApplyWasmDurationMsSum -= removed.commandApplyWasmDurationMs;
      commandApplyWasmLoopDurationMsSum -=
        removed.commandApplyWasmLoopDurationMs;
      commandApplyWasmSyncSlotsDurationMsSum -=
        removed.commandApplyWasmSyncSlotsDurationMs;
      commandApplyWasmClearDurationMsSum -=
        removed.commandApplyWasmClearDurationMs;
      drawSetupDurationMsSum -= removed.drawSetupDurationMs;
      ensureRenderBuffersDurationMsSum -= removed.ensureRenderBuffersDurationMs;
      vertexUploadDurationMsSum -= removed.vertexUploadDurationMs;
      drawLoopDurationMsSum -= removed.drawLoopDurationMs;
      commandCountSum -= removed.commandCount;
      updateSpriteCommandCountSum -= removed.updateSpriteCommandCount;
      updateFrameCountSum -= removed.updateFrameCount;
      updateQueueDelayMsSum -= removed.updateQueueDelayMs;
      activeElementCountSum -= removed.activeElementCount;
      drawCallCountSum -= removed.drawCallCount;
      textureBindCountSum -= removed.textureBindCount;
      skippedDrawCountSum -= removed.skippedDrawCount;
      textureBindDurationMsSum -= removed.textureBindDurationMs;
      opacityUniformDurationMsSum -= removed.opacityUniformDurationMs;
      drawCallDurationMsSum -= removed.drawCallDurationMs;
      wasmBufferResizeCountSum -= removed.wasmBufferResizeCount;
    }
  };

  const recordWasmBufferResize = (resizeCount: number) => {
    if (resizeCount <= 0) {
      return;
    }
    pendingWasmBufferResizeCount += resizeCount;
    totalWasmBufferResizeCount += resizeCount;
  };

  const pushSample = (sample: PerformanceSampleInput) => {
    const wasmBufferResizeCount =
      pendingWasmBufferResizeCount > 0 ? pendingWasmBufferResizeCount : 0;
    if (pendingWasmBufferResizeCount > 0) {
      pendingWasmBufferResizeCount = 0;
    }
    const resolvedSample: PerformanceSample = {
      ...sample,
      wasmBufferResizeCount,
    };
    performanceSamples.push(resolvedSample);
    spriteRenderDurationMsSum += resolvedSample.spriteRenderDurationMs;
    cameraTrackingDurationMsSum += resolvedSample.cameraTrackingDurationMs;
    wasmComputeDurationMsSum += resolvedSample.wasmComputeDurationMs;
    wasmComputeInternalDurationMsSum +=
      resolvedSample.wasmComputeInternalDurationMs;
    wasmComputeProjectionDurationMsSum +=
      resolvedSample.wasmComputeProjectionDurationMs;
    wasmComputeSpriteAnimationDurationMsSum +=
      resolvedSample.wasmComputeSpriteAnimationDurationMs;
    wasmComputeElementAnimationDurationMsSum +=
      resolvedSample.wasmComputeElementAnimationDurationMs;
    wasmComputePivotResolveDurationMsSum +=
      resolvedSample.wasmComputePivotResolveDurationMs;
    wasmComputeAutoRotationDurationMsSum +=
      resolvedSample.wasmComputeAutoRotationDurationMs;
    wasmComputeCollectEntriesDurationMsSum +=
      resolvedSample.wasmComputeCollectEntriesDurationMs;
    wasmComputeSortEntriesDurationMsSum +=
      resolvedSample.wasmComputeSortEntriesDurationMs;
    wasmComputeWriteOutputDurationMsSum +=
      resolvedSample.wasmComputeWriteOutputDurationMs;
    commandApplyDurationMsSum += resolvedSample.commandApplyDurationMs;
    commandApplyCallDurationMsSum += resolvedSample.commandApplyCallDurationMs;
    commandApplyJsDurationMsSum += resolvedSample.commandApplyJsDurationMs;
    commandApplyWasmDurationMsSum += resolvedSample.commandApplyWasmDurationMs;
    commandApplyWasmLoopDurationMsSum +=
      resolvedSample.commandApplyWasmLoopDurationMs;
    commandApplyWasmSyncSlotsDurationMsSum +=
      resolvedSample.commandApplyWasmSyncSlotsDurationMs;
    commandApplyWasmClearDurationMsSum +=
      resolvedSample.commandApplyWasmClearDurationMs;
    drawSetupDurationMsSum += resolvedSample.drawSetupDurationMs;
    ensureRenderBuffersDurationMsSum +=
      resolvedSample.ensureRenderBuffersDurationMs;
    vertexUploadDurationMsSum += resolvedSample.vertexUploadDurationMs;
    drawLoopDurationMsSum += resolvedSample.drawLoopDurationMs;
    commandCountSum += resolvedSample.commandCount;
    updateSpriteCommandCountSum += resolvedSample.updateSpriteCommandCount;
    updateFrameCountSum += resolvedSample.updateFrameCount;
    updateQueueDelayMsSum += resolvedSample.updateQueueDelayMs;
    activeElementCountSum += resolvedSample.activeElementCount;
    drawCallCountSum += resolvedSample.drawCallCount;
    textureBindCountSum += resolvedSample.textureBindCount;
    skippedDrawCountSum += resolvedSample.skippedDrawCount;
    textureBindDurationMsSum += resolvedSample.textureBindDurationMs;
    opacityUniformDurationMsSum += resolvedSample.opacityUniformDurationMs;
    drawCallDurationMsSum += resolvedSample.drawCallDurationMs;
    wasmBufferResizeCountSum += resolvedSample.wasmBufferResizeCount;
    pruneSamples(resolvedSample.timestampMs);
  };

  const getPerformanceSnapshot = (): ObjectPerformanceSnapshot => {
    const sampleCount = performanceSamples.length;
    const timestampMs =
      sampleCount > 0
        ? (performanceSamples[sampleCount - 1]?.timestampMs ?? getNowMs())
        : getNowMs();
    if (sampleCount <= 0) {
      return {
        timestampMs,
        windowMs: PERFORMANCE_WINDOW_MS,
        sampleCount: 0,
        fps: 0,
        avgFrameIntervalMs: 0,
        avgCanvasRenderDurationMs: 0,
        avgSpriteRenderDurationMs: 0,
        avgCameraTrackingDurationMs: 0,
        avgWasmComputeDurationMs: 0,
        avgWasmComputeInternalDurationMs: 0,
        avgWasmComputeProjectionDurationMs: 0,
        avgWasmComputeSpriteAnimationDurationMs: 0,
        avgWasmComputeElementAnimationDurationMs: 0,
        avgWasmComputePivotResolveDurationMs: 0,
        avgWasmComputeAutoRotationDurationMs: 0,
        avgWasmComputeCollectEntriesDurationMs: 0,
        avgWasmComputeSortEntriesDurationMs: 0,
        avgWasmComputeWriteOutputDurationMs: 0,
        avgCpuDurationMs: 0,
        wasmComputeRatio: 0,
        avgCommandApplyDurationMs: 0,
        avgCommandApplyCallDurationMs: 0,
        avgCommandApplyJsDurationMs: 0,
        avgCommandApplyWasmDurationMs: 0,
        avgCommandApplyWasmLoopDurationMs: 0,
        avgCommandApplyWasmSyncSlotsDurationMs: 0,
        avgCommandApplyWasmClearDurationMs: 0,
        avgDrawSetupDurationMs: 0,
        avgEnsureRenderBuffersDurationMs: 0,
        avgVertexUploadDurationMs: 0,
        avgDrawLoopDurationMs: 0,
        avgCommandCount: 0,
        avgUpdateSpriteCommandCount: 0,
        updateFrameRatio: 0,
        avgUpdateQueueDelayMs: 0,
        avgActiveElementCount: 0,
        avgDrawCallCount: 0,
        avgTextureBindCount: 0,
        avgSkippedDrawCount: 0,
        avgTextureBindDurationMs: 0,
        avgOpacityUniformDurationMs: 0,
        avgDrawCallDurationMs: 0,
        avgWasmBufferResizeCount: 0,
        totalWasmBufferResizeCount,
      };
    }

    const firstTimestampMs = performanceSamples[0]?.timestampMs ?? timestampMs;
    const intervalMs =
      sampleCount > 1 ? Math.max(0, timestampMs - firstTimestampMs) : 0;
    const fps =
      sampleCount > 1 && intervalMs > 0
        ? ((sampleCount - 1) * 1000) / intervalMs
        : 0;
    const avgFrameIntervalMs =
      sampleCount > 1 ? intervalMs / (sampleCount - 1) : 0;
    const avgSpriteRenderDurationMs = Math.max(
      0,
      spriteRenderDurationMsSum / sampleCount
    );
    const avgCameraTrackingDurationMs = Math.max(
      0,
      cameraTrackingDurationMsSum / sampleCount
    );
    const avgWasmComputeDurationMs = Math.max(
      0,
      wasmComputeDurationMsSum / sampleCount
    );
    const avgWasmComputeInternalDurationMs = Math.max(
      0,
      wasmComputeInternalDurationMsSum / sampleCount
    );
    const avgWasmComputeProjectionDurationMs = Math.max(
      0,
      wasmComputeProjectionDurationMsSum / sampleCount
    );
    const avgWasmComputeSpriteAnimationDurationMs = Math.max(
      0,
      wasmComputeSpriteAnimationDurationMsSum / sampleCount
    );
    const avgWasmComputeElementAnimationDurationMs = Math.max(
      0,
      wasmComputeElementAnimationDurationMsSum / sampleCount
    );
    const avgWasmComputePivotResolveDurationMs = Math.max(
      0,
      wasmComputePivotResolveDurationMsSum / sampleCount
    );
    const avgWasmComputeAutoRotationDurationMs = Math.max(
      0,
      wasmComputeAutoRotationDurationMsSum / sampleCount
    );
    const avgWasmComputeCollectEntriesDurationMs = Math.max(
      0,
      wasmComputeCollectEntriesDurationMsSum / sampleCount
    );
    const avgWasmComputeSortEntriesDurationMs = Math.max(
      0,
      wasmComputeSortEntriesDurationMsSum / sampleCount
    );
    const avgWasmComputeWriteOutputDurationMs = Math.max(
      0,
      wasmComputeWriteOutputDurationMsSum / sampleCount
    );
    const avgCpuDurationMs = Math.max(
      0,
      avgSpriteRenderDurationMs - avgWasmComputeDurationMs
    );
    const wasmComputeRatio =
      avgSpriteRenderDurationMs > 0
        ? Math.max(
            0,
            Math.min(1, avgWasmComputeDurationMs / avgSpriteRenderDurationMs)
          )
        : 0;
    const avgCommandApplyDurationMs = Math.max(
      0,
      commandApplyDurationMsSum / sampleCount
    );
    const avgCommandApplyCallDurationMs = Math.max(
      0,
      commandApplyCallDurationMsSum / sampleCount
    );
    const avgCommandApplyJsDurationMs = Math.max(
      0,
      commandApplyJsDurationMsSum / sampleCount
    );
    const avgCommandApplyWasmDurationMs = Math.max(
      0,
      commandApplyWasmDurationMsSum / sampleCount
    );
    const avgCommandApplyWasmLoopDurationMs = Math.max(
      0,
      commandApplyWasmLoopDurationMsSum / sampleCount
    );
    const avgCommandApplyWasmSyncSlotsDurationMs = Math.max(
      0,
      commandApplyWasmSyncSlotsDurationMsSum / sampleCount
    );
    const avgCommandApplyWasmClearDurationMs = Math.max(
      0,
      commandApplyWasmClearDurationMsSum / sampleCount
    );
    const avgDrawSetupDurationMs = Math.max(
      0,
      drawSetupDurationMsSum / sampleCount
    );
    const avgEnsureRenderBuffersDurationMs = Math.max(
      0,
      ensureRenderBuffersDurationMsSum / sampleCount
    );
    const avgVertexUploadDurationMs = Math.max(
      0,
      vertexUploadDurationMsSum / sampleCount
    );
    const avgDrawLoopDurationMs = Math.max(
      0,
      drawLoopDurationMsSum / sampleCount
    );
    const avgCommandCount = Math.max(0, commandCountSum / sampleCount);
    const avgUpdateSpriteCommandCount = Math.max(
      0,
      updateSpriteCommandCountSum / sampleCount
    );
    const updateFrameRatio =
      sampleCount > 0
        ? Math.max(0, Math.min(1, updateFrameCountSum / sampleCount))
        : 0;
    const avgUpdateQueueDelayMs =
      updateFrameCountSum > 0
        ? Math.max(0, updateQueueDelayMsSum / updateFrameCountSum)
        : 0;

    return {
      timestampMs,
      windowMs: PERFORMANCE_WINDOW_MS,
      sampleCount,
      fps,
      avgFrameIntervalMs,
      avgCanvasRenderDurationMs: avgSpriteRenderDurationMs,
      avgSpriteRenderDurationMs,
      avgCameraTrackingDurationMs,
      avgWasmComputeDurationMs,
      avgWasmComputeInternalDurationMs,
      avgWasmComputeProjectionDurationMs,
      avgWasmComputeSpriteAnimationDurationMs,
      avgWasmComputeElementAnimationDurationMs,
      avgWasmComputePivotResolveDurationMs,
      avgWasmComputeAutoRotationDurationMs,
      avgWasmComputeCollectEntriesDurationMs,
      avgWasmComputeSortEntriesDurationMs,
      avgWasmComputeWriteOutputDurationMs,
      avgCpuDurationMs,
      wasmComputeRatio,
      avgCommandApplyDurationMs,
      avgCommandApplyCallDurationMs,
      avgCommandApplyJsDurationMs,
      avgCommandApplyWasmDurationMs,
      avgCommandApplyWasmLoopDurationMs,
      avgCommandApplyWasmSyncSlotsDurationMs,
      avgCommandApplyWasmClearDurationMs,
      avgDrawSetupDurationMs,
      avgEnsureRenderBuffersDurationMs,
      avgVertexUploadDurationMs,
      avgDrawLoopDurationMs,
      avgCommandCount,
      avgUpdateSpriteCommandCount,
      updateFrameRatio,
      avgUpdateQueueDelayMs,
      avgActiveElementCount: Math.max(0, activeElementCountSum / sampleCount),
      avgDrawCallCount: Math.max(0, drawCallCountSum / sampleCount),
      avgTextureBindCount: Math.max(0, textureBindCountSum / sampleCount),
      avgSkippedDrawCount: Math.max(0, skippedDrawCountSum / sampleCount),
      avgTextureBindDurationMs: Math.max(
        0,
        textureBindDurationMsSum / sampleCount
      ),
      avgOpacityUniformDurationMs: Math.max(
        0,
        opacityUniformDurationMsSum / sampleCount
      ),
      avgDrawCallDurationMs: Math.max(0, drawCallDurationMsSum / sampleCount),
      avgWasmBufferResizeCount: Math.max(
        0,
        wasmBufferResizeCountSum / sampleCount
      ),
      totalWasmBufferResizeCount,
    };
  };

  const resetPerformanceSnapshot = () => {
    clearSamples();
    pendingWasmBufferResizeCount = 0;
    totalWasmBufferResizeCount = 0;
  };

  return {
    recordWasmBufferResize,
    pushSample,
    getPerformanceSnapshot,
    resetPerformanceSnapshot,
  };
};
