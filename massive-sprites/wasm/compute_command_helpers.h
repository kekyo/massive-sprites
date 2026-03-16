// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

#pragma once

#include <algorithm>
#include <cmath>
#include <cstring>
#include <functional>
#include <limits>
#include <new>
#include <vector>

#include "compute_internal.h"
#include "generated/command-layout.generated.hpp"

extern "C" double msp_performance_now();

namespace msp_wasm::detail {

/**
 * @brief Returns the current high-resolution timestamp in milliseconds.
 */
static inline scalar_t readNowMs() {
  return static_cast<scalar_t>(msp_performance_now());
}

/**
 * @brief Metadata for one element stored inside a sprite's logical element list.
 */
struct ElementMeta {
  int slot;
  int originLocationIndex;
};

/**
 * @brief Metadata for one sprite tracked by the command context.
 */
struct SpriteMeta {
  int slot;
  std::vector<ElementMeta> elements;
};

/**
 * @brief Metadata for one polyline tracked by the command context.
 */
struct PolylineMeta {
  int slot;
  int nodeOffset;
  int nodeCount;
};

struct CameraTrackingInterpolationConfig {
  int kind = CAMERA_TRACKING_INTERPOLATION_KEEP;
  scalar_t mode = static_cast<scalar_t>(INTERPOLATION_MODE_FEEDBACK);
  scalar_t duration = static_cast<scalar_t>(0.0f);
  scalar_t easing = static_cast<scalar_t>(INTERPOLATION_EASING_LINEAR);
  scalar_t param0 = static_cast<scalar_t>(0.0f);
  scalar_t param1 = static_cast<scalar_t>(0.0f);
  scalar_t param2 = static_cast<scalar_t>(0.0f);
  scalar_t param3 = static_cast<scalar_t>(0.0f);
};

struct CameraTrackingConfig {
  bool enabled = false;
  int targetMode = CAMERA_TRACKING_TARGET_MODE_BASE;
  std::vector<int> spriteSlots;
  scalar_t distance = std::numeric_limits<scalar_t>::quiet_NaN();
  scalar_t minDistance = std::numeric_limits<scalar_t>::quiet_NaN();
  scalar_t fitPadding = static_cast<scalar_t>(CAMERA_TRACKING_DEFAULT_FIT_PADDING);
  scalar_t fitZoomBias = static_cast<scalar_t>(CAMERA_TRACKING_DEFAULT_ZOOM_BIAS);
  CameraTrackingInterpolationConfig interpolation;
  scalar_t resolvedDistance = static_cast<scalar_t>(0.0f);
};

/**
 * @brief Mutable state shared by command application and compute entrypoints.
 * @remarks The context owns all logical entities, command/result buffers,
 * optional stats channels, and the reusable compute workspace buffers.
 */
struct CommandContext {
  msp_wasm::ComputeWorkspace workspace;
  std::vector<SpriteMeta> sprites;
  std::vector<PolylineMeta> polylines;
  std::vector<msp_wasm::TextureInfo> textures;
  CameraTrackingConfig cameraTracking;
  std::vector<scalar_t> cameraBuffer;
  bool debugEntryEnabled = false;
  bool debugElementAnimEnabled = false;
  scalar_t *commandBuffer = nullptr;
  int commandBufferCount = 0;
  scalar_t *resultBuffer = nullptr;
  int resultBufferCount = 0;
  scalar_t *applyStatsBuffer = nullptr;
  int applyStatsBufferCount = 0;
  scalar_t applyStatsSyncSlotsMs = static_cast<scalar_t>(0.0f);
  scalar_t *computeStatsBuffer = nullptr;
  int computeStatsBufferCount = 0;
  int *pickMaskPageTableBuffer = nullptr;
  int pickMaskPageTableBufferCount = 0;
  int *pickMaskWordBuffer = nullptr;
  int pickMaskWordBufferCount = 0;
  scalar_t lastSnapshotTimestampMs = static_cast<scalar_t>(0.0f);
  scalar_t lastSnapshotViewportWidth = static_cast<scalar_t>(0.0f);
  scalar_t lastSnapshotViewportHeight = static_cast<scalar_t>(0.0f);
  bool lastSnapshotValid = false;

