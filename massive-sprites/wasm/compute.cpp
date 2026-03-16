// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

#include <algorithm>
#include <cmath>
#include <cstring>
#include <functional>
#include <limits>
#include <new>
#include <vector>

#include "compute_command_helpers.h"
#include "compute_billboard.h"

///////////////////////////////////////////////////////////////////////////////////////////////

using namespace msp_wasm::detail;

namespace {

/**
 * @brief Orders sprite entries in the same sequence used for final quad emission.
 */
static constexpr inline bool spriteEntryLess(
    const msp_wasm::SpriteEntry &lhs,
    const msp_wasm::SpriteEntry &rhs) {
  if (lhs.layer != rhs.layer) {
    return lhs.layer < rhs.layer;
  }
  if (lhs.spriteDepth != rhs.spriteDepth) {
    return lhs.spriteDepth < rhs.spriteDepth;
  }
  if (lhs.order != rhs.order) {
    return lhs.order < rhs.order;
  }
  if (lhs.elementDepth != rhs.elementDepth) {
    return lhs.elementDepth < rhs.elementDepth;
  }
  return lhs.index < rhs.index;
}

/**
 * @brief Orders polyline segment entries for stable draw emission.
 */
static constexpr inline bool polylineEntryLess(
    const msp_wasm::PolylineEntry &lhs,
    const msp_wasm::PolylineEntry &rhs) {
  if (lhs.layer != rhs.layer) {
    return lhs.layer < rhs.layer;
  }
  if (lhs.depth != rhs.depth) {
    return lhs.depth < rhs.depth;
  }
  if (lhs.order != rhs.order) {
    return lhs.order < rhs.order;
  }
  return lhs.segmentIndex < rhs.segmentIndex;
}

/**
 * @brief Orders deferred leaderline entries alongside sprite depth ordering.
 */
static constexpr inline bool leaderlineEntryLess(
    const msp_wasm::LeaderlineEntry &lhs,
    const msp_wasm::LeaderlineEntry &rhs) {
  if (lhs.layer != rhs.layer) {
    return lhs.layer < rhs.layer;
  }
  if (lhs.depth != rhs.depth) {
    return lhs.depth < rhs.depth;
  }
  if (lhs.order != rhs.order) {
    return lhs.order < rhs.order;
  }
  return lhs.elementIndex < rhs.elementIndex;
}

constexpr scalar_t CAMERA_TRACKING_EPSILON = static_cast<scalar_t>(1.0e-6f);

struct TrackingVector3 {
  scalar_t x;
  scalar_t y;
  scalar_t z;
};

struct TrackingBasis {
  TrackingVector3 right;
  TrackingVector3 up;
  TrackingVector3 forward;
};

struct TrackingBoundsAccumulator {
  scalar_t minX;
  scalar_t minY;
  scalar_t minZ;
  scalar_t maxX;
  scalar_t maxY;
  scalar_t maxZ;
  int count;
};

struct CameraTrackingSolution {
  TrackingVector3 center;
  scalar_t baseDistance;
  scalar_t distance;
};

struct CameraTrackingStepResult {
  bool hasSolution;
  bool cameraApplied;
  scalar_t resolvedDistance;
};

static inline bool isFinitePositiveTracking(scalar_t value) {
  return std::isfinite(value) && value > static_cast<scalar_t>(0.0f);
}

static inline scalar_t normalizePositiveTracking(
    scalar_t value,
    scalar_t fallback) {
  return isFinitePositiveTracking(value) ? value : fallback;
}

static inline scalar_t clampTrackingDistance(scalar_t distance) {
  return std::max(
      CAMERA_TRACKING_EPSILON,
      std::isfinite(distance) ? distance : static_cast<scalar_t>(0.0f));
}

static inline scalar_t resolveTrackingMinDistance(
    const CameraTrackingConfig &tracking) {
  if (!isFinitePositiveTracking(tracking.minDistance)) {
    return CAMERA_TRACKING_EPSILON;
  }
  return std::max(CAMERA_TRACKING_EPSILON, tracking.minDistance);
}

static inline scalar_t resolveCameraTrackingDistanceValue(
    scalar_t baseDistance,
    const CameraTrackingConfig &tracking,
    bool fitMode) {
  const scalar_t zoomBias =
      fitMode
          ? normalizePositiveTracking(
                tracking.fitZoomBias, CAMERA_TRACKING_DEFAULT_ZOOM_BIAS)
          : static_cast<scalar_t>(1.0f);
  return std::max(
      resolveTrackingMinDistance(tracking),
      clampTrackingDistance(baseDistance * zoomBias));
}

static inline scalar_t dotTracking3(
    const TrackingVector3 &lhs,
    const TrackingVector3 &rhs) {
  return lhs.x * rhs.x + lhs.y * rhs.y + lhs.z * rhs.z;
}

static inline TrackingVector3 addTrackingScaled3(
    const TrackingVector3 &base,
    const TrackingVector3 &direction,
    scalar_t scale) {
  return TrackingVector3{
      base.x + direction.x * scale,
      base.y + direction.y * scale,
      base.z + direction.z * scale};
}

static inline TrackingVector3 subtractTracking3(
    const TrackingVector3 &lhs,
    const TrackingVector3 &rhs) {
  return TrackingVector3{lhs.x - rhs.x, lhs.y - rhs.y, lhs.z - rhs.z};
}

static inline TrackingBoundsAccumulator createTrackingBoundsAccumulator() {
  const scalar_t limit = std::numeric_limits<scalar_t>::max();
  return TrackingBoundsAccumulator{
      limit,
      limit,
      limit,
      -limit,
      -limit,
      -limit,
      0};
}

static inline TrackingBasis resolveTrackingCameraBasis(const scalar_t *camera) {
  const scalar_t yawRad =
      camera[CAMERA_ROTATION_YAW_OFFSET] * msp_wasm::kDegToRad;
  const scalar_t pitchRad =
      camera[CAMERA_ROTATION_PITCH_OFFSET] * msp_wasm::kDegToRad;
  const scalar_t rollRad =
      camera[CAMERA_ROTATION_ROLL_OFFSET] * msp_wasm::kDegToRad;
  const scalar_t cosZ = std::cos(yawRad);
  const scalar_t sinZ = std::sin(yawRad);
  const scalar_t cosX = std::cos(pitchRad);
  const scalar_t sinX = std::sin(pitchRad);
  const scalar_t cosY = std::cos(rollRad);
  const scalar_t sinY = std::sin(rollRad);
  return TrackingBasis{
      TrackingVector3{
          cosZ * cosY + sinZ * sinX * sinY,
          sinZ * cosY - cosZ * sinX * sinY,
          -cosX * sinY},
      TrackingVector3{-sinZ * cosX, cosZ * cosX, sinX},
      TrackingVector3{
          -cosZ * sinY - sinZ * sinX * cosY,
          -sinZ * sinY + cosZ * sinX * cosY,
          -cosX * cosY}};
}

static inline void includeTrackingPoint(
    TrackingBoundsAccumulator &bounds,
    const TrackingBasis &basis,
    const TrackingVector3 &point) {
  const scalar_t localX = dotTracking3(point, basis.right);
  const scalar_t localY = dotTracking3(point, basis.up);
  const scalar_t localZ = dotTracking3(point, basis.forward);
  bounds.minX = std::min(bounds.minX, localX);
  bounds.minY = std::min(bounds.minY, localY);
  bounds.minZ = std::min(bounds.minZ, localZ);
  bounds.maxX = std::max(bounds.maxX, localX);
  bounds.maxY = std::max(bounds.maxY, localY);
  bounds.maxZ = std::max(bounds.maxZ, localZ);
  bounds.count += 1;
}

static inline void includeTrackingOrientedRect(
    TrackingBoundsAccumulator &bounds,
    const TrackingBasis &trackingBasis,
    const TrackingVector3 &center,
    const TrackingVector3 &localRight,
    const TrackingVector3 &localUp,
    scalar_t halfWidth,
    scalar_t halfHeight) {
  const scalar_t centerX = dotTracking3(center, trackingBasis.right);
  const scalar_t centerY = dotTracking3(center, trackingBasis.up);
  const scalar_t centerZ = dotTracking3(center, trackingBasis.forward);
  const scalar_t extentX =
      std::abs(dotTracking3(localRight, trackingBasis.right)) * halfWidth +
      std::abs(dotTracking3(localUp, trackingBasis.right)) * halfHeight;
  const scalar_t extentY =
      std::abs(dotTracking3(localRight, trackingBasis.up)) * halfWidth +
      std::abs(dotTracking3(localUp, trackingBasis.up)) * halfHeight;
  const scalar_t extentZ =
      std::abs(dotTracking3(localRight, trackingBasis.forward)) * halfWidth +
      std::abs(dotTracking3(localUp, trackingBasis.forward)) * halfHeight;
  bounds.minX = std::min(bounds.minX, centerX - extentX);
  bounds.minY = std::min(bounds.minY, centerY - extentY);
  bounds.minZ = std::min(bounds.minZ, centerZ - extentZ);
  bounds.maxX = std::max(bounds.maxX, centerX + extentX);
  bounds.maxY = std::max(bounds.maxY, centerY + extentY);
  bounds.maxZ = std::max(bounds.maxZ, centerZ + extentZ);
  bounds.count += 1;
}

static inline scalar_t resolveTrackingBoundsBaseDistance(
    const scalar_t *camera,
    const TrackingBoundsAccumulator &bounds,
    scalar_t padding) {
  if (bounds.count <= 0) {
    return static_cast<scalar_t>(0.0f);
  }
  const scalar_t centerX = (bounds.minX + bounds.maxX) * static_cast<scalar_t>(0.5f);
  const scalar_t centerY = (bounds.minY + bounds.maxY) * static_cast<scalar_t>(0.5f);
  const scalar_t centerZ = (bounds.minZ + bounds.maxZ) * static_cast<scalar_t>(0.5f);
  const scalar_t xs[2] = {bounds.minX - centerX, bounds.maxX - centerX};
  const scalar_t ys[2] = {bounds.minY - centerY, bounds.maxY - centerY};
  const scalar_t zs[2] = {bounds.minZ - centerZ, bounds.maxZ - centerZ};
  const scalar_t fovYRad =
      camera[CAMERA_FOV_Y_OFFSET] * msp_wasm::kDegToRad;
  const scalar_t tanHalfY = std::tan(fovYRad * static_cast<scalar_t>(0.5f));
  const scalar_t aspectRatio = isFinitePositiveTracking(
                                   camera[CAMERA_VIEWPORT_ASPECT_OFFSET])
      ? camera[CAMERA_VIEWPORT_ASPECT_OFFSET]
      : static_cast<scalar_t>(1.0f);
  const scalar_t tanHalfX = tanHalfY * aspectRatio;
  scalar_t distance = CAMERA_TRACKING_EPSILON;
  for (const scalar_t localX : xs) {
    for (const scalar_t localY : ys) {
      for (const scalar_t localZ : zs) {
        if (tanHalfX > CAMERA_TRACKING_EPSILON) {
          distance = std::max(
              distance,
              (std::abs(localX) * padding) / tanHalfX - localZ);
        }
        if (tanHalfY > CAMERA_TRACKING_EPSILON) {
          distance = std::max(
              distance,
              (std::abs(localY) * padding) / tanHalfY - localZ);
        }
      }
    }
  }
  return clampTrackingDistance(distance);
}

static inline TrackingVector3 resolveTrackingBoundsCenter(
    const TrackingBoundsAccumulator &bounds,
    const TrackingBasis &basis) {
  const scalar_t centerX = (bounds.minX + bounds.maxX) * static_cast<scalar_t>(0.5f);
  const scalar_t centerY = (bounds.minY + bounds.maxY) * static_cast<scalar_t>(0.5f);
  const scalar_t centerZ = (bounds.minZ + bounds.maxZ) * static_cast<scalar_t>(0.5f);
  return TrackingVector3{
      basis.right.x * centerX + basis.up.x * centerY + basis.forward.x * centerZ,
      basis.right.y * centerX + basis.up.y * centerY + basis.forward.y * centerZ,
      basis.right.z * centerX + basis.up.z * centerY + basis.forward.z * centerZ};
}

static inline void resolveElementTrackingBasis(
    int renderMode,
    const TrackingVector3 &pivot,
    const TrackingVector3 &cameraPosition,
    const TrackingBasis &cameraBasis,
    TrackingVector3 &basisRight,
    TrackingVector3 &basisUp) {
  basisRight = TrackingVector3{
      static_cast<scalar_t>(1.0f),
      static_cast<scalar_t>(0.0f),
      static_cast<scalar_t>(0.0f)};
  basisUp = TrackingVector3{
      static_cast<scalar_t>(0.0f),
      static_cast<scalar_t>(1.0f),
      static_cast<scalar_t>(0.0f)};
  if (renderMode == COMMON_RENDER_MODE_BILLBOARD) {
    basisRight = cameraBasis.right;
    basisUp = cameraBasis.up;
    return;
  }
  if (renderMode == COMMON_RENDER_MODE_BILLBOARD_PERSPECTIVE) {
    scalar_t rightX = static_cast<scalar_t>(1.0f);
    scalar_t rightY = static_cast<scalar_t>(0.0f);
    scalar_t rightZ = static_cast<scalar_t>(0.0f);
    scalar_t upX = static_cast<scalar_t>(0.0f);
    scalar_t upY = static_cast<scalar_t>(1.0f);
    scalar_t upZ = static_cast<scalar_t>(0.0f);
    msp_wasm::detail::resolveBillboardBasisFromForward(
        cameraPosition.x - pivot.x,
        cameraPosition.y - pivot.y,
        cameraPosition.z - pivot.z,
        rightX,
        rightY,
        rightZ,
        upX,
        upY,
        upZ);
    basisRight = TrackingVector3{rightX, rightY, rightZ};
    basisUp = TrackingVector3{upX, upY, upZ};
  }
}

static inline scalar_t resolveSingleTargetBaseDistance(
    const scalar_t *camera,
    const TrackingVector3 &target,
    const CameraTrackingConfig &tracking) {
  if (isFinitePositiveTracking(tracking.resolvedDistance)) {
    return tracking.resolvedDistance;
  }
  const scalar_t dx = target.x - camera[CAMERA_POSITION_X_OFFSET];
  const scalar_t dy = target.y - camera[CAMERA_POSITION_Y_OFFSET];
  const scalar_t dz = target.z - camera[CAMERA_POSITION_Z_OFFSET];
  return clampTrackingDistance(std::sqrt(dx * dx + dy * dy + dz * dz));
}

static inline bool resolveBaseTrackingSolution(
    const CameraTrackingConfig &tracking,
    const msp_wasm::SpriteInputView &sprite,
    int spriteCount,
    const scalar_t *camera,
    CameraTrackingSolution &solution) {
  scalar_t sumX = static_cast<scalar_t>(0.0f);
  scalar_t sumY = static_cast<scalar_t>(0.0f);
  scalar_t sumZ = static_cast<scalar_t>(0.0f);
  int visibleCount = 0;
  TrackingVector3 singleTarget{
      static_cast<scalar_t>(0.0f),
      static_cast<scalar_t>(0.0f),
      static_cast<scalar_t>(0.0f)};
  for (const int spriteSlot : tracking.spriteSlots) {
    if (spriteSlot < 0 || spriteSlot >= spriteCount) {
      continue;
    }
    if (!(sprite.renderOpacityValues[spriteSlot] > static_cast<scalar_t>(0.0f))) {
      continue;
    }
    const TrackingVector3 target{
        sprite.xValues[spriteSlot],
        sprite.yValues[spriteSlot],
        sprite.zValues[spriteSlot]};
    if (visibleCount == 0) {
      singleTarget = target;
    }
    sumX += target.x;
    sumY += target.y;
    sumZ += target.z;
    visibleCount += 1;
  }
  if (visibleCount <= 0) {
    return false;
  }
  if (visibleCount == 1) {
    const scalar_t baseDistance =
        resolveSingleTargetBaseDistance(camera, singleTarget, tracking);
    solution = CameraTrackingSolution{
        singleTarget,
        baseDistance,
        resolveCameraTrackingDistanceValue(baseDistance, tracking, false)};
    return true;
  }

  const TrackingBasis basis = resolveTrackingCameraBasis(camera);
  const TrackingVector3 origin{
      sumX / static_cast<scalar_t>(visibleCount),
      sumY / static_cast<scalar_t>(visibleCount),
      sumZ / static_cast<scalar_t>(visibleCount)};
  const scalar_t limit = std::numeric_limits<scalar_t>::max();
  scalar_t minX = limit;
  scalar_t minY = limit;
  scalar_t minZ = limit;
  scalar_t maxX = -limit;
  scalar_t maxY = -limit;
  scalar_t maxZ = -limit;

  for (const int spriteSlot : tracking.spriteSlots) {
    if (spriteSlot < 0 || spriteSlot >= spriteCount) {
      continue;
    }
    if (!(sprite.renderOpacityValues[spriteSlot] > static_cast<scalar_t>(0.0f))) {
      continue;
    }
    const TrackingVector3 target{
        sprite.xValues[spriteSlot],
        sprite.yValues[spriteSlot],
        sprite.zValues[spriteSlot]};
    const TrackingVector3 delta = subtractTracking3(target, origin);
    const scalar_t localX = dotTracking3(delta, basis.right);
    const scalar_t localY = dotTracking3(delta, basis.up);
    const scalar_t localZ = dotTracking3(delta, basis.forward);
    minX = std::min(minX, localX);
    minY = std::min(minY, localY);
    minZ = std::min(minZ, localZ);
    maxX = std::max(maxX, localX);
    maxY = std::max(maxY, localY);
    maxZ = std::max(maxZ, localZ);
  }

  const TrackingBoundsAccumulator bounds{
      minX, minY, minZ, maxX, maxY, maxZ, visibleCount};
  const TrackingVector3 centerLocal{
      (bounds.minX + bounds.maxX) * static_cast<scalar_t>(0.5f),
      (bounds.minY + bounds.maxY) * static_cast<scalar_t>(0.5f),
      (bounds.minZ + bounds.maxZ) * static_cast<scalar_t>(0.5f)};
  const TrackingVector3 center = addTrackingScaled3(
      addTrackingScaled3(
          addTrackingScaled3(origin, basis.right, centerLocal.x),
          basis.up,
          centerLocal.y),
      basis.forward,
      centerLocal.z);
  const scalar_t fitPadding =
      normalizePositiveTracking(
          tracking.fitPadding, CAMERA_TRACKING_DEFAULT_FIT_PADDING);
  const scalar_t baseDistance =
      resolveTrackingBoundsBaseDistance(camera, bounds, fitPadding);
  solution = CameraTrackingSolution{
      center,
      baseDistance,
      resolveCameraTrackingDistanceValue(baseDistance, tracking, true)};
  return true;
}

static inline bool resolveContentApproxTrackingSolution(
    const CameraTrackingConfig &tracking,
    const std::vector<SpriteMeta> &sprites,
    const msp_wasm::SpriteInputView &sprite,
    const msp_wasm::ElementInputView &element,
    int spriteCount,
    int elementCount,
    const std::vector<scalar_t> &pivotXValues,
    const std::vector<scalar_t> &pivotYValues,
    const std::vector<scalar_t> &pivotZValues,
    const std::vector<scalar_t> &spriteDistanceScaleFactors,
    const std::vector<unsigned char> &geometryEnabled,
    const scalar_t *camera,
    CameraTrackingSolution &solution) {
  const TrackingBasis trackingBasis = resolveTrackingCameraBasis(camera);
  const TrackingVector3 cameraPosition{
      camera[CAMERA_POSITION_X_OFFSET],
      camera[CAMERA_POSITION_Y_OFFSET],
      camera[CAMERA_POSITION_Z_OFFSET]};
  TrackingBoundsAccumulator bounds = createTrackingBoundsAccumulator();

  for (const int spriteSlot : tracking.spriteSlots) {
    if (spriteSlot < 0 || spriteSlot >= spriteCount ||
        spriteSlot >= static_cast<int>(sprites.size())) {
      continue;
    }
    const scalar_t spriteOpacity = sprite.renderOpacityValues[spriteSlot];
    if (!(spriteOpacity > static_cast<scalar_t>(0.0f))) {
      continue;
    }
    const TrackingVector3 spriteBase{
        sprite.xValues[spriteSlot],
        sprite.yValues[spriteSlot],
        sprite.zValues[spriteSlot]};
    const auto &spriteMeta = sprites[static_cast<size_t>(spriteSlot)];
    for (const auto &elementMeta : spriteMeta.elements) {
      const int elementIndex = elementMeta.slot;
      if (elementIndex < 0 || elementIndex >= elementCount ||
          static_cast<size_t>(elementIndex) >= geometryEnabled.size() ||
          static_cast<size_t>(elementIndex) >= pivotXValues.size() ||
          static_cast<size_t>(elementIndex) >= pivotYValues.size() ||
          static_cast<size_t>(elementIndex) >= pivotZValues.size()) {
        continue;
      }
      if (geometryEnabled[static_cast<size_t>(elementIndex)] == 0) {
        continue;
      }
      const scalar_t effectiveOpacity =
          resolveElementRenderOpacity(sprite, element, spriteCount, elementIndex);
      if (!(effectiveOpacity > static_cast<scalar_t>(0.0f))) {
        continue;
      }
      const int ownerSlot = static_cast<int>(element.ownerSlotValues[elementIndex]);
      const scalar_t distanceScale =
          ownerSlot >= 0 &&
                  static_cast<size_t>(ownerSlot) < spriteDistanceScaleFactors.size()
              ? spriteDistanceScaleFactors[static_cast<size_t>(ownerSlot)]
              : static_cast<scalar_t>(1.0f);
      TrackingVector3 parentPivot = spriteBase;
      TrackingVector3 parentBasisRight{
          static_cast<scalar_t>(1.0f),
          static_cast<scalar_t>(0.0f),
          static_cast<scalar_t>(0.0f)};
      TrackingVector3 parentBasisUp{
          static_cast<scalar_t>(0.0f),
          static_cast<scalar_t>(1.0f),
          static_cast<scalar_t>(0.0f)};
      const int originLocationSlot =
          static_cast<int>(element.originLocationSlotValues[elementIndex]);
      const bool hasOriginLocation =
          originLocationSlot >= 0 && originLocationSlot < elementCount &&
          originLocationSlot != elementIndex &&
          static_cast<size_t>(originLocationSlot) < pivotXValues.size() &&
          static_cast<size_t>(originLocationSlot) < pivotYValues.size() &&
          static_cast<size_t>(originLocationSlot) < pivotZValues.size();
      if (hasOriginLocation) {
        parentPivot = TrackingVector3{
            pivotXValues[static_cast<size_t>(originLocationSlot)],
            pivotYValues[static_cast<size_t>(originLocationSlot)],
            pivotZValues[static_cast<size_t>(originLocationSlot)]};
        resolveElementTrackingBasis(
            static_cast<int>(element.renderModeValues[originLocationSlot]),
            parentPivot,
            cameraPosition,
            trackingBasis,
            parentBasisRight,
            parentBasisUp);
        if (element.originLocationUseResolvedAnchorValues[elementIndex] ==
            static_cast<scalar_t>(0.0f)) {
          const int parentOwnerSlot =
              static_cast<int>(element.ownerSlotValues[originLocationSlot]);
          const scalar_t parentDistanceScale =
              parentOwnerSlot >= 0 &&
                      static_cast<size_t>(parentOwnerSlot) <
                          spriteDistanceScaleFactors.size()
                  ? spriteDistanceScaleFactors[static_cast<size_t>(parentOwnerSlot)]
                  : static_cast<scalar_t>(1.0f);
          const scalar_t parentScale =
              element.scaleValues[originLocationSlot] * parentDistanceScale;
          const scalar_t parentHalfWidth =
              element.widthValues[originLocationSlot] * parentScale *
              static_cast<scalar_t>(0.5f);
          const scalar_t parentHalfHeight =
              element.heightValues[originLocationSlot] * parentScale *
              static_cast<scalar_t>(0.5f);
          const scalar_t parentAnchorOffsetX =
              element.anchorXValues[originLocationSlot] * parentHalfWidth;
          const scalar_t parentAnchorOffsetY =
              element.anchorYValues[originLocationSlot] * parentHalfHeight;
          parentPivot = addTrackingScaled3(
              addTrackingScaled3(
                  parentPivot, parentBasisRight, -parentAnchorOffsetX),
              parentBasisUp,
              -parentAnchorOffsetY);
        }
      }

      const scalar_t leaderlineWidth =
          element.leaderlineWidthValues[elementIndex] * distanceScale;
      if (leaderlineWidth > CAMERA_TRACKING_EPSILON) {
        includeTrackingPoint(bounds, trackingBasis, parentPivot);
      }

      const scalar_t scale = element.scaleValues[elementIndex] * distanceScale;
      const scalar_t halfWidth =
          element.widthValues[elementIndex] * scale * static_cast<scalar_t>(0.5f);
      const scalar_t halfHeight =
          element.heightValues[elementIndex] * scale * static_cast<scalar_t>(0.5f);
      if (!(halfWidth > static_cast<scalar_t>(0.0f) ||
            halfHeight > static_cast<scalar_t>(0.0f))) {
        continue;
      }

      const scalar_t visibleHalfWidth =
          halfWidth + std::max(static_cast<scalar_t>(0.0f), element.borderWidthValues[elementIndex]);
      const scalar_t visibleHalfHeight =
          halfHeight + std::max(static_cast<scalar_t>(0.0f), element.borderWidthValues[elementIndex]);
      const TrackingVector3 pivot{
          pivotXValues[static_cast<size_t>(elementIndex)],
          pivotYValues[static_cast<size_t>(elementIndex)],
          pivotZValues[static_cast<size_t>(elementIndex)]};
      TrackingVector3 basisRight{
          static_cast<scalar_t>(1.0f),
          static_cast<scalar_t>(0.0f),
          static_cast<scalar_t>(0.0f)};
      TrackingVector3 basisUp{
          static_cast<scalar_t>(0.0f),
          static_cast<scalar_t>(1.0f),
          static_cast<scalar_t>(0.0f)};
      resolveElementTrackingBasis(
          static_cast<int>(element.renderModeValues[elementIndex]),
          pivot,
          cameraPosition,
          trackingBasis,
          basisRight,
          basisUp);
      const scalar_t anchorOffsetX =
          element.anchorXValues[elementIndex] * halfWidth;
      const scalar_t anchorOffsetY =
          element.anchorYValues[elementIndex] * halfHeight;
      const TrackingVector3 center = addTrackingScaled3(
          addTrackingScaled3(pivot, basisRight, -anchorOffsetX),
          basisUp,
          -anchorOffsetY);

      if (element.autoDirectionShiftAngleRotationValues[elementIndex] !=
              static_cast<scalar_t>(0.0f) &&
          std::isfinite(element.shiftDistanceValues[elementIndex]) &&
          std::abs(element.shiftDistanceValues[elementIndex]) >
              CAMERA_TRACKING_EPSILON) {
        const scalar_t centerX = dotTracking3(center, trackingBasis.right);
        const scalar_t centerY = dotTracking3(center, trackingBasis.up);
        const scalar_t centerZ = dotTracking3(center, trackingBasis.forward);
        const scalar_t shapeExtentX =
            std::abs(dotTracking3(basisRight, trackingBasis.right)) *
                visibleHalfWidth +
            std::abs(dotTracking3(basisUp, trackingBasis.right)) *
                visibleHalfHeight;
        const scalar_t shapeExtentY =
            std::abs(dotTracking3(basisRight, trackingBasis.up)) *
                visibleHalfWidth +
            std::abs(dotTracking3(basisUp, trackingBasis.up)) *
                visibleHalfHeight;
        const scalar_t shapeExtentZ =
            std::abs(dotTracking3(basisRight, trackingBasis.forward)) *
                visibleHalfWidth +
            std::abs(dotTracking3(basisUp, trackingBasis.forward)) *
                visibleHalfHeight;
        const scalar_t orbitDistance =
            std::abs(element.shiftDistanceValues[elementIndex]);
        const scalar_t parentRightX =
            dotTracking3(parentBasisRight, trackingBasis.right);
        const scalar_t parentUpX =
            dotTracking3(parentBasisUp, trackingBasis.right);
        const scalar_t parentRightY =
            dotTracking3(parentBasisRight, trackingBasis.up);
        const scalar_t parentUpY =
            dotTracking3(parentBasisUp, trackingBasis.up);
        const scalar_t parentRightZ =
            dotTracking3(parentBasisRight, trackingBasis.forward);
        const scalar_t parentUpZ =
            dotTracking3(parentBasisUp, trackingBasis.forward);
        const scalar_t orbitExtentX =
            orbitDistance *
            std::sqrt(parentRightX * parentRightX + parentUpX * parentUpX);
        const scalar_t orbitExtentY =
            orbitDistance *
            std::sqrt(parentRightY * parentRightY + parentUpY * parentUpY);
        const scalar_t orbitExtentZ =
            orbitDistance *
            std::sqrt(parentRightZ * parentRightZ + parentUpZ * parentUpZ);
        bounds.minX = std::min(bounds.minX, centerX - (shapeExtentX + orbitExtentX));
        bounds.minY = std::min(bounds.minY, centerY - (shapeExtentY + orbitExtentY));
        bounds.minZ = std::min(bounds.minZ, centerZ - (shapeExtentZ + orbitExtentZ));
        bounds.maxX = std::max(bounds.maxX, centerX + shapeExtentX + orbitExtentX);
        bounds.maxY = std::max(bounds.maxY, centerY + shapeExtentY + orbitExtentY);
        bounds.maxZ = std::max(bounds.maxZ, centerZ + shapeExtentZ + orbitExtentZ);
        bounds.count += 1;
        continue;
      }

      includeTrackingOrientedRect(
          bounds,
          trackingBasis,
          center,
          basisRight,
          basisUp,
          visibleHalfWidth,
          visibleHalfHeight);
    }
  }

  if (bounds.count <= 0) {
    return false;
  }

  const TrackingVector3 center =
      resolveTrackingBoundsCenter(bounds, trackingBasis);
  const scalar_t fitPadding =
      normalizePositiveTracking(
          tracking.fitPadding, CAMERA_TRACKING_DEFAULT_FIT_PADDING);
  const scalar_t fitBaseDistance =
      resolveTrackingBoundsBaseDistance(camera, bounds, fitPadding);
  const scalar_t dx = center.x - camera[CAMERA_POSITION_X_OFFSET];
  const scalar_t dy = center.y - camera[CAMERA_POSITION_Y_OFFSET];
  const scalar_t dz = center.z - camera[CAMERA_POSITION_Z_OFFSET];
  const scalar_t currentDistance = std::sqrt(dx * dx + dy * dy + dz * dz);
  const bool fitMode = tracking.spriteSlots.size() > 1;
  const scalar_t baseDistance =
      !fitMode
          ? std::max(
                fitBaseDistance,
                isFinitePositiveTracking(tracking.resolvedDistance)
                    ? tracking.resolvedDistance
                    : currentDistance)
          : fitBaseDistance;
  solution = CameraTrackingSolution{
      center,
      baseDistance,
      resolveCameraTrackingDistanceValue(baseDistance, tracking, fitMode)};
  return true;
}

static inline ValueCommand createCameraTrackingValueCommand(
    const CameraTrackingConfig &tracking,
    scalar_t value) {
  ValueCommand command{};
  command.has = true;
  command.value = value;
  if (tracking.interpolation.kind == CAMERA_TRACKING_INTERPOLATION_SET &&
      tracking.interpolation.duration > static_cast<scalar_t>(0.0f)) {
    command.hasInterpolation = true;
    command.keepInterpolation = false;
    command.mode = tracking.interpolation.mode;
    command.duration = tracking.interpolation.duration;
    command.easing = tracking.interpolation.easing;
    command.param0 = tracking.interpolation.param0;
    command.param1 = tracking.interpolation.param1;
    command.param2 = tracking.interpolation.param2;
    command.param3 = tracking.interpolation.param3;
    return command;
  }
  command.hasInterpolation = false;
  command.keepInterpolation =
      tracking.interpolation.kind == CAMERA_TRACKING_INTERPOLATION_KEEP;
  if (!command.keepInterpolation) {
    command.mode = static_cast<scalar_t>(INTERPOLATION_MODE_FEEDBACK);
    command.duration = static_cast<scalar_t>(0.0f);
    command.easing = static_cast<scalar_t>(INTERPOLATION_EASING_LINEAR);
    command.param0 = static_cast<scalar_t>(0.0f);
    command.param1 = static_cast<scalar_t>(0.0f);
    command.param2 = static_cast<scalar_t>(0.0f);
    command.param3 = static_cast<scalar_t>(0.0f);
  }
  return command;
}

/**
 * @brief Normalizes a direction vector in place.
 * @return `true` when the vector had finite, non-zero length.
 */
static constexpr inline bool normalizeDirection(
    scalar_t &x,
    scalar_t &y,
    scalar_t &z) {
  const scalar_t length = std::sqrt(x * x + y * y + z * z);
  if (!isFiniteScalar(length) || length <= static_cast<scalar_t>(0.0f)) {
    return false;
  }
  const scalar_t inv = static_cast<scalar_t>(1.0f) / length;
  x *= inv;
  y *= inv;
  z *= inv;
  return true;
}

/**
 * @brief Rotates a direction vector by the supplied 3x3 part of a 4x4 matrix.
 */
static constexpr inline void rotateDirection(
    const scalar_t *rotationMatrix,
    scalar_t x,
    scalar_t y,
    scalar_t z,
    scalar_t &outX,
    scalar_t &outY,
    scalar_t &outZ) {
  outX = rotationMatrix[0] * x + rotationMatrix[4] * y + rotationMatrix[8] * z;
  outY = rotationMatrix[1] * x + rotationMatrix[5] * y + rotationMatrix[9] * z;
  outZ = rotationMatrix[2] * x + rotationMatrix[6] * y + rotationMatrix[10] * z;
}

struct InterpolationSample {
  scalar_t value;
  scalar_t hasInterpolation;
  scalar_t fromValue;
  scalar_t toValue;
  scalar_t mode;
  scalar_t duration;
  scalar_t easing;
  scalar_t param0;
  scalar_t param1;
  scalar_t t;
  scalar_t tEased;
  scalar_t delta;
};

static constexpr inline bool hasStateTimestampOverride(scalar_t nowMs) {
  return isFiniteScalar(nowMs) && nowMs != static_cast<scalar_t>(0.0f);
}

static inline scalar_t resolveStateTimestamp(
    const CommandContext *ctx,
    scalar_t nowMs) {
  if (hasStateTimestampOverride(nowMs)) {
    return nowMs;
  }
  if (ctx && ctx->lastSnapshotValid) {
    return ctx->lastSnapshotTimestampMs;
  }
  return static_cast<scalar_t>(0.0f);
}

static inline void storeSnapshotMetadata(
    CommandContext *ctx,
    scalar_t viewportW,
    scalar_t viewportH,
    scalar_t timestampMs) {
  if (!ctx) {
    return;
  }
  ctx->lastSnapshotTimestampMs = timestampMs;
  ctx->lastSnapshotViewportWidth = viewportW;
  ctx->lastSnapshotViewportHeight = viewportH;
  ctx->lastSnapshotValid =
      isFiniteScalar(viewportW) && isFiniteScalar(viewportH) &&
      viewportW > static_cast<scalar_t>(0.0f) &&
      viewportH > static_cast<scalar_t>(0.0f);
}

template <typename Accessor>
static inline InterpolationSample evaluateInterpolationSample(
    const typename Accessor::Target &target,
    const InterpolationField &field,
    bool useTimestampOverride,
    scalar_t timestampMs,
    bool wrapAngle = false) {
  const scalar_t currentValue = Accessor::get(target, field.valueOffset);
  const scalar_t fromValue = Accessor::get(target, field.fromOffset);
  const scalar_t toValue = Accessor::get(target, field.toOffset);
  const scalar_t mode = Accessor::get(target, field.modeOffset);
  const scalar_t duration = Accessor::get(target, field.durationOffset);
  const scalar_t easing = Accessor::get(target, field.easingOffset);
  const scalar_t param0 = Accessor::get(target, field.param0Offset);
  const scalar_t param1 = Accessor::get(target, field.param1Offset);
  const scalar_t param2 = Accessor::get(target, field.param2Offset);
  const scalar_t param3 = Accessor::get(target, field.param3Offset);
  const scalar_t startMs = Accessor::get(target, field.startOffset);
  const scalar_t delta =
      wrapAngle ? msp_wasm::wrapAngleDelta(toValue - fromValue) : (toValue - fromValue);
  InterpolationSample sample = {
      currentValue,
      duration > static_cast<scalar_t>(0.0f) ? static_cast<scalar_t>(1.0f)
                                             : static_cast<scalar_t>(0.0f),
      fromValue,
      toValue,
      mode,
      duration,
      easing,
      param0,
      param1,
      static_cast<scalar_t>(0.0f),
      static_cast<scalar_t>(0.0f),
      delta,
  };
  if (!useTimestampOverride || !isFiniteScalar(duration) ||
      duration <= static_cast<scalar_t>(0.0f) || !isFiniteScalar(startMs) ||
      !isFiniteScalar(fromValue) || !isFiniteScalar(toValue)) {
    return sample;
  }

  const scalar_t t = (timestampMs - startMs) / duration;
  if (t <= static_cast<scalar_t>(0.0f)) {
    sample.value = fromValue;
    sample.t = static_cast<scalar_t>(0.0f);
    sample.tEased = static_cast<scalar_t>(0.0f);
    sample.hasInterpolation = static_cast<scalar_t>(1.0f);
    return sample;
  }
  if (t >= static_cast<scalar_t>(1.0f)) {
    sample.value = toValue;
    sample.t = static_cast<scalar_t>(1.0f);
    sample.tEased = static_cast<scalar_t>(1.0f);
    sample.hasInterpolation = static_cast<scalar_t>(0.0f);
    sample.duration = static_cast<scalar_t>(0.0f);
    return sample;
  }

  const scalar_t tEased =
      msp_wasm::applyEasingScalar(t, easing, param0, param1, param2, param3);
  sample.value = fromValue + delta * tEased;
  sample.t = t;
  sample.tEased = tEased;
  sample.hasInterpolation = static_cast<scalar_t>(1.0f);
  return sample;
}

template <typename Accessor>
static inline void writeInterpolationState(
    const typename Accessor::Target &target,
    const InterpolationField &field,
    bool useTimestampOverride,
    scalar_t timestampMs,
    bool wrapAngle,
    scalar_t *out,
    int valueOffset,
    int hasInterpolationOffset,
    int fromOffset,
    int toOffset,
    int modeOffset,
    int durationOffset,
    int easingOffset,
    int param0Offset,
    int param1Offset) {
  const InterpolationSample sample = evaluateInterpolationSample<Accessor>(
      target,
      field,
      useTimestampOverride,
      timestampMs,
      wrapAngle);
  out[valueOffset] = sample.value;
  out[hasInterpolationOffset] = sample.hasInterpolation;
  out[fromOffset] = sample.fromValue;
  out[toOffset] = sample.toValue;
  out[modeOffset] = sample.mode;
  out[durationOffset] = sample.duration;
  out[easingOffset] = sample.easing;
  out[param0Offset] = sample.param0;
  out[param1Offset] = sample.param1;
}

/**
 * @brief Computes distance-based sprite scale multipliers from the active camera.
 */
static inline void populateSpriteDistanceScaleFactors(
    const msp_wasm::SpriteInputView &sprite,
    int spriteCount,
    const scalar_t *camera,
    std::vector<scalar_t> &outFactors) {
  if (spriteCount <= 0) {
    return;
  }
  if (outFactors.size() < static_cast<size_t>(spriteCount)) {
    outFactors.resize(
        static_cast<size_t>(spriteCount),
        static_cast<scalar_t>(1.0f));
  }
  scalar_t minDistance = static_cast<scalar_t>(0.0f);
  scalar_t maxDistance = msp_wasm::scalingUnlimitedMaxDistance();
  if (camera) {
    msp_wasm::normalizeScalingRange(
        camera[CAMERA_SPRITE_SCALING_MIN_DISTANCE_OFFSET],
        camera[CAMERA_SPRITE_SCALING_MAX_DISTANCE_OFFSET],
        minDistance,
        maxDistance);
  }
  const bool hasScaling =
      minDistance > static_cast<scalar_t>(0.0f) ||
      msp_wasm::hasFarDistanceScaling(maxDistance);
  if (!camera || !hasScaling) {
    std::fill(
        outFactors.begin(),
        outFactors.begin() + spriteCount,
        static_cast<scalar_t>(1.0f));
    return;
  }
  const scalar_t cameraX = camera[CAMERA_POSITION_X_OFFSET];
  const scalar_t cameraY = camera[CAMERA_POSITION_Y_OFFSET];
  const scalar_t cameraZ = camera[CAMERA_POSITION_Z_OFFSET];
  for (int index = 0; index < spriteCount; ++index) {
    const scalar_t dx = cameraX - sprite.xValues[index];
    const scalar_t dy = cameraY - sprite.yValues[index];
    const scalar_t dz = cameraZ - sprite.zValues[index];
    const scalar_t distance = std::sqrt(dx * dx + dy * dy + dz * dz);
    outFactors[static_cast<size_t>(index)] =
        msp_wasm::calculateDistanceScaleFactor(
            distance,
            minDistance,
            maxDistance);
  }
}

/**
 * @brief Computes distance-based polyline-node scale multipliers from the active camera.
 */
static inline void populatePolylineNodeScaleFactors(
    const msp_wasm::PolylineNodeInputView &nodes,
    int polylineNodeCount,
    const scalar_t *camera,
    std::vector<scalar_t> &outFactors) {
  if (polylineNodeCount <= 0) {
    return;
  }
  if (outFactors.size() < static_cast<size_t>(polylineNodeCount)) {
    outFactors.resize(
        static_cast<size_t>(polylineNodeCount),
        static_cast<scalar_t>(1.0f));
  }
  scalar_t minDistance = static_cast<scalar_t>(0.0f);
  scalar_t maxDistance = msp_wasm::scalingUnlimitedMaxDistance();
  if (camera) {
    msp_wasm::normalizeScalingRange(
        camera[CAMERA_POLYLINE_SCALING_MIN_DISTANCE_OFFSET],
        camera[CAMERA_POLYLINE_SCALING_MAX_DISTANCE_OFFSET],
        minDistance,
        maxDistance);
  }
  const bool hasScaling =
      minDistance > static_cast<scalar_t>(0.0f) ||
      msp_wasm::hasFarDistanceScaling(maxDistance);
  if (!camera || !hasScaling) {
    std::fill(
        outFactors.begin(),
        outFactors.begin() + polylineNodeCount,
        static_cast<scalar_t>(1.0f));
    return;
  }
  const scalar_t cameraX = camera[CAMERA_POSITION_X_OFFSET];
  const scalar_t cameraY = camera[CAMERA_POSITION_Y_OFFSET];
  const scalar_t cameraZ = camera[CAMERA_POSITION_Z_OFFSET];
  for (int index = 0; index < polylineNodeCount; ++index) {
    const scalar_t dx = cameraX - nodes.xValues[index];
    const scalar_t dy = cameraY - nodes.yValues[index];
    const scalar_t dz = cameraZ;
    const scalar_t distance = std::sqrt(dx * dx + dy * dy + dz * dz);
    outFactors[static_cast<size_t>(index)] =
        msp_wasm::calculateDistanceScaleFactor(
            distance,
            minDistance,
            maxDistance);
  }
}

/**
 * @brief Intersects a screen-space ray with a world-space plane parallel to XY.
 * @return `true` when the ray hits the plane in front of the camera.
 */
static constexpr inline bool screenToWorldOnPlane(
    const scalar_t *camera,
    scalar_t screenX,
    scalar_t screenY,
    scalar_t viewportW,
    scalar_t viewportH,
    scalar_t planeZ,
    scalar_t *outXY) {
  if (!isFiniteScalar(screenX) || !isFiniteScalar(screenY) ||
      !isFiniteScalar(viewportW) || !isFiniteScalar(viewportH) ||
      !isFiniteScalar(planeZ) || viewportW <= static_cast<scalar_t>(0.0f) ||
      viewportH <= static_cast<scalar_t>(0.0f)) {
    return false;
  }

  const scalar_t ndcX =
      (screenX / viewportW) * static_cast<scalar_t>(2.0f) -
      static_cast<scalar_t>(1.0f);
  const scalar_t ndcY =
      -((screenY / viewportH) * static_cast<scalar_t>(2.0f) -
        static_cast<scalar_t>(1.0f));

  scalar_t aspectRatio = camera[CAMERA_VIEWPORT_ASPECT_OFFSET];
  if (!isFiniteScalar(aspectRatio) || aspectRatio <= static_cast<scalar_t>(0.0f)) {
    aspectRatio = viewportW / viewportH;
  }

  const scalar_t fovY = camera[CAMERA_FOV_Y_OFFSET];
  if (!isFiniteScalar(fovY)) {
    return false;
  }
  const scalar_t tanHalfFov =
      std::tan(msp_wasm::toRadians(fovY) * static_cast<scalar_t>(0.5f));

  scalar_t dirX = ndcX * tanHalfFov * aspectRatio;
  scalar_t dirY = ndcY * tanHalfFov;
  scalar_t dirZ = static_cast<scalar_t>(-1.0f);
  if (!normalizeDirection(dirX, dirY, dirZ)) {
    return false;
  }

  const scalar_t yaw = camera[CAMERA_ROTATION_YAW_OFFSET];
  const scalar_t pitch = camera[CAMERA_ROTATION_PITCH_OFFSET];
  const scalar_t roll = camera[CAMERA_ROTATION_ROLL_OFFSET];

  scalar_t rotationMatrix[16] = { };
  scalar_t rotationTemp[16] = { };
  msp_wasm::createRotationZXYMatrix(
      msp_wasm::toRadians(yaw),
      msp_wasm::toRadians(pitch),
      msp_wasm::toRadians(roll),
      rotationMatrix,
      rotationTemp);

  scalar_t worldDirX = 0;
  scalar_t worldDirY = 0;
  scalar_t worldDirZ = 0;
  rotateDirection(rotationMatrix, dirX, dirY, dirZ, worldDirX, worldDirY, worldDirZ);

  if (!isFiniteScalar(worldDirZ)) {
    return false;
  }
  const scalar_t epsilon = static_cast<scalar_t>(1.0e-6f);
  if (std::abs(worldDirZ) <= epsilon) {
    return false;
  }

  const scalar_t positionX = camera[CAMERA_POSITION_X_OFFSET];
  const scalar_t positionY = camera[CAMERA_POSITION_Y_OFFSET];
  const scalar_t positionZ = camera[CAMERA_POSITION_Z_OFFSET];

  const scalar_t t = (planeZ - positionZ) / worldDirZ;
  if (!isFiniteScalar(t) || t <= static_cast<scalar_t>(0.0f)) {
    return false;
  }

  outXY[0] = positionX + worldDirX * t;
  outXY[1] = positionY + worldDirY * t;
  return true;
}

// Picking uses simple 2D predicates against projected quads so the hit test
// matches the exact emitted geometry without allocating a second mesh.

static inline scalar_t clampScalar(
    scalar_t value,
    scalar_t minValue,
    scalar_t maxValue) {
  return std::max(minValue, std::min(maxValue, value));
}

static inline scalar_t cross2(
    scalar_t ax,
    scalar_t ay,
    scalar_t bx,
    scalar_t by,
    scalar_t px,
    scalar_t py) {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

static inline bool pointInTriangle(
    scalar_t px,
    scalar_t py,
    scalar_t ax,
    scalar_t ay,
    scalar_t bx,
    scalar_t by,
    scalar_t cx,
    scalar_t cy) {
  const scalar_t c1 = cross2(ax, ay, bx, by, px, py);
  const scalar_t c2 = cross2(bx, by, cx, cy, px, py);
  const scalar_t c3 = cross2(cx, cy, ax, ay, px, py);
  const bool hasNeg =
      (c1 < static_cast<scalar_t>(0.0f)) ||
      (c2 < static_cast<scalar_t>(0.0f)) ||
      (c3 < static_cast<scalar_t>(0.0f));
  const bool hasPos =
      (c1 > static_cast<scalar_t>(0.0f)) ||
      (c2 > static_cast<scalar_t>(0.0f)) ||
      (c3 > static_cast<scalar_t>(0.0f));
  return !(hasNeg && hasPos);
}

static inline bool pointInQuad(
    scalar_t px,
    scalar_t py,
    scalar_t x0,
    scalar_t y0,
    scalar_t x1,
    scalar_t y1,
    scalar_t x2,
    scalar_t y2,
    scalar_t x3,
    scalar_t y3) {
  return pointInTriangle(px, py, x0, y0, x1, y1, x2, y2) ||
      pointInTriangle(px, py, x2, y2, x1, y1, x3, y3);
}

static constexpr int PICK_MASK_PAGE_OFFSET_WORDS = 0;
static constexpr int PICK_MASK_PAGE_WORD_STRIDE = 1;
static constexpr int PICK_MASK_PAGE_WIDTH_PIXEL = 2;
static constexpr int PICK_MASK_PAGE_HEIGHT_PIXEL = 3;
static constexpr int PICK_MASK_PAGE_FIELDS = 4;

static inline bool resolveTriangleBarycentric(
    scalar_t px,
    scalar_t py,
    scalar_t ax,
    scalar_t ay,
    scalar_t bx,
    scalar_t by,
    scalar_t cx,
    scalar_t cy,
    scalar_t &outW0,
    scalar_t &outW1,
    scalar_t &outW2) {
  const scalar_t denom =
      (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
  const scalar_t eps = static_cast<scalar_t>(1e-6f);
  if (!isFiniteScalar(denom) || std::abs(denom) <= eps) {
    return false;
  }
  outW0 = ((by - cy) * (px - cx) + (cx - bx) * (py - cy)) / denom;
  outW1 = ((cy - ay) * (px - cx) + (ax - cx) * (py - cy)) / denom;
  outW2 = static_cast<scalar_t>(1.0f) - outW0 - outW1;
  return isFiniteScalar(outW0) && isFiniteScalar(outW1) && isFiniteScalar(outW2) &&
      outW0 >= -eps && outW1 >= -eps && outW2 >= -eps &&
      outW0 <= static_cast<scalar_t>(1.0f) + eps &&
      outW1 <= static_cast<scalar_t>(1.0f) + eps &&
      outW2 <= static_cast<scalar_t>(1.0f) + eps;
}

static inline bool interpolatePerspectiveCorrectUv(
    scalar_t bary0,
    scalar_t bary1,
    scalar_t bary2,
    scalar_t u0,
    scalar_t v0,
    scalar_t clipW0,
    scalar_t u1,
    scalar_t v1,
    scalar_t clipW1,
    scalar_t u2,
    scalar_t v2,
    scalar_t clipW2,
    scalar_t &outU,
    scalar_t &outV) {
  const scalar_t eps = static_cast<scalar_t>(1e-9f);
  const scalar_t safeW0 =
      std::abs(clipW0) < eps
          ? (clipW0 < static_cast<scalar_t>(0.0f) ? -eps : eps)
          : clipW0;
  const scalar_t safeW1 =
      std::abs(clipW1) < eps
          ? (clipW1 < static_cast<scalar_t>(0.0f) ? -eps : eps)
          : clipW1;
  const scalar_t safeW2 =
      std::abs(clipW2) < eps
          ? (clipW2 < static_cast<scalar_t>(0.0f) ? -eps : eps)
          : clipW2;
  const scalar_t invW0 = static_cast<scalar_t>(1.0f) / safeW0;
  const scalar_t invW1 = static_cast<scalar_t>(1.0f) / safeW1;
  const scalar_t invW2 = static_cast<scalar_t>(1.0f) / safeW2;
  const scalar_t denom = bary0 * invW0 + bary1 * invW1 + bary2 * invW2;
  if (!isFiniteScalar(denom) || std::abs(denom) <= eps) {
    return false;
  }
  const scalar_t numerU = bary0 * u0 * invW0 + bary1 * u1 * invW1 +
      bary2 * u2 * invW2;
  const scalar_t numerV = bary0 * v0 * invW0 + bary1 * v1 * invW1 +
      bary2 * v2 * invW2;
  outU = numerU / denom;
  outV = numerV / denom;
  return isFiniteScalar(outU) && isFiniteScalar(outV);
}

static inline bool samplePickMask(
    const CommandContext *ctx,
    int pageId,
    scalar_t u,
    scalar_t v) {
  if (!ctx || !ctx->pickMaskPageTableBuffer || !ctx->pickMaskWordBuffer ||
      pageId < 0) {
    return true;
  }
  const int pageBase = pageId * PICK_MASK_PAGE_FIELDS;
  if (pageBase < 0 ||
      pageBase + PICK_MASK_PAGE_FIELDS > ctx->pickMaskPageTableBufferCount) {
    return true;
  }
  const int *pageTable = ctx->pickMaskPageTableBuffer;
  const int offsetWords = pageTable[pageBase + PICK_MASK_PAGE_OFFSET_WORDS];
  const int wordStride = pageTable[pageBase + PICK_MASK_PAGE_WORD_STRIDE];
  const int widthPixel = pageTable[pageBase + PICK_MASK_PAGE_WIDTH_PIXEL];
  const int heightPixel = pageTable[pageBase + PICK_MASK_PAGE_HEIGHT_PIXEL];
  if (offsetWords < 0 || wordStride <= 0 || widthPixel <= 0 || heightPixel <= 0) {
    return true;
  }
  if (!isFiniteScalar(u) || !isFiniteScalar(v)) {
    return true;
  }
  const scalar_t maxX = static_cast<scalar_t>(widthPixel - 1);
  const scalar_t maxY = static_cast<scalar_t>(heightPixel - 1);
  const int pixelX = static_cast<int>(clampScalar(
      u * static_cast<scalar_t>(widthPixel),
      static_cast<scalar_t>(0.0f),
      maxX));
  const int pixelY = static_cast<int>(clampScalar(
      v * static_cast<scalar_t>(heightPixel),
      static_cast<scalar_t>(0.0f),
      maxY));
  const int wordIndex = offsetWords + pixelY * wordStride + (pixelX >> 5);
  if (wordIndex < 0 || wordIndex >= ctx->pickMaskWordBufferCount) {
    return true;
  }
  const auto *wordBuffer =
      reinterpret_cast<const std::uint32_t *>(ctx->pickMaskWordBuffer);
  const std::uint32_t mask = static_cast<std::uint32_t>(1u)
      << static_cast<unsigned>(pixelX & 31);
  return (wordBuffer[wordIndex] & mask) != 0;
}

static inline bool pointInJoinFan(
    scalar_t px,
    scalar_t py,
    scalar_t centerX,
    scalar_t centerY,
    scalar_t radius,
    scalar_t dir0X,
    scalar_t dir0Y,
    scalar_t dir1X,
    scalar_t dir1Y,
    int intermediatePointCount) {
  if (!(radius > static_cast<scalar_t>(0.0f)) ||
      intermediatePointCount < 0) {
    return false;
  }
  scalar_t previousX = centerX + dir0X * radius;
  scalar_t previousY = centerY + dir0Y * radius;
  const scalar_t angle0 = std::atan2(dir0Y, dir0X);
  const scalar_t angle1 = std::atan2(dir1Y, dir1X);
  const scalar_t delta = msp_wasm::wrapRadians(angle1 - angle0);
  for (int pointIndex = 0; pointIndex <= intermediatePointCount; ++pointIndex) {
    scalar_t nextX = centerX + dir1X * radius;
    scalar_t nextY = centerY + dir1Y * radius;
    if (pointIndex < intermediatePointCount) {
      const scalar_t t =
          static_cast<scalar_t>(pointIndex + 1) /
          static_cast<scalar_t>(intermediatePointCount + 1);
      const scalar_t angle = angle0 + delta * t;
      scalar_t s = static_cast<scalar_t>(0.0f);
      scalar_t c = static_cast<scalar_t>(1.0f);
      msp_wasm::computeSinCos(angle, s, c);
      nextX = centerX + c * radius;
      nextY = centerY + s * radius;
    }
    if (pointInTriangle(px, py, centerX, centerY, previousX, previousY, nextX, nextY)) {
      return true;
    }
    previousX = nextX;
    previousY = nextY;
  }
  return false;
}

static inline bool pointInCapFan(
    scalar_t px,
    scalar_t py,
    scalar_t centerX,
    scalar_t centerY,
    scalar_t radius,
    scalar_t ux,
    scalar_t uy,
    scalar_t nx,
    scalar_t ny,
    bool startCap,
    int pointCount) {
  if (!(radius > static_cast<scalar_t>(0.0f)) || pointCount < 1) {
    return false;
  }
  const scalar_t tangentX = startCap ? -ux : ux;
  const scalar_t tangentY = startCap ? -uy : uy;
  scalar_t previousX = centerX + nx * radius;
  scalar_t previousY = centerY + ny * radius;
  for (int pointIndex = 0; pointIndex <= pointCount; ++pointIndex) {
    const scalar_t theta =
        msp_wasm::kPi * static_cast<scalar_t>(pointIndex + 1) /
        static_cast<scalar_t>(pointCount + 1);
    scalar_t s = static_cast<scalar_t>(0.0f);
    scalar_t c = static_cast<scalar_t>(1.0f);
    msp_wasm::computeSinCos(theta, s, c);
    const scalar_t nextX = centerX + (nx * c + tangentX * s) * radius;
    const scalar_t nextY = centerY + (ny * c + tangentY * s) * radius;
    if (pointInTriangle(px, py, centerX, centerY, previousX, previousY, nextX, nextY)) {
      return true;
    }
    previousX = nextX;
    previousY = nextY;
  }
  return false;
}

struct PickCandidate {
  int kind;
  size_t entryIndex;
  int primaryId;
  int secondaryId;
};

/**
 * @brief Normalizes draw-order information from either sprite or polyline hits.
 */
static inline bool resolvePickOrder(
    const msp_wasm::ComputeWorkspace &workspace,
    int kind,
    size_t index,
    int &outLayer,
    scalar_t &outDepth,
    int &outOrder,
    int &outKindOrder,
    scalar_t &outTie) {
  if (kind == 1) {
    if (index >= workspace.entries.size()) {
      return false;
    }
    const auto &entry = workspace.entries[index];
    outLayer = entry.layer;
    outDepth = entry.spriteDepth;
    outOrder = entry.order;
    outKindOrder = 1;
    outTie = entry.elementDepth;
    return true;
  }
  if (kind == 2) {
    if (index >= workspace.polylineEntries.size()) {
      return false;
    }
    const auto &entry = workspace.polylineEntries[index];
    outLayer = entry.layer;
    outDepth = entry.depth;
    outOrder = entry.order;
    outKindOrder = 2;
    outTie = static_cast<scalar_t>(entry.segmentIndex);
    return true;
  }
  return false;
}

/**
 * @brief Compares two pick candidates with the same ordering rules as rendering.
 */
static inline bool pickEntryLess(
    const msp_wasm::ComputeWorkspace &workspace,
    const PickCandidate &lhs,
    const PickCandidate &rhs) {
  int lhsLayer = 0;
  int rhsLayer = 0;
  scalar_t lhsDepth = static_cast<scalar_t>(0.0f);
  scalar_t rhsDepth = static_cast<scalar_t>(0.0f);
  int lhsOrder = 0;
  int rhsOrder = 0;
  int lhsKindOrder = 0;
  int rhsKindOrder = 0;
  scalar_t lhsTie = static_cast<scalar_t>(0.0f);
  scalar_t rhsTie = static_cast<scalar_t>(0.0f);
  if (!resolvePickOrder(
          workspace,
          lhs.kind,
          lhs.entryIndex,
          lhsLayer,
          lhsDepth,
          lhsOrder,
          lhsKindOrder,
          lhsTie) ||
      !resolvePickOrder(
          workspace,
          rhs.kind,
          rhs.entryIndex,
          rhsLayer,
          rhsDepth,
          rhsOrder,
          rhsKindOrder,
          rhsTie)) {
    return false;
  }
  if (lhsLayer != rhsLayer) {
    return lhsLayer < rhsLayer;
  }
  if (lhsDepth != rhsDepth) {
    return lhsDepth < rhsDepth;
  }
  if (lhsOrder != rhsOrder) {
    return lhsOrder < rhsOrder;
  }
  if (lhsKindOrder != rhsKindOrder) {
    return lhsKindOrder < rhsKindOrder;
  }
  return lhsTie < rhsTie;
}

/**
 * @brief Refreshes per-element caches derived from the owning sprite transform.
 */
static constexpr inline void updateOwnerCaches(
    const msp_wasm::SpriteInputView &sprite,
    const msp_wasm::ElementInputView &element,
    int spriteCount,
    int elementCount,
    std::vector<scalar_t> &ownerBaseXValues,
    std::vector<scalar_t> &ownerBaseYValues,
    std::vector<scalar_t> &ownerBaseZValues,
    std::vector<scalar_t> &ownerParentOpacityValues) {
  if (elementCount <= 0) {
    return;
  }
  const size_t requiredElementCount = static_cast<size_t>(elementCount);
  if (ownerBaseXValues.size() < requiredElementCount) {
    ownerBaseXValues.resize(requiredElementCount, 0.0f);
    ownerBaseYValues.resize(requiredElementCount, 0.0f);
    ownerParentOpacityValues.resize(requiredElementCount, 0.0f);
  }
  scalar_t *baseXOut = ownerBaseXValues.data();
  scalar_t *baseYOut = ownerBaseYValues.data();
  scalar_t *baseZOut = ownerBaseZValues.data();
  scalar_t *opacityOut = ownerParentOpacityValues.data();
  const scalar_t *ownerSlots = element.ownerSlotValues;
  const scalar_t *spriteX = sprite.xValues;
  const scalar_t *spriteY = sprite.yValues;
  const scalar_t *spriteZ = sprite.zValues;
  const scalar_t *spriteOpacity = sprite.renderOpacityValues;
  for (int i = 0; i < elementCount; ++i) {
    const int ownerSlot = static_cast<int>(ownerSlots[i]);
    if (ownerSlot >= 0 && ownerSlot < spriteCount) {
      baseXOut[i] = spriteX[ownerSlot];
      baseYOut[i] = spriteY[ownerSlot];
      baseZOut[i] = spriteZ[ownerSlot];
      opacityOut[i] = spriteOpacity[ownerSlot];
    } else {
      baseXOut[i] = static_cast<scalar_t>(0.0f);
      baseYOut[i] = static_cast<scalar_t>(0.0f);
      baseZOut[i] = static_cast<scalar_t>(0.0f);
      opacityOut[i] = static_cast<scalar_t>(0.0f);
    }
  }
}

static inline int computeVerticesSoA(
    CommandContext *context,
    msp_wasm::ComputeWorkspace *workspace,
    scalar_t *spriteInput,
    int spriteCount,
    int spriteInputStride,
    scalar_t *elementInput,
    int elementCount,
    int elementInputStride,
    scalar_t *polylineInput,
    int polylineCount,
    int polylineInputStride,
    scalar_t *polylineNodeInput,
    int polylineNodeCount,
    int polylineNodeInputStride,
    scalar_t *viewMatrix,
    scalar_t *viewProjection,
    float *output,
    int *outTexIndices,
    float *polylineOutput,
    int *drawCommands,
    scalar_t *camera,
    scalar_t nowMs,
    const std::vector<msp_wasm::TextureInfo> &textures,
    scalar_t *computeStatsBuffer,
    int computeStatsBufferCount,
    bool debugEntryEnabled,
    bool elementAnimDetailEnabled,
    bool allowCameraTracking) {
  // This is the internal hot path for rendering and picking. It only recomputes
  // work that became dirty, while still updating active interpolation state.
  const bool statsEnabled =
      computeStatsBuffer && computeStatsBufferCount >= COMPUTE_STATS_FIELDS;
  const bool detailStatsEnabled = statsEnabled && elementAnimDetailEnabled;
  const bool hasSprites = spriteCount > 0 && elementCount > 0;
  const bool hasPolylines = polylineCount > 0 && polylineNodeCount > 0;
  if (camera) {
    updateCameraAnimations(camera, nowMs);
  }
  const bool cameraDirty =
      camera && camera[CAMERA_PROJECTION_DIRTY_OFFSET] != static_cast<scalar_t>(0.0f);
  const scalar_t cameraDirtyValue =
      cameraDirty ? static_cast<scalar_t>(1.0f) : static_cast<scalar_t>(0.0f);
  const bool cameraTrackingEnabled =
      allowCameraTracking && context && context->cameraTracking.enabled &&
      !context->cameraTracking.spriteSlots.empty();
  if (!cameraDirty && !workspace->needsCompute && !workspace->hasActiveAnimations &&
      !cameraTrackingEnabled) {
    if (statsEnabled) {
      for (int index = 0; index < COMPUTE_STATS_FIELDS; ++index) {
        computeStatsBuffer[index] = static_cast<scalar_t>(0.0f);
      }
    }
    return workspace->lastActiveCount;
  }
  scalar_t totalStartMs = static_cast<scalar_t>(0.0f);
  scalar_t projectionMs = static_cast<scalar_t>(0.0f);
  scalar_t spriteAnimationMs = static_cast<scalar_t>(0.0f);
  scalar_t elementAnimationMs = static_cast<scalar_t>(0.0f);
  scalar_t pivotResolveMs = static_cast<scalar_t>(0.0f);
  scalar_t autoRotationMs = static_cast<scalar_t>(0.0f);
  scalar_t cameraTrackingMs = static_cast<scalar_t>(0.0f);
  scalar_t collectEntriesMs = static_cast<scalar_t>(0.0f);
  scalar_t sortEntriesMs = static_cast<scalar_t>(0.0f);
  scalar_t writeOutputMs = static_cast<scalar_t>(0.0f);
  scalar_t elementAnimOwnerMs = static_cast<scalar_t>(0.0f);
  scalar_t elementAnimOpacityMs = static_cast<scalar_t>(0.0f);
  scalar_t elementAnimRotationMs = static_cast<scalar_t>(0.0f);
  scalar_t elementAnimScaleMs = static_cast<scalar_t>(0.0f);
  scalar_t elementAnimAnchorMs = static_cast<scalar_t>(0.0f);
  scalar_t elementAnimShiftMs = static_cast<scalar_t>(0.0f);
  scalar_t elementAnimPivotMs = static_cast<scalar_t>(0.0f);
  scalar_t elementAnimMergeMs = static_cast<scalar_t>(0.0f);
  scalar_t elementAnimScalarMs = static_cast<scalar_t>(0.0f);
  scalar_t elementAnimSimdLoopMs = static_cast<scalar_t>(0.0f);
  bool trackingAppliedCamera = false;

  if (statsEnabled) {
    totalStartMs = readNowMs();
  }

  // Projection is recomputed lazily so cached frames can skip matrix work when
  // camera state and viewport parameters are unchanged.
  if (cameraDirty) {
    if (statsEnabled) {
      const scalar_t projectionStartMs = readNowMs();
      msp_wasm::computeProjection(camera, viewMatrix, viewProjection);
      projectionMs = readNowMs() - projectionStartMs;
    } else {
      msp_wasm::computeProjection(camera, viewMatrix, viewProjection);
    }
  }
  if (cameraDirty && camera) {
    camera[CAMERA_PROJECTION_DIRTY_OFFSET] = static_cast<scalar_t>(0.0f);
  }

  const msp_wasm::SpriteInputView sprite =
      msp_wasm::makeSpriteInputView(spriteInput, spriteInputStride);
  const msp_wasm::ElementInputView element =
      msp_wasm::makeElementInputView(elementInput, elementInputStride);
  const msp_wasm::PolylineInputView polyline =
      polylineInput
          ? msp_wasm::makePolylineInputView(polylineInput, polylineInputStride)
          : msp_wasm::PolylineInputView{};
  const msp_wasm::PolylineNodeInputView polylineNodes =
      polylineNodeInput
          ? msp_wasm::makePolylineNodeInputView(
              polylineNodeInput, polylineNodeInputStride)
          : msp_wasm::PolylineNodeInputView{};
  const auto updateDistanceScaleFactors = [&]() {
    if (hasSprites) {
      populateSpriteDistanceScaleFactors(
          sprite,
          spriteCount,
          camera,
          workspace->spriteDistanceScaleFactors);
    }
    if (hasPolylines) {
      populatePolylineNodeScaleFactors(
          polylineNodes,
          polylineNodeCount,
          camera,
          workspace->polylineNodeScaleFactors);
    }
  };
  const auto resolvePivotsWithCurrentCamera = [&]() {
    if (!hasSprites) {
      return;
    }
    const scalar_t viewRightX = viewMatrix[0];
    const scalar_t viewRightY = viewMatrix[4];
    const scalar_t viewRightZ = viewMatrix[8];
    const scalar_t viewUpX = viewMatrix[1];
    const scalar_t viewUpY = viewMatrix[5];
    const scalar_t viewUpZ = viewMatrix[9];
    const scalar_t cameraX =
        camera ? camera[CAMERA_POSITION_X_OFFSET] : static_cast<scalar_t>(0.0f);
    const scalar_t cameraY =
        camera ? camera[CAMERA_POSITION_Y_OFFSET] : static_cast<scalar_t>(0.0f);
    const scalar_t cameraZ =
        camera ? camera[CAMERA_POSITION_Z_OFFSET] : static_cast<scalar_t>(0.0f);
    msp_wasm::resolvePivotHierarchy(
        sprite,
        element,
        spriteCount,
        elementCount,
        viewRightX,
        viewRightY,
        viewRightZ,
        viewUpX,
        viewUpY,
        viewUpZ,
        cameraX,
        cameraY,
        cameraZ,
        workspace->pivotXValues,
        workspace->pivotYValues,
        workspace->pivotZValues,
        workspace->pivotLocalXValues,
        workspace->pivotLocalYValues,
        workspace->basePivotWorldXValues,
        workspace->basePivotWorldYValues,
        workspace->basisRightXValues,
        workspace->basisRightYValues,
        workspace->basisRightZValues,
        workspace->basisUpXValues,
        workspace->basisUpYValues,
        workspace->basisUpZValues,
        workspace->spriteDistanceScaleFactors,
        workspace->pivotCameraDependentFlags,
        workspace->pivotDirtyFlags,
        workspace->pivotResolveStates);
  };
  const auto applyCameraTracking = [&]() -> CameraTrackingStepResult {
    if (!cameraTrackingEnabled || !camera || !hasSprites) {
      return CameraTrackingStepResult{
          false,
          false,
          context && context->cameraTracking.enabled
              ? context->cameraTracking.resolvedDistance
              : static_cast<scalar_t>(0.0f)};
    }
    auto &tracking = context->cameraTracking;
    CameraTrackingSolution solution{};
    const bool hasSolution =
        tracking.targetMode == CAMERA_TRACKING_TARGET_MODE_CONTENT_APPROX
            ? resolveContentApproxTrackingSolution(
                  tracking,
                  context->sprites,
                  sprite,
                  element,
                  spriteCount,
                  elementCount,
                  workspace->pivotXValues,
                  workspace->pivotYValues,
                  workspace->pivotZValues,
                  workspace->spriteDistanceScaleFactors,
                  workspace->geometryEnabled,
                  camera,
                  solution)
            : resolveBaseTrackingSolution(
                  tracking,
                  sprite,
                  spriteCount,
                  camera,
                  solution);
    if (!hasSolution) {
      return CameraTrackingStepResult{
          false, false, tracking.resolvedDistance};
    }

    tracking.resolvedDistance = solution.distance;
    const TrackingBasis basis = resolveTrackingCameraBasis(camera);
    const scalar_t targetX = solution.center.x - basis.forward.x * solution.distance;
    const scalar_t targetY = solution.center.y - basis.forward.y * solution.distance;
    const scalar_t targetZ = solution.center.z - basis.forward.z * solution.distance;
    const scalar_t currentTargetX =
        resolveInterpolationTarget<CameraInterpolationAccessor>(
            {camera}, CAMERA_POSITION_X_FIELD);
    const scalar_t currentTargetY =
        resolveInterpolationTarget<CameraInterpolationAccessor>(
            {camera}, CAMERA_POSITION_Y_FIELD);
    const scalar_t currentTargetZ =
        resolveInterpolationTarget<CameraInterpolationAccessor>(
            {camera}, CAMERA_POSITION_Z_FIELD);
    const bool materialChange =
        std::abs(targetX - currentTargetX) > CAMERA_TRACKING_EPSILON ||
        std::abs(targetY - currentTargetY) > CAMERA_TRACKING_EPSILON ||
        std::abs(targetZ - currentTargetZ) > CAMERA_TRACKING_EPSILON;
    if (!materialChange) {
      return CameraTrackingStepResult{true, false, solution.distance};
    }

    const ValueCommand xCommand =
        createCameraTrackingValueCommand(tracking, targetX);
    const ValueCommand yCommand =
        createCameraTrackingValueCommand(tracking, targetY);
    const ValueCommand zCommand =
        createCameraTrackingValueCommand(tracking, targetZ);
    applyCameraInterpolation(
        camera, CAMERA_POSITION_X_FIELD, xCommand, targetX, nowMs);
    applyCameraInterpolation(
        camera, CAMERA_POSITION_Y_FIELD, yCommand, targetY, nowMs);
    applyCameraInterpolation(
        camera, CAMERA_POSITION_Z_FIELD, zCommand, targetZ, nowMs);
    camera[CAMERA_PROJECTION_DIRTY_OFFSET] = static_cast<scalar_t>(1.0f);
    return CameraTrackingStepResult{true, true, solution.distance};
  };

  if (statsEnabled) {
    const scalar_t spriteAnimationStartMs = readNowMs();
    bool spriteAnimationsActive = false;
    bool polylineAnimationsActive = false;
    bool spritePseudoLodActive = false;
    if (hasSprites) {
      spriteAnimationsActive =
          msp_wasm::updateSpriteAnimations(sprite, spriteCount, nowMs);
      spritePseudoLodActive = updateSpritePseudoLodVisibility(
          *workspace,
          sprite,
          element,
          spriteCount,
          elementCount,
          camera,
          nowMs);
    }
    if (hasPolylines) {
      polylineAnimationsActive =
          msp_wasm::updatePolylineAnimations(polyline, polylineCount, nowMs);
    }
    spriteAnimationMs = readNowMs() - spriteAnimationStartMs;
    updateDistanceScaleFactors();

    msp_wasm::ElementAnimDetailStats detailStats;
    msp_wasm::ElementAnimDetailStats *detailStatsPtr =
        detailStatsEnabled ? &detailStats : nullptr;
    bool elementAnimationsActive = false;
    bool autoDirectionActive = false;
    if (hasSprites) {
      const scalar_t elementAnimationStartMs = readNowMs();
      updateOwnerCaches(
          sprite,
          element,
          spriteCount,
          elementCount,
          workspace->ownerBaseXValues,
          workspace->ownerBaseYValues,
          workspace->ownerBaseZValues,
          workspace->ownerParentOpacityValues);
      const bool hasPivotBasis = msp_wasm::updateElementAnimationsAndPivots(
          sprite,
          element,
          spriteCount,
          elementCount,
          nowMs,
          workspace->pivotXValues,
          workspace->pivotYValues,
          workspace->pivotZValues,
          workspace->pivotLocalXValues,
          workspace->pivotLocalYValues,
          workspace->basePivotLocalXValues,
          workspace->basePivotLocalYValues,
          workspace->basePivotWorldXValues,
          workspace->basePivotWorldYValues,
          workspace->ownerBaseXValues,
          workspace->ownerBaseYValues,
          workspace->ownerBaseZValues,
          workspace->ownerParentOpacityValues,
          workspace->geometryEnabled,
          workspace->pivotDirtyFlags,
          textures,
          detailStatsPtr,
          &elementAnimationsActive);
      if (!hasPivotBasis &&
          workspace->pivotCameraDependentFlags.size() >=
              static_cast<size_t>(elementCount)) {
        std::fill(
            workspace->pivotCameraDependentFlags.begin(),
            workspace->pivotCameraDependentFlags.begin() + elementCount,
            static_cast<unsigned char>(0));
      }
      elementAnimationMs = readNowMs() - elementAnimationStartMs;
      if (detailStatsEnabled && detailStatsPtr) {
        elementAnimOwnerMs = detailStats.ownerMs;
        elementAnimOpacityMs = detailStats.opacityMs;
        elementAnimRotationMs = detailStats.rotationMs;
        elementAnimScaleMs = detailStats.scaleMs;
        elementAnimAnchorMs = detailStats.anchorMs;
        elementAnimShiftMs = detailStats.shiftMs;
        elementAnimPivotMs = detailStats.pivotMs;
        elementAnimMergeMs = detailStats.mergeMs;
        elementAnimScalarMs = detailStats.scalarMs;
        elementAnimSimdLoopMs = detailStats.simdLoopMs;
      }

      const auto resolvePivots = [&]() -> scalar_t {
        const scalar_t pivotResolveStartMs = readNowMs();
        resolvePivotsWithCurrentCamera();
        return readNowMs() - pivotResolveStartMs;
      };
      if (hasPivotBasis) {
        pivotResolveMs += resolvePivots();
      }

      const scalar_t autoRotationStartMs = readNowMs();
      const auto autoDirectionResult =
          msp_wasm::updateElementAutoDirectionAndFinalState(
          element,
          elementCount,
          workspace->pivotXValues,
          workspace->pivotYValues,
          workspace->basePivotWorldXValues,
          workspace->basePivotWorldYValues,
          workspace->basePivotLocalXValues,
          workspace->basePivotLocalYValues,
          workspace->pivotLocalXValues,
          workspace->pivotLocalYValues,
          workspace->geometryEnabled,
          workspace->pivotDirtyFlags,
          nowMs);
      autoDirectionActive = autoDirectionResult.hasActiveAnimations;
      if (autoDirectionResult.requiresPivotResolve) {
        pivotResolveMs += resolvePivots();
      }
      autoRotationMs = readNowMs() - autoRotationStartMs;

      if (cameraTrackingEnabled) {
        const scalar_t trackingStartMs = readNowMs();
        const CameraTrackingStepResult trackingResult = applyCameraTracking();
        cameraTrackingMs = readNowMs() - trackingStartMs;
        trackingAppliedCamera = trackingResult.cameraApplied;
        if (trackingResult.cameraApplied) {
          const scalar_t projectionStartMs = readNowMs();
          msp_wasm::computeProjection(camera, viewMatrix, viewProjection);
          projectionMs += readNowMs() - projectionStartMs;
          camera[CAMERA_PROJECTION_DIRTY_OFFSET] = static_cast<scalar_t>(0.0f);
          updateDistanceScaleFactors();
          if (hasPivotBasis) {
            pivotResolveMs += resolvePivots();
          }
        }
      }
    }
    workspace->hasActiveAnimations =
        spriteAnimationsActive || spritePseudoLodActive ||
        elementAnimationsActive || autoDirectionActive ||
        polylineAnimationsActive;

    const scalar_t collectEntriesStartMs = readNowMs();
    if (hasSprites) {
      msp_wasm::collectSpriteEntries(
          sprite,
          element,
          spriteCount,
          elementCount,
          viewMatrix,
          workspace->pivotXValues,
          workspace->pivotYValues,
          workspace->pivotZValues,
          workspace->geometryEnabled,
          workspace->entries);
    } else {
      workspace->entries.clear();
    }
    if (hasPolylines) {
      msp_wasm::collectPolylineEntries(
          polyline,
          polylineNodes,
          polylineCount,
          viewMatrix,
          workspace->polylineEntries);
    } else {
      workspace->polylineEntries.clear();
    }
    collectEntriesMs = readNowMs() - collectEntriesStartMs;
  } else {
    bool spriteAnimationsActive = false;
    bool polylineAnimationsActive = false;
    bool spritePseudoLodActive = false;
    if (hasSprites) {
      spriteAnimationsActive =
          msp_wasm::updateSpriteAnimations(sprite, spriteCount, nowMs);
      spritePseudoLodActive = updateSpritePseudoLodVisibility(
          *workspace,
          sprite,
          element,
          spriteCount,
          elementCount,
          camera,
          nowMs);
    }
    if (hasPolylines) {
      polylineAnimationsActive =
          msp_wasm::updatePolylineAnimations(polyline, polylineCount, nowMs);
    }
    updateDistanceScaleFactors();
    bool elementAnimationsActive = false;
    bool autoDirectionActive = false;
    if (hasSprites) {
      updateOwnerCaches(
          sprite,
          element,
          spriteCount,
          elementCount,
          workspace->ownerBaseXValues,
          workspace->ownerBaseYValues,
          workspace->ownerBaseZValues,
          workspace->ownerParentOpacityValues);
      const bool hasPivotBasis = msp_wasm::updateElementAnimationsAndPivots(
          sprite,
          element,
          spriteCount,
          elementCount,
          nowMs,
          workspace->pivotXValues,
          workspace->pivotYValues,
          workspace->pivotZValues,
          workspace->pivotLocalXValues,
          workspace->pivotLocalYValues,
          workspace->basePivotLocalXValues,
          workspace->basePivotLocalYValues,
          workspace->basePivotWorldXValues,
          workspace->basePivotWorldYValues,
          workspace->ownerBaseXValues,
          workspace->ownerBaseYValues,
          workspace->ownerBaseZValues,
          workspace->ownerParentOpacityValues,
          workspace->geometryEnabled,
          workspace->pivotDirtyFlags,
          textures,
          nullptr,
          &elementAnimationsActive);
      if (!hasPivotBasis &&
          workspace->pivotCameraDependentFlags.size() >=
              static_cast<size_t>(elementCount)) {
        std::fill(
            workspace->pivotCameraDependentFlags.begin(),
            workspace->pivotCameraDependentFlags.begin() + elementCount,
            static_cast<unsigned char>(0));
      }
      const auto resolvePivots = [&]() { resolvePivotsWithCurrentCamera(); };
      if (hasPivotBasis) {
        resolvePivots();
      }
      const auto autoDirectionResult =
          msp_wasm::updateElementAutoDirectionAndFinalState(
          element,
          elementCount,
          workspace->pivotXValues,
          workspace->pivotYValues,
          workspace->basePivotWorldXValues,
          workspace->basePivotWorldYValues,
          workspace->basePivotLocalXValues,
          workspace->basePivotLocalYValues,
          workspace->pivotLocalXValues,
          workspace->pivotLocalYValues,
          workspace->geometryEnabled,
          workspace->pivotDirtyFlags,
          nowMs);
      autoDirectionActive = autoDirectionResult.hasActiveAnimations;
      if (autoDirectionResult.requiresPivotResolve) {
        resolvePivots();
      }
      if (cameraTrackingEnabled) {
        const CameraTrackingStepResult trackingResult = applyCameraTracking();
        trackingAppliedCamera = trackingResult.cameraApplied;
        if (trackingResult.cameraApplied) {
          msp_wasm::computeProjection(camera, viewMatrix, viewProjection);
          camera[CAMERA_PROJECTION_DIRTY_OFFSET] = static_cast<scalar_t>(0.0f);
          updateDistanceScaleFactors();
          if (hasPivotBasis) {
            resolvePivots();
          }
        }
      }
    }
    workspace->hasActiveAnimations =
        spriteAnimationsActive || spritePseudoLodActive ||
        elementAnimationsActive || autoDirectionActive ||
        polylineAnimationsActive;
    if (hasSprites) {
      msp_wasm::collectSpriteEntries(
          sprite,
          element,
          spriteCount,
          elementCount,
          viewMatrix,
          workspace->pivotXValues,
          workspace->pivotYValues,
          workspace->pivotZValues,
          workspace->geometryEnabled,
          workspace->entries);
    } else {
      workspace->entries.clear();
    }
    if (hasPolylines) {
      msp_wasm::collectPolylineEntries(
          polyline,
          polylineNodes,
          polylineCount,
          viewMatrix,
          workspace->polylineEntries);
    } else {
      workspace->polylineEntries.clear();
    }
  }

  if (workspace->entries.empty() && workspace->polylineEntries.empty()) {
    if (drawCommands) {
      drawCommands[DRAW_COMMAND_COMMAND_COUNT_OFFSET] = 0;
      drawCommands[DRAW_COMMAND_POLYLINE_VERTEX_COUNT_OFFSET] = 0;
    }
    if (statsEnabled) {
      const scalar_t totalMs = readNowMs() - totalStartMs;
      computeStatsBuffer[COMPUTE_STATS_TOTAL_MS_OFFSET] =
          totalMs < static_cast<scalar_t>(0.0f)
              ? static_cast<scalar_t>(0.0f)
              : totalMs;
      computeStatsBuffer[COMPUTE_STATS_PROJECTION_MS_OFFSET] =
          projectionMs < static_cast<scalar_t>(0.0f)
              ? static_cast<scalar_t>(0.0f)
              : projectionMs;
      computeStatsBuffer[COMPUTE_STATS_SPRITE_ANIMATION_MS_OFFSET] =
          spriteAnimationMs < static_cast<scalar_t>(0.0f)
              ? static_cast<scalar_t>(0.0f)
              : spriteAnimationMs;
      computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_MS_OFFSET] =
          elementAnimationMs < static_cast<scalar_t>(0.0f)
              ? static_cast<scalar_t>(0.0f)
              : elementAnimationMs;
      computeStatsBuffer[COMPUTE_STATS_PIVOT_RESOLVE_MS_OFFSET] =
          pivotResolveMs < static_cast<scalar_t>(0.0f)
              ? static_cast<scalar_t>(0.0f)
              : pivotResolveMs;
      computeStatsBuffer[COMPUTE_STATS_AUTO_ROTATION_MS_OFFSET] =
          autoRotationMs < static_cast<scalar_t>(0.0f)
              ? static_cast<scalar_t>(0.0f)
              : autoRotationMs;
      computeStatsBuffer[COMPUTE_STATS_CAMERA_TRACKING_MS_OFFSET] =
          cameraTrackingMs < static_cast<scalar_t>(0.0f)
              ? static_cast<scalar_t>(0.0f)
              : cameraTrackingMs;
      computeStatsBuffer[COMPUTE_STATS_COLLECT_ENTRIES_MS_OFFSET] =
          collectEntriesMs < static_cast<scalar_t>(0.0f)
              ? static_cast<scalar_t>(0.0f)
              : collectEntriesMs;
      computeStatsBuffer[COMPUTE_STATS_SORT_ENTRIES_MS_OFFSET] =
          static_cast<scalar_t>(0.0f);
      computeStatsBuffer[COMPUTE_STATS_WRITE_OUTPUT_MS_OFFSET] =
          static_cast<scalar_t>(0.0f);
      computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_OWNER_MS_OFFSET] =
          static_cast<scalar_t>(0.0f);
      computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_OPACITY_MS_OFFSET] =
          static_cast<scalar_t>(0.0f);
      computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_ROTATION_MS_OFFSET] =
          static_cast<scalar_t>(0.0f);
      computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_SCALE_MS_OFFSET] =
          static_cast<scalar_t>(0.0f);
      computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_ANCHOR_MS_OFFSET] =
          static_cast<scalar_t>(0.0f);
      computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_SHIFT_MS_OFFSET] =
          static_cast<scalar_t>(0.0f);
      computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_PIVOT_MS_OFFSET] =
          static_cast<scalar_t>(0.0f);
      computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_MERGE_MS_OFFSET] =
          static_cast<scalar_t>(0.0f);
      computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_SCALAR_MS_OFFSET] =
          static_cast<scalar_t>(0.0f);
      computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_SIMD_LOOP_MS_OFFSET] =
          static_cast<scalar_t>(0.0f);
      computeStatsBuffer[COMPUTE_STATS_CAMERA_TRACKING_APPLIED_OFFSET] =
          trackingAppliedCamera ? static_cast<scalar_t>(1.0f)
                               : static_cast<scalar_t>(0.0f);
      computeStatsBuffer[COMPUTE_STATS_CAMERA_TRACKING_RESOLVED_DISTANCE_OFFSET] =
          cameraTrackingEnabled && context
              ? context->cameraTracking.resolvedDistance
              : static_cast<scalar_t>(0.0f);
      computeStatsBuffer[COMPUTE_STATS_CAMERA_DIRTY_OFFSET] = cameraDirtyValue;
    }
    workspace->lastActiveCount = 0;
    workspace->needsCompute = false;
    return 0;
  }

  const auto sortEntries = [&]() {
    const size_t entryCount = workspace->entries.size();
    if (entryCount <= 1) {
      return;
    }

    std::sort(
        workspace->entries.begin(),
        workspace->entries.end(),
        spriteEntryLess);
  };

  const auto sortPolylineEntries = [&]() {
    const size_t entryCount = workspace->polylineEntries.size();
    if (entryCount <= 1) {
      return;
    }

    std::sort(
        workspace->polylineEntries.begin(),
        workspace->polylineEntries.end(),
        polylineEntryLess);
  };

  if (statsEnabled) {
    const scalar_t sortStartMs = readNowMs();
    sortEntries();
    sortPolylineEntries();
    sortEntriesMs = readNowMs() - sortStartMs;
  } else {
    sortEntries();
    sortPolylineEntries();
  }

  workspace->outputEntryOrderScratch.clear();
  workspace->outputEntryOrderScratch.reserve(workspace->entries.size());
  int visibleEntryCount = 0;
  int outputEntryCount = 0;
  for (const auto &entry : workspace->entries) {
    const int index = entry.index;
    const int ownerSlot = static_cast<int>(element.ownerSlotValues[index]);
    if (ownerSlot < 0 || ownerSlot >= spriteCount) {
      continue;
    }
    const int texIndex = entry.texIndex;
    if (texIndex < 0 || texIndex >= static_cast<int>(textures.size())) {
      continue;
    }
    const auto &texture = textures[static_cast<size_t>(texIndex)];
    if (texture.valid == 0) {
      continue;
    }
    workspace->outputEntryOrderScratch.push_back(index);
    visibleEntryCount += 1;
    outputEntryCount += texture.tiles.empty()
        ? 1
        : static_cast<int>(texture.tiles.size());
  }
  bool outputOrderStable =
      workspace->outputEntryOrderScratch.size() == workspace->outputEntryOrder.size();
  if (outputOrderStable) {
    for (size_t i = 0; i < workspace->outputEntryOrderScratch.size(); ++i) {
      if (workspace->outputEntryOrderScratch[i] != workspace->outputEntryOrder[i]) {
        outputOrderStable = false;
        break;
      }
    }
  }
  if (!outputOrderStable) {
    workspace->outputEntryOrder.swap(workspace->outputEntryOrderScratch);
  }
  const bool reuseOutput =
      outputOrderStable &&
      workspace->outputEntrySignatures.size() == static_cast<size_t>(outputEntryCount);
  const bool allowReuseOutput = reuseOutput && !debugEntryEnabled;

  std::uint64_t cameraSignature = 0;
  cameraSignature = msp_wasm::hashCombine(
      cameraSignature,
      msp_wasm::hashScalar(camera[CAMERA_VIEWPORT_ASPECT_OFFSET]));
  cameraSignature = msp_wasm::hashCombine(
      cameraSignature,
      msp_wasm::hashScalar(camera[CAMERA_POSITION_X_OFFSET]));
  cameraSignature = msp_wasm::hashCombine(
      cameraSignature,
      msp_wasm::hashScalar(camera[CAMERA_POSITION_Y_OFFSET]));
  cameraSignature = msp_wasm::hashCombine(
      cameraSignature,
      msp_wasm::hashScalar(camera[CAMERA_POSITION_Z_OFFSET]));
  for (int i = 0; i < 16; ++i) {
    cameraSignature =
        msp_wasm::hashCombine(cameraSignature, msp_wasm::hashScalar(viewMatrix[i]));
  }
  for (int i = 0; i < 16; ++i) {
    cameraSignature = msp_wasm::hashCombine(
        cameraSignature,
        msp_wasm::hashScalar(viewProjection[i]));
  }

  const auto buildDrawCommands = [&](int polylineVertexCount, int spriteOutputCount) {
    if (!drawCommands) {
      return;
    }
    int commandCount = 0;
    int writeOffset = DRAW_COMMAND_HEADER_FIELDS;
    int currentKind = -1;
    int currentStart = 0;
    int currentCount = 0;
    int currentExtra = 0;

    const auto flush = [&]() {
      if (currentKind < 0) {
        return;
      }
      drawCommands[writeOffset + DRAW_COMMAND_KIND_FIELD_OFFSET] = currentKind;
      drawCommands[writeOffset + DRAW_COMMAND_START_FIELD_OFFSET] = currentStart;
      drawCommands[writeOffset + DRAW_COMMAND_COUNT_FIELD_OFFSET] = currentCount;
      drawCommands[writeOffset + DRAW_COMMAND_EXTRA_FIELD_OFFSET] = currentExtra;
      writeOffset += DRAW_COMMAND_FIELDS;
      commandCount += 1;
      currentKind = -1;
      currentStart = 0;
      currentCount = 0;
      currentExtra = 0;
    };

    const auto pushSprite = [&](int outputIndex, int pageId) {
      if (currentKind == DRAW_COMMAND_KIND_SPRITE &&
          currentExtra == pageId &&
          outputIndex == currentStart + currentCount) {
        currentCount += 1;
        return;
      }
      flush();
      currentKind = DRAW_COMMAND_KIND_SPRITE;
      currentStart = outputIndex;
      currentCount = 1;
      currentExtra = pageId;
    };

    const auto pushPolyline = [&](int vertexStart, int vertexCount) {
      if (vertexCount <= 0) {
        return;
      }
      if (currentKind == DRAW_COMMAND_KIND_POLYLINE &&
          vertexStart == currentStart + currentCount) {
        currentCount += vertexCount;
        return;
      }
      flush();
      currentKind = DRAW_COMMAND_KIND_POLYLINE;
      currentStart = vertexStart;
      currentCount = vertexCount;
      currentExtra = 0;
    };

    enum class DrawEntryKind { Sprite, Leaderline, Polyline };

    const auto drawEntryLess = [&](DrawEntryKind lhsKind,
                                   size_t lhsIndex,
                                   DrawEntryKind rhsKind,
                                   size_t rhsIndex) {
      int lhsLayer = 0;
      int rhsLayer = 0;
      scalar_t lhsDepth = static_cast<scalar_t>(0.0f);
      scalar_t rhsDepth = static_cast<scalar_t>(0.0f);
      int lhsOrder = 0;
      int rhsOrder = 0;
      int lhsKindOrder = 0;
      int rhsKindOrder = 0;
      scalar_t lhsTie = static_cast<scalar_t>(0.0f);
      scalar_t rhsTie = static_cast<scalar_t>(0.0f);

      switch (lhsKind) {
        case DrawEntryKind::Sprite: {
          const auto &entry = workspace->entries[lhsIndex];
          lhsLayer = entry.layer;
          lhsDepth = entry.spriteDepth;
          lhsOrder = entry.order;
          lhsKindOrder = 1;
          lhsTie = entry.elementDepth;
          break;
        }
        case DrawEntryKind::Leaderline: {
          const auto &entry = workspace->leaderlineEntries[lhsIndex];
          lhsLayer = entry.layer;
          lhsDepth = entry.depth;
          lhsOrder = entry.order;
          lhsKindOrder = 0;
          lhsTie = static_cast<scalar_t>(entry.elementIndex);
          break;
        }
        case DrawEntryKind::Polyline: {
          const auto &entry = workspace->polylineEntries[lhsIndex];
          lhsLayer = entry.layer;
          lhsDepth = entry.depth;
          lhsOrder = entry.order;
          lhsKindOrder = 2;
          lhsTie = static_cast<scalar_t>(entry.segmentIndex);
          break;
        }
      }

      switch (rhsKind) {
        case DrawEntryKind::Sprite: {
          const auto &entry = workspace->entries[rhsIndex];
          rhsLayer = entry.layer;
          rhsDepth = entry.spriteDepth;
          rhsOrder = entry.order;
          rhsKindOrder = 1;
          rhsTie = entry.elementDepth;
          break;
        }
        case DrawEntryKind::Leaderline: {
          const auto &entry = workspace->leaderlineEntries[rhsIndex];
          rhsLayer = entry.layer;
          rhsDepth = entry.depth;
          rhsOrder = entry.order;
          rhsKindOrder = 0;
          rhsTie = static_cast<scalar_t>(entry.elementIndex);
          break;
        }
        case DrawEntryKind::Polyline: {
          const auto &entry = workspace->polylineEntries[rhsIndex];
          rhsLayer = entry.layer;
          rhsDepth = entry.depth;
          rhsOrder = entry.order;
          rhsKindOrder = 2;
          rhsTie = static_cast<scalar_t>(entry.segmentIndex);
          break;
        }
      }

      if (lhsLayer != rhsLayer) {
        return lhsLayer < rhsLayer;
      }
      if (lhsDepth != rhsDepth) {
        return lhsDepth < rhsDepth;
      }
      if (lhsOrder != rhsOrder) {
        return lhsOrder < rhsOrder;
      }
      if (lhsKindOrder != rhsKindOrder) {
        return lhsKindOrder < rhsKindOrder;
      }
      return lhsTie < rhsTie;
    };

    size_t spriteIndex = 0;
    size_t leaderIndex = 0;
    size_t polyIndex = 0;
    while (spriteIndex < workspace->entries.size() ||
           leaderIndex < workspace->leaderlineEntries.size() ||
           polyIndex < workspace->polylineEntries.size()) {
      bool hasCandidate = false;
      DrawEntryKind nextKind = DrawEntryKind::Sprite;
      size_t nextIndex = 0;

      if (spriteIndex < workspace->entries.size()) {
        nextKind = DrawEntryKind::Sprite;
        nextIndex = spriteIndex;
        hasCandidate = true;
      }
      if (leaderIndex < workspace->leaderlineEntries.size()) {
        if (!hasCandidate ||
            drawEntryLess(DrawEntryKind::Leaderline, leaderIndex, nextKind, nextIndex)) {
          nextKind = DrawEntryKind::Leaderline;
          nextIndex = leaderIndex;
          hasCandidate = true;
        }
      }
      if (polyIndex < workspace->polylineEntries.size()) {
        if (!hasCandidate ||
            drawEntryLess(DrawEntryKind::Polyline, polyIndex, nextKind, nextIndex)) {
          nextKind = DrawEntryKind::Polyline;
          nextIndex = polyIndex;
          hasCandidate = true;
        }
      }
      if (!hasCandidate) {
        break;
      }

      if (nextKind == DrawEntryKind::Sprite) {
        const int outputIndex = workspace->outputEntryIndices[nextIndex];
        const int outputCount =
            nextIndex < workspace->outputEntryCounts.size()
                ? workspace->outputEntryCounts[nextIndex]
                : 0;
        for (int localIndex = 0; localIndex < outputCount; ++localIndex) {
          const int pageId =
              outTexIndices ? outTexIndices[outputIndex + localIndex] : -1;
          if (pageId >= 0) {
            pushSprite(outputIndex + localIndex, pageId);
          }
        }
        const int elementIndex = workspace->entries[nextIndex].index;
        if (elementIndex >= 0 &&
            static_cast<size_t>(elementIndex) <
                workspace->elementBorderVertexCounts.size()) {
          const int borderVertexCount =
              workspace->elementBorderVertexCounts[static_cast<size_t>(elementIndex)];
          if (borderVertexCount > 0) {
            const int borderVertexStart =
                workspace->elementBorderVertexStarts[static_cast<size_t>(elementIndex)];
            pushPolyline(borderVertexStart, borderVertexCount);
          }
        }
        spriteIndex += 1;
      } else if (nextKind == DrawEntryKind::Leaderline) {
        const auto &entry = workspace->leaderlineEntries[nextIndex];
        pushPolyline(entry.vertexStart, entry.vertexCount);
        leaderIndex += 1;
      } else {
        const int vertexStart =
            workspace->polylineEntryVertexStarts[nextIndex];
        const int vertexCount =
            workspace->polylineEntryVertexCounts[nextIndex];
        pushPolyline(vertexStart, vertexCount);
        polyIndex += 1;
      }
    }

    flush();
    drawCommands[DRAW_COMMAND_COMMAND_COUNT_OFFSET] = commandCount;
    drawCommands[DRAW_COMMAND_POLYLINE_VERTEX_COUNT_OFFSET] = polylineVertexCount;
    drawCommands[DRAW_COMMAND_SPRITE_OUTPUT_COUNT_OFFSET] = spriteOutputCount;
  };

  if (statsEnabled) {
    const scalar_t writeStartMs = readNowMs();
    msp_wasm::EntryDebugBuffers entryDebugBuffers;
    msp_wasm::EntryDebugBuffers *entryDebug = nullptr;
    if (debugEntryEnabled) {
      entryDebugBuffers = msp_wasm::EntryDebugBuffers{
          &workspace->entryElementIndices,
          &workspace->entryBillboardSolveModes,
          &workspace->entryBillboardScreenFromDeg,
          &workspace->entryBillboardScreenToDeg,
          &workspace->entryBillboardScreenAngleDeg,
          &workspace->entryRotateDeg,
          &workspace->entryFinalRotateDeg,
          &workspace->entryRotationFromDeg,
          &workspace->entryRotationToDeg,
          &workspace->entryRotationDurationMs,
          &workspace->entryFinalRotationFromDeg,
          &workspace->entryFinalRotationToDeg,
          &workspace->entryFinalRotationDurationMs};
      entryDebug = &entryDebugBuffers;
    }
    const int spriteOutputCount = msp_wasm::writeOutputVertices(
        workspace->entries,
        sprite,
        element,
        spriteCount,
        viewMatrix,
        viewProjection,
        camera[CAMERA_VIEWPORT_ASPECT_OFFSET],
        camera[CAMERA_POSITION_X_OFFSET],
        camera[CAMERA_POSITION_Y_OFFSET],
        camera[CAMERA_POSITION_Z_OFFSET],
        nowMs,
        workspace->pivotXValues,
        workspace->pivotYValues,
        workspace->pivotZValues,
        workspace->spriteDistanceScaleFactors,
        workspace->pivotCameraDependentFlags,
        textures,
        output,
        outTexIndices,
        workspace->outputEntryIndices,
        workspace->outputEntryCounts,
        entryDebug,
        workspace->outputEntrySignatures,
        allowReuseOutput,
        cameraSignature,
        outputEntryCount);
    const int leaderlineVertexCount = msp_wasm::writeLeaderlineVertices(
        sprite,
        element,
        spriteCount,
        elementCount,
        viewMatrix,
        workspace->pivotXValues,
        workspace->pivotYValues,
        workspace->pivotZValues,
        workspace->basisRightXValues,
        workspace->basisRightYValues,
        workspace->basisRightZValues,
        workspace->basisUpXValues,
        workspace->basisUpYValues,
        workspace->basisUpZValues,
        workspace->spriteDistanceScaleFactors,
        polylineOutput,
        &workspace->leaderlineEntries);
    if (workspace->leaderlineEntries.size() > 1) {
      std::sort(
          workspace->leaderlineEntries.begin(),
          workspace->leaderlineEntries.end(),
          leaderlineEntryLess);
    }
    const int borderVertexCount = msp_wasm::writeBorderVertices(
        workspace->entries,
        sprite,
        element,
        spriteCount,
        viewMatrix,
        viewProjection,
        camera[CAMERA_VIEWPORT_ASPECT_OFFSET],
        camera[CAMERA_POSITION_X_OFFSET],
        camera[CAMERA_POSITION_Y_OFFSET],
        camera[CAMERA_POSITION_Z_OFFSET],
        workspace->pivotXValues,
        workspace->pivotYValues,
        workspace->pivotZValues,
        workspace->spriteDistanceScaleFactors,
        textures,
        polylineOutput,
        leaderlineVertexCount,
        workspace->elementBorderVertexStarts,
        workspace->elementBorderVertexCounts);
    const int polylineVertexCount = msp_wasm::writePolylineVertices(
        workspace->polylineEntries,
        polyline,
        polylineNodes,
        polylineCount,
        workspace->polylineNodeScaleFactors,
        polylineOutput,
        borderVertexCount,
        workspace->polylineNodeLengths,
        workspace->polylineEntryVertexStarts,
        workspace->polylineEntryVertexCounts);
    buildDrawCommands(polylineVertexCount, spriteOutputCount);
    writeOutputMs = readNowMs() - writeStartMs;
    const scalar_t totalMs = readNowMs() - totalStartMs;
    computeStatsBuffer[COMPUTE_STATS_TOTAL_MS_OFFSET] =
        totalMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : totalMs;
    computeStatsBuffer[COMPUTE_STATS_PROJECTION_MS_OFFSET] =
        projectionMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : projectionMs;
    computeStatsBuffer[COMPUTE_STATS_SPRITE_ANIMATION_MS_OFFSET] =
        spriteAnimationMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : spriteAnimationMs;
    computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_MS_OFFSET] =
        elementAnimationMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : elementAnimationMs;
    computeStatsBuffer[COMPUTE_STATS_PIVOT_RESOLVE_MS_OFFSET] =
        pivotResolveMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : pivotResolveMs;
    computeStatsBuffer[COMPUTE_STATS_AUTO_ROTATION_MS_OFFSET] =
        autoRotationMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : autoRotationMs;
    computeStatsBuffer[COMPUTE_STATS_CAMERA_TRACKING_MS_OFFSET] =
        cameraTrackingMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : cameraTrackingMs;
    computeStatsBuffer[COMPUTE_STATS_COLLECT_ENTRIES_MS_OFFSET] =
        collectEntriesMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : collectEntriesMs;
    computeStatsBuffer[COMPUTE_STATS_SORT_ENTRIES_MS_OFFSET] =
        sortEntriesMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : sortEntriesMs;
    computeStatsBuffer[COMPUTE_STATS_WRITE_OUTPUT_MS_OFFSET] =
        writeOutputMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : writeOutputMs;
    computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_OWNER_MS_OFFSET] =
        elementAnimOwnerMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : elementAnimOwnerMs;
    computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_OPACITY_MS_OFFSET] =
        elementAnimOpacityMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : elementAnimOpacityMs;
    computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_ROTATION_MS_OFFSET] =
        elementAnimRotationMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : elementAnimRotationMs;
    computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_SCALE_MS_OFFSET] =
        elementAnimScaleMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : elementAnimScaleMs;
    computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_ANCHOR_MS_OFFSET] =
        elementAnimAnchorMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : elementAnimAnchorMs;
    computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_SHIFT_MS_OFFSET] =
        elementAnimShiftMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : elementAnimShiftMs;
    computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_PIVOT_MS_OFFSET] =
        elementAnimPivotMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : elementAnimPivotMs;
    computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_MERGE_MS_OFFSET] =
        elementAnimMergeMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : elementAnimMergeMs;
    computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_SCALAR_MS_OFFSET] =
        elementAnimScalarMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : elementAnimScalarMs;
    computeStatsBuffer[COMPUTE_STATS_ELEMENT_ANIMATION_SIMD_LOOP_MS_OFFSET] =
        elementAnimSimdLoopMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : elementAnimSimdLoopMs;
    computeStatsBuffer[COMPUTE_STATS_CAMERA_TRACKING_APPLIED_OFFSET] =
        trackingAppliedCamera ? static_cast<scalar_t>(1.0f)
                             : static_cast<scalar_t>(0.0f);
    computeStatsBuffer[COMPUTE_STATS_CAMERA_TRACKING_RESOLVED_DISTANCE_OFFSET] =
        cameraTrackingEnabled && context
            ? context->cameraTracking.resolvedDistance
            : static_cast<scalar_t>(0.0f);
    computeStatsBuffer[COMPUTE_STATS_CAMERA_DIRTY_OFFSET] = cameraDirtyValue;
    workspace->lastActiveCount = visibleEntryCount;
    workspace->needsCompute = false;
    return visibleEntryCount;
  }

  msp_wasm::EntryDebugBuffers entryDebugBuffers;
  msp_wasm::EntryDebugBuffers *entryDebug = nullptr;
  if (debugEntryEnabled) {
    entryDebugBuffers = msp_wasm::EntryDebugBuffers{
        &workspace->entryElementIndices,
        &workspace->entryBillboardSolveModes,
        &workspace->entryBillboardScreenFromDeg,
        &workspace->entryBillboardScreenToDeg,
        &workspace->entryBillboardScreenAngleDeg,
        &workspace->entryRotateDeg,
        &workspace->entryFinalRotateDeg,
        &workspace->entryRotationFromDeg,
        &workspace->entryRotationToDeg,
        &workspace->entryRotationDurationMs,
        &workspace->entryFinalRotationFromDeg,
        &workspace->entryFinalRotationToDeg,
        &workspace->entryFinalRotationDurationMs};
    entryDebug = &entryDebugBuffers;
  }
  const int spriteOutputCount = msp_wasm::writeOutputVertices(
      workspace->entries,
      sprite,
      element,
      spriteCount,
      viewMatrix,
      viewProjection,
      camera[CAMERA_VIEWPORT_ASPECT_OFFSET],
      camera[CAMERA_POSITION_X_OFFSET],
      camera[CAMERA_POSITION_Y_OFFSET],
      camera[CAMERA_POSITION_Z_OFFSET],
      nowMs,
      workspace->pivotXValues,
      workspace->pivotYValues,
      workspace->pivotZValues,
      workspace->spriteDistanceScaleFactors,
      workspace->pivotCameraDependentFlags,
      textures,
      output,
      outTexIndices,
      workspace->outputEntryIndices,
      workspace->outputEntryCounts,
      entryDebug,
      workspace->outputEntrySignatures,
      allowReuseOutput,
      cameraSignature,
      outputEntryCount);
  const int leaderlineVertexCount = msp_wasm::writeLeaderlineVertices(
      sprite,
      element,
      spriteCount,
      elementCount,
      viewMatrix,
      workspace->pivotXValues,
      workspace->pivotYValues,
      workspace->pivotZValues,
      workspace->basisRightXValues,
      workspace->basisRightYValues,
      workspace->basisRightZValues,
      workspace->basisUpXValues,
      workspace->basisUpYValues,
      workspace->basisUpZValues,
      workspace->spriteDistanceScaleFactors,
      polylineOutput,
      &workspace->leaderlineEntries);
  if (workspace->leaderlineEntries.size() > 1) {
    std::sort(
        workspace->leaderlineEntries.begin(),
        workspace->leaderlineEntries.end(),
        leaderlineEntryLess);
  }
  const int borderVertexCount = msp_wasm::writeBorderVertices(
      workspace->entries,
      sprite,
      element,
      spriteCount,
      viewMatrix,
      viewProjection,
      camera[CAMERA_VIEWPORT_ASPECT_OFFSET],
      camera[CAMERA_POSITION_X_OFFSET],
      camera[CAMERA_POSITION_Y_OFFSET],
      camera[CAMERA_POSITION_Z_OFFSET],
      workspace->pivotXValues,
      workspace->pivotYValues,
      workspace->pivotZValues,
      workspace->spriteDistanceScaleFactors,
      textures,
      polylineOutput,
      leaderlineVertexCount,
      workspace->elementBorderVertexStarts,
      workspace->elementBorderVertexCounts);
  const int polylineVertexCount = msp_wasm::writePolylineVertices(
      workspace->polylineEntries,
      polyline,
      polylineNodes,
      polylineCount,
      workspace->polylineNodeScaleFactors,
      polylineOutput,
      borderVertexCount,
      workspace->polylineNodeLengths,
      workspace->polylineEntryVertexStarts,
      workspace->polylineEntryVertexCounts);
  buildDrawCommands(polylineVertexCount, spriteOutputCount);
  workspace->lastActiveCount = visibleEntryCount;
  workspace->needsCompute = false;
  return visibleEntryCount;
}

} // namespace

