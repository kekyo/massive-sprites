// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

#include "compute_internal.h"

///////////////////////////////////////////////////////////////////////////////////////////////

namespace msp_wasm {

bool updateSpriteAnimations(
    const SpriteInputView &sprite,
    int spriteCount,
    scalar_t nowMs) {
  bool hasActiveAnimations = false;
  const int spriteSimdCount = spriteCount - (spriteCount % kSimdLanes);
  const v128_t zero = simdSplat(0.0f);
  const v128_t one = simdSplat(1.0f);
  const v128_t now = simdSplat(nowMs);

  for (int i = 0; i < spriteSimdCount; i += kSimdLanes) {
    v128_t xV = wasm_v128_load(sprite.xValues + i);
    const v128_t xDuration = wasm_v128_load(sprite.xDurationValues + i);
    const v128_t xHasAnim = simdGt(xDuration, zero);
    v128_t xDurationFinal = xDuration;
    if (simdBitmask(xHasAnim) != 0) {
      const v128_t xFrom = wasm_v128_load(sprite.xFromValues + i);
      const v128_t xTo = wasm_v128_load(sprite.xToValues + i);
      const v128_t xStart = wasm_v128_load(sprite.xStartValues + i);
      const v128_t xEasing = wasm_v128_load(sprite.xEasingValues + i);
      const v128_t xParam0 = wasm_v128_load(sprite.xEasingParam0Values + i);
      const v128_t xParam1 = wasm_v128_load(sprite.xEasingParam1Values + i);
      const v128_t xParam2 = wasm_v128_load(sprite.xEasingParam2Values + i);
      const v128_t xParam3 = wasm_v128_load(sprite.xEasingParam3Values + i);
      const v128_t t = simdDiv(simdSub(now, xStart), xDuration);
      const v128_t tLe0 = simdLe(t, zero);
      const v128_t tGe1 = simdGe(t, one);
      const v128_t tEased =
          applyEasingSimd(t, xEasing, xParam0, xParam1, xParam2, xParam3);
      const v128_t xInterp =
          simdAdd(xFrom, simdMul(simdSub(xTo, xFrom), tEased));
      const v128_t xTemp = wasm_v128_bitselect(xTo, xInterp, tGe1);
      const v128_t xAnim = wasm_v128_bitselect(xFrom, xTemp, tLe0);
      const v128_t xFinal = wasm_v128_bitselect(xAnim, xV, xHasAnim);
      wasm_v128_store(sprite.xValues + i, xFinal);

      const v128_t xDurationCleared = wasm_v128_bitselect(zero, xDuration, tGe1);
      xDurationFinal =
          wasm_v128_bitselect(xDurationCleared, xDuration, xHasAnim);
      wasm_v128_store(sprite.xDurationValues + i, xDurationFinal);
    }
    if (simdBitmask(simdGt(xDurationFinal, zero)) != 0) {
      hasActiveAnimations = true;
    }

    v128_t yV = wasm_v128_load(sprite.yValues + i);
    const v128_t yDuration = wasm_v128_load(sprite.yDurationValues + i);
    const v128_t yHasAnim = simdGt(yDuration, zero);
    v128_t yDurationFinal = yDuration;
    if (simdBitmask(yHasAnim) != 0) {
      const v128_t yFrom = wasm_v128_load(sprite.yFromValues + i);
      const v128_t yTo = wasm_v128_load(sprite.yToValues + i);
      const v128_t yStart = wasm_v128_load(sprite.yStartValues + i);
      const v128_t yEasing = wasm_v128_load(sprite.yEasingValues + i);
      const v128_t yParam0 = wasm_v128_load(sprite.yEasingParam0Values + i);
      const v128_t yParam1 = wasm_v128_load(sprite.yEasingParam1Values + i);
      const v128_t yParam2 = wasm_v128_load(sprite.yEasingParam2Values + i);
      const v128_t yParam3 = wasm_v128_load(sprite.yEasingParam3Values + i);
      const v128_t t = simdDiv(simdSub(now, yStart), yDuration);
      const v128_t tLe0 = simdLe(t, zero);
      const v128_t tGe1 = simdGe(t, one);
      const v128_t tEased =
          applyEasingSimd(t, yEasing, yParam0, yParam1, yParam2, yParam3);
      const v128_t yInterp =
          simdAdd(yFrom, simdMul(simdSub(yTo, yFrom), tEased));
      const v128_t yTemp = wasm_v128_bitselect(yTo, yInterp, tGe1);
      const v128_t yAnim = wasm_v128_bitselect(yFrom, yTemp, tLe0);
      const v128_t yFinal = wasm_v128_bitselect(yAnim, yV, yHasAnim);
      wasm_v128_store(sprite.yValues + i, yFinal);

      const v128_t yDurationCleared = wasm_v128_bitselect(zero, yDuration, tGe1);
      yDurationFinal =
          wasm_v128_bitselect(yDurationCleared, yDuration, yHasAnim);
      wasm_v128_store(sprite.yDurationValues + i, yDurationFinal);
    }
    if (simdBitmask(simdGt(yDurationFinal, zero)) != 0) {
      hasActiveAnimations = true;
    }

    v128_t parentOpacityV = wasm_v128_load(sprite.parentOpacityValues + i);
    const v128_t parentOpacityDuration =
        wasm_v128_load(sprite.parentOpacityDurationValues + i);
    const v128_t parentOpacityHasAnim = simdGt(parentOpacityDuration, zero);
    v128_t parentOpacityDurationFinal = parentOpacityDuration;
    if (simdBitmask(parentOpacityHasAnim) != 0) {
      const v128_t parentOpacityFrom =
          wasm_v128_load(sprite.parentOpacityFromValues + i);
      const v128_t parentOpacityTo = wasm_v128_load(sprite.parentOpacityToValues + i);
      const v128_t parentOpacityStart =
          wasm_v128_load(sprite.parentOpacityStartValues + i);
      const v128_t parentOpacityEasing =
          wasm_v128_load(sprite.parentOpacityEasingValues + i);
      const v128_t parentOpacityParam0 =
          wasm_v128_load(sprite.parentOpacityEasingParam0Values + i);
      const v128_t parentOpacityParam1 =
          wasm_v128_load(sprite.parentOpacityEasingParam1Values + i);
      const v128_t parentOpacityParam2 =
          wasm_v128_load(sprite.parentOpacityEasingParam2Values + i);
      const v128_t parentOpacityParam3 =
          wasm_v128_load(sprite.parentOpacityEasingParam3Values + i);
      const v128_t t =
          simdDiv(simdSub(now, parentOpacityStart), parentOpacityDuration);
      const v128_t tLe0 = simdLe(t, zero);
      const v128_t tGe1 = simdGe(t, one);
      const v128_t tEased = applyEasingSimd(
          t,
          parentOpacityEasing,
          parentOpacityParam0,
          parentOpacityParam1,
          parentOpacityParam2,
          parentOpacityParam3);
      const v128_t parentOpacityInterp = simdAdd(
          parentOpacityFrom,
          simdMul(simdSub(parentOpacityTo, parentOpacityFrom), tEased));
      const v128_t parentOpacityTemp =
          wasm_v128_bitselect(parentOpacityTo, parentOpacityInterp, tGe1);
      const v128_t parentOpacityAnim =
          wasm_v128_bitselect(parentOpacityFrom, parentOpacityTemp, tLe0);
      const v128_t parentOpacityFinal = wasm_v128_bitselect(
          parentOpacityAnim,
          parentOpacityV,
          parentOpacityHasAnim);
      parentOpacityV = parentOpacityFinal;

      const v128_t parentOpacityDurationCleared =
          wasm_v128_bitselect(zero, parentOpacityDuration, tGe1);
      parentOpacityDurationFinal = wasm_v128_bitselect(
          parentOpacityDurationCleared,
          parentOpacityDuration,
          parentOpacityHasAnim);
      wasm_v128_store(
          sprite.parentOpacityDurationValues + i,
          parentOpacityDurationFinal);
    }
    const v128_t parentOpacityClamped = simdMax(zero, simdMin(one, parentOpacityV));
    wasm_v128_store(sprite.parentOpacityValues + i, parentOpacityClamped);
    if (simdBitmask(simdGt(parentOpacityDurationFinal, zero)) != 0) {
      hasActiveAnimations = true;
    }

    v128_t renderOpacityV = wasm_v128_load(sprite.renderOpacityValues + i);
    const v128_t renderOpacityDuration =
        wasm_v128_load(sprite.renderOpacityDurationValues + i);
    const v128_t renderOpacityHasAnim = simdGt(renderOpacityDuration, zero);
    v128_t renderOpacityDurationFinal = renderOpacityDuration;
    if (simdBitmask(renderOpacityHasAnim) != 0) {
      const v128_t renderOpacityFrom =
          wasm_v128_load(sprite.renderOpacityFromValues + i);
      const v128_t renderOpacityTo =
          wasm_v128_load(sprite.renderOpacityToValues + i);
      const v128_t renderOpacityStart =
          wasm_v128_load(sprite.renderOpacityStartValues + i);
      const v128_t renderOpacityEasing =
          wasm_v128_load(sprite.renderOpacityEasingValues + i);
      const v128_t renderOpacityParam0 =
          wasm_v128_load(sprite.renderOpacityEasingParam0Values + i);
      const v128_t renderOpacityParam1 =
          wasm_v128_load(sprite.renderOpacityEasingParam1Values + i);
      const v128_t renderOpacityParam2 =
          wasm_v128_load(sprite.renderOpacityEasingParam2Values + i);
      const v128_t renderOpacityParam3 =
          wasm_v128_load(sprite.renderOpacityEasingParam3Values + i);
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
      const v128_t renderOpacityFinal = wasm_v128_bitselect(
          renderOpacityAnim,
          renderOpacityV,
          renderOpacityHasAnim);
      renderOpacityV = renderOpacityFinal;

      const v128_t renderOpacityDurationCleared =
          wasm_v128_bitselect(zero, renderOpacityDuration, tGe1);
      renderOpacityDurationFinal = wasm_v128_bitselect(
          renderOpacityDurationCleared,
          renderOpacityDuration,
          renderOpacityHasAnim);
      wasm_v128_store(
          sprite.renderOpacityDurationValues + i,
          renderOpacityDurationFinal);
    }
    const v128_t renderOpacityClamped = simdMax(zero, simdMin(one, renderOpacityV));
    wasm_v128_store(sprite.renderOpacityValues + i, renderOpacityClamped);
    if (simdBitmask(simdGt(renderOpacityDurationFinal, zero)) != 0) {
      hasActiveAnimations = true;
    }
  }

  for (int i = spriteSimdCount; i < spriteCount; ++i) {
    scalar_t x = sprite.xValues[i];
    if (sprite.xDurationValues[i] > 0.0f) {
      const scalar_t fromValue = sprite.xFromValues[i];
      const scalar_t toValue = sprite.xToValues[i];
      const scalar_t startMs = sprite.xStartValues[i];
      const scalar_t durationMs = sprite.xDurationValues[i];
      const scalar_t t = (nowMs - startMs) / durationMs;
      if (t <= 0.0f) {
        x = fromValue;
      } else if (t >= 1.0f) {
        x = toValue;
        sprite.xDurationValues[i] = 0.0f;
      } else {
        const scalar_t tEased = applyEasingScalar(
            t,
            sprite.xEasingValues[i],
            sprite.xEasingParam0Values[i],
            sprite.xEasingParam1Values[i],
            sprite.xEasingParam2Values[i],
            sprite.xEasingParam3Values[i]);
        x = fromValue + (toValue - fromValue) * tEased;
      }
      sprite.xValues[i] = x;
    }

    scalar_t y = sprite.yValues[i];
    if (sprite.yDurationValues[i] > 0.0f) {
      const scalar_t fromValue = sprite.yFromValues[i];
      const scalar_t toValue = sprite.yToValues[i];
      const scalar_t startMs = sprite.yStartValues[i];
      const scalar_t durationMs = sprite.yDurationValues[i];
      const scalar_t t = (nowMs - startMs) / durationMs;
      if (t <= 0.0f) {
        y = fromValue;
      } else if (t >= 1.0f) {
        y = toValue;
        sprite.yDurationValues[i] = 0.0f;
      } else {
        const scalar_t tEased = applyEasingScalar(
            t,
            sprite.yEasingValues[i],
            sprite.yEasingParam0Values[i],
            sprite.yEasingParam1Values[i],
            sprite.yEasingParam2Values[i],
            sprite.yEasingParam3Values[i]);
        y = fromValue + (toValue - fromValue) * tEased;
      }
      sprite.yValues[i] = y;
    }

    scalar_t parentOpacity = sprite.parentOpacityValues[i];
    if (sprite.parentOpacityDurationValues[i] > 0.0f) {
      const scalar_t fromValue = sprite.parentOpacityFromValues[i];
      const scalar_t toValue = sprite.parentOpacityToValues[i];
      const scalar_t startMs = sprite.parentOpacityStartValues[i];
      const scalar_t durationMs = sprite.parentOpacityDurationValues[i];
      const scalar_t t = (nowMs - startMs) / durationMs;
      if (t <= 0.0f) {
        parentOpacity = fromValue;
      } else if (t >= 1.0f) {
        parentOpacity = toValue;
        sprite.parentOpacityDurationValues[i] = 0.0f;
      } else {
        const scalar_t tEased = applyEasingScalar(
            t,
            sprite.parentOpacityEasingValues[i],
            sprite.parentOpacityEasingParam0Values[i],
            sprite.parentOpacityEasingParam1Values[i],
            sprite.parentOpacityEasingParam2Values[i],
            sprite.parentOpacityEasingParam3Values[i]);
        parentOpacity = fromValue + (toValue - fromValue) * tEased;
      }
    }
    parentOpacity = std::max(
        static_cast<scalar_t>(0.0f),
        std::min(static_cast<scalar_t>(1.0f), parentOpacity));
    sprite.parentOpacityValues[i] = parentOpacity;
    scalar_t renderOpacity = sprite.renderOpacityValues[i];
    if (sprite.renderOpacityDurationValues[i] > 0.0f) {
      const scalar_t fromValue = sprite.renderOpacityFromValues[i];
      const scalar_t toValue = sprite.renderOpacityToValues[i];
      const scalar_t startMs = sprite.renderOpacityStartValues[i];
      const scalar_t durationMs = sprite.renderOpacityDurationValues[i];
      const scalar_t t = (nowMs - startMs) / durationMs;
      if (t <= 0.0f) {
        renderOpacity = fromValue;
      } else if (t >= 1.0f) {
        renderOpacity = toValue;
        sprite.renderOpacityDurationValues[i] = 0.0f;
      } else {
        const scalar_t tEased = applyEasingScalar(
            t,
            sprite.renderOpacityEasingValues[i],
            sprite.renderOpacityEasingParam0Values[i],
            sprite.renderOpacityEasingParam1Values[i],
            sprite.renderOpacityEasingParam2Values[i],
            sprite.renderOpacityEasingParam3Values[i]);
        renderOpacity = fromValue + (toValue - fromValue) * tEased;
      }
    }
    renderOpacity = std::max(
        static_cast<scalar_t>(0.0f),
        std::min(static_cast<scalar_t>(1.0f), renderOpacity));
    sprite.renderOpacityValues[i] = renderOpacity;
    if (sprite.xDurationValues[i] > 0.0f || sprite.yDurationValues[i] > 0.0f ||
        sprite.parentOpacityDurationValues[i] > 0.0f ||
        sprite.renderOpacityDurationValues[i] > 0.0f) {
      hasActiveAnimations = true;
    }
  }
  return hasActiveAnimations;
}

bool updatePolylineAnimations(
    const PolylineInputView &polyline,
    int polylineCount,
    scalar_t nowMs) {
  bool hasActiveAnimations = false;
  for (int i = 0; i < polylineCount; ++i) {
    scalar_t opacity = polyline.opacityValues[i];
    const scalar_t duration = polyline.opacityDurationValues[i];
    if (duration > static_cast<scalar_t>(0.0f)) {
      const scalar_t fromValue = polyline.opacityFromValues[i];
      const scalar_t toValue = polyline.opacityToValues[i];
      const scalar_t startMs = polyline.opacityStartValues[i];
      const scalar_t t = (nowMs - startMs) / duration;
      if (t <= static_cast<scalar_t>(0.0f)) {
        opacity = fromValue;
      } else if (t >= static_cast<scalar_t>(1.0f)) {
        opacity = toValue;
        polyline.opacityDurationValues[i] = static_cast<scalar_t>(0.0f);
      } else {
        const scalar_t tEased = applyEasingScalar(
            t,
            polyline.opacityEasingValues[i],
            polyline.opacityEasingParam0Values[i],
            polyline.opacityEasingParam1Values[i],
            polyline.opacityEasingParam2Values[i],
            polyline.opacityEasingParam3Values[i]);
        opacity = fromValue + (toValue - fromValue) * tEased;
      }
    }
    opacity = std::max(
        static_cast<scalar_t>(0.0f),
        std::min(static_cast<scalar_t>(1.0f), opacity));
    polyline.opacityValues[i] = opacity;
    if (polyline.opacityDurationValues[i] > static_cast<scalar_t>(0.0f)) {
      hasActiveAnimations = true;
    }
  }
  return hasActiveAnimations;
}

} // namespace msp_wasm
