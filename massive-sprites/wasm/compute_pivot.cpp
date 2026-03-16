// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

#include "compute_billboard.h"
#include "compute_internal.h"

///////////////////////////////////////////////////////////////////////////////////////////////

namespace msp_wasm {

void resolvePivotHierarchy(
    const SpriteInputView &sprite,
    const ElementInputView &element,
    int spriteCount,
    int elementCount,
    scalar_t viewRightX,
    scalar_t viewRightY,
    scalar_t viewRightZ,
    scalar_t viewUpX,
    scalar_t viewUpY,
    scalar_t viewUpZ,
    scalar_t cameraX,
    scalar_t cameraY,
    scalar_t cameraZ,
    std::vector<scalar_t> &pivotXValues,
    std::vector<scalar_t> &pivotYValues,
    std::vector<scalar_t> &pivotZValues,
    const std::vector<scalar_t> &pivotLocalXValues,
    const std::vector<scalar_t> &pivotLocalYValues,
    std::vector<scalar_t> &basePivotWorldXValues,
    std::vector<scalar_t> &basePivotWorldYValues,
    std::vector<scalar_t> &basisRightXValues,
    std::vector<scalar_t> &basisRightYValues,
    std::vector<scalar_t> &basisRightZValues,
    std::vector<scalar_t> &basisUpXValues,
    std::vector<scalar_t> &basisUpYValues,
    std::vector<scalar_t> &basisUpZValues,
    const std::vector<scalar_t> &spriteDistanceScaleFactors,
    std::vector<unsigned char> &pivotCameraDependentFlags,
    std::vector<unsigned char> &pivotDirtyFlags,
    std::vector<unsigned char> &resolveStates) {
  if (elementCount <= 0) {
    return;
  }
  if (resolveStates.size() < static_cast<size_t>(elementCount)) {
    resolveStates.resize(static_cast<size_t>(elementCount), 0);
  } else {
    std::fill(
        resolveStates.begin(),
        resolveStates.begin() + elementCount,
        static_cast<unsigned char>(0));
  }
  if (pivotCameraDependentFlags.size() < static_cast<size_t>(elementCount)) {
    pivotCameraDependentFlags.resize(static_cast<size_t>(elementCount), 0);
  } else {
    std::fill(
        pivotCameraDependentFlags.begin(),
        pivotCameraDependentFlags.begin() + elementCount,
        static_cast<unsigned char>(0));
  }
  constexpr unsigned char kResolveStateUnvisited = 0;
  constexpr unsigned char kResolveStateVisiting = 1;
  constexpr unsigned char kResolveStateResolvedClean = 2;
  constexpr unsigned char kResolveStateResolvedDirty = 3;

  const auto resolvePivot = [&](auto &self, int index) -> bool {
    const size_t valueIndex = static_cast<size_t>(index);
    if (valueIndex >= static_cast<size_t>(elementCount)) {
      return false;
    }
    const int ownerSlot = static_cast<int>(element.ownerSlotValues[index]);
    scalar_t spriteBaseX = 0.0f;
    scalar_t spriteBaseY = 0.0f;
    scalar_t spriteBaseZ = 0.0f;
    if (ownerSlot >= 0 && ownerSlot < spriteCount) {
      spriteBaseX = sprite.xValues[ownerSlot];
      spriteBaseY = sprite.yValues[ownerSlot];
      spriteBaseZ = sprite.zValues[ownerSlot];
    }
    const unsigned char state = resolveStates[valueIndex];
    if (state == kResolveStateResolvedClean) {
      return false;
    }
    if (state == kResolveStateResolvedDirty) {
      return true;
    }
    if (state == kResolveStateVisiting) {
      // Circular references are already rejected by TS. Pivot values already
      // include sprite base, so just mark as resolved on malformed input.
      resolveStates[valueIndex] = kResolveStateResolvedDirty;
      return true;
    }
    resolveStates[valueIndex] = kResolveStateVisiting;

    const int originLocationSlot =
        static_cast<int>(element.originLocationSlotValues[index]);
    const bool useResolvedAnchor =
        element.originLocationUseResolvedAnchorValues[index] != static_cast<scalar_t>(0.0f);
    bool originLocationDirty = false;
    if (originLocationSlot >= 0 && originLocationSlot < elementCount && originLocationSlot != index) {
      originLocationDirty = self(self, originLocationSlot);
    }

    scalar_t parentPivotX = spriteBaseX;
    scalar_t parentPivotY = spriteBaseY;
    scalar_t parentPivotZ = spriteBaseZ;
    scalar_t parentRightX = static_cast<scalar_t>(1.0f);
    scalar_t parentRightY = static_cast<scalar_t>(0.0f);
    scalar_t parentRightZ = static_cast<scalar_t>(0.0f);
    scalar_t parentUpX = static_cast<scalar_t>(0.0f);
    scalar_t parentUpY = static_cast<scalar_t>(1.0f);
    scalar_t parentUpZ = static_cast<scalar_t>(0.0f);
    bool parentBasisCameraDependent = false;
    bool parentPivotCameraDependent = false;
    if (originLocationSlot >= 0 && originLocationSlot < elementCount && originLocationSlot != index) {
      const size_t originLocationValueIndex = static_cast<size_t>(originLocationSlot);
      if (originLocationValueIndex < pivotXValues.size()) {
        parentPivotX = pivotXValues[originLocationValueIndex];
        parentPivotY = pivotYValues[originLocationValueIndex];
        parentPivotZ = pivotZValues[originLocationValueIndex];
      }
      if (originLocationValueIndex < basisRightXValues.size()) {
        parentRightX = basisRightXValues[originLocationValueIndex];
        parentRightY = basisRightYValues[originLocationValueIndex];
        parentRightZ = basisRightZValues[originLocationValueIndex];
        parentUpX = basisUpXValues[originLocationValueIndex];
        parentUpY = basisUpYValues[originLocationValueIndex];
        parentUpZ = basisUpZValues[originLocationValueIndex];
      }
      if (originLocationValueIndex < pivotCameraDependentFlags.size()) {
        parentPivotCameraDependent =
            pivotCameraDependentFlags[originLocationValueIndex] != 0;
      }
      const int parentRenderMode =
          static_cast<int>(element.renderModeValues[originLocationSlot]);
      parentBasisCameraDependent =
          parentRenderMode == COMMON_RENDER_MODE_BILLBOARD_PERSPECTIVE ||
          parentRenderMode == COMMON_RENDER_MODE_BILLBOARD;
      if (!useResolvedAnchor) {
        const int originLocationOwnerSlot =
            static_cast<int>(element.ownerSlotValues[originLocationSlot]);
        const scalar_t distanceScale =
            originLocationOwnerSlot >= 0 &&
                    static_cast<size_t>(originLocationOwnerSlot) <
                        spriteDistanceScaleFactors.size()
                ? spriteDistanceScaleFactors[static_cast<size_t>(originLocationOwnerSlot)]
                : static_cast<scalar_t>(1.0f);
        const scalar_t parentScale =
            element.scaleValues[originLocationSlot] * distanceScale;
        const scalar_t halfWidth =
            element.widthValues[originLocationSlot] * parentScale * static_cast<scalar_t>(0.5f);
        const scalar_t halfHeight =
            element.heightValues[originLocationSlot] * parentScale * static_cast<scalar_t>(0.5f);
        const scalar_t anchorOffsetX =
            element.anchorXValues[originLocationSlot] * halfWidth;
        const scalar_t anchorOffsetY =
            element.anchorYValues[originLocationSlot] * halfHeight;
        parentPivotX -= parentRightX * anchorOffsetX + parentUpX * anchorOffsetY;
        parentPivotY -= parentRightY * anchorOffsetX + parentUpY * anchorOffsetY;
        parentPivotZ -= parentRightZ * anchorOffsetX + parentUpZ * anchorOffsetY;
      }
    }

    if (valueIndex < basePivotWorldXValues.size()) {
      basePivotWorldXValues[valueIndex] = parentPivotX;
      basePivotWorldYValues[valueIndex] = parentPivotY;
    }

    const scalar_t localX =
        valueIndex < pivotLocalXValues.size() ? pivotLocalXValues[valueIndex] : 0.0f;
    const scalar_t localY =
        valueIndex < pivotLocalYValues.size() ? pivotLocalYValues[valueIndex] : 0.0f;
    const scalar_t pivotX = parentPivotX + parentRightX * localX + parentUpX * localY;
    const scalar_t pivotY = parentPivotY + parentRightY * localX + parentUpY * localY;
    const scalar_t pivotZ = parentPivotZ + parentRightZ * localX + parentUpZ * localY;
    if (valueIndex < pivotXValues.size()) {
      pivotXValues[valueIndex] = pivotX;
      pivotYValues[valueIndex] = pivotY;
      pivotZValues[valueIndex] = pivotZ;
    }

    scalar_t basisRightX = static_cast<scalar_t>(1.0f);
    scalar_t basisRightY = static_cast<scalar_t>(0.0f);
    scalar_t basisRightZ = static_cast<scalar_t>(0.0f);
    scalar_t basisUpX = static_cast<scalar_t>(0.0f);
    scalar_t basisUpY = static_cast<scalar_t>(1.0f);
    scalar_t basisUpZ = static_cast<scalar_t>(0.0f);
    const int renderMode = static_cast<int>(element.renderModeValues[index]);
    if (renderMode == COMMON_RENDER_MODE_BILLBOARD_PERSPECTIVE) {
      detail::resolveBillboardBasisFromForward(
          cameraX - pivotX,
          cameraY - pivotY,
          cameraZ - pivotZ,
          basisRightX,
          basisRightY,
          basisRightZ,
          basisUpX,
          basisUpY,
          basisUpZ);
    } else if (renderMode == COMMON_RENDER_MODE_BILLBOARD) {
      basisRightX = viewRightX;
      basisRightY = viewRightY;
      basisRightZ = viewRightZ;
      basisUpX = viewUpX;
      basisUpY = viewUpY;
      basisUpZ = viewUpZ;
    }

    if (valueIndex < basisRightXValues.size()) {
      basisRightXValues[valueIndex] = basisRightX;
      basisRightYValues[valueIndex] = basisRightY;
      basisRightZValues[valueIndex] = basisRightZ;
      basisUpXValues[valueIndex] = basisUpX;
      basisUpYValues[valueIndex] = basisUpY;
      basisUpZValues[valueIndex] = basisUpZ;
    }

    if (valueIndex < pivotCameraDependentFlags.size()) {
      const bool pivotCameraDependent =
          parentPivotCameraDependent || parentBasisCameraDependent;
      pivotCameraDependentFlags[valueIndex] =
          static_cast<unsigned char>(pivotCameraDependent ? 1 : 0);
    }
    if (valueIndex < pivotDirtyFlags.size()) {
      pivotDirtyFlags[valueIndex] = static_cast<unsigned char>(
          pivotDirtyFlags[valueIndex] &
          ~(PIVOT_DIRTY_LOCAL_FLAG | PIVOT_DIRTY_RESOLVE_FLAG));
    }

    resolveStates[valueIndex] = kResolveStateResolvedClean;
    return originLocationDirty;
  };

  for (int i = 0; i < elementCount; ++i) {
    const int originLocationSlot = static_cast<int>(element.originLocationSlotValues[i]);
    if (originLocationSlot < 0 || originLocationSlot >= elementCount || originLocationSlot == i) {
      continue;
    }
    resolvePivot(resolvePivot, i);
  }
}

AutoDirectionUpdateResult updateElementAutoDirectionAndFinalState(
    const ElementInputView &element,
    int elementCount,
    const std::vector<scalar_t> &pivotXValues,
    const std::vector<scalar_t> &pivotYValues,
    const std::vector<scalar_t> &basePivotWorldXValues,
    const std::vector<scalar_t> &basePivotWorldYValues,
    const std::vector<scalar_t> &basePivotLocalXValues,
    const std::vector<scalar_t> &basePivotLocalYValues,
    std::vector<scalar_t> &pivotLocalXValues,
    std::vector<scalar_t> &pivotLocalYValues,
    const std::vector<unsigned char> &geometryEnabled,
    std::vector<unsigned char> &pivotDirtyFlags,
    scalar_t nowMs) {
  constexpr scalar_t zero = static_cast<scalar_t>(0.0f);
  const auto isClose = [](scalar_t lhs, scalar_t rhs) {
    return std::abs(lhs - rhs) <= static_cast<scalar_t>(1.0e-4f);
  };
  const auto normalize360 = [](scalar_t degrees) {
    scalar_t wrapped = std::fmod(degrees, static_cast<scalar_t>(360.0f));
    if (wrapped < static_cast<scalar_t>(0.0f)) {
      wrapped += static_cast<scalar_t>(360.0f);
    }
    return wrapped;
  };
  constexpr scalar_t kAutoRotationRetargetDeadbandDeg = 0.25f;
  constexpr scalar_t kAutoRotationCarryPhaseMaxProgress = 0.7f;
  AutoDirectionUpdateResult result{false, false};
  for (int i = 0; i < elementCount; ++i) {
    const size_t valueIndex = static_cast<size_t>(i);
    const scalar_t rotateDeg = element.rotateDegValues[i];
    const scalar_t shiftAngleDeg = element.shiftAngleDegValues[i];
    const scalar_t rotationDuration = element.rotationDurationValues[i];
    const scalar_t finalRotateDuration = element.finalRotateDurationValues[i];
    const scalar_t shiftAngleRuntimeDuration =
        element.finalShiftAngleDurationValues[i];
    const scalar_t autoFlipDuration = element.autoFlipDurationValues[i];
    const int autoDirectionSpace =
        static_cast<int>(element.autoDirectionSpaceValues[i]);
    const int autoDirectionMode =
        static_cast<int>(element.autoDirectionModeValues[i]);
    const bool autoRotationEnabled =
        autoDirectionMode == AUTO_DIRECTION_MODE_ROTATION;
    const bool autoFlippingEnabled =
        autoDirectionMode == AUTO_DIRECTION_MODE_FLIPPING;
    const bool autoShiftAngleRotationEnabled =
        element.autoDirectionShiftAngleRotationValues[i] != zero;
    const bool autoDirectionActive =
        autoRotationEnabled || autoFlippingEnabled || autoShiftAngleRotationEnabled;

    scalar_t directionDeg = element.autoDirectionDegValues[i];
    if (!autoDirectionActive) {
      directionDeg = 0.0f;
      element.autoDirectionHasPrevValues[i] = 0.0f;
      element.autoDirectionDegValues[i] = directionDeg;
    } else if (geometryEnabled[valueIndex] != 0) {
      const int originLocationSlot =
          static_cast<int>(element.originLocationSlotValues[i]);
      const bool hasOriginLocation =
          originLocationSlot >= 0 && originLocationSlot < elementCount &&
          originLocationSlot != i;
      const bool useParentLocalSpace =
          autoDirectionSpace == AUTO_DIRECTION_SPACE_PARENT_LOCAL &&
          hasOriginLocation;
      scalar_t currentPivotX = zero;
      scalar_t currentPivotY = zero;
      if (useParentLocalSpace) {
        if (!autoShiftAngleRotationEnabled &&
            valueIndex < basePivotLocalXValues.size()) {
          currentPivotX = basePivotLocalXValues[valueIndex];
          currentPivotY = basePivotLocalYValues[valueIndex];
        }
      } else if (autoShiftAngleRotationEnabled &&
                 valueIndex < basePivotWorldXValues.size()) {
        currentPivotX = basePivotWorldXValues[valueIndex];
        currentPivotY = basePivotWorldYValues[valueIndex];
      } else {
        currentPivotX = pivotXValues[valueIndex];
        currentPivotY = pivotYValues[valueIndex];
      }
      if (element.autoDirectionHasPrevValues[i] == 0.0f) {
        element.autoDirectionPrevPivotXValues[i] = currentPivotX;
        element.autoDirectionPrevPivotYValues[i] = currentPivotY;
        element.autoDirectionHasPrevValues[i] = 1.0f;
        directionDeg = 0.0f;
      } else {
        const scalar_t prevPivotX = element.autoDirectionPrevPivotXValues[i];
        const scalar_t prevPivotY = element.autoDirectionPrevPivotYValues[i];
        const scalar_t deltaX = currentPivotX - prevPivotX;
        const scalar_t deltaY = currentPivotY - prevPivotY;
        const scalar_t distanceSq = deltaX * deltaX + deltaY * deltaY;
        const scalar_t threshold = std::max(
            static_cast<scalar_t>(0.0f),
            element.autoDirectionMinDistanceValues[i]);
        const scalar_t thresholdSq = threshold * threshold;
        if (distanceSq > 0.0f && distanceSq >= thresholdSq) {
          directionDeg = static_cast<scalar_t>(std::atan2(deltaX, deltaY) / kDegToRad);
          element.autoDirectionPrevPivotXValues[i] = currentPivotX;
          element.autoDirectionPrevPivotYValues[i] = currentPivotY;
        }
      }
    }
    element.autoDirectionDegValues[i] = directionDeg;

    const scalar_t targetRotateDeg =
        autoRotationEnabled ? rotateDeg + directionDeg : rotateDeg;
    const scalar_t rotationInterpolationDuration = std::max(
        static_cast<scalar_t>(0.0f),
        element.finalRotateConfigDurationValues[i]);

    if (!autoRotationEnabled || rotationInterpolationDuration <= 0.0f) {
      element.finalRotateDegValues[i] = targetRotateDeg;
      element.finalRotateFromValues[i] = targetRotateDeg;
      element.finalRotateToValues[i] = targetRotateDeg;
      element.finalRotateStartValues[i] = 0.0f;
      element.finalRotateDurationValues[i] = 0.0f;
      element.finalRotatePrevTargetValues[i] = targetRotateDeg;
    } else {
      scalar_t currentFinalRotateDeg = element.finalRotateDegValues[i];
      if (!std::isfinite(currentFinalRotateDeg)) {
        currentFinalRotateDeg = targetRotateDeg;
      }
      scalar_t prevTargetRotateDeg = element.finalRotatePrevTargetValues[i];
      if (!std::isfinite(prevTargetRotateDeg)) {
        prevTargetRotateDeg = currentFinalRotateDeg;
      }

      const scalar_t runtimeDuration = element.finalRotateDurationValues[i];
      scalar_t carriedProgress = 0.0f;
      if (runtimeDuration > 0.0f) {
        const scalar_t fromValue = element.finalRotateFromValues[i];
        const scalar_t toValue = element.finalRotateToValues[i];
        const scalar_t startMs = element.finalRotateStartValues[i];
        const scalar_t t = (nowMs - startMs) / runtimeDuration;
        if (t <= 0.0f) {
          currentFinalRotateDeg = fromValue;
          carriedProgress = 0.0f;
        } else if (t >= 1.0f) {
          currentFinalRotateDeg = toValue;
          element.finalRotateDurationValues[i] = 0.0f;
          carriedProgress = 1.0f;
        } else {
          carriedProgress = t;
          const scalar_t tEased = applyEasingScalar(
              t,
              element.rotationEasingValues[i],
              element.rotationEasingParam0Values[i],
              element.rotationEasingParam1Values[i],
              element.rotationEasingParam2Values[i],
              element.rotationEasingParam3Values[i]);
          currentFinalRotateDeg =
              fromValue + wrapAngleDelta(toValue - fromValue) * tEased;
        }
      }

      const scalar_t targetDeltaDeg =
          std::abs(wrapAngleDelta(targetRotateDeg - prevTargetRotateDeg));
      if (targetDeltaDeg > kAutoRotationRetargetDeadbandDeg) {
        scalar_t toRotateDeg = targetRotateDeg;
        const bool isFeedforward =
            static_cast<int>(element.rotationModeValues[i]) ==
            INTERPOLATION_MODE_FEEDFORWARD;
        if (isFeedforward) {
          const scalar_t commandDelta =
              wrapAngleDelta(targetRotateDeg - prevTargetRotateDeg);
          toRotateDeg = targetRotateDeg + commandDelta;
        }
        scalar_t startMs = nowMs;
        if (runtimeDuration > 0.0f && carriedProgress > 0.0f &&
            carriedProgress < 1.0f &&
            carriedProgress <= kAutoRotationCarryPhaseMaxProgress) {
          startMs = nowMs - carriedProgress * rotationInterpolationDuration;
        }
        element.finalRotateFromValues[i] = currentFinalRotateDeg;
        element.finalRotateToValues[i] = toRotateDeg;
        element.finalRotateStartValues[i] = startMs;
        element.finalRotateDurationValues[i] = rotationInterpolationDuration;
        element.finalRotatePrevTargetValues[i] = targetRotateDeg;
      }
      element.finalRotateDegValues[i] = currentFinalRotateDeg;
    }

    const scalar_t targetShiftAngleDeg =
        autoShiftAngleRotationEnabled ? shiftAngleDeg + directionDeg : shiftAngleDeg;
    const scalar_t shiftInterpolationDuration = std::max(
        static_cast<scalar_t>(0.0f),
        element.finalShiftAngleConfigDurationValues[i]);
    if (!autoShiftAngleRotationEnabled || shiftInterpolationDuration <= 0.0f) {
      element.finalShiftAngleDegValues[i] = targetShiftAngleDeg;
      element.finalShiftAngleFromValues[i] = targetShiftAngleDeg;
      element.finalShiftAngleToValues[i] = targetShiftAngleDeg;
      element.finalShiftAngleStartValues[i] = 0.0f;
      element.finalShiftAngleDurationValues[i] = 0.0f;
      element.finalShiftAnglePrevTargetValues[i] = targetShiftAngleDeg;
    } else {
      scalar_t currentFinalShiftAngleDeg = element.finalShiftAngleDegValues[i];
      if (!std::isfinite(currentFinalShiftAngleDeg)) {
        currentFinalShiftAngleDeg = targetShiftAngleDeg;
      }
      scalar_t prevTargetShiftAngleDeg = element.finalShiftAnglePrevTargetValues[i];
      if (!std::isfinite(prevTargetShiftAngleDeg)) {
        prevTargetShiftAngleDeg = currentFinalShiftAngleDeg;
      }
      const scalar_t runtimeDuration = element.finalShiftAngleDurationValues[i];
      scalar_t carriedProgress = 0.0f;
      if (runtimeDuration > 0.0f) {
        const scalar_t fromValue = element.finalShiftAngleFromValues[i];
        const scalar_t toValue = element.finalShiftAngleToValues[i];
        const scalar_t startMs = element.finalShiftAngleStartValues[i];
        const scalar_t t = (nowMs - startMs) / runtimeDuration;
        if (t <= 0.0f) {
          currentFinalShiftAngleDeg = fromValue;
          carriedProgress = 0.0f;
        } else if (t >= 1.0f) {
          currentFinalShiftAngleDeg = toValue;
          element.finalShiftAngleDurationValues[i] = 0.0f;
          carriedProgress = 1.0f;
        } else {
          carriedProgress = t;
          const scalar_t tEased = applyEasingScalar(
              t,
              element.shiftAngleDegEasingValues[i],
              element.shiftAngleDegEasingParam0Values[i],
              element.shiftAngleDegEasingParam1Values[i],
              element.shiftAngleDegEasingParam2Values[i],
              element.shiftAngleDegEasingParam3Values[i]);
          currentFinalShiftAngleDeg =
              fromValue + wrapAngleDelta(toValue - fromValue) * tEased;
        }
      }
      const scalar_t targetDeltaDeg = std::abs(
          wrapAngleDelta(targetShiftAngleDeg - prevTargetShiftAngleDeg));
      if (targetDeltaDeg > kAutoRotationRetargetDeadbandDeg) {
        scalar_t toShiftAngleDeg = targetShiftAngleDeg;
        const bool isFeedforward =
            static_cast<int>(element.shiftAngleDegModeValues[i]) ==
            INTERPOLATION_MODE_FEEDFORWARD;
        if (isFeedforward) {
          const scalar_t commandDelta =
              wrapAngleDelta(targetShiftAngleDeg - prevTargetShiftAngleDeg);
          toShiftAngleDeg = targetShiftAngleDeg + commandDelta;
        }
        scalar_t startMs = nowMs;
        if (runtimeDuration > 0.0f && carriedProgress > 0.0f &&
            carriedProgress < 1.0f &&
            carriedProgress <= kAutoRotationCarryPhaseMaxProgress) {
          startMs = nowMs - carriedProgress * shiftInterpolationDuration;
        }
        element.finalShiftAngleFromValues[i] = currentFinalShiftAngleDeg;
        element.finalShiftAngleToValues[i] = toShiftAngleDeg;
        element.finalShiftAngleStartValues[i] = startMs;
        element.finalShiftAngleDurationValues[i] = shiftInterpolationDuration;
        element.finalShiftAnglePrevTargetValues[i] = targetShiftAngleDeg;
      }
      element.finalShiftAngleDegValues[i] = currentFinalShiftAngleDeg;
    }

    scalar_t targetFlipX = static_cast<scalar_t>(1.0f);
    scalar_t targetFlipY = static_cast<scalar_t>(1.0f);
    if (autoFlippingEnabled) {
      const scalar_t normalizedDirection = normalize360(directionDeg);
      const bool flipXEnabled = element.autoDirectionFlipXEnabledValues[i] != zero;
      const bool flipYEnabled = element.autoDirectionFlipYEnabledValues[i] != zero;
      if (flipXEnabled) {
        targetFlipX = normalizedDirection < static_cast<scalar_t>(180.0f)
            ? static_cast<scalar_t>(1.0f)
            : static_cast<scalar_t>(-1.0f);
      }
      if (flipYEnabled) {
        targetFlipY =
            (normalizedDirection < static_cast<scalar_t>(90.0f) ||
             normalizedDirection >= static_cast<scalar_t>(270.0f))
                ? static_cast<scalar_t>(1.0f)
                : static_cast<scalar_t>(-1.0f);
      }
    }

    const scalar_t autoFlipInterpolationDuration = std::max(
        static_cast<scalar_t>(0.0f),
        element.autoDirectionFlipInterpConfigDurationValues[i]);
    if (!autoFlippingEnabled || autoFlipInterpolationDuration <= 0.0f) {
      element.autoFlipXValues[i] = targetFlipX;
      element.autoFlipXFromValues[i] = targetFlipX;
      element.autoFlipXToValues[i] = targetFlipX;
      element.autoFlipXPrevTargetValues[i] = targetFlipX;
      element.autoFlipYValues[i] = targetFlipY;
      element.autoFlipYFromValues[i] = targetFlipY;
      element.autoFlipYToValues[i] = targetFlipY;
      element.autoFlipYPrevTargetValues[i] = targetFlipY;
      element.autoFlipStartValues[i] = 0.0f;
      element.autoFlipDurationValues[i] = 0.0f;
    } else {
      scalar_t currentFlipX = element.autoFlipXValues[i];
      scalar_t currentFlipY = element.autoFlipYValues[i];
      scalar_t prevTargetFlipX = element.autoFlipXPrevTargetValues[i];
      scalar_t prevTargetFlipY = element.autoFlipYPrevTargetValues[i];
      const scalar_t runtimeDuration = element.autoFlipDurationValues[i];
      scalar_t carriedProgress = 0.0f;
      if (runtimeDuration > 0.0f) {
        const scalar_t fromFlipX = element.autoFlipXFromValues[i];
        const scalar_t toFlipX = element.autoFlipXToValues[i];
        const scalar_t fromFlipY = element.autoFlipYFromValues[i];
        const scalar_t toFlipY = element.autoFlipYToValues[i];
        const scalar_t startMs = element.autoFlipStartValues[i];
        const scalar_t t = (nowMs - startMs) / runtimeDuration;
        if (t <= 0.0f) {
          currentFlipX = fromFlipX;
          currentFlipY = fromFlipY;
          carriedProgress = 0.0f;
        } else if (t >= 1.0f) {
          currentFlipX = toFlipX;
          currentFlipY = toFlipY;
          element.autoFlipDurationValues[i] = 0.0f;
          carriedProgress = 1.0f;
        } else {
          carriedProgress = t;
          const scalar_t tEased = applyEasingScalar(
              t,
              element.autoDirectionFlipInterpEasingValues[i],
              element.autoDirectionFlipInterpParam0Values[i],
              element.autoDirectionFlipInterpParam1Values[i],
              element.autoDirectionFlipInterpParam2Values[i],
              element.autoDirectionFlipInterpParam3Values[i]);
          currentFlipX = fromFlipX + (toFlipX - fromFlipX) * tEased;
          currentFlipY = fromFlipY + (toFlipY - fromFlipY) * tEased;
        }
      }
      const bool shouldRetarget =
          !isClose(targetFlipX, prevTargetFlipX) ||
          !isClose(targetFlipY, prevTargetFlipY);
      if (shouldRetarget) {
        scalar_t startMs = nowMs;
        if (runtimeDuration > 0.0f && carriedProgress > 0.0f &&
            carriedProgress < 1.0f &&
            carriedProgress <= kAutoRotationCarryPhaseMaxProgress) {
          startMs = nowMs - carriedProgress * autoFlipInterpolationDuration;
        }
        element.autoFlipXFromValues[i] = currentFlipX;
        element.autoFlipXToValues[i] = targetFlipX;
        element.autoFlipXPrevTargetValues[i] = targetFlipX;
        element.autoFlipYFromValues[i] = currentFlipY;
        element.autoFlipYToValues[i] = targetFlipY;
        element.autoFlipYPrevTargetValues[i] = targetFlipY;
        element.autoFlipStartValues[i] = startMs;
        element.autoFlipDurationValues[i] = autoFlipInterpolationDuration;
      }
      element.autoFlipXValues[i] = currentFlipX;
      element.autoFlipYValues[i] = currentFlipY;
    }

    const scalar_t effectiveShiftAngleDeg = element.finalShiftAngleDegValues[i];
    const scalar_t shiftDistance = element.shiftDistanceValues[i];
    scalar_t nextLocalX = static_cast<scalar_t>(0.0f);
    scalar_t nextLocalY = static_cast<scalar_t>(0.0f);
    if (shiftDistance != static_cast<scalar_t>(0.0f)) {
      scalar_t shiftSin = static_cast<scalar_t>(0.0f);
      scalar_t shiftCos = static_cast<scalar_t>(1.0f);
      computeSinCos(effectiveShiftAngleDeg * kDegToRad, shiftSin, shiftCos);
      nextLocalX = shiftDistance * shiftSin;
      nextLocalY = shiftDistance * shiftCos;
    }
    const scalar_t prevLocalX =
        valueIndex < pivotLocalXValues.size() ? pivotLocalXValues[valueIndex] : zero;
    const scalar_t prevLocalY =
        valueIndex < pivotLocalYValues.size() ? pivotLocalYValues[valueIndex] : zero;
    if (!isClose(prevLocalX, nextLocalX) || !isClose(prevLocalY, nextLocalY)) {
      if (valueIndex < pivotLocalXValues.size()) {
        pivotLocalXValues[valueIndex] = nextLocalX;
        pivotLocalYValues[valueIndex] = nextLocalY;
      }
      if (valueIndex < pivotDirtyFlags.size()) {
        pivotDirtyFlags[valueIndex] = static_cast<unsigned char>(
            (pivotDirtyFlags[valueIndex] & ~PIVOT_DIRTY_LOCAL_FLAG) |
            PIVOT_DIRTY_RESOLVE_FLAG);
      }
      result.requiresPivotResolve = true;
    }

    if (element.finalRotateDurationValues[i] > zero ||
        element.finalShiftAngleDurationValues[i] > zero ||
        element.autoFlipDurationValues[i] > zero) {
      result.hasActiveAnimations = true;
    }
  }
  return result;
}

void collectSpriteEntries(
    const SpriteInputView &sprite,
    const ElementInputView &element,
    int spriteCount,
    int elementCount,
    const scalar_t *viewMatrix,
    const std::vector<scalar_t> &pivotXValues,
    const std::vector<scalar_t> &pivotYValues,
    const std::vector<scalar_t> &pivotZValues,
    const std::vector<unsigned char> &geometryEnabled,
    std::vector<SpriteEntry> &entries) {
  entries.clear();
  entries.reserve(static_cast<size_t>(elementCount));

  for (int i = 0; i < elementCount; ++i) {
    if (geometryEnabled[static_cast<size_t>(i)] == 0) {
      continue;
    }
    const int ownerSlot = static_cast<int>(element.ownerSlotValues[i]);
    if (ownerSlot < 0 || ownerSlot >= spriteCount) {
      continue;
    }
    const int texIndex = static_cast<int>(element.texIndexValues[i]);
    const scalar_t opacity =
        resolveElementRenderOpacity(sprite, element, spriteCount, i);
    if (texIndex < 0 || opacity <= 0.0f) {
      continue;
    }
    const int layer = static_cast<int>(element.layerValues[i]);
    const int order = static_cast<int>(element.orderValues[i]);
    const scalar_t sx = sprite.xValues[ownerSlot];
    const scalar_t sy = sprite.yValues[ownerSlot];
    const scalar_t z = sprite.zValues[ownerSlot];
    const scalar_t pivotX = pivotXValues[static_cast<size_t>(i)];
    const scalar_t pivotY = pivotYValues[static_cast<size_t>(i)];
    const scalar_t pivotZ = pivotZValues[static_cast<size_t>(i)];
    const scalar_t spriteDepth =
        viewMatrix[2] * sx + viewMatrix[6] * sy + viewMatrix[10] * z +
        viewMatrix[14];
    const scalar_t elementDepth =
        viewMatrix[2] * pivotX + viewMatrix[6] * pivotY + viewMatrix[10] * pivotZ +
        viewMatrix[14];
    entries.push_back(
        SpriteEntry{i, layer, order, spriteDepth, elementDepth, texIndex, opacity});
  }
}

void collectPolylineEntries(
    const PolylineInputView &polyline,
    const PolylineNodeInputView &nodes,
    int polylineCount,
    const scalar_t *viewMatrix,
    std::vector<PolylineEntry> &entries) {
  entries.clear();
  if (polylineCount <= 0 || !viewMatrix) {
    return;
  }

  for (int i = 0; i < polylineCount; ++i) {
    const int nodeOffset = static_cast<int>(polyline.nodeOffsetValues[i]);
    const int nodeCount = static_cast<int>(polyline.nodeCountValues[i]);
    if (nodeOffset < 0 || nodeCount < 2) {
      continue;
    }
    const scalar_t opacity = std::max(
        static_cast<scalar_t>(0.0f),
        std::min(static_cast<scalar_t>(1.0f), polyline.opacityValues[i]));
    if (opacity <= static_cast<scalar_t>(0.0f)) {
      continue;
    }
    const int layer = static_cast<int>(polyline.layerValues[i]);
    for (int seg = 0; seg < nodeCount - 1; ++seg) {
      const int nodeIndex = nodeOffset + seg;
      const int nextIndex = nodeIndex + 1;
      const scalar_t x0 = nodes.xValues[nodeIndex];
      const scalar_t y0 = nodes.yValues[nodeIndex];
      const scalar_t x1 = nodes.xValues[nextIndex];
      const scalar_t y1 = nodes.yValues[nextIndex];
      const scalar_t dx = x1 - x0;
      const scalar_t dy = y1 - y0;
      const scalar_t lenSq = dx * dx + dy * dy;
      if (!(lenSq > static_cast<scalar_t>(0.0f))) {
        continue;
      }
      const scalar_t midX = (x0 + x1) * static_cast<scalar_t>(0.5f);
      const scalar_t midY = (y0 + y1) * static_cast<scalar_t>(0.5f);
      const scalar_t depth =
          viewMatrix[2] * midX + viewMatrix[6] * midY + viewMatrix[14];
      entries.push_back(PolylineEntry{i, seg, layer, 0, depth});
    }
  }
}

} // namespace msp_wasm