  CommandContext() : cameraBuffer(CAMERA_BUFFER_SIZE, static_cast<scalar_t>(0.0f)) {
    cameraBuffer[CAMERA_FOV_Y_OFFSET] =
        static_cast<scalar_t>(COMMON_DEFAULT_CAMERA_FOV_Y);
    cameraBuffer[CAMERA_NEAR_OFFSET] =
        static_cast<scalar_t>(COMMON_DEFAULT_CAMERA_NEAR);
    cameraBuffer[CAMERA_FAR_OFFSET] =
        static_cast<scalar_t>(COMMON_DEFAULT_CAMERA_FAR);
    cameraBuffer[CAMERA_VIEWPORT_ASPECT_OFFSET] = static_cast<scalar_t>(1.0f);
    cameraBuffer[CAMERA_SPRITE_SCALING_MIN_DISTANCE_OFFSET] =
        static_cast<scalar_t>(0.0f);
    cameraBuffer[CAMERA_SPRITE_SCALING_MAX_DISTANCE_OFFSET] =
        msp_wasm::scalingUnlimitedMaxDistance();
    cameraBuffer[CAMERA_POLYLINE_SCALING_MIN_DISTANCE_OFFSET] =
        static_cast<scalar_t>(0.0f);
    cameraBuffer[CAMERA_POLYLINE_SCALING_MAX_DISTANCE_OFFSET] =
        msp_wasm::scalingUnlimitedMaxDistance();
    cameraBuffer[CAMERA_PROJECTION_DIRTY_OFFSET] = static_cast<scalar_t>(1.0f);
  }
};

/**
 * @brief Describes where one interpolation channel is stored in a target buffer.
 */
struct InterpolationField {
  int valueOffset;
  int fromOffset;
  int toOffset;
  int prevTargetOffset;
  int startOffset;
  int durationOffset;
  int configDurationOffset;
  int modeOffset;
  int easingOffset;
  int param0Offset;
  int param1Offset;
  int param2Offset;
  int param3Offset;
  bool wrapDelta;
  bool keepConfigOnNoop;
};

/**
 * @brief Describes how one command payload maps onto a `ValueCommand`.
 */
struct InterpolationCommandOffsets {
  int hasOffset;
  int valueOffset;
  int hasInterpolationOffset;
  int keepInterpolationOffset;
  int modeOffset;
  int durationOffset;
  int easingOffset;
  int param0Offset;
  int param1Offset;
  int param2Offset;
  int param3Offset;
};

/**
 * @brief Parsed interpolation-aware scalar command.
 */
struct ValueCommand {
  bool has;
  scalar_t value;
  bool hasInterpolation;
  bool keepInterpolation;
  scalar_t mode;
  scalar_t duration;
  scalar_t easing;
  scalar_t param0;
  scalar_t param1;
  scalar_t param2;
  scalar_t param3;
};

/**
 * @brief Parsed optional scalar command.
 */
struct OptionalCommand {
  bool has;
  scalar_t value;
};

/**
 * @brief Parsed rotation command.
 */
struct RotationCommand {
  ValueCommand value;
};

/**
 * @brief Parsed auto-direction command.
 */
struct AutoDirectionCommand {
  bool spaceHas;
  scalar_t space;
  bool modeHas;
  scalar_t mode;
  bool shiftAngleRotationHas;
  scalar_t shiftAngleRotation;
  bool minDistanceHas;
  scalar_t minDistance;
  bool flipXHas;
  scalar_t flipX;
  bool flipYHas;
  scalar_t flipY;
  bool interpolationHas;
  bool interpolationClear;
  scalar_t interpolationMode;
  scalar_t interpolationDuration;
  scalar_t interpolationEasing;
  scalar_t interpolationParam0;
  scalar_t interpolationParam1;
  scalar_t interpolationParam2;
  scalar_t interpolationParam3;
};

/**
 * @brief Parsed element payload used by add/update sprite commands.
 */
struct ElementCommandData {
  bool present;
  int imageMode;
  scalar_t texIndexValue;
  bool originLocationProvided;
  int originLocationIndex;
  bool originLocationUseResolvedAnchor;
  OptionalCommand order;
  OptionalCommand layer;
  OptionalCommand renderMode;
  ValueCommand shiftDistance;
  ValueCommand shiftAngle;
  ValueCommand scale;
  ValueCommand opacity;
  int borderMode;
  OptionalCommand borderWidth;
  bool borderColorHas;
  scalar_t borderColorR;
  scalar_t borderColorG;
  scalar_t borderColorB;
  scalar_t borderColorA;
  bool leaderlineHas;
  ValueCommand leaderlineWidth;
  scalar_t leaderlineColor0R;
  scalar_t leaderlineColor0G;
  scalar_t leaderlineColor0B;
  scalar_t leaderlineColor0A;
  scalar_t leaderlineColor1R;
  scalar_t leaderlineColor1G;
  scalar_t leaderlineColor1B;
  scalar_t leaderlineColor1A;
  scalar_t leaderlineRepeatLength;
  ValueCommand anchorX;
  ValueCommand anchorY;
  RotationCommand rotation;
  AutoDirectionCommand autoDirection;
};

/**
 * @brief One element mutation inside a sprite update command.
 */
struct ElementUpdateCommand {
  int index;
  int kind;
  ElementCommandData data;
};

/**
 * @brief Refreshes temporary owner-derived caches for camera adjustment logic.
 */
static constexpr inline void updateOwnerCachesForAdjust(
    const msp_wasm::SpriteInputView &sprite,
    const msp_wasm::ElementInputView &element,
    int spriteCount,
    int elementCount,
    std::vector<scalar_t> &baseXOut,
    std::vector<scalar_t> &baseYOut,
    std::vector<scalar_t> &baseZOut,
    std::vector<scalar_t> &opacityOut) {
  if (elementCount <= 0) {
    return;
  }
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

// These descriptors bridge generated layout offsets to the generic
// interpolation helpers below, allowing the command code to stay mostly
// property-agnostic.

const InterpolationField SPRITE_SX_FIELD = {
    SPRITE_X_OFFSET,
    SPRITE_X_FROM_OFFSET,
    SPRITE_X_TO_OFFSET,
    SPRITE_X_PREV_TARGET_OFFSET,
    SPRITE_X_START_TIMESTAMP_OFFSET,
    SPRITE_X_DURATION_OFFSET,
    SPRITE_X_CONFIG_DURATION_OFFSET,
    SPRITE_X_MODE_OFFSET,
    SPRITE_X_EASING_OFFSET,
    SPRITE_X_EASING_PARAM0_OFFSET,
    SPRITE_X_EASING_PARAM1_OFFSET,
    SPRITE_X_EASING_PARAM2_OFFSET,
    SPRITE_X_EASING_PARAM3_OFFSET,
    false,
    false};

const InterpolationField SPRITE_SY_FIELD = {
    SPRITE_Y_OFFSET,
    SPRITE_Y_FROM_OFFSET,
    SPRITE_Y_TO_OFFSET,
    SPRITE_Y_PREV_TARGET_OFFSET,
    SPRITE_Y_START_TIMESTAMP_OFFSET,
    SPRITE_Y_DURATION_OFFSET,
    SPRITE_Y_CONFIG_DURATION_OFFSET,
    SPRITE_Y_MODE_OFFSET,
    SPRITE_Y_EASING_OFFSET,
    SPRITE_Y_EASING_PARAM0_OFFSET,
    SPRITE_Y_EASING_PARAM1_OFFSET,
    SPRITE_Y_EASING_PARAM2_OFFSET,
    SPRITE_Y_EASING_PARAM3_OFFSET,
    false,
    false};

const InterpolationField SPRITE_OPACITY_FIELD = {
    SPRITE_PARENT_OPACITY_OFFSET,
    SPRITE_PARENT_OPACITY_FROM_OFFSET,
    SPRITE_PARENT_OPACITY_TO_OFFSET,
    SPRITE_PARENT_OPACITY_PREV_TARGET_OFFSET,
    SPRITE_PARENT_OPACITY_START_TIMESTAMP_OFFSET,
    SPRITE_PARENT_OPACITY_DURATION_OFFSET,
    SPRITE_PARENT_OPACITY_CONFIG_DURATION_OFFSET,
    SPRITE_PARENT_OPACITY_MODE_OFFSET,
    SPRITE_PARENT_OPACITY_EASING_OFFSET,
    SPRITE_PARENT_OPACITY_EASING_PARAM0_OFFSET,
    SPRITE_PARENT_OPACITY_EASING_PARAM1_OFFSET,
    SPRITE_PARENT_OPACITY_EASING_PARAM2_OFFSET,
    SPRITE_PARENT_OPACITY_EASING_PARAM3_OFFSET,
    false,
    false};

const InterpolationField SPRITE_RENDER_OPACITY_FIELD = {
    SPRITE_RENDER_OPACITY_OFFSET,
    SPRITE_RENDER_OPACITY_FROM_OFFSET,
    SPRITE_RENDER_OPACITY_TO_OFFSET,
    SPRITE_RENDER_OPACITY_PREV_TARGET_OFFSET,
    SPRITE_RENDER_OPACITY_START_TIMESTAMP_OFFSET,
    SPRITE_RENDER_OPACITY_DURATION_OFFSET,
    SPRITE_RENDER_OPACITY_CONFIG_DURATION_OFFSET,
    SPRITE_RENDER_OPACITY_MODE_OFFSET,
    SPRITE_RENDER_OPACITY_EASING_OFFSET,
    SPRITE_RENDER_OPACITY_EASING_PARAM0_OFFSET,
    SPRITE_RENDER_OPACITY_EASING_PARAM1_OFFSET,
    SPRITE_RENDER_OPACITY_EASING_PARAM2_OFFSET,
    SPRITE_RENDER_OPACITY_EASING_PARAM3_OFFSET,
    false,
    false};

const InterpolationField POLYLINE_OPACITY_FIELD = {
    POLYLINE_OPACITY_OFFSET,
    POLYLINE_OPACITY_FROM_OFFSET,
    POLYLINE_OPACITY_TO_OFFSET,
    POLYLINE_OPACITY_PREV_TARGET_OFFSET,
    POLYLINE_OPACITY_START_TIMESTAMP_OFFSET,
    POLYLINE_OPACITY_DURATION_OFFSET,
    POLYLINE_OPACITY_CONFIG_DURATION_OFFSET,
    POLYLINE_OPACITY_MODE_OFFSET,
    POLYLINE_OPACITY_EASING_OFFSET,
    POLYLINE_OPACITY_EASING_PARAM0_OFFSET,
    POLYLINE_OPACITY_EASING_PARAM1_OFFSET,
    POLYLINE_OPACITY_EASING_PARAM2_OFFSET,
    POLYLINE_OPACITY_EASING_PARAM3_OFFSET,
    false,
    false};

const InterpolationField ELEMENT_OPACITY_FIELD = {
    SPRITE_ELEMENT_OPACITY_OFFSET,
    SPRITE_ELEMENT_OPACITY_FROM_OFFSET,
    SPRITE_ELEMENT_OPACITY_TO_OFFSET,
    SPRITE_ELEMENT_OPACITY_PREV_TARGET_OFFSET,
    SPRITE_ELEMENT_OPACITY_START_TIMESTAMP_OFFSET,
    SPRITE_ELEMENT_OPACITY_DURATION_OFFSET,
    SPRITE_ELEMENT_OPACITY_CONFIG_DURATION_OFFSET,
    SPRITE_ELEMENT_OPACITY_MODE_OFFSET,
    SPRITE_ELEMENT_OPACITY_EASING_OFFSET,
    SPRITE_ELEMENT_OPACITY_EASING_PARAM0_OFFSET,
    SPRITE_ELEMENT_OPACITY_EASING_PARAM1_OFFSET,
    SPRITE_ELEMENT_OPACITY_EASING_PARAM2_OFFSET,
    SPRITE_ELEMENT_OPACITY_EASING_PARAM3_OFFSET,
    false,
    false};

const InterpolationField ELEMENT_RENDER_OPACITY_FIELD = {
    SPRITE_ELEMENT_RENDER_OPACITY_OFFSET,
    SPRITE_ELEMENT_RENDER_OPACITY_FROM_OFFSET,
    SPRITE_ELEMENT_RENDER_OPACITY_TO_OFFSET,
    SPRITE_ELEMENT_RENDER_OPACITY_PREV_TARGET_OFFSET,
    SPRITE_ELEMENT_RENDER_OPACITY_START_TIMESTAMP_OFFSET,
    SPRITE_ELEMENT_RENDER_OPACITY_DURATION_OFFSET,
    SPRITE_ELEMENT_RENDER_OPACITY_CONFIG_DURATION_OFFSET,
    SPRITE_ELEMENT_RENDER_OPACITY_MODE_OFFSET,
    SPRITE_ELEMENT_RENDER_OPACITY_EASING_OFFSET,
    SPRITE_ELEMENT_RENDER_OPACITY_EASING_PARAM0_OFFSET,
    SPRITE_ELEMENT_RENDER_OPACITY_EASING_PARAM1_OFFSET,
    SPRITE_ELEMENT_RENDER_OPACITY_EASING_PARAM2_OFFSET,
    SPRITE_ELEMENT_RENDER_OPACITY_EASING_PARAM3_OFFSET,
    false,
    false};

const InterpolationField ELEMENT_LEADERLINE_WIDTH_FIELD = {
    SPRITE_ELEMENT_LEADERLINE_WIDTH_OFFSET,
    SPRITE_ELEMENT_LEADERLINE_WIDTH_FROM_OFFSET,
    SPRITE_ELEMENT_LEADERLINE_WIDTH_TO_OFFSET,
    SPRITE_ELEMENT_LEADERLINE_WIDTH_PREV_TARGET_OFFSET,
    SPRITE_ELEMENT_LEADERLINE_WIDTH_START_TIMESTAMP_OFFSET,
    SPRITE_ELEMENT_LEADERLINE_WIDTH_DURATION_OFFSET,
    SPRITE_ELEMENT_LEADERLINE_WIDTH_CONFIG_DURATION_OFFSET,
    SPRITE_ELEMENT_LEADERLINE_WIDTH_MODE_OFFSET,
    SPRITE_ELEMENT_LEADERLINE_WIDTH_EASING_OFFSET,
    SPRITE_ELEMENT_LEADERLINE_WIDTH_EASING_PARAM0_OFFSET,
    SPRITE_ELEMENT_LEADERLINE_WIDTH_EASING_PARAM1_OFFSET,
    SPRITE_ELEMENT_LEADERLINE_WIDTH_EASING_PARAM2_OFFSET,
    SPRITE_ELEMENT_LEADERLINE_WIDTH_EASING_PARAM3_OFFSET,
    false,
    false};

const InterpolationField ELEMENT_ROTATION_FIELD = {
    SPRITE_ELEMENT_ROTATE_DEG_OFFSET,
    SPRITE_ELEMENT_ROTATE_FROM_OFFSET,
    SPRITE_ELEMENT_ROTATE_TO_OFFSET,
    SPRITE_ELEMENT_ROTATE_PREV_TARGET_OFFSET,
    SPRITE_ELEMENT_ROTATE_START_TIMESTAMP_OFFSET,
    SPRITE_ELEMENT_ROTATE_DURATION_OFFSET,
    SPRITE_ELEMENT_ROTATE_CONFIG_DURATION_OFFSET,
    SPRITE_ELEMENT_ROTATE_MODE_OFFSET,
    SPRITE_ELEMENT_ROTATE_EASING_OFFSET,
    SPRITE_ELEMENT_ROTATE_EASING_PARAM0_OFFSET,
    SPRITE_ELEMENT_ROTATE_EASING_PARAM1_OFFSET,
    SPRITE_ELEMENT_ROTATE_EASING_PARAM2_OFFSET,
    SPRITE_ELEMENT_ROTATE_EASING_PARAM3_OFFSET,
    true,
    true};

const InterpolationField ELEMENT_SCALE_FIELD = {
    SPRITE_ELEMENT_SCALE_OFFSET,
    SPRITE_ELEMENT_SCALE_FROM_OFFSET,
    SPRITE_ELEMENT_SCALE_TO_OFFSET,
    SPRITE_ELEMENT_SCALE_PREV_TARGET_OFFSET,
    SPRITE_ELEMENT_SCALE_START_TIMESTAMP_OFFSET,
    SPRITE_ELEMENT_SCALE_DURATION_OFFSET,
    SPRITE_ELEMENT_SCALE_CONFIG_DURATION_OFFSET,
    SPRITE_ELEMENT_SCALE_MODE_OFFSET,
    SPRITE_ELEMENT_SCALE_EASING_OFFSET,
    SPRITE_ELEMENT_SCALE_EASING_PARAM0_OFFSET,
    SPRITE_ELEMENT_SCALE_EASING_PARAM1_OFFSET,
    SPRITE_ELEMENT_SCALE_EASING_PARAM2_OFFSET,
    SPRITE_ELEMENT_SCALE_EASING_PARAM3_OFFSET,
    false,
    false};

const InterpolationField ELEMENT_ANCHOR_X_FIELD = {
    SPRITE_ELEMENT_ANCHOR_X_OFFSET,
    SPRITE_ELEMENT_ANCHOR_X_FROM_OFFSET,
    SPRITE_ELEMENT_ANCHOR_X_TO_OFFSET,
    SPRITE_ELEMENT_ANCHOR_X_PREV_TARGET_OFFSET,
    SPRITE_ELEMENT_ANCHOR_X_START_TIMESTAMP_OFFSET,
    SPRITE_ELEMENT_ANCHOR_X_DURATION_OFFSET,
    SPRITE_ELEMENT_ANCHOR_X_CONFIG_DURATION_OFFSET,
    SPRITE_ELEMENT_ANCHOR_X_MODE_OFFSET,
    SPRITE_ELEMENT_ANCHOR_X_EASING_OFFSET,
    SPRITE_ELEMENT_ANCHOR_X_EASING_PARAM0_OFFSET,
    SPRITE_ELEMENT_ANCHOR_X_EASING_PARAM1_OFFSET,
    SPRITE_ELEMENT_ANCHOR_X_EASING_PARAM2_OFFSET,
    SPRITE_ELEMENT_ANCHOR_X_EASING_PARAM3_OFFSET,
    false,
    false};

const InterpolationField ELEMENT_ANCHOR_Y_FIELD = {
    SPRITE_ELEMENT_ANCHOR_Y_OFFSET,
    SPRITE_ELEMENT_ANCHOR_Y_FROM_OFFSET,
    SPRITE_ELEMENT_ANCHOR_Y_TO_OFFSET,
    SPRITE_ELEMENT_ANCHOR_Y_PREV_TARGET_OFFSET,
    SPRITE_ELEMENT_ANCHOR_Y_START_TIMESTAMP_OFFSET,
    SPRITE_ELEMENT_ANCHOR_Y_DURATION_OFFSET,
    SPRITE_ELEMENT_ANCHOR_Y_CONFIG_DURATION_OFFSET,
    SPRITE_ELEMENT_ANCHOR_Y_MODE_OFFSET,
    SPRITE_ELEMENT_ANCHOR_Y_EASING_OFFSET,
    SPRITE_ELEMENT_ANCHOR_Y_EASING_PARAM0_OFFSET,
    SPRITE_ELEMENT_ANCHOR_Y_EASING_PARAM1_OFFSET,
    SPRITE_ELEMENT_ANCHOR_Y_EASING_PARAM2_OFFSET,
    SPRITE_ELEMENT_ANCHOR_Y_EASING_PARAM3_OFFSET,
    false,
    false};

const InterpolationField ELEMENT_SHIFT_DISTANCE_FIELD = {
    SPRITE_ELEMENT_SHIFT_DISTANCE_OFFSET,
    SPRITE_ELEMENT_SHIFT_DISTANCE_FROM_OFFSET,
    SPRITE_ELEMENT_SHIFT_DISTANCE_TO_OFFSET,
    SPRITE_ELEMENT_SHIFT_DISTANCE_PREV_TARGET_OFFSET,
    SPRITE_ELEMENT_SHIFT_DISTANCE_START_TIMESTAMP_OFFSET,
    SPRITE_ELEMENT_SHIFT_DISTANCE_DURATION_OFFSET,
    SPRITE_ELEMENT_SHIFT_DISTANCE_CONFIG_DURATION_OFFSET,
    SPRITE_ELEMENT_SHIFT_DISTANCE_MODE_OFFSET,
    SPRITE_ELEMENT_SHIFT_DISTANCE_EASING_OFFSET,
    SPRITE_ELEMENT_SHIFT_DISTANCE_EASING_PARAM0_OFFSET,
    SPRITE_ELEMENT_SHIFT_DISTANCE_EASING_PARAM1_OFFSET,
    SPRITE_ELEMENT_SHIFT_DISTANCE_EASING_PARAM2_OFFSET,
    SPRITE_ELEMENT_SHIFT_DISTANCE_EASING_PARAM3_OFFSET,
    false,
    false};

const InterpolationField ELEMENT_SHIFT_ANGLE_FIELD = {
    SPRITE_ELEMENT_SHIFT_ANGLE_DEG_OFFSET,
    SPRITE_ELEMENT_SHIFT_ANGLE_DEG_FROM_OFFSET,
    SPRITE_ELEMENT_SHIFT_ANGLE_DEG_TO_OFFSET,
    SPRITE_ELEMENT_SHIFT_ANGLE_DEG_PREV_TARGET_OFFSET,
    SPRITE_ELEMENT_SHIFT_ANGLE_DEG_START_TIMESTAMP_OFFSET,
    SPRITE_ELEMENT_SHIFT_ANGLE_DEG_DURATION_OFFSET,
    SPRITE_ELEMENT_SHIFT_ANGLE_DEG_CONFIG_DURATION_OFFSET,
    SPRITE_ELEMENT_SHIFT_ANGLE_DEG_MODE_OFFSET,
    SPRITE_ELEMENT_SHIFT_ANGLE_DEG_EASING_OFFSET,
    SPRITE_ELEMENT_SHIFT_ANGLE_DEG_EASING_PARAM0_OFFSET,
    SPRITE_ELEMENT_SHIFT_ANGLE_DEG_EASING_PARAM1_OFFSET,
    SPRITE_ELEMENT_SHIFT_ANGLE_DEG_EASING_PARAM2_OFFSET,
    SPRITE_ELEMENT_SHIFT_ANGLE_DEG_EASING_PARAM3_OFFSET,
    true,
    false};

const InterpolationField CAMERA_POSITION_X_FIELD = {
    CAMERA_POSITION_X_OFFSET,
    CAMERA_POSITION_X_FROM_OFFSET,
    CAMERA_POSITION_X_TO_OFFSET,
    CAMERA_POSITION_X_PREV_TARGET_OFFSET,
    CAMERA_POSITION_X_START_TIMESTAMP_OFFSET,
    CAMERA_POSITION_X_DURATION_OFFSET,
    CAMERA_POSITION_X_CONFIG_DURATION_OFFSET,
    CAMERA_POSITION_X_MODE_OFFSET,
    CAMERA_POSITION_X_EASING_OFFSET,
    CAMERA_POSITION_X_EASING_PARAM0_OFFSET,
    CAMERA_POSITION_X_EASING_PARAM1_OFFSET,
    CAMERA_POSITION_X_EASING_PARAM2_OFFSET,
    CAMERA_POSITION_X_EASING_PARAM3_OFFSET,
    false,
    false};

const InterpolationField CAMERA_POSITION_Y_FIELD = {
    CAMERA_POSITION_Y_OFFSET,
    CAMERA_POSITION_Y_FROM_OFFSET,
    CAMERA_POSITION_Y_TO_OFFSET,
    CAMERA_POSITION_Y_PREV_TARGET_OFFSET,
    CAMERA_POSITION_Y_START_TIMESTAMP_OFFSET,
    CAMERA_POSITION_Y_DURATION_OFFSET,
    CAMERA_POSITION_Y_CONFIG_DURATION_OFFSET,
    CAMERA_POSITION_Y_MODE_OFFSET,
    CAMERA_POSITION_Y_EASING_OFFSET,
    CAMERA_POSITION_Y_EASING_PARAM0_OFFSET,
    CAMERA_POSITION_Y_EASING_PARAM1_OFFSET,
    CAMERA_POSITION_Y_EASING_PARAM2_OFFSET,
    CAMERA_POSITION_Y_EASING_PARAM3_OFFSET,
    false,
    false};

const InterpolationField CAMERA_POSITION_Z_FIELD = {
    CAMERA_POSITION_Z_OFFSET,
    CAMERA_POSITION_Z_FROM_OFFSET,
    CAMERA_POSITION_Z_TO_OFFSET,
    CAMERA_POSITION_Z_PREV_TARGET_OFFSET,
    CAMERA_POSITION_Z_START_TIMESTAMP_OFFSET,
    CAMERA_POSITION_Z_DURATION_OFFSET,
    CAMERA_POSITION_Z_CONFIG_DURATION_OFFSET,
    CAMERA_POSITION_Z_MODE_OFFSET,
    CAMERA_POSITION_Z_EASING_OFFSET,
    CAMERA_POSITION_Z_EASING_PARAM0_OFFSET,
    CAMERA_POSITION_Z_EASING_PARAM1_OFFSET,
    CAMERA_POSITION_Z_EASING_PARAM2_OFFSET,
    CAMERA_POSITION_Z_EASING_PARAM3_OFFSET,
    false,
    false};

const InterpolationField CAMERA_ROTATION_YAW_FIELD = {
    CAMERA_ROTATION_YAW_OFFSET,
    CAMERA_ROTATION_YAW_FROM_OFFSET,
    CAMERA_ROTATION_YAW_TO_OFFSET,
    CAMERA_ROTATION_YAW_PREV_TARGET_OFFSET,
    CAMERA_ROTATION_YAW_START_TIMESTAMP_OFFSET,
    CAMERA_ROTATION_YAW_DURATION_OFFSET,
    CAMERA_ROTATION_YAW_CONFIG_DURATION_OFFSET,
    CAMERA_ROTATION_YAW_MODE_OFFSET,
    CAMERA_ROTATION_YAW_EASING_OFFSET,
    CAMERA_ROTATION_YAW_EASING_PARAM0_OFFSET,
    CAMERA_ROTATION_YAW_EASING_PARAM1_OFFSET,
    CAMERA_ROTATION_YAW_EASING_PARAM2_OFFSET,
    CAMERA_ROTATION_YAW_EASING_PARAM3_OFFSET,
    true,
    false};

const InterpolationField CAMERA_ROTATION_PITCH_FIELD = {
    CAMERA_ROTATION_PITCH_OFFSET,
    CAMERA_ROTATION_PITCH_FROM_OFFSET,
    CAMERA_ROTATION_PITCH_TO_OFFSET,
    CAMERA_ROTATION_PITCH_PREV_TARGET_OFFSET,
    CAMERA_ROTATION_PITCH_START_TIMESTAMP_OFFSET,
    CAMERA_ROTATION_PITCH_DURATION_OFFSET,
    CAMERA_ROTATION_PITCH_CONFIG_DURATION_OFFSET,
    CAMERA_ROTATION_PITCH_MODE_OFFSET,
    CAMERA_ROTATION_PITCH_EASING_OFFSET,
    CAMERA_ROTATION_PITCH_EASING_PARAM0_OFFSET,
    CAMERA_ROTATION_PITCH_EASING_PARAM1_OFFSET,
    CAMERA_ROTATION_PITCH_EASING_PARAM2_OFFSET,
    CAMERA_ROTATION_PITCH_EASING_PARAM3_OFFSET,
    true,
    false};

const InterpolationField CAMERA_ROTATION_ROLL_FIELD = {
    CAMERA_ROTATION_ROLL_OFFSET,
    CAMERA_ROTATION_ROLL_FROM_OFFSET,
    CAMERA_ROTATION_ROLL_TO_OFFSET,
    CAMERA_ROTATION_ROLL_PREV_TARGET_OFFSET,
    CAMERA_ROTATION_ROLL_START_TIMESTAMP_OFFSET,
    CAMERA_ROTATION_ROLL_DURATION_OFFSET,
    CAMERA_ROTATION_ROLL_CONFIG_DURATION_OFFSET,
    CAMERA_ROTATION_ROLL_MODE_OFFSET,
    CAMERA_ROTATION_ROLL_EASING_OFFSET,
    CAMERA_ROTATION_ROLL_EASING_PARAM0_OFFSET,
    CAMERA_ROTATION_ROLL_EASING_PARAM1_OFFSET,
    CAMERA_ROTATION_ROLL_EASING_PARAM2_OFFSET,
    CAMERA_ROTATION_ROLL_EASING_PARAM3_OFFSET,
    true,
    false};

const InterpolationField CAMERA_FOV_Y_FIELD = {
    CAMERA_FOV_Y_OFFSET,
    CAMERA_FOV_Y_FROM_OFFSET,
    CAMERA_FOV_Y_TO_OFFSET,
    CAMERA_FOV_Y_PREV_TARGET_OFFSET,
    CAMERA_FOV_Y_START_TIMESTAMP_OFFSET,
    CAMERA_FOV_Y_DURATION_OFFSET,
    CAMERA_FOV_Y_CONFIG_DURATION_OFFSET,
    CAMERA_FOV_Y_MODE_OFFSET,
    CAMERA_FOV_Y_EASING_OFFSET,
    CAMERA_FOV_Y_EASING_PARAM0_OFFSET,
    CAMERA_FOV_Y_EASING_PARAM1_OFFSET,
    CAMERA_FOV_Y_EASING_PARAM2_OFFSET,
    CAMERA_FOV_Y_EASING_PARAM3_OFFSET,
    false,
    false};

// Low-level validation and SoA accessors used by the generic interpolation and
// command-application helpers below.

static constexpr inline bool isFiniteScalar(scalar_t value) {
  return std::isfinite(value);
}

static constexpr inline scalar_t resolveCommandTimestamp(
    const scalar_t *command,
    int offset,
    scalar_t fallback) {
  const scalar_t value = command[offset];
  return isFiniteScalar(value) ? value : fallback;
}

static constexpr inline bool isIntegerScalar(scalar_t value) {
  if (!isFiniteScalar(value)) {
    return false;
  }
  const scalar_t rounded = std::floor(value);
  return rounded == value;
}

static constexpr inline bool toIntScalar(scalar_t value, int &out) {
  if (!isIntegerScalar(value)) {
    return false;
  }
  out = static_cast<int>(value);
  return true;
}

static constexpr inline scalar_t getSpriteValue(
    const msp_wasm::ComputeWorkspace &workspace,
    int offset,
    int slot) {
  return workspace.spriteInputBuffer[static_cast<size_t>(offset) *
                                         static_cast<size_t>(workspace.spriteCapacity) +
                                     static_cast<size_t>(slot)];
}

static constexpr inline void setSpriteValue(
    msp_wasm::ComputeWorkspace &workspace,
    int offset,
    int slot,
    scalar_t value) {
  workspace.spriteInputBuffer[static_cast<size_t>(offset) *
                                  static_cast<size_t>(workspace.spriteCapacity) +
                              static_cast<size_t>(slot)] = value;
}

static constexpr inline scalar_t getElementValue(
    const msp_wasm::ComputeWorkspace &workspace,
    int offset,
    int slot) {
  return workspace.elementInputBuffer[static_cast<size_t>(offset) *
                                          static_cast<size_t>(workspace.elementCapacity) +
                                      static_cast<size_t>(slot)];
}

static constexpr inline void setElementValue(
    msp_wasm::ComputeWorkspace &workspace,
    int offset,
    int slot,
    scalar_t value) {
  workspace.elementInputBuffer[static_cast<size_t>(offset) *
                                   static_cast<size_t>(workspace.elementCapacity) +
                               static_cast<size_t>(slot)] = value;
}

static constexpr inline scalar_t getPolylineValue(
    const msp_wasm::ComputeWorkspace &workspace,
    int offset,
    int slot) {
  return workspace.polylineInputBuffer[static_cast<size_t>(offset) *
                                           static_cast<size_t>(workspace.polylineCapacity) +
                                       static_cast<size_t>(slot)];
}

static constexpr inline void setPolylineValue(
    msp_wasm::ComputeWorkspace &workspace,
    int offset,
    int slot,
    scalar_t value) {
  workspace.polylineInputBuffer[static_cast<size_t>(offset) *
                                    static_cast<size_t>(workspace.polylineCapacity) +
                                static_cast<size_t>(slot)] = value;
}

static constexpr inline scalar_t getCameraValue(
    const scalar_t *camera,
    int offset) {
  return camera[static_cast<size_t>(offset)];
}

static constexpr inline void setCameraValue(
    scalar_t *camera,
    int offset,
    scalar_t value) {
  camera[static_cast<size_t>(offset)] = value;
}

// Accessor traits adapt sprites, elements, polylines, and camera buffers to the
// same interpolation templates without introducing virtual dispatch.

struct WorkspaceSlotInterpolationTarget {
  msp_wasm::ComputeWorkspace &workspace;
  int slot;
};

struct CameraInterpolationTarget {
  scalar_t *camera;
};

struct SpriteInterpolationAccessor {
  using Target = WorkspaceSlotInterpolationTarget;
  static inline scalar_t get(const Target &target, int offset) {
    return getSpriteValue(target.workspace, offset, target.slot);
  }
  static inline void set(const Target &target, int offset, scalar_t value) {
    setSpriteValue(target.workspace, offset, target.slot, value);
  }
};

struct ElementInterpolationAccessor {
  using Target = WorkspaceSlotInterpolationTarget;
  static inline scalar_t get(const Target &target, int offset) {
    return getElementValue(target.workspace, offset, target.slot);
  }
  static inline void set(const Target &target, int offset, scalar_t value) {
    setElementValue(target.workspace, offset, target.slot, value);
  }
};

struct PolylineInterpolationAccessor {
  using Target = WorkspaceSlotInterpolationTarget;
  static inline scalar_t get(const Target &target, int offset) {
    return getPolylineValue(target.workspace, offset, target.slot);
  }
  static inline void set(const Target &target, int offset, scalar_t value) {
    setPolylineValue(target.workspace, offset, target.slot, value);
  }
};

struct CameraInterpolationAccessor {
  using Target = CameraInterpolationTarget;
  static inline scalar_t get(const Target &target, int offset) {
    return getCameraValue(target.camera, offset);
  }
  static inline void set(const Target &target, int offset, scalar_t value) {
    setCameraValue(target.camera, offset, value);
  }
};

template <typename Accessor>
/**
 * @brief Clears runtime interpolation state for one property.
 * @remarks When `clearConfig` is false the persistent interpolation config is
 * preserved so the next retarget can reuse it.
 */
static inline void resetInterpolationState(
    const typename Accessor::Target &target,
    const InterpolationField &field,
    scalar_t value,
    bool clearConfig = true) {
  Accessor::set(target, field.valueOffset, value);
  Accessor::set(target, field.fromOffset, value);
  Accessor::set(target, field.toOffset, value);
  Accessor::set(target, field.prevTargetOffset, value);
  Accessor::set(target, field.startOffset, static_cast<scalar_t>(0.0f));
  Accessor::set(target, field.durationOffset, static_cast<scalar_t>(0.0f));
  if (clearConfig) {
    Accessor::set(target, field.configDurationOffset, static_cast<scalar_t>(0.0f));
    Accessor::set(
        target,
        field.modeOffset,
        static_cast<scalar_t>(INTERPOLATION_MODE_FEEDBACK));
    Accessor::set(
        target,
        field.easingOffset,
        static_cast<scalar_t>(INTERPOLATION_EASING_LINEAR));
    Accessor::set(target, field.param0Offset, static_cast<scalar_t>(0.0f));
    Accessor::set(target, field.param1Offset, static_cast<scalar_t>(0.0f));
    Accessor::set(target, field.param2Offset, static_cast<scalar_t>(0.0f));
    Accessor::set(target, field.param3Offset, static_cast<scalar_t>(0.0f));
  }
}

template <typename Accessor>
/**
 * @brief Resolves the last meaningful target value for one interpolation channel.
 */
static inline scalar_t resolveInterpolationTarget(
    const typename Accessor::Target &target,
    const InterpolationField &field) {
  scalar_t resolved = Accessor::get(target, field.prevTargetOffset);
  if (!isFiniteScalar(resolved)) {
    resolved = Accessor::get(target, field.valueOffset);
  }
  return resolved;
}

template <typename Accessor>
/**
 * @brief Applies one parsed interpolation command to a target property.
 * @remarks Feed-forward mode stores deltas relative to the previous target so
 * repeated command streams can animate from moving baselines without snapping.
 */
static inline void applyInterpolationCommand(
    const typename Accessor::Target &target,
    const InterpolationField &field,
    const ValueCommand &command,
    scalar_t value,
    scalar_t nowMs) {
  if (!command.hasInterpolation) {
    if (command.keepInterpolation) {
      const scalar_t configDuration =
          Accessor::get(target, field.configDurationOffset);
      if (!isFiniteScalar(configDuration) ||
          configDuration <= static_cast<scalar_t>(0.0f)) {
        resetInterpolationState<Accessor>(target, field, value, false);
        return;
      }
      scalar_t current = Accessor::get(target, field.valueOffset);
      scalar_t prevTarget = Accessor::get(target, field.prevTargetOffset);
      if (!isFiniteScalar(prevTarget)) {
        prevTarget = current;
      }
      scalar_t fromValue = current;
      scalar_t toValue = value;
      const int mode =
          static_cast<int>(Accessor::get(target, field.modeOffset));
      if (mode == INTERPOLATION_MODE_FEEDFORWARD) {
        scalar_t delta = value - prevTarget;
        if (field.wrapDelta) {
          delta = msp_wasm::wrapAngleDelta(delta);
        }
        toValue = value + delta;
      }
      if (fromValue == toValue) {
        resetInterpolationState<Accessor>(target, field, fromValue, false);
        return;
      }
      Accessor::set(target, field.valueOffset, fromValue);
      Accessor::set(target, field.fromOffset, fromValue);
      Accessor::set(target, field.toOffset, toValue);
      Accessor::set(target, field.startOffset, nowMs);
      Accessor::set(target, field.durationOffset, configDuration);
      Accessor::set(target, field.prevTargetOffset, value);
      return;
    }
    resetInterpolationState<Accessor>(target, field, value);
    return;
  }
  if (!isFiniteScalar(command.duration) ||
      command.duration <= static_cast<scalar_t>(0.0f)) {
    resetInterpolationState<Accessor>(target, field, value);
    return;
  }
  scalar_t current = Accessor::get(target, field.valueOffset);
  scalar_t prevTarget = Accessor::get(target, field.prevTargetOffset);
  if (!isFiniteScalar(prevTarget)) {
    prevTarget = current;
  }
  scalar_t fromValue = current;
  scalar_t toValue = value;
  const int mode = static_cast<int>(command.mode);
  if (mode == INTERPOLATION_MODE_FEEDFORWARD) {
    scalar_t delta = value - prevTarget;
    if (field.wrapDelta) {
      delta = msp_wasm::wrapAngleDelta(delta);
    }
    toValue = value + delta;
  }
  Accessor::set(target, field.configDurationOffset, command.duration);
  Accessor::set(target, field.modeOffset, command.mode);
  Accessor::set(target, field.easingOffset, command.easing);
  Accessor::set(target, field.param0Offset, command.param0);
  Accessor::set(target, field.param1Offset, command.param1);
  Accessor::set(target, field.param2Offset, command.param2);
  Accessor::set(target, field.param3Offset, command.param3);
  if (fromValue == toValue) {
    resetInterpolationState<Accessor>(target, field, fromValue, false);
    return;
  }
  Accessor::set(target, field.valueOffset, fromValue);
  Accessor::set(target, field.fromOffset, fromValue);
  Accessor::set(target, field.toOffset, toValue);
  Accessor::set(target, field.startOffset, nowMs);
  Accessor::set(target, field.durationOffset, command.duration);
  Accessor::set(target, field.prevTargetOffset, value);
}

static inline void resetSpriteInterpolation(
    msp_wasm::ComputeWorkspace &workspace,
    int slot,
    const InterpolationField &field,
    scalar_t value,
    bool clearConfig = true) {
  resetInterpolationState<SpriteInterpolationAccessor>(
      {workspace, slot},
      field,
      value,
      clearConfig);
}

static inline void resetCameraInterpolation(
    scalar_t *camera,
    const InterpolationField &field,
    scalar_t value,
    bool clearConfig = true) {
  resetInterpolationState<CameraInterpolationAccessor>({camera}, field, value, clearConfig);
}

static inline void resetElementInterpolation(
    msp_wasm::ComputeWorkspace &workspace,
    int slot,
    const InterpolationField &field,
    scalar_t value,
    bool clearConfig = true) {
  resetInterpolationState<ElementInterpolationAccessor>(
      {workspace, slot},
      field,
      value,
      clearConfig);
}

static inline void resetPolylineInterpolation(
    msp_wasm::ComputeWorkspace &workspace,
    int slot,
    const InterpolationField &field,
    scalar_t value,
    bool clearConfig = true) {
  resetInterpolationState<PolylineInterpolationAccessor>(
      {workspace, slot},
      field,
      value,
      clearConfig);
}

static constexpr inline bool normalizeFailure() {
  return false;
}

/**
 * @brief Returns whether a command changes either value or interpolation state.
 */
static inline bool hasInterpolationUpdate(const ValueCommand &command) {
  return command.has || command.hasInterpolation || command.keepInterpolation;
}

template <typename Accessor, typename NormalizeFn>
/**
 * @brief Validates, normalizes, and applies one scalar interpolation update.
 */
static inline bool applyScalarInterpolationUpdate(
    const typename Accessor::Target &target,
    const InterpolationField &field,
    const ValueCommand &command,
    scalar_t nowMs,
    const NormalizeFn &normalize,
    scalar_t &resolvedValue,
    bool &updated) {
  if (!hasInterpolationUpdate(command)) {
    return true;
  }
  if (command.has) {
    if (!normalize(command.value, resolvedValue)) {
      return normalizeFailure();
    }
  } else {
    resolvedValue = resolveInterpolationTarget<Accessor>(target, field);
  }
  applyInterpolationCommand<Accessor>(target, field, command, resolvedValue, nowMs);
  updated = true;
  return true;
}

template <typename Accessor, typename NormalizeFn>
/**
 * @brief Applies one scalar interpolation update while discarding the `updated` flag.
 */
static inline bool applyScalarInterpolationUpdateIgnore(
    const typename Accessor::Target &target,
    const InterpolationField &field,
    const ValueCommand &command,
    scalar_t nowMs,
    const NormalizeFn &normalize,
    scalar_t &resolvedValue) {
  bool updated = false;
  return applyScalarInterpolationUpdate<Accessor>(
      target,
      field,
      command,
      nowMs,
      normalize,
      resolvedValue,
      updated);
}

/**
 * @brief Applies one sprite interpolation command.
 */
static inline void applySpriteInterpolation(
    msp_wasm::ComputeWorkspace &workspace,
    int slot,
    const InterpolationField &field,
    const ValueCommand &command,
    scalar_t value,
    scalar_t nowMs) {
  applyInterpolationCommand<SpriteInterpolationAccessor>(
      {workspace, slot},
      field,
      command,
      value,
      nowMs);
}

static constexpr inline scalar_t resolveVisibilityMultiplier(
    scalar_t distance,
    scalar_t visibilityDistance);

/**
 * @brief Builds a command object that requests an immediate value write.
 */
static inline ValueCommand createImmediateValueCommand() {
  return ValueCommand{
      false,
      static_cast<scalar_t>(0.0f),
      false,
      false,
      static_cast<scalar_t>(0.0f),
      static_cast<scalar_t>(0.0f),
      static_cast<scalar_t>(0.0f),
      static_cast<scalar_t>(0.0f),
      static_cast<scalar_t>(0.0f),
      static_cast<scalar_t>(0.0f),
      static_cast<scalar_t>(0.0f),
  };
}

/**
 * @brief Reads the sprite visibility bit as a normalized opacity multiplier.
 */
static inline scalar_t resolveCurrentVisibilityMultiplier(
    msp_wasm::ComputeWorkspace &workspace,
    int slot) {
  return getSpriteValue(workspace, SPRITE_LOD_VISIBLE_OFFSET, slot) >
              static_cast<scalar_t>(0.0f)
          ? static_cast<scalar_t>(1.0f)
          : static_cast<scalar_t>(0.0f);
}

static inline scalar_t resolveSpriteRenderOpacityTarget(
    msp_wasm::ComputeWorkspace &workspace,
    int slot,
    scalar_t visibilityMultiplier) {
  const WorkspaceSlotInterpolationTarget target{workspace, slot};
  scalar_t baseOpacity =
      resolveInterpolationTarget<SpriteInterpolationAccessor>(
          target,
          SPRITE_OPACITY_FIELD);
  if (!isFiniteScalar(baseOpacity)) {
    baseOpacity = getSpriteValue(workspace, SPRITE_PARENT_OPACITY_OFFSET, slot);
  }
  baseOpacity = std::max(
      static_cast<scalar_t>(0.0f),
      std::min(static_cast<scalar_t>(1.0f), baseOpacity));
  const scalar_t multiplier =
      visibilityMultiplier > static_cast<scalar_t>(0.0f)
          ? static_cast<scalar_t>(1.0f)
          : static_cast<scalar_t>(0.0f);
  return baseOpacity * multiplier;
}

static inline scalar_t resolveElementOpacityTarget(
    msp_wasm::ComputeWorkspace &workspace,
    int slot) {
  const WorkspaceSlotInterpolationTarget target{workspace, slot};
  scalar_t opacity =
      resolveInterpolationTarget<ElementInterpolationAccessor>(
          target,
          ELEMENT_OPACITY_FIELD);
  if (!isFiniteScalar(opacity)) {
    opacity = getElementValue(workspace, SPRITE_ELEMENT_OPACITY_OFFSET, slot);
  }
  return clampOpacityValue(opacity);
}

static inline scalar_t resolveElementRenderOpacityTarget(
    msp_wasm::ComputeWorkspace &workspace,
    int ownerSlot,
    int slot,
    scalar_t visibilityMultiplier) {
  const scalar_t spriteOpacity =
      resolveSpriteRenderOpacityTarget(workspace, ownerSlot, visibilityMultiplier);
  const scalar_t elementOpacity = resolveElementOpacityTarget(workspace, slot);
  return clampOpacityValue(spriteOpacity * elementOpacity);
}

/**
 * @brief Retargets sprite render opacity after base opacity or visibility changes.
 */
static inline void applySpriteRenderOpacityCommand(
    msp_wasm::ComputeWorkspace &workspace,
    int slot,
    const ValueCommand &command,
    scalar_t visibilityMultiplier,
    scalar_t nowMs) {
  applyInterpolationCommand<SpriteInterpolationAccessor>(
      {workspace, slot},
      SPRITE_RENDER_OPACITY_FIELD,
      command,
      resolveSpriteRenderOpacityTarget(workspace, slot, visibilityMultiplier),
      nowMs);
}

/**
 * @brief Retargets element render opacity after base opacity or visibility changes.
 */
static inline void applyElementRenderOpacityCommand(
    msp_wasm::ComputeWorkspace &workspace,
    int ownerSlot,
    int slot,
    const ValueCommand &command,
    scalar_t visibilityMultiplier,
    scalar_t nowMs) {
  applyInterpolationCommand<ElementInterpolationAccessor>(
      {workspace, slot},
      ELEMENT_RENDER_OPACITY_FIELD,
      command,
      resolveElementRenderOpacityTarget(
          workspace,
          ownerSlot,
          slot,
          visibilityMultiplier),
      nowMs);
}

/**
 * @brief Recreates the sprite render-opacity command using the stored config.
 */
static inline ValueCommand createSpriteRenderOpacityRetargetCommand(
    msp_wasm::ComputeWorkspace &workspace,
    int slot) {
  const WorkspaceSlotInterpolationTarget target{workspace, slot};
  const scalar_t duration = SpriteInterpolationAccessor::get(
      target,
      SPRITE_OPACITY_FIELD.configDurationOffset);
  if (!isFiniteScalar(duration) || duration <= static_cast<scalar_t>(0.0f)) {
    return createImmediateValueCommand();
  }
  return ValueCommand{
      false,
      static_cast<scalar_t>(0.0f),
      true,
      false,
      SpriteInterpolationAccessor::get(target, SPRITE_OPACITY_FIELD.modeOffset),
      duration,
      SpriteInterpolationAccessor::get(target, SPRITE_OPACITY_FIELD.easingOffset),
      SpriteInterpolationAccessor::get(target, SPRITE_OPACITY_FIELD.param0Offset),
      SpriteInterpolationAccessor::get(target, SPRITE_OPACITY_FIELD.param1Offset),
      SpriteInterpolationAccessor::get(target, SPRITE_OPACITY_FIELD.param2Offset),
      SpriteInterpolationAccessor::get(target, SPRITE_OPACITY_FIELD.param3Offset),
  };
}

/**
 * @brief Recreates the element render-opacity command using the stored config.
 */
static inline ValueCommand createElementRenderOpacityRetargetCommand(
    msp_wasm::ComputeWorkspace &workspace,
    int slot) {
  const WorkspaceSlotInterpolationTarget target{workspace, slot};
  const scalar_t duration = ElementInterpolationAccessor::get(
      target,
      ELEMENT_OPACITY_FIELD.configDurationOffset);
  if (!isFiniteScalar(duration) || duration <= static_cast<scalar_t>(0.0f)) {
    return createImmediateValueCommand();
  }
  return ValueCommand{
      false,
      static_cast<scalar_t>(0.0f),
      true,
      false,
      ElementInterpolationAccessor::get(target, ELEMENT_OPACITY_FIELD.modeOffset),
      duration,
      ElementInterpolationAccessor::get(target, ELEMENT_OPACITY_FIELD.easingOffset),
      ElementInterpolationAccessor::get(target, ELEMENT_OPACITY_FIELD.param0Offset),
      ElementInterpolationAccessor::get(target, ELEMENT_OPACITY_FIELD.param1Offset),
      ElementInterpolationAccessor::get(target, ELEMENT_OPACITY_FIELD.param2Offset),
      ElementInterpolationAccessor::get(target, ELEMENT_OPACITY_FIELD.param3Offset),
  };
}

/**
 * @brief Recomputes sprite render-opacity targets after visibility or base-opacity changes.
 */
static inline void recomputeSpriteRenderOpacityTargetFromBase(
    msp_wasm::ComputeWorkspace &workspace,
    int slot,
    scalar_t visibilityMultiplier,
    scalar_t nowMs) {
  const ValueCommand keepInterpolationCommand =
      createSpriteRenderOpacityRetargetCommand(workspace, slot);
  applySpriteRenderOpacityCommand(
      workspace,
      slot,
      keepInterpolationCommand,
      visibilityMultiplier,
      nowMs);
}

/**
 * @brief Recomputes element render-opacity targets after inherited opacity changes.
 */
static inline void recomputeElementRenderOpacityTargetFromBase(
    msp_wasm::ComputeWorkspace &workspace,
    int ownerSlot,
    int slot,
    scalar_t visibilityMultiplier,
    scalar_t nowMs) {
  const ValueCommand keepInterpolationCommand =
      createElementRenderOpacityRetargetCommand(workspace, slot);
  applyElementRenderOpacityCommand(
      workspace,
      ownerSlot,
      slot,
      keepInterpolationCommand,
      visibilityMultiplier,
      nowMs);
}

/**
 * @brief Updates pseudo-LOD visibility and derived render-opacity channels.
 * @return `true` when sprite or element render-opacity animations remain active.
 */
static inline bool updateSpritePseudoLodVisibility(
    msp_wasm::ComputeWorkspace &workspace,
    const msp_wasm::SpriteInputView &sprite,
    const msp_wasm::ElementInputView &element,
    int spriteCount,
    int elementCount,
    const scalar_t *camera,
    scalar_t nowMs) {
  if (spriteCount <= 0) {
    return false;
  }

  const bool hasCamera = camera != nullptr;
  const scalar_t cameraX =
      hasCamera ? camera[CAMERA_POSITION_X_OFFSET] : static_cast<scalar_t>(0.0f);
  const scalar_t cameraY =
      hasCamera ? camera[CAMERA_POSITION_Y_OFFSET] : static_cast<scalar_t>(0.0f);
  const scalar_t cameraZ =
      hasCamera ? camera[CAMERA_POSITION_Z_OFFSET] : static_cast<scalar_t>(0.0f);
  bool hasActiveAnimations = false;

  for (int index = 0; index < spriteCount; ++index) {
    const scalar_t visibilityDistance = sprite.visibilityDistanceValues[index];
    scalar_t visibilityMultiplier = static_cast<scalar_t>(1.0f);
    if (hasCamera && visibilityDistance > static_cast<scalar_t>(0.0f)) {
      const scalar_t dx = cameraX - sprite.xValues[index];
      const scalar_t dy = cameraY - sprite.yValues[index];
      const scalar_t dz = cameraZ - sprite.zValues[index];
      const scalar_t distance = std::sqrt(dx * dx + dy * dy + dz * dz);
      visibilityMultiplier =
          resolveVisibilityMultiplier(distance, visibilityDistance);
    }

    const scalar_t currentVisibility =
        sprite.lodVisibleValues[index] > static_cast<scalar_t>(0.0f)
            ? static_cast<scalar_t>(1.0f)
            : static_cast<scalar_t>(0.0f);
    const scalar_t desiredRenderOpacityTarget =
        resolveSpriteRenderOpacityTarget(
            workspace,
            index,
            visibilityMultiplier);
    const scalar_t currentRenderOpacityTarget =
        resolveInterpolationTarget<SpriteInterpolationAccessor>(
            {workspace, index},
            SPRITE_RENDER_OPACITY_FIELD);
    const scalar_t renderTargetDelta = std::abs(
        desiredRenderOpacityTarget - currentRenderOpacityTarget);
    if (currentVisibility != visibilityMultiplier ||
        renderTargetDelta > static_cast<scalar_t>(1.0e-6f)) {
      setSpriteValue(
          workspace,
          SPRITE_LOD_VISIBLE_OFFSET,
          index,
          visibilityMultiplier);
      recomputeSpriteRenderOpacityTargetFromBase(
          workspace,
          index,
          visibilityMultiplier,
          nowMs);
      for (int elementIndex = 0; elementIndex < elementCount; ++elementIndex) {
        const int ownerSlot = static_cast<int>(element.ownerSlotValues[elementIndex]);
        if (ownerSlot != index ||
            !usesElementRenderOpacity(element, elementIndex)) {
          continue;
        }
        recomputeElementRenderOpacityTargetFromBase(
            workspace,
            ownerSlot,
            elementIndex,
            visibilityMultiplier,
            nowMs);
      }
    }
    if (sprite.renderOpacityDurationValues[index] > static_cast<scalar_t>(0.0f)) {
      hasActiveAnimations = true;
    }
  }
  for (int elementIndex = 0; elementIndex < elementCount; ++elementIndex) {
    if (!usesElementRenderOpacity(element, elementIndex)) {
      continue;
    }
    if (element.renderOpacityDurationValues[elementIndex] >
        static_cast<scalar_t>(0.0f)) {
      hasActiveAnimations = true;
      break;
    }
  }

  return hasActiveAnimations;
}

/**
 * @brief Applies one polyline interpolation command.
 */
static inline void applyPolylineInterpolation(
    msp_wasm::ComputeWorkspace &workspace,
    int slot,
    const InterpolationField &field,
    const ValueCommand &command,
    scalar_t value,
    scalar_t nowMs) {
  applyInterpolationCommand<PolylineInterpolationAccessor>(
      {workspace, slot},
      field,
      command,
      value,
      nowMs);
}

/**
 * @brief Applies one camera interpolation command.
 */
static inline void applyCameraInterpolation(
    scalar_t *camera,
    const InterpolationField &field,
    const ValueCommand &command,
    scalar_t value,
    scalar_t nowMs) {
  applyInterpolationCommand<CameraInterpolationAccessor>({camera}, field, command, value, nowMs);
}

/**
 * @brief Applies one element interpolation command.
 */
static inline void applyElementInterpolation(
    msp_wasm::ComputeWorkspace &workspace,
    int slot,
    const InterpolationField &field,
    const ValueCommand &command,
    scalar_t value,
    scalar_t nowMs) {
  applyInterpolationCommand<ElementInterpolationAccessor>(
      {workspace, slot},
      field,
      command,
      value,
      nowMs);
}

template <typename NormalizeFn>
/**
 * @brief Applies placement-time interpolation, or resets to a default value when omitted.
 */
static inline bool applyElementPlacementInterpolation(
    msp_wasm::ComputeWorkspace &workspace,
    int slot,
    const InterpolationField &field,
    const ValueCommand &command,
    scalar_t defaultValue,
    const NormalizeFn &normalize,
    scalar_t nowMs) {
  if (command.has) {
    scalar_t normalized = defaultValue;
    if (!normalize(command.value, normalized)) {
      return normalizeFailure();
    }
    ValueCommand normalizedCommand = command;
    normalizedCommand.value = normalized;
    applyElementInterpolation(workspace, slot, field, normalizedCommand, normalized, nowMs);
  } else {
    resetElementInterpolation(workspace, slot, field, defaultValue);
  }
  return true;
}

// Normalizers below enforce the public command contract before data is written
// into the dense workspace buffers.

static constexpr inline bool normalizeLeaderlineWidthValue(scalar_t value, scalar_t &out);
static constexpr inline bool normalizeBorderWidthValue(scalar_t value, scalar_t &out);
static constexpr inline bool normalizeColorValue(scalar_t value, scalar_t &out);
static constexpr inline bool normalizeRepeatLengthValue(scalar_t value, scalar_t &out);
static constexpr inline bool normalizeScaleValue(scalar_t value, scalar_t &out);
static constexpr inline bool normalizeAnchorValue(scalar_t value, scalar_t &out);
static constexpr inline bool normalizeOpacityValue(scalar_t value, scalar_t &out);
static constexpr inline bool normalizeLayerValue(scalar_t value, int &out);
static constexpr inline bool normalizeOrderValue(scalar_t value, int &out);
static constexpr inline bool normalizeRenderModeValue(scalar_t value, int &out);
static constexpr inline bool normalizeShiftDistanceValue(scalar_t value, scalar_t &out);
static constexpr inline bool normalizeRotationValue(scalar_t value, scalar_t &out);
static constexpr inline bool normalizeAutoRotationDistance(scalar_t value, scalar_t &out);

template <typename NormalizeFn>
/**
 * @brief Validates one optional scalar value command with the supplied normalizer.
 */
static inline bool validateValueCommand(
    const ValueCommand &command,
    const NormalizeFn &normalize) {
  if (!command.has) {
    return true;
  }
  scalar_t normalized = static_cast<scalar_t>(0.0f);
  return normalize(command.value, normalized);
}

/**
 * @brief Validates leaderline width, colors, and repeat parameters for an element.
 */
static inline bool validateElementLeaderlineValues(
    const ElementCommandData &data) {
  if (!data.leaderlineHas) {
    return true;
  }
  if (!validateValueCommand(data.leaderlineWidth, normalizeLeaderlineWidthValue)) {
    return false;
  }
  scalar_t color0R = 0.0f;
  scalar_t color0G = 0.0f;
  scalar_t color0B = 0.0f;
  scalar_t color0A = 1.0f;
  scalar_t color1R = 0.0f;
  scalar_t color1G = 0.0f;
  scalar_t color1B = 0.0f;
  scalar_t color1A = 1.0f;
  scalar_t repeatLength = 0.0f;
  return normalizeColorValue(data.leaderlineColor0R, color0R) &&
      normalizeColorValue(data.leaderlineColor0G, color0G) &&
      normalizeColorValue(data.leaderlineColor0B, color0B) &&
      normalizeColorValue(data.leaderlineColor0A, color0A) &&
      normalizeColorValue(data.leaderlineColor1R, color1R) &&
      normalizeColorValue(data.leaderlineColor1G, color1G) &&
      normalizeColorValue(data.leaderlineColor1B, color1B) &&
      normalizeColorValue(data.leaderlineColor1A, color1A) &&
      normalizeRepeatLengthValue(data.leaderlineRepeatLength, repeatLength);
}

/**
 * @brief Validates border width and color parameters for an element.
 */
static inline bool validateElementBorderValues(
    const ElementCommandData &data) {
  if (data.borderMode == COMMAND_BORDER_MODE_KEEP ||
      data.borderMode == COMMAND_BORDER_MODE_CLEAR) {
    return true;
  }
  if (data.borderMode != COMMAND_BORDER_MODE_SET) {
    return false;
  }
  if (data.borderWidth.has) {
    scalar_t borderWidth = static_cast<scalar_t>(0.0f);
    if (!normalizeBorderWidthValue(data.borderWidth.value, borderWidth)) {
      return false;
    }
  }
  if (!data.borderColorHas) {
    return true;
  }
  scalar_t colorR = 0.0f;
  scalar_t colorG = 0.0f;
  scalar_t colorB = 0.0f;
  scalar_t colorA = 1.0f;
  return normalizeColorValue(data.borderColorR, colorR) &&
      normalizeColorValue(data.borderColorG, colorG) &&
      normalizeColorValue(data.borderColorB, colorB) &&
      normalizeColorValue(data.borderColorA, colorA);
}

/**
 * @brief Validates auto-direction fields for an element command.
 */
static inline bool validateElementAutoDirectionValues(
    const AutoDirectionCommand &autoDirection) {
  if (autoDirection.spaceHas) {
    const int space = static_cast<int>(autoDirection.space);
    if (space < AUTO_DIRECTION_SPACE_WORLD ||
        space > AUTO_DIRECTION_SPACE_PARENT_LOCAL) {
      return false;
    }
  }
  if (autoDirection.modeHas) {
    const int mode = static_cast<int>(autoDirection.mode);
    if (mode < AUTO_DIRECTION_MODE_NONE || mode > AUTO_DIRECTION_MODE_FLIPPING) {
      return false;
    }
  }
  if (autoDirection.minDistanceHas) {
    scalar_t minDistance = static_cast<scalar_t>(0.0f);
    if (!normalizeAutoRotationDistance(autoDirection.minDistance, minDistance)) {
      return false;
    }
  }
  if (autoDirection.interpolationHas) {
    if (!isFiniteScalar(autoDirection.interpolationDuration)) {
      return false;
    }
  }
  return true;
}

/**
 * @brief Validates the full payload for a newly placed element.
 */
static inline bool validateElementPlacementData(
    const ElementCommandData &data,
    int elementCount) {
  if (!data.present) {
    return true;
  }
  if (data.imageMode != COMMAND_IMAGE_MODE_SET) {
    return false;
  }
  int texIndex = -1;
  if (!toIntScalar(data.texIndexValue, texIndex) || texIndex < 0) {
    return false;
  }
  const int originLocationIndex =
      data.originLocationProvided ? data.originLocationIndex : -1;
  if (originLocationIndex < -1 || originLocationIndex >= elementCount) {
    return false;
  }
  if (data.layer.has) {
    int layer = 0;
    if (!normalizeLayerValue(data.layer.value, layer)) {
      return normalizeFailure();
    }
  }
  if (data.order.has) {
    int order = 0;
    if (!normalizeOrderValue(data.order.value, order)) {
      return normalizeFailure();
    }
  }
  if (data.renderMode.has) {
    int renderMode = COMMON_RENDER_MODE_SURFACE;
    if (!normalizeRenderModeValue(data.renderMode.value, renderMode)) {
      return normalizeFailure();
    }
  }
  return validateValueCommand(data.scale, normalizeScaleValue) &&
      validateValueCommand(data.anchorX, normalizeAnchorValue) &&
      validateValueCommand(data.anchorY, normalizeAnchorValue) &&
      validateValueCommand(data.shiftDistance, normalizeShiftDistanceValue) &&
      validateValueCommand(data.shiftAngle, normalizeRotationValue) &&
      validateValueCommand(data.opacity, normalizeOpacityValue) &&
      validateElementBorderValues(data) &&
      validateElementLeaderlineValues(data) &&
      validateValueCommand(data.rotation.value, normalizeRotationValue) &&
      validateElementAutoDirectionValues(data.autoDirection);
}

/**
 * @brief Validates one element update against the current sprite layout.
 */
static inline bool validateElementUpdateData(
    const SpriteMeta &sprite,
    const ElementUpdateCommand &update) {
  if (update.index < 0) {
    return false;
  }
  if (update.kind == COMMAND_UPDATE_ELEMENT_KIND_REMOVE) {
    return update.index < static_cast<int>(sprite.elements.size());
  }
  if (update.kind != COMMAND_UPDATE_ELEMENT_KIND_UPDATE) {
    return false;
  }
  if (update.index > static_cast<int>(sprite.elements.size())) {
    return false;
  }
  if (update.data.imageMode == COMMAND_IMAGE_MODE_SET) {
    int texIndex = -1;
    if (!toIntScalar(update.data.texIndexValue, texIndex) || texIndex < 0) {
      return false;
    }
  }
  if (update.data.layer.has) {
    int layer = 0;
    if (!normalizeLayerValue(update.data.layer.value, layer)) {
      return normalizeFailure();
    }
  }
  if (update.data.order.has) {
    int order = 0;
    if (!normalizeOrderValue(update.data.order.value, order)) {
      return normalizeFailure();
    }
  }
  if (update.data.renderMode.has) {
    int renderMode = COMMON_RENDER_MODE_SURFACE;
    if (!normalizeRenderModeValue(update.data.renderMode.value, renderMode)) {
      return normalizeFailure();
    }
  }
  return validateValueCommand(update.data.shiftDistance, normalizeShiftDistanceValue) &&
      validateValueCommand(update.data.shiftAngle, normalizeRotationValue) &&
      validateValueCommand(update.data.scale, normalizeScaleValue) &&
      validateValueCommand(update.data.opacity, normalizeOpacityValue) &&
      validateElementBorderValues(update.data) &&
      validateElementLeaderlineValues(update.data) &&
      validateValueCommand(update.data.anchorX, normalizeAnchorValue) &&
      validateValueCommand(update.data.anchorY, normalizeAnchorValue) &&
      validateValueCommand(update.data.rotation.value, normalizeRotationValue) &&
      validateElementAutoDirectionValues(update.data.autoDirection);
}

/**
 * @brief Advances one camera interpolation axis.
 * @return `true` while the axis remains active after the update.
 */
static inline bool updateCameraAxis(
    scalar_t *camera,
    const InterpolationField &field,
    scalar_t nowMs,
    bool &updated) {
  const scalar_t duration = getCameraValue(camera, field.durationOffset);
  if (!isFiniteScalar(duration) || duration <= static_cast<scalar_t>(0.0f)) {
    return false;
  }
  updated = true;
  const scalar_t fromValue = getCameraValue(camera, field.fromOffset);
  const scalar_t toValue = getCameraValue(camera, field.toOffset);
  const scalar_t startMs = getCameraValue(camera, field.startOffset);
  const scalar_t easing = getCameraValue(camera, field.easingOffset);
  const scalar_t param0 = getCameraValue(camera, field.param0Offset);
  const scalar_t param1 = getCameraValue(camera, field.param1Offset);
  const scalar_t param2 = getCameraValue(camera, field.param2Offset);
  const scalar_t param3 = getCameraValue(camera, field.param3Offset);
  const scalar_t t = (nowMs - startMs) / duration;
  if (t <= static_cast<scalar_t>(0.0f)) {
    setCameraValue(camera, field.valueOffset, fromValue);
  } else if (t >= static_cast<scalar_t>(1.0f)) {
    setCameraValue(camera, field.valueOffset, toValue);
    setCameraValue(camera, field.durationOffset, static_cast<scalar_t>(0.0f));
    return false;
  } else {
    const scalar_t tEased =
        msp_wasm::applyEasingScalar(t, easing, param0, param1, param2, param3);
    setCameraValue(
        camera,
        field.valueOffset,
        fromValue + (toValue - fromValue) * tEased);
  }
  return getCameraValue(camera, field.durationOffset) > static_cast<scalar_t>(0.0f);
}

/**
 * @brief Advances all camera interpolation channels and marks projection dirtiness.
 */
static inline bool updateCameraAnimations(scalar_t *camera, scalar_t nowMs) {
  if (!camera) {
    return false;
  }
  bool updated = false;
  bool active = false;
  active |= updateCameraAxis(camera, CAMERA_POSITION_X_FIELD, nowMs, updated);
  active |= updateCameraAxis(camera, CAMERA_POSITION_Y_FIELD, nowMs, updated);
  active |= updateCameraAxis(camera, CAMERA_POSITION_Z_FIELD, nowMs, updated);
  active |= updateCameraAxis(camera, CAMERA_ROTATION_YAW_FIELD, nowMs, updated);
  active |= updateCameraAxis(camera, CAMERA_ROTATION_PITCH_FIELD, nowMs, updated);
  active |= updateCameraAxis(camera, CAMERA_ROTATION_ROLL_FIELD, nowMs, updated);
  active |= updateCameraAxis(camera, CAMERA_FOV_Y_FIELD, nowMs, updated);
  if (updated) {
    camera[CAMERA_PROJECTION_DIRTY_OFFSET] = static_cast<scalar_t>(1.0f);
  }
  return active;
}

/**
 * @brief Stores auto-direction configuration without touching runtime state.
 */
static inline void setAutoDirectionConfig(
    msp_wasm::ComputeWorkspace &workspace,
    int slot,
    int space,
    int mode,
    bool shiftAngleRotation,
    scalar_t minDistance,
    bool flipXEnabled,
    bool flipYEnabled,
    scalar_t flipInterpolationDuration,
    scalar_t flipInterpolationMode,
    scalar_t flipInterpolationEasing,
    scalar_t flipInterpolationParam0,
    scalar_t flipInterpolationParam1,
    scalar_t flipInterpolationParam2,
    scalar_t flipInterpolationParam3) {
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_SPACE_OFFSET,
      slot,
      static_cast<scalar_t>(space));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_MODE_OFFSET,
      slot,
      static_cast<scalar_t>(mode));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_SHIFT_ANGLE_ROTATION_OFFSET,
      slot,
      shiftAngleRotation ? static_cast<scalar_t>(1.0f) : static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_MIN_DISTANCE_OFFSET,
      slot,
      minDistance);
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_X_ENABLED_OFFSET,
      slot,
      flipXEnabled ? static_cast<scalar_t>(1.0f) : static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_Y_ENABLED_OFFSET,
      slot,
      flipYEnabled ? static_cast<scalar_t>(1.0f) : static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_CONFIG_DURATION_OFFSET,
      slot,
      flipInterpolationDuration);
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_MODE_OFFSET,
      slot,
      flipInterpolationMode);
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_EASING_OFFSET,
      slot,
      flipInterpolationEasing);
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_PARAM0_OFFSET,
      slot,
      flipInterpolationParam0);
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_PARAM1_OFFSET,
      slot,
      flipInterpolationParam1);
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_PARAM2_OFFSET,
      slot,
      flipInterpolationParam2);
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_PARAM3_OFFSET,
      slot,
      flipInterpolationParam3);
}

