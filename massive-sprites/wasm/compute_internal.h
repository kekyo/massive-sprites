// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <limits>
#include <vector>

#include "compute_math.h"
#include "generated/wasm-layout.generated.hpp"

///////////////////////////////////////////////////////////////////////////////////////////////

namespace msp_wasm {

static constexpr unsigned char PIVOT_DIRTY_LOCAL_FLAG = 1;
static constexpr unsigned char PIVOT_DIRTY_RESOLVE_FLAG = 2;

/**
 * @brief Sorted sprite draw entry produced by the compute pipeline.
 */
struct SpriteEntry {
  /** Element index within the element SoA buffers. */
  int index;
  /** Layer used as the primary draw-order key. */
  int layer;
  /** User-supplied order used as the secondary draw-order key. */
  int order;
  /** Depth of the owning sprite in camera space. */
  scalar_t spriteDepth;
  /** Depth of the element pivot in camera space. */
  scalar_t elementDepth;
  /** Texture page index referenced by the quad. */
  int texIndex;
  /** Final resolved opacity written to the output vertices. */
  scalar_t opacity;
};

/**
 * @brief Sorted polyline segment entry produced by the compute pipeline.
 */
struct PolylineEntry {
  /** Polyline index within the polyline SoA buffers. */
  int polylineIndex;
  /** Segment index within the polyline's node range. */
  int segmentIndex;
  /** Layer used as the primary draw-order key. */
  int layer;
  /** User-supplied order used as the secondary draw-order key. */
  int order;
  /** Segment depth in camera space. */
  scalar_t depth;
};

/**
 * @brief Deferred leaderline emission entry attached to an element.
 */
struct LeaderlineEntry {
  /** Element index that owns the leaderline. */
  int elementIndex;
  /** Layer used as the primary draw-order key. */
  int layer;
  /** User-supplied order used as the secondary draw-order key. */
  int order;
  /** Leaderline depth in camera space. */
  scalar_t depth;
  /** First vertex index written for this leaderline. */
  int vertexStart;
  /** Number of vertices written for this leaderline. */
  int vertexCount;
};

/**
 * @brief One texture tile that maps a sub-rectangle of a logical image.
 */
struct TextureTileInfo {
  /** Left edge within the logical image, normalized to `[-0.5, 0.5]`. */
  scalar_t leftRatio;
  /** Top edge within the logical image, normalized to `[-0.5, 0.5]`. */
  scalar_t topRatio;
  /** Right edge within the logical image, normalized to `[-0.5, 0.5]`. */
  scalar_t rightRatio;
  /** Bottom edge within the logical image, normalized to `[-0.5, 0.5]`. */
  scalar_t bottomRatio;
  /** Left U coordinate. */
  scalar_t u0;
  /** Top V coordinate. */
  scalar_t v0;
  /** Right U coordinate. */
  scalar_t u1;
  /** Bottom V coordinate. */
  scalar_t v1;
  /** Texture page identifier consumed by the renderer. */
  int pageId;
};

/**
 * @brief Texture metadata mirrored from command buffers into the compute stage.
 */
struct TextureInfo {
  /** Source texture width in pixels. */
  scalar_t width;
  /** Source texture height in pixels. */
  scalar_t height;
  /** Left U coordinate. */
  scalar_t u0;
  /** Top V coordinate. */
  scalar_t v0;
  /** Right U coordinate. */
  scalar_t u1;
  /** Bottom V coordinate. */
  scalar_t v1;
  /** Texture page identifier consumed by the renderer. */
  int pageId;
  /** Non-zero when this texture slot contains valid data. */
  int valid;
  /** Tile descriptors used when the image spans multiple texture pages. */
  std::vector<TextureTileInfo> tiles;
};

/**
 * @brief SoA view over sprite input buffers.
 * @remarks Each member points at a contiguous field array whose position is
 * defined by `wasm-layout.generated.hpp`. Member names intentionally mirror the
 * generated field offsets one-to-one.
 */
struct SpriteInputView {
  scalar_t *xValues;
  scalar_t *yValues;
  scalar_t *zValues;
  scalar_t *parentOpacityValues;
  scalar_t *renderOpacityValues;
  scalar_t *visibilityDistanceValues;
  scalar_t *lodVisibleValues;
  scalar_t *parentOpacityEasingValues;
  scalar_t *parentOpacityEasingParam0Values;
  scalar_t *parentOpacityEasingParam1Values;
  scalar_t *parentOpacityEasingParam2Values;
  scalar_t *parentOpacityEasingParam3Values;
  scalar_t *renderOpacityEasingValues;
  scalar_t *renderOpacityEasingParam0Values;
  scalar_t *renderOpacityEasingParam1Values;
  scalar_t *renderOpacityEasingParam2Values;
  scalar_t *renderOpacityEasingParam3Values;
  scalar_t *xEasingValues;
  scalar_t *xEasingParam0Values;
  scalar_t *xEasingParam1Values;
  scalar_t *xEasingParam2Values;
  scalar_t *xEasingParam3Values;
  scalar_t *yEasingValues;
  scalar_t *yEasingParam0Values;
  scalar_t *yEasingParam1Values;
  scalar_t *yEasingParam2Values;
  scalar_t *yEasingParam3Values;
  scalar_t *xFromValues;
  scalar_t *xToValues;
  scalar_t *xStartValues;
  scalar_t *xDurationValues;
  scalar_t *parentOpacityFromValues;
  scalar_t *parentOpacityToValues;
  scalar_t *parentOpacityStartValues;
  scalar_t *parentOpacityDurationValues;
  scalar_t *renderOpacityFromValues;
  scalar_t *renderOpacityToValues;
  scalar_t *renderOpacityStartValues;
  scalar_t *renderOpacityDurationValues;
  scalar_t *yFromValues;
  scalar_t *yToValues;
  scalar_t *yStartValues;
  scalar_t *yDurationValues;
};

/**
 * @brief SoA view over element input buffers.
 * @remarks Each member points at a contiguous field array whose position is
 * defined by `wasm-layout.generated.hpp`. Member names intentionally mirror the
 * generated field offsets one-to-one.
 */
struct ElementInputView {
  scalar_t *widthValues;
  scalar_t *heightValues;
  scalar_t *scaleValues;
  scalar_t *scaleFromValues;
  scalar_t *scaleToValues;
  scalar_t *scaleStartValues;
  scalar_t *scaleDurationValues;
  scalar_t *scaleEasingValues;
  scalar_t *scaleEasingParam0Values;
  scalar_t *scaleEasingParam1Values;
  scalar_t *scaleEasingParam2Values;
  scalar_t *scaleEasingParam3Values;
  scalar_t *opacityValues;
  scalar_t *renderOpacityValues;
  scalar_t *borderWidthValues;
  scalar_t *borderColorRValues;
  scalar_t *borderColorGValues;
  scalar_t *borderColorBValues;
  scalar_t *borderColorAValues;
  scalar_t *leaderlineWidthValues;
  scalar_t *leaderlineWidthFromValues;
  scalar_t *leaderlineWidthToValues;
  scalar_t *leaderlineWidthStartValues;
  scalar_t *leaderlineWidthDurationValues;
  scalar_t *leaderlineWidthEasingValues;
  scalar_t *leaderlineWidthEasingParam0Values;
  scalar_t *leaderlineWidthEasingParam1Values;
  scalar_t *leaderlineWidthEasingParam2Values;
  scalar_t *leaderlineWidthEasingParam3Values;
  scalar_t *leaderlineColor0RValues;
  scalar_t *leaderlineColor0GValues;
  scalar_t *leaderlineColor0BValues;
  scalar_t *leaderlineColor0AValues;
  scalar_t *leaderlineColor1RValues;
  scalar_t *leaderlineColor1GValues;
  scalar_t *leaderlineColor1BValues;
  scalar_t *leaderlineColor1AValues;
  scalar_t *leaderlineRepeatLengthValues;
  scalar_t *anchorXValues;
  scalar_t *anchorYValues;
  scalar_t *anchorXFromValues;
  scalar_t *anchorXToValues;
  scalar_t *anchorXStartValues;
  scalar_t *anchorXDurationValues;
  scalar_t *anchorXEasingValues;
  scalar_t *anchorXEasingParam0Values;
  scalar_t *anchorXEasingParam1Values;
  scalar_t *anchorXEasingParam2Values;
  scalar_t *anchorXEasingParam3Values;
  scalar_t *anchorYFromValues;
  scalar_t *anchorYToValues;
  scalar_t *anchorYStartValues;
  scalar_t *anchorYDurationValues;
  scalar_t *anchorYEasingValues;
  scalar_t *anchorYEasingParam0Values;
  scalar_t *anchorYEasingParam1Values;
  scalar_t *anchorYEasingParam2Values;
  scalar_t *anchorYEasingParam3Values;
  scalar_t *orderValues;
  scalar_t *layerValues;
  scalar_t *renderModeValues;
  scalar_t *texIndexValues;
  scalar_t *originLocationSlotValues;
  scalar_t *originLocationUseResolvedAnchorValues;
  scalar_t *ownerSlotValues;
  scalar_t *rotateDegValues;
  scalar_t *autoDirectionSpaceValues;
  scalar_t *autoDirectionModeValues;
  scalar_t *autoDirectionShiftAngleRotationValues;
  scalar_t *autoDirectionMinDistanceValues;
  scalar_t *autoDirectionDegValues;
  scalar_t *autoDirectionPrevPivotXValues;
  scalar_t *autoDirectionPrevPivotYValues;
  scalar_t *autoDirectionHasPrevValues;
  scalar_t *autoDirectionFlipXEnabledValues;
  scalar_t *autoDirectionFlipYEnabledValues;
  scalar_t *autoDirectionFlipInterpConfigDurationValues;
  scalar_t *autoDirectionFlipInterpModeValues;
  scalar_t *autoDirectionFlipInterpEasingValues;
  scalar_t *autoDirectionFlipInterpParam0Values;
  scalar_t *autoDirectionFlipInterpParam1Values;
  scalar_t *autoDirectionFlipInterpParam2Values;
  scalar_t *autoDirectionFlipInterpParam3Values;
  scalar_t *finalRotateDegValues;
  scalar_t *finalRotateFromValues;
  scalar_t *finalRotateToValues;
  scalar_t *finalRotateStartValues;
  scalar_t *finalRotateDurationValues;
  scalar_t *finalRotatePrevTargetValues;
  scalar_t *finalRotateConfigDurationValues;
  scalar_t *finalShiftAngleDegValues;
  scalar_t *finalShiftAngleFromValues;
  scalar_t *finalShiftAngleToValues;
  scalar_t *finalShiftAngleStartValues;
  scalar_t *finalShiftAngleDurationValues;
  scalar_t *finalShiftAnglePrevTargetValues;
  scalar_t *finalShiftAngleConfigDurationValues;
  scalar_t *autoFlipXValues;
  scalar_t *autoFlipXFromValues;
  scalar_t *autoFlipXToValues;
  scalar_t *autoFlipXPrevTargetValues;
  scalar_t *autoFlipYValues;
  scalar_t *autoFlipYFromValues;
  scalar_t *autoFlipYToValues;
  scalar_t *autoFlipYPrevTargetValues;
  scalar_t *autoFlipStartValues;
  scalar_t *autoFlipDurationValues;
  scalar_t *opacityEasingValues;
  scalar_t *opacityEasingParam0Values;
  scalar_t *opacityEasingParam1Values;
  scalar_t *opacityEasingParam2Values;
  scalar_t *opacityEasingParam3Values;
  scalar_t *opacityConfigDurationValues;
  scalar_t *renderOpacityConfigDurationValues;
  scalar_t *renderOpacityEasingValues;
  scalar_t *renderOpacityEasingParam0Values;
  scalar_t *renderOpacityEasingParam1Values;
  scalar_t *renderOpacityEasingParam2Values;
  scalar_t *renderOpacityEasingParam3Values;
  scalar_t *rotationEasingValues;
  scalar_t *rotationEasingParam0Values;
  scalar_t *rotationEasingParam1Values;
  scalar_t *rotationEasingParam2Values;
  scalar_t *rotationEasingParam3Values;
  scalar_t *shiftDistanceEasingValues;
  scalar_t *shiftDistanceEasingParam0Values;
  scalar_t *shiftDistanceEasingParam1Values;
  scalar_t *shiftDistanceEasingParam2Values;
  scalar_t *shiftDistanceEasingParam3Values;
  scalar_t *shiftAngleDegEasingValues;
  scalar_t *shiftAngleDegEasingParam0Values;
  scalar_t *shiftAngleDegEasingParam1Values;
  scalar_t *shiftAngleDegEasingParam2Values;
  scalar_t *shiftAngleDegEasingParam3Values;
  scalar_t *rotationFromValues;
  scalar_t *rotationToValues;
  scalar_t *rotationStartValues;
  scalar_t *rotationDurationValues;
  scalar_t *rotationModeValues;
  scalar_t *opacityFromValues;
  scalar_t *opacityToValues;
  scalar_t *opacityStartValues;
  scalar_t *opacityDurationValues;
  scalar_t *renderOpacityFromValues;
  scalar_t *renderOpacityToValues;
  scalar_t *renderOpacityStartValues;
  scalar_t *renderOpacityDurationValues;
  scalar_t *shiftDistanceFromValues;
  scalar_t *shiftDistanceToValues;
  scalar_t *shiftDistanceStartValues;
  scalar_t *shiftDistanceDurationValues;
  scalar_t *shiftAngleDegFromValues;
  scalar_t *shiftAngleDegToValues;
  scalar_t *shiftAngleDegStartValues;
  scalar_t *shiftAngleDegDurationValues;
  scalar_t *shiftAngleDegModeValues;
  scalar_t *shiftDistanceValues;
  scalar_t *shiftAngleDegValues;
};

/**
 * @brief SoA view over polyline input buffers.
 * @remarks Each member points at a contiguous field array whose position is
 * defined by `wasm-layout.generated.hpp`.
 */
struct PolylineInputView {
  scalar_t *layerValues;
  scalar_t *opacityValues;
  scalar_t *opacityFromValues;
  scalar_t *opacityToValues;
  scalar_t *opacityStartValues;
  scalar_t *opacityDurationValues;
  scalar_t *opacityModeValues;
  scalar_t *opacityEasingValues;
  scalar_t *opacityEasingParam0Values;
  scalar_t *opacityEasingParam1Values;
  scalar_t *opacityEasingParam2Values;
  scalar_t *opacityEasingParam3Values;
  scalar_t *opacityPrevTargetValues;
  scalar_t *color0RValues;
  scalar_t *color0GValues;
  scalar_t *color0BValues;
  scalar_t *color0AValues;
  scalar_t *color1RValues;
  scalar_t *color1GValues;
  scalar_t *color1BValues;
  scalar_t *color1AValues;
  scalar_t *repeatLengthValues;
  scalar_t *joinCorrectionModeValues;
  scalar_t *joinCorrectionIntermediatePointCountValues;
  scalar_t *capCorrectionModeValues;
  scalar_t *capCorrectionPointCountValues;
  scalar_t *nodeOffsetValues;
  scalar_t *nodeCountValues;
};

/**
 * @brief SoA view over polyline node buffers.
 */
struct PolylineNodeInputView {
  scalar_t *xValues;
  scalar_t *yValues;
  scalar_t *thicknessValues;
};

/**
 * @brief Clamps an opacity-like value into the `[0, 1]` range.
 */
static inline scalar_t clampOpacityValue(scalar_t value) {
  return std::max(
      static_cast<scalar_t>(0.0f),
      std::min(static_cast<scalar_t>(1.0f), value));
}

/**
 * @brief Returns whether an element currently owns an independent render-opacity channel.
 */
static inline bool usesElementRenderOpacity(const ElementInputView &element, int index) {
  if (index < 0) {
    return false;
  }
  return element.opacityConfigDurationValues[index] > static_cast<scalar_t>(0.0f);
}

/**
 * @brief Resolves the effective render opacity for one element.
 * @remarks Elements without their own render-opacity channel inherit the
 * sprite render opacity and multiply it by their local opacity.
 */
static inline scalar_t resolveElementRenderOpacity(
    const SpriteInputView &sprite,
    const ElementInputView &element,
    int spriteCount,
    int elementIndex) {
  if (elementIndex < 0) {
    return static_cast<scalar_t>(0.0f);
  }
  if (usesElementRenderOpacity(element, elementIndex)) {
    return clampOpacityValue(element.renderOpacityValues[elementIndex]);
  }
  const int ownerSlot = static_cast<int>(element.ownerSlotValues[elementIndex]);
  if (ownerSlot < 0 || ownerSlot >= spriteCount) {
    return static_cast<scalar_t>(0.0f);
  }
  const scalar_t parentOpacity = clampOpacityValue(sprite.renderOpacityValues[ownerSlot]);
  const scalar_t elementOpacity = clampOpacityValue(element.opacityValues[elementIndex]);
  return clampOpacityValue(parentOpacity * elementOpacity);
}

/**
 * @brief Scratch workspace reused across compute and picking calls.
 * @remarks The workspace owns SoA buffers, derived pivot data, draw-order
 * caches, and debug channels so repeated calls can avoid reallocating them.
 */
struct ComputeWorkspace {
  ComputeWorkspace() = default;