///////////////////////////////////////////////////////////////////////////////////////////////

static inline int projectWorldToViewportWithCamera(
    const scalar_t *camera,
    scalar_t worldX,
    scalar_t worldY,
    scalar_t worldZ,
    scalar_t viewportW,
    scalar_t viewportH,
    scalar_t *outXY,
    int outCount);

extern "C" {

/**
 * @brief Creates a command-processing context for the wasm compute pipeline.
 * @return Newly allocated context, or nullptr when allocation fails.
 */
void *__export_msp(create_context)() {
  return new (std::nothrow) CommandContext();
}

// ---------------------------------------------------------------------------------

/**
 * @brief Releases a context previously returned by `create_context`.
 * @param context Target context pointer. Null is accepted.
 */
void __export_msp(release_context)(void *context) {
  auto *ctx = static_cast<CommandContext *>(context);
  delete ctx;
}

// ---------------------------------------------------------------------------------

/**
 * @brief Registers the inbound command buffer used by `apply_commands`.
 * @param context Target command context.
 * @param buffer Command buffer in generated layout format.
 * @param count Number of scalar entries available in @p buffer.
 * @return `1` on success, otherwise `0`.
 */
int __export_msp(set_command_buffer)(void *context, scalar_t *buffer, int count) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx || !buffer || count < COMMAND_BUFFER_HEADER_FIELDS) {
    return 0;
  }
  ctx->commandBuffer = buffer;
  ctx->commandBufferCount = count;
  return 1;
}