/**
 * @brief Resets runtime fields derived from auto-direction and final transforms.
 */
static inline void resetAutoDirectionRuntimeState(
    msp_wasm::ComputeWorkspace &workspace,
    int slot,
    scalar_t baseRotateDeg,
    scalar_t baseShiftAngleDeg) {
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_DEG_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(workspace, SPRITE_ELEMENT_FINAL_ROTATE_DEG_OFFSET, slot, baseRotateDeg);
  setElementValue(workspace, SPRITE_ELEMENT_FINAL_ROTATE_FROM_OFFSET, slot, baseRotateDeg);
  setElementValue(workspace, SPRITE_ELEMENT_FINAL_ROTATE_TO_OFFSET, slot, baseRotateDeg);
  setElementValue(
      workspace,
      SPRITE_ELEMENT_FINAL_ROTATE_START_TIMESTAMP_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_FINAL_ROTATE_DURATION_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_FINAL_ROTATE_PREV_TARGET_OFFSET,
      slot,
      baseRotateDeg);
  setElementValue(
      workspace,
      SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_DEG_OFFSET,
      slot,
      baseShiftAngleDeg);
  setElementValue(
      workspace,
      SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_FROM_OFFSET,
      slot,
      baseShiftAngleDeg);
  setElementValue(
      workspace,
      SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_TO_OFFSET,
      slot,
      baseShiftAngleDeg);
  setElementValue(
      workspace,
      SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_START_TIMESTAMP_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_DURATION_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_PREV_TARGET_OFFSET,
      slot,
      baseShiftAngleDeg);
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_PREV_PIVOT_X_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_PREV_PIVOT_Y_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_DIRECTION_HAS_PREV_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_FLIP_X_OFFSET,
      slot,
      static_cast<scalar_t>(1.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_FLIP_X_FROM_OFFSET,
      slot,
      static_cast<scalar_t>(1.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_FLIP_X_TO_OFFSET,
      slot,
      static_cast<scalar_t>(1.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_FLIP_X_PREV_TARGET_OFFSET,
      slot,
      static_cast<scalar_t>(1.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_FLIP_Y_OFFSET,
      slot,
      static_cast<scalar_t>(1.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_FLIP_Y_FROM_OFFSET,
      slot,
      static_cast<scalar_t>(1.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_FLIP_Y_TO_OFFSET,
      slot,
      static_cast<scalar_t>(1.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_FLIP_Y_PREV_TARGET_OFFSET,
      slot,
      static_cast<scalar_t>(1.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_FLIP_START_TIMESTAMP_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_AUTO_FLIP_DURATION_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
}

/**
 * @brief Marks one element's local pivot data as dirty.
 */
static constexpr inline void markPivotDirty(msp_wasm::ComputeWorkspace &workspace, int slot) {
  if (slot < 0) {
    return;
  }
  const size_t index = static_cast<size_t>(slot);
  if (index >= workspace.pivotDirtyFlags.size()) {
    return;
  }
  workspace.pivotDirtyFlags[index] |= msp_wasm::PIVOT_DIRTY_LOCAL_FLAG;
}

/**
 * @brief Marks one element's resolved pivot hierarchy as dirty.
 */
static constexpr inline void markPivotResolveDirty(msp_wasm::ComputeWorkspace &workspace, int slot) {
  if (slot < 0) {
    return;
  }
  const size_t index = static_cast<size_t>(slot);
  if (index >= workspace.pivotDirtyFlags.size()) {
    return;
  }
  workspace.pivotDirtyFlags[index] |= msp_wasm::PIVOT_DIRTY_RESOLVE_FLAG;
}

// These normalizers define the accepted command-domain ranges for positions,
// opacities, layering, render modes, and related scalar payloads.

static constexpr inline bool normalizeFinitePosition(scalar_t value, scalar_t &out) {
  if (!isFiniteScalar(value)) {
    return false;
  }
  out = value;
  return true;
}

static constexpr inline bool normalizeOpacityValue(scalar_t value, scalar_t &out) {
  if (!isFiniteScalar(value) || value < static_cast<scalar_t>(0.0f) ||
      value > static_cast<scalar_t>(1.0f)) {
    return false;
  }
  out = value;
  return true;
}

static constexpr inline bool normalizeVisibilityDistanceValue(
    scalar_t value,
    scalar_t &out) {
  if (!isFiniteScalar(value) || value <= static_cast<scalar_t>(0.0f)) {
    return false;
  }
  out = value;
  return true;
}

/**
 * @brief Resolves visibility-distance commands, treating omission and zero as disabled.
 */
static inline bool resolveVisibilityDistanceCommand(
    const OptionalCommand &command,
    scalar_t &out) {
  if (!command.has) {
    out = static_cast<scalar_t>(0.0f);
    return true;
  }
  if (command.value == static_cast<scalar_t>(0.0f)) {
    out = static_cast<scalar_t>(0.0f);
    return true;
  }
  return normalizeVisibilityDistanceValue(command.value, out);
}

static constexpr inline scalar_t resolveVisibilityMultiplier(
    scalar_t distance,
    scalar_t visibilityDistance) {
  if (!(visibilityDistance > static_cast<scalar_t>(0.0f))) {
    return static_cast<scalar_t>(1.0f);
  }
  if (!isFiniteScalar(distance)) {
    return static_cast<scalar_t>(0.0f);
  }
  return distance <= visibilityDistance ? static_cast<scalar_t>(1.0f)
                                        : static_cast<scalar_t>(0.0f);
}

static constexpr inline bool normalizeLeaderlineWidthValue(scalar_t value, scalar_t &out) {
  if (!isFiniteScalar(value) || value < static_cast<scalar_t>(0.0f)) {
    return false;
  }
  out = value;
  return true;
}

static constexpr inline bool normalizeBorderWidthValue(scalar_t value, scalar_t &out) {
  if (!isFiniteScalar(value) || value <= static_cast<scalar_t>(0.0f)) {
    return false;
  }
  out = value;
  return true;
}

static constexpr inline bool normalizeColorValue(scalar_t value, scalar_t &out) {
  if (!isFiniteScalar(value)) {
    return false;
  }
  out = msp_wasm::clamp01(value);
  return true;
}

static constexpr inline bool normalizeThicknessValue(scalar_t value, scalar_t &out) {
  if (!isFiniteScalar(value) || value <= static_cast<scalar_t>(0.0f)) {
    return false;
  }
  out = value;
  return true;
}

static constexpr inline bool normalizeRepeatLengthValue(scalar_t value, scalar_t &out) {
  if (!isFiniteScalar(value)) {
    return false;
  }
  out = value > static_cast<scalar_t>(0.0f) ? value : static_cast<scalar_t>(0.0f);
  return true;
}

static constexpr inline bool normalizeScaleValue(scalar_t value, scalar_t &out) {
  if (!isFiniteScalar(value) || value <= static_cast<scalar_t>(0.0f)) {
    return false;
  }
  out = value;
  return true;
}

static constexpr inline bool normalizeAnchorValue(scalar_t value, scalar_t &out) {
  if (!isFiniteScalar(value) || value < static_cast<scalar_t>(-1.0f) ||
      value > static_cast<scalar_t>(1.0f)) {
    return false;
  }
  out = value;
  return true;
}

static constexpr inline bool normalizeLayerValue(scalar_t value, int &out) {
  if (!isFiniteScalar(value)) {
    return false;
  }
  const scalar_t floored = std::floor(value);
  if (floored < static_cast<scalar_t>(0.0f) ||
      floored > static_cast<scalar_t>(31.0f)) {
    return false;
  }
  out = static_cast<int>(floored);
  return true;
}

static constexpr inline bool normalizePolylineCorrectionMode(
    scalar_t value,
    int &out) {
  if (!toIntScalar(value, out)) {
    return false;
  }
  return out == POLYLINE_CORRECTION_MODE_NONE ||
      out == POLYLINE_CORRECTION_MODE_FAN;
}

static constexpr inline bool normalizePolylineJoinIntermediatePointCount(
    scalar_t value,
    int &out) {
  if (!toIntScalar(value, out)) {
    return false;
  }
  return out >= 0;
}

static constexpr inline bool normalizePolylineCapPointCount(
    scalar_t value,
    int &out) {
  if (!toIntScalar(value, out)) {
    return false;
  }
  return out >= 0;
}

static constexpr inline bool normalizeOrderValue(scalar_t value, int &out) {
  if (!isFiniteScalar(value)) {
    return false;
  }
  const scalar_t floored = std::floor(value);
  if (floored < static_cast<scalar_t>(0.0f) ||
      floored > static_cast<scalar_t>(31.0f)) {
    return false;
  }
  out = static_cast<int>(floored);
  return true;
}

static constexpr inline bool normalizeRenderModeValue(scalar_t value, int &out) {
  if (!isFiniteScalar(value)) {
    return false;
  }
  const scalar_t floored = std::floor(value);
  if (floored < static_cast<scalar_t>(COMMON_RENDER_MODE_SURFACE) ||
      floored >
          static_cast<scalar_t>(COMMON_RENDER_MODE_BILLBOARD_PERSPECTIVE)) {
    return false;
  }
  out = static_cast<int>(floored);
  return true;
}

static constexpr inline bool normalizeShiftDistanceValue(scalar_t value, scalar_t &out) {
  if (!isFiniteScalar(value) || value < static_cast<scalar_t>(0.0f)) {
    return false;
  }
  out = value;
  return true;
}

static constexpr inline bool normalizeRotationValue(scalar_t value, scalar_t &out) {
  if (!isFiniteScalar(value)) {
    return false;
  }
  out = value;
  return true;
}

static constexpr inline bool normalizeAutoRotationDistance(scalar_t value, scalar_t &out) {
  if (!isFiniteScalar(value) || value < static_cast<scalar_t>(0.0f)) {
    return false;
  }
  out = value;
  return true;
}

static constexpr inline bool normalizeOriginLocationIndex(scalar_t value, int &out) {
  if (!toIntScalar(value, out)) {
    return false;
  }
  if (out < -1 || out >= WASM_MAX_ELEMENTS_PER_SPRITE) {
    return false;
  }
  return true;
}

static constexpr InterpolationCommandOffsets VALUE_COMMAND_OFFSETS = {
    COMMAND_VALUE_HAS_OFFSET,
    COMMAND_VALUE_VALUE_OFFSET,
    COMMAND_VALUE_HAS_INTERP_OFFSET,
    COMMAND_VALUE_KEEP_INTERP_OFFSET,
    COMMAND_VALUE_MODE_OFFSET,
    COMMAND_VALUE_DURATION_OFFSET,
    COMMAND_VALUE_EASING_OFFSET,
    COMMAND_VALUE_PARAM0_OFFSET,
    COMMAND_VALUE_PARAM1_OFFSET,
    COMMAND_VALUE_PARAM2_OFFSET,
    COMMAND_VALUE_PARAM3_OFFSET,
};

static constexpr InterpolationCommandOffsets ROTATION_COMMAND_OFFSETS = {
    COMMAND_ROTATION_HAS_OFFSET,
    COMMAND_ROTATION_VALUE_OFFSET,
    COMMAND_ROTATION_HAS_INTERP_OFFSET,
    COMMAND_ROTATION_KEEP_INTERP_OFFSET,
    COMMAND_ROTATION_MODE_OFFSET,
    COMMAND_ROTATION_DURATION_OFFSET,
    COMMAND_ROTATION_EASING_OFFSET,
    COMMAND_ROTATION_PARAM0_OFFSET,
    COMMAND_ROTATION_PARAM1_OFFSET,
    COMMAND_ROTATION_PARAM2_OFFSET,
    COMMAND_ROTATION_PARAM3_OFFSET,
};

/**
 * @brief Reads one interpolation-aware scalar command from a raw command buffer.
 */
static constexpr inline ValueCommand readInterpolationCommand(
    const scalar_t *command,
    int baseOffset,
    const InterpolationCommandOffsets &offsets) {
  return ValueCommand{
      command[baseOffset + offsets.hasOffset] != 0.0f,
      command[baseOffset + offsets.valueOffset],
      command[baseOffset + offsets.hasInterpolationOffset] != 0.0f,
      command[baseOffset + offsets.keepInterpolationOffset] != 0.0f,
      command[baseOffset + offsets.modeOffset],
      command[baseOffset + offsets.durationOffset],
      command[baseOffset + offsets.easingOffset],
      command[baseOffset + offsets.param0Offset],
      command[baseOffset + offsets.param1Offset],
      command[baseOffset + offsets.param2Offset],
      command[baseOffset + offsets.param3Offset],
  };
}

/**
 * @brief Reads a standard value command from a raw command buffer.
 */
static constexpr inline ValueCommand readValueCommand(const scalar_t *command, int baseOffset) {
  return readInterpolationCommand(command, baseOffset, VALUE_COMMAND_OFFSETS);
}

/**
 * @brief Reads an optional scalar command from a raw command buffer.
 */
static constexpr inline OptionalCommand readOptionalCommand(const scalar_t *command, int baseOffset) {
  return OptionalCommand{
      command[baseOffset + COMMAND_OPTIONAL_HAS_OFFSET] != 0.0f,
      command[baseOffset + COMMAND_OPTIONAL_VALUE_OFFSET],
  };
}

/**
 * @brief Reads a rotation command from a raw command buffer.
 */
static constexpr inline RotationCommand readRotationCommand(const scalar_t *command, int baseOffset) {
  return RotationCommand{
      readInterpolationCommand(command, baseOffset, ROTATION_COMMAND_OFFSETS),
  };
}

/**
 * @brief Reads an auto-direction command from a raw command buffer.
 */
static constexpr inline AutoDirectionCommand readAutoDirectionCommand(
    const scalar_t *command,
    int baseOffset) {
  return AutoDirectionCommand{
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_SPACE_HAS_OFFSET] != 0.0f,
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_SPACE_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_MODE_HAS_OFFSET] != 0.0f,
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_MODE_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_SHIFT_ANGLE_ROTATION_HAS_OFFSET] !=
          0.0f,
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_SHIFT_ANGLE_ROTATION_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_MIN_DISTANCE_HAS_OFFSET] != 0.0f,
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_MIN_DISTANCE_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_X_HAS_OFFSET] != 0.0f,
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_X_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_Y_HAS_OFFSET] != 0.0f,
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_FLIP_Y_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_HAS_OFFSET] != 0.0f,
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_CLEAR_OFFSET] != 0.0f,
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_MODE_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_DURATION_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_EASING_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_PARAM0_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_PARAM1_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_PARAM2_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_AUTO_DIRECTION_INTERP_PARAM3_OFFSET],
  };
}