  /**
   * @brief Ensures every cached buffer can hold the next frame's data.
   * @param spriteCount Number of sprites that will be processed.
   * @param elementCount Number of elements that will be processed.
   * @param polylineCount Number of polylines that will be processed.
   * @param polylineNodeCount Number of polyline nodes that will be processed.
   * @param debugEntryEnabled Whether debug-entry scratch buffers are required.
   */
  inline void prepare(
      int spriteCount,
      int elementCount,
      int polylineCount,
      int polylineNodeCount,
      bool debugEntryEnabled) {
    this->spriteCount = spriteCount > 0 ? spriteCount : 0;
    this->elementCount = elementCount > 0 ? elementCount : 0;
    this->polylineCount = polylineCount > 0 ? polylineCount : 0;
    this->polylineNodeCount = polylineNodeCount > 0 ? polylineNodeCount : 0;
    ensureSpriteCapacity(this->spriteCount);
    ensureElementCapacity(this->elementCount);
    ensurePolylineCapacity(this->polylineCount);
    ensurePolylineNodeCapacity(this->polylineNodeCount);
    const size_t requiredElementCount =
        this->elementCount > 0 ? static_cast<size_t>(this->elementCount)
                               : size_t{0};
    const size_t requiredPolylineNodeCount =
        this->polylineNodeCount > 0
            ? static_cast<size_t>(this->polylineNodeCount)
            : size_t{0};
    if (pivotXValues.size() < requiredElementCount) {
      pivotXValues.resize(requiredElementCount, 0.0f);
    }
    if (pivotYValues.size() < requiredElementCount) {
      pivotYValues.resize(requiredElementCount, 0.0f);
    }
    if (pivotZValues.size() < requiredElementCount) {
      pivotZValues.resize(requiredElementCount, 0.0f);
    }
    if (basisRightXValues.size() < requiredElementCount) {
      basisRightXValues.resize(requiredElementCount, 0.0f);
      basisRightYValues.resize(requiredElementCount, 0.0f);
      basisRightZValues.resize(requiredElementCount, 0.0f);
      basisUpXValues.resize(requiredElementCount, 0.0f);
      basisUpYValues.resize(requiredElementCount, 0.0f);
      basisUpZValues.resize(requiredElementCount, 0.0f);
    }
    if (pivotCameraDependentFlags.size() < requiredElementCount) {
      pivotCameraDependentFlags.resize(requiredElementCount, 0);
    }
    if (geometryEnabled.size() < requiredElementCount) {
      geometryEnabled.resize(requiredElementCount, 0);
    }
    if (pivotResolveStates.size() < requiredElementCount) {
      pivotResolveStates.resize(requiredElementCount, 0);
    }
    if (pivotLocalXValues.size() < requiredElementCount) {
      pivotLocalXValues.resize(requiredElementCount, 0.0f);
      pivotLocalYValues.resize(requiredElementCount, 0.0f);
    }
    if (basePivotLocalXValues.size() < requiredElementCount) {
      basePivotLocalXValues.resize(requiredElementCount, 0.0f);
      basePivotLocalYValues.resize(requiredElementCount, 0.0f);
    }
    if (basePivotWorldXValues.size() < requiredElementCount) {
      basePivotWorldXValues.resize(requiredElementCount, 0.0f);
      basePivotWorldYValues.resize(requiredElementCount, 0.0f);
    }
    if (pivotDirtyFlags.size() < requiredElementCount) {
      pivotDirtyFlags.resize(requiredElementCount, PIVOT_DIRTY_LOCAL_FLAG);
    }
    if (ownerBaseXValues.size() < requiredElementCount) {
      ownerBaseXValues.resize(requiredElementCount, 0.0f);
    }
    if (ownerBaseYValues.size() < requiredElementCount) {
      ownerBaseYValues.resize(requiredElementCount, 0.0f);
    }
    if (ownerBaseZValues.size() < requiredElementCount) {
      ownerBaseZValues.resize(requiredElementCount, 0.0f);
    }
    if (ownerParentOpacityValues.size() < requiredElementCount) {
      ownerParentOpacityValues.resize(requiredElementCount, 0.0f);
    }
    if (spriteDistanceScaleFactors.size() < static_cast<size_t>(this->spriteCount)) {
      spriteDistanceScaleFactors.resize(
          static_cast<size_t>(this->spriteCount),
          static_cast<scalar_t>(1.0f));
    }
    if (entries.capacity() < requiredElementCount) {
      entries.reserve(requiredElementCount);
    }
    if (entriesScratch.capacity() < requiredElementCount) {
      entriesScratch.reserve(requiredElementCount);
    }
    if (leaderlineEntries.capacity() < requiredElementCount) {
      leaderlineEntries.reserve(requiredElementCount);
    }
    if (elementLocalIndices.capacity() < requiredElementCount) {
      elementLocalIndices.reserve(requiredElementCount);
    }
    if (outputEntryOrder.capacity() < requiredElementCount) {
      outputEntryOrder.reserve(requiredElementCount);
    }
    if (outputEntryOrderScratch.capacity() < requiredElementCount) {
      outputEntryOrderScratch.reserve(requiredElementCount);
    }
    if (outputEntrySignatures.capacity() < requiredElementCount) {
      outputEntrySignatures.reserve(requiredElementCount);
    }
    if (outputEntryIndices.capacity() < requiredElementCount) {
      outputEntryIndices.reserve(requiredElementCount);
    }
    if (outputEntryCounts.capacity() < requiredElementCount) {
      outputEntryCounts.reserve(requiredElementCount);
    }
    if (elementBorderVertexStarts.size() < requiredElementCount) {
      elementBorderVertexStarts.resize(requiredElementCount, 0);
    }
    if (elementBorderVertexCounts.size() < requiredElementCount) {
      elementBorderVertexCounts.resize(requiredElementCount, 0);
    }
    if (polylineNodeLengths.size() < requiredPolylineNodeCount) {
      polylineNodeLengths.resize(requiredPolylineNodeCount, 0.0f);
    }
    if (polylineNodeScaleFactors.size() < requiredPolylineNodeCount) {
      polylineNodeScaleFactors.resize(
          requiredPolylineNodeCount,
          static_cast<scalar_t>(1.0f));
    }
    if (polylineEntries.capacity() < requiredPolylineNodeCount) {
      polylineEntries.reserve(requiredPolylineNodeCount);
    }
    if (polylineEntriesScratch.capacity() < requiredPolylineNodeCount) {
      polylineEntriesScratch.reserve(requiredPolylineNodeCount);
    }
    if (polylineEntryVertexStarts.capacity() < requiredPolylineNodeCount) {
      polylineEntryVertexStarts.reserve(requiredPolylineNodeCount);
    }
    if (polylineEntryVertexCounts.capacity() < requiredPolylineNodeCount) {
      polylineEntryVertexCounts.reserve(requiredPolylineNodeCount);
    }
    if (debugEntryEnabled) {
      if (entryElementIndices.capacity() < requiredElementCount) {
        entryElementIndices.reserve(requiredElementCount);
      }
      if (entryBillboardSolveModes.capacity() < requiredElementCount) {
        entryBillboardSolveModes.reserve(requiredElementCount);
      }
      if (entryBillboardScreenFromDeg.capacity() < requiredElementCount) {
        entryBillboardScreenFromDeg.reserve(requiredElementCount);
      }
      if (entryBillboardScreenToDeg.capacity() < requiredElementCount) {
        entryBillboardScreenToDeg.reserve(requiredElementCount);
      }
      if (entryBillboardScreenAngleDeg.capacity() < requiredElementCount) {
        entryBillboardScreenAngleDeg.reserve(requiredElementCount);
      }
      if (entryRotateDeg.capacity() < requiredElementCount) {
        entryRotateDeg.reserve(requiredElementCount);
      }
      if (entryFinalRotateDeg.capacity() < requiredElementCount) {
        entryFinalRotateDeg.reserve(requiredElementCount);
      }
      if (entryRotationFromDeg.capacity() < requiredElementCount) {
        entryRotationFromDeg.reserve(requiredElementCount);
      }
      if (entryRotationToDeg.capacity() < requiredElementCount) {
        entryRotationToDeg.reserve(requiredElementCount);
      }
      if (entryRotationDurationMs.capacity() < requiredElementCount) {
        entryRotationDurationMs.reserve(requiredElementCount);
      }
      if (entryFinalRotationFromDeg.capacity() < requiredElementCount) {
        entryFinalRotationFromDeg.reserve(requiredElementCount);
      }
      if (entryFinalRotationToDeg.capacity() < requiredElementCount) {
        entryFinalRotationToDeg.reserve(requiredElementCount);
      }
      if (entryFinalRotationDurationMs.capacity() < requiredElementCount) {
        entryFinalRotationDurationMs.reserve(requiredElementCount);
      }
    }
  }