// ---------------------------------------------------------------------------------

/**
 * @brief Registers the result buffer populated after command application.
 * @param context Target command context.
 * @param buffer Result buffer in generated layout format.
 * @param count Number of scalar entries available in @p buffer.
 * @return `1` on success, otherwise `0`.
 */
int __export_msp(set_result_buffer)(void *context, scalar_t *buffer, int count) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx || !buffer || count < COMMAND_RESULT_HEADER_FIELDS) {
    return 0;
  }
  ctx->resultBuffer = buffer;
  ctx->resultBufferCount = count;
  return 1;
}

// ---------------------------------------------------------------------------------

/**
 * @brief Registers the buffer that receives per-call command-application stats.
 * @param context Target command context.
 * @param buffer Stats buffer in generated layout format.
 * @param count Number of scalar entries available in @p buffer.
 * @return `1` when the buffer was accepted, otherwise `0`.
 */
int __export_msp(set_apply_stats_buffer)(void *context, scalar_t *buffer, int count) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx || !buffer || count < APPLY_STATS_FIELDS) {
    if (ctx) {
      ctx->applyStatsBuffer = nullptr;
      ctx->applyStatsBufferCount = 0;
    }
    return 0;
  }
  ctx->applyStatsBuffer = buffer;
  ctx->applyStatsBufferCount = count;
  return 1;
}