/**
 * @brief Reads an element payload from a raw command buffer.
 * @remarks Invalid origin-location indices are converted into an impossible
 * sentinel so later validation can reject them consistently.
 */
static constexpr inline ElementCommandData readElementCommand(const scalar_t *command, int baseOffset) {
  const int kind = static_cast<int>(command[baseOffset + COMMAND_ELEMENT_KIND_OFFSET]);
  const bool originLocationProvided =
      command[baseOffset + COMMAND_ELEMENT_ORIGIN_LOCATION_HAS_OFFSET] != 0.0f;
  const bool originLocationUseResolvedAnchor =
      originLocationProvided &&
      command[baseOffset + COMMAND_ELEMENT_ORIGIN_LOCATION_USE_RESOLVED_ANCHOR_OFFSET] != 0.0f;
  int originLocationIndex = -1;
  if (originLocationProvided) {
    const scalar_t originLocationRaw =
        command[baseOffset + COMMAND_ELEMENT_ORIGIN_LOCATION_INDEX_OFFSET];
    if (!normalizeOriginLocationIndex(originLocationRaw, originLocationIndex)) {
      originLocationIndex = WASM_MAX_ELEMENTS_PER_SPRITE;
    }
  }
  return ElementCommandData{
      kind == COMMAND_ELEMENT_KIND_PRESENT,
      static_cast<int>(command[baseOffset + COMMAND_ELEMENT_IMAGE_MODE_OFFSET]),
      command[baseOffset + COMMAND_ELEMENT_TEX_INDEX_OFFSET],
      originLocationProvided,
      originLocationIndex,
      originLocationUseResolvedAnchor,
      readOptionalCommand(command, baseOffset + COMMAND_ELEMENT_ORDER_HAS_OFFSET),
      readOptionalCommand(command, baseOffset + COMMAND_ELEMENT_LAYER_HAS_OFFSET),
      readOptionalCommand(
          command,
          baseOffset + COMMAND_ELEMENT_RENDER_MODE_HAS_OFFSET),
      readValueCommand(command, baseOffset + COMMAND_ELEMENT_SHIFT_DISTANCE_HAS_OFFSET),
      readValueCommand(command, baseOffset + COMMAND_ELEMENT_SHIFT_ANGLE_HAS_OFFSET),
      readValueCommand(command, baseOffset + COMMAND_ELEMENT_SCALE_HAS_OFFSET),
      readValueCommand(command, baseOffset + COMMAND_ELEMENT_OPACITY_HAS_OFFSET),
      static_cast<int>(command[baseOffset + COMMAND_ELEMENT_BORDER_MODE_OFFSET]),
      readOptionalCommand(command, baseOffset + COMMAND_ELEMENT_BORDER_WIDTH_HAS_OFFSET),
      command[baseOffset + COMMAND_ELEMENT_BORDER_COLOR_HAS_OFFSET] != 0.0f,
      command[baseOffset + COMMAND_ELEMENT_BORDER_COLOR_R_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_BORDER_COLOR_G_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_BORDER_COLOR_B_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_BORDER_COLOR_A_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_LEADERLINE_HAS_OFFSET] != 0.0f,
      readValueCommand(
          command,
          baseOffset + COMMAND_ELEMENT_LEADERLINE_WIDTH_HAS_OFFSET),
      command[baseOffset + COMMAND_ELEMENT_LEADERLINE_COLOR0_R_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_LEADERLINE_COLOR0_G_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_LEADERLINE_COLOR0_B_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_LEADERLINE_COLOR0_A_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_LEADERLINE_COLOR1_R_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_LEADERLINE_COLOR1_G_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_LEADERLINE_COLOR1_B_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_LEADERLINE_COLOR1_A_OFFSET],
      command[baseOffset + COMMAND_ELEMENT_LEADERLINE_REPEAT_LENGTH_OFFSET],
      readValueCommand(command, baseOffset + COMMAND_ELEMENT_ANCHOR_X_HAS_OFFSET),
      readValueCommand(command, baseOffset + COMMAND_ELEMENT_ANCHOR_Y_HAS_OFFSET),
      readRotationCommand(command, baseOffset + COMMAND_ELEMENT_ROTATION_HAS_OFFSET),
      readAutoDirectionCommand(command, baseOffset),
  };
}

/**
 * @brief Initializes a newly allocated element slot with default runtime state.
 */
static constexpr inline void initializeElementDefaults(
    CommandContext &context,
    int slot,
    int ownerSlot) {
  auto &workspace = context.workspace;
  setElementValue(workspace, SPRITE_ELEMENT_OWNER_SLOT_OFFSET, slot, ownerSlot);
  setElementValue(workspace, SPRITE_ELEMENT_ORIGIN_LOCATION_SLOT_OFFSET, slot, static_cast<scalar_t>(-1.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_ORIGIN_LOCATION_USE_RESOLVED_ANCHOR_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(workspace, SPRITE_ELEMENT_WIDTH_OFFSET, slot, static_cast<scalar_t>(0.0f));
  setElementValue(workspace, SPRITE_ELEMENT_HEIGHT_OFFSET, slot, static_cast<scalar_t>(0.0f));
  setElementValue(workspace, SPRITE_ELEMENT_TEX_INDEX_OFFSET, slot, static_cast<scalar_t>(-1.0f));
  setElementValue(workspace, SPRITE_ELEMENT_LAYER_OFFSET, slot, static_cast<scalar_t>(0.0f));
  setElementValue(workspace, SPRITE_ELEMENT_ORDER_OFFSET, slot, static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_RENDER_MODE_OFFSET,
      slot,
      static_cast<scalar_t>(COMMON_RENDER_MODE_SURFACE));
  resetElementInterpolation(workspace, slot, ELEMENT_SCALE_FIELD, static_cast<scalar_t>(1.0f));
  resetElementInterpolation(workspace, slot, ELEMENT_ANCHOR_X_FIELD, static_cast<scalar_t>(0.0f));
  resetElementInterpolation(workspace, slot, ELEMENT_ANCHOR_Y_FIELD, static_cast<scalar_t>(0.0f));
  resetElementInterpolation(workspace, slot, ELEMENT_SHIFT_DISTANCE_FIELD, static_cast<scalar_t>(0.0f));
  resetElementInterpolation(workspace, slot, ELEMENT_SHIFT_ANGLE_FIELD, static_cast<scalar_t>(0.0f));
  resetElementInterpolation(workspace, slot, ELEMENT_OPACITY_FIELD, static_cast<scalar_t>(1.0f));
  resetElementInterpolation(
      workspace,
      slot,
      ELEMENT_RENDER_OPACITY_FIELD,
      static_cast<scalar_t>(1.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_BORDER_WIDTH_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_BORDER_COLOR_R_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_BORDER_COLOR_G_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_BORDER_COLOR_B_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_BORDER_COLOR_A_OFFSET,
      slot,
      static_cast<scalar_t>(1.0f));
  resetElementInterpolation(
      workspace,
      slot,
      ELEMENT_LEADERLINE_WIDTH_FIELD,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_LEADERLINE_COLOR0_R_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_LEADERLINE_COLOR0_G_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_LEADERLINE_COLOR0_B_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_LEADERLINE_COLOR0_A_OFFSET,
      slot,
      static_cast<scalar_t>(1.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_LEADERLINE_COLOR1_R_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_LEADERLINE_COLOR1_G_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_LEADERLINE_COLOR1_B_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_LEADERLINE_COLOR1_A_OFFSET,
      slot,
      static_cast<scalar_t>(1.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_LEADERLINE_REPEAT_LENGTH_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  resetElementInterpolation(workspace, slot, ELEMENT_ROTATION_FIELD, static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_FINAL_ROTATE_CONFIG_DURATION_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setElementValue(
      workspace,
      SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_CONFIG_DURATION_OFFSET,
      slot,
      static_cast<scalar_t>(0.0f));
  setAutoDirectionConfig(
      workspace,
      slot,
      AUTO_DIRECTION_SPACE_WORLD,
      AUTO_DIRECTION_MODE_NONE,
      false,
      static_cast<scalar_t>(0.0f),
      false,
      false,
      static_cast<scalar_t>(0.0f),
      static_cast<scalar_t>(INTERPOLATION_MODE_FEEDBACK),
      static_cast<scalar_t>(INTERPOLATION_EASING_LINEAR),
      static_cast<scalar_t>(0.0f),
      static_cast<scalar_t>(0.0f),
      static_cast<scalar_t>(0.0f),
      static_cast<scalar_t>(0.0f));
  resetAutoDirectionRuntimeState(
      workspace,
      slot,
      static_cast<scalar_t>(0.0f),
      static_cast<scalar_t>(0.0f));
  markPivotDirty(workspace, slot);
}

/**
 * @brief Copies texture dimensions into an element slot from the texture table.
 */
static inline void setElementTextureDimensions(
    CommandContext &context,
    int slot,
    int texIndex) {
  auto &workspace = context.workspace;
  scalar_t width = static_cast<scalar_t>(0.0f);
  scalar_t height = static_cast<scalar_t>(0.0f);
  if (texIndex >= 0 && texIndex < static_cast<int>(context.textures.size())) {
    const auto &texture = context.textures[static_cast<size_t>(texIndex)];
    if (texture.valid != 0) {
      width = texture.width;
      height = texture.height;
    }
  }
  setElementValue(workspace, SPRITE_ELEMENT_WIDTH_OFFSET, slot, width);
  setElementValue(workspace, SPRITE_ELEMENT_HEIGHT_OFFSET, slot, height);
}

/**
 * @brief Propagates texture-dimension changes to every element using that texture.
 */
static inline void updateElementDimensionsForTexIndex(
    CommandContext &context,
    int texIndex,
    scalar_t width,
    scalar_t height,
    bool valid) {
  if (texIndex < 0) {
    return;
  }
  auto &workspace = context.workspace;
  const int count = workspace.elementCount;
  if (count <= 0) {
    return;
  }
  const scalar_t resolvedWidth =
      valid ? width : static_cast<scalar_t>(0.0f);
  const scalar_t resolvedHeight =
      valid ? height : static_cast<scalar_t>(0.0f);
  for (int slot = 0; slot < count; ++slot) {
    const int elementTexIndex =
        static_cast<int>(getElementValue(workspace, SPRITE_ELEMENT_TEX_INDEX_OFFSET, slot));
    if (elementTexIndex == texIndex) {
      setElementValue(workspace, SPRITE_ELEMENT_WIDTH_OFFSET, slot, resolvedWidth);
      setElementValue(workspace, SPRITE_ELEMENT_HEIGHT_OFFSET, slot, resolvedHeight);
    }
  }
}

/**
 * @brief Rebuilds owner and origin-location slot references after structural edits.
 */
static constexpr inline void syncElementOwnerAndOriginLocationSlots(CommandContext &context) {
  const bool statsEnabled = context.applyStatsBuffer &&
      context.applyStatsBufferCount >= APPLY_STATS_FIELDS;
  scalar_t startMs = static_cast<scalar_t>(0.0f);
  if (statsEnabled) {
    startMs = readNowMs();
  }
  auto &workspace = context.workspace;
  for (auto &sprite : context.sprites) {
    for (size_t index = 0; index < sprite.elements.size(); ++index) {
      auto &element = sprite.elements[index];
      setElementValue(workspace, SPRITE_ELEMENT_OWNER_SLOT_OFFSET, element.slot, sprite.slot);
      int originLocationSlot = -1;
      if (element.originLocationIndex >= 0 &&
          element.originLocationIndex < static_cast<int>(sprite.elements.size())) {
        originLocationSlot = sprite.elements[static_cast<size_t>(element.originLocationIndex)].slot;
      }
      setElementValue(workspace, SPRITE_ELEMENT_ORIGIN_LOCATION_SLOT_OFFSET, element.slot, originLocationSlot);
      markPivotResolveDirty(workspace, element.slot);
    }
  }
  if (statsEnabled) {
    const scalar_t durationMs = readNowMs() - startMs;
    if (durationMs > static_cast<scalar_t>(0.0f)) {
      context.applyStatsSyncSlotsMs += durationMs;
    }
  }
}

/**
 * @brief Removes one sprite slot from the dense sprite SoA buffers.
 */
static constexpr inline void removeSpriteSlotBySlotIndex(CommandContext &context, int removedSlot) {
  auto &workspace = context.workspace;
  const int count = workspace.spriteCount;
  if (removedSlot < 0 || removedSlot >= count || workspace.spriteCapacity <= 0) {
    return;
  }
  for (int field = 0; field < WASM_SPRITE_INPUT_FIELDS; ++field) {
    scalar_t *buffer =
        workspace.spriteInputBuffer.data() +
        static_cast<size_t>(field) * static_cast<size_t>(workspace.spriteCapacity);
    const size_t tailCount =
        static_cast<size_t>(count - removedSlot - 1);
    if (tailCount > 0) {
      std::memmove(
          buffer + removedSlot,
          buffer + removedSlot + 1,
          tailCount * sizeof(scalar_t));
    }
  }
  workspace.spriteCount = std::max(0, count - 1);
}

/**
 * @brief Removes one element slot from the dense element SoA buffers and caches.
 */
static constexpr inline void removeElementSlotBySlotIndex(CommandContext &context, int removedSlot) {
  auto &workspace = context.workspace;
  const int count = workspace.elementCount;
  if (removedSlot < 0 || removedSlot >= count || workspace.elementCapacity <= 0) {
    return;
  }
  for (int field = 0; field < WASM_ELEMENT_INPUT_FIELDS; ++field) {
    scalar_t *buffer =
        workspace.elementInputBuffer.data() +
        static_cast<size_t>(field) * static_cast<size_t>(workspace.elementCapacity);
    const size_t tailCount =
        static_cast<size_t>(count - removedSlot - 1);
    if (tailCount > 0) {
      std::memmove(
          buffer + removedSlot,
          buffer + removedSlot + 1,
          tailCount * sizeof(scalar_t));
    }
  }
  const size_t removedIndex = static_cast<size_t>(removedSlot);
  const size_t tailCount = removedSlot < count
      ? static_cast<size_t>(count - removedSlot - 1)
      : size_t{0};
  if (tailCount > 0) {
    if (workspace.pivotLocalXValues.size() > removedIndex) {
      std::memmove(
          workspace.pivotLocalXValues.data() + removedSlot,
          workspace.pivotLocalXValues.data() + removedSlot + 1,
          tailCount * sizeof(scalar_t));
      std::memmove(
          workspace.pivotLocalYValues.data() + removedSlot,
          workspace.pivotLocalYValues.data() + removedSlot + 1,
          tailCount * sizeof(scalar_t));
    }
    if (workspace.pivotDirtyFlags.size() > removedIndex) {
      std::memmove(
          workspace.pivotDirtyFlags.data() + removedSlot,
          workspace.pivotDirtyFlags.data() + removedSlot + 1,
          tailCount * sizeof(unsigned char));
    }
  }
  workspace.elementCount = std::max(0, count - 1);
  for (auto &sprite : context.sprites) {
    for (auto &element : sprite.elements) {
      if (element.slot > removedSlot) {
        element.slot -= 1;
      }
    }
  }
}

/**
 * @brief Removes one polyline slot from the dense polyline SoA buffers.
 */
static constexpr inline void removePolylineSlotBySlotIndex(
    CommandContext &context,
    int removedSlot) {
  auto &workspace = context.workspace;
  const int count = workspace.polylineCount;
  if (removedSlot < 0 || removedSlot >= count || workspace.polylineCapacity <= 0) {
    return;
  }
  for (int field = 0; field < WASM_POLYLINE_INPUT_FIELDS; ++field) {
    scalar_t *buffer =
        workspace.polylineInputBuffer.data() +
        static_cast<size_t>(field) * static_cast<size_t>(workspace.polylineCapacity);
    const size_t tailCount =
        static_cast<size_t>(count - removedSlot - 1);
    if (tailCount > 0) {
      std::memmove(
          buffer + removedSlot,
          buffer + removedSlot + 1,
          tailCount * sizeof(scalar_t));
    }
  }
  workspace.polylineCount = std::max(0, count - 1);
}

/**
 * @brief Removes a contiguous node range from the dense polyline-node SoA buffers.
 */
static constexpr inline void removePolylineNodeRange(
    CommandContext &context,
    int removedOffset,
    int removedCount) {
  auto &workspace = context.workspace;
  const int count = workspace.polylineNodeCount;
  if (removedCount <= 0 || removedOffset < 0 ||
      removedOffset + removedCount > count || workspace.polylineNodeCapacity <= 0) {
    return;
  }
  const size_t tailCount = static_cast<size_t>(count - removedOffset - removedCount);
  if (tailCount > 0) {
    for (int field = 0; field < WASM_POLYLINE_NODE_INPUT_FIELDS; ++field) {
      scalar_t *buffer =
          workspace.polylineNodeInputBuffer.data() +
          static_cast<size_t>(field) *
              static_cast<size_t>(workspace.polylineNodeCapacity);
      std::memmove(
          buffer + removedOffset,
          buffer + removedOffset + removedCount,
          tailCount * sizeof(scalar_t));
    }
  }
  workspace.polylineNodeCount = std::max(0, count - removedCount);
}

/**
 * @brief Shifts logical polyline node offsets after a node-range removal.
 */
static inline void shiftPolylineNodeOffsets(
    CommandContext &context,
    int removedOffset,
    int removedCount) {
  if (removedCount <= 0) {
    return;
  }
  auto &workspace = context.workspace;
  for (auto &polyline : context.polylines) {
    if (polyline.nodeOffset > removedOffset) {
      polyline.nodeOffset -= removedCount;
      setPolylineValue(
          workspace,
          POLYLINE_NODE_OFFSET_OFFSET,
          polyline.slot,
          static_cast<scalar_t>(polyline.nodeOffset));
    }
  }
}

/**
 * @brief Detects cycles in element origin-location references.
 */
static inline bool validateCircularOriginLocationReference(const std::vector<int> &originLocationIndices) {
  std::vector<int> state(WASM_MAX_ELEMENTS_PER_SPRITE, 0);
  std::vector<int> path;
  const auto getOriginLocation = [&](int index) -> int {
    if (index < 0 || index >= static_cast<int>(originLocationIndices.size())) {
      return -1;
    }
    return originLocationIndices[static_cast<size_t>(index)];
  };
  const std::function<bool(int)> dfs = [&](int index) -> bool {
    if (index < 0 || index >= WASM_MAX_ELEMENTS_PER_SPRITE) {
      return true;
    }
    const int currentState = state[static_cast<size_t>(index)];
    if (currentState == 1) {
      return false;
    }
    if (currentState == 2) {
      return true;
    }
    state[static_cast<size_t>(index)] = 1;
    path.push_back(index);
    const int originLocationIndex = getOriginLocation(index);
    if (originLocationIndex >= 0) {
      if (!dfs(originLocationIndex)) {
        return false;
      }
    }
    path.pop_back();
    state[static_cast<size_t>(index)] = 2;
    return true;
  };
  for (int index = 0; index < WASM_MAX_ELEMENTS_PER_SPRITE; ++index) {
    if (!dfs(index)) {
      return false;
    }
  }
  return true;
}

/**
 * @brief Validates a batch of element updates before mutating live sprite state.
 */
static inline bool validateElementUpdates(
    const SpriteMeta &sprite,
    const std::vector<ElementUpdateCommand> &updates,
    std::vector<int> &plannedOriginLocations) {
  plannedOriginLocations.clear();
  plannedOriginLocations.reserve(sprite.elements.size());
  for (const auto &element : sprite.elements) {
    plannedOriginLocations.push_back(element.originLocationIndex);
  }
  int nextCount = static_cast<int>(plannedOriginLocations.size());
  std::vector<int> removedIndices;
  for (const auto &update : updates) {
    if (update.kind == COMMAND_UPDATE_ELEMENT_KIND_REMOVE) {
      if (update.index < 0 || update.index >= nextCount) {
        return false;
      }
      removedIndices.push_back(update.index);
      continue;
    }
    if (update.index < 0 || update.index > nextCount) {
      return false;
    }
    if (update.index == nextCount) {
      plannedOriginLocations.push_back(-1);
      nextCount += 1;
    }
    if (update.data.originLocationProvided) {
      const int originLocationIndex = update.data.originLocationIndex;
      if (originLocationIndex < -1 || originLocationIndex >= WASM_MAX_ELEMENTS_PER_SPRITE) {
        return false;
      }
      plannedOriginLocations[static_cast<size_t>(update.index)] = originLocationIndex;
    }
  }
  if (!removedIndices.empty()) {
    std::sort(removedIndices.begin(), removedIndices.end(), std::greater<int>());
    for (const int removedIndex : removedIndices) {
      if (removedIndex >= 0 && removedIndex < static_cast<int>(plannedOriginLocations.size())) {
        plannedOriginLocations.erase(plannedOriginLocations.begin() + removedIndex);
      }
    }
  }
  for (const int originLocationIndex : plannedOriginLocations) {
    if (originLocationIndex >= 0 && originLocationIndex >= static_cast<int>(plannedOriginLocations.size())) {
      return false;
    }
  }
  return validateCircularOriginLocationReference(plannedOriginLocations);
}

/**
 * @brief Materializes one element payload into a freshly allocated element slot.
 */
static constexpr inline bool applyElementPlacement(
    CommandContext &context,
    SpriteMeta &sprite,
    int elementIndex,
    const ElementCommandData &data,
    scalar_t nowMs) {
  if (!data.present) {
    return true;
  }
  auto &workspace = context.workspace;
  auto &element = sprite.elements[static_cast<size_t>(elementIndex)];
  const scalar_t visibilityMultiplier =
      resolveCurrentVisibilityMultiplier(workspace, sprite.slot);
  if (data.imageMode != COMMAND_IMAGE_MODE_SET) {
    return false;
  }
  int texIndex = -1;
  if (!toIntScalar(data.texIndexValue, texIndex) || texIndex < 0) {
    return false;
  }
  setElementValue(workspace, SPRITE_ELEMENT_TEX_INDEX_OFFSET, element.slot, texIndex);
  setElementTextureDimensions(context, element.slot, texIndex);

  int originLocationIndex = -1;
  if (data.originLocationProvided) {
    originLocationIndex = data.originLocationIndex;
  }
  if (originLocationIndex >= 0 && originLocationIndex >= static_cast<int>(sprite.elements.size())) {
    return false;
  }
  element.originLocationIndex = originLocationIndex;
  const int originLocationSlot = originLocationIndex < 0 ? -1 : sprite.elements[static_cast<size_t>(originLocationIndex)].slot;
  setElementValue(workspace, SPRITE_ELEMENT_ORIGIN_LOCATION_SLOT_OFFSET, element.slot, originLocationSlot);
  setElementValue(
      workspace,
      SPRITE_ELEMENT_ORIGIN_LOCATION_USE_RESOLVED_ANCHOR_OFFSET,
      element.slot,
      static_cast<scalar_t>(data.originLocationUseResolvedAnchor ? 1.0f : 0.0f));

  if (data.layer.has) {
    int layer = 0;
    if (!normalizeLayerValue(data.layer.value, layer)) {
      return normalizeFailure();
    }
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LAYER_OFFSET,
        element.slot,
        static_cast<scalar_t>(layer));
  }

  if (data.order.has) {
    int order = 0;
    if (!normalizeOrderValue(data.order.value, order)) {
      return normalizeFailure();
    }
    setElementValue(
        workspace,
        SPRITE_ELEMENT_ORDER_OFFSET,
        element.slot,
        static_cast<scalar_t>(order));
  }

  if (data.renderMode.has) {
    int renderMode = COMMON_RENDER_MODE_SURFACE;
    if (!normalizeRenderModeValue(data.renderMode.value, renderMode)) {
      return normalizeFailure();
    }
    setElementValue(
        workspace,
        SPRITE_ELEMENT_RENDER_MODE_OFFSET,
        element.slot,
        static_cast<scalar_t>(renderMode));
  }

  if (!applyElementPlacementInterpolation(
          workspace,
          element.slot,
          ELEMENT_SCALE_FIELD,
          data.scale,
          static_cast<scalar_t>(1.0f),
          normalizeScaleValue,
          nowMs)) {
    return false;
  }

  if (!applyElementPlacementInterpolation(
          workspace,
          element.slot,
          ELEMENT_ANCHOR_X_FIELD,
          data.anchorX,
          static_cast<scalar_t>(0.0f),
          normalizeAnchorValue,
          nowMs)) {
    return false;
  }

  if (!applyElementPlacementInterpolation(
          workspace,
          element.slot,
          ELEMENT_ANCHOR_Y_FIELD,
          data.anchorY,
          static_cast<scalar_t>(0.0f),
          normalizeAnchorValue,
          nowMs)) {
    return false;
  }

  if (!applyElementPlacementInterpolation(
          workspace,
          element.slot,
          ELEMENT_SHIFT_DISTANCE_FIELD,
          data.shiftDistance,
          static_cast<scalar_t>(0.0f),
          normalizeShiftDistanceValue,
          nowMs)) {
    return false;
  }

  if (!applyElementPlacementInterpolation(
          workspace,
          element.slot,
          ELEMENT_SHIFT_ANGLE_FIELD,
          data.shiftAngle,
          static_cast<scalar_t>(0.0f),
          normalizeRotationValue,
          nowMs)) {
    return false;
  }
  const scalar_t shiftAngleConfigDuration =
      data.shiftAngle.hasInterpolation &&
              isFiniteScalar(data.shiftAngle.duration) &&
              data.shiftAngle.duration > static_cast<scalar_t>(0.0f)
          ? data.shiftAngle.duration
          : static_cast<scalar_t>(0.0f);
  setElementValue(
      workspace,
      SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_CONFIG_DURATION_OFFSET,
      element.slot,
      shiftAngleConfigDuration);

  if (!applyElementPlacementInterpolation(
          workspace,
          element.slot,
          ELEMENT_OPACITY_FIELD,
          data.opacity,
          static_cast<scalar_t>(1.0f),
          normalizeOpacityValue,
          nowMs)) {
    return false;
  }
  if (data.opacity.has || data.opacity.hasInterpolation || data.opacity.keepInterpolation) {
    applyElementRenderOpacityCommand(
        workspace,
        sprite.slot,
        element.slot,
        data.opacity,
        visibilityMultiplier,
        nowMs);
  } else {
    resetElementInterpolation(
        workspace,
        element.slot,
        ELEMENT_RENDER_OPACITY_FIELD,
        resolveElementRenderOpacityTarget(
            workspace,
            sprite.slot,
            element.slot,
            visibilityMultiplier));
  }

  if (data.borderMode == COMMAND_BORDER_MODE_CLEAR) {
    setElementValue(
        workspace,
        SPRITE_ELEMENT_BORDER_WIDTH_OFFSET,
        element.slot,
        static_cast<scalar_t>(0.0f));
    setElementValue(
        workspace,
        SPRITE_ELEMENT_BORDER_COLOR_R_OFFSET,
        element.slot,
        static_cast<scalar_t>(0.0f));
    setElementValue(
        workspace,
        SPRITE_ELEMENT_BORDER_COLOR_G_OFFSET,
        element.slot,
        static_cast<scalar_t>(0.0f));
    setElementValue(
        workspace,
        SPRITE_ELEMENT_BORDER_COLOR_B_OFFSET,
        element.slot,
        static_cast<scalar_t>(0.0f));
    setElementValue(
        workspace,
        SPRITE_ELEMENT_BORDER_COLOR_A_OFFSET,
        element.slot,
        static_cast<scalar_t>(1.0f));
  } else if (data.borderMode == COMMAND_BORDER_MODE_SET) {
    if (data.borderWidth.has) {
      scalar_t borderWidth = static_cast<scalar_t>(0.0f);
      if (!normalizeBorderWidthValue(data.borderWidth.value, borderWidth)) {
        return normalizeFailure();
      }
      setElementValue(
          workspace,
          SPRITE_ELEMENT_BORDER_WIDTH_OFFSET,
          element.slot,
          borderWidth);
    }
    if (data.borderColorHas) {
      scalar_t colorR = 0.0f;
      scalar_t colorG = 0.0f;
      scalar_t colorB = 0.0f;
      scalar_t colorA = 1.0f;
      if (!normalizeColorValue(data.borderColorR, colorR) ||
          !normalizeColorValue(data.borderColorG, colorG) ||
          !normalizeColorValue(data.borderColorB, colorB) ||
          !normalizeColorValue(data.borderColorA, colorA)) {
        return normalizeFailure();
      }
      setElementValue(
          workspace,
          SPRITE_ELEMENT_BORDER_COLOR_R_OFFSET,
          element.slot,
          colorR);
      setElementValue(
          workspace,
          SPRITE_ELEMENT_BORDER_COLOR_G_OFFSET,
          element.slot,
          colorG);
      setElementValue(
          workspace,
          SPRITE_ELEMENT_BORDER_COLOR_B_OFFSET,
          element.slot,
          colorB);
      setElementValue(
          workspace,
          SPRITE_ELEMENT_BORDER_COLOR_A_OFFSET,
          element.slot,
          colorA);
    }
  }

  if (data.leaderlineHas) {
    if (!applyElementPlacementInterpolation(
            workspace,
            element.slot,
            ELEMENT_LEADERLINE_WIDTH_FIELD,
            data.leaderlineWidth,
            static_cast<scalar_t>(0.0f),
            normalizeLeaderlineWidthValue,
            nowMs)) {
      return false;
    }
    scalar_t color0R = 0.0f;
    scalar_t color0G = 0.0f;
    scalar_t color0B = 0.0f;
    scalar_t color0A = 1.0f;
    scalar_t color1R = 0.0f;
    scalar_t color1G = 0.0f;
    scalar_t color1B = 0.0f;
    scalar_t color1A = 1.0f;
    scalar_t repeatLength = 0.0f;
    if (!normalizeColorValue(data.leaderlineColor0R, color0R) ||
        !normalizeColorValue(data.leaderlineColor0G, color0G) ||
        !normalizeColorValue(data.leaderlineColor0B, color0B) ||
        !normalizeColorValue(data.leaderlineColor0A, color0A) ||
        !normalizeColorValue(data.leaderlineColor1R, color1R) ||
        !normalizeColorValue(data.leaderlineColor1G, color1G) ||
        !normalizeColorValue(data.leaderlineColor1B, color1B) ||
        !normalizeColorValue(data.leaderlineColor1A, color1A) ||
        !normalizeRepeatLengthValue(data.leaderlineRepeatLength, repeatLength)) {
      return normalizeFailure();
    }
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_COLOR0_R_OFFSET,
        element.slot,
        color0R);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_COLOR0_G_OFFSET,
        element.slot,
        color0G);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_COLOR0_B_OFFSET,
        element.slot,
        color0B);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_COLOR0_A_OFFSET,
        element.slot,
        color0A);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_COLOR1_R_OFFSET,
        element.slot,
        color1R);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_COLOR1_G_OFFSET,
        element.slot,
        color1G);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_COLOR1_B_OFFSET,
        element.slot,
        color1B);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_COLOR1_A_OFFSET,
        element.slot,
        color1A);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_REPEAT_LENGTH_OFFSET,
        element.slot,
        repeatLength);
  }

  if (data.rotation.value.has) {
    scalar_t rotate = 0.0f;
    if (!normalizeRotationValue(data.rotation.value.value, rotate)) {
      return normalizeFailure();
    }
    ValueCommand rotationCommand = data.rotation.value;
    rotationCommand.value = rotate;
    applyElementInterpolation(
        workspace,
        element.slot,
        ELEMENT_ROTATION_FIELD,
        rotationCommand,
        rotate,
        nowMs);
    const scalar_t configDuration =
        data.rotation.value.hasInterpolation &&
                isFiniteScalar(data.rotation.value.duration) &&
                data.rotation.value.duration > static_cast<scalar_t>(0.0f)
            ? data.rotation.value.duration
            : static_cast<scalar_t>(0.0f);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_FINAL_ROTATE_CONFIG_DURATION_OFFSET,
        element.slot,
        configDuration);
  } else {
    resetElementInterpolation(workspace, element.slot, ELEMENT_ROTATION_FIELD, 0.0f);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_FINAL_ROTATE_CONFIG_DURATION_OFFSET,
        element.slot,
        static_cast<scalar_t>(0.0f));
  }

  int autoDirectionSpace = AUTO_DIRECTION_SPACE_WORLD;
  if (data.autoDirection.spaceHas) {
    autoDirectionSpace = static_cast<int>(data.autoDirection.space);
    if (autoDirectionSpace < AUTO_DIRECTION_SPACE_WORLD ||
        autoDirectionSpace > AUTO_DIRECTION_SPACE_PARENT_LOCAL) {
      return normalizeFailure();
    }
  }
  int autoDirectionMode = AUTO_DIRECTION_MODE_NONE;
  if (data.autoDirection.modeHas) {
    autoDirectionMode = static_cast<int>(data.autoDirection.mode);
    if (autoDirectionMode < AUTO_DIRECTION_MODE_NONE ||
        autoDirectionMode > AUTO_DIRECTION_MODE_FLIPPING) {
      return normalizeFailure();
    }
  }
  const bool shiftAngleRotation = data.autoDirection.shiftAngleRotationHas &&
      data.autoDirection.shiftAngleRotation != static_cast<scalar_t>(0.0f);
  scalar_t autoDirectionMinDistance = static_cast<scalar_t>(0.0f);
  if (data.autoDirection.minDistanceHas) {
    if (!normalizeAutoRotationDistance(
            data.autoDirection.minDistance,
            autoDirectionMinDistance)) {
      return normalizeFailure();
    }
  }
  const bool flipXEnabled =
      autoDirectionMode == AUTO_DIRECTION_MODE_FLIPPING &&
      data.autoDirection.flipXHas &&
      data.autoDirection.flipX != static_cast<scalar_t>(0.0f);
  const bool flipYEnabled =
      autoDirectionMode == AUTO_DIRECTION_MODE_FLIPPING &&
      data.autoDirection.flipYHas &&
      data.autoDirection.flipY != static_cast<scalar_t>(0.0f);
  scalar_t flipInterpolationDuration = static_cast<scalar_t>(0.0f);
  scalar_t flipInterpolationMode = static_cast<scalar_t>(INTERPOLATION_MODE_FEEDBACK);
  scalar_t flipInterpolationEasing = static_cast<scalar_t>(INTERPOLATION_EASING_LINEAR);
  scalar_t flipInterpolationParam0 = static_cast<scalar_t>(0.0f);
  scalar_t flipInterpolationParam1 = static_cast<scalar_t>(0.0f);
  scalar_t flipInterpolationParam2 = static_cast<scalar_t>(0.0f);
  scalar_t flipInterpolationParam3 = static_cast<scalar_t>(0.0f);
  if (data.autoDirection.interpolationHas &&
      isFiniteScalar(data.autoDirection.interpolationDuration) &&
      data.autoDirection.interpolationDuration > static_cast<scalar_t>(0.0f)) {
    flipInterpolationDuration = data.autoDirection.interpolationDuration;
    flipInterpolationMode = data.autoDirection.interpolationMode;
    flipInterpolationEasing = data.autoDirection.interpolationEasing;
    flipInterpolationParam0 = data.autoDirection.interpolationParam0;
    flipInterpolationParam1 = data.autoDirection.interpolationParam1;
    flipInterpolationParam2 = data.autoDirection.interpolationParam2;
    flipInterpolationParam3 = data.autoDirection.interpolationParam3;
  }
  setAutoDirectionConfig(
      workspace,
      element.slot,
      autoDirectionSpace,
      autoDirectionMode,
      shiftAngleRotation,
      autoDirectionMinDistance,
      flipXEnabled,
      flipYEnabled,
      flipInterpolationDuration,
      flipInterpolationMode,
      flipInterpolationEasing,
      flipInterpolationParam0,
      flipInterpolationParam1,
      flipInterpolationParam2,
      flipInterpolationParam3);
  const scalar_t currentRotate =
      getElementValue(workspace, SPRITE_ELEMENT_ROTATE_DEG_OFFSET, element.slot);
  const scalar_t currentShiftAngle =
      getElementValue(workspace, SPRITE_ELEMENT_SHIFT_ANGLE_DEG_OFFSET, element.slot);
  resetAutoDirectionRuntimeState(
      workspace,
      element.slot,
      currentRotate,
      currentShiftAngle);

  markPivotDirty(workspace, element.slot);
  return true;
}