  inline void ensureSpriteCapacity(int required) {
    if (required <= spriteCapacity) {
      return;
    }
    int nextCapacity = spriteCapacity > 0 ? spriteCapacity * 2 : 8;
    while (nextCapacity < required) {
      nextCapacity *= 2;
    }
    reallocateSpriteBuffer(nextCapacity);
  }

  inline void ensureElementCapacity(int required) {
    if (required <= elementCapacity) {
      return;
    }
    int nextCapacity = elementCapacity > 0 ? elementCapacity * 2 : 8;
    while (nextCapacity < required) {
      nextCapacity *= 2;
    }
    reallocateElementBuffer(nextCapacity);
  }

  inline void reallocateSpriteBuffer(int nextCapacity) {
    const int oldCapacity = spriteCapacity;
    std::vector<scalar_t> nextBuffer(
        static_cast<size_t>(nextCapacity) *
            static_cast<size_t>(WASM_SPRITE_INPUT_FIELDS),
        0.0f);
    if (oldCapacity > 0 && spriteCount > 0) {
      const int copyCount = std::min(spriteCount, oldCapacity);
      for (int field = 0; field < WASM_SPRITE_INPUT_FIELDS; ++field) {
        const scalar_t *src =
            spriteInputBuffer.data() + static_cast<size_t>(field) * oldCapacity;
        scalar_t *dst =
            nextBuffer.data() + static_cast<size_t>(field) * nextCapacity;
        std::copy(src, src + copyCount, dst);
      }
    }
    spriteInputBuffer.swap(nextBuffer);
    spriteCapacity = nextCapacity;
  }