// ---------------------------------------------------------------------------------

/**
 * @brief Registers the buffer that receives per-call vertex-compute stats.
 * @param context Target command context.
 * @param buffer Stats buffer in generated layout format.
 * @param count Number of scalar entries available in @p buffer.
 * @return `1` when the buffer was accepted, otherwise `0`.
 */
int __export_msp(set_compute_stats_buffer)(void *context, scalar_t *buffer, int count) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx || !buffer || count < COMPUTE_STATS_FIELDS) {
    if (ctx) {
      ctx->computeStatsBuffer = nullptr;
      ctx->computeStatsBufferCount = 0;
    }
    return 0;
  }
  ctx->computeStatsBuffer = buffer;
  ctx->computeStatsBufferCount = count;
  return 1;
}

// ---------------------------------------------------------------------------------

/**
 * @brief Registers the atlas-page pick-mask metadata table used by sprite picking.
 * @param context Target command context.
 * @param buffer Int32 page-table buffer.
 * @param count Number of int entries available in @p buffer.
 * @return `1` when the buffer was accepted, otherwise `0`.
 */
int __export_msp(set_pick_mask_page_table_buffer)(
    void *context,
    int *buffer,
    int count) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx || !buffer || count < PICK_MASK_PAGE_FIELDS) {
    if (ctx) {
      ctx->pickMaskPageTableBuffer = nullptr;
      ctx->pickMaskPageTableBufferCount = 0;
    }
    return 0;
  }
  ctx->pickMaskPageTableBuffer = buffer;
  ctx->pickMaskPageTableBufferCount = count;
  return 1;
}