/**
 * @brief Applies one element mutation inside a sprite update command.
 */
static inline bool applyElementUpdate(
    CommandContext &context,
    SpriteMeta &sprite,
    const ElementUpdateCommand &update,
    scalar_t nowMs) {
  auto &workspace = context.workspace;
  if (update.index < 0) {
    return false;
  }
  if (update.kind == COMMAND_UPDATE_ELEMENT_KIND_REMOVE) {
    if (update.index >= static_cast<int>(sprite.elements.size())) {
      return false;
    }
    const int removedSlot = sprite.elements[static_cast<size_t>(update.index)].slot;
    if (removedSlot >= 0) {
      removeElementSlotBySlotIndex(context, removedSlot);
    }
    sprite.elements.erase(sprite.elements.begin() + update.index);
    return true;
  }
  if (update.index > static_cast<int>(sprite.elements.size())) {
    return false;
  }
  if (update.index == static_cast<int>(sprite.elements.size())) {
    const int newSlot = context.workspace.elementCount;
    context.workspace.prepare(
        context.workspace.spriteCount,
        newSlot + 1,
        context.workspace.polylineCount,
        context.workspace.polylineNodeCount,
        context.debugEntryEnabled);
    sprite.elements.push_back(ElementMeta{newSlot, -1});
    initializeElementDefaults(context, newSlot, sprite.slot);
  }

  auto &element = sprite.elements[static_cast<size_t>(update.index)];
  bool pivotDirty = false;
  const scalar_t visibilityMultiplier =
      resolveCurrentVisibilityMultiplier(workspace, sprite.slot);

  if (update.data.imageMode == COMMAND_IMAGE_MODE_CLEAR) {
    setElementValue(workspace, SPRITE_ELEMENT_TEX_INDEX_OFFSET, element.slot, -1.0f);
    setElementTextureDimensions(context, element.slot, -1);
    pivotDirty = true;
  } else if (update.data.imageMode == COMMAND_IMAGE_MODE_SET) {
    int texIndex = -1;
    if (!toIntScalar(update.data.texIndexValue, texIndex) || texIndex < 0) {
      return false;
    }
    setElementValue(workspace, SPRITE_ELEMENT_TEX_INDEX_OFFSET, element.slot, texIndex);
    setElementTextureDimensions(context, element.slot, texIndex);
    pivotDirty = true;
  }

  if (update.data.originLocationProvided) {
    const int originLocationIndex = update.data.originLocationIndex;
    if (originLocationIndex >= static_cast<int>(sprite.elements.size())) {
      return false;
    }
    element.originLocationIndex = originLocationIndex;
    const int originLocationSlot =
        originLocationIndex < 0 ? -1 : sprite.elements[static_cast<size_t>(originLocationIndex)].slot;
    setElementValue(workspace, SPRITE_ELEMENT_ORIGIN_LOCATION_SLOT_OFFSET, element.slot, originLocationSlot);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_ORIGIN_LOCATION_USE_RESOLVED_ANCHOR_OFFSET,
        element.slot,
        static_cast<scalar_t>(update.data.originLocationUseResolvedAnchor ? 1.0f : 0.0f));
    pivotDirty = true;
  }

  if (update.data.layer.has) {
    int layer = 0;
    if (!normalizeLayerValue(update.data.layer.value, layer)) {
      return normalizeFailure();
    }
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LAYER_OFFSET,
        element.slot,
        static_cast<scalar_t>(layer));
  }

  if (update.data.order.has) {
    int order = 0;
    if (!normalizeOrderValue(update.data.order.value, order)) {
      return normalizeFailure();
    }
    setElementValue(
        workspace,
        SPRITE_ELEMENT_ORDER_OFFSET,
        element.slot,
        static_cast<scalar_t>(order));
  }

  if (update.data.renderMode.has) {
    int renderMode = COMMON_RENDER_MODE_SURFACE;
    if (!normalizeRenderModeValue(update.data.renderMode.value, renderMode)) {
      return normalizeFailure();
    }
    setElementValue(
        workspace,
        SPRITE_ELEMENT_RENDER_MODE_OFFSET,
        element.slot,
        static_cast<scalar_t>(renderMode));
  }

  const WorkspaceSlotInterpolationTarget elementTarget{workspace, element.slot};
  bool opacityUpdated = false;
  const auto applyElementUpdateInterpolation = [&](
      const InterpolationField &field,
      const ValueCommand &command,
      const auto &normalize,
      bool affectsPivot) -> bool {
    bool updated = false;
    scalar_t resolvedValue = static_cast<scalar_t>(0.0f);
    if (!applyScalarInterpolationUpdate<ElementInterpolationAccessor>(
            elementTarget,
            field,
            command,
            nowMs,
            normalize,
            resolvedValue,
            updated)) {
      return false;
    }
    if (affectsPivot && updated) {
      pivotDirty = true;
    }
    return true;
  };

  if (!applyElementUpdateInterpolation(
          ELEMENT_SHIFT_DISTANCE_FIELD,
          update.data.shiftDistance,
          normalizeShiftDistanceValue,
          true)) {
    return false;
  }
  if (!applyElementUpdateInterpolation(
          ELEMENT_SHIFT_ANGLE_FIELD,
          update.data.shiftAngle,
          normalizeRotationValue,
          true)) {
    return false;
  }
  const bool shiftAngleValueOrInterpolation =
      update.data.shiftAngle.has ||
      update.data.shiftAngle.hasInterpolation ||
      update.data.shiftAngle.keepInterpolation;
  if (shiftAngleValueOrInterpolation) {
    if (update.data.shiftAngle.hasInterpolation) {
      const scalar_t configDuration =
          isFiniteScalar(update.data.shiftAngle.duration) &&
                  update.data.shiftAngle.duration > static_cast<scalar_t>(0.0f)
              ? update.data.shiftAngle.duration
              : static_cast<scalar_t>(0.0f);
      setElementValue(
          workspace,
          SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_CONFIG_DURATION_OFFSET,
          element.slot,
          configDuration);
    } else if (!update.data.shiftAngle.keepInterpolation) {
      setElementValue(
          workspace,
          SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_CONFIG_DURATION_OFFSET,
          element.slot,
          static_cast<scalar_t>(0.0f));
    }
  }
  if (!applyElementUpdateInterpolation(
          ELEMENT_SCALE_FIELD,
          update.data.scale,
          normalizeScaleValue,
          true)) {
    return false;
  }
  if (!applyElementUpdateInterpolation(
          ELEMENT_OPACITY_FIELD,
          update.data.opacity,
          normalizeOpacityValue,
          false)) {
    return false;
  }
  opacityUpdated = hasInterpolationUpdate(update.data.opacity);
  if (opacityUpdated) {
    applyElementRenderOpacityCommand(
        workspace,
        sprite.slot,
        element.slot,
        update.data.opacity,
        visibilityMultiplier,
        nowMs);
  }
  if (update.data.borderMode == COMMAND_BORDER_MODE_CLEAR) {
    setElementValue(
        workspace,
        SPRITE_ELEMENT_BORDER_WIDTH_OFFSET,
        element.slot,
        static_cast<scalar_t>(0.0f));
    setElementValue(
        workspace,
        SPRITE_ELEMENT_BORDER_COLOR_R_OFFSET,
        element.slot,
        static_cast<scalar_t>(0.0f));
    setElementValue(
        workspace,
        SPRITE_ELEMENT_BORDER_COLOR_G_OFFSET,
        element.slot,
        static_cast<scalar_t>(0.0f));
    setElementValue(
        workspace,
        SPRITE_ELEMENT_BORDER_COLOR_B_OFFSET,
        element.slot,
        static_cast<scalar_t>(0.0f));
    setElementValue(
        workspace,
        SPRITE_ELEMENT_BORDER_COLOR_A_OFFSET,
        element.slot,
        static_cast<scalar_t>(1.0f));
  } else if (update.data.borderMode == COMMAND_BORDER_MODE_SET) {
    if (update.data.borderWidth.has) {
      scalar_t borderWidth = static_cast<scalar_t>(0.0f);
      if (!normalizeBorderWidthValue(update.data.borderWidth.value, borderWidth)) {
        return normalizeFailure();
      }
      setElementValue(
          workspace,
          SPRITE_ELEMENT_BORDER_WIDTH_OFFSET,
          element.slot,
          borderWidth);
    }
    if (update.data.borderColorHas) {
      scalar_t colorR = 0.0f;
      scalar_t colorG = 0.0f;
      scalar_t colorB = 0.0f;
      scalar_t colorA = 1.0f;
      if (!normalizeColorValue(update.data.borderColorR, colorR) ||
          !normalizeColorValue(update.data.borderColorG, colorG) ||
          !normalizeColorValue(update.data.borderColorB, colorB) ||
          !normalizeColorValue(update.data.borderColorA, colorA)) {
        return normalizeFailure();
      }
      setElementValue(
          workspace,
          SPRITE_ELEMENT_BORDER_COLOR_R_OFFSET,
          element.slot,
          colorR);
      setElementValue(
          workspace,
          SPRITE_ELEMENT_BORDER_COLOR_G_OFFSET,
          element.slot,
          colorG);
      setElementValue(
          workspace,
          SPRITE_ELEMENT_BORDER_COLOR_B_OFFSET,
          element.slot,
          colorB);
      setElementValue(
          workspace,
          SPRITE_ELEMENT_BORDER_COLOR_A_OFFSET,
          element.slot,
          colorA);
    }
  }
  if (update.data.leaderlineHas) {
    if (!applyElementUpdateInterpolation(
            ELEMENT_LEADERLINE_WIDTH_FIELD,
            update.data.leaderlineWidth,
            normalizeLeaderlineWidthValue,
            false)) {
      return false;
    }
    scalar_t color0R = 0.0f;
    scalar_t color0G = 0.0f;
    scalar_t color0B = 0.0f;
    scalar_t color0A = 1.0f;
    scalar_t color1R = 0.0f;
    scalar_t color1G = 0.0f;
    scalar_t color1B = 0.0f;
    scalar_t color1A = 1.0f;
    scalar_t repeatLength = 0.0f;
    if (!normalizeColorValue(update.data.leaderlineColor0R, color0R) ||
        !normalizeColorValue(update.data.leaderlineColor0G, color0G) ||
        !normalizeColorValue(update.data.leaderlineColor0B, color0B) ||
        !normalizeColorValue(update.data.leaderlineColor0A, color0A) ||
        !normalizeColorValue(update.data.leaderlineColor1R, color1R) ||
        !normalizeColorValue(update.data.leaderlineColor1G, color1G) ||
        !normalizeColorValue(update.data.leaderlineColor1B, color1B) ||
        !normalizeColorValue(update.data.leaderlineColor1A, color1A) ||
        !normalizeRepeatLengthValue(update.data.leaderlineRepeatLength, repeatLength)) {
      return normalizeFailure();
    }
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_COLOR0_R_OFFSET,
        element.slot,
        color0R);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_COLOR0_G_OFFSET,
        element.slot,
        color0G);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_COLOR0_B_OFFSET,
        element.slot,
        color0B);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_COLOR0_A_OFFSET,
        element.slot,
        color0A);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_COLOR1_R_OFFSET,
        element.slot,
        color1R);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_COLOR1_G_OFFSET,
        element.slot,
        color1G);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_COLOR1_B_OFFSET,
        element.slot,
        color1B);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_COLOR1_A_OFFSET,
        element.slot,
        color1A);
    setElementValue(
        workspace,
        SPRITE_ELEMENT_LEADERLINE_REPEAT_LENGTH_OFFSET,
        element.slot,
        repeatLength);
  }
  if (!applyElementUpdateInterpolation(
          ELEMENT_ANCHOR_X_FIELD,
          update.data.anchorX,
          normalizeAnchorValue,
          true)) {
    return false;
  }
  if (!applyElementUpdateInterpolation(
          ELEMENT_ANCHOR_Y_FIELD,
          update.data.anchorY,
          normalizeAnchorValue,
          true)) {
    return false;
  }

  const bool rotationValueOrInterpolation =
      update.data.rotation.value.has ||
      update.data.rotation.value.hasInterpolation ||
      update.data.rotation.value.keepInterpolation;
  const bool autoDirectionUpdate =
      update.data.autoDirection.spaceHas ||
      update.data.autoDirection.modeHas ||
      update.data.autoDirection.shiftAngleRotationHas ||
      update.data.autoDirection.minDistanceHas ||
      update.data.autoDirection.flipXHas ||
      update.data.autoDirection.flipYHas ||
      update.data.autoDirection.interpolationHas ||
      update.data.autoDirection.interpolationClear;
  if (rotationValueOrInterpolation || autoDirectionUpdate) {
  if (rotationValueOrInterpolation) {
    scalar_t rotate = static_cast<scalar_t>(0.0f);
    if (!applyScalarInterpolationUpdateIgnore<ElementInterpolationAccessor>(
            elementTarget,
            ELEMENT_ROTATION_FIELD,
            update.data.rotation.value,
            nowMs,
            normalizeRotationValue,
            rotate)) {
      return false;
    }
    if (update.data.rotation.value.hasInterpolation) {
      const scalar_t configDuration =
          isFiniteScalar(update.data.rotation.value.duration) &&
                  update.data.rotation.value.duration > static_cast<scalar_t>(0.0f)
              ? update.data.rotation.value.duration
              : static_cast<scalar_t>(0.0f);
      setElementValue(
          workspace,
          SPRITE_ELEMENT_FINAL_ROTATE_CONFIG_DURATION_OFFSET,
          element.slot,
          configDuration);
    } else if (!update.data.rotation.value.keepInterpolation) {
      setElementValue(
          workspace,
          SPRITE_ELEMENT_FINAL_ROTATE_CONFIG_DURATION_OFFSET,
          element.slot,
          static_cast<scalar_t>(0.0f));
    }
    }
    if (autoDirectionUpdate) {
      const int currentSpace = static_cast<int>(
          getElementValue(
              workspace,
              SPRITE_ELEMENT_AUTO_DIRECTION_SPACE_OFFSET,
              element.slot));
      int resolvedSpace = currentSpace;
      if (update.data.autoDirection.spaceHas) {
        resolvedSpace = static_cast<int>(update.data.autoDirection.space);
        if (resolvedSpace < AUTO_DIRECTION_SPACE_WORLD ||
            resolvedSpace > AUTO_DIRECTION_SPACE_PARENT_LOCAL) {
          return normalizeFailure();
        }
      }
      const int currentMode = static_cast<int>(
          getElementValue(workspace, SPRITE_ELEMENT_AUTO_DIRECTION_MODE_OFFSET, element.slot));
      int resolvedMode = currentMode;
      if (update.data.autoDirection.modeHas) {
        resolvedMode = static_cast<int>(update.data.autoDirection.mode);
        if (resolvedMode < AUTO_DIRECTION_MODE_NONE ||
            resolvedMode > AUTO_DIRECTION_MODE_FLIPPING) {
          return normalizeFailure();
        }
      }
      const bool currentShiftAngleRotation =
          getElementValue(
              workspace,
              SPRITE_ELEMENT_AUTO_DIRECTION_SHIFT_ANGLE_ROTATION_OFFSET,
              element.slot) != static_cast<scalar_t>(0.0f);
      bool resolvedShiftAngleRotation = currentShiftAngleRotation;
      if (update.data.autoDirection.shiftAngleRotationHas) {
        resolvedShiftAngleRotation =
            update.data.autoDirection.shiftAngleRotation != static_cast<scalar_t>(0.0f);
      }
      const scalar_t currentMinDistance =
          getElementValue(
              workspace,
              SPRITE_ELEMENT_AUTO_DIRECTION_MIN_DISTANCE_OFFSET,
              element.slot);
      scalar_t resolvedMinDistance = currentMinDistance;
      if (update.data.autoDirection.minDistanceHas) {
        if (!normalizeAutoRotationDistance(
                update.data.autoDirection.minDistance,
                resolvedMinDistance)) {
          return normalizeFailure();
        }
      }
      const bool currentFlipXEnabled =
          getElementValue(
              workspace,
              SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_X_ENABLED_OFFSET,
              element.slot) != static_cast<scalar_t>(0.0f);
      const bool currentFlipYEnabled =
          getElementValue(
              workspace,
              SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_Y_ENABLED_OFFSET,
              element.slot) != static_cast<scalar_t>(0.0f);
      bool resolvedFlipXEnabled = currentFlipXEnabled;
      bool resolvedFlipYEnabled = currentFlipYEnabled;
      if (resolvedMode != AUTO_DIRECTION_MODE_FLIPPING) {
        resolvedFlipXEnabled = false;
        resolvedFlipYEnabled = false;
      }
      if (update.data.autoDirection.flipXHas) {
        resolvedFlipXEnabled =
            resolvedMode == AUTO_DIRECTION_MODE_FLIPPING &&
            update.data.autoDirection.flipX != static_cast<scalar_t>(0.0f);
      }
      if (update.data.autoDirection.flipYHas) {
        resolvedFlipYEnabled =
            resolvedMode == AUTO_DIRECTION_MODE_FLIPPING &&
            update.data.autoDirection.flipY != static_cast<scalar_t>(0.0f);
      }
      const scalar_t currentFlipInterpDuration =
          getElementValue(
              workspace,
              SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_CONFIG_DURATION_OFFSET,
              element.slot);
      const scalar_t currentFlipInterpMode =
          getElementValue(
              workspace,
              SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_MODE_OFFSET,
              element.slot);
      const scalar_t currentFlipInterpEasing =
          getElementValue(
              workspace,
              SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_EASING_OFFSET,
              element.slot);
      const scalar_t currentFlipInterpParam0 =
          getElementValue(
              workspace,
              SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_PARAM0_OFFSET,
              element.slot);
      const scalar_t currentFlipInterpParam1 =
          getElementValue(
              workspace,
              SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_PARAM1_OFFSET,
              element.slot);
      const scalar_t currentFlipInterpParam2 =
          getElementValue(
              workspace,
              SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_PARAM2_OFFSET,
              element.slot);
      const scalar_t currentFlipInterpParam3 =
          getElementValue(
              workspace,
              SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_PARAM3_OFFSET,
              element.slot);
      scalar_t flipInterpDuration = currentFlipInterpDuration;
      scalar_t flipInterpMode = currentFlipInterpMode;
      scalar_t flipInterpEasing = currentFlipInterpEasing;
      scalar_t flipInterpParam0 = currentFlipInterpParam0;
      scalar_t flipInterpParam1 = currentFlipInterpParam1;
      scalar_t flipInterpParam2 = currentFlipInterpParam2;
      scalar_t flipInterpParam3 = currentFlipInterpParam3;
      if (update.data.autoDirection.interpolationClear) {
        flipInterpDuration = static_cast<scalar_t>(0.0f);
        flipInterpMode = static_cast<scalar_t>(INTERPOLATION_MODE_FEEDBACK);
        flipInterpEasing = static_cast<scalar_t>(INTERPOLATION_EASING_LINEAR);
        flipInterpParam0 = static_cast<scalar_t>(0.0f);
        flipInterpParam1 = static_cast<scalar_t>(0.0f);
        flipInterpParam2 = static_cast<scalar_t>(0.0f);
        flipInterpParam3 = static_cast<scalar_t>(0.0f);
      } else if (update.data.autoDirection.interpolationHas) {
        flipInterpDuration =
            isFiniteScalar(update.data.autoDirection.interpolationDuration) &&
                    update.data.autoDirection.interpolationDuration >
                        static_cast<scalar_t>(0.0f)
                ? update.data.autoDirection.interpolationDuration
                : static_cast<scalar_t>(0.0f);
        flipInterpMode = update.data.autoDirection.interpolationMode;
        flipInterpEasing = update.data.autoDirection.interpolationEasing;
        flipInterpParam0 = update.data.autoDirection.interpolationParam0;
        flipInterpParam1 = update.data.autoDirection.interpolationParam1;
        flipInterpParam2 = update.data.autoDirection.interpolationParam2;
        flipInterpParam3 = update.data.autoDirection.interpolationParam3;
      }
      setAutoDirectionConfig(
          workspace,
          element.slot,
          resolvedSpace,
          resolvedMode,
          resolvedShiftAngleRotation,
          resolvedMinDistance,
          resolvedFlipXEnabled,
          resolvedFlipYEnabled,
          flipInterpDuration,
          flipInterpMode,
          flipInterpEasing,
          flipInterpParam0,
          flipInterpParam1,
          flipInterpParam2,
          flipInterpParam3);
      const bool observationConfigChanged =
          resolvedSpace != currentSpace ||
          resolvedMode != currentMode ||
          resolvedShiftAngleRotation != currentShiftAngleRotation ||
          std::abs(resolvedMinDistance - currentMinDistance) >
              static_cast<scalar_t>(1.0e-4f);
      if (observationConfigChanged) {
        const scalar_t currentRotate =
            getElementValue(workspace, SPRITE_ELEMENT_ROTATE_DEG_OFFSET, element.slot);
        const scalar_t currentShiftAngle =
            getElementValue(
                workspace,
                SPRITE_ELEMENT_SHIFT_ANGLE_DEG_OFFSET,
                element.slot);
        resetAutoDirectionRuntimeState(
            workspace,
            element.slot,
            currentRotate,
            currentShiftAngle);
      }
    }
  }

  if (pivotDirty) {
    markPivotDirty(workspace, element.slot);
  }
  return true;
}