  inline void reallocateElementBuffer(int nextCapacity) {
    const int oldCapacity = elementCapacity;
    std::vector<scalar_t> nextBuffer(
        static_cast<size_t>(nextCapacity) *
            static_cast<size_t>(WASM_ELEMENT_INPUT_FIELDS),
        0.0f);
    if (oldCapacity > 0 && elementCount > 0) {
      const int copyCount = std::min(elementCount, oldCapacity);
      for (int field = 0; field < WASM_ELEMENT_INPUT_FIELDS; ++field) {
        const scalar_t *src =
            elementInputBuffer.data() + static_cast<size_t>(field) * oldCapacity;
        scalar_t *dst =
            nextBuffer.data() + static_cast<size_t>(field) * nextCapacity;
        std::copy(src, src + copyCount, dst);
      }
    }
    elementInputBuffer.swap(nextBuffer);
    elementCapacity = nextCapacity;
  }

  inline void ensurePolylineCapacity(int required) {
    if (required <= polylineCapacity) {
      return;
    }
    int nextCapacity = polylineCapacity > 0 ? polylineCapacity * 2 : 8;
    while (nextCapacity < required) {
      nextCapacity *= 2;
    }
    reallocatePolylineBuffer(nextCapacity);
  }

  inline void ensurePolylineNodeCapacity(int required) {
    if (required <= polylineNodeCapacity) {
      return;
    }
    int nextCapacity = polylineNodeCapacity > 0 ? polylineNodeCapacity * 2 : 8;
    while (nextCapacity < required) {
      nextCapacity *= 2;
    }
    reallocatePolylineNodeBuffer(nextCapacity);
  }

  inline void reallocatePolylineBuffer(int nextCapacity) {
    const int oldCapacity = polylineCapacity;
    std::vector<scalar_t> nextBuffer(
        static_cast<size_t>(nextCapacity) *
            static_cast<size_t>(WASM_POLYLINE_INPUT_FIELDS),
        0.0f);
    if (oldCapacity > 0 && polylineCount > 0) {
      const int copyCount = std::min(polylineCount, oldCapacity);
      for (int field = 0; field < WASM_POLYLINE_INPUT_FIELDS; ++field) {
        const scalar_t *src =
            polylineInputBuffer.data() + static_cast<size_t>(field) * oldCapacity;
        scalar_t *dst =
            nextBuffer.data() + static_cast<size_t>(field) * nextCapacity;
        std::copy(src, src + copyCount, dst);
      }
    }
    polylineInputBuffer.swap(nextBuffer);
    polylineCapacity = nextCapacity;
  }

  inline void reallocatePolylineNodeBuffer(int nextCapacity) {
    const int oldCapacity = polylineNodeCapacity;
    std::vector<scalar_t> nextBuffer(
        static_cast<size_t>(nextCapacity) *
            static_cast<size_t>(WASM_POLYLINE_NODE_INPUT_FIELDS),
        0.0f);
    if (oldCapacity > 0 && polylineNodeCount > 0) {
      const int copyCount = std::min(polylineNodeCount, oldCapacity);
      for (int field = 0; field < WASM_POLYLINE_NODE_INPUT_FIELDS; ++field) {
        const scalar_t *src = polylineNodeInputBuffer.data() +
            static_cast<size_t>(field) * oldCapacity;
        scalar_t *dst = nextBuffer.data() +
            static_cast<size_t>(field) * nextCapacity;
        std::copy(src, src + copyCount, dst);
      }
    }
    polylineNodeInputBuffer.swap(nextBuffer);
    polylineNodeCapacity = nextCapacity;
  }