// ---------------------------------------------------------------------------------

/**
 * @brief Registers the atlas-page pick-mask bitset buffer used by sprite picking.
 * @param context Target command context.
 * @param buffer Int32 bitset buffer.
 * @param count Number of int entries available in @p buffer.
 * @return `1` when the buffer was accepted, otherwise `0`.
 */
int __export_msp(set_pick_mask_word_buffer)(
    void *context,
    int *buffer,
    int count) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx || !buffer || count < 1) {
    if (ctx) {
      ctx->pickMaskWordBuffer = nullptr;
      ctx->pickMaskWordBufferCount = 0;
    }
    return 0;
  }
  ctx->pickMaskWordBuffer = buffer;
  ctx->pickMaskWordBufferCount = count;
  return 1;
}

// ---------------------------------------------------------------------------------

/**
 * @brief Updates distance-based scaling limits for sprites and polylines.
 * @param context Target command context.
 * @param spriteMinScaleDistance Near clamp distance for sprites.
 * @param spriteMaxScaleDistance Far clamp distance for sprites.
 * @param polylineMinScaleDistance Near clamp distance for polylines.
 * @param polylineMaxScaleDistance Far clamp distance for polylines.
 * @return `1` on success, otherwise `0`.
 */
int __export_msp(set_scaling_options)(
    void *context,
    scalar_t spriteMinScaleDistance,
    scalar_t spriteMaxScaleDistance,
    scalar_t polylineMinScaleDistance,
    scalar_t polylineMaxScaleDistance) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx) {
    return 0;
  }
  scalar_t resolvedSpriteMinScaleDistance = static_cast<scalar_t>(0.0f);
  scalar_t resolvedSpriteMaxScaleDistance =
      msp_wasm::scalingUnlimitedMaxDistance();
  msp_wasm::normalizeScalingRange(
      spriteMinScaleDistance,
      spriteMaxScaleDistance,
      resolvedSpriteMinScaleDistance,
      resolvedSpriteMaxScaleDistance);
  scalar_t resolvedPolylineMinScaleDistance = static_cast<scalar_t>(0.0f);
  scalar_t resolvedPolylineMaxScaleDistance =
      msp_wasm::scalingUnlimitedMaxDistance();
  msp_wasm::normalizeScalingRange(
      polylineMinScaleDistance,
      polylineMaxScaleDistance,
      resolvedPolylineMinScaleDistance,
      resolvedPolylineMaxScaleDistance);
  ctx->cameraBuffer[CAMERA_SPRITE_SCALING_MIN_DISTANCE_OFFSET] =
      resolvedSpriteMinScaleDistance;
  ctx->cameraBuffer[CAMERA_SPRITE_SCALING_MAX_DISTANCE_OFFSET] =
      resolvedSpriteMaxScaleDistance;
  ctx->cameraBuffer[CAMERA_POLYLINE_SCALING_MIN_DISTANCE_OFFSET] =
      resolvedPolylineMinScaleDistance;
  ctx->cameraBuffer[CAMERA_POLYLINE_SCALING_MAX_DISTANCE_OFFSET] =
      resolvedPolylineMaxScaleDistance;
  ctx->workspace.needsCompute = true;
  return 1;
}

// ---------------------------------------------------------------------------------

/**
 * @brief Updates the persistent camera-tracking state stored in the context.
 * @param context Target command context.
 * @param spriteSlots Dense tracked sprite-slot list.
 * @param spriteSlotCount Number of tracked sprite slots.
 * @param targetMode Tracking target mode enum.
 * @param distance Optional fixed tracking distance.
 * @param minDistance Optional minimum tracking distance.
 * @param fitPadding Optional fit padding multiplier.
 * @param fitZoomBias Optional fit zoom bias multiplier.
 * @param interpolationKind Tracking interpolation strategy enum.
 * @param interpolationMode Interpolation mode used when @p interpolationKind is set.
 * @param interpolationDuration Interpolation duration in milliseconds.
 * @param interpolationEasing Easing enum used when @p interpolationKind is set.
 * @param interpolationParam0 Easing parameter 0.
 * @param interpolationParam1 Easing parameter 1.
 * @param interpolationParam2 Easing parameter 2.
 * @param interpolationParam3 Easing parameter 3.
 * @return `1` on success, otherwise `0`.
 */
int __export_msp(set_camera_tracking)(
    void *context,
    const int *spriteSlots,
    int spriteSlotCount,
    int targetMode,
    scalar_t distance,
    scalar_t minDistance,
    scalar_t fitPadding,
    scalar_t fitZoomBias,
    int interpolationKind,
    scalar_t interpolationMode,
    scalar_t interpolationDuration,
    scalar_t interpolationEasing,
    scalar_t interpolationParam0,
    scalar_t interpolationParam1,
    scalar_t interpolationParam2,
    scalar_t interpolationParam3) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx || !spriteSlots || spriteSlotCount <= 0) {
    return 0;
  }
  auto &tracking = ctx->cameraTracking;
  tracking.enabled = true;
  tracking.targetMode =
      targetMode == CAMERA_TRACKING_TARGET_MODE_CONTENT_APPROX
          ? CAMERA_TRACKING_TARGET_MODE_CONTENT_APPROX
          : CAMERA_TRACKING_TARGET_MODE_BASE;
  tracking.spriteSlots.assign(
      spriteSlots, spriteSlots + std::max(0, spriteSlotCount));
  tracking.distance = isFinitePositiveTracking(distance)
      ? distance
      : std::numeric_limits<scalar_t>::quiet_NaN();
  tracking.minDistance = isFinitePositiveTracking(minDistance)
      ? minDistance
      : std::numeric_limits<scalar_t>::quiet_NaN();
  tracking.fitPadding = normalizePositiveTracking(
      fitPadding, CAMERA_TRACKING_DEFAULT_FIT_PADDING);
  tracking.fitZoomBias = normalizePositiveTracking(
      fitZoomBias, CAMERA_TRACKING_DEFAULT_ZOOM_BIAS);
  tracking.interpolation.kind =
      interpolationKind == CAMERA_TRACKING_INTERPOLATION_SET
          ? CAMERA_TRACKING_INTERPOLATION_SET
          : (interpolationKind == CAMERA_TRACKING_INTERPOLATION_CLEAR
                 ? CAMERA_TRACKING_INTERPOLATION_CLEAR
                 : CAMERA_TRACKING_INTERPOLATION_KEEP);
  tracking.interpolation.mode = interpolationMode;
  tracking.interpolation.duration =
      std::isfinite(interpolationDuration) && interpolationDuration > 0
          ? interpolationDuration
          : static_cast<scalar_t>(0.0f);
  tracking.interpolation.easing = interpolationEasing;
  tracking.interpolation.param0 = interpolationParam0;
  tracking.interpolation.param1 = interpolationParam1;
  tracking.interpolation.param2 = interpolationParam2;
  tracking.interpolation.param3 = interpolationParam3;
  tracking.resolvedDistance = isFinitePositiveTracking(tracking.distance)
      ? resolveCameraTrackingDistanceValue(
            tracking.distance,
            tracking,
            tracking.spriteSlots.size() > 1)
      : static_cast<scalar_t>(0.0f);
  ctx->workspace.needsCompute = true;
  return 1;
}

/**
 * @brief Clears the persistent camera-tracking state stored in the context.
 * @param context Target command context.
 * @return `1` on success, otherwise `0`.
 */
int __export_msp(clear_camera_tracking)(void *context) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx) {
    return 0;
  }
  ctx->cameraTracking = CameraTrackingConfig{};
  ctx->workspace.needsCompute = true;
  return 1;
}

// ---------------------------------------------------------------------------------

/**
 * @brief Applies all queued commands in the registered command buffer.
 * @param context Target command context.
 * @param nowMs Timestamp used for commands that omit an explicit issue time.
 * @return `1` on success, otherwise `0`.
 * @remarks Failures are reported into the registered result buffer while the
 * command buffer itself is reset for reuse after the call.
 */
int __export_msp(apply_commands)(void *context, scalar_t nowMs) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx || !ctx->commandBuffer || ctx->commandBufferCount < COMMAND_BUFFER_HEADER_FIELDS) {
    return 0;
  }
  updateCameraAnimations(ctx->cameraBuffer.data(), nowMs);

  const bool statsEnabled = ctx->applyStatsBuffer &&
      ctx->applyStatsBufferCount >= APPLY_STATS_FIELDS;
  scalar_t totalStartMs = static_cast<scalar_t>(0.0f);
  scalar_t loopStartMs = static_cast<scalar_t>(0.0f);
  scalar_t loopEndMs = static_cast<scalar_t>(0.0f);
  scalar_t clearDurationMs = static_cast<scalar_t>(0.0f);
  if (statsEnabled) {
    totalStartMs = readNowMs();
    loopStartMs = totalStartMs;
    ctx->applyStatsSyncSlotsMs = static_cast<scalar_t>(0.0f);
  }

  scalar_t *buffer = ctx->commandBuffer;
  const int used = static_cast<int>(buffer[COMMAND_BUFFER_USED_OFFSET]);
  const int commandCount = static_cast<int>(buffer[COMMAND_BUFFER_COMMAND_COUNT_OFFSET]);
  if (used < COMMAND_BUFFER_HEADER_FIELDS || used > ctx->commandBufferCount || commandCount < 0) {
    return 0;
  }
  if (commandCount > 0) {
    ctx->workspace.needsCompute = true;
  }

  std::vector<int> failures;
  std::vector<scalar_t> results;

  int cursor = COMMAND_BUFFER_HEADER_FIELDS;
  for (int index = 0; index < commandCount; ++index) {
    if (cursor + COMMAND_HEADER_FIELDS > used) {
      break;
    }
    const scalar_t *command = buffer + cursor;
    const int op = static_cast<int>(command[COMMAND_HEADER_OP_OFFSET]);
    const int size = static_cast<int>(command[COMMAND_HEADER_SIZE_OFFSET]);
    // Stop at the first malformed payload so the failure list points at the
    // command boundary the caller needs to inspect.
    if (size <= COMMAND_HEADER_FIELDS || cursor + size > used) {
      failures.push_back(index);
      break;
    }

    bool ok = true;
    switch (op) {
      case COMMAND_OP_UPDATE_CAMERA:
        ok = size >= COMMAND_UPDATE_CAMERA_FIELDS &&
            applyUpdateCamera(*ctx, command, nowMs);
        break;
      case COMMAND_OP_ADJUST_CAMERA_POSITION:
        ok = size >= COMMAND_ADJUST_CAMERA_POSITION_FIELDS &&
            applyAdjustCameraPosition(*ctx, command, nowMs);
        break;
      case COMMAND_OP_SET_TEXTURE_INFO:
        ok =
            size >= COMMAND_SET_TEXTURE_INFO_FIELDS && applySetTextureInfo(*ctx, command);
        break;
      case COMMAND_OP_SET_TILED_TEXTURE_INFO:
        ok = size >= COMMAND_SET_TILED_TEXTURE_INFO_FIELDS &&
            applySetTiledTextureInfo(*ctx, command);
        break;
      case COMMAND_OP_SET_TEXTURE_TILE_INFO:
        ok = size >= COMMAND_SET_TEXTURE_TILE_INFO_FIELDS &&
            applySetTextureTileInfo(*ctx, command);
        break;
      case COMMAND_OP_ADD_SPRITE: {
        if (size < COMMAND_ADD_SPRITE_BASE_FIELDS) {
          ok = false;
          break;
        }
        const int elementCount = static_cast<int>(command[COMMAND_ADD_SPRITE_ELEMENT_COUNT_OFFSET]);
        const int expectedSize =
            COMMAND_ADD_SPRITE_BASE_FIELDS + elementCount * COMMAND_ELEMENT_FIELDS;
        ok = elementCount >= 0 && size >= expectedSize &&
            applyAddSprite(*ctx, command, nowMs, results);
        break;
      }
      case COMMAND_OP_UPDATE_SPRITE: {
        if (size < COMMAND_UPDATE_SPRITE_BASE_FIELDS) {
          ok = false;
          break;
        }
        const scalar_t commandNowMs = resolveCommandTimestamp(
            command, COMMAND_UPDATE_SPRITE_ISSUED_AT_TIMESTAMP_OFFSET, nowMs);
        const int updateCount = static_cast<int>(
            command[COMMAND_UPDATE_SPRITE_ELEMENT_UPDATE_COUNT_OFFSET]);
        const int expectedSize =
            COMMAND_UPDATE_SPRITE_BASE_FIELDS +
            updateCount * COMMAND_UPDATE_ELEMENT_FIELDS;
        ok = updateCount >= 0 && size >= expectedSize &&
            applyUpdateSprite(*ctx, command, commandNowMs);
        break;
      }
      case COMMAND_OP_REMOVE_SPRITE:
        ok = size >= COMMAND_REMOVE_SPRITE_FIELDS && applyRemoveSprite(*ctx, command);
        break;
      case COMMAND_OP_ADD_POLYLINE: {
        if (size < COMMAND_ADD_POLYLINE_BASE_FIELDS) {
          ok = false;
          break;
        }
        const int nodeCount =
            static_cast<int>(command[COMMAND_ADD_POLYLINE_NODE_COUNT_OFFSET]);
        const int expectedSize =
            COMMAND_ADD_POLYLINE_BASE_FIELDS +
            nodeCount * COMMAND_POLYLINE_NODE_FIELDS;
        ok = nodeCount >= 0 && size >= expectedSize &&
            applyAddPolyline(*ctx, command, nowMs, results);
        break;
      }
      case COMMAND_OP_UPDATE_POLYLINE: {
        if (size < COMMAND_UPDATE_POLYLINE_BASE_FIELDS) {
          ok = false;
          break;
        }
        const scalar_t commandNowMs = resolveCommandTimestamp(
            command, COMMAND_UPDATE_POLYLINE_ISSUED_AT_TIMESTAMP_OFFSET, nowMs);
        const int nodeCount =
            static_cast<int>(command[COMMAND_UPDATE_POLYLINE_NODE_COUNT_OFFSET]);
        const int expectedSize = nodeCount < 0
            ? COMMAND_UPDATE_POLYLINE_BASE_FIELDS
            : COMMAND_UPDATE_POLYLINE_BASE_FIELDS +
                nodeCount * COMMAND_POLYLINE_NODE_FIELDS;
        ok = size >= expectedSize &&
            applyUpdatePolyline(*ctx, command, commandNowMs);
        break;
      }
      case COMMAND_OP_REMOVE_POLYLINE:
        ok =
            size >= COMMAND_REMOVE_POLYLINE_FIELDS &&
            applyRemovePolyline(*ctx, command);
        break;
      default:
        ok = false;
        break;
    }
    if (!ok) {
      failures.push_back(index);
    }
    cursor += size;
  }

  if (statsEnabled) {
    loopEndMs = readNowMs();
  }

  if (ctx->resultBuffer && ctx->resultBufferCount >= COMMAND_RESULT_HEADER_FIELDS) {
    const int failedCount = static_cast<int>(failures.size());
    const int resultCount = static_cast<int>(results.size());
    const int required = COMMAND_RESULT_HEADER_FIELDS + failedCount + resultCount;
    if (required <= ctx->resultBufferCount) {
      ctx->resultBuffer[COMMAND_RESULT_FAILED_COUNT_OFFSET] =
          static_cast<scalar_t>(failedCount);
      ctx->resultBuffer[COMMAND_RESULT_RESULT_COUNT_OFFSET] =
          static_cast<scalar_t>(resultCount);
      for (int i = 0; i < failedCount; ++i) {
        ctx->resultBuffer[COMMAND_RESULT_HEADER_FIELDS + i] =
            static_cast<scalar_t>(failures[static_cast<size_t>(i)]);
      }
      for (int i = 0; i < resultCount; ++i) {
        ctx->resultBuffer[COMMAND_RESULT_HEADER_FIELDS + failedCount + i] =
            results[static_cast<size_t>(i)];
      }
    } else {
      ctx->resultBuffer[COMMAND_RESULT_FAILED_COUNT_OFFSET] = 0.0f;
      ctx->resultBuffer[COMMAND_RESULT_RESULT_COUNT_OFFSET] = 0.0f;
    }
  }

  if (ctx->commandBuffer && ctx->commandBufferCount > 0) {
    scalar_t clearStartMs = static_cast<scalar_t>(0.0f);
    if (statsEnabled) {
      clearStartMs = readNowMs();
    }
    std::memset(
        buffer,
        0,
        static_cast<size_t>(ctx->commandBufferCount) * sizeof(scalar_t));
    buffer[COMMAND_BUFFER_USED_OFFSET] =
        static_cast<scalar_t>(COMMAND_BUFFER_HEADER_FIELDS);
    buffer[COMMAND_BUFFER_COMMAND_COUNT_OFFSET] = static_cast<scalar_t>(0.0f);
    if (statsEnabled) {
      clearDurationMs = readNowMs() - clearStartMs;
    }
  }

  if (statsEnabled) {
    const scalar_t totalMs = readNowMs() - totalStartMs;
    const scalar_t loopMs = loopEndMs - loopStartMs;
    ctx->applyStatsBuffer[APPLY_STATS_TOTAL_MS_OFFSET] =
        totalMs < static_cast<scalar_t>(0.0f) ? static_cast<scalar_t>(0.0f) : totalMs;
    ctx->applyStatsBuffer[APPLY_STATS_LOOP_MS_OFFSET] =
        loopMs < static_cast<scalar_t>(0.0f) ? static_cast<scalar_t>(0.0f) : loopMs;
    ctx->applyStatsBuffer[APPLY_STATS_SYNC_SLOTS_MS_OFFSET] =
        ctx->applyStatsSyncSlotsMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : ctx->applyStatsSyncSlotsMs;
    ctx->applyStatsBuffer[APPLY_STATS_CLEAR_MS_OFFSET] =
        clearDurationMs < static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(0.0f)
            : clearDurationMs;
  }
  return 1;
}

// ---------------------------------------------------------------------------------

/**
 * @brief Reads back the current state of one sprite and its elements.
 * @param context Target command context.
 * @param spriteId Public sprite identifier.
 * @param spriteOut Receives one sprite state record.
 * @param spriteOutCount Capacity of @p spriteOut in scalar entries.
 * @param elementOut Receives contiguous element state records for the sprite.
 * @param elementOutCount Capacity of @p elementOut in scalar entries.
 * @param nowMs Optional timestamp override used to materialize state.
 *   `0` uses the last computed snapshot timestamp.
 * @return `1` on success, otherwise `0`.
 */
