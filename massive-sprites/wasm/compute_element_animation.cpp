// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

#include "compute_internal.h"

///////////////////////////////////////////////////////////////////////////////////////////////

extern "C" double msp_performance_now();

namespace msp_wasm {

/**
 * @brief Returns the current high-resolution timestamp in milliseconds.
 */
static inline scalar_t readNowMs() {
  return static_cast<scalar_t>(msp_performance_now());
}

// Shared SIMD constants for the per-lane interpolation hot path below.
static const v128_t zero = simdSplat(0.0f);
static const v128_t one = simdSplat(1.0f);

bool updateElementAnimationsAndPivots(
    const SpriteInputView &sprite,
    const ElementInputView &element,
    int spriteCount,
    int elementCount,
    scalar_t nowMs,
    std::vector<scalar_t> &pivotXValues,
    std::vector<scalar_t> &pivotYValues,
    std::vector<scalar_t> &pivotZValues,
    std::vector<scalar_t> &pivotLocalXValues,
    std::vector<scalar_t> &pivotLocalYValues,
    std::vector<scalar_t> &basePivotLocalXValues,
    std::vector<scalar_t> &basePivotLocalYValues,
    std::vector<scalar_t> &basePivotWorldXValues,
    std::vector<scalar_t> &basePivotWorldYValues,
    const std::vector<scalar_t> &ownerBaseXValues,
    const std::vector<scalar_t> &ownerBaseYValues,
    const std::vector<scalar_t> &ownerBaseZValues,
    const std::vector<scalar_t> &ownerParentOpacityValues,
    std::vector<unsigned char> &geometryEnabled,
    std::vector<unsigned char> &pivotDirtyFlags,
    const std::vector<TextureInfo> &textures,
    ElementAnimDetailStats *detailStats,
    bool *outHasActiveAnimations) {
  (void)spriteCount;
  (void)textures;
  const v128_t now = simdSplat(nowMs);

  const int simdCount = elementCount - (elementCount % kSimdLanes);
  const int fullMask = (1 << kSimdLanes) - 1;
  const bool detailEnabled = detailStats != nullptr;
  constexpr int kDetailSampleStride = 8;

  bool usesPivotBasis = false;
  bool hasActiveAnimations = false;

  alignas(16) scalar_t shiftAngleBuffer[kSimdLanes];
  alignas(16) scalar_t shiftDistanceBuffer[kSimdLanes];
  alignas(16) scalar_t shiftSinBuffer[kSimdLanes];
  alignas(16) scalar_t shiftCosBuffer[kSimdLanes];
  alignas(16) scalar_t renderOpacityBuffer[kSimdLanes];
  alignas(16) scalar_t originLocationSlotBuffer[kSimdLanes];
  alignas(16) scalar_t baseXBuffer[kSimdLanes];
  alignas(16) scalar_t baseYBuffer[kSimdLanes];
  alignas(16) scalar_t baseZBuffer[kSimdLanes];
  alignas(16) scalar_t pivotDirtyBuffer[kSimdLanes];
  alignas(16) scalar_t hasOriginLocationBuffer[kSimdLanes];

  const int simdBlocks = simdCount / kSimdLanes;
  const bool hasSimd = simdBlocks > 0;
  const scalar_t simdLoopStartMs =
      detailEnabled && hasSimd ? readNowMs() : static_cast<scalar_t>(0.0f);
  for (int block = 0, i = 0; block < simdBlocks; ++block, i += kSimdLanes) {
    const bool sampleDetail =
        detailEnabled && (block % kDetailSampleStride == 0);
    const int sampleWeight = sampleDetail
        ? std::min(kDetailSampleStride, simdBlocks - block)
        : 0;
    const scalar_t sampleWeightMs = static_cast<scalar_t>(sampleWeight);

    const scalar_t ownerStartMs =
        sampleDetail ? readNowMs() : static_cast<scalar_t>(0.0f);
    const v128_t baseXValuesV = wasm_v128_load(ownerBaseXValues.data() + i);
    const v128_t baseYValuesV = wasm_v128_load(ownerBaseYValues.data() + i);
    wasm_v128_store(basePivotWorldXValues.data() + i, baseXValuesV);
    wasm_v128_store(basePivotWorldYValues.data() + i, baseYValuesV);
    wasm_v128_store(baseXBuffer, baseXValuesV);
    wasm_v128_store(baseYBuffer, baseYValuesV);
    const v128_t baseZValuesV = wasm_v128_load(ownerBaseZValues.data() + i);
    wasm_v128_store(baseZBuffer, baseZValuesV);
    const v128_t originLocationSlots = wasm_v128_load(element.originLocationSlotValues + i);
    wasm_v128_store(originLocationSlotBuffer, originLocationSlots);
    for (int lane = 0; lane < kSimdLanes; ++lane) {
      const size_t elementIndex = static_cast<size_t>(i + lane);
      pivotDirtyBuffer[lane] =
          elementIndex < pivotDirtyFlags.size() &&
                  (pivotDirtyFlags[elementIndex] & PIVOT_DIRTY_LOCAL_FLAG) != 0
              ? static_cast<scalar_t>(1.0f)
              : static_cast<scalar_t>(0.0f);
      const int originLocationSlot = static_cast<int>(originLocationSlotBuffer[lane]);
      if (originLocationSlot >= 0 && originLocationSlot < elementCount &&
          originLocationSlot != i + lane) {
        usesPivotBasis = true;
        hasOriginLocationBuffer[lane] = static_cast<scalar_t>(1.0f);
      } else {
        hasOriginLocationBuffer[lane] = static_cast<scalar_t>(0.0f);
      }
    }
    const v128_t parentOpacityV =
        wasm_v128_load(ownerParentOpacityValues.data() + i);
    if (sampleDetail) {
      detailStats->ownerMs += (readNowMs() - ownerStartMs) * sampleWeightMs;
    }

    const scalar_t opacityStartMs =
        sampleDetail ? readNowMs() : static_cast<scalar_t>(0.0f);
    v128_t opacityV = wasm_v128_load(element.opacityValues + i);
    const v128_t opacityDuration = wasm_v128_load(element.opacityDurationValues + i);
    const v128_t opacityHasAnim = simdGt(opacityDuration, zero);
    const v128_t opacityDoAnim = opacityHasAnim;
    v128_t opacityDurationFinal = opacityDuration;
    if (simdBitmask(opacityDoAnim) != 0) {
      const v128_t opacityFrom = wasm_v128_load(element.opacityFromValues + i);
      const v128_t opacityTo = wasm_v128_load(element.opacityToValues + i);
      const v128_t opacityStart = wasm_v128_load(element.opacityStartValues + i);
      const v128_t opacityEasing = wasm_v128_load(element.opacityEasingValues + i);
      const v128_t opacityParam0 =
          wasm_v128_load(element.opacityEasingParam0Values + i);
      const v128_t opacityParam1 =
          wasm_v128_load(element.opacityEasingParam1Values + i);
      const v128_t opacityParam2 =
          wasm_v128_load(element.opacityEasingParam2Values + i);
      const v128_t opacityParam3 =
          wasm_v128_load(element.opacityEasingParam3Values + i);
      const v128_t t = simdDiv(simdSub(now, opacityStart), opacityDuration);
      const v128_t tLe0 = simdLe(t, zero);
      const v128_t tGe1 = simdGe(t, one);
      const v128_t tEased = applyEasingSimd(
          t,
          opacityEasing,
          opacityParam0,
          opacityParam1,
          opacityParam2,
          opacityParam3);
      const v128_t opacityInterp =
          simdAdd(opacityFrom, simdMul(simdSub(opacityTo, opacityFrom), tEased));
      const v128_t opacityTemp =
          wasm_v128_bitselect(opacityTo, opacityInterp, tGe1);
      const v128_t opacityAnim =
          wasm_v128_bitselect(opacityFrom, opacityTemp, tLe0);
      const v128_t opacityFinal =
          wasm_v128_bitselect(opacityAnim, opacityV, opacityDoAnim);
      opacityV = opacityFinal;

      const v128_t opacityDurationCleared =
          wasm_v128_bitselect(zero, opacityDuration, tGe1);
      opacityDurationFinal =
          wasm_v128_bitselect(opacityDurationCleared, opacityDuration, opacityDoAnim);
      wasm_v128_store(element.opacityDurationValues + i, opacityDurationFinal);
    }
    const v128_t opacityClamped = simdMax(zero, simdMin(one, opacityV));
    wasm_v128_store(element.opacityValues + i, opacityClamped);
    if (simdBitmask(simdGt(opacityDurationFinal, zero)) != 0) {
      hasActiveAnimations = true;
    }
    if (sampleDetail) {
      detailStats->opacityMs += (readNowMs() - opacityStartMs) * sampleWeightMs;
    }
    v128_t renderOpacityV = wasm_v128_load(element.renderOpacityValues + i);
    const v128_t renderOpacityDuration =
        wasm_v128_load(element.renderOpacityDurationValues + i);
    const v128_t renderOpacityHasAnim = simdGt(renderOpacityDuration, zero);
    v128_t renderOpacityDurationFinal = renderOpacityDuration;
    if (simdBitmask(renderOpacityHasAnim) != 0) {
      const v128_t renderOpacityFrom =
          wasm_v128_load(element.renderOpacityFromValues + i);
      const v128_t renderOpacityTo =
          wasm_v128_load(element.renderOpacityToValues + i);
      const v128_t renderOpacityStart =
          wasm_v128_load(element.renderOpacityStartValues + i);
      const v128_t renderOpacityEasing =
          wasm_v128_load(element.renderOpacityEasingValues + i);
      const v128_t renderOpacityParam0 =
          wasm_v128_load(element.renderOpacityEasingParam0Values + i);
      const v128_t renderOpacityParam1 =
          wasm_v128_load(element.renderOpacityEasingParam1Values + i);
      const v128_t renderOpacityParam2 =
          wasm_v128_load(element.renderOpacityEasingParam2Values + i);
      const v128_t renderOpacityParam3 =
          wasm_v128_load(element.renderOpacityEasingParam3Values + i);
      const v128_t t =
          simdDiv(simdSub(now, renderOpacityStart), renderOpacityDuration);
      const v128_t tLe0 = simdLe(t, zero);
      const v128_t tGe1 = simdGe(t, one);
      const v128_t tEased = applyEasingSimd(
          t,
          renderOpacityEasing,
          renderOpacityParam0,
          renderOpacityParam1,
          renderOpacityParam2,
          renderOpacityParam3);
      const v128_t renderOpacityInterp = simdAdd(
          renderOpacityFrom,
          simdMul(simdSub(renderOpacityTo, renderOpacityFrom), tEased));
      const v128_t renderOpacityTemp =
          wasm_v128_bitselect(renderOpacityTo, renderOpacityInterp, tGe1);
      const v128_t renderOpacityAnim =
          wasm_v128_bitselect(renderOpacityFrom, renderOpacityTemp, tLe0);
      const v128_t renderOpacityFinal =
          wasm_v128_bitselect(renderOpacityAnim, renderOpacityV, renderOpacityHasAnim);
      renderOpacityV = renderOpacityFinal;

      const v128_t renderOpacityDurationCleared =
          wasm_v128_bitselect(zero, renderOpacityDuration, tGe1);
      renderOpacityDurationFinal = wasm_v128_bitselect(
          renderOpacityDurationCleared,
          renderOpacityDuration,
          renderOpacityHasAnim);
      wasm_v128_store(
          element.renderOpacityDurationValues + i,
          renderOpacityDurationFinal);
    }
    const v128_t renderOpacityClamped =
        simdMax(zero, simdMin(one, renderOpacityV));
    wasm_v128_store(element.renderOpacityValues + i, renderOpacityClamped);
    if (simdBitmask(simdGt(renderOpacityDurationFinal, zero)) != 0) {
      hasActiveAnimations = true;
    }
    const v128_t renderOpacityEnabled = wasm_v128_load(
        element.opacityConfigDurationValues + i);
    const v128_t effectiveOpacity = wasm_v128_bitselect(
        renderOpacityClamped,
        simdMul(parentOpacityV, opacityClamped),
        simdGt(renderOpacityEnabled, zero));
    wasm_v128_store(renderOpacityBuffer, effectiveOpacity);
    for (int lane = 0; lane < kSimdLanes; ++lane) {
      geometryEnabled[static_cast<size_t>(i + lane)] =
          renderOpacityBuffer[lane] > 0.0f ? 1 : 0;
    }

    v128_t leaderlineWidthV = wasm_v128_load(element.leaderlineWidthValues + i);
    const v128_t leaderlineWidthDuration =
        wasm_v128_load(element.leaderlineWidthDurationValues + i);
    const v128_t leaderlineWidthHasAnim = simdGt(leaderlineWidthDuration, zero);
    const v128_t leaderlineWidthDoAnim = leaderlineWidthHasAnim;
    v128_t leaderlineWidthDurationFinal = leaderlineWidthDuration;
    if (simdBitmask(leaderlineWidthDoAnim) != 0) {
      const v128_t leaderlineWidthFrom =
          wasm_v128_load(element.leaderlineWidthFromValues + i);
      const v128_t leaderlineWidthTo =
          wasm_v128_load(element.leaderlineWidthToValues + i);
      const v128_t leaderlineWidthStart =
          wasm_v128_load(element.leaderlineWidthStartValues + i);
      const v128_t leaderlineWidthEasing =
          wasm_v128_load(element.leaderlineWidthEasingValues + i);
      const v128_t leaderlineWidthParam0 =
          wasm_v128_load(element.leaderlineWidthEasingParam0Values + i);
      const v128_t leaderlineWidthParam1 =
          wasm_v128_load(element.leaderlineWidthEasingParam1Values + i);
      const v128_t leaderlineWidthParam2 =
          wasm_v128_load(element.leaderlineWidthEasingParam2Values + i);
      const v128_t leaderlineWidthParam3 =
          wasm_v128_load(element.leaderlineWidthEasingParam3Values + i);
      const v128_t t =
          simdDiv(simdSub(now, leaderlineWidthStart), leaderlineWidthDuration);
      const v128_t tLe0 = simdLe(t, zero);
      const v128_t tGe1 = simdGe(t, one);
      const v128_t tEased = applyEasingSimd(
          t,
          leaderlineWidthEasing,
          leaderlineWidthParam0,
          leaderlineWidthParam1,
          leaderlineWidthParam2,
          leaderlineWidthParam3);
      const v128_t widthInterp = simdAdd(
          leaderlineWidthFrom,
          simdMul(simdSub(leaderlineWidthTo, leaderlineWidthFrom), tEased));
      const v128_t widthTemp =
          wasm_v128_bitselect(leaderlineWidthTo, widthInterp, tGe1);
      const v128_t widthAnim =
          wasm_v128_bitselect(leaderlineWidthFrom, widthTemp, tLe0);
      const v128_t widthFinal =
          wasm_v128_bitselect(widthAnim, leaderlineWidthV, leaderlineWidthDoAnim);
      leaderlineWidthV = widthFinal;

      const v128_t widthDurationCleared =
          wasm_v128_bitselect(zero, leaderlineWidthDuration, tGe1);
      leaderlineWidthDurationFinal =
          wasm_v128_bitselect(widthDurationCleared, leaderlineWidthDuration,
                              leaderlineWidthDoAnim);
      wasm_v128_store(
          element.leaderlineWidthDurationValues + i, leaderlineWidthDurationFinal);
    }
    const v128_t leaderlineWidthClamped =
        simdMax(zero, leaderlineWidthV);
    wasm_v128_store(element.leaderlineWidthValues + i, leaderlineWidthClamped);
    if (simdBitmask(simdGt(leaderlineWidthDurationFinal, zero)) != 0) {
      hasActiveAnimations = true;
    }

    const scalar_t rotationStartMs =
        sampleDetail ? readNowMs() : static_cast<scalar_t>(0.0f);
    v128_t rotateDegV = wasm_v128_load(element.rotateDegValues + i);
    const v128_t rotationDuration = wasm_v128_load(element.rotationDurationValues + i);
    const v128_t rotationHasAnim = simdGt(rotationDuration, zero);
    const v128_t rotationDoAnim = rotationHasAnim;
    v128_t rotationDurationFinal = rotationDuration;
    if (simdBitmask(rotationDoAnim) != 0) {
      const v128_t rotationFrom = wasm_v128_load(element.rotationFromValues + i);
      const v128_t rotationTo = wasm_v128_load(element.rotationToValues + i);
      const v128_t rotationStart = wasm_v128_load(element.rotationStartValues + i);
      const v128_t rotationEasing = wasm_v128_load(element.rotationEasingValues + i);
      const v128_t rotationParam0 =
          wasm_v128_load(element.rotationEasingParam0Values + i);
      const v128_t rotationParam1 =
          wasm_v128_load(element.rotationEasingParam1Values + i);
      const v128_t rotationParam2 =
          wasm_v128_load(element.rotationEasingParam2Values + i);
      const v128_t rotationParam3 =
          wasm_v128_load(element.rotationEasingParam3Values + i);
      const v128_t t = simdDiv(simdSub(now, rotationStart), rotationDuration);
      const v128_t tLe0 = simdLe(t, zero);
      const v128_t tGe1 = simdGe(t, one);
      const v128_t tEased = applyEasingSimd(
          t,
          rotationEasing,
          rotationParam0,
          rotationParam1,
          rotationParam2,
          rotationParam3);
      const v128_t rotateDegDelta =
          wrapAngleDeltaSimd(simdSub(rotationTo, rotationFrom));
      const v128_t rotateDegInterp =
          simdAdd(rotationFrom, simdMul(rotateDegDelta, tEased));
      const v128_t rotateDegTemp =
          wasm_v128_bitselect(rotationTo, rotateDegInterp, tGe1);
      const v128_t rotateDegAnim =
          wasm_v128_bitselect(rotationFrom, rotateDegTemp, tLe0);
      const v128_t rotateDegFinal =
          wasm_v128_bitselect(rotateDegAnim, rotateDegV, rotationDoAnim);
      wasm_v128_store(element.rotateDegValues + i, rotateDegFinal);
      rotateDegV = rotateDegFinal;

      const v128_t rotationDurationCleared =
          wasm_v128_bitselect(zero, rotationDuration, tGe1);
      rotationDurationFinal =
          wasm_v128_bitselect(
              rotationDurationCleared,
              rotationDuration,
              rotationDoAnim);
      wasm_v128_store(element.rotationDurationValues + i, rotationDurationFinal);
    }
    if (simdBitmask(simdGt(rotationDurationFinal, zero)) != 0) {
      hasActiveAnimations = true;
    }
    if (sampleDetail) {
      detailStats->rotationMs += (readNowMs() - rotationStartMs) * sampleWeightMs;
    }

    const scalar_t scaleStartMs =
        sampleDetail ? readNowMs() : static_cast<scalar_t>(0.0f);
    v128_t scaleV = wasm_v128_load(element.scaleValues + i);
    const v128_t scaleDuration = wasm_v128_load(element.scaleDurationValues + i);
    const v128_t scaleHasAnim = simdGt(scaleDuration, zero);
    const v128_t scaleDoAnim = scaleHasAnim;
    v128_t scaleDurationFinal = scaleDuration;
    if (simdBitmask(scaleDoAnim) != 0) {
      const v128_t scaleFrom = wasm_v128_load(element.scaleFromValues + i);
      const v128_t scaleTo = wasm_v128_load(element.scaleToValues + i);
      const v128_t scaleStart = wasm_v128_load(element.scaleStartValues + i);
      const v128_t scaleEasing = wasm_v128_load(element.scaleEasingValues + i);
      const v128_t scaleParam0 =
          wasm_v128_load(element.scaleEasingParam0Values + i);
      const v128_t scaleParam1 =
          wasm_v128_load(element.scaleEasingParam1Values + i);
      const v128_t scaleParam2 =
          wasm_v128_load(element.scaleEasingParam2Values + i);
      const v128_t scaleParam3 =
          wasm_v128_load(element.scaleEasingParam3Values + i);
      const v128_t t = simdDiv(simdSub(now, scaleStart), scaleDuration);
      const v128_t tLe0 = simdLe(t, zero);
      const v128_t tGe1 = simdGe(t, one);
      const v128_t tEased = applyEasingSimd(
          t,
          scaleEasing,
          scaleParam0,
          scaleParam1,
          scaleParam2,
          scaleParam3);
      const v128_t scaleInterp =
          simdAdd(scaleFrom, simdMul(simdSub(scaleTo, scaleFrom), tEased));
      const v128_t scaleTemp =
          wasm_v128_bitselect(scaleTo, scaleInterp, tGe1);
      const v128_t scaleAnim =
          wasm_v128_bitselect(scaleFrom, scaleTemp, tLe0);
      const v128_t scaleFinal =
          wasm_v128_bitselect(scaleAnim, scaleV, scaleDoAnim);
      wasm_v128_store(element.scaleValues + i, scaleFinal);
      scaleV = scaleFinal;

      const v128_t scaleDurationCleared =
          wasm_v128_bitselect(zero, scaleDuration, tGe1);
      scaleDurationFinal =
          wasm_v128_bitselect(scaleDurationCleared, scaleDuration, scaleDoAnim);
      wasm_v128_store(element.scaleDurationValues + i, scaleDurationFinal);
    }
    if (simdBitmask(simdGt(scaleDurationFinal, zero)) != 0) {
      hasActiveAnimations = true;
    }
    if (sampleDetail) {
      detailStats->scaleMs += (readNowMs() - scaleStartMs) * sampleWeightMs;
    }

    const scalar_t anchorStartMs =
        sampleDetail ? readNowMs() : static_cast<scalar_t>(0.0f);
    v128_t anchorXV = wasm_v128_load(element.anchorXValues + i);
    const v128_t anchorXDuration =
        wasm_v128_load(element.anchorXDurationValues + i);
    const v128_t anchorXHasAnim = simdGt(anchorXDuration, zero);
    const v128_t anchorXDoAnim = anchorXHasAnim;
    v128_t anchorXDurationFinal = anchorXDuration;
    if (simdBitmask(anchorXDoAnim) != 0) {
      const v128_t anchorXFrom = wasm_v128_load(element.anchorXFromValues + i);
      const v128_t anchorXTo = wasm_v128_load(element.anchorXToValues + i);
      const v128_t anchorXStart = wasm_v128_load(element.anchorXStartValues + i);
      const v128_t anchorXEasing = wasm_v128_load(element.anchorXEasingValues + i);
      const v128_t anchorXParam0 =
          wasm_v128_load(element.anchorXEasingParam0Values + i);
      const v128_t anchorXParam1 =
          wasm_v128_load(element.anchorXEasingParam1Values + i);
      const v128_t anchorXParam2 =
          wasm_v128_load(element.anchorXEasingParam2Values + i);
      const v128_t anchorXParam3 =
          wasm_v128_load(element.anchorXEasingParam3Values + i);
      const v128_t t = simdDiv(simdSub(now, anchorXStart), anchorXDuration);
      const v128_t tLe0 = simdLe(t, zero);
      const v128_t tGe1 = simdGe(t, one);
      const v128_t tEased = applyEasingSimd(
          t,
          anchorXEasing,
          anchorXParam0,
          anchorXParam1,
          anchorXParam2,
          anchorXParam3);
      const v128_t anchorXInterp =
          simdAdd(anchorXFrom, simdMul(simdSub(anchorXTo, anchorXFrom), tEased));
      const v128_t anchorXTemp =
          wasm_v128_bitselect(anchorXTo, anchorXInterp, tGe1);
      const v128_t anchorXAnim =
          wasm_v128_bitselect(anchorXFrom, anchorXTemp, tLe0);
      const v128_t anchorXFinal =
          wasm_v128_bitselect(anchorXAnim, anchorXV, anchorXDoAnim);
      wasm_v128_store(element.anchorXValues + i, anchorXFinal);
      anchorXV = anchorXFinal;

      const v128_t anchorXDurationCleared =
          wasm_v128_bitselect(zero, anchorXDuration, tGe1);
      anchorXDurationFinal =
          wasm_v128_bitselect(anchorXDurationCleared, anchorXDuration, anchorXDoAnim);
      wasm_v128_store(element.anchorXDurationValues + i, anchorXDurationFinal);
    }

    v128_t anchorYV = wasm_v128_load(element.anchorYValues + i);
    const v128_t anchorYDuration =
        wasm_v128_load(element.anchorYDurationValues + i);
    const v128_t anchorYHasAnim = simdGt(anchorYDuration, zero);
    const v128_t anchorYDoAnim = anchorYHasAnim;
    v128_t anchorYDurationFinal = anchorYDuration;
    if (simdBitmask(anchorYDoAnim) != 0) {
      const v128_t anchorYFrom = wasm_v128_load(element.anchorYFromValues + i);
      const v128_t anchorYTo = wasm_v128_load(element.anchorYToValues + i);
      const v128_t anchorYStart = wasm_v128_load(element.anchorYStartValues + i);
      const v128_t anchorYEasing = wasm_v128_load(element.anchorYEasingValues + i);
      const v128_t anchorYParam0 =
          wasm_v128_load(element.anchorYEasingParam0Values + i);
      const v128_t anchorYParam1 =
          wasm_v128_load(element.anchorYEasingParam1Values + i);
      const v128_t anchorYParam2 =
          wasm_v128_load(element.anchorYEasingParam2Values + i);
      const v128_t anchorYParam3 =
          wasm_v128_load(element.anchorYEasingParam3Values + i);
      const v128_t t = simdDiv(simdSub(now, anchorYStart), anchorYDuration);
      const v128_t tLe0 = simdLe(t, zero);
      const v128_t tGe1 = simdGe(t, one);
      const v128_t tEased = applyEasingSimd(
          t,
          anchorYEasing,
          anchorYParam0,
          anchorYParam1,
          anchorYParam2,
          anchorYParam3);
      const v128_t anchorYInterp =
          simdAdd(anchorYFrom, simdMul(simdSub(anchorYTo, anchorYFrom), tEased));
      const v128_t anchorYTemp =
          wasm_v128_bitselect(anchorYTo, anchorYInterp, tGe1);
      const v128_t anchorYAnim =
          wasm_v128_bitselect(anchorYFrom, anchorYTemp, tLe0);
      const v128_t anchorYFinal =
          wasm_v128_bitselect(anchorYAnim, anchorYV, anchorYDoAnim);
      wasm_v128_store(element.anchorYValues + i, anchorYFinal);
      anchorYV = anchorYFinal;

      const v128_t anchorYDurationCleared =
          wasm_v128_bitselect(zero, anchorYDuration, tGe1);
      anchorYDurationFinal =
          wasm_v128_bitselect(anchorYDurationCleared, anchorYDuration, anchorYDoAnim);
      wasm_v128_store(element.anchorYDurationValues + i, anchorYDurationFinal);
    }
    if (simdBitmask(simdGt(anchorXDurationFinal, zero)) != 0 ||
        simdBitmask(simdGt(anchorYDurationFinal, zero)) != 0) {
      hasActiveAnimations = true;
    }
    if (sampleDetail) {
      detailStats->anchorMs += (readNowMs() - anchorStartMs) * sampleWeightMs;
    }

    const scalar_t shiftStartMs =
        sampleDetail ? readNowMs() : static_cast<scalar_t>(0.0f);
    v128_t shiftDistanceV = wasm_v128_load(element.shiftDistanceValues + i);
    const v128_t shiftDistanceDuration =
        wasm_v128_load(element.shiftDistanceDurationValues + i);
    const v128_t shiftDistanceHasAnim = simdGt(shiftDistanceDuration, zero);
    const v128_t shiftDistanceDoAnim = shiftDistanceHasAnim;
    v128_t shiftDistanceDurationFinal = shiftDistanceDuration;
    if (simdBitmask(shiftDistanceDoAnim) != 0) {
      const v128_t shiftDistanceFrom =
          wasm_v128_load(element.shiftDistanceFromValues + i);
      const v128_t shiftDistanceTo = wasm_v128_load(element.shiftDistanceToValues + i);
      const v128_t shiftDistanceStart =
          wasm_v128_load(element.shiftDistanceStartValues + i);
      const v128_t shiftDistanceEasing =
          wasm_v128_load(element.shiftDistanceEasingValues + i);
      const v128_t shiftDistanceParam0 =
          wasm_v128_load(element.shiftDistanceEasingParam0Values + i);
      const v128_t shiftDistanceParam1 =
          wasm_v128_load(element.shiftDistanceEasingParam1Values + i);
      const v128_t shiftDistanceParam2 =
          wasm_v128_load(element.shiftDistanceEasingParam2Values + i);
      const v128_t shiftDistanceParam3 =
          wasm_v128_load(element.shiftDistanceEasingParam3Values + i);
      const v128_t t =
          simdDiv(simdSub(now, shiftDistanceStart), shiftDistanceDuration);
      const v128_t tLe0 = simdLe(t, zero);
      const v128_t tGe1 = simdGe(t, one);
      const v128_t tEased = applyEasingSimd(
          t,
          shiftDistanceEasing,
          shiftDistanceParam0,
          shiftDistanceParam1,
          shiftDistanceParam2,
          shiftDistanceParam3);
      const v128_t shiftDistanceInterp = simdAdd(
          shiftDistanceFrom,
          simdMul(simdSub(shiftDistanceTo, shiftDistanceFrom), tEased));
      const v128_t shiftDistanceTemp =
          wasm_v128_bitselect(shiftDistanceTo, shiftDistanceInterp, tGe1);
      const v128_t shiftDistanceAnim =
          wasm_v128_bitselect(shiftDistanceFrom, shiftDistanceTemp, tLe0);
      const v128_t shiftDistanceFinal =
          wasm_v128_bitselect(shiftDistanceAnim, shiftDistanceV, shiftDistanceDoAnim);
      wasm_v128_store(element.shiftDistanceValues + i, shiftDistanceFinal);
      shiftDistanceV = shiftDistanceFinal;

      const v128_t shiftDistanceDurationCleared =
          wasm_v128_bitselect(zero, shiftDistanceDuration, tGe1);
      shiftDistanceDurationFinal = wasm_v128_bitselect(
          shiftDistanceDurationCleared,
          shiftDistanceDuration,
          shiftDistanceDoAnim);
      wasm_v128_store(element.shiftDistanceDurationValues + i, shiftDistanceDurationFinal);
    }

    v128_t shiftAngleDegV = wasm_v128_load(element.shiftAngleDegValues + i);
    const v128_t shiftAngleDegDuration =
        wasm_v128_load(element.shiftAngleDegDurationValues + i);
    const v128_t shiftAngleDegHasAnim = simdGt(shiftAngleDegDuration, zero);
    const v128_t shiftAngleDegDoAnim = shiftAngleDegHasAnim;
    v128_t shiftAngleDegDurationFinal = shiftAngleDegDuration;
    if (simdBitmask(shiftAngleDegDoAnim) != 0) {
      const v128_t shiftAngleDegFrom =
          wasm_v128_load(element.shiftAngleDegFromValues + i);
      const v128_t shiftAngleDegTo =
          wasm_v128_load(element.shiftAngleDegToValues + i);
      const v128_t shiftAngleDegStart =
          wasm_v128_load(element.shiftAngleDegStartValues + i);
      const v128_t shiftAngleDegEasing =
          wasm_v128_load(element.shiftAngleDegEasingValues + i);
      const v128_t shiftAngleDegParam0 =
          wasm_v128_load(element.shiftAngleDegEasingParam0Values + i);
      const v128_t shiftAngleDegParam1 =
          wasm_v128_load(element.shiftAngleDegEasingParam1Values + i);
      const v128_t shiftAngleDegParam2 =
          wasm_v128_load(element.shiftAngleDegEasingParam2Values + i);
      const v128_t shiftAngleDegParam3 =
          wasm_v128_load(element.shiftAngleDegEasingParam3Values + i);
      const v128_t t =
          simdDiv(simdSub(now, shiftAngleDegStart), shiftAngleDegDuration);
      const v128_t tLe0 = simdLe(t, zero);
      const v128_t tGe1 = simdGe(t, one);
      const v128_t tEased = applyEasingSimd(
          t,
          shiftAngleDegEasing,
          shiftAngleDegParam0,
          shiftAngleDegParam1,
          shiftAngleDegParam2,
          shiftAngleDegParam3);
      const v128_t shiftAngleDegDelta =
          wrapAngleDeltaSimd(simdSub(shiftAngleDegTo, shiftAngleDegFrom));
      const v128_t shiftAngleDegInterp =
          simdAdd(shiftAngleDegFrom, simdMul(shiftAngleDegDelta, tEased));
      const v128_t shiftAngleDegTemp =
          wasm_v128_bitselect(shiftAngleDegTo, shiftAngleDegInterp, tGe1);
      const v128_t shiftAngleDegAnim =
          wasm_v128_bitselect(shiftAngleDegFrom, shiftAngleDegTemp, tLe0);
      const v128_t shiftAngleDegFinal =
          wasm_v128_bitselect(shiftAngleDegAnim, shiftAngleDegV, shiftAngleDegDoAnim);
      wasm_v128_store(element.shiftAngleDegValues + i, shiftAngleDegFinal);
      shiftAngleDegV = shiftAngleDegFinal;

      const v128_t shiftAngleDegDurationCleared =
          wasm_v128_bitselect(zero, shiftAngleDegDuration, tGe1);
      shiftAngleDegDurationFinal = wasm_v128_bitselect(
          shiftAngleDegDurationCleared,
          shiftAngleDegDuration,
          shiftAngleDegDoAnim);
      wasm_v128_store(element.shiftAngleDegDurationValues + i, shiftAngleDegDurationFinal);
    }
    if (simdBitmask(simdGt(shiftDistanceDurationFinal, zero)) != 0 ||
        simdBitmask(simdGt(shiftAngleDegDurationFinal, zero)) != 0) {
      hasActiveAnimations = true;
    }
    if (sampleDetail) {
      detailStats->shiftMs += (readNowMs() - shiftStartMs) * sampleWeightMs;
    }

    const scalar_t pivotStartMs =
        sampleDetail ? readNowMs() : static_cast<scalar_t>(0.0f);
    const v128_t pivotDirtyV = wasm_v128_load(pivotDirtyBuffer);
    const v128_t pivotDirtyMask = simdGt(pivotDirtyV, zero);
    const v128_t shiftDistanceActive = simdGt(shiftDistanceDuration, zero);
    const v128_t shiftAngleActive = simdGt(shiftAngleDegDuration, zero);
    const v128_t shiftActiveMask = wasm_v128_or(shiftDistanceActive, shiftAngleActive);
    const v128_t pivotUpdateMask =
        wasm_v128_or(pivotDirtyMask, shiftActiveMask);

    v128_t localPivotXV = wasm_v128_load(basePivotLocalXValues.data() + i);
    v128_t localPivotYV = wasm_v128_load(basePivotLocalYValues.data() + i);
    if (simdBitmask(pivotUpdateMask) != 0) {
      // NOTE:
      //  Previous low-order sin/cos approximation caused a radius drift near 180deg,
      //  so orbit offsets looked farther at the bottom than at 0/90/270deg.
      //  To keep the SoA + SIMD layout while fixing the drift, we only evaluate
      //  trig per-lane and then continue SIMD math.
      //
      //  Alternative 2: keep approximation but normalize (sin, cos) by vector length.
      //  Alternative 3: replace approximation with higher-accuracy range reduction +
      //  minimax polynomial and keep full SIMD trig.
      for (int lane = 0; lane < kSimdLanes; ++lane) {
        shiftSinBuffer[lane] = 0.0f;
        shiftCosBuffer[lane] = 1.0f;
      }
      const v128_t shiftDistanceZeroMask = simdEq(shiftDistanceV, zero);
      if (simdBitmask(shiftDistanceZeroMask) != fullMask) {
        // API angle convention: 0deg is +Y (up), positive is clockwise.
        const v128_t shiftAngle = simdMul(shiftAngleDegV, simdSplat(kDegToRad));
        wasm_v128_store(shiftAngleBuffer, shiftAngle);
        wasm_v128_store(shiftDistanceBuffer, shiftDistanceV);
        for (int lane = 0; lane < kSimdLanes; ++lane) {
          if (shiftDistanceBuffer[lane] != 0.0f) {
            computeSinCos(
                shiftAngleBuffer[lane], shiftSinBuffer[lane], shiftCosBuffer[lane]);
          }
        }
      }

      const v128_t shiftSin = wasm_v128_load(shiftSinBuffer);
      const v128_t shiftCos = wasm_v128_load(shiftCosBuffer);
      const v128_t deltaXV = simdMul(shiftDistanceV, shiftSin);
      const v128_t deltaYV = simdMul(shiftDistanceV, shiftCos);

      localPivotXV = wasm_v128_bitselect(deltaXV, localPivotXV, pivotUpdateMask);
      localPivotYV = wasm_v128_bitselect(deltaYV, localPivotYV, pivotUpdateMask);
      wasm_v128_store(basePivotLocalXValues.data() + i, localPivotXV);
      wasm_v128_store(basePivotLocalYValues.data() + i, localPivotYV);

      const int pivotUpdateBits = simdBitmask(pivotUpdateMask);
      for (int lane = 0; lane < kSimdLanes; ++lane) {
        if ((pivotUpdateBits & (1 << lane)) == 0) {
          continue;
        }
        const size_t elementIndex = static_cast<size_t>(i + lane);
        if (elementIndex >= pivotDirtyFlags.size()) {
          continue;
        }
        unsigned char flags = pivotDirtyFlags[elementIndex];
        flags = static_cast<unsigned char>(
            (flags & ~PIVOT_DIRTY_LOCAL_FLAG) | PIVOT_DIRTY_RESOLVE_FLAG);
        pivotDirtyFlags[elementIndex] = flags;
      }
    }
    wasm_v128_store(pivotLocalXValues.data() + i, localPivotXV);
    wasm_v128_store(pivotLocalYValues.data() + i, localPivotYV);
    if (sampleDetail) {
      detailStats->pivotMs += (readNowMs() - pivotStartMs) * sampleWeightMs;
    }

    const scalar_t mergeStartMs =
        sampleDetail ? readNowMs() : static_cast<scalar_t>(0.0f);
    const v128_t baseXV = wasm_v128_load(baseXBuffer);
    const v128_t baseYV = wasm_v128_load(baseYBuffer);
    const v128_t baseZV = wasm_v128_load(baseZBuffer);
    const v128_t pivotXV = simdAdd(localPivotXV, baseXV);
    const v128_t pivotYV = simdAdd(localPivotYV, baseYV);
    const v128_t pivotZV = baseZV;
    const v128_t hasOriginLocationV = wasm_v128_load(hasOriginLocationBuffer);
    const v128_t noOriginLocationMask = simdEq(hasOriginLocationV, zero);
    const int noBasisBits = simdBitmask(noOriginLocationMask);
    if (noBasisBits == fullMask) {
      wasm_v128_store(pivotXValues.data() + i, pivotXV);
      wasm_v128_store(pivotYValues.data() + i, pivotYV);
      wasm_v128_store(pivotZValues.data() + i, pivotZV);
    } else if (noBasisBits != 0) {
      const v128_t prevPivotXV = wasm_v128_load(pivotXValues.data() + i);
      const v128_t prevPivotYV = wasm_v128_load(pivotYValues.data() + i);
      const v128_t prevPivotZV = wasm_v128_load(pivotZValues.data() + i);
      const v128_t mergedPivotXV = wasm_v128_bitselect(pivotXV, prevPivotXV, noOriginLocationMask);
      const v128_t mergedPivotYV = wasm_v128_bitselect(pivotYV, prevPivotYV, noOriginLocationMask);
      const v128_t mergedPivotZV = wasm_v128_bitselect(pivotZV, prevPivotZV, noOriginLocationMask);
      wasm_v128_store(pivotXValues.data() + i, mergedPivotXV);
      wasm_v128_store(pivotYValues.data() + i, mergedPivotYV);
      wasm_v128_store(pivotZValues.data() + i, mergedPivotZV);
    }
    if (sampleDetail) {
      detailStats->mergeMs += (readNowMs() - mergeStartMs) * sampleWeightMs;
    }
  }
  if (detailEnabled && hasSimd) {
    detailStats->simdLoopMs += readNowMs() - simdLoopStartMs;
  }

  const bool hasScalar = simdCount < elementCount;
  const scalar_t scalarStartMs =
      detailEnabled && hasScalar ? readNowMs() : static_cast<scalar_t>(0.0f);
  for (int i = simdCount; i < elementCount; ++i) {
    scalar_t parentOpacity = ownerParentOpacityValues[static_cast<size_t>(i)];
    scalar_t baseX = ownerBaseXValues[static_cast<size_t>(i)];
    scalar_t baseY = ownerBaseYValues[static_cast<size_t>(i)];
    const scalar_t baseZ = ownerBaseZValues[static_cast<size_t>(i)];
    const int originLocationSlot = static_cast<int>(element.originLocationSlotValues[i]);
    const bool hasOriginLocation = originLocationSlot >= 0 && originLocationSlot < elementCount && originLocationSlot != i;
    if (hasOriginLocation) {
      usesPivotBasis = true;
    }
    if (static_cast<size_t>(i) < basePivotWorldXValues.size()) {
      basePivotWorldXValues[static_cast<size_t>(i)] = baseX;
      basePivotWorldYValues[static_cast<size_t>(i)] = baseY;
    }
    parentOpacity = std::max(
        static_cast<scalar_t>(0.0f),
        std::min(static_cast<scalar_t>(1.0f), parentOpacity));

    scalar_t opacity = element.opacityValues[i];
    if (element.opacityDurationValues[i] > 0.0f) {
      const scalar_t fromValue = element.opacityFromValues[i];
      const scalar_t toValue = element.opacityToValues[i];
      const scalar_t startMs = element.opacityStartValues[i];
      const scalar_t durationMs = element.opacityDurationValues[i];
      const scalar_t t = (nowMs - startMs) / durationMs;
      if (t <= 0.0f) {
        opacity = fromValue;
      } else if (t >= 1.0f) {
        opacity = toValue;
        element.opacityDurationValues[i] = 0.0f;
      } else {
        const scalar_t tEased = applyEasingScalar(
            t,
            element.opacityEasingValues[i],
            element.opacityEasingParam0Values[i],
            element.opacityEasingParam1Values[i],
            element.opacityEasingParam2Values[i],
            element.opacityEasingParam3Values[i]);
        opacity = fromValue + (toValue - fromValue) * tEased;
      }
    }
    opacity = std::max(
        static_cast<scalar_t>(0.0f),
        std::min(static_cast<scalar_t>(1.0f), opacity));
    element.opacityValues[i] = opacity;
    scalar_t renderOpacity = element.renderOpacityValues[i];
    if (element.renderOpacityDurationValues[i] > 0.0f) {
      const scalar_t fromValue = element.renderOpacityFromValues[i];
      const scalar_t toValue = element.renderOpacityToValues[i];
      const scalar_t startMs = element.renderOpacityStartValues[i];
      const scalar_t durationMs = element.renderOpacityDurationValues[i];
      const scalar_t t = (nowMs - startMs) / durationMs;
      if (t <= 0.0f) {
        renderOpacity = fromValue;
      } else if (t >= 1.0f) {
        renderOpacity = toValue;
        element.renderOpacityDurationValues[i] = 0.0f;
      } else {
        const scalar_t tEased = applyEasingScalar(
            t,
            element.renderOpacityEasingValues[i],
            element.renderOpacityEasingParam0Values[i],
            element.renderOpacityEasingParam1Values[i],
            element.renderOpacityEasingParam2Values[i],
            element.renderOpacityEasingParam3Values[i]);
        renderOpacity = fromValue + (toValue - fromValue) * tEased;
      }
    }
    renderOpacity = std::max(
        static_cast<scalar_t>(0.0f),
        std::min(static_cast<scalar_t>(1.0f), renderOpacity));
    element.renderOpacityValues[i] = renderOpacity;
    const scalar_t effectiveOpacity = usesElementRenderOpacity(element, i)
        ? renderOpacity
        : std::max(
              static_cast<scalar_t>(0.0f),
              std::min(static_cast<scalar_t>(1.0f), parentOpacity * opacity));
    geometryEnabled[static_cast<size_t>(i)] =
        effectiveOpacity > static_cast<scalar_t>(0.0f) ? 1 : 0;

    scalar_t leaderlineWidth = element.leaderlineWidthValues[i];
    if (element.leaderlineWidthDurationValues[i] > 0.0f) {
      const scalar_t fromValue = element.leaderlineWidthFromValues[i];
      const scalar_t toValue = element.leaderlineWidthToValues[i];
      const scalar_t startMs = element.leaderlineWidthStartValues[i];
      const scalar_t durationMs = element.leaderlineWidthDurationValues[i];
      const scalar_t t = (nowMs - startMs) / durationMs;
      if (t <= 0.0f) {
        leaderlineWidth = fromValue;
      } else if (t >= 1.0f) {
        leaderlineWidth = toValue;
        element.leaderlineWidthDurationValues[i] = 0.0f;
      } else {
        const scalar_t tEased = applyEasingScalar(
            t,
            element.leaderlineWidthEasingValues[i],
            element.leaderlineWidthEasingParam0Values[i],
            element.leaderlineWidthEasingParam1Values[i],
            element.leaderlineWidthEasingParam2Values[i],
            element.leaderlineWidthEasingParam3Values[i]);
        leaderlineWidth = fromValue + (toValue - fromValue) * tEased;
      }
      element.leaderlineWidthValues[i] = leaderlineWidth;
    }
    if (leaderlineWidth < static_cast<scalar_t>(0.0f)) {
      leaderlineWidth = static_cast<scalar_t>(0.0f);
      element.leaderlineWidthValues[i] = leaderlineWidth;
    }

    scalar_t rotateDeg = element.rotateDegValues[i];
    if (element.rotationDurationValues[i] > 0.0f) {
      const scalar_t fromValue = element.rotationFromValues[i];
      const scalar_t toValue = element.rotationToValues[i];
      const scalar_t startMs = element.rotationStartValues[i];
      const scalar_t durationMs = element.rotationDurationValues[i];
      const scalar_t t = (nowMs - startMs) / durationMs;
      if (t <= 0.0f) {
        rotateDeg = fromValue;
      } else if (t >= 1.0f) {
        rotateDeg = toValue;
        element.rotationDurationValues[i] = 0.0f;
      } else {
        const scalar_t tEased = applyEasingScalar(
            t,
            element.rotationEasingValues[i],
            element.rotationEasingParam0Values[i],
            element.rotationEasingParam1Values[i],
            element.rotationEasingParam2Values[i],
            element.rotationEasingParam3Values[i]);
        rotateDeg = fromValue + wrapAngleDelta(toValue - fromValue) * tEased;
      }
      element.rotateDegValues[i] = rotateDeg;
    }

    scalar_t scale = element.scaleValues[i];
    if (element.scaleDurationValues[i] > 0.0f) {
      const scalar_t fromValue = element.scaleFromValues[i];
      const scalar_t toValue = element.scaleToValues[i];
      const scalar_t startMs = element.scaleStartValues[i];
      const scalar_t durationMs = element.scaleDurationValues[i];
      const scalar_t t = (nowMs - startMs) / durationMs;
      if (t <= 0.0f) {
        scale = fromValue;
      } else if (t >= 1.0f) {
        scale = toValue;
        element.scaleDurationValues[i] = 0.0f;
      } else {
        const scalar_t tEased = applyEasingScalar(
            t,
            element.scaleEasingValues[i],
            element.scaleEasingParam0Values[i],
            element.scaleEasingParam1Values[i],
            element.scaleEasingParam2Values[i],
            element.scaleEasingParam3Values[i]);
        scale = fromValue + (toValue - fromValue) * tEased;
      }
      element.scaleValues[i] = scale;
    }

    scalar_t anchorX = element.anchorXValues[i];
    if (element.anchorXDurationValues[i] > 0.0f) {
      const scalar_t fromValue = element.anchorXFromValues[i];
      const scalar_t toValue = element.anchorXToValues[i];
      const scalar_t startMs = element.anchorXStartValues[i];
      const scalar_t durationMs = element.anchorXDurationValues[i];
      const scalar_t t = (nowMs - startMs) / durationMs;
      if (t <= 0.0f) {
        anchorX = fromValue;
      } else if (t >= 1.0f) {
        anchorX = toValue;
        element.anchorXDurationValues[i] = 0.0f;
      } else {
        const scalar_t tEased = applyEasingScalar(
            t,
            element.anchorXEasingValues[i],
            element.anchorXEasingParam0Values[i],
            element.anchorXEasingParam1Values[i],
            element.anchorXEasingParam2Values[i],
            element.anchorXEasingParam3Values[i]);
        anchorX = fromValue + (toValue - fromValue) * tEased;
      }
      element.anchorXValues[i] = anchorX;
    }

    scalar_t anchorY = element.anchorYValues[i];
    if (element.anchorYDurationValues[i] > 0.0f) {
      const scalar_t fromValue = element.anchorYFromValues[i];
      const scalar_t toValue = element.anchorYToValues[i];
      const scalar_t startMs = element.anchorYStartValues[i];
      const scalar_t durationMs = element.anchorYDurationValues[i];
      const scalar_t t = (nowMs - startMs) / durationMs;
      if (t <= 0.0f) {
        anchorY = fromValue;
      } else if (t >= 1.0f) {
        anchorY = toValue;
        element.anchorYDurationValues[i] = 0.0f;
      } else {
        const scalar_t tEased = applyEasingScalar(
            t,
            element.anchorYEasingValues[i],
            element.anchorYEasingParam0Values[i],
            element.anchorYEasingParam1Values[i],
            element.anchorYEasingParam2Values[i],
            element.anchorYEasingParam3Values[i]);
        anchorY = fromValue + (toValue - fromValue) * tEased;
      }
      element.anchorYValues[i] = anchorY;
    }

    scalar_t shiftDistance = element.shiftDistanceValues[i];
    if (element.shiftDistanceDurationValues[i] > 0.0f) {
      const scalar_t fromValue = element.shiftDistanceFromValues[i];
      const scalar_t toValue = element.shiftDistanceToValues[i];
      const scalar_t startMs = element.shiftDistanceStartValues[i];
      const scalar_t durationMs = element.shiftDistanceDurationValues[i];
      const scalar_t t = (nowMs - startMs) / durationMs;
      if (t <= 0.0f) {
        shiftDistance = fromValue;
      } else if (t >= 1.0f) {
        shiftDistance = toValue;
        element.shiftDistanceDurationValues[i] = 0.0f;
      } else {
        const scalar_t tEased = applyEasingScalar(
            t,
            element.shiftDistanceEasingValues[i],
            element.shiftDistanceEasingParam0Values[i],
            element.shiftDistanceEasingParam1Values[i],
            element.shiftDistanceEasingParam2Values[i],
            element.shiftDistanceEasingParam3Values[i]);
        shiftDistance = fromValue + (toValue - fromValue) * tEased;
      }
      element.shiftDistanceValues[i] = shiftDistance;
    }

    scalar_t shiftAngleDeg = element.shiftAngleDegValues[i];
    if (element.shiftAngleDegDurationValues[i] > 0.0f) {
      const scalar_t fromValue = element.shiftAngleDegFromValues[i];
      const scalar_t toValue = element.shiftAngleDegToValues[i];
      const scalar_t startMs = element.shiftAngleDegStartValues[i];
      const scalar_t durationMs = element.shiftAngleDegDurationValues[i];
      const scalar_t t = (nowMs - startMs) / durationMs;
      if (t <= 0.0f) {
        shiftAngleDeg = fromValue;
      } else if (t >= 1.0f) {
        shiftAngleDeg = toValue;
        element.shiftAngleDegDurationValues[i] = 0.0f;
      } else {
        const scalar_t tEased = applyEasingScalar(
            t,
            element.shiftAngleDegEasingValues[i],
            element.shiftAngleDegEasingParam0Values[i],
            element.shiftAngleDegEasingParam1Values[i],
            element.shiftAngleDegEasingParam2Values[i],
            element.shiftAngleDegEasingParam3Values[i]);
        shiftAngleDeg = fromValue + wrapAngleDelta(toValue - fromValue) * tEased;
      }
      element.shiftAngleDegValues[i] = shiftAngleDeg;
    }

    if (element.opacityDurationValues[i] > 0.0f ||
        element.renderOpacityDurationValues[i] > 0.0f ||
        element.leaderlineWidthDurationValues[i] > 0.0f ||
        element.rotationDurationValues[i] > 0.0f ||
        element.scaleDurationValues[i] > 0.0f ||
        element.anchorXDurationValues[i] > 0.0f ||
        element.anchorYDurationValues[i] > 0.0f ||
        element.shiftDistanceDurationValues[i] > 0.0f ||
        element.shiftAngleDegDurationValues[i] > 0.0f) {
      hasActiveAnimations = true;
    }

    const size_t elementIndex = static_cast<size_t>(i);
    const bool shiftAnimating =
        element.shiftDistanceDurationValues[i] > 0.0f ||
        element.shiftAngleDegDurationValues[i] > 0.0f;
    bool needsPivotUpdate = shiftAnimating;
    if (elementIndex < pivotDirtyFlags.size() &&
        (pivotDirtyFlags[elementIndex] & PIVOT_DIRTY_LOCAL_FLAG) != 0) {
      needsPivotUpdate = true;
    }

    if (needsPivotUpdate) {
      scalar_t localX = 0.0f;
      scalar_t localY = 0.0f;
      if (shiftDistance != 0.0f) {
        const scalar_t shiftAngle = shiftAngleDeg * kDegToRad;
        scalar_t shiftSin = 0.0f;
        scalar_t shiftCos = 1.0f;
        computeSinCos(shiftAngle, shiftSin, shiftCos);
        // See the note in the SIMD path above for details about the 180deg radius drift
        // and alternatives (2) normalization / (3) better polynomial approximation.
        localX = shiftDistance * shiftSin;
        localY = shiftDistance * shiftCos;
      }
      if (elementIndex < basePivotLocalXValues.size()) {
        basePivotLocalXValues[elementIndex] = localX;
        basePivotLocalYValues[elementIndex] = localY;
      }
      if (elementIndex < pivotLocalXValues.size()) {
        pivotLocalXValues[elementIndex] = localX;
        pivotLocalYValues[elementIndex] = localY;
      }
      if (elementIndex < pivotDirtyFlags.size()) {
        unsigned char flags = pivotDirtyFlags[elementIndex];
        flags = static_cast<unsigned char>(
            (flags & ~PIVOT_DIRTY_LOCAL_FLAG) | PIVOT_DIRTY_RESOLVE_FLAG);
        pivotDirtyFlags[elementIndex] = flags;
      }
    }

    const scalar_t localX =
        elementIndex < basePivotLocalXValues.size()
            ? basePivotLocalXValues[elementIndex]
            : 0.0f;
    const scalar_t localY =
        elementIndex < basePivotLocalYValues.size()
            ? basePivotLocalYValues[elementIndex]
            : 0.0f;
    if (elementIndex < pivotLocalXValues.size()) {
      pivotLocalXValues[elementIndex] = localX;
      pivotLocalYValues[elementIndex] = localY;
    }
    if (!hasOriginLocation) {
      pivotXValues[elementIndex] = localX + baseX;
      pivotYValues[elementIndex] = localY + baseY;
      if (!hasOriginLocation) {
        pivotZValues[elementIndex] = baseZ;
      }
    }
  }
  if (detailEnabled && hasScalar) {
    detailStats->scalarMs += readNowMs() - scalarStartMs;
  }

  if (outHasActiveAnimations) {
    *outHasActiveAnimations = hasActiveAnimations;
  }
  return usesPivotBasis;
}

} // namespace msp_wasm