  std::vector<scalar_t> pivotXValues;
  std::vector<scalar_t> pivotYValues;
  std::vector<scalar_t> pivotZValues;
  std::vector<scalar_t> pivotLocalXValues;
  std::vector<scalar_t> pivotLocalYValues;
  std::vector<scalar_t> basePivotLocalXValues;
  std::vector<scalar_t> basePivotLocalYValues;
  std::vector<scalar_t> basePivotWorldXValues;
  std::vector<scalar_t> basePivotWorldYValues;
  std::vector<scalar_t> basisRightXValues;
  std::vector<scalar_t> basisRightYValues;
  std::vector<scalar_t> basisRightZValues;
  std::vector<scalar_t> basisUpXValues;
  std::vector<scalar_t> basisUpYValues;
  std::vector<scalar_t> basisUpZValues;
  std::vector<unsigned char> pivotCameraDependentFlags;
  std::vector<scalar_t> ownerBaseXValues;
  std::vector<scalar_t> ownerBaseYValues;
  std::vector<scalar_t> ownerBaseZValues;
  std::vector<scalar_t> ownerParentOpacityValues;
  std::vector<scalar_t> spriteDistanceScaleFactors;
  std::vector<unsigned char> geometryEnabled;
  std::vector<unsigned char> pivotDirtyFlags;
  std::vector<unsigned char> pivotResolveStates;
  std::vector<SpriteEntry> entries;
  std::vector<SpriteEntry> entriesScratch;
  std::vector<LeaderlineEntry> leaderlineEntries;
  std::vector<int> elementLocalIndices;
  std::vector<int> spriteLocalIndexCounts;
  std::vector<int> outputEntryOrder;
  std::vector<int> outputEntryOrderScratch;
  std::vector<std::uint64_t> outputEntrySignatures;
  std::vector<int> outputEntryIndices;
  std::vector<int> outputEntryCounts;
  std::vector<int> elementBorderVertexStarts;
  std::vector<int> elementBorderVertexCounts;
  std::vector<int> entryElementIndices;
  std::vector<int> entryBillboardSolveModes;
  std::vector<scalar_t> entryBillboardScreenFromDeg;
  std::vector<scalar_t> entryBillboardScreenToDeg;
  std::vector<scalar_t> entryBillboardScreenAngleDeg;
  std::vector<scalar_t> entryRotateDeg;
  std::vector<scalar_t> entryFinalRotateDeg;
  std::vector<scalar_t> entryRotationFromDeg;
  std::vector<scalar_t> entryRotationToDeg;
  std::vector<scalar_t> entryRotationDurationMs;
  std::vector<scalar_t> entryFinalRotationFromDeg;
  std::vector<scalar_t> entryFinalRotationToDeg;
  std::vector<scalar_t> entryFinalRotationDurationMs;
  std::vector<scalar_t> spriteInputBuffer;
  std::vector<scalar_t> elementInputBuffer;
  std::vector<scalar_t> polylineInputBuffer;
  std::vector<scalar_t> polylineNodeInputBuffer;
  std::vector<scalar_t> polylineNodeLengths;
  std::vector<scalar_t> polylineNodeScaleFactors;
  std::vector<PolylineEntry> polylineEntries;
  std::vector<PolylineEntry> polylineEntriesScratch;
  std::vector<int> polylineEntryVertexStarts;
  std::vector<int> polylineEntryVertexCounts;
  int spriteCount = 0;
  int elementCount = 0;
  int spriteCapacity = 0;
  int elementCapacity = 0;
  int polylineCount = 0;
  int polylineNodeCount = 0;
  int polylineCapacity = 0;
  int polylineNodeCapacity = 0;
  bool needsCompute = true;
  bool hasActiveAnimations = false;
  int lastActiveCount = 0;
};

/**
 * @brief Mixes one hash component into an existing 64-bit hash seed.
 */
static constexpr inline std::uint64_t hashCombine(std::uint64_t seed, std::uint64_t value) {
  return seed ^ (value + 0x9e3779b97f4a7c15ULL + (seed << 6) + (seed >> 2));
}

/**
 * @brief Hashes a scalar value while keeping NaN handling stable.
 */
static constexpr inline std::uint64_t hashScalar(scalar_t value) {
  if (!std::isfinite(value)) {
    return 0x7ff8000000000000ULL;
  }
  std::uint64_t bits = 0;
  if constexpr (sizeof(scalar_t) == sizeof(std::uint32_t)) {
    std::uint32_t tmp = 0;
    std::memcpy(&tmp, &value, sizeof(tmp));
    bits = tmp;
  } else {
    std::memcpy(&bits, &value, sizeof(bits));
  }
  return bits;
}

/**
 * @brief Hashes an integer value for output-signature tracking.
 */
static constexpr inline std::uint64_t hashInt(int value) {
  return static_cast<std::uint64_t>(static_cast<std::uint32_t>(value));
}

static inline v128_t applyEasingSimd(
    v128_t t,
    v128_t easingType,
    v128_t param0,
    v128_t param1,
    v128_t param2,
    v128_t param3);

/**
 * @brief Clamps normalized progress into the `[0, 1]` range.
 */
static constexpr inline scalar_t clamp01(scalar_t value) {
  if (!std::isfinite(value)) {
    return 1.0f;
  }
  if (value <= 0.0f) {
    return 0.0f;
  }
  if (value >= 1.0f) {
    return 1.0f;
  }
  return value;
}

/**
 * @brief Decodes easing-mode enums shared between scalar and SIMD paths.
 */
static constexpr inline int decodeEasingMode(scalar_t modeCode) {
  if (modeCode == 1.0f) {
    return 1; // in
  }
  if (modeCode == 2.0f) {
    return 2; // out
  }
  return 0; // in-out
}

/**
 * @brief Evaluates one easing preset in scalar code.
 * @remarks Scalar fallback supports the full preset surface, while the SIMD
 * path specializes only the hot presets and falls back lane-by-lane when needed.
 */
static constexpr inline scalar_t applyEasingPresetScalar(
    scalar_t progress,
    int easingType,
    scalar_t param0,
    scalar_t param1,
    scalar_t param2,
    scalar_t param3) {
  const scalar_t t = clamp01(progress);
  constexpr scalar_t pi = 3.14159265358979323846;

  switch (easingType) {
    case INTERPOLATION_EASING_LINEAR:
    default:
      return t;

    case INTERPOLATION_EASING_SIGMOID:
      return sigmoidScalar(t, param0, param1, param2, param3);

    case INTERPOLATION_EASING_EASE: {
      const scalar_t power = param0 > 0.0f ? param0 : 3.0f;
      const int mode = decodeEasingMode(param1);
      if (mode == 1) {
        return std::pow(t, power);
      }
      if (mode == 2) {
        return 1.0f - std::pow(1.0f - t, power);
      }
      if (t < 0.5f) {
        const scalar_t x = t * 2.0f;
        return 0.5f * std::pow(x, power);
      }
      const scalar_t x = 2.0f - t * 2.0f;
      return 1.0f - 0.5f * std::pow(x, power);
    }

    case INTERPOLATION_EASING_EXPONENTIAL: {
      const scalar_t exponent = param0 > 0.0f ? param0 : 5.0f;
      const int mode = decodeEasingMode(param1);
      const scalar_t denom = std::expm1(exponent);
      auto expIn = [&](scalar_t value) -> scalar_t {
        if (value == 0.0f) {
          return 0.0f;
        }
        if (value == 1.0f) {
          return 1.0f;
        }
        return std::expm1(exponent * value) / denom;
      };
      auto expOut = [&](scalar_t value) -> scalar_t {
        if (value == 0.0f) {
          return 0.0f;
        }
        if (value == 1.0f) {
          return 1.0f;
        }
        return 1.0f - std::expm1(exponent * (1.0f - value)) / denom;
      };
      if (mode == 1) {
        return expIn(t);
      }
      if (mode == 2) {
        return expOut(t);
      }
      if (t < 0.5f) {
        return 0.5f * expIn(t * 2.0f);
      }
      return 0.5f + 0.5f * expOut(t * 2.0f - 1.0f);
    }

    case INTERPOLATION_EASING_QUADRATIC: {
      const int mode = decodeEasingMode(param0);
      if (mode == 1) {
        return t * t;
      }
      if (mode == 2) {
        return 1.0f - (1.0f - t) * (1.0f - t);
      }
      if (t < 0.5f) {
        const scalar_t x = t * 2.0f;
        return 0.5f * x * x;
      }
      const scalar_t x = 2.0f - t * 2.0f;
      return 1.0f - 0.5f * x * x;
    }

    case INTERPOLATION_EASING_CUBIC: {
      const int mode = decodeEasingMode(param0);
      if (mode == 1) {
        return t * t * t;
      }
      if (mode == 2) {
        const scalar_t inv = 1.0f - t;
        return 1.0f - inv * inv * inv;
      }
      if (t < 0.5f) {
        const scalar_t x = t * 2.0f;
        return 0.5f * x * x * x;
      }
      const scalar_t x = 2.0f - t * 2.0f;
      return 1.0f - 0.5f * x * x * x;
    }

    case INTERPOLATION_EASING_SINE: {
      const int mode = decodeEasingMode(param0);
      const scalar_t amplitude = param1 > 0.0f ? param1 : 1.0f;
      if (mode == 1) {
        return amplitude * (1.0f - std::cos((pi / 2.0f) * t));
      }
      if (mode == 2) {
        return amplitude * std::sin((pi / 2.0f) * t);
      }
      return amplitude * 0.5f * (1.0f - std::cos(pi * t));
    }

    case INTERPOLATION_EASING_BOUNCE: {
      const scalar_t bounceBase = param0 > 0.0f ? param0 : 3.0f;
      const scalar_t bounces = std::max(
          static_cast<scalar_t>(1.0),
          static_cast<scalar_t>(std::round(static_cast<double>(bounceBase))));
      const scalar_t decay =
          param1 <= 0.0f ? 0.5f : (param1 > 1.0f ? 1.0f : param1);
      const scalar_t oscillation = std::cos(pi * (bounces + 0.5f) * t);
      const scalar_t dampening = std::pow(decay, t * bounces);
      return 1.0f - std::abs(oscillation) * dampening;
    }

    case INTERPOLATION_EASING_BACK: {
      const scalar_t overshoot = std::isfinite(param0) ? param0 : 1.70158f;
      const scalar_t c3 = overshoot + 1.0f;
      const scalar_t p = t - 1.0f;
      return 1.0f + c3 * p * p * p + overshoot * p * p;
    }
  }
}

/**
 * @brief Evaluates the hot easing presets in SIMD and falls back per lane as needed.
 */
static inline v128_t applyEasingSimd(
    v128_t t,
    v128_t easingType,
    v128_t param0,
    v128_t param1,
    v128_t param2,
    v128_t param3) {
  const int fullMask = (1 << kSimdLanes) - 1;
  const v128_t one = simdSplat(1.0f);
  const v128_t two = simdSplat(2.0f);
  const v128_t half = simdSplat(0.5f);
  const v128_t easingLinear = simdSplat(INTERPOLATION_EASING_LINEAR);
  const v128_t easingSigmoid = simdSplat(INTERPOLATION_EASING_SIGMOID);
  const v128_t easingQuadratic = simdSplat(INTERPOLATION_EASING_QUADRATIC);
  const v128_t easingCubic = simdSplat(INTERPOLATION_EASING_CUBIC);
  const v128_t easingBack = simdSplat(INTERPOLATION_EASING_BACK);
  const v128_t modeIn = simdSplat(1.0f);
  const v128_t modeOut = simdSplat(2.0f);

  const v128_t linearMask =
      simdEq(easingType, easingLinear);
  const v128_t sigmoidMask = simdEq(easingType, easingSigmoid);
  const v128_t quadraticMask = simdEq(easingType, easingQuadratic);
  const v128_t cubicMask = simdEq(easingType, easingCubic);
  const v128_t backMask = simdEq(easingType, easingBack);

  v128_t eased = t;

  if (simdBitmask(sigmoidMask) != 0) {
    const v128_t sigmoidValue = sigmoidSimd(t, param0, param1, param2, param3);
    eased = wasm_v128_bitselect(sigmoidValue, eased, sigmoidMask);
  }

  if (simdBitmask(quadraticMask) != 0) {
    const v128_t inMask = simdEq(param0, modeIn);
    const v128_t outMask = simdEq(param0, modeOut);
    const v128_t t2 = simdMul(t, t);
    const v128_t inValue = t2;
    const v128_t tInv = simdSub(one, t);
    const v128_t outValue = simdSub(one, simdMul(tInv, tInv));
    const v128_t tDouble = simdMul(t, two);
    const v128_t firstHalfValue = simdMul(half, simdMul(tDouble, tDouble));
    const v128_t mirrored = simdSub(two, tDouble);
    const v128_t secondHalfValue =
        simdSub(one, simdMul(half, simdMul(mirrored, mirrored)));
    const v128_t inOutMask = simdLe(t, half);
    const v128_t inOutValue =
        wasm_v128_bitselect(firstHalfValue, secondHalfValue, inOutMask);
    v128_t quadraticValue = wasm_v128_bitselect(inValue, inOutValue, inMask);
    quadraticValue = wasm_v128_bitselect(outValue, quadraticValue, outMask);
    eased = wasm_v128_bitselect(quadraticValue, eased, quadraticMask);
  }

  if (simdBitmask(cubicMask) != 0) {
    const v128_t inMask = simdEq(param0, modeIn);
    const v128_t outMask = simdEq(param0, modeOut);
    const v128_t t2 = simdMul(t, t);
    const v128_t t3 = simdMul(t2, t);
    const v128_t inValue = t3;
    const v128_t tInv = simdSub(one, t);
    const v128_t tInv2 = simdMul(tInv, tInv);
    const v128_t outValue = simdSub(one, simdMul(tInv2, tInv));
    const v128_t tDouble = simdMul(t, two);
    const v128_t firstHalfValue = simdMul(half, simdMul(simdMul(tDouble, tDouble), tDouble));
    const v128_t mirrored = simdSub(two, tDouble);
    const v128_t secondHalfValue = simdSub(
        one,
        simdMul(half, simdMul(simdMul(mirrored, mirrored), mirrored)));
    const v128_t inOutMask = simdLe(t, half);
    const v128_t inOutValue =
        wasm_v128_bitselect(firstHalfValue, secondHalfValue, inOutMask);
    v128_t cubicValue = wasm_v128_bitselect(inValue, inOutValue, inMask);
    cubicValue = wasm_v128_bitselect(outValue, cubicValue, outMask);
    eased = wasm_v128_bitselect(cubicValue, eased, cubicMask);
  }

  if (simdBitmask(backMask) != 0) {
    const v128_t overshoot = param0;
    const v128_t c3 = simdAdd(overshoot, one);
    const v128_t p = simdSub(t, one);
    const v128_t p2 = simdMul(p, p);
    const v128_t p3 = simdMul(p2, p);
    const v128_t backValue =
        simdAdd(one, simdAdd(simdMul(c3, p3), simdMul(overshoot, p2)));
    eased = wasm_v128_bitselect(backValue, eased, backMask);
  }

  v128_t knownMask = wasm_v128_or(linearMask, sigmoidMask);
  knownMask = wasm_v128_or(knownMask, quadraticMask);
  knownMask = wasm_v128_or(knownMask, cubicMask);
  knownMask = wasm_v128_or(knownMask, backMask);
  const int knownMaskBits = simdBitmask(knownMask);
  if (knownMaskBits == fullMask) {
    return eased;
  }

  alignas(16) scalar_t easedValues[kSimdLanes];
  alignas(16) scalar_t tValues[kSimdLanes];
  alignas(16) scalar_t easingTypeValues[kSimdLanes];
  alignas(16) scalar_t param0Values[kSimdLanes];
  alignas(16) scalar_t param1Values[kSimdLanes];
  alignas(16) scalar_t param2Values[kSimdLanes];
  alignas(16) scalar_t param3Values[kSimdLanes];
  wasm_v128_store(easedValues, eased);
  wasm_v128_store(tValues, t);
  wasm_v128_store(easingTypeValues, easingType);
  wasm_v128_store(param0Values, param0);
  wasm_v128_store(param1Values, param1);
  wasm_v128_store(param2Values, param2);
  wasm_v128_store(param3Values, param3);
  for (int lane = 0; lane < kSimdLanes; lane += 1) {
    if ((knownMaskBits & (1 << lane)) == 0) {
      easedValues[lane] = applyEasingPresetScalar(
          tValues[lane],
          static_cast<int>(easingTypeValues[lane]),
          param0Values[lane],
          param1Values[lane],
          param2Values[lane],
          param3Values[lane]);
    }
  }
  return wasm_v128_load(easedValues);
}

/**
 * @brief Scalar wrapper around the easing preset evaluator.
 */
static constexpr inline scalar_t applyEasingScalar(
    scalar_t t,
    scalar_t easingType,
    scalar_t param0,
    scalar_t param1,
    scalar_t param2,
    scalar_t param3) {
  return applyEasingPresetScalar(
      t, static_cast<int>(easingType), param0, param1, param2, param3);
}

/**
 * @brief Builds view and view-projection matrices from the camera buffer.
 */
static inline void computeProjection(
    const scalar_t *camera,
    scalar_t *viewMatrix,
    scalar_t *viewProjection) {
  const scalar_t aspectRatio = camera[CAMERA_VIEWPORT_ASPECT_OFFSET];

  const scalar_t positionX = camera[CAMERA_POSITION_X_OFFSET];
  const scalar_t positionY = camera[CAMERA_POSITION_Y_OFFSET];
  const scalar_t positionZ = camera[CAMERA_POSITION_Z_OFFSET];
  const scalar_t yaw = camera[CAMERA_ROTATION_YAW_OFFSET];
  const scalar_t pitch = camera[CAMERA_ROTATION_PITCH_OFFSET];
  const scalar_t roll = camera[CAMERA_ROTATION_ROLL_OFFSET];
  const scalar_t fovY = camera[CAMERA_FOV_Y_OFFSET];
  const scalar_t near = camera[CAMERA_NEAR_OFFSET];
  const scalar_t far = camera[CAMERA_FAR_OFFSET];

  scalar_t rotationMatrix[16];
  scalar_t rotationTemp[16];
  scalar_t rotationTranspose[16];
  scalar_t translationMatrix[16];
  scalar_t projectionMatrix[16];

  createRotationZXYMatrix(
      toRadians(yaw),
      toRadians(pitch),
      toRadians(roll),
      rotationMatrix,
      rotationTemp);
  transposeMatrix(rotationMatrix, rotationTranspose);
  createTranslationMatrix(-positionX, -positionY, -positionZ, translationMatrix);
  multiplyMatrices(rotationTranspose, translationMatrix, viewMatrix);
  createPerspectiveMatrix(toRadians(fovY), aspectRatio, near, far, projectionMatrix);
  multiplyMatrices(projectionMatrix, viewMatrix, viewProjection);
}

/**
 * @brief Sentinel representing "no far distance limit" for scaling.
 */
static constexpr inline scalar_t scalingUnlimitedMaxDistance() {
  return std::numeric_limits<scalar_t>::max();
}

/**
 * @brief Returns whether a scaling max-distance acts as a finite far clamp.
 */
static constexpr inline bool hasFarDistanceScaling(scalar_t value) {
  return value > static_cast<scalar_t>(0.0f) &&
      value < scalingUnlimitedMaxDistance();
}

/**
 * @brief Normalizes the near-distance scaling bound.
 */
static constexpr inline scalar_t normalizeScalingMinDistance(scalar_t value) {
  if (!(value > static_cast<scalar_t>(0.0f))) {
    return static_cast<scalar_t>(0.0f);
  }
  return value >= scalingUnlimitedMaxDistance()
      ? scalingUnlimitedMaxDistance()
      : value;
}

/**
 * @brief Normalizes the far-distance scaling bound.
 */
static constexpr inline scalar_t normalizeScalingMaxDistance(scalar_t value) {
  if (!(value > static_cast<scalar_t>(0.0f))) {
    return scalingUnlimitedMaxDistance();
  }
  return value >= scalingUnlimitedMaxDistance()
      ? scalingUnlimitedMaxDistance()
      : value;
}

/**
 * @brief Normalizes and orders distance-scaling bounds.
 */
static constexpr inline void normalizeScalingRange(
    scalar_t minDistance,
    scalar_t maxDistance,
    scalar_t &outMinDistance,
    scalar_t &outMaxDistance) {
  outMinDistance = normalizeScalingMinDistance(minDistance);
  outMaxDistance = normalizeScalingMaxDistance(maxDistance);
  if (outMaxDistance < outMinDistance) {
    const scalar_t temp = outMinDistance;
    outMinDistance = outMaxDistance;
    outMaxDistance = temp;
  }
}

/**
 * @brief Computes a distance-based scale multiplier clamped by the configured range.
 */
static constexpr inline scalar_t calculateDistanceScaleFactor(
    scalar_t distance,
    scalar_t minDistance,
    scalar_t maxDistance) {
  if (!std::isfinite(distance) || distance <= static_cast<scalar_t>(0.0f)) {
    return static_cast<scalar_t>(1.0f);
  }
  scalar_t resolvedMinDistance = static_cast<scalar_t>(0.0f);
  scalar_t resolvedMaxDistance = scalingUnlimitedMaxDistance();
  normalizeScalingRange(
      minDistance,
      maxDistance,
      resolvedMinDistance,
      resolvedMaxDistance);
  scalar_t clampedDistance = distance;
  if (resolvedMinDistance > static_cast<scalar_t>(0.0f) &&
      distance < resolvedMinDistance) {
    clampedDistance = resolvedMinDistance;
  } else if (hasFarDistanceScaling(resolvedMaxDistance) &&
             distance > resolvedMaxDistance) {
    clampedDistance = resolvedMaxDistance;
  }
  if (clampedDistance == distance ||
      clampedDistance <= static_cast<scalar_t>(0.0f)) {
    return static_cast<scalar_t>(1.0f);
  }
  return distance / clampedDistance;
}

}