int __export_msp(get_sprite_state)(
    void *context,
    int spriteId,
    scalar_t *spriteOut,
    int spriteOutCount,
    scalar_t *elementOut,
    int elementOutCount,
    scalar_t nowMs) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx || !spriteOut || spriteOutCount < WASM_STATE_SPRITE_STRIDE) {
    return 0;
  }
  if (spriteId < 0 || spriteId >= static_cast<int>(ctx->sprites.size())) {
    return 0;
  }

  const auto &spriteMeta = ctx->sprites[static_cast<size_t>(spriteId)];
  const int elementCount = static_cast<int>(spriteMeta.elements.size());
  if (elementCount > 0) {
    const int required = elementCount * WASM_STATE_ELEMENT_STRIDE;
    if (!elementOut || elementOutCount < required) {
      return 0;
    }
  }

  auto &workspace = ctx->workspace;
  const int spriteSlot = spriteMeta.slot;
  const bool useTimestampOverride = hasStateTimestampOverride(nowMs);
  const scalar_t resolvedTimestampMs = resolveStateTimestamp(ctx, nowMs);
  const WorkspaceSlotInterpolationTarget spriteTarget{workspace, spriteSlot};

  spriteOut[STATE_SPRITE_TIMESTAMP_MS_OFFSET] = resolvedTimestampMs;
  writeInterpolationState<SpriteInterpolationAccessor>(
      spriteTarget,
      SPRITE_SX_FIELD,
      useTimestampOverride,
      resolvedTimestampMs,
      false,
      spriteOut,
      STATE_SPRITE_SX_VALUE_OFFSET,
      STATE_SPRITE_SX_HAS_INTERPOLATION_OFFSET,
      STATE_SPRITE_SX_FROM_OFFSET,
      STATE_SPRITE_SX_TO_OFFSET,
      STATE_SPRITE_SX_MODE_OFFSET,
      STATE_SPRITE_SX_DURATION_OFFSET,
      STATE_SPRITE_SX_EASING_OFFSET,
      STATE_SPRITE_SX_EASING_PARAM0_OFFSET,
      STATE_SPRITE_SX_EASING_PARAM1_OFFSET);
  writeInterpolationState<SpriteInterpolationAccessor>(
      spriteTarget,
      SPRITE_SY_FIELD,
      useTimestampOverride,
      resolvedTimestampMs,
      false,
      spriteOut,
      STATE_SPRITE_SY_VALUE_OFFSET,
      STATE_SPRITE_SY_HAS_INTERPOLATION_OFFSET,
      STATE_SPRITE_SY_FROM_OFFSET,
      STATE_SPRITE_SY_TO_OFFSET,
      STATE_SPRITE_SY_MODE_OFFSET,
      STATE_SPRITE_SY_DURATION_OFFSET,
      STATE_SPRITE_SY_EASING_OFFSET,
      STATE_SPRITE_SY_EASING_PARAM0_OFFSET,
      STATE_SPRITE_SY_EASING_PARAM1_OFFSET);
  spriteOut[STATE_SPRITE_SZ_OFFSET] =
      getSpriteValue(workspace, SPRITE_Z_OFFSET, spriteSlot);
  spriteOut[STATE_SPRITE_VISIBILITY_DISTANCE_OFFSET] =
      getSpriteValue(workspace, SPRITE_VISIBILITY_DISTANCE_OFFSET, spriteSlot);
  writeInterpolationState<SpriteInterpolationAccessor>(
      spriteTarget,
      SPRITE_OPACITY_FIELD,
      useTimestampOverride,
      resolvedTimestampMs,
      false,
      spriteOut,
      STATE_SPRITE_OPACITY_VALUE_OFFSET,
      STATE_SPRITE_OPACITY_HAS_INTERPOLATION_OFFSET,
      STATE_SPRITE_OPACITY_FROM_OFFSET,
      STATE_SPRITE_OPACITY_TO_OFFSET,
      STATE_SPRITE_OPACITY_MODE_OFFSET,
      STATE_SPRITE_OPACITY_DURATION_OFFSET,
      STATE_SPRITE_OPACITY_EASING_OFFSET,
      STATE_SPRITE_OPACITY_EASING_PARAM0_OFFSET,
      STATE_SPRITE_OPACITY_EASING_PARAM1_OFFSET);

  spriteOut[STATE_SPRITE_VIEWPORT_BASE_VALID_OFFSET] =
      static_cast<scalar_t>(0.0f);
  spriteOut[STATE_SPRITE_VIEWPORT_BASE_X_PIXEL_OFFSET] =
      static_cast<scalar_t>(0.0f);
  spriteOut[STATE_SPRITE_VIEWPORT_BASE_Y_PIXEL_OFFSET] =
      static_cast<scalar_t>(0.0f);
  if (ctx->lastSnapshotValid &&
      ctx->lastSnapshotViewportWidth > static_cast<scalar_t>(0.0f) &&
      ctx->lastSnapshotViewportHeight > static_cast<scalar_t>(0.0f)) {
    scalar_t projected[2] = {static_cast<scalar_t>(0.0f), static_cast<scalar_t>(0.0f)};
    if (useTimestampOverride) {
      std::vector<scalar_t> camera(ctx->cameraBuffer.begin(), ctx->cameraBuffer.end());
      const CameraInterpolationTarget cameraTarget{camera.data()};
      camera[CAMERA_POSITION_X_OFFSET] =
          evaluateInterpolationSample<CameraInterpolationAccessor>(
              cameraTarget,
              CAMERA_POSITION_X_FIELD,
              true,
              resolvedTimestampMs)
              .value;
      camera[CAMERA_POSITION_Y_OFFSET] =
          evaluateInterpolationSample<CameraInterpolationAccessor>(
              cameraTarget,
              CAMERA_POSITION_Y_FIELD,
              true,
              resolvedTimestampMs)
              .value;
      camera[CAMERA_POSITION_Z_OFFSET] =
          evaluateInterpolationSample<CameraInterpolationAccessor>(
              cameraTarget,
              CAMERA_POSITION_Z_FIELD,
              true,
              resolvedTimestampMs)
              .value;
      camera[CAMERA_ROTATION_YAW_OFFSET] =
          evaluateInterpolationSample<CameraInterpolationAccessor>(
              cameraTarget,
              CAMERA_ROTATION_YAW_FIELD,
              true,
              resolvedTimestampMs)
              .value;
      camera[CAMERA_ROTATION_PITCH_OFFSET] =
          evaluateInterpolationSample<CameraInterpolationAccessor>(
              cameraTarget,
              CAMERA_ROTATION_PITCH_FIELD,
              true,
              resolvedTimestampMs)
              .value;
      camera[CAMERA_ROTATION_ROLL_OFFSET] =
          evaluateInterpolationSample<CameraInterpolationAccessor>(
              cameraTarget,
              CAMERA_ROTATION_ROLL_FIELD,
              true,
              resolvedTimestampMs)
              .value;
      camera[CAMERA_FOV_Y_OFFSET] =
          evaluateInterpolationSample<CameraInterpolationAccessor>(
              cameraTarget,
              CAMERA_FOV_Y_FIELD,
              true,
              resolvedTimestampMs)
              .value;
      if (projectWorldToViewportWithCamera(
              camera.data(),
              spriteOut[STATE_SPRITE_SX_VALUE_OFFSET],
              spriteOut[STATE_SPRITE_SY_VALUE_OFFSET],
              spriteOut[STATE_SPRITE_SZ_OFFSET],
              ctx->lastSnapshotViewportWidth,
              ctx->lastSnapshotViewportHeight,
              projected,
              2)) {
        spriteOut[STATE_SPRITE_VIEWPORT_BASE_VALID_OFFSET] =
            static_cast<scalar_t>(1.0f);
        spriteOut[STATE_SPRITE_VIEWPORT_BASE_X_PIXEL_OFFSET] = projected[0];
        spriteOut[STATE_SPRITE_VIEWPORT_BASE_Y_PIXEL_OFFSET] = projected[1];
      }
    } else if (
        projectWorldToViewportWithCamera(
            ctx->cameraBuffer.data(),
            spriteOut[STATE_SPRITE_SX_VALUE_OFFSET],
            spriteOut[STATE_SPRITE_SY_VALUE_OFFSET],
            spriteOut[STATE_SPRITE_SZ_OFFSET],
            ctx->lastSnapshotViewportWidth,
            ctx->lastSnapshotViewportHeight,
            projected,
            2)) {
      spriteOut[STATE_SPRITE_VIEWPORT_BASE_VALID_OFFSET] =
          static_cast<scalar_t>(1.0f);
      spriteOut[STATE_SPRITE_VIEWPORT_BASE_X_PIXEL_OFFSET] = projected[0];
      spriteOut[STATE_SPRITE_VIEWPORT_BASE_Y_PIXEL_OFFSET] = projected[1];
    }
  }

  for (int index = 0; index < elementCount; ++index) {
    const auto &elementMeta = spriteMeta.elements[static_cast<size_t>(index)];
    const int slot = elementMeta.slot;
    const int base = index * WASM_STATE_ELEMENT_STRIDE;
    const WorkspaceSlotInterpolationTarget elementTarget{workspace, slot};

    writeInterpolationState<ElementInterpolationAccessor>(
        elementTarget,
        ELEMENT_SHIFT_DISTANCE_FIELD,
        useTimestampOverride,
        resolvedTimestampMs,
        false,
        elementOut + base,
        STATE_ELEMENT_SHIFT_DISTANCE_VALUE_OFFSET,
        STATE_ELEMENT_SHIFT_DISTANCE_HAS_INTERPOLATION_OFFSET,
        STATE_ELEMENT_SHIFT_DISTANCE_FROM_OFFSET,
        STATE_ELEMENT_SHIFT_DISTANCE_TO_OFFSET,
        STATE_ELEMENT_SHIFT_DISTANCE_MODE_OFFSET,
        STATE_ELEMENT_SHIFT_DISTANCE_DURATION_OFFSET,
        STATE_ELEMENT_SHIFT_DISTANCE_EASING_OFFSET,
        STATE_ELEMENT_SHIFT_DISTANCE_EASING_PARAM0_OFFSET,
        STATE_ELEMENT_SHIFT_DISTANCE_EASING_PARAM1_OFFSET);
    writeInterpolationState<ElementInterpolationAccessor>(
        elementTarget,
        ELEMENT_SHIFT_ANGLE_FIELD,
        useTimestampOverride,
        resolvedTimestampMs,
        true,
        elementOut + base,
        STATE_ELEMENT_SHIFT_ANGLE_DEG_VALUE_OFFSET,
        STATE_ELEMENT_SHIFT_ANGLE_DEG_HAS_INTERPOLATION_OFFSET,
        STATE_ELEMENT_SHIFT_ANGLE_DEG_FROM_OFFSET,
        STATE_ELEMENT_SHIFT_ANGLE_DEG_TO_OFFSET,
        STATE_ELEMENT_SHIFT_ANGLE_DEG_MODE_OFFSET,
        STATE_ELEMENT_SHIFT_ANGLE_DEG_DURATION_OFFSET,
        STATE_ELEMENT_SHIFT_ANGLE_DEG_EASING_OFFSET,
        STATE_ELEMENT_SHIFT_ANGLE_DEG_EASING_PARAM0_OFFSET,
        STATE_ELEMENT_SHIFT_ANGLE_DEG_EASING_PARAM1_OFFSET);
    writeInterpolationState<ElementInterpolationAccessor>(
        elementTarget,
        ELEMENT_SCALE_FIELD,
        useTimestampOverride,
        resolvedTimestampMs,
        false,
        elementOut + base,
        STATE_ELEMENT_SCALE_VALUE_OFFSET,
        STATE_ELEMENT_SCALE_HAS_INTERPOLATION_OFFSET,
        STATE_ELEMENT_SCALE_FROM_OFFSET,
        STATE_ELEMENT_SCALE_TO_OFFSET,
        STATE_ELEMENT_SCALE_MODE_OFFSET,
        STATE_ELEMENT_SCALE_DURATION_OFFSET,
        STATE_ELEMENT_SCALE_EASING_OFFSET,
        STATE_ELEMENT_SCALE_EASING_PARAM0_OFFSET,
        STATE_ELEMENT_SCALE_EASING_PARAM1_OFFSET);
    writeInterpolationState<ElementInterpolationAccessor>(
        elementTarget,
        ELEMENT_OPACITY_FIELD,
        useTimestampOverride,
        resolvedTimestampMs,
        false,
        elementOut + base,
        STATE_ELEMENT_OPACITY_VALUE_OFFSET,
        STATE_ELEMENT_OPACITY_HAS_INTERPOLATION_OFFSET,
        STATE_ELEMENT_OPACITY_FROM_OFFSET,
        STATE_ELEMENT_OPACITY_TO_OFFSET,
        STATE_ELEMENT_OPACITY_MODE_OFFSET,
        STATE_ELEMENT_OPACITY_DURATION_OFFSET,
        STATE_ELEMENT_OPACITY_EASING_OFFSET,
        STATE_ELEMENT_OPACITY_EASING_PARAM0_OFFSET,
        STATE_ELEMENT_OPACITY_EASING_PARAM1_OFFSET);
    elementOut[base + STATE_ELEMENT_BORDER_WIDTH_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_BORDER_WIDTH_OFFSET, slot);
    elementOut[base + STATE_ELEMENT_BORDER_COLOR_R_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_BORDER_COLOR_R_OFFSET, slot);
    elementOut[base + STATE_ELEMENT_BORDER_COLOR_G_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_BORDER_COLOR_G_OFFSET, slot);
    elementOut[base + STATE_ELEMENT_BORDER_COLOR_B_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_BORDER_COLOR_B_OFFSET, slot);
    elementOut[base + STATE_ELEMENT_BORDER_COLOR_A_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_BORDER_COLOR_A_OFFSET, slot);
    writeInterpolationState<ElementInterpolationAccessor>(
        elementTarget,
        ELEMENT_LEADERLINE_WIDTH_FIELD,
        useTimestampOverride,
        resolvedTimestampMs,
        false,
        elementOut + base,
        STATE_ELEMENT_LEADERLINE_WIDTH_VALUE_OFFSET,
        STATE_ELEMENT_LEADERLINE_WIDTH_HAS_INTERPOLATION_OFFSET,
        STATE_ELEMENT_LEADERLINE_WIDTH_FROM_OFFSET,
        STATE_ELEMENT_LEADERLINE_WIDTH_TO_OFFSET,
        STATE_ELEMENT_LEADERLINE_WIDTH_MODE_OFFSET,
        STATE_ELEMENT_LEADERLINE_WIDTH_DURATION_OFFSET,
        STATE_ELEMENT_LEADERLINE_WIDTH_EASING_OFFSET,
        STATE_ELEMENT_LEADERLINE_WIDTH_EASING_PARAM0_OFFSET,
        STATE_ELEMENT_LEADERLINE_WIDTH_EASING_PARAM1_OFFSET);

    elementOut[base + STATE_ELEMENT_LEADERLINE_COLOR0_R_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_LEADERLINE_COLOR0_R_OFFSET, slot);
    elementOut[base + STATE_ELEMENT_LEADERLINE_COLOR0_G_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_LEADERLINE_COLOR0_G_OFFSET, slot);
    elementOut[base + STATE_ELEMENT_LEADERLINE_COLOR0_B_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_LEADERLINE_COLOR0_B_OFFSET, slot);
    elementOut[base + STATE_ELEMENT_LEADERLINE_COLOR0_A_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_LEADERLINE_COLOR0_A_OFFSET, slot);
    elementOut[base + STATE_ELEMENT_LEADERLINE_COLOR1_R_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_LEADERLINE_COLOR1_R_OFFSET, slot);
    elementOut[base + STATE_ELEMENT_LEADERLINE_COLOR1_G_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_LEADERLINE_COLOR1_G_OFFSET, slot);
    elementOut[base + STATE_ELEMENT_LEADERLINE_COLOR1_B_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_LEADERLINE_COLOR1_B_OFFSET, slot);
    elementOut[base + STATE_ELEMENT_LEADERLINE_COLOR1_A_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_LEADERLINE_COLOR1_A_OFFSET, slot);
    elementOut[base + STATE_ELEMENT_LEADERLINE_REPEAT_LENGTH_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_LEADERLINE_REPEAT_LENGTH_OFFSET, slot);
    writeInterpolationState<ElementInterpolationAccessor>(
        elementTarget,
        ELEMENT_ANCHOR_X_FIELD,
        useTimestampOverride,
        resolvedTimestampMs,
        false,
        elementOut + base,
        STATE_ELEMENT_ANCHOR_X_VALUE_OFFSET,
        STATE_ELEMENT_ANCHOR_X_HAS_INTERPOLATION_OFFSET,
        STATE_ELEMENT_ANCHOR_X_FROM_OFFSET,
        STATE_ELEMENT_ANCHOR_X_TO_OFFSET,
        STATE_ELEMENT_ANCHOR_X_MODE_OFFSET,
        STATE_ELEMENT_ANCHOR_X_DURATION_OFFSET,
        STATE_ELEMENT_ANCHOR_X_EASING_OFFSET,
        STATE_ELEMENT_ANCHOR_X_EASING_PARAM0_OFFSET,
        STATE_ELEMENT_ANCHOR_X_EASING_PARAM1_OFFSET);
    writeInterpolationState<ElementInterpolationAccessor>(
        elementTarget,
        ELEMENT_ANCHOR_Y_FIELD,
        useTimestampOverride,
        resolvedTimestampMs,
        false,
        elementOut + base,
        STATE_ELEMENT_ANCHOR_Y_VALUE_OFFSET,
        STATE_ELEMENT_ANCHOR_Y_HAS_INTERPOLATION_OFFSET,
        STATE_ELEMENT_ANCHOR_Y_FROM_OFFSET,
        STATE_ELEMENT_ANCHOR_Y_TO_OFFSET,
        STATE_ELEMENT_ANCHOR_Y_MODE_OFFSET,
        STATE_ELEMENT_ANCHOR_Y_DURATION_OFFSET,
        STATE_ELEMENT_ANCHOR_Y_EASING_OFFSET,
        STATE_ELEMENT_ANCHOR_Y_EASING_PARAM0_OFFSET,
        STATE_ELEMENT_ANCHOR_Y_EASING_PARAM1_OFFSET);

    const InterpolationSample rotationSample =
        evaluateInterpolationSample<ElementInterpolationAccessor>(
            elementTarget,
            ELEMENT_ROTATION_FIELD,
            useTimestampOverride,
            resolvedTimestampMs,
            true);
    const scalar_t rotationStartMs =
        getElementValue(workspace, SPRITE_ELEMENT_ROTATE_START_TIMESTAMP_OFFSET, slot);
    const scalar_t rotationEasing =
        getElementValue(workspace, SPRITE_ELEMENT_ROTATE_EASING_OFFSET, slot);
    const scalar_t rotationParam0 =
        getElementValue(workspace, SPRITE_ELEMENT_ROTATE_EASING_PARAM0_OFFSET, slot);
    const scalar_t rotationParam1 =
        getElementValue(workspace, SPRITE_ELEMENT_ROTATE_EASING_PARAM1_OFFSET, slot);
    const scalar_t rotationParam2 =
        getElementValue(workspace, SPRITE_ELEMENT_ROTATE_EASING_PARAM2_OFFSET, slot);
    const scalar_t rotationParam3 =
        getElementValue(workspace, SPRITE_ELEMENT_ROTATE_EASING_PARAM3_OFFSET, slot);
    const scalar_t autoDirectionSpace =
        getElementValue(workspace, SPRITE_ELEMENT_AUTO_DIRECTION_SPACE_OFFSET, slot);
    const scalar_t autoDirectionMode =
        getElementValue(workspace, SPRITE_ELEMENT_AUTO_DIRECTION_MODE_OFFSET, slot);
    const scalar_t autoDirectionShiftAngleRotation =
        getElementValue(
            workspace,
            SPRITE_ELEMENT_AUTO_DIRECTION_SHIFT_ANGLE_ROTATION_OFFSET,
            slot);
    const scalar_t autoDirectionMinDistance =
        getElementValue(workspace, SPRITE_ELEMENT_AUTO_DIRECTION_MIN_DISTANCE_OFFSET, slot);
    const scalar_t autoDirectionDirectionDeg =
        getElementValue(workspace, SPRITE_ELEMENT_AUTO_DIRECTION_DEG_OFFSET, slot);
    const scalar_t autoDirectionFlipXEnabled =
        getElementValue(
            workspace,
            SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_X_ENABLED_OFFSET,
            slot);
    const scalar_t autoDirectionFlipYEnabled =
        getElementValue(
            workspace,
            SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_Y_ENABLED_OFFSET,
            slot);
    const scalar_t autoDirectionInterpDuration =
        getElementValue(
            workspace,
            SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_CONFIG_DURATION_OFFSET,
            slot);
    const scalar_t autoDirectionInterpMode =
        getElementValue(
            workspace,
            SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_MODE_OFFSET,
            slot);
    const scalar_t autoDirectionInterpEasing =
        getElementValue(
            workspace,
            SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_EASING_OFFSET,
            slot);
    const scalar_t autoDirectionInterpParam0 =
        getElementValue(
            workspace,
            SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_PARAM0_OFFSET,
            slot);
    const scalar_t autoDirectionInterpParam1 =
        getElementValue(
            workspace,
            SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_PARAM1_OFFSET,
            slot);
    const scalar_t autoDirectionInterpParam2 =
        getElementValue(
            workspace,
            SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_PARAM2_OFFSET,
            slot);
    const scalar_t autoDirectionInterpParam3 =
        getElementValue(
            workspace,
            SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_PARAM3_OFFSET,
            slot);
    elementOut[base + STATE_ELEMENT_ROTATION_VALUE_OFFSET] = rotationSample.value;
    elementOut[base + STATE_ELEMENT_ROTATION_HAS_INTERPOLATION_OFFSET] =
        rotationSample.hasInterpolation;
    elementOut[base + STATE_ELEMENT_ROTATION_FROM_OFFSET] = rotationSample.fromValue;
    elementOut[base + STATE_ELEMENT_ROTATION_TO_OFFSET] = rotationSample.toValue;
    elementOut[base + STATE_ELEMENT_ROTATION_MODE_OFFSET] = rotationSample.mode;
    elementOut[base + STATE_ELEMENT_ROTATION_DURATION_OFFSET] =
        rotationSample.duration;
    elementOut[base + STATE_ELEMENT_ROTATION_EASING_OFFSET] = rotationSample.easing;
    elementOut[base + STATE_ELEMENT_ROTATION_EASING_PARAM0_OFFSET] =
        rotationSample.param0;
    elementOut[base + STATE_ELEMENT_ROTATION_EASING_PARAM1_OFFSET] =
        rotationSample.param1;
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_SPACE_OFFSET] =
        autoDirectionSpace;
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_MODE_OFFSET] =
        autoDirectionMode;
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_SHIFT_ANGLE_ROTATION_OFFSET] =
        autoDirectionShiftAngleRotation;
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_MIN_DISTANCE_OFFSET] =
        autoDirectionMinDistance;
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_DIRECTION_DEG_OFFSET] =
        autoDirectionDirectionDeg;
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_FLIP_X_ENABLED_OFFSET] =
        autoDirectionFlipXEnabled;
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_FLIP_Y_ENABLED_OFFSET] =
        autoDirectionFlipYEnabled;
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_INTERP_HAS_OFFSET] =
        (std::isfinite(autoDirectionInterpDuration) &&
         autoDirectionInterpDuration > static_cast<scalar_t>(0.0f))
            ? static_cast<scalar_t>(1.0f)
            : static_cast<scalar_t>(0.0f);
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_INTERP_MODE_OFFSET] =
        autoDirectionInterpMode;
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_INTERP_DURATION_OFFSET] =
        autoDirectionInterpDuration;
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_INTERP_EASING_OFFSET] =
        autoDirectionInterpEasing;
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_INTERP_PARAM0_OFFSET] =
        autoDirectionInterpParam0;
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_INTERP_PARAM1_OFFSET] =
        autoDirectionInterpParam1;
    const scalar_t autoFlipStartMs =
        getElementValue(workspace, SPRITE_ELEMENT_AUTO_FLIP_START_TIMESTAMP_OFFSET, slot);
    const scalar_t autoFlipDuration =
        getElementValue(workspace, SPRITE_ELEMENT_AUTO_FLIP_DURATION_OFFSET, slot);
    const scalar_t autoFlipXFrom =
        getElementValue(workspace, SPRITE_ELEMENT_AUTO_FLIP_X_FROM_OFFSET, slot);
    const scalar_t autoFlipXTo =
        getElementValue(workspace, SPRITE_ELEMENT_AUTO_FLIP_X_TO_OFFSET, slot);
    const scalar_t autoFlipYFrom =
        getElementValue(workspace, SPRITE_ELEMENT_AUTO_FLIP_Y_FROM_OFFSET, slot);
    const scalar_t autoFlipYTo =
        getElementValue(workspace, SPRITE_ELEMENT_AUTO_FLIP_Y_TO_OFFSET, slot);
    scalar_t autoFlipXValue =
        getElementValue(workspace, SPRITE_ELEMENT_AUTO_FLIP_X_OFFSET, slot);
    scalar_t autoFlipYValue =
        getElementValue(workspace, SPRITE_ELEMENT_AUTO_FLIP_Y_OFFSET, slot);
    if (useTimestampOverride &&
        autoFlipDuration > static_cast<scalar_t>(0.0f) &&
        std::isfinite(autoFlipStartMs) &&
        std::isfinite(autoFlipXFrom) && std::isfinite(autoFlipXTo) &&
        std::isfinite(autoFlipYFrom) && std::isfinite(autoFlipYTo)) {
      const scalar_t t = (resolvedTimestampMs - autoFlipStartMs) / autoFlipDuration;
      if (t <= static_cast<scalar_t>(0.0f)) {
        autoFlipXValue = autoFlipXFrom;
        autoFlipYValue = autoFlipYFrom;
      } else if (t >= static_cast<scalar_t>(1.0f)) {
        autoFlipXValue = autoFlipXTo;
        autoFlipYValue = autoFlipYTo;
      } else {
        const scalar_t tEased = msp_wasm::applyEasingScalar(
            t,
            autoDirectionInterpEasing,
            autoDirectionInterpParam0,
            autoDirectionInterpParam1,
            autoDirectionInterpParam2,
            autoDirectionInterpParam3);
        autoFlipXValue = autoFlipXFrom + (autoFlipXTo - autoFlipXFrom) * tEased;
        autoFlipYValue = autoFlipYFrom + (autoFlipYTo - autoFlipYFrom) * tEased;
      }
    }
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_FLIP_X_COMMAND_VALUE_OFFSET] =
        autoFlipXTo;
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_FLIP_X_VALUE_OFFSET] =
        autoFlipXValue;
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_FLIP_Y_COMMAND_VALUE_OFFSET] =
        autoFlipYTo;
    elementOut[base + STATE_ELEMENT_AUTO_DIRECTION_FLIP_Y_VALUE_OFFSET] =
        autoFlipYValue;
    const scalar_t finalRotationFrom =
        getElementValue(workspace, SPRITE_ELEMENT_FINAL_ROTATE_FROM_OFFSET, slot);
    const scalar_t finalRotationTo =
        getElementValue(workspace, SPRITE_ELEMENT_FINAL_ROTATE_TO_OFFSET, slot);
    const scalar_t finalRotationStartMs =
        getElementValue(workspace, SPRITE_ELEMENT_FINAL_ROTATE_START_TIMESTAMP_OFFSET, slot);
    const scalar_t finalRotationDuration =
        getElementValue(workspace, SPRITE_ELEMENT_FINAL_ROTATE_DURATION_OFFSET, slot);
    const scalar_t finalRotationDelta =
        msp_wasm::wrapAngleDelta(finalRotationTo - finalRotationFrom);
    scalar_t finalRotationDeg =
        getElementValue(workspace, SPRITE_ELEMENT_FINAL_ROTATE_DEG_OFFSET, slot);
    scalar_t finalRotationT = static_cast<scalar_t>(0.0f);
    scalar_t finalRotationTEased = static_cast<scalar_t>(0.0f);
    if (useTimestampOverride &&
        finalRotationDuration > static_cast<scalar_t>(0.0f) &&
        std::isfinite(finalRotationStartMs) &&
        std::isfinite(finalRotationFrom) && std::isfinite(finalRotationTo)) {
      const scalar_t t =
          (resolvedTimestampMs - finalRotationStartMs) / finalRotationDuration;
      if (t <= static_cast<scalar_t>(0.0f)) {
        finalRotationDeg = finalRotationFrom;
        finalRotationT = static_cast<scalar_t>(0.0f);
        finalRotationTEased = static_cast<scalar_t>(0.0f);
      } else if (t >= static_cast<scalar_t>(1.0f)) {
        finalRotationDeg = finalRotationTo;
        finalRotationT = static_cast<scalar_t>(1.0f);
        finalRotationTEased = static_cast<scalar_t>(1.0f);
      } else {
        finalRotationT = t;
        finalRotationTEased = msp_wasm::applyEasingScalar(
            t,
            rotationEasing,
            rotationParam0,
            rotationParam1,
            rotationParam2,
            rotationParam3);
        finalRotationDeg =
        finalRotationFrom + finalRotationDelta * finalRotationTEased;
      }
    }
    const scalar_t shiftAngleEasing =
        getElementValue(workspace, SPRITE_ELEMENT_SHIFT_ANGLE_DEG_EASING_OFFSET, slot);
    const scalar_t shiftAngleParam0 =
        getElementValue(
            workspace,
            SPRITE_ELEMENT_SHIFT_ANGLE_DEG_EASING_PARAM0_OFFSET,
            slot);
    const scalar_t shiftAngleParam1 =
        getElementValue(
            workspace,
            SPRITE_ELEMENT_SHIFT_ANGLE_DEG_EASING_PARAM1_OFFSET,
            slot);
    const scalar_t shiftAngleParam2 =
        getElementValue(
            workspace,
            SPRITE_ELEMENT_SHIFT_ANGLE_DEG_EASING_PARAM2_OFFSET,
            slot);
    const scalar_t shiftAngleParam3 =
        getElementValue(
            workspace,
            SPRITE_ELEMENT_SHIFT_ANGLE_DEG_EASING_PARAM3_OFFSET,
            slot);
    const scalar_t finalShiftAngleFrom =
        getElementValue(workspace, SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_FROM_OFFSET, slot);
    const scalar_t finalShiftAngleTo =
        getElementValue(workspace, SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_TO_OFFSET, slot);
    const scalar_t finalShiftAngleStartMs =
        getElementValue(
            workspace,
            SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_START_TIMESTAMP_OFFSET,
            slot);
    const scalar_t finalShiftAngleDuration =
        getElementValue(workspace, SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_DURATION_OFFSET, slot);
    const scalar_t finalShiftAngleDelta =
        msp_wasm::wrapAngleDelta(finalShiftAngleTo - finalShiftAngleFrom);
    scalar_t finalShiftAngleDeg =
        getElementValue(workspace, SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_DEG_OFFSET, slot);
    if (useTimestampOverride &&
        finalShiftAngleDuration > static_cast<scalar_t>(0.0f) &&
        std::isfinite(finalShiftAngleStartMs) &&
        std::isfinite(finalShiftAngleFrom) && std::isfinite(finalShiftAngleTo)) {
      const scalar_t t =
          (resolvedTimestampMs - finalShiftAngleStartMs) / finalShiftAngleDuration;
      if (t <= static_cast<scalar_t>(0.0f)) {
        finalShiftAngleDeg = finalShiftAngleFrom;
      } else if (t >= static_cast<scalar_t>(1.0f)) {
        finalShiftAngleDeg = finalShiftAngleTo;
      } else {
        const scalar_t tEased = msp_wasm::applyEasingScalar(
            t,
            shiftAngleEasing,
            shiftAngleParam0,
            shiftAngleParam1,
            shiftAngleParam2,
            shiftAngleParam3);
        finalShiftAngleDeg =
            finalShiftAngleFrom + finalShiftAngleDelta * tEased;
      }
    }
    elementOut[base + STATE_ELEMENT_ROTATION_FINAL_DEG_OFFSET] = finalRotationDeg;
    elementOut[base + STATE_ELEMENT_SHIFT_ANGLE_FINAL_DEG_OFFSET] =
        finalShiftAngleDeg;
    elementOut[base + STATE_ELEMENT_ROTATION_START_TIMESTAMP_OFFSET] =
        rotationStartMs;
    elementOut[base + STATE_ELEMENT_ROTATION_T_OFFSET] = rotationSample.t;
    elementOut[base + STATE_ELEMENT_ROTATION_T_EASED_OFFSET] = rotationSample.tEased;
    elementOut[base + STATE_ELEMENT_ROTATION_DELTA_DEG_OFFSET] = rotationSample.delta;
    elementOut[base + STATE_ELEMENT_FINAL_ROTATION_FROM_OFFSET] =
        finalRotationFrom;
    elementOut[base + STATE_ELEMENT_FINAL_ROTATION_TO_OFFSET] = finalRotationTo;
    elementOut[base + STATE_ELEMENT_FINAL_ROTATION_START_TIMESTAMP_OFFSET] =
        finalRotationStartMs;
    elementOut[base + STATE_ELEMENT_FINAL_ROTATION_DURATION_OFFSET] =
        finalRotationDuration;
    elementOut[base + STATE_ELEMENT_FINAL_ROTATION_T_OFFSET] =
        finalRotationT;
    elementOut[base + STATE_ELEMENT_FINAL_ROTATION_T_EASED_OFFSET] =
        finalRotationTEased;
    elementOut[base + STATE_ELEMENT_FINAL_ROTATION_DELTA_DEG_OFFSET] =
        finalRotationDelta;

    elementOut[base + STATE_ELEMENT_TEX_INDEX_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_TEX_INDEX_OFFSET, slot);
    elementOut[base + STATE_ELEMENT_ORIGIN_LOCATION_INDEX_OFFSET] =
        static_cast<scalar_t>(elementMeta.originLocationIndex);
    elementOut[base + STATE_ELEMENT_ORIGIN_LOCATION_USE_RESOLVED_ANCHOR_OFFSET] =
        getElementValue(
            workspace,
            SPRITE_ELEMENT_ORIGIN_LOCATION_USE_RESOLVED_ANCHOR_OFFSET,
            slot);
    elementOut[base + STATE_ELEMENT_ORDER_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_ORDER_OFFSET, slot);
    elementOut[base + STATE_ELEMENT_LAYER_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_LAYER_OFFSET, slot);
    elementOut[base + STATE_ELEMENT_RENDER_MODE_OFFSET] =
        getElementValue(workspace, SPRITE_ELEMENT_RENDER_MODE_OFFSET, slot);
  }

  return 1;
}