static inline bool applyAddSprite(
    CommandContext &context,
    const scalar_t *command,
    scalar_t nowMs,
    std::vector<scalar_t> &results) {
  // Add-sprite allocates dense SoA slots first, then materializes every element
  // through the same placement path used by later updates.
  const int elementCount =
      static_cast<int>(command[COMMAND_ADD_SPRITE_ELEMENT_COUNT_OFFSET]);
  if (elementCount < 0 || elementCount > WASM_MAX_ELEMENTS_PER_SPRITE) {
    return false;
  }

  const ValueCommand sx =
      readValueCommand(command, COMMAND_ADD_SPRITE_SX_HAS_OFFSET);
  const ValueCommand sy =
      readValueCommand(command, COMMAND_ADD_SPRITE_SY_HAS_OFFSET);
  const OptionalCommand sz =
      readOptionalCommand(command, COMMAND_ADD_SPRITE_SZ_HAS_OFFSET);
  const ValueCommand opacity =
      readValueCommand(command, COMMAND_ADD_SPRITE_OPACITY_HAS_OFFSET);
  const OptionalCommand visibilityDistance =
      readOptionalCommand(
          command,
          COMMAND_ADD_SPRITE_VISIBILITY_DISTANCE_HAS_OFFSET);

  if (!sx.has || !sy.has) {
    return false;
  }

  scalar_t sxValue = 0.0f;
  scalar_t syValue = 0.0f;
  if (!normalizeFinitePosition(sx.value, sxValue) ||
      !normalizeFinitePosition(sy.value, syValue)) {
    return normalizeFailure();
  }

  scalar_t szValue = 0.0f;
  if (sz.has && !normalizeFinitePosition(sz.value, szValue)) {
    return normalizeFailure();
  }

  scalar_t opacityValue = 1.0f;
  if (opacity.has) {
    if (!normalizeOpacityValue(opacity.value, opacityValue)) {
      return normalizeFailure();
    }
  }
  scalar_t visibilityDistanceValue = static_cast<scalar_t>(0.0f);
  if (!resolveVisibilityDistanceCommand(
          visibilityDistance,
          visibilityDistanceValue)) {
    return normalizeFailure();
  }

  std::vector<ElementCommandData> elements;
  elements.reserve(static_cast<size_t>(elementCount));
  for (int index = 0; index < elementCount; ++index) {
    const int elementBase =
        COMMAND_ADD_SPRITE_ELEMENT_BASE_OFFSET +
        index * COMMAND_ELEMENT_FIELDS;
    elements.push_back(readElementCommand(command, elementBase));
  }

  std::vector<int> originLocationIndices;
  originLocationIndices.reserve(static_cast<size_t>(elementCount));
  for (int index = 0; index < elementCount; ++index) {
    const auto &data = elements[static_cast<size_t>(index)];
    int originLocationIndex = -1;
    if (data.present && data.originLocationProvided) {
      originLocationIndex = data.originLocationIndex;
    }
    if (originLocationIndex < -1 || originLocationIndex >= WASM_MAX_ELEMENTS_PER_SPRITE) {
      return false;
    }
    originLocationIndices.push_back(originLocationIndex);
  }
  if (!validateCircularOriginLocationReference(originLocationIndices)) {
    return false;
  }
  for (int index = 0; index < elementCount; ++index) {
    if (!validateElementPlacementData(
            elements[static_cast<size_t>(index)],
            elementCount)) {
      return false;
    }
  }

  auto &workspace = context.workspace;
  const int spriteSlot = static_cast<int>(context.sprites.size());
  const int elementSlotStart = workspace.elementCount;
  workspace.prepare(
      spriteSlot + 1,
      elementSlotStart + elementCount,
      workspace.polylineCount,
      workspace.polylineNodeCount,
      context.debugEntryEnabled);

  SpriteMeta sprite{spriteSlot, {}};
  sprite.elements.reserve(static_cast<size_t>(elementCount));
  for (int index = 0; index < elementCount; ++index) {
    const int slot = elementSlotStart + index;
    sprite.elements.push_back(ElementMeta{slot, originLocationIndices[static_cast<size_t>(index)]});
    initializeElementDefaults(context, slot, spriteSlot);
  }

  context.sprites.push_back(sprite);
  workspace.spriteCount = static_cast<int>(context.sprites.size());

  setSpriteValue(workspace, SPRITE_Z_OFFSET, spriteSlot, szValue);
  setSpriteValue(
      workspace,
      SPRITE_VISIBILITY_DISTANCE_OFFSET,
      spriteSlot,
      visibilityDistanceValue);
  setSpriteValue(
      workspace,
      SPRITE_LOD_VISIBLE_OFFSET,
      spriteSlot,
      static_cast<scalar_t>(1.0f));
  resetSpriteInterpolation(workspace, spriteSlot, SPRITE_SX_FIELD, 0.0f);
  resetSpriteInterpolation(workspace, spriteSlot, SPRITE_SY_FIELD, 0.0f);
  resetSpriteInterpolation(workspace, spriteSlot, SPRITE_OPACITY_FIELD, 1.0f);
  resetSpriteInterpolation(
      workspace,
      spriteSlot,
      SPRITE_RENDER_OPACITY_FIELD,
      static_cast<scalar_t>(1.0f));
  applySpriteInterpolation(workspace, spriteSlot, SPRITE_SX_FIELD, sx, sxValue, nowMs);
  applySpriteInterpolation(workspace, spriteSlot, SPRITE_SY_FIELD, sy, syValue, nowMs);
  applySpriteInterpolation(
      workspace,
      spriteSlot,
      SPRITE_OPACITY_FIELD,
      opacity,
      opacityValue,
      nowMs);
  applySpriteRenderOpacityCommand(
      workspace,
      spriteSlot,
      opacity,
      static_cast<scalar_t>(1.0f),
      nowMs);

  for (int index = 0; index < elementCount; ++index) {
    if (!applyElementPlacement(
            context,
            context.sprites.back(),
            index,
            elements[static_cast<size_t>(index)],
            nowMs)) {
      return false;
    }
  }

  const scalar_t resultIndexRaw =
      command[COMMAND_ADD_SPRITE_RESULT_INDEX_OFFSET];
  int resultIndex = -1;
  if (toIntScalar(resultIndexRaw, resultIndex) && resultIndex >= 0) {
    if (resultIndex >= static_cast<int>(results.size())) {
      results.resize(static_cast<size_t>(resultIndex + 1), std::numeric_limits<scalar_t>::quiet_NaN());
    }
    results[static_cast<size_t>(resultIndex)] = static_cast<scalar_t>(spriteSlot);
  }

  return true;
}

/**
 * @brief Applies an add-polyline command and appends nodes into the dense node buffer.
 */
static inline bool applyAddPolyline(
    CommandContext &context,
    const scalar_t *command,
    scalar_t nowMs,
    std::vector<scalar_t> &results) {
  const int nodeCount =
      static_cast<int>(command[COMMAND_ADD_POLYLINE_NODE_COUNT_OFFSET]);
  if (nodeCount < 2) {
    return false;
  }

  const OptionalCommand layer =
      readOptionalCommand(command, COMMAND_ADD_POLYLINE_LAYER_HAS_OFFSET);
  const ValueCommand opacity =
      readValueCommand(command, COMMAND_ADD_POLYLINE_OPACITY_HAS_OFFSET);

  int layerValue = 0;
  if (layer.has && !normalizeLayerValue(layer.value, layerValue)) {
    return normalizeFailure();
  }

  scalar_t opacityValue = static_cast<scalar_t>(1.0f);
  if (opacity.has && !normalizeOpacityValue(opacity.value, opacityValue)) {
    return normalizeFailure();
  }

  scalar_t color0R = 0.0f;
  scalar_t color0G = 0.0f;
  scalar_t color0B = 0.0f;
  scalar_t color0A = 1.0f;
  scalar_t color1R = 0.0f;
  scalar_t color1G = 0.0f;
  scalar_t color1B = 0.0f;
  scalar_t color1A = 1.0f;
  scalar_t repeatLength = static_cast<scalar_t>(0.0f);
  int joinCorrectionMode = POLYLINE_CORRECTION_MODE_FAN;
  int joinCorrectionIntermediatePointCount = 0;
  int capCorrectionMode = POLYLINE_CORRECTION_MODE_NONE;
  int capCorrectionPointCount = 0;

  if (!normalizeColorValue(
          command[COMMAND_ADD_POLYLINE_COLOR0_R_OFFSET], color0R) ||
      !normalizeColorValue(
          command[COMMAND_ADD_POLYLINE_COLOR0_G_OFFSET], color0G) ||
      !normalizeColorValue(
          command[COMMAND_ADD_POLYLINE_COLOR0_B_OFFSET], color0B) ||
      !normalizeColorValue(
          command[COMMAND_ADD_POLYLINE_COLOR0_A_OFFSET], color0A) ||
      !normalizeColorValue(
          command[COMMAND_ADD_POLYLINE_COLOR1_R_OFFSET], color1R) ||
      !normalizeColorValue(
          command[COMMAND_ADD_POLYLINE_COLOR1_G_OFFSET], color1G) ||
      !normalizeColorValue(
          command[COMMAND_ADD_POLYLINE_COLOR1_B_OFFSET], color1B) ||
      !normalizeColorValue(
          command[COMMAND_ADD_POLYLINE_COLOR1_A_OFFSET], color1A) ||
      !normalizeRepeatLengthValue(
          command[COMMAND_ADD_POLYLINE_REPEAT_LENGTH_OFFSET], repeatLength) ||
      !normalizePolylineCorrectionMode(
          command[COMMAND_ADD_POLYLINE_JOIN_CORRECTION_MODE_OFFSET],
          joinCorrectionMode) ||
      !normalizePolylineJoinIntermediatePointCount(
          command[COMMAND_ADD_POLYLINE_JOIN_CORRECTION_INTERMEDIATE_POINT_COUNT_OFFSET],
          joinCorrectionIntermediatePointCount) ||
      !normalizePolylineCorrectionMode(
          command[COMMAND_ADD_POLYLINE_CAP_CORRECTION_MODE_OFFSET],
          capCorrectionMode) ||
      !normalizePolylineCapPointCount(
          command[COMMAND_ADD_POLYLINE_CAP_CORRECTION_POINT_COUNT_OFFSET],
          capCorrectionPointCount)) {
    return normalizeFailure();
  }
  if (joinCorrectionMode == POLYLINE_CORRECTION_MODE_NONE) {
    joinCorrectionIntermediatePointCount = 0;
  }
  if (capCorrectionMode == POLYLINE_CORRECTION_MODE_NONE) {
    capCorrectionPointCount = 0;
  } else if (capCorrectionPointCount < 1) {
    return normalizeFailure();
  }

  std::vector<scalar_t> nodeX;
  std::vector<scalar_t> nodeY;
  std::vector<scalar_t> nodeThickness;
  nodeX.reserve(static_cast<size_t>(nodeCount));
  nodeY.reserve(static_cast<size_t>(nodeCount));
  nodeThickness.reserve(static_cast<size_t>(nodeCount));
  for (int i = 0; i < nodeCount; ++i) {
    const int baseOffset =
        COMMAND_ADD_POLYLINE_NODE_BASE_OFFSET +
        i * COMMAND_POLYLINE_NODE_FIELDS;
    scalar_t xValue = 0.0f;
    scalar_t yValue = 0.0f;
    scalar_t thicknessValue = 0.0f;
    if (!normalizeFinitePosition(
            command[baseOffset + COMMAND_POLYLINE_NODE_X_OFFSET], xValue) ||
        !normalizeFinitePosition(
            command[baseOffset + COMMAND_POLYLINE_NODE_Y_OFFSET], yValue) ||
        !normalizeThicknessValue(
            command[baseOffset + COMMAND_POLYLINE_NODE_THICKNESS_OFFSET],
            thicknessValue)) {
      return normalizeFailure();
    }
    nodeX.push_back(xValue);
    nodeY.push_back(yValue);
    nodeThickness.push_back(thicknessValue);
  }

  auto &workspace = context.workspace;
  const int polylineSlot = static_cast<int>(context.polylines.size());
  const int nodeOffset = workspace.polylineNodeCount;
  workspace.prepare(
      workspace.spriteCount,
      workspace.elementCount,
      polylineSlot + 1,
      nodeOffset + nodeCount,
      context.debugEntryEnabled);

  PolylineMeta polylineMeta{polylineSlot, nodeOffset, nodeCount};
  context.polylines.push_back(polylineMeta);

  setPolylineValue(
      workspace,
      POLYLINE_LAYER_OFFSET,
      polylineSlot,
      static_cast<scalar_t>(layerValue));
  resetPolylineInterpolation(workspace, polylineSlot, POLYLINE_OPACITY_FIELD, 1.0f);
  if (opacity.has) {
    applyPolylineInterpolation(
        workspace,
        polylineSlot,
        POLYLINE_OPACITY_FIELD,
        opacity,
        opacityValue,
        nowMs);
  }

  setPolylineValue(workspace, POLYLINE_COLOR0_R_OFFSET, polylineSlot, color0R);
  setPolylineValue(workspace, POLYLINE_COLOR0_G_OFFSET, polylineSlot, color0G);
  setPolylineValue(workspace, POLYLINE_COLOR0_B_OFFSET, polylineSlot, color0B);
  setPolylineValue(workspace, POLYLINE_COLOR0_A_OFFSET, polylineSlot, color0A);
  setPolylineValue(workspace, POLYLINE_COLOR1_R_OFFSET, polylineSlot, color1R);
  setPolylineValue(workspace, POLYLINE_COLOR1_G_OFFSET, polylineSlot, color1G);
  setPolylineValue(workspace, POLYLINE_COLOR1_B_OFFSET, polylineSlot, color1B);
  setPolylineValue(workspace, POLYLINE_COLOR1_A_OFFSET, polylineSlot, color1A);
  setPolylineValue(
      workspace,
      POLYLINE_REPEAT_LENGTH_OFFSET,
      polylineSlot,
      repeatLength);
  setPolylineValue(
      workspace,
      POLYLINE_JOIN_CORRECTION_MODE_OFFSET,
      polylineSlot,
      static_cast<scalar_t>(joinCorrectionMode));
  setPolylineValue(
      workspace,
      POLYLINE_JOIN_CORRECTION_INTERMEDIATE_POINT_COUNT_OFFSET,
      polylineSlot,
      static_cast<scalar_t>(joinCorrectionIntermediatePointCount));
  setPolylineValue(
      workspace,
      POLYLINE_CAP_CORRECTION_MODE_OFFSET,
      polylineSlot,
      static_cast<scalar_t>(capCorrectionMode));
  setPolylineValue(
      workspace,
      POLYLINE_CAP_CORRECTION_POINT_COUNT_OFFSET,
      polylineSlot,
      static_cast<scalar_t>(capCorrectionPointCount));
  setPolylineValue(
      workspace,
      POLYLINE_NODE_OFFSET_OFFSET,
      polylineSlot,
      static_cast<scalar_t>(nodeOffset));
  setPolylineValue(
      workspace,
      POLYLINE_NODE_COUNT_OFFSET,
      polylineSlot,
      static_cast<scalar_t>(nodeCount));

  for (int i = 0; i < nodeCount; ++i) {
    const int nodeIndex = nodeOffset + i;
    workspace.polylineNodeInputBuffer[static_cast<size_t>(POLYLINE_NODE_X_OFFSET) *
        static_cast<size_t>(workspace.polylineNodeCapacity) +
        static_cast<size_t>(nodeIndex)] = nodeX[static_cast<size_t>(i)];
    workspace.polylineNodeInputBuffer[static_cast<size_t>(POLYLINE_NODE_Y_OFFSET) *
        static_cast<size_t>(workspace.polylineNodeCapacity) +
        static_cast<size_t>(nodeIndex)] = nodeY[static_cast<size_t>(i)];
    workspace.polylineNodeInputBuffer[
        static_cast<size_t>(POLYLINE_NODE_THICKNESS_OFFSET) *
            static_cast<size_t>(workspace.polylineNodeCapacity) +
        static_cast<size_t>(nodeIndex)] = nodeThickness[static_cast<size_t>(i)];
  }

  const scalar_t resultIndexRaw =
      command[COMMAND_ADD_POLYLINE_RESULT_INDEX_OFFSET];
  int resultIndex = -1;
  if (toIntScalar(resultIndexRaw, resultIndex) && resultIndex >= 0) {
    if (resultIndex >= static_cast<int>(results.size())) {
      results.resize(
          static_cast<size_t>(resultIndex + 1),
          std::numeric_limits<scalar_t>::quiet_NaN());
    }
    results[static_cast<size_t>(resultIndex)] =
        static_cast<scalar_t>(polylineSlot);
  }

  return true;
}

/**
 * @brief Applies a sprite update command, including nested element mutations.
 */
static inline bool applyUpdateSprite(
    CommandContext &context,
    const scalar_t *command,
    scalar_t nowMs) {
  int spriteId = -1;
  if (!toIntScalar(command[COMMAND_UPDATE_SPRITE_SPRITE_ID_OFFSET], spriteId) ||
      spriteId < 0 || spriteId >= static_cast<int>(context.sprites.size())) {
    return false;
  }

  const ValueCommand sx =
      readValueCommand(command, COMMAND_UPDATE_SPRITE_SX_HAS_OFFSET);
  const ValueCommand sy =
      readValueCommand(command, COMMAND_UPDATE_SPRITE_SY_HAS_OFFSET);
  const OptionalCommand sz =
      readOptionalCommand(command, COMMAND_UPDATE_SPRITE_SZ_HAS_OFFSET);
  const ValueCommand opacity =
      readValueCommand(command, COMMAND_UPDATE_SPRITE_OPACITY_HAS_OFFSET);
  const OptionalCommand visibilityDistance =
      readOptionalCommand(
          command,
          COMMAND_UPDATE_SPRITE_VISIBILITY_DISTANCE_HAS_OFFSET);
  const int updateElementCount =
      static_cast<int>(command[COMMAND_UPDATE_SPRITE_ELEMENT_UPDATE_COUNT_OFFSET]);
  if (updateElementCount < 0) {
    return false;
  }

  std::vector<ElementUpdateCommand> updates;
  bool requiresSyncSlots = false;
  if (updateElementCount > 0) {
    updates.reserve(static_cast<size_t>(updateElementCount));
    for (int index = 0; index < updateElementCount; ++index) {
      const int baseOffset =
          COMMAND_UPDATE_SPRITE_ELEMENT_BASE_OFFSET +
          index * COMMAND_UPDATE_ELEMENT_FIELDS;
      int elementIndex = -1;
      if (!toIntScalar(
              command[baseOffset + COMMAND_UPDATE_ELEMENT_INDEX_OFFSET],
              elementIndex)) {
        return false;
      }
      const int kind = static_cast<int>(
          command[baseOffset + COMMAND_UPDATE_ELEMENT_KIND_OFFSET]);
      const int dataOffset = baseOffset + COMMAND_UPDATE_ELEMENT_DATA_OFFSET;
      updates.push_back(ElementUpdateCommand{
          elementIndex,
          kind,
          readElementCommand(command, dataOffset),
      });
      if (kind == COMMAND_UPDATE_ELEMENT_KIND_REMOVE) {
        requiresSyncSlots = true;
      }
    }
  }

  std::vector<int> plannedOriginLocations;
  if (!validateElementUpdates(context.sprites[static_cast<size_t>(spriteId)], updates, plannedOriginLocations)) {
    return false;
  }
  scalar_t sxValue = 0.0f;
  if (!validateValueCommand(sx, normalizeFinitePosition)) {
    return normalizeFailure();
  }
  scalar_t syValue = 0.0f;
  if (!validateValueCommand(sy, normalizeFinitePosition)) {
    return normalizeFailure();
  }
  scalar_t opacityValue = static_cast<scalar_t>(1.0f);
  if (!validateValueCommand(opacity, normalizeOpacityValue)) {
    return normalizeFailure();
  }
  scalar_t visibilityDistanceValue = static_cast<scalar_t>(0.0f);
  if (!resolveVisibilityDistanceCommand(
          visibilityDistance,
          visibilityDistanceValue)) {
    return normalizeFailure();
  }
  if (sz.has) {
    scalar_t szValue = 0.0f;
    if (!normalizeFinitePosition(sz.value, szValue)) {
      return normalizeFailure();
    }
  }
  for (const auto &update : updates) {
    if (!validateElementUpdateData(
            context.sprites[static_cast<size_t>(spriteId)],
            update)) {
      return false;
    }
  }

  auto &workspace = context.workspace;
  auto &sprite = context.sprites[static_cast<size_t>(spriteId)];
  const WorkspaceSlotInterpolationTarget spriteTarget{workspace, sprite.slot};
  bool spriteBaseUpdated = false;
  bool spriteOpacityUpdated = false;
  const scalar_t currentVisibilityMultiplier =
      getSpriteValue(workspace, SPRITE_LOD_VISIBLE_OFFSET, sprite.slot) >
              static_cast<scalar_t>(0.0f)
          ? static_cast<scalar_t>(1.0f)
          : static_cast<scalar_t>(0.0f);

  if (!applyScalarInterpolationUpdate<SpriteInterpolationAccessor>(
          spriteTarget,
          SPRITE_SX_FIELD,
          sx,
          nowMs,
          normalizeFinitePosition,
          sxValue,
          spriteBaseUpdated)) {
    return false;
  }
  if (!applyScalarInterpolationUpdate<SpriteInterpolationAccessor>(
          spriteTarget,
          SPRITE_SY_FIELD,
          sy,
          nowMs,
          normalizeFinitePosition,
          syValue,
          spriteBaseUpdated)) {
    return false;
  }
  if (!applyScalarInterpolationUpdate<SpriteInterpolationAccessor>(
          spriteTarget,
          SPRITE_OPACITY_FIELD,
          opacity,
          nowMs,
          normalizeOpacityValue,
          opacityValue,
          spriteOpacityUpdated)) {
    return false;
  }
  if (spriteOpacityUpdated) {
    applySpriteRenderOpacityCommand(
        workspace,
        sprite.slot,
        opacity,
        currentVisibilityMultiplier,
        nowMs);
    for (const auto &element : sprite.elements) {
      if (getElementValue(
              workspace,
              SPRITE_ELEMENT_OPACITY_CONFIG_DURATION_OFFSET,
              element.slot) <= static_cast<scalar_t>(0.0f)) {
        continue;
      }
      recomputeElementRenderOpacityTargetFromBase(
          workspace,
          sprite.slot,
          element.slot,
          currentVisibilityMultiplier,
          nowMs);
    }
  }
  if (sz.has) {
    scalar_t szValue = 0.0f;
    if (!normalizeFinitePosition(sz.value, szValue)) {
      return normalizeFailure();
    }
    setSpriteValue(workspace, SPRITE_Z_OFFSET, sprite.slot, szValue);
  }
  if (visibilityDistance.has) {
    setSpriteValue(
        workspace,
        SPRITE_VISIBILITY_DISTANCE_OFFSET,
        sprite.slot,
        visibilityDistanceValue);
  }

  for (const auto &update : updates) {
    if (!applyElementUpdate(context, sprite, update, nowMs)) {
      return false;
    }
  }

  if (spriteBaseUpdated) {
    for (const auto &element : sprite.elements) {
      markPivotResolveDirty(workspace, element.slot);
    }
  }

  if (requiresSyncSlots) {
    syncElementOwnerAndOriginLocationSlots(context);
  }
  return true;
}