///////////////////////////////////////////////////////////////////////////////////////////////

namespace msp_wasm {

/**
 * @brief Per-phase timing breakdown for element animation updates.
 */
struct ElementAnimDetailStats {
  /** Time spent resolving owner-derived values. */
  scalar_t ownerMs = static_cast<scalar_t>(0.0f);
  /** Time spent resolving opacity channels. */
  scalar_t opacityMs = static_cast<scalar_t>(0.0f);
  /** Time spent resolving rotation channels. */
  scalar_t rotationMs = static_cast<scalar_t>(0.0f);
  /** Time spent resolving scale channels. */
  scalar_t scaleMs = static_cast<scalar_t>(0.0f);
  /** Time spent resolving anchor channels. */
  scalar_t anchorMs = static_cast<scalar_t>(0.0f);
  /** Time spent resolving shift channels. */
  scalar_t shiftMs = static_cast<scalar_t>(0.0f);
  /** Time spent computing pivots. */
  scalar_t pivotMs = static_cast<scalar_t>(0.0f);
  /** Time spent merging SIMD/scalar results back into the workspace. */
  scalar_t mergeMs = static_cast<scalar_t>(0.0f);
  /** Time spent in scalar fallback paths. */
  scalar_t scalarMs = static_cast<scalar_t>(0.0f);
  /** Time spent inside the SIMD main loop. */
  scalar_t simdLoopMs = static_cast<scalar_t>(0.0f);
};

/**
 * @brief Creates a sprite SoA view from a raw workspace buffer.
 * @param spriteInput Buffer base pointer.
 * @param spriteInputStride Stride, in elements, between field arrays.
 * @return Resolved sprite input view.
 */
SpriteInputView makeSpriteInputView(scalar_t *spriteInput, int spriteInputStride);

/**
 * @brief Creates an element SoA view from a raw workspace buffer.
 * @param elementInput Buffer base pointer.
 * @param elementInputStride Stride, in elements, between field arrays.
 * @return Resolved element input view.
 */
ElementInputView makeElementInputView(scalar_t *elementInput, int elementInputStride);

/**
 * @brief Creates a polyline SoA view from a raw workspace buffer.
 * @param polylineInput Buffer base pointer.
 * @param polylineInputStride Stride, in elements, between field arrays.
 * @return Resolved polyline input view.
 */
PolylineInputView makePolylineInputView(
    scalar_t *polylineInput,
    int polylineInputStride);

/**
 * @brief Creates a polyline-node SoA view from a raw workspace buffer.
 * @param polylineNodeInput Buffer base pointer.
 * @param polylineNodeInputStride Stride, in elements, between field arrays.
 * @return Resolved polyline node input view.
 */
PolylineNodeInputView makePolylineNodeInputView(
    scalar_t *polylineNodeInput,
    int polylineNodeInputStride);

/**
 * @brief Advances sprite interpolation channels to the supplied timestamp.
 * @param sprite Sprite SoA view.
 * @param spriteCount Number of sprites in the view.
 * @param nowMs Current timestamp in milliseconds.
 * @return `true` when at least one sprite still has an active animation.
 */
bool updateSpriteAnimations(
    const SpriteInputView &sprite,
    int spriteCount,
    scalar_t nowMs);

/**
 * @brief Advances polyline interpolation channels to the supplied timestamp.
 * @param polyline Polyline SoA view.
 * @param polylineCount Number of polylines in the view.
 * @param nowMs Current timestamp in milliseconds.
 * @return `true` when at least one polyline still has an active animation.
 */
bool updatePolylineAnimations(
    const PolylineInputView &polyline,
    int polylineCount,
    scalar_t nowMs);

/**
 * @brief Resolves element animation channels and updates pivot-local data.
 * @return `true` when the caller must recompute pivot hierarchy for rendering.
 * @remarks The vector parameters are workspace-owned caches that are updated in
 * place for later pivot resolution and output emission.
 */
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
    ElementAnimDetailStats *detailStats = nullptr,
    bool *outHasActiveAnimations = nullptr);