// ---------------------------------------------------------------------------------

/**
 * @brief Reads back the current state of one polyline and its nodes.
 * @param context Target command context.
 * @param polylineId Public polyline identifier.
 * @param polylineOut Receives one polyline state record.
 * @param polylineOutCount Capacity of @p polylineOut in scalar entries.
 * @param nodeOut Receives contiguous node records for the polyline.
 * @param nodeOutCount Capacity of @p nodeOut in scalar entries.
 * @param nowMs Optional timestamp override used to materialize state.
 *   `0` uses the last computed snapshot timestamp.
 * @return `1` on success, otherwise `0`.
 */
int __export_msp(get_polyline_state)(
    void *context,
    int polylineId,
    scalar_t *polylineOut,
    int polylineOutCount,
    scalar_t *nodeOut,
    int nodeOutCount,
    scalar_t nowMs) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx || !polylineOut || polylineOutCount < WASM_STATE_POLYLINE_STRIDE) {
    return 0;
  }
  if (polylineId < 0 || polylineId >= static_cast<int>(ctx->polylines.size())) {
    return 0;
  }

  const auto &polylineMeta = ctx->polylines[static_cast<size_t>(polylineId)];
  const int nodeCount = polylineMeta.nodeCount;
  if (nodeCount > 0) {
    const int required = nodeCount * WASM_POLYLINE_NODE_INPUT_FIELDS;
    if (!nodeOut || nodeOutCount < required) {
      return 0;
    }
  }

  auto &workspace = ctx->workspace;
  const int slot = polylineMeta.slot;
  const bool useTimestampOverride = hasStateTimestampOverride(nowMs);
  const scalar_t resolvedTimestampMs = resolveStateTimestamp(ctx, nowMs);
  const WorkspaceSlotInterpolationTarget polylineTarget{workspace, slot};

  polylineOut[STATE_POLYLINE_TIMESTAMP_MS_OFFSET] = resolvedTimestampMs;
  writeInterpolationState<PolylineInterpolationAccessor>(
      polylineTarget,
      POLYLINE_OPACITY_FIELD,
      useTimestampOverride,
      resolvedTimestampMs,
      false,
      polylineOut,
      STATE_POLYLINE_OPACITY_VALUE_OFFSET,
      STATE_POLYLINE_OPACITY_HAS_INTERPOLATION_OFFSET,
      STATE_POLYLINE_OPACITY_FROM_OFFSET,
      STATE_POLYLINE_OPACITY_TO_OFFSET,
      STATE_POLYLINE_OPACITY_MODE_OFFSET,
      STATE_POLYLINE_OPACITY_DURATION_OFFSET,
      STATE_POLYLINE_OPACITY_EASING_OFFSET,
      STATE_POLYLINE_OPACITY_EASING_PARAM0_OFFSET,
      STATE_POLYLINE_OPACITY_EASING_PARAM1_OFFSET);

  polylineOut[STATE_POLYLINE_LAYER_OFFSET] =
      getPolylineValue(workspace, POLYLINE_LAYER_OFFSET, slot);
  polylineOut[STATE_POLYLINE_COLOR0_R_OFFSET] =
      getPolylineValue(workspace, POLYLINE_COLOR0_R_OFFSET, slot);
  polylineOut[STATE_POLYLINE_COLOR0_G_OFFSET] =
      getPolylineValue(workspace, POLYLINE_COLOR0_G_OFFSET, slot);
  polylineOut[STATE_POLYLINE_COLOR0_B_OFFSET] =
      getPolylineValue(workspace, POLYLINE_COLOR0_B_OFFSET, slot);
  polylineOut[STATE_POLYLINE_COLOR0_A_OFFSET] =
      getPolylineValue(workspace, POLYLINE_COLOR0_A_OFFSET, slot);
  polylineOut[STATE_POLYLINE_COLOR1_R_OFFSET] =
      getPolylineValue(workspace, POLYLINE_COLOR1_R_OFFSET, slot);
  polylineOut[STATE_POLYLINE_COLOR1_G_OFFSET] =
      getPolylineValue(workspace, POLYLINE_COLOR1_G_OFFSET, slot);
  polylineOut[STATE_POLYLINE_COLOR1_B_OFFSET] =
      getPolylineValue(workspace, POLYLINE_COLOR1_B_OFFSET, slot);
  polylineOut[STATE_POLYLINE_COLOR1_A_OFFSET] =
      getPolylineValue(workspace, POLYLINE_COLOR1_A_OFFSET, slot);
  polylineOut[STATE_POLYLINE_REPEAT_LENGTH_OFFSET] =
      getPolylineValue(workspace, POLYLINE_REPEAT_LENGTH_OFFSET, slot);
  polylineOut[STATE_POLYLINE_JOIN_CORRECTION_MODE_OFFSET] =
      getPolylineValue(workspace, POLYLINE_JOIN_CORRECTION_MODE_OFFSET, slot);
  polylineOut[STATE_POLYLINE_JOIN_CORRECTION_INTERMEDIATE_POINT_COUNT_OFFSET] =
      getPolylineValue(
          workspace,
          POLYLINE_JOIN_CORRECTION_INTERMEDIATE_POINT_COUNT_OFFSET,
          slot);
  polylineOut[STATE_POLYLINE_CAP_CORRECTION_MODE_OFFSET] =
      getPolylineValue(workspace, POLYLINE_CAP_CORRECTION_MODE_OFFSET, slot);
  polylineOut[STATE_POLYLINE_CAP_CORRECTION_POINT_COUNT_OFFSET] =
      getPolylineValue(workspace, POLYLINE_CAP_CORRECTION_POINT_COUNT_OFFSET, slot);
  polylineOut[STATE_POLYLINE_NODE_COUNT_OFFSET] =
      static_cast<scalar_t>(nodeCount);

  if (nodeCount > 0 && nodeOut) {
    const int nodeOffset = polylineMeta.nodeOffset;
    const int capacity = workspace.polylineNodeCapacity;
    const scalar_t *nodeBuffer = workspace.polylineNodeInputBuffer.data();
    for (int i = 0; i < nodeCount; ++i) {
      const int nodeIndex = nodeOffset + i;
      const int base = i * WASM_POLYLINE_NODE_INPUT_FIELDS;
      nodeOut[base + POLYLINE_NODE_X_OFFSET] =
          nodeBuffer[POLYLINE_NODE_X_OFFSET * capacity + nodeIndex];
      nodeOut[base + POLYLINE_NODE_Y_OFFSET] =
          nodeBuffer[POLYLINE_NODE_Y_OFFSET * capacity + nodeIndex];
      nodeOut[base + POLYLINE_NODE_THICKNESS_OFFSET] =
          nodeBuffer[POLYLINE_NODE_THICKNESS_OFFSET * capacity + nodeIndex];
    }
  }

  return 1;
}

// ---------------------------------------------------------------------------------

/**
 * @brief Reads back the current camera state buffer.
 * @param context Target command context.
 * @param cameraOut Receives the camera buffer contents.
 * @param cameraOutCount Capacity of @p cameraOut in scalar entries.
 * @return `1` on success, otherwise `0`.
 */
int __export_msp(get_camera_state)(
    void *context,
    scalar_t *cameraOut,
    int cameraOutCount) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx || !cameraOut || cameraOutCount < CAMERA_BUFFER_SIZE) {
    return 0;
  }
  const scalar_t *camera = ctx->cameraBuffer.data();
  std::memcpy(
      cameraOut,
      camera,
      sizeof(scalar_t) * CAMERA_BUFFER_SIZE);
  cameraOut[CAMERA_POSITION_X_HAS_INTERPOLATION_OFFSET] =
      camera[CAMERA_POSITION_X_DURATION_OFFSET] > static_cast<scalar_t>(0.0f)
          ? static_cast<scalar_t>(1.0f)
          : static_cast<scalar_t>(0.0f);
  cameraOut[CAMERA_POSITION_Y_HAS_INTERPOLATION_OFFSET] =
      camera[CAMERA_POSITION_Y_DURATION_OFFSET] > static_cast<scalar_t>(0.0f)
          ? static_cast<scalar_t>(1.0f)
          : static_cast<scalar_t>(0.0f);
  cameraOut[CAMERA_POSITION_Z_HAS_INTERPOLATION_OFFSET] =
      camera[CAMERA_POSITION_Z_DURATION_OFFSET] > static_cast<scalar_t>(0.0f)
          ? static_cast<scalar_t>(1.0f)
          : static_cast<scalar_t>(0.0f);
  cameraOut[CAMERA_ROTATION_YAW_HAS_INTERPOLATION_OFFSET] =
      camera[CAMERA_ROTATION_YAW_DURATION_OFFSET] > static_cast<scalar_t>(0.0f)
          ? static_cast<scalar_t>(1.0f)
          : static_cast<scalar_t>(0.0f);
  cameraOut[CAMERA_ROTATION_PITCH_HAS_INTERPOLATION_OFFSET] =
      camera[CAMERA_ROTATION_PITCH_DURATION_OFFSET] > static_cast<scalar_t>(0.0f)
          ? static_cast<scalar_t>(1.0f)
          : static_cast<scalar_t>(0.0f);
  cameraOut[CAMERA_ROTATION_ROLL_HAS_INTERPOLATION_OFFSET] =
      camera[CAMERA_ROTATION_ROLL_DURATION_OFFSET] > static_cast<scalar_t>(0.0f)
          ? static_cast<scalar_t>(1.0f)
          : static_cast<scalar_t>(0.0f);
  cameraOut[CAMERA_FOV_Y_HAS_INTERPOLATION_OFFSET] =
      camera[CAMERA_FOV_Y_DURATION_OFFSET] > static_cast<scalar_t>(0.0f)
          ? static_cast<scalar_t>(1.0f)
          : static_cast<scalar_t>(0.0f);
  return 1;
}

// ---------------------------------------------------------------------------------

/**
 * @brief Projects a screen coordinate onto the specified world-space Z plane.
 * @param context Target command context.
 * @param screenX Screen-space X coordinate in pixels.
 * @param screenY Screen-space Y coordinate in pixels.
 * @param viewportW Viewport width in pixels.
 * @param viewportH Viewport height in pixels.
 * @param planeZ Target world-space Z plane.
 * @param outXY Receives the projected world-space X/Y pair.
 * @param outCount Capacity of @p outXY in scalar entries.
 * @return `1` on success, otherwise `0`.
 */
int __export_msp(screen_to_world_on_plane)(
    void *context,
    scalar_t screenX,
    scalar_t screenY,
    scalar_t viewportW,
    scalar_t viewportH,
    scalar_t planeZ,
    scalar_t *outXY,
    int outCount) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx || !outXY || outCount < 2) {
    return 0;
  }
  const bool ok =
      screenToWorldOnPlane(ctx->cameraBuffer.data(), screenX, screenY, viewportW, viewportH, planeZ, outXY);
  return ok ? 1 : 0;
}

// ---------------------------------------------------------------------------------

/**
 * @brief Projects a screen coordinate onto a Z plane using an explicit camera buffer.
 * @param context Target command context. Required for ABI symmetry.
 * @param camera Camera buffer in generated layout format.
 * @param cameraCount Number of scalar entries available in @p camera.
 * @param screenX Screen-space X coordinate in pixels.
 * @param screenY Screen-space Y coordinate in pixels.
 * @param viewportW Viewport width in pixels.
 * @param viewportH Viewport height in pixels.
 * @param planeZ Target world-space Z plane.
 * @param outXY Receives the projected world-space X/Y pair.
 * @param outCount Capacity of @p outXY in scalar entries.
 * @return `1` on success, otherwise `0`.
 */
int __export_msp(screen_to_world_on_plane_with_camera)(
    void *context,
    const scalar_t *camera,
    int cameraCount,
    scalar_t screenX,
    scalar_t screenY,
    scalar_t viewportW,
    scalar_t viewportH,
    scalar_t planeZ,
    scalar_t *outXY,
    int outCount) {
  if (!context || !camera || cameraCount < CAMERA_BUFFER_SIZE || !outXY || outCount < 2) {
    return 0;
  }
  const bool ok =
      screenToWorldOnPlane(camera, screenX, screenY, viewportW, viewportH, planeZ, outXY);
  return ok ? 1 : 0;
}

// ---------------------------------------------------------------------------------

static inline int projectWorldToViewportWithCamera(
    const scalar_t *camera,
    scalar_t worldX,
    scalar_t worldY,
    scalar_t worldZ,
    scalar_t viewportW,
    scalar_t viewportH,
    scalar_t *outXY,
    int outCount) {
  // Shared helper for the public projection APIs so validation and camera math
  // stay identical regardless of whether the caller passes an explicit camera.
  if (!camera || !outXY || outCount < 2) {
    return 0;
  }
  if (!isFiniteScalar(worldX) || !isFiniteScalar(worldY) ||
      !isFiniteScalar(worldZ) || !isFiniteScalar(viewportW) ||
      !isFiniteScalar(viewportH) || viewportW <= static_cast<scalar_t>(0.0f) ||
      viewportH <= static_cast<scalar_t>(0.0f)) {
    return 0;
  }

  scalar_t viewMatrix[16];
  scalar_t viewProjection[16];
  msp_wasm::computeProjection(camera, viewMatrix, viewProjection);

  scalar_t ndcX = static_cast<scalar_t>(0.0f);
  scalar_t ndcY = static_cast<scalar_t>(0.0f);
  if (!projectToNdc(viewProjection, worldX, worldY, worldZ, ndcX, ndcY)) {
    return 0;
  }
  if (!isFiniteScalar(ndcX) || !isFiniteScalar(ndcY)) {
    return 0;
  }

  const scalar_t half = static_cast<scalar_t>(0.5f);
  outXY[0] = (ndcX + static_cast<scalar_t>(1.0f)) * half * viewportW;
  outXY[1] = (static_cast<scalar_t>(1.0f) - ndcY) * half * viewportH;
  return 1;
}

/**
 * @brief Projects a world-space position into viewport pixel coordinates.
 * @param context Target command context.
 * @param worldX World-space X coordinate.
 * @param worldY World-space Y coordinate.
 * @param worldZ World-space Z coordinate.
 * @param viewportW Viewport width in pixels.
 * @param viewportH Viewport height in pixels.
 * @param outXY Receives the projected pixel coordinates.
 * @param outCount Capacity of @p outXY in scalar entries.
 * @return `1` on success, otherwise `0`.
 */
int __export_msp(project_world_to_viewport)(
    void *context,
    scalar_t worldX,
    scalar_t worldY,
    scalar_t worldZ,
    scalar_t viewportW,
    scalar_t viewportH,
    scalar_t *outXY,
    int outCount) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx) {
    return 0;
  }
  return projectWorldToViewportWithCamera(
      ctx->cameraBuffer.data(),
      worldX,
      worldY,
      worldZ,
      viewportW,
      viewportH,
      outXY,
      outCount);
}

/**
 * @brief Projects a world-space position with an explicit camera buffer.
 * @param context Target command context. Required for ABI symmetry.
 * @param camera Camera buffer in generated layout format.
 * @param cameraCount Number of scalar entries available in @p camera.
 * @param worldX World-space X coordinate.
 * @param worldY World-space Y coordinate.
 * @param worldZ World-space Z coordinate.
 * @param viewportW Viewport width in pixels.
 * @param viewportH Viewport height in pixels.
 * @param outXY Receives the projected pixel coordinates.
 * @param outCount Capacity of @p outXY in scalar entries.
 * @return `1` on success, otherwise `0`.
 */
int __export_msp(project_world_to_viewport_with_camera)(
    void *context,
    const scalar_t *camera,
    int cameraCount,
    scalar_t worldX,
    scalar_t worldY,
    scalar_t worldZ,
    scalar_t viewportW,
    scalar_t viewportH,
    scalar_t *outXY,
    int outCount) {
  if (!context || !camera || cameraCount < CAMERA_BUFFER_SIZE) {
    return 0;
  }
  return projectWorldToViewportWithCamera(
      camera,
      worldX,
      worldY,
      worldZ,
      viewportW,
      viewportH,
      outXY,
      outCount);
}

// ---------------------------------------------------------------------------------

/**
 * @brief Runs the full compute pipeline and emits sprite and polyline vertices.
 * @param context Target command context.
 * @param viewMatrix Receives the current view matrix.
 * @param viewProjection Receives the current view-projection matrix.
 * @param output Receives sprite vertices.
 * @param outTexIndices Receives one texture-page index per sprite entry.
 * @param polylineOutput Receives polyline vertices when polylines exist.
 * @param drawCommands Receives aggregate draw counters when provided.
 * @param viewportW Viewport width in pixels used for the computed snapshot.
 * @param viewportH Viewport height in pixels used for the computed snapshot.
 * @param nowMs Current timestamp in milliseconds.
 * @return Number of active sprite entries written, or `0` when nothing is visible.
 */
int __export_msp(compute_vertices)(
    void *context,
    scalar_t *viewMatrix,
    scalar_t *viewProjection,
    float *output,
    int *outTexIndices,
    float *polylineOutput,
    int *drawCommands,
    scalar_t viewportW,
    scalar_t viewportH,
    scalar_t nowMs) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx || !output || !outTexIndices || !viewMatrix || !viewProjection) {
    return 0;
  }
  const int spriteCount = ctx->workspace.spriteCount;
  const int elementCount = ctx->workspace.elementCount;
  const int polylineCount = ctx->workspace.polylineCount;
  const int polylineNodeCount = ctx->workspace.polylineNodeCount;
  const bool hasSprites = spriteCount > 0 && elementCount > 0;
  const bool hasPolylines = polylineCount > 0 && polylineNodeCount > 0;
  if (!hasSprites && !hasPolylines) {
    const bool cameraDirty =
        ctx->cameraBuffer[CAMERA_PROJECTION_DIRTY_OFFSET] !=
        static_cast<scalar_t>(0.0f);
    if (cameraDirty) {
      msp_wasm::computeProjection(
          ctx->cameraBuffer.data(), viewMatrix, viewProjection);
      ctx->cameraBuffer[CAMERA_PROJECTION_DIRTY_OFFSET] =
          static_cast<scalar_t>(0.0f);
    }
    if (drawCommands) {
      drawCommands[DRAW_COMMAND_COMMAND_COUNT_OFFSET] = 0;
      drawCommands[DRAW_COMMAND_POLYLINE_VERTEX_COUNT_OFFSET] = 0;
    }
    if (ctx->computeStatsBuffer &&
        ctx->computeStatsBufferCount >= COMPUTE_STATS_FIELDS) {
      for (int index = 0; index < COMPUTE_STATS_FIELDS; ++index) {
        ctx->computeStatsBuffer[index] = static_cast<scalar_t>(0.0f);
      }
      ctx->computeStatsBuffer[COMPUTE_STATS_CAMERA_DIRTY_OFFSET] =
          cameraDirty ? static_cast<scalar_t>(1.0f)
                      : static_cast<scalar_t>(0.0f);
    }
    storeSnapshotMetadata(ctx, viewportW, viewportH, nowMs);
    return 0;
  }
  ctx->workspace.prepare(
      spriteCount,
      elementCount,
      polylineCount,
      polylineNodeCount,
      ctx->debugEntryEnabled);
  const int activeCount = computeVerticesSoA(
      ctx,
      &ctx->workspace,
      ctx->workspace.spriteInputBuffer.data(),
      spriteCount,
      ctx->workspace.spriteCapacity,
      ctx->workspace.elementInputBuffer.data(),
      elementCount,
      ctx->workspace.elementCapacity,
      ctx->workspace.polylineInputBuffer.data(),
      polylineCount,
      ctx->workspace.polylineCapacity,
      ctx->workspace.polylineNodeInputBuffer.data(),
      polylineNodeCount,
      ctx->workspace.polylineNodeCapacity,
      viewMatrix,
      viewProjection,
      output,
      outTexIndices,
      polylineOutput,
      drawCommands,
      ctx->cameraBuffer.data(),
      nowMs,
      ctx->textures,
      ctx->computeStatsBuffer,
      ctx->computeStatsBufferCount,
      ctx->debugEntryEnabled,
      ctx->debugElementAnimEnabled,
      true);
  storeSnapshotMetadata(ctx, viewportW, viewportH, nowMs);
  return activeCount;
}

// ---------------------------------------------------------------------------------