/**
 * @brief Applies a polyline update command, optionally replacing its node range.
 */
static inline bool applyUpdatePolyline(
    CommandContext &context,
    const scalar_t *command,
    scalar_t nowMs) {
  int polylineId = -1;
  if (!toIntScalar(command[COMMAND_UPDATE_POLYLINE_POLYLINE_ID_OFFSET], polylineId) ||
      polylineId < 0 || polylineId >= static_cast<int>(context.polylines.size())) {
    return false;
  }

  const int nodeCount =
      static_cast<int>(command[COMMAND_UPDATE_POLYLINE_NODE_COUNT_OFFSET]);
  const bool hasNodes = nodeCount >= 0;
  if (hasNodes && nodeCount < 2) {
    return false;
  }

  const OptionalCommand layer =
      readOptionalCommand(command, COMMAND_UPDATE_POLYLINE_LAYER_HAS_OFFSET);
  const ValueCommand opacity =
      readValueCommand(command, COMMAND_UPDATE_POLYLINE_OPACITY_HAS_OFFSET);
  const bool colorProvided =
      command[COMMAND_UPDATE_POLYLINE_COLOR_HAS_OFFSET] != static_cast<scalar_t>(0.0f);
  const bool joinCorrectionProvided =
      command[COMMAND_UPDATE_POLYLINE_JOIN_CORRECTION_HAS_OFFSET] !=
      static_cast<scalar_t>(0.0f);
  const bool capCorrectionProvided =
      command[COMMAND_UPDATE_POLYLINE_CAP_CORRECTION_HAS_OFFSET] !=
      static_cast<scalar_t>(0.0f);
  int layerValue = 0;
  if (layer.has && !normalizeLayerValue(layer.value, layerValue)) {
    return normalizeFailure();
  }
  scalar_t opacityValue = static_cast<scalar_t>(1.0f);
  if (!validateValueCommand(opacity, normalizeOpacityValue)) {
    return normalizeFailure();
  }

  scalar_t color0R = 0.0f;
  scalar_t color0G = 0.0f;
  scalar_t color0B = 0.0f;
  scalar_t color0A = 1.0f;
  scalar_t color1R = 0.0f;
  scalar_t color1G = 0.0f;
  scalar_t color1B = 0.0f;
  scalar_t color1A = 1.0f;
  scalar_t repeatLength = static_cast<scalar_t>(0.0f);
  int joinCorrectionMode = POLYLINE_CORRECTION_MODE_NONE;
  int joinCorrectionIntermediatePointCount = 0;
  int capCorrectionMode = POLYLINE_CORRECTION_MODE_NONE;
  int capCorrectionPointCount = 0;
  if (colorProvided &&
      (!normalizeColorValue(
           command[COMMAND_UPDATE_POLYLINE_COLOR0_R_OFFSET], color0R) ||
       !normalizeColorValue(
           command[COMMAND_UPDATE_POLYLINE_COLOR0_G_OFFSET], color0G) ||
       !normalizeColorValue(
           command[COMMAND_UPDATE_POLYLINE_COLOR0_B_OFFSET], color0B) ||
       !normalizeColorValue(
           command[COMMAND_UPDATE_POLYLINE_COLOR0_A_OFFSET], color0A) ||
       !normalizeColorValue(
           command[COMMAND_UPDATE_POLYLINE_COLOR1_R_OFFSET], color1R) ||
       !normalizeColorValue(
           command[COMMAND_UPDATE_POLYLINE_COLOR1_G_OFFSET], color1G) ||
       !normalizeColorValue(
           command[COMMAND_UPDATE_POLYLINE_COLOR1_B_OFFSET], color1B) ||
       !normalizeColorValue(
           command[COMMAND_UPDATE_POLYLINE_COLOR1_A_OFFSET], color1A) ||
       !normalizeRepeatLengthValue(
           command[COMMAND_UPDATE_POLYLINE_REPEAT_LENGTH_OFFSET], repeatLength))) {
    return normalizeFailure();
  }
  if (joinCorrectionProvided &&
      (!normalizePolylineCorrectionMode(
           command[COMMAND_UPDATE_POLYLINE_JOIN_CORRECTION_MODE_OFFSET],
           joinCorrectionMode) ||
       !normalizePolylineJoinIntermediatePointCount(
           command[COMMAND_UPDATE_POLYLINE_JOIN_CORRECTION_INTERMEDIATE_POINT_COUNT_OFFSET],
           joinCorrectionIntermediatePointCount))) {
    return normalizeFailure();
  }
  if (capCorrectionProvided &&
      (!normalizePolylineCorrectionMode(
           command[COMMAND_UPDATE_POLYLINE_CAP_CORRECTION_MODE_OFFSET],
           capCorrectionMode) ||
       !normalizePolylineCapPointCount(
           command[COMMAND_UPDATE_POLYLINE_CAP_CORRECTION_POINT_COUNT_OFFSET],
           capCorrectionPointCount))) {
    return normalizeFailure();
  }
  if (joinCorrectionProvided &&
      joinCorrectionMode == POLYLINE_CORRECTION_MODE_NONE) {
    joinCorrectionIntermediatePointCount = 0;
  }
  if (capCorrectionProvided) {
    if (capCorrectionMode == POLYLINE_CORRECTION_MODE_NONE) {
      capCorrectionPointCount = 0;
    } else if (capCorrectionPointCount < 1) {
      return normalizeFailure();
    }
  }

  std::vector<scalar_t> nodeX;
  std::vector<scalar_t> nodeY;
  std::vector<scalar_t> nodeThickness;
  if (hasNodes) {
    nodeX.reserve(static_cast<size_t>(nodeCount));
    nodeY.reserve(static_cast<size_t>(nodeCount));
    nodeThickness.reserve(static_cast<size_t>(nodeCount));
    for (int i = 0; i < nodeCount; ++i) {
      const int baseOffset =
          COMMAND_UPDATE_POLYLINE_NODE_BASE_OFFSET +
          i * COMMAND_POLYLINE_NODE_FIELDS;
      scalar_t xValue = 0.0f;
      scalar_t yValue = 0.0f;
      scalar_t thicknessValue = 0.0f;
      if (!normalizeFinitePosition(
              command[baseOffset + COMMAND_POLYLINE_NODE_X_OFFSET], xValue) ||
          !normalizeFinitePosition(
              command[baseOffset + COMMAND_POLYLINE_NODE_Y_OFFSET], yValue) ||
          !normalizeThicknessValue(
              command[baseOffset + COMMAND_POLYLINE_NODE_THICKNESS_OFFSET],
              thicknessValue)) {
        return normalizeFailure();
      }
      nodeX.push_back(xValue);
      nodeY.push_back(yValue);
      nodeThickness.push_back(thicknessValue);
    }
  }

  auto &workspace = context.workspace;
  auto &polylineMeta = context.polylines[static_cast<size_t>(polylineId)];
  const WorkspaceSlotInterpolationTarget polylineTarget{workspace, polylineMeta.slot};

  if (layer.has) {
    setPolylineValue(
        workspace,
        POLYLINE_LAYER_OFFSET,
        polylineMeta.slot,
        static_cast<scalar_t>(layerValue));
  }

  if (!applyScalarInterpolationUpdateIgnore<PolylineInterpolationAccessor>(
          polylineTarget,
          POLYLINE_OPACITY_FIELD,
          opacity,
          nowMs,
          normalizeOpacityValue,
          opacityValue)) {
    return false;
  }

  if (colorProvided) {
    setPolylineValue(
        workspace,
        POLYLINE_COLOR0_R_OFFSET,
        polylineMeta.slot,
        color0R);
    setPolylineValue(
        workspace,
        POLYLINE_COLOR0_G_OFFSET,
        polylineMeta.slot,
        color0G);
    setPolylineValue(
        workspace,
        POLYLINE_COLOR0_B_OFFSET,
        polylineMeta.slot,
        color0B);
    setPolylineValue(
        workspace,
        POLYLINE_COLOR0_A_OFFSET,
        polylineMeta.slot,
        color0A);
    setPolylineValue(
        workspace,
        POLYLINE_COLOR1_R_OFFSET,
        polylineMeta.slot,
        color1R);
    setPolylineValue(
        workspace,
        POLYLINE_COLOR1_G_OFFSET,
        polylineMeta.slot,
        color1G);
    setPolylineValue(
        workspace,
        POLYLINE_COLOR1_B_OFFSET,
        polylineMeta.slot,
        color1B);
    setPolylineValue(
        workspace,
        POLYLINE_COLOR1_A_OFFSET,
        polylineMeta.slot,
        color1A);
    setPolylineValue(
        workspace,
        POLYLINE_REPEAT_LENGTH_OFFSET,
        polylineMeta.slot,
        repeatLength);
  }
  if (joinCorrectionProvided) {
    setPolylineValue(
        workspace,
        POLYLINE_JOIN_CORRECTION_MODE_OFFSET,
        polylineMeta.slot,
        static_cast<scalar_t>(joinCorrectionMode));
    setPolylineValue(
        workspace,
        POLYLINE_JOIN_CORRECTION_INTERMEDIATE_POINT_COUNT_OFFSET,
        polylineMeta.slot,
        static_cast<scalar_t>(joinCorrectionIntermediatePointCount));
  }
  if (capCorrectionProvided) {
    setPolylineValue(
        workspace,
        POLYLINE_CAP_CORRECTION_MODE_OFFSET,
        polylineMeta.slot,
        static_cast<scalar_t>(capCorrectionMode));
    setPolylineValue(
        workspace,
        POLYLINE_CAP_CORRECTION_POINT_COUNT_OFFSET,
        polylineMeta.slot,
        static_cast<scalar_t>(capCorrectionPointCount));
  }

  if (hasNodes) {
    const int removedOffset = polylineMeta.nodeOffset;
    const int removedCount = polylineMeta.nodeCount;
    if (removedCount > 0) {
      removePolylineNodeRange(context, removedOffset, removedCount);
      shiftPolylineNodeOffsets(context, removedOffset, removedCount);
    }

    const int newOffset = workspace.polylineNodeCount;
    workspace.prepare(
        workspace.spriteCount,
        workspace.elementCount,
        workspace.polylineCount,
        newOffset + nodeCount,
        context.debugEntryEnabled);

    polylineMeta.nodeOffset = newOffset;
    polylineMeta.nodeCount = nodeCount;
    setPolylineValue(
        workspace,
        POLYLINE_NODE_OFFSET_OFFSET,
        polylineMeta.slot,
        static_cast<scalar_t>(newOffset));
    setPolylineValue(
        workspace,
        POLYLINE_NODE_COUNT_OFFSET,
        polylineMeta.slot,
        static_cast<scalar_t>(nodeCount));

    for (int i = 0; i < nodeCount; ++i) {
      const int nodeIndex = newOffset + i;
      workspace.polylineNodeInputBuffer[static_cast<size_t>(POLYLINE_NODE_X_OFFSET) *
          static_cast<size_t>(workspace.polylineNodeCapacity) +
          static_cast<size_t>(nodeIndex)] = nodeX[static_cast<size_t>(i)];
      workspace.polylineNodeInputBuffer[static_cast<size_t>(POLYLINE_NODE_Y_OFFSET) *
          static_cast<size_t>(workspace.polylineNodeCapacity) +
          static_cast<size_t>(nodeIndex)] = nodeY[static_cast<size_t>(i)];
      workspace.polylineNodeInputBuffer[
          static_cast<size_t>(POLYLINE_NODE_THICKNESS_OFFSET) *
              static_cast<size_t>(workspace.polylineNodeCapacity) +
          static_cast<size_t>(nodeIndex)] = nodeThickness[static_cast<size_t>(i)];
    }
  }

  return true;
}

/**
 * @brief Removes one sprite and all of its elements from the dense workspace.
 */
static inline bool applyRemoveSprite(CommandContext &context, const scalar_t *command) {
  int spriteId = -1;
  if (!toIntScalar(command[COMMAND_REMOVE_SPRITE_SPRITE_ID_OFFSET], spriteId) ||
      spriteId < 0 || spriteId >= static_cast<int>(context.sprites.size())) {
    return false;
  }

  auto &sprite = context.sprites[static_cast<size_t>(spriteId)];
  std::vector<int> removedSlots;
  removedSlots.reserve(sprite.elements.size());
  for (const auto &element : sprite.elements) {
    removedSlots.push_back(element.slot);
  }
  std::sort(removedSlots.begin(), removedSlots.end(), std::greater<int>());
  for (const int slot : removedSlots) {
    removeElementSlotBySlotIndex(context, slot);
  }
  context.sprites.erase(context.sprites.begin() + spriteId);
  for (size_t index = 0; index < context.sprites.size(); ++index) {
    context.sprites[index].slot = static_cast<int>(index);
  }
  removeSpriteSlotBySlotIndex(context, spriteId);
  syncElementOwnerAndOriginLocationSlots(context);
  return true;
}

/**
 * @brief Removes one polyline and compacts the dense polyline/node buffers.
 */
static inline bool applyRemovePolyline(CommandContext &context, const scalar_t *command) {
  int polylineId = -1;
  if (!toIntScalar(command[COMMAND_REMOVE_POLYLINE_POLYLINE_ID_OFFSET], polylineId) ||
      polylineId < 0 || polylineId >= static_cast<int>(context.polylines.size())) {
    return false;
  }

  auto &polylineMeta = context.polylines[static_cast<size_t>(polylineId)];
  const int removedOffset = polylineMeta.nodeOffset;
  const int removedCount = polylineMeta.nodeCount;
  if (removedCount > 0) {
    removePolylineNodeRange(context, removedOffset, removedCount);
  }
  context.polylines.erase(context.polylines.begin() + polylineId);
  for (size_t index = 0; index < context.polylines.size(); ++index) {
    context.polylines[index].slot = static_cast<int>(index);
  }
  removePolylineSlotBySlotIndex(context, polylineId);
  if (removedCount > 0) {
    shiftPolylineNodeOffsets(context, removedOffset, removedCount);
  }
  return true;
}

/**
 * @brief Applies direct camera property updates from a command payload.
 */
static inline bool applyUpdateCamera(
    CommandContext &context,
    const scalar_t *command,
    scalar_t nowMs) {
  scalar_t *camera = context.cameraBuffer.data();
  const CameraInterpolationTarget cameraTarget{camera};
  scalar_t fovY = camera[CAMERA_FOV_Y_OFFSET];
  scalar_t near = camera[CAMERA_NEAR_OFFSET];
  scalar_t far = camera[CAMERA_FAR_OFFSET];
  scalar_t aspectRatio = camera[CAMERA_VIEWPORT_ASPECT_OFFSET];
  bool changed = false;

  const ValueCommand posX =
      readValueCommand(command, COMMAND_UPDATE_CAMERA_POSITION_X_HAS_OFFSET);
  const ValueCommand posY =
      readValueCommand(command, COMMAND_UPDATE_CAMERA_POSITION_Y_HAS_OFFSET);
  const ValueCommand posZ =
      readValueCommand(command, COMMAND_UPDATE_CAMERA_POSITION_Z_HAS_OFFSET);
  const ValueCommand yaw =
      readValueCommand(command, COMMAND_UPDATE_CAMERA_ROTATION_YAW_HAS_OFFSET);
  const ValueCommand pitch =
      readValueCommand(command, COMMAND_UPDATE_CAMERA_ROTATION_PITCH_HAS_OFFSET);
  const ValueCommand roll =
      readValueCommand(command, COMMAND_UPDATE_CAMERA_ROTATION_ROLL_HAS_OFFSET);
  const ValueCommand fov =
      readValueCommand(command, COMMAND_UPDATE_CAMERA_FOV_Y_HAS_OFFSET);

  scalar_t posXValue = 0.0f;
  if (!applyScalarInterpolationUpdate<CameraInterpolationAccessor>(
          cameraTarget,
          CAMERA_POSITION_X_FIELD,
          posX,
          nowMs,
          normalizeFinitePosition,
          posXValue,
          changed)) {
    return false;
  }
  scalar_t posYValue = 0.0f;
  if (!applyScalarInterpolationUpdate<CameraInterpolationAccessor>(
          cameraTarget,
          CAMERA_POSITION_Y_FIELD,
          posY,
          nowMs,
          normalizeFinitePosition,
          posYValue,
          changed)) {
    return false;
  }
  scalar_t posZValue = 0.0f;
  if (!applyScalarInterpolationUpdate<CameraInterpolationAccessor>(
          cameraTarget,
          CAMERA_POSITION_Z_FIELD,
          posZ,
          nowMs,
          normalizeFinitePosition,
          posZValue,
          changed)) {
    return false;
  }
  scalar_t yawValue = 0.0f;
  if (!applyScalarInterpolationUpdate<CameraInterpolationAccessor>(
          cameraTarget,
          CAMERA_ROTATION_YAW_FIELD,
          yaw,
          nowMs,
          normalizeFinitePosition,
          yawValue,
          changed)) {
    return false;
  }
  scalar_t pitchValue = 0.0f;
  if (!applyScalarInterpolationUpdate<CameraInterpolationAccessor>(
          cameraTarget,
          CAMERA_ROTATION_PITCH_FIELD,
          pitch,
          nowMs,
          normalizeFinitePosition,
          pitchValue,
          changed)) {
    return false;
  }
  scalar_t rollValue = 0.0f;
  if (!applyScalarInterpolationUpdate<CameraInterpolationAccessor>(
          cameraTarget,
          CAMERA_ROTATION_ROLL_FIELD,
          roll,
          nowMs,
          normalizeFinitePosition,
          rollValue,
          changed)) {
    return false;
  }
  scalar_t fovTarget = fovY;
  if (!applyScalarInterpolationUpdate<CameraInterpolationAccessor>(
          cameraTarget,
          CAMERA_FOV_Y_FIELD,
          fov,
          nowMs,
          [](scalar_t value, scalar_t &out) -> bool {
            if (!isFiniteScalar(value)) {
              return false;
            }
            out = value;
            return true;
          },
          fovTarget,
          changed)) {
    return false;
  }
  if (command[COMMAND_UPDATE_CAMERA_NEAR_HAS_OFFSET] !=
      static_cast<scalar_t>(0.0f)) {
    near = command[COMMAND_UPDATE_CAMERA_NEAR_VALUE_OFFSET];
    if (!isFiniteScalar(near)) {
      return false;
    }
    changed = true;
  }
  if (command[COMMAND_UPDATE_CAMERA_FAR_HAS_OFFSET] !=
      static_cast<scalar_t>(0.0f)) {
    far = command[COMMAND_UPDATE_CAMERA_FAR_VALUE_OFFSET];
    if (!isFiniteScalar(far)) {
      return false;
    }
    changed = true;
  }
  if (command[COMMAND_UPDATE_CAMERA_VIEWPORT_ASPECT_HAS_OFFSET] !=
      static_cast<scalar_t>(0.0f)) {
    aspectRatio = command[COMMAND_UPDATE_CAMERA_VIEWPORT_ASPECT_VALUE_OFFSET];
    if (!isFiniteScalar(aspectRatio)) {
      return false;
    }
    changed = true;
  }

  if (!(fovTarget > static_cast<scalar_t>(0.0f) &&
        fovTarget < static_cast<scalar_t>(180.0f))) {
    return false;
  }
  if (!(near > static_cast<scalar_t>(0.0f) && far > near)) {
    return false;
  }
  if (!(aspectRatio > static_cast<scalar_t>(0.0f))) {
    return false;
  }

  if (!changed) {
    return true;
  }

  camera[CAMERA_NEAR_OFFSET] = near;
  camera[CAMERA_FAR_OFFSET] = far;
  camera[CAMERA_VIEWPORT_ASPECT_OFFSET] = aspectRatio;
  camera[CAMERA_PROJECTION_DIRTY_OFFSET] = static_cast<scalar_t>(1.0f);
  return true;
}

/**
 * @brief Adjusts camera position to frame the current scene bounds.
 * @remarks The command can also retarget pitch, FOV, and clip planes while
 * preserving the same interpolation machinery used by direct camera updates.
 */