/**
 * @brief Resolves world-space pivots and billboard bases for each element.
 * @remarks The supplied vectors are workspace caches updated in place for the
 * later draw collection and picking stages.
 */
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
    std::vector<unsigned char> &resolveStates);

/**
 * @brief Result of one auto-direction update pass.
 */
struct AutoDirectionUpdateResult {
  bool hasActiveAnimations;
  bool requiresPivotResolve;
};

/**
 * @brief Updates auto-direction runtime state and derived final values.
 */
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
    scalar_t nowMs);

/**
 * @brief Collects sortable sprite entries from the current workspace state.
 */
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
    std::vector<SpriteEntry> &entries);

/**
 * @brief Collects sortable polyline segment entries from the current workspace state.
 */
void collectPolylineEntries(
    const PolylineInputView &polyline,
    const PolylineNodeInputView &nodes,
    int polylineCount,
    const scalar_t *viewMatrix,
    std::vector<PolylineEntry> &entries);

/**
 * @brief Writes leaderline vertices for the currently visible elements.
 * @return Number of vertices written.
 */
int writeLeaderlineVertices(
    const SpriteInputView &sprite,
    const ElementInputView &element,
    int spriteCount,
    int elementCount,
    const scalar_t *viewMatrix,
    const std::vector<scalar_t> &pivotXValues,
    const std::vector<scalar_t> &pivotYValues,
    const std::vector<scalar_t> &pivotZValues,
    const std::vector<scalar_t> &basisRightXValues,
    const std::vector<scalar_t> &basisRightYValues,
    const std::vector<scalar_t> &basisRightZValues,
    const std::vector<scalar_t> &basisUpXValues,
    const std::vector<scalar_t> &basisUpYValues,
    const std::vector<scalar_t> &basisUpZValues,
    const std::vector<scalar_t> &spriteDistanceScaleFactors,
    float *output,
    std::vector<LeaderlineEntry> *entries);