static inline int pickAtWithWorkspace(
    CommandContext *ctx,
    scalar_t screenX,
    scalar_t screenY,
    scalar_t viewportW,
    scalar_t viewportH,
    scalar_t *viewProjection,
    float *output,
    int *outTexIndices,
    scalar_t *outResult,
    int outCount) {
  // Reuses the most recent workspace caches so picking follows the same
  // geometry ordering and visibility rules as rendering.
  if (!ctx || !viewProjection || !output || !outResult || outCount < 4) {
    return 0;
  }

  outResult[0] = static_cast<scalar_t>(0.0f);
  outResult[1] = static_cast<scalar_t>(-1.0f);
  outResult[2] = static_cast<scalar_t>(-1.0f);
  if (outCount > 3) {
    outResult[3] = static_cast<scalar_t>(0.0f);
  }

  if (!isFiniteScalar(screenX) || !isFiniteScalar(screenY) ||
      !isFiniteScalar(viewportW) || !isFiniteScalar(viewportH) ||
      viewportW <= static_cast<scalar_t>(0.0f) ||
      viewportH <= static_cast<scalar_t>(0.0f)) {
    return 0;
  }

  const scalar_t ndcX =
      (screenX / viewportW) * static_cast<scalar_t>(2.0f) -
      static_cast<scalar_t>(1.0f);
  const scalar_t ndcY =
      -((screenY / viewportH) * static_cast<scalar_t>(2.0f) -
        static_cast<scalar_t>(1.0f));
  if (!isFiniteScalar(ndcX) || !isFiniteScalar(ndcY)) {
    return 0;
  }

  const int spriteCount = ctx->workspace.spriteCount;
  const int elementCount = ctx->workspace.elementCount;
  const int polylineCount = ctx->workspace.polylineCount;
  const int polylineNodeCount = ctx->workspace.polylineNodeCount;
  const bool hasSprites = spriteCount > 0 && elementCount > 0;
  const bool hasPolylines = polylineCount > 0 && polylineNodeCount > 0;
  if (!hasSprites && !hasPolylines) {
    return 1;
  }

  scalar_t worldXY[2] = {static_cast<scalar_t>(0.0f),
                         static_cast<scalar_t>(0.0f)};
  const bool worldOk = screenToWorldOnPlane(
      ctx->cameraBuffer.data(),
      screenX,
      screenY,
      viewportW,
      viewportH,
      static_cast<scalar_t>(0.0f),
      worldXY);
  const scalar_t worldX = worldXY[0];
  const scalar_t worldY = worldXY[1];

  const msp_wasm::ElementInputView element =
      msp_wasm::makeElementInputView(
          ctx->workspace.elementInputBuffer.data(),
          ctx->workspace.elementCapacity);
  const msp_wasm::PolylineInputView polyline =
      hasPolylines
          ? msp_wasm::makePolylineInputView(
              ctx->workspace.polylineInputBuffer.data(),
              ctx->workspace.polylineCapacity)
          : msp_wasm::PolylineInputView{};
  const msp_wasm::PolylineNodeInputView polylineNodes =
      hasPolylines
          ? msp_wasm::makePolylineNodeInputView(
              ctx->workspace.polylineNodeInputBuffer.data(),
              ctx->workspace.polylineNodeCapacity)
          : msp_wasm::PolylineNodeInputView{};

  PickCandidate bestCandidate{};
  bool hasBest = false;

  // Sprite picking reuses the generated output quads so it matches the exact
  // billboarded geometry visible on screen.
  if (hasSprites) {
    const size_t entryCount = ctx->workspace.entries.size();
    for (size_t entryIndex = 0; entryIndex < entryCount; ++entryIndex) {
      if (entryIndex >= ctx->workspace.outputEntryIndices.size()) {
        break;
      }
      const int outputIndex = ctx->workspace.outputEntryIndices[entryIndex];
      const int outputCount =
          entryIndex < ctx->workspace.outputEntryCounts.size()
              ? ctx->workspace.outputEntryCounts[entryIndex]
              : 0;
      if (outputIndex < 0 || outputCount <= 0) {
        continue;
      }
      bool hit = false;
      for (int localIndex = 0; localIndex < outputCount; ++localIndex) {
        const int resolvedOutputIndex = outputIndex + localIndex;
        const float *quad =
            output +
            resolvedOutputIndex * static_cast<size_t>(WASM_OUTPUT_STRIDE);
        const scalar_t v0x = static_cast<scalar_t>(quad[0]);
        const scalar_t v0y = static_cast<scalar_t>(quad[1]);
        const scalar_t v0z = static_cast<scalar_t>(quad[2]);
        const scalar_t uv0x = static_cast<scalar_t>(quad[3]);
        const scalar_t uv0y = static_cast<scalar_t>(quad[4]);
        const scalar_t v1x = static_cast<scalar_t>(quad[6]);
        const scalar_t v1y = static_cast<scalar_t>(quad[7]);
        const scalar_t v1z = static_cast<scalar_t>(quad[8]);
        const scalar_t uv1x = static_cast<scalar_t>(quad[9]);
        const scalar_t uv1y = static_cast<scalar_t>(quad[10]);
        const scalar_t v2x = static_cast<scalar_t>(quad[12]);
        const scalar_t v2y = static_cast<scalar_t>(quad[13]);
        const scalar_t v2z = static_cast<scalar_t>(quad[14]);
        const scalar_t uv2x = static_cast<scalar_t>(quad[15]);
        const scalar_t uv2y = static_cast<scalar_t>(quad[16]);
        const scalar_t v3x = static_cast<scalar_t>(quad[18]);
        const scalar_t v3y = static_cast<scalar_t>(quad[19]);
        const scalar_t v3z = static_cast<scalar_t>(quad[20]);
        const scalar_t uv3x = static_cast<scalar_t>(quad[21]);
        const scalar_t uv3y = static_cast<scalar_t>(quad[22]);

        scalar_t clip0x = static_cast<scalar_t>(0.0f);
        scalar_t clip0y = static_cast<scalar_t>(0.0f);
        scalar_t clip0w = static_cast<scalar_t>(0.0f);
        scalar_t clip1x = static_cast<scalar_t>(0.0f);
        scalar_t clip1y = static_cast<scalar_t>(0.0f);
        scalar_t clip1w = static_cast<scalar_t>(0.0f);
        scalar_t clip2x = static_cast<scalar_t>(0.0f);
        scalar_t clip2y = static_cast<scalar_t>(0.0f);
        scalar_t clip2w = static_cast<scalar_t>(0.0f);
        scalar_t clip3x = static_cast<scalar_t>(0.0f);
        scalar_t clip3y = static_cast<scalar_t>(0.0f);
        scalar_t clip3w = static_cast<scalar_t>(0.0f);
        scalar_t p0x = static_cast<scalar_t>(0.0f);
        scalar_t p0y = static_cast<scalar_t>(0.0f);
        scalar_t p1x = static_cast<scalar_t>(0.0f);
        scalar_t p1y = static_cast<scalar_t>(0.0f);
        scalar_t p2x = static_cast<scalar_t>(0.0f);
        scalar_t p2y = static_cast<scalar_t>(0.0f);
        scalar_t p3x = static_cast<scalar_t>(0.0f);
        scalar_t p3y = static_cast<scalar_t>(0.0f);
        if (!projectToClip(viewProjection, v0x, v0y, v0z, clip0x, clip0y, clip0w) ||
            !projectToClip(viewProjection, v1x, v1y, v1z, clip1x, clip1y, clip1w) ||
            !projectToClip(viewProjection, v2x, v2y, v2z, clip2x, clip2y, clip2w) ||
            !projectToClip(viewProjection, v3x, v3y, v3z, clip3x, clip3y, clip3w) ||
            !projectToNdc(viewProjection, v0x, v0y, v0z, p0x, p0y) ||
            !projectToNdc(viewProjection, v1x, v1y, v1z, p1x, p1y) ||
            !projectToNdc(viewProjection, v2x, v2y, v2z, p2x, p2y) ||
            !projectToNdc(viewProjection, v3x, v3y, v3z, p3x, p3y)) {
          continue;
        }
        if (!pointInQuad(ndcX, ndcY, p0x, p0y, p1x, p1y, p2x, p2y, p3x, p3y)) {
          continue;
        }
        const int pageId =
            outTexIndices ? outTexIndices[resolvedOutputIndex] : -1;
        scalar_t sampledU = static_cast<scalar_t>(0.0f);
        scalar_t sampledV = static_cast<scalar_t>(0.0f);
        scalar_t bary0 = static_cast<scalar_t>(0.0f);
        scalar_t bary1 = static_cast<scalar_t>(0.0f);
        scalar_t bary2 = static_cast<scalar_t>(0.0f);
        bool resolvedUv = false;
        if (resolveTriangleBarycentric(
                ndcX, ndcY, p0x, p0y, p1x, p1y, p2x, p2y, bary0, bary1, bary2) &&
            interpolatePerspectiveCorrectUv(
                bary0,
                bary1,
                bary2,
                uv0x,
                uv0y,
                clip0w,
                uv1x,
                uv1y,
                clip1w,
                uv2x,
                uv2y,
                clip2w,
                sampledU,
                sampledV)) {
          resolvedUv = true;
        } else if (
            resolveTriangleBarycentric(
                ndcX,
                ndcY,
                p2x,
                p2y,
                p1x,
                p1y,
                p3x,
                p3y,
                bary0,
                bary1,
                bary2) &&
            interpolatePerspectiveCorrectUv(
                bary0,
                bary1,
                bary2,
                uv2x,
                uv2y,
                clip2w,
                uv1x,
                uv1y,
                clip1w,
                uv3x,
                uv3y,
                clip3w,
                sampledU,
                sampledV)) {
          resolvedUv = true;
        }
        if (!resolvedUv || samplePickMask(ctx, pageId, sampledU, sampledV)) {
          hit = true;
          break;
        }
      }
      if (!hit || entryIndex >= ctx->workspace.entries.size()) {
        continue;
      }
      const auto &entry = ctx->workspace.entries[entryIndex];
      const int elementIndex = entry.index;
      if (elementIndex < 0 || elementIndex >= elementCount) {
        continue;
      }
      const int ownerSlot =
          static_cast<int>(element.ownerSlotValues[elementIndex]);
      if (ownerSlot < 0 || ownerSlot >= spriteCount) {
        continue;
      }
      PickCandidate candidate{1, entryIndex, ownerSlot, elementIndex};
      if (!hasBest ||
          pickEntryLess(ctx->workspace, bestCandidate, candidate)) {
        bestCandidate = candidate;
        hasBest = true;
      }
    }
  }

  // Polyline picking is performed analytically in world space against the
  // current node thickness, which avoids rebuilding per-segment hit meshes.
  if (hasPolylines && worldOk) {
    const size_t polyEntryCount = ctx->workspace.polylineEntries.size();
    for (size_t entryIndex = 0; entryIndex < polyEntryCount; ++entryIndex) {
      const auto &entry = ctx->workspace.polylineEntries[entryIndex];
      const int polylineIndex = entry.polylineIndex;
      if (polylineIndex < 0 || polylineIndex >= polylineCount) {
        continue;
      }
      const int nodeOffset =
          static_cast<int>(polyline.nodeOffsetValues[polylineIndex]);
      const int nodeCount =
          static_cast<int>(polyline.nodeCountValues[polylineIndex]);
      if (nodeOffset < 0 || nodeCount < 2) {
        continue;
      }
      if (entry.segmentIndex < 0 || entry.segmentIndex >= nodeCount - 1) {
        continue;
      }
      const int nodeIndex = nodeOffset + entry.segmentIndex;
      const int nextIndex = nodeIndex + 1;
      if (nodeIndex < 0 || nextIndex >= nodeOffset + nodeCount) {
        continue;
      }
      if (nodeIndex >= polylineNodeCount || nextIndex >= polylineNodeCount) {
        continue;
      }
      const scalar_t x0 = polylineNodes.xValues[nodeIndex];
      const scalar_t y0 = polylineNodes.yValues[nodeIndex];
      const scalar_t x1 = polylineNodes.xValues[nextIndex];
      const scalar_t y1 = polylineNodes.yValues[nextIndex];
      const scalar_t nodeScale0 =
          static_cast<size_t>(nodeIndex) < ctx->workspace.polylineNodeScaleFactors.size()
              ? ctx->workspace.polylineNodeScaleFactors[static_cast<size_t>(nodeIndex)]
              : static_cast<scalar_t>(1.0f);
      const scalar_t nodeScale1 =
          static_cast<size_t>(nextIndex) < ctx->workspace.polylineNodeScaleFactors.size()
              ? ctx->workspace.polylineNodeScaleFactors[static_cast<size_t>(nextIndex)]
              : static_cast<scalar_t>(1.0f);
      const scalar_t thickness0 =
          polylineNodes.thicknessValues[nodeIndex] * nodeScale0;
      const scalar_t thickness1 =
          polylineNodes.thicknessValues[nextIndex] * nodeScale1;
      if (!(thickness0 > static_cast<scalar_t>(0.0f)) ||
          !(thickness1 > static_cast<scalar_t>(0.0f))) {
        continue;
      }
      const scalar_t dx = x1 - x0;
      const scalar_t dy = y1 - y0;
      const scalar_t lenSq = dx * dx + dy * dy;
      if (!(lenSq > static_cast<scalar_t>(0.0f))) {
        continue;
      }
      const scalar_t len = std::sqrt(lenSq);
      const scalar_t invLen = static_cast<scalar_t>(1.0f) / len;
      const scalar_t ux = dx * invLen;
      const scalar_t uy = dy * invLen;
      const scalar_t nx = -uy;
      const scalar_t ny = ux;
      const scalar_t half0 = thickness0 * static_cast<scalar_t>(0.5f);
      const scalar_t half1 = thickness1 * static_cast<scalar_t>(0.5f);
      const scalar_t v0x = x0 + nx * half0;
      const scalar_t v0y = y0 + ny * half0;
      const scalar_t v1x = x0 - nx * half0;
      const scalar_t v1y = y0 - ny * half0;
      const scalar_t v2x = x1 + nx * half1;
      const scalar_t v2y = y1 + ny * half1;
      const scalar_t v3x = x1 - nx * half1;
      const scalar_t v3y = y1 - ny * half1;
      bool hit = pointInQuad(
          worldX,
          worldY,
          v0x,
          v0y,
          v1x,
          v1y,
          v2x,
          v2y,
          v3x,
          v3y);
      const int joinCorrectionMode =
          static_cast<int>(polyline.joinCorrectionModeValues[polylineIndex]);
      const int joinCorrectionIntermediatePointCount =
          static_cast<int>(
              polyline.joinCorrectionIntermediatePointCountValues[polylineIndex]);
      const int capCorrectionMode =
          static_cast<int>(polyline.capCorrectionModeValues[polylineIndex]);
      const int capCorrectionPointCount =
          static_cast<int>(polyline.capCorrectionPointCountValues[polylineIndex]);
      if (!hit &&
          joinCorrectionMode == POLYLINE_CORRECTION_MODE_FAN &&
          entry.segmentIndex > 0 &&
          entry.segmentIndex < nodeCount - 1) {
        const int prevIndex = nodeIndex - 1;
        const int nextNodeIndex = nodeIndex + 1;
        const scalar_t px0 = polylineNodes.xValues[prevIndex];
        const scalar_t py0 = polylineNodes.yValues[prevIndex];
        const scalar_t px1 = polylineNodes.xValues[nextNodeIndex];
        const scalar_t py1 = polylineNodes.yValues[nextNodeIndex];
        const scalar_t joinDx0 = x0 - px0;
        const scalar_t joinDy0 = y0 - py0;
        const scalar_t joinDx1 = px1 - x0;
        const scalar_t joinDy1 = py1 - y0;
        const scalar_t joinLen0Sq = joinDx0 * joinDx0 + joinDy0 * joinDy0;
        const scalar_t joinLen1Sq = joinDx1 * joinDx1 + joinDy1 * joinDy1;
        if (joinLen0Sq > static_cast<scalar_t>(0.0f) &&
            joinLen1Sq > static_cast<scalar_t>(0.0f)) {
          const scalar_t joinLen0 = std::sqrt(joinLen0Sq);
          const scalar_t joinLen1 = std::sqrt(joinLen1Sq);
          const scalar_t ux0 = joinDx0 / joinLen0;
          const scalar_t uy0 = joinDy0 / joinLen0;
          const scalar_t ux1 = joinDx1 / joinLen1;
          const scalar_t uy1 = joinDy1 / joinLen1;
          const scalar_t cross = ux0 * uy1 - uy0 * ux1;
          if (cross != static_cast<scalar_t>(0.0f)) {
            scalar_t dir0x = -uy0;
            scalar_t dir0y = ux0;
            scalar_t dir1x = -uy1;
            scalar_t dir1y = ux1;
            if (cross > static_cast<scalar_t>(0.0f)) {
              dir0x = -dir0x;
              dir0y = -dir0y;
              dir1x = -dir1x;
              dir1y = -dir1y;
            }
            hit = pointInJoinFan(
                worldX,
                worldY,
                x0,
                y0,
                half0,
                dir0x,
                dir0y,
                dir1x,
                dir1y,
                joinCorrectionIntermediatePointCount);
          }
        }
      }
      if (!hit &&
          capCorrectionMode == POLYLINE_CORRECTION_MODE_FAN &&
          capCorrectionPointCount > 0) {
        if (entry.segmentIndex == 0) {
          hit = pointInCapFan(
              worldX,
              worldY,
              x0,
              y0,
              half0,
              ux,
              uy,
              nx,
              ny,
              true,
              capCorrectionPointCount);
        }
        if (!hit && entry.segmentIndex == nodeCount - 2) {
          hit = pointInCapFan(
              worldX,
              worldY,
              x1,
              y1,
              half1,
              ux,
              uy,
              nx,
              ny,
              false,
              capCorrectionPointCount);
        }
      }
      if (!hit) {
        continue;
      }
      PickCandidate candidate{2, entryIndex, polylineIndex, entry.segmentIndex};
      if (!hasBest ||
          pickEntryLess(ctx->workspace, bestCandidate, candidate)) {
        bestCandidate = candidate;
        hasBest = true;
      }
    }
  }

  if (hasBest) {
    outResult[0] = static_cast<scalar_t>(bestCandidate.kind);
    outResult[1] = static_cast<scalar_t>(bestCandidate.primaryId);
    outResult[2] = static_cast<scalar_t>(bestCandidate.secondaryId);
  }

  return 1;
}

/**
 * @brief Computes fresh geometry and performs picking against the result.
 * @param context Target command context.
 * @param screenX Screen-space X coordinate in pixels.
 * @param screenY Screen-space Y coordinate in pixels.
 * @param viewportW Viewport width in pixels.
 * @param viewportH Viewport height in pixels.
 * @param nowMs Current timestamp in milliseconds.
 * @param viewMatrix Receives the current view matrix.
 * @param viewProjection Receives the current view-projection matrix.
 * @param output Sprite vertex buffer used for both rendering and picking.
 * @param outTexIndices Texture-page output for sprite entries.
 * @param polylineOutput Polyline vertex buffer used during compute.
 * @param drawCommands Optional draw-count output.
 * @param outResult Receives pick kind and identifiers.
 * @param outCount Capacity of @p outResult in scalar entries.
 * @return `1` on success, otherwise `0`.
 */
int __export_msp(pick_at)(
    void *context,
    scalar_t screenX,
    scalar_t screenY,
    scalar_t viewportW,
    scalar_t viewportH,
    scalar_t nowMs,
    scalar_t *viewMatrix,
    scalar_t *viewProjection,
    float *output,
    int *outTexIndices,
    float *polylineOutput,
    int *drawCommands,
    scalar_t *outResult,
    int outCount) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx || !viewMatrix || !viewProjection || !output || !outTexIndices ||
      !outResult || outCount < 4) {
    return 0;
  }

  const int spriteCount = ctx->workspace.spriteCount;
  const int elementCount = ctx->workspace.elementCount;
  const int polylineCount = ctx->workspace.polylineCount;
  const int polylineNodeCount = ctx->workspace.polylineNodeCount;
  const bool hasSprites = spriteCount > 0 && elementCount > 0;
  const bool hasPolylines = polylineCount > 0 && polylineNodeCount > 0;
  if (!hasSprites && !hasPolylines) {
    const bool cameraDirty =
        ctx->cameraBuffer[CAMERA_PROJECTION_DIRTY_OFFSET] !=
        static_cast<scalar_t>(0.0f);
    if (cameraDirty) {
      msp_wasm::computeProjection(
          ctx->cameraBuffer.data(), viewMatrix, viewProjection);
      ctx->cameraBuffer[CAMERA_PROJECTION_DIRTY_OFFSET] =
          static_cast<scalar_t>(0.0f);
    }
    storeSnapshotMetadata(ctx, viewportW, viewportH, nowMs);
    return 1;
  }

  ctx->workspace.prepare(
      spriteCount,
      elementCount,
      polylineCount,
      polylineNodeCount,
      ctx->debugEntryEnabled);
  computeVerticesSoA(
      ctx,
      &ctx->workspace,
      ctx->workspace.spriteInputBuffer.data(),
      spriteCount,
      ctx->workspace.spriteCapacity,
      ctx->workspace.elementInputBuffer.data(),
      elementCount,
      ctx->workspace.elementCapacity,
      ctx->workspace.polylineInputBuffer.data(),
      polylineCount,
      ctx->workspace.polylineCapacity,
      ctx->workspace.polylineNodeInputBuffer.data(),
      polylineNodeCount,
      ctx->workspace.polylineNodeCapacity,
      viewMatrix,
      viewProjection,
      output,
      outTexIndices,
      polylineOutput,
      drawCommands,
      ctx->cameraBuffer.data(),
      nowMs,
      ctx->textures,
      ctx->computeStatsBuffer,
      ctx->computeStatsBufferCount,
      ctx->debugEntryEnabled,
      ctx->debugElementAnimEnabled,
      false);
  storeSnapshotMetadata(ctx, viewportW, viewportH, nowMs);

  return pickAtWithWorkspace(
      ctx,
      screenX,
      screenY,
      viewportW,
      viewportH,
      viewProjection,
      output,
      outTexIndices,
      outResult,
      outCount);
}

// ---------------------------------------------------------------------------------

/**
 * @brief Performs picking against the most recently computed geometry.
 * @param context Target command context.
 * @param screenX Screen-space X coordinate in pixels.
 * @param screenY Screen-space Y coordinate in pixels.
 * @param viewportW Viewport width in pixels.
 * @param viewportH Viewport height in pixels.
 * @param nowMs Unused; retained for ABI compatibility with `pick_at`.
 * @param viewMatrix Unused; retained for ABI compatibility with `pick_at`.
 * @param viewProjection View-projection matrix corresponding to @p output.
 * @param output Cached sprite vertex buffer.
 * @param outTexIndices Cached texture-page buffer aligned with @p output.
 * @param polylineOutput Unused; retained for ABI compatibility with `pick_at`.
 * @param drawCommands Unused; retained for ABI compatibility with `pick_at`.
 * @param outResult Receives pick kind and identifiers.
 * @param outCount Capacity of @p outResult in scalar entries.
 * @return `1` on success, otherwise `0`.
 */
int __export_msp(pick_at_cached)(
    void *context,
    scalar_t screenX,
    scalar_t screenY,
    scalar_t viewportW,
    scalar_t viewportH,
    scalar_t nowMs,
    scalar_t *viewMatrix,
    scalar_t *viewProjection,
    float *output,
    int *outTexIndices,
    float *polylineOutput,
    int *drawCommands,
    scalar_t *outResult,
    int outCount) {
  (void)nowMs;
  (void)viewMatrix;
  (void)polylineOutput;
  (void)drawCommands;
  auto *ctx = static_cast<CommandContext *>(context);
  return pickAtWithWorkspace(
      ctx,
      screenX,
      screenY,
      viewportW,
      viewportH,
      viewProjection,
      output,
      outTexIndices,
      outResult,
      outCount);
}

// ---------------------------------------------------------------------------------

/**
 * @brief Enables or disables entry-level debug channel collection.
 * @param context Target command context.
 * @param enabled Non-zero to enable debug collection.
 * @return `1` on success, otherwise `0`.
 */
int __export_msp(set_entry_debug_enabled)(void *context, int enabled) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx) {
    return 0;
  }
  ctx->debugEntryEnabled = enabled != 0;
  ctx->workspace.needsCompute = true;
  return 1;
}

/**
 * @brief Enables or disables detailed element-animation timing collection.
 * @param context Target command context.
 * @param enabled Non-zero to enable detail collection.
 * @return `1` on success, otherwise `0`.
 */
int __export_msp(set_element_anim_detail_enabled)(void *context, int enabled) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx) {
    return 0;
  }
  ctx->debugElementAnimEnabled = enabled != 0;
  ctx->workspace.needsCompute = true;
  return 1;
}

/**
 * @brief Copies the most recent entry-debug channels into caller-owned buffers.
 * @param context Target command context.
 * @param outElementIndices Optional element-index output buffer.
 * @param outSolveModes Optional billboard-solve-mode output buffer.
 * @param outScreenFromDeg Optional source screen-angle buffer.
 * @param outScreenToDeg Optional destination screen-angle buffer.
 * @param outScreenAnglesDeg Optional resolved screen-angle buffer.
 * @param outEntryRotateDeg Optional element-rotation buffer.
 * @param outEntryFinalRotateDeg Optional final-rotation buffer.
 * @param outEntryRotationFromDeg Optional rotation-from buffer.
 * @param outEntryRotationToDeg Optional rotation-to buffer.
 * @param outEntryRotationDurationMs Optional rotation-duration buffer.
 * @param outEntryFinalRotationFromDeg Optional final-rotation-from buffer.
 * @param outEntryFinalRotationToDeg Optional final-rotation-to buffer.
 * @param outEntryFinalRotationDurationMs Optional final-rotation-duration buffer.
 * @param maxCount Maximum number of entries to copy.
 * @return Number of copied entries, or `0` when no debug data is available.
 */
int __export_msp(get_entry_debug)(
    void *context,
    int *outElementIndices,
    int *outSolveModes,
    scalar_t *outScreenFromDeg,
    scalar_t *outScreenToDeg,
    scalar_t *outScreenAnglesDeg,
    scalar_t *outEntryRotateDeg,
    scalar_t *outEntryFinalRotateDeg,
    scalar_t *outEntryRotationFromDeg,
    scalar_t *outEntryRotationToDeg,
    scalar_t *outEntryRotationDurationMs,
    scalar_t *outEntryFinalRotationFromDeg,
    scalar_t *outEntryFinalRotationToDeg,
    scalar_t *outEntryFinalRotationDurationMs,
    int maxCount) {
  auto *ctx = static_cast<CommandContext *>(context);
  if (!ctx || maxCount <= 0) {
    return 0;
  }
  auto &indices = ctx->workspace.entryElementIndices;
  auto &solveModes = ctx->workspace.entryBillboardSolveModes;
  auto &screenFroms = ctx->workspace.entryBillboardScreenFromDeg;
  auto &screenTos = ctx->workspace.entryBillboardScreenToDeg;
  auto &screenAngles = ctx->workspace.entryBillboardScreenAngleDeg;
  auto &entryRotateDeg = ctx->workspace.entryRotateDeg;
  auto &entryFinalRotateDeg = ctx->workspace.entryFinalRotateDeg;
  auto &entryRotationFromDeg = ctx->workspace.entryRotationFromDeg;
  auto &entryRotationToDeg = ctx->workspace.entryRotationToDeg;
  auto &entryRotationDurationMs = ctx->workspace.entryRotationDurationMs;
  auto &entryFinalRotationFromDeg = ctx->workspace.entryFinalRotationFromDeg;
  auto &entryFinalRotationToDeg = ctx->workspace.entryFinalRotationToDeg;
  auto &entryFinalRotationDurationMs = ctx->workspace.entryFinalRotationDurationMs;
  const size_t entryCount = indices.size();
  if (entryCount == 0) {
    return 0;
  }
  int count = std::min(static_cast<int>(entryCount), maxCount);
  for (int i = 0; i < count; ++i) {
    if (outElementIndices) {
      outElementIndices[i] = indices[static_cast<size_t>(i)];
    }
    if (outSolveModes) {
      outSolveModes[i] = solveModes.size() > static_cast<size_t>(i)
          ? solveModes[static_cast<size_t>(i)]
          : 0;
    }
    if (outScreenFromDeg) {
      outScreenFromDeg[i] = screenFroms.size() > static_cast<size_t>(i)
          ? screenFroms[static_cast<size_t>(i)]
          : std::numeric_limits<scalar_t>::quiet_NaN();
    }
    if (outScreenToDeg) {
      outScreenToDeg[i] = screenTos.size() > static_cast<size_t>(i)
          ? screenTos[static_cast<size_t>(i)]
          : std::numeric_limits<scalar_t>::quiet_NaN();
    }
    if (outScreenAnglesDeg) {
      outScreenAnglesDeg[i] = screenAngles.size() > static_cast<size_t>(i)
          ? screenAngles[static_cast<size_t>(i)]
          : std::numeric_limits<scalar_t>::quiet_NaN();
    }
    if (outEntryRotateDeg) {
      outEntryRotateDeg[i] = entryRotateDeg.size() > static_cast<size_t>(i)
          ? entryRotateDeg[static_cast<size_t>(i)]
          : std::numeric_limits<scalar_t>::quiet_NaN();
    }
    if (outEntryFinalRotateDeg) {
      outEntryFinalRotateDeg[i] =
          entryFinalRotateDeg.size() > static_cast<size_t>(i)
              ? entryFinalRotateDeg[static_cast<size_t>(i)]
              : std::numeric_limits<scalar_t>::quiet_NaN();
    }
    if (outEntryRotationFromDeg) {
      outEntryRotationFromDeg[i] =
          entryRotationFromDeg.size() > static_cast<size_t>(i)
              ? entryRotationFromDeg[static_cast<size_t>(i)]
              : std::numeric_limits<scalar_t>::quiet_NaN();
    }
    if (outEntryRotationToDeg) {
      outEntryRotationToDeg[i] =
          entryRotationToDeg.size() > static_cast<size_t>(i)
              ? entryRotationToDeg[static_cast<size_t>(i)]
              : std::numeric_limits<scalar_t>::quiet_NaN();
    }
    if (outEntryRotationDurationMs) {
      outEntryRotationDurationMs[i] =
          entryRotationDurationMs.size() > static_cast<size_t>(i)
              ? entryRotationDurationMs[static_cast<size_t>(i)]
              : std::numeric_limits<scalar_t>::quiet_NaN();
    }
    if (outEntryFinalRotationFromDeg) {
      outEntryFinalRotationFromDeg[i] =
          entryFinalRotationFromDeg.size() > static_cast<size_t>(i)
              ? entryFinalRotationFromDeg[static_cast<size_t>(i)]
              : std::numeric_limits<scalar_t>::quiet_NaN();
    }
    if (outEntryFinalRotationToDeg) {
      outEntryFinalRotationToDeg[i] =
          entryFinalRotationToDeg.size() > static_cast<size_t>(i)
              ? entryFinalRotationToDeg[static_cast<size_t>(i)]
              : std::numeric_limits<scalar_t>::quiet_NaN();
    }
    if (outEntryFinalRotationDurationMs) {
      outEntryFinalRotationDurationMs[i] =
          entryFinalRotationDurationMs.size() > static_cast<size_t>(i)
              ? entryFinalRotationDurationMs[static_cast<size_t>(i)]
              : std::numeric_limits<scalar_t>::quiet_NaN();
    }
  }
  return count;
}

} // extern "C"