static inline bool applyAdjustCameraPosition(
    CommandContext &context,
    const scalar_t *command,
    scalar_t nowMs) {
  scalar_t *camera = context.cameraBuffer.data();
  const CameraInterpolationTarget cameraTarget{camera};

  ValueCommand pitch =
      readValueCommand(command, COMMAND_ADJUST_CAMERA_POSITION_PITCH_HAS_OFFSET);
  ValueCommand fov =
      readValueCommand(command, COMMAND_ADJUST_CAMERA_POSITION_FOV_Y_HAS_OFFSET);
  const OptionalCommand nearCommand =
      readOptionalCommand(command, COMMAND_ADJUST_CAMERA_POSITION_NEAR_HAS_OFFSET);
  const OptionalCommand farCommand =
      readOptionalCommand(command, COMMAND_ADJUST_CAMERA_POSITION_FAR_HAS_OFFSET);
  const ValueCommand moveCommand =
      readValueCommand(command, COMMAND_ADJUST_CAMERA_POSITION_MOVE_HAS_OFFSET);

  scalar_t pitchTarget = static_cast<scalar_t>(0.0f);
  if (pitch.has) {
    if (!normalizeFinitePosition(pitch.value, pitchTarget)) {
      return normalizeFailure();
    }
  } else {
    pitchTarget = resolveInterpolationTarget<CameraInterpolationAccessor>(
        cameraTarget, CAMERA_ROTATION_PITCH_FIELD);
  }

  scalar_t fovTarget = static_cast<scalar_t>(0.0f);
  if (fov.has) {
    if (!isFiniteScalar(fov.value)) {
      return false;
    }
    fovTarget = fov.value;
  } else {
    fovTarget = resolveInterpolationTarget<CameraInterpolationAccessor>(
        cameraTarget, CAMERA_FOV_Y_FIELD);
  }

  if (!(fovTarget > static_cast<scalar_t>(0.0f) &&
        fovTarget < static_cast<scalar_t>(180.0f))) {
    return false;
  }

  scalar_t nearTarget = camera[CAMERA_NEAR_OFFSET];
  scalar_t farTarget = camera[CAMERA_FAR_OFFSET];
  bool nearChanged = false;
  bool farChanged = false;
  if (nearCommand.has) {
    if (!isFiniteScalar(nearCommand.value)) {
      return false;
    }
    nearTarget = nearCommand.value;
    nearChanged = true;
  }
  if (farCommand.has) {
    if (!isFiniteScalar(farCommand.value)) {
      return false;
    }
    farTarget = farCommand.value;
    farChanged = true;
  }
  if ((nearChanged || farChanged) &&
      !(nearTarget > static_cast<scalar_t>(0.0f) &&
        farTarget > nearTarget)) {
    return false;
  }

  auto &workspace = context.workspace;
  const int spriteCount = workspace.spriteCount;
  const int elementCount = workspace.elementCount;
  const int polylineCount = workspace.polylineCount;
  const int polylineNodeCount = workspace.polylineNodeCount;
  const bool hasSprites = spriteCount > 0 && elementCount > 0;
  const bool hasPolylines = polylineCount > 0 && polylineNodeCount > 0;

  if (hasSprites || hasPolylines) {
    workspace.prepare(
        spriteCount,
        elementCount,
        polylineCount,
        polylineNodeCount,
        context.debugEntryEnabled);
  }

  const msp_wasm::SpriteInputView sprite =
      hasSprites
          ? msp_wasm::makeSpriteInputView(
              workspace.spriteInputBuffer.data(), workspace.spriteCapacity)
          : msp_wasm::SpriteInputView{};
  const msp_wasm::ElementInputView element =
      hasSprites
          ? msp_wasm::makeElementInputView(
              workspace.elementInputBuffer.data(), workspace.elementCapacity)
          : msp_wasm::ElementInputView{};
  const msp_wasm::PolylineInputView polyline =
      hasPolylines
          ? msp_wasm::makePolylineInputView(
              workspace.polylineInputBuffer.data(), workspace.polylineCapacity)
          : msp_wasm::PolylineInputView{};
  const msp_wasm::PolylineNodeInputView polylineNodes =
      hasPolylines
          ? msp_wasm::makePolylineNodeInputView(
              workspace.polylineNodeInputBuffer.data(),
              workspace.polylineNodeCapacity)
          : msp_wasm::PolylineNodeInputView{};

  if (hasSprites) {
    msp_wasm::updateSpriteAnimations(sprite, spriteCount, nowMs);
    updateSpritePseudoLodVisibility(
        workspace,
        sprite,
        element,
        spriteCount,
        elementCount,
        camera,
        nowMs);
  }
  if (hasPolylines) {
    msp_wasm::updatePolylineAnimations(polyline, polylineCount, nowMs);
  }

  scalar_t rotationMatrix[16];
  scalar_t rotationTemp[16];
  scalar_t rotationTranspose[16];
  createRotationZXYMatrix(
      static_cast<scalar_t>(0.0f),
      toRadians(pitchTarget),
      static_cast<scalar_t>(0.0f),
      rotationMatrix,
      rotationTemp);
  transposeMatrix(rotationMatrix, rotationTranspose);
  const scalar_t viewRightX = rotationTranspose[0];
  const scalar_t viewRightY = rotationTranspose[4];
  const scalar_t viewRightZ = rotationTranspose[8];
  const scalar_t viewUpX = rotationTranspose[1];
  const scalar_t viewUpY = rotationTranspose[5];
  const scalar_t viewUpZ = rotationTranspose[9];

  if (hasSprites) {
    updateOwnerCachesForAdjust(
        sprite,
        element,
        spriteCount,
        elementCount,
        workspace.ownerBaseXValues,
        workspace.ownerBaseYValues,
        workspace.ownerBaseZValues,
        workspace.ownerParentOpacityValues);
    bool elementAnimationsActive = false;
    const bool hasPivotBasis = msp_wasm::updateElementAnimationsAndPivots(
        sprite,
        element,
        spriteCount,
        elementCount,
        nowMs,
        workspace.pivotXValues,
        workspace.pivotYValues,
        workspace.pivotZValues,
        workspace.pivotLocalXValues,
        workspace.pivotLocalYValues,
        workspace.basePivotLocalXValues,
        workspace.basePivotLocalYValues,
        workspace.basePivotWorldXValues,
        workspace.basePivotWorldYValues,
        workspace.ownerBaseXValues,
        workspace.ownerBaseYValues,
        workspace.ownerBaseZValues,
        workspace.ownerParentOpacityValues,
        workspace.geometryEnabled,
        workspace.pivotDirtyFlags,
        context.textures,
        nullptr,
        &elementAnimationsActive);
    const scalar_t cameraX = camera[CAMERA_POSITION_X_OFFSET];
    const scalar_t cameraY = camera[CAMERA_POSITION_Y_OFFSET];
    const scalar_t cameraZ = camera[CAMERA_POSITION_Z_OFFSET];
    if (hasPivotBasis) {
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
          workspace.pivotXValues,
          workspace.pivotYValues,
          workspace.pivotZValues,
          workspace.pivotLocalXValues,
          workspace.pivotLocalYValues,
          workspace.basePivotWorldXValues,
          workspace.basePivotWorldYValues,
          workspace.basisRightXValues,
          workspace.basisRightYValues,
          workspace.basisRightZValues,
          workspace.basisUpXValues,
          workspace.basisUpYValues,
          workspace.basisUpZValues,
          workspace.spriteDistanceScaleFactors,
          workspace.pivotCameraDependentFlags,
          workspace.pivotDirtyFlags,
          workspace.pivotResolveStates);
    }
    const auto autoDirectionResult =
        msp_wasm::updateElementAutoDirectionAndFinalState(
        element,
        elementCount,
        workspace.pivotXValues,
        workspace.pivotYValues,
        workspace.basePivotWorldXValues,
        workspace.basePivotWorldYValues,
        workspace.basePivotLocalXValues,
        workspace.basePivotLocalYValues,
        workspace.pivotLocalXValues,
        workspace.pivotLocalYValues,
        workspace.geometryEnabled,
        workspace.pivotDirtyFlags,
        nowMs);
    if (autoDirectionResult.requiresPivotResolve) {
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
          workspace.pivotXValues,
          workspace.pivotYValues,
          workspace.pivotZValues,
          workspace.pivotLocalXValues,
          workspace.pivotLocalYValues,
          workspace.basePivotWorldXValues,
          workspace.basePivotWorldYValues,
          workspace.basisRightXValues,
          workspace.basisRightYValues,
          workspace.basisRightZValues,
          workspace.basisUpXValues,
          workspace.basisUpYValues,
          workspace.basisUpZValues,
          workspace.spriteDistanceScaleFactors,
          workspace.pivotCameraDependentFlags,
          workspace.pivotDirtyFlags,
          workspace.pivotResolveStates);
    }
  }

  bool hasBounds = false;
  scalar_t minX = static_cast<scalar_t>(0.0f);
  scalar_t maxX = static_cast<scalar_t>(0.0f);
  scalar_t minY = static_cast<scalar_t>(0.0f);
  scalar_t maxY = static_cast<scalar_t>(0.0f);
  scalar_t minZ = static_cast<scalar_t>(0.0f);
  scalar_t maxZ = static_cast<scalar_t>(0.0f);

  const auto includePoint = [&](scalar_t x, scalar_t y, scalar_t z) {
    if (!isFiniteScalar(x) || !isFiniteScalar(y) || !isFiniteScalar(z)) {
      return;
    }
    if (!hasBounds) {
      minX = x;
      maxX = x;
      minY = y;
      maxY = y;
      minZ = z;
      maxZ = z;
      hasBounds = true;
      return;
    }
    minX = std::min(minX, x);
    maxX = std::max(maxX, x);
    minY = std::min(minY, y);
    maxY = std::max(maxY, y);
    minZ = std::min(minZ, z);
    maxZ = std::max(maxZ, z);
  };

  if (hasSprites) {
    for (int i = 0; i < elementCount; ++i) {
      if (workspace.geometryEnabled[static_cast<size_t>(i)] == 0) {
        continue;
      }
      const int ownerSlot = static_cast<int>(element.ownerSlotValues[i]);
      if (ownerSlot < 0 || ownerSlot >= spriteCount) {
        continue;
      }
      const int texIndex = static_cast<int>(element.texIndexValues[i]);
      if (texIndex < 0 ||
          texIndex >= static_cast<int>(context.textures.size())) {
        continue;
      }
      const auto &texture = context.textures[static_cast<size_t>(texIndex)];
      if (texture.valid == 0) {
        continue;
      }
      const scalar_t opacity =
          resolveElementRenderOpacity(sprite, element, spriteCount, i);
      if (opacity <= static_cast<scalar_t>(0.0f)) {
        continue;
      }
      const scalar_t pivotX = workspace.pivotXValues[static_cast<size_t>(i)];
      const scalar_t pivotY = workspace.pivotYValues[static_cast<size_t>(i)];
      const scalar_t z = workspace.pivotZValues[static_cast<size_t>(i)];
      const scalar_t width = texture.width * element.scaleValues[i];
      const scalar_t height = texture.height * element.scaleValues[i];
      const scalar_t halfWidth = width * static_cast<scalar_t>(0.5f);
      const scalar_t halfHeight = height * static_cast<scalar_t>(0.5f);
      const scalar_t anchorOffsetX =
          element.anchorXValues[i] * halfWidth;
      const scalar_t anchorOffsetY =
          element.anchorYValues[i] * halfHeight;
      const scalar_t localLeft = -halfWidth - anchorOffsetX;
      const scalar_t localTop = -halfHeight - anchorOffsetY;
      const scalar_t localRight = halfWidth - anchorOffsetX;
      const scalar_t localBottom = halfHeight - anchorOffsetY;
      const scalar_t rotateDeg = element.finalRotateDegValues[i];
      const int renderMode =
          static_cast<int>(element.renderModeValues[i]);

      if (renderMode == COMMON_RENDER_MODE_BILLBOARD_PERSPECTIVE ||
          renderMode == COMMON_RENDER_MODE_BILLBOARD) {
        const scalar_t angle = -toRadians(rotateDeg);
        scalar_t s = static_cast<scalar_t>(0.0f);
        scalar_t c = static_cast<scalar_t>(1.0f);
        computeSinCos(angle, s, c);
        const auto includeBillboard = [&](scalar_t lx, scalar_t ly) {
          const scalar_t rx = lx * c - ly * s;
          const scalar_t ry = lx * s + ly * c;
          includePoint(
              pivotX + viewRightX * rx + viewUpX * ry,
              pivotY + viewRightY * rx + viewUpY * ry,
              z + viewRightZ * rx + viewUpZ * ry);
        };
        includeBillboard(localLeft, localBottom);
        includeBillboard(localRight, localBottom);
        includeBillboard(localLeft, localTop);
        includeBillboard(localRight, localTop);
      } else if (rotateDeg == static_cast<scalar_t>(0.0f)) {
        includePoint(pivotX + localLeft, pivotY + localBottom, z);
        includePoint(pivotX + localRight, pivotY + localBottom, z);
        includePoint(pivotX + localLeft, pivotY + localTop, z);
        includePoint(pivotX + localRight, pivotY + localTop, z);
      } else {
        const scalar_t angle = -toRadians(rotateDeg);
        scalar_t s = static_cast<scalar_t>(0.0f);
        scalar_t c = static_cast<scalar_t>(1.0f);
        computeSinCos(angle, s, c);
        const scalar_t lbx = pivotX + localLeft * c - localBottom * s;
        const scalar_t lby = pivotY + localLeft * s + localBottom * c;
        const scalar_t rbx = pivotX + localRight * c - localBottom * s;
        const scalar_t rby = pivotY + localRight * s + localBottom * c;
        const scalar_t ltx = pivotX + localLeft * c - localTop * s;
        const scalar_t lty = pivotY + localLeft * s + localTop * c;
        const scalar_t rtx = pivotX + localRight * c - localTop * s;
        const scalar_t rty = pivotY + localRight * s + localTop * c;
        includePoint(lbx, lby, z);
        includePoint(rbx, rby, z);
        includePoint(ltx, lty, z);
        includePoint(rtx, rty, z);
      }
    }
  }

  if (hasPolylines) {
    for (int i = 0; i < polylineCount; ++i) {
      const int nodeOffset = static_cast<int>(polyline.nodeOffsetValues[i]);
      const int nodeCount = static_cast<int>(polyline.nodeCountValues[i]);
      if (nodeOffset < 0 || nodeCount <= 0) {
        continue;
      }
      const scalar_t opacity = std::max(
          static_cast<scalar_t>(0.0f),
          std::min(
              static_cast<scalar_t>(1.0f),
              polyline.opacityValues[i]));
      if (opacity <= static_cast<scalar_t>(0.0f)) {
        continue;
      }
      for (int n = 0; n < nodeCount; ++n) {
        const int index = nodeOffset + n;
        const scalar_t x = polylineNodes.xValues[index];
        const scalar_t y = polylineNodes.yValues[index];
        const scalar_t thickness = polylineNodes.thicknessValues[index];
        const scalar_t half = thickness * static_cast<scalar_t>(0.5f);
        includePoint(x - half, y - half, static_cast<scalar_t>(0.0f));
        includePoint(x + half, y + half, static_cast<scalar_t>(0.0f));
      }
    }
  }

  scalar_t targetX = camera[CAMERA_POSITION_X_OFFSET];
  scalar_t targetY = camera[CAMERA_POSITION_Y_OFFSET];
  scalar_t targetZ = camera[CAMERA_POSITION_Z_OFFSET];

  if (hasBounds) {
    const scalar_t centerX = (minX + maxX) * static_cast<scalar_t>(0.5f);
    const scalar_t centerY = (minY + maxY) * static_cast<scalar_t>(0.5f);
    const scalar_t centerZ = (minZ + maxZ) * static_cast<scalar_t>(0.5f);
    const scalar_t aspectRatio =
        isFiniteScalar(camera[CAMERA_VIEWPORT_ASPECT_OFFSET]) &&
                camera[CAMERA_VIEWPORT_ASPECT_OFFSET] >
                    static_cast<scalar_t>(0.0f)
            ? camera[CAMERA_VIEWPORT_ASPECT_OFFSET]
            : static_cast<scalar_t>(1.0f);
    const scalar_t tanHalfFovY = std::tan(toRadians(fovTarget) / 2);
    const scalar_t tanHalfFovX = tanHalfFovY * aspectRatio;
    if (!(isFiniteScalar(tanHalfFovX) && isFiniteScalar(tanHalfFovY) &&
          tanHalfFovX > static_cast<scalar_t>(0.0f) &&
          tanHalfFovY > static_cast<scalar_t>(0.0f))) {
      return false;
    }

    scalar_t requiredDistance = static_cast<scalar_t>(0.0f);
    scalar_t cornerRx[8];
    scalar_t cornerRy[8];
    scalar_t cornerRz[8];
    int cornerCount = 0;
    const scalar_t dxs[2] = {minX - centerX, maxX - centerX};
    const scalar_t dys[2] = {minY - centerY, maxY - centerY};
    const scalar_t dzs[2] = {minZ - centerZ, maxZ - centerZ};
    for (int ix = 0; ix < 2; ++ix) {
      for (int iy = 0; iy < 2; ++iy) {
        for (int iz = 0; iz < 2; ++iz) {
          const scalar_t dx = dxs[ix];
          const scalar_t dy = dys[iy];
          const scalar_t dz = dzs[iz];
          const scalar_t rx =
              rotationTranspose[0] * dx +
              rotationTranspose[4] * dy +
              rotationTranspose[8] * dz;
          const scalar_t ry =
              rotationTranspose[1] * dx +
              rotationTranspose[5] * dy +
              rotationTranspose[9] * dz;
          const scalar_t rz =
              rotationTranspose[2] * dx +
              rotationTranspose[6] * dy +
              rotationTranspose[10] * dz;
          if (cornerCount < 8) {
            cornerRx[cornerCount] = rx;
            cornerRy[cornerCount] = ry;
            cornerRz[cornerCount] = rz;
            cornerCount += 1;
          }
          const scalar_t reqX = std::abs(rx) / tanHalfFovX;
          const scalar_t reqY = std::abs(ry) / tanHalfFovY;
          const scalar_t req = rz + std::max(reqX, reqY);
          if (req > requiredDistance) {
            requiredDistance = req;
          }
        }
      }
    }
    if (!isFiniteScalar(requiredDistance)) {
      return false;
    }
    if (requiredDistance < static_cast<scalar_t>(0.0f)) {
      requiredDistance = static_cast<scalar_t>(0.0f);
    }

    scalar_t offsetX = static_cast<scalar_t>(0.0f);
    scalar_t offsetY = static_cast<scalar_t>(0.0f);

    if (cornerCount > 0 && requiredDistance > static_cast<scalar_t>(0.0f)) {
      const scalar_t depthEpsilon = static_cast<scalar_t>(1.0e-6f);
      const scalar_t maxScalar = std::numeric_limits<scalar_t>::max();
      scalar_t offsetXMin = -maxScalar;
      scalar_t offsetXMax = maxScalar;
      scalar_t offsetYMin = -maxScalar;
      scalar_t offsetYMax = maxScalar;
      for (int i = 0; i < cornerCount; ++i) {
        const scalar_t rawDepth = requiredDistance - cornerRz[i];
        const scalar_t depth =
            rawDepth > depthEpsilon ? rawDepth : depthEpsilon;
        const scalar_t limitX = depth * tanHalfFovX;
        const scalar_t limitY = depth * tanHalfFovY;
        offsetXMin = std::max(offsetXMin, cornerRx[i] - limitX);
        offsetXMax = std::min(offsetXMax, cornerRx[i] + limitX);
        offsetYMin = std::max(offsetYMin, cornerRy[i] - limitY);
        offsetYMax = std::min(offsetYMax, cornerRy[i] + limitY);
      }
      if (!(isFiniteScalar(offsetXMin) && isFiniteScalar(offsetXMax)) ||
          offsetXMin > offsetXMax) {
        offsetXMin = static_cast<scalar_t>(0.0f);
        offsetXMax = static_cast<scalar_t>(0.0f);
      }
      if (!(isFiniteScalar(offsetYMin) && isFiniteScalar(offsetYMax)) ||
          offsetYMin > offsetYMax) {
        offsetYMin = static_cast<scalar_t>(0.0f);
        offsetYMax = static_cast<scalar_t>(0.0f);
      }

      if (offsetXMin <= static_cast<scalar_t>(0.0f) &&
          offsetXMax >= static_cast<scalar_t>(0.0f)) {
        offsetX = static_cast<scalar_t>(0.0f);
      } else if (std::abs(offsetXMin) < std::abs(offsetXMax)) {
        offsetX = offsetXMin;
      } else {
        offsetX = offsetXMax;
      }

      const auto computeProjectedY = [&](scalar_t candidate,
                                         scalar_t &minProj,
                                         scalar_t &maxProj) {
        minProj = maxScalar;
        maxProj = -maxScalar;
        for (int i = 0; i < cornerCount; ++i) {
          const scalar_t rawDepth = requiredDistance - cornerRz[i];
          const scalar_t depth =
              rawDepth > depthEpsilon ? rawDepth : depthEpsilon;
          const scalar_t proj =
              (cornerRy[i] - candidate) / (depth * tanHalfFovY);
          minProj = std::min(minProj, proj);
          maxProj = std::max(maxProj, proj);
        }
      };

      scalar_t minProj = static_cast<scalar_t>(0.0f);
      scalar_t maxProj = static_cast<scalar_t>(0.0f);
      scalar_t maxMinProj = static_cast<scalar_t>(0.0f);
      scalar_t maxMaxProj = static_cast<scalar_t>(0.0f);
      computeProjectedY(offsetYMin, minProj, maxProj);
      computeProjectedY(offsetYMax, maxMinProj, maxMaxProj);
      const scalar_t minSum = minProj + maxProj;
      const scalar_t maxSum = maxMinProj + maxMaxProj;
      if (isFiniteScalar(minSum) && isFiniteScalar(maxSum) &&
          minSum > static_cast<scalar_t>(0.0f) &&
          maxSum < static_cast<scalar_t>(0.0f)) {
        scalar_t low = offsetYMin;
        scalar_t high = offsetYMax;
        for (int iter = 0; iter < 20; ++iter) {
          const scalar_t mid = (low + high) * static_cast<scalar_t>(0.5f);
          computeProjectedY(mid, minProj, maxProj);
          const scalar_t sum = minProj + maxProj;
          if (sum > static_cast<scalar_t>(0.0f)) {
            low = mid;
          } else {
            high = mid;
          }
        }
        offsetY = (low + high) * static_cast<scalar_t>(0.5f);
      } else if (isFiniteScalar(minSum) && isFiniteScalar(maxSum)) {
        offsetY = std::abs(minSum) < std::abs(maxSum) ? offsetYMin : offsetYMax;
      } else {
        offsetY = static_cast<scalar_t>(0.0f);
      }
    }

    const scalar_t rightX = rotationMatrix[0];
    const scalar_t rightY = rotationMatrix[1];
    const scalar_t rightZ = rotationMatrix[2];
    const scalar_t upX = rotationMatrix[4];
    const scalar_t upY = rotationMatrix[5];
    const scalar_t upZ = rotationMatrix[6];
    const scalar_t forwardX = -rotationMatrix[8];
    const scalar_t forwardY = -rotationMatrix[9];
    const scalar_t forwardZ = -rotationMatrix[10];
    targetX = centerX + rightX * offsetX + upX * offsetY -
              forwardX * requiredDistance;
    targetY = centerY + rightY * offsetX + upY * offsetY -
              forwardY * requiredDistance;
    targetZ = centerZ + rightZ * offsetX + upZ * offsetY -
              forwardZ * requiredDistance;
  }

  bool changed = false;
  ValueCommand pitchApply = pitch;
  pitchApply.has = true;
  pitchApply.value = pitchTarget;
  scalar_t pitchValue = static_cast<scalar_t>(0.0f);
  if (!applyScalarInterpolationUpdate<CameraInterpolationAccessor>(
          cameraTarget,
          CAMERA_ROTATION_PITCH_FIELD,
          pitchApply,
          nowMs,
          normalizeFinitePosition,
          pitchValue,
          changed)) {
    return false;
  }

  ValueCommand fovApply = fov;
  fovApply.has = true;
  fovApply.value = fovTarget;
  scalar_t fovValue = static_cast<scalar_t>(0.0f);
  if (!applyScalarInterpolationUpdate<CameraInterpolationAccessor>(
          cameraTarget,
          CAMERA_FOV_Y_FIELD,
          fovApply,
          nowMs,
          [](scalar_t value, scalar_t &out) -> bool {
            if (!isFiniteScalar(value)) {
              return false;
            }
            out = value;
            return true;
          },
          fovValue,
          changed)) {
    return false;
  }

  const auto applyMove = [&](const InterpolationField &field, scalar_t value) {
    ValueCommand moveApply = moveCommand;
    moveApply.has = true;
    moveApply.value = value;
    scalar_t resolved = static_cast<scalar_t>(0.0f);
    return applyScalarInterpolationUpdate<CameraInterpolationAccessor>(
        cameraTarget,
        field,
        moveApply,
        nowMs,
        normalizeFinitePosition,
        resolved,
        changed);
  };

  if (!applyMove(CAMERA_POSITION_X_FIELD, targetX)) {
    return false;
  }
  if (!applyMove(CAMERA_POSITION_Y_FIELD, targetY)) {
    return false;
  }
  if (!applyMove(CAMERA_POSITION_Z_FIELD, targetZ)) {
    return false;
  }
  if (!applyMove(CAMERA_ROTATION_YAW_FIELD, static_cast<scalar_t>(0.0f))) {
    return false;
  }
  if (!applyMove(CAMERA_ROTATION_ROLL_FIELD, static_cast<scalar_t>(0.0f))) {
    return false;
  }

  if (nearChanged) {
    camera[CAMERA_NEAR_OFFSET] = nearTarget;
    changed = true;
  }
  if (farChanged) {
    camera[CAMERA_FAR_OFFSET] = farTarget;
    changed = true;
  }

  if (changed) {
    camera[CAMERA_PROJECTION_DIRTY_OFFSET] = static_cast<scalar_t>(1.0f);
  }
  return true;
}

/**
 * @brief Updates one texture-table entry and propagates its dimensions to elements.
 */
static bool applySetTextureInfo(CommandContext &context, const scalar_t *command) {
  int texIndex = -1;
  if (!toIntScalar(command[COMMAND_SET_TEXTURE_INFO_TEX_INDEX_OFFSET], texIndex) ||
      texIndex < 0) {
    return false;
  }
  const scalar_t width = command[COMMAND_SET_TEXTURE_INFO_WIDTH_OFFSET];
  const scalar_t height = command[COMMAND_SET_TEXTURE_INFO_HEIGHT_OFFSET];
  const scalar_t valid = command[COMMAND_SET_TEXTURE_INFO_VALID_OFFSET];
  int pageId = -1;
  if (!toIntScalar(command[COMMAND_SET_TEXTURE_INFO_PAGE_ID_OFFSET], pageId)) {
    return false;
  }
  const scalar_t u0 = command[COMMAND_SET_TEXTURE_INFO_U0_OFFSET];
  const scalar_t v0 = command[COMMAND_SET_TEXTURE_INFO_V0_OFFSET];
  const scalar_t u1 = command[COMMAND_SET_TEXTURE_INFO_U1_OFFSET];
  const scalar_t v1 = command[COMMAND_SET_TEXTURE_INFO_V1_OFFSET];
  if (!isFiniteScalar(width) || !isFiniteScalar(height) ||
      !isFiniteScalar(valid) || !isFiniteScalar(u0) || !isFiniteScalar(v0) ||
      !isFiniteScalar(u1) || !isFiniteScalar(v1)) {
    return false;
  }
  if (valid != static_cast<scalar_t>(0.0f) && pageId < 0) {
    return false;
  }
  if (texIndex >= static_cast<int>(context.textures.size())) {
    context.textures.resize(static_cast<size_t>(texIndex + 1),
                            msp_wasm::TextureInfo{0.0f,
                                                  0.0f,
                                                  0.0f,
                                                  0.0f,
                                                  0.0f,
                                                  0.0f,
                                                  -1,
                                                  0,
                                                  {}});
  }
  context.textures[static_cast<size_t>(texIndex)] =
      msp_wasm::TextureInfo{width,
                            height,
                            u0,
                            v0,
                            u1,
                            v1,
                            pageId,
                            valid != 0.0f ? 1 : 0,
                            {}};
  updateElementDimensionsForTexIndex(
      context,
      texIndex,
      width,
      height,
      valid != static_cast<scalar_t>(0.0f));
  return true;
}

/**
 * @brief Updates one tiled texture-table entry and propagates its dimensions.
 */
static bool applySetTiledTextureInfo(CommandContext &context, const scalar_t *command) {
  int texIndex = -1;
  if (!toIntScalar(command[COMMAND_SET_TILED_TEXTURE_INFO_TEX_INDEX_OFFSET], texIndex) ||
      texIndex < 0) {
    return false;
  }
  const scalar_t width = command[COMMAND_SET_TILED_TEXTURE_INFO_WIDTH_OFFSET];
  const scalar_t height = command[COMMAND_SET_TILED_TEXTURE_INFO_HEIGHT_OFFSET];
  const scalar_t valid = command[COMMAND_SET_TILED_TEXTURE_INFO_VALID_OFFSET];
  int tileCount = 0;
  if (!toIntScalar(command[COMMAND_SET_TILED_TEXTURE_INFO_TILE_COUNT_OFFSET], tileCount) ||
      tileCount < 0) {
    return false;
  }
  if (!isFiniteScalar(width) || !isFiniteScalar(height) || !isFiniteScalar(valid)) {
    return false;
  }
  if (valid != static_cast<scalar_t>(0.0f) && tileCount <= 0) {
    return false;
  }
  if (texIndex >= static_cast<int>(context.textures.size())) {
    context.textures.resize(static_cast<size_t>(texIndex + 1),
                            msp_wasm::TextureInfo{0.0f,
                                                  0.0f,
                                                  0.0f,
                                                  0.0f,
                                                  0.0f,
                                                  0.0f,
                                                  -1,
                                                  0,
                                                  {}});
  }
  auto &texture = context.textures[static_cast<size_t>(texIndex)];
  texture.width = width;
  texture.height = height;
  texture.u0 = static_cast<scalar_t>(0.0f);
  texture.v0 = static_cast<scalar_t>(0.0f);
  texture.u1 = static_cast<scalar_t>(0.0f);
  texture.v1 = static_cast<scalar_t>(0.0f);
  texture.pageId = -1;
  texture.valid = valid != 0.0f ? 1 : 0;
  texture.tiles.assign(
      static_cast<size_t>(tileCount),
      msp_wasm::TextureTileInfo{0.0f,
                                0.0f,
                                0.0f,
                                0.0f,
                                0.0f,
                                0.0f,
                                0.0f,
                                0.0f,
                                -1});
  updateElementDimensionsForTexIndex(
      context,
      texIndex,
      width,
      height,
      valid != static_cast<scalar_t>(0.0f));
  return true;
}

/**
 * @brief Updates one tile region inside a tiled texture-table entry.
 */
static bool applySetTextureTileInfo(CommandContext &context, const scalar_t *command) {
  int texIndex = -1;
  if (!toIntScalar(command[COMMAND_SET_TEXTURE_TILE_INFO_TEX_INDEX_OFFSET], texIndex) ||
      texIndex < 0 || texIndex >= static_cast<int>(context.textures.size())) {
    return false;
  }
  int tileIndex = -1;
  if (!toIntScalar(command[COMMAND_SET_TEXTURE_TILE_INFO_TILE_INDEX_OFFSET], tileIndex) ||
      tileIndex < 0) {
    return false;
  }
  int pageId = -1;
  if (!toIntScalar(command[COMMAND_SET_TEXTURE_TILE_INFO_PAGE_ID_OFFSET], pageId) ||
      pageId < 0) {
    return false;
  }
  const scalar_t u0 = command[COMMAND_SET_TEXTURE_TILE_INFO_U0_OFFSET];
  const scalar_t v0 = command[COMMAND_SET_TEXTURE_TILE_INFO_V0_OFFSET];
  const scalar_t u1 = command[COMMAND_SET_TEXTURE_TILE_INFO_U1_OFFSET];
  const scalar_t v1 = command[COMMAND_SET_TEXTURE_TILE_INFO_V1_OFFSET];
  const scalar_t leftRatio = command[COMMAND_SET_TEXTURE_TILE_INFO_LEFT_RATIO_OFFSET];
  const scalar_t topRatio = command[COMMAND_SET_TEXTURE_TILE_INFO_TOP_RATIO_OFFSET];
  const scalar_t rightRatio = command[COMMAND_SET_TEXTURE_TILE_INFO_RIGHT_RATIO_OFFSET];
  const scalar_t bottomRatio =
      command[COMMAND_SET_TEXTURE_TILE_INFO_BOTTOM_RATIO_OFFSET];
  if (!isFiniteScalar(u0) || !isFiniteScalar(v0) || !isFiniteScalar(u1) ||
      !isFiniteScalar(v1) || !isFiniteScalar(leftRatio) ||
      !isFiniteScalar(topRatio) || !isFiniteScalar(rightRatio) ||
      !isFiniteScalar(bottomRatio)) {
    return false;
  }
  auto &texture = context.textures[static_cast<size_t>(texIndex)];
  if (tileIndex >= static_cast<int>(texture.tiles.size())) {
    return false;
  }
  texture.tiles[static_cast<size_t>(tileIndex)] =
      msp_wasm::TextureTileInfo{leftRatio,
                                topRatio,
                                rightRatio,
                                bottomRatio,
                                u0,
                                v0,
                                u1,
                                v1,
                                pageId};
  updateElementDimensionsForTexIndex(
      context,
      texIndex,
      texture.width,
      texture.height,
      texture.valid != 0);
  return true;
}

} // namespace msp_wasm::detail