/**
 * @brief Writes sprite border vertices for the currently visible elements.
 * @return Number of vertices written.
 */
int writeBorderVertices(
    const std::vector<SpriteEntry> &entries,
    const SpriteInputView &sprite,
    const ElementInputView &element,
    int spriteCount,
    const scalar_t *viewMatrix,
    const scalar_t *viewProjection,
    scalar_t aspectRatio,
    scalar_t cameraX,
    scalar_t cameraY,
    scalar_t cameraZ,
    const std::vector<scalar_t> &pivotXValues,
    const std::vector<scalar_t> &pivotYValues,
    const std::vector<scalar_t> &pivotZValues,
    const std::vector<scalar_t> &spriteDistanceScaleFactors,
    const std::vector<TextureInfo> &textures,
    float *output,
    int vertexOffsetStart,
    std::vector<int> &elementVertexStarts,
    std::vector<int> &elementVertexCounts);

/**
 * @brief Writes polyline vertices for the currently visible segments.
 * @return Number of vertices written.
 */
int writePolylineVertices(
    const std::vector<PolylineEntry> &entries,
    const PolylineInputView &polyline,
    const PolylineNodeInputView &nodes,
    int polylineCount,
    const std::vector<scalar_t> &polylineNodeScaleFactors,
    float *output,
    int vertexOffsetStart,
    std::vector<scalar_t> &nodeLengths,
    std::vector<int> &entryVertexStarts,
    std::vector<int> &entryVertexCounts);

/**
 * @brief Optional debug output channels populated during vertex emission.
 * @remarks Any null pointer disables the corresponding channel.
 */
struct EntryDebugBuffers {
  std::vector<int> *entryElementIndices;
  std::vector<int> *entryBillboardSolveModes;
  std::vector<scalar_t> *entryBillboardScreenFromDeg;
  std::vector<scalar_t> *entryBillboardScreenToDeg;
  std::vector<scalar_t> *entryBillboardScreenAngleDeg;
  std::vector<scalar_t> *entryRotateDeg;
  std::vector<scalar_t> *entryFinalRotateDeg;
  std::vector<scalar_t> *entryRotationFromDeg;
  std::vector<scalar_t> *entryRotationToDeg;
  std::vector<scalar_t> *entryRotationDurationMs;
  std::vector<scalar_t> *entryFinalRotationFromDeg;
  std::vector<scalar_t> *entryFinalRotationToDeg;
  std::vector<scalar_t> *entryFinalRotationDurationMs;
};

/**
 * @brief Writes sprite vertices for the supplied sorted entries.
 * @return Number of sprite output quads written to @p output.
 * @remarks The function can reuse prior output ordering when the camera and
 * entry signatures match, reducing redundant writes on cached frames.
 */
int writeOutputVertices(
    const std::vector<SpriteEntry> &entries,
    const SpriteInputView &sprite,
    const ElementInputView &element,
    int spriteCount,
    const scalar_t *viewMatrix,
    const scalar_t *viewProjection,
    scalar_t aspectRatio,
    scalar_t cameraX,
    scalar_t cameraY,
    scalar_t cameraZ,
    scalar_t nowMs,
    const std::vector<scalar_t> &pivotXValues,
    const std::vector<scalar_t> &pivotYValues,
    const std::vector<scalar_t> &pivotZValues,
    const std::vector<scalar_t> &spriteDistanceScaleFactors,
    const std::vector<unsigned char> &pivotCameraDependentFlags,
    const std::vector<TextureInfo> &textures,
    float *output,
    int *outTexIndices,
    std::vector<int> &entryOutputIndices,
    std::vector<int> &entryOutputCounts,
    EntryDebugBuffers *entryDebug,
    std::vector<std::uint64_t> &outputSignatures,
    bool reuseOutput,
    std::uint64_t cameraSignature,
    int outputEntryCount);

}
