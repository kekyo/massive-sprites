// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

#include "compute_internal.h"

///////////////////////////////////////////////////////////////////////////////////////////////

namespace msp_wasm {

SpriteInputView makeSpriteInputView(scalar_t *spriteInput, int spriteInputStride) {
  SpriteInputView view{};
  view.xValues = spriteInput + SPRITE_X_OFFSET * spriteInputStride;
  view.yValues = spriteInput + SPRITE_Y_OFFSET * spriteInputStride;
  view.zValues = spriteInput + SPRITE_Z_OFFSET * spriteInputStride;
  view.parentOpacityValues =
      spriteInput + SPRITE_PARENT_OPACITY_OFFSET * spriteInputStride;
  view.renderOpacityValues =
      spriteInput + SPRITE_RENDER_OPACITY_OFFSET * spriteInputStride;
  view.visibilityDistanceValues =
      spriteInput + SPRITE_VISIBILITY_DISTANCE_OFFSET * spriteInputStride;
  view.lodVisibleValues =
      spriteInput + SPRITE_LOD_VISIBLE_OFFSET * spriteInputStride;
  view.parentOpacityEasingValues =
      spriteInput + SPRITE_PARENT_OPACITY_EASING_OFFSET * spriteInputStride;
  view.parentOpacityEasingParam0Values =
      spriteInput + SPRITE_PARENT_OPACITY_EASING_PARAM0_OFFSET * spriteInputStride;
  view.parentOpacityEasingParam1Values =
      spriteInput + SPRITE_PARENT_OPACITY_EASING_PARAM1_OFFSET * spriteInputStride;
  view.parentOpacityEasingParam2Values =
      spriteInput + SPRITE_PARENT_OPACITY_EASING_PARAM2_OFFSET * spriteInputStride;
  view.parentOpacityEasingParam3Values =
      spriteInput + SPRITE_PARENT_OPACITY_EASING_PARAM3_OFFSET * spriteInputStride;
  view.renderOpacityEasingValues =
      spriteInput + SPRITE_RENDER_OPACITY_EASING_OFFSET * spriteInputStride;
  view.renderOpacityEasingParam0Values =
      spriteInput + SPRITE_RENDER_OPACITY_EASING_PARAM0_OFFSET * spriteInputStride;
  view.renderOpacityEasingParam1Values =
      spriteInput + SPRITE_RENDER_OPACITY_EASING_PARAM1_OFFSET * spriteInputStride;
  view.renderOpacityEasingParam2Values =
      spriteInput + SPRITE_RENDER_OPACITY_EASING_PARAM2_OFFSET * spriteInputStride;
  view.renderOpacityEasingParam3Values =
      spriteInput + SPRITE_RENDER_OPACITY_EASING_PARAM3_OFFSET * spriteInputStride;
  view.xEasingValues = spriteInput + SPRITE_X_EASING_OFFSET * spriteInputStride;
  view.xEasingParam0Values =
      spriteInput + SPRITE_X_EASING_PARAM0_OFFSET * spriteInputStride;
  view.xEasingParam1Values =
      spriteInput + SPRITE_X_EASING_PARAM1_OFFSET * spriteInputStride;
  view.xEasingParam2Values =
      spriteInput + SPRITE_X_EASING_PARAM2_OFFSET * spriteInputStride;
  view.xEasingParam3Values =
      spriteInput + SPRITE_X_EASING_PARAM3_OFFSET * spriteInputStride;
  view.yEasingValues = spriteInput + SPRITE_Y_EASING_OFFSET * spriteInputStride;
  view.yEasingParam0Values =
      spriteInput + SPRITE_Y_EASING_PARAM0_OFFSET * spriteInputStride;
  view.yEasingParam1Values =
      spriteInput + SPRITE_Y_EASING_PARAM1_OFFSET * spriteInputStride;
  view.yEasingParam2Values =
      spriteInput + SPRITE_Y_EASING_PARAM2_OFFSET * spriteInputStride;
  view.yEasingParam3Values =
      spriteInput + SPRITE_Y_EASING_PARAM3_OFFSET * spriteInputStride;
  view.xFromValues = spriteInput + SPRITE_X_FROM_OFFSET * spriteInputStride;
  view.xToValues = spriteInput + SPRITE_X_TO_OFFSET * spriteInputStride;
  view.xStartValues = spriteInput + SPRITE_X_START_TIMESTAMP_OFFSET * spriteInputStride;
  view.xDurationValues =
      spriteInput + SPRITE_X_DURATION_OFFSET * spriteInputStride;
  view.parentOpacityFromValues =
      spriteInput + SPRITE_PARENT_OPACITY_FROM_OFFSET * spriteInputStride;
  view.parentOpacityToValues =
      spriteInput + SPRITE_PARENT_OPACITY_TO_OFFSET * spriteInputStride;
  view.parentOpacityStartValues =
      spriteInput + SPRITE_PARENT_OPACITY_START_TIMESTAMP_OFFSET * spriteInputStride;
  view.parentOpacityDurationValues =
      spriteInput + SPRITE_PARENT_OPACITY_DURATION_OFFSET * spriteInputStride;
  view.renderOpacityFromValues =
      spriteInput + SPRITE_RENDER_OPACITY_FROM_OFFSET * spriteInputStride;
  view.renderOpacityToValues =
      spriteInput + SPRITE_RENDER_OPACITY_TO_OFFSET * spriteInputStride;
  view.renderOpacityStartValues =
      spriteInput + SPRITE_RENDER_OPACITY_START_TIMESTAMP_OFFSET * spriteInputStride;
  view.renderOpacityDurationValues =
      spriteInput + SPRITE_RENDER_OPACITY_DURATION_OFFSET * spriteInputStride;
  view.yFromValues = spriteInput + SPRITE_Y_FROM_OFFSET * spriteInputStride;
  view.yToValues = spriteInput + SPRITE_Y_TO_OFFSET * spriteInputStride;
  view.yStartValues = spriteInput + SPRITE_Y_START_TIMESTAMP_OFFSET * spriteInputStride;
  view.yDurationValues =
      spriteInput + SPRITE_Y_DURATION_OFFSET * spriteInputStride;
  return view;
}

ElementInputView makeElementInputView(scalar_t *elementInput, int elementInputStride) {
  ElementInputView view{};
  view.widthValues = elementInput + SPRITE_ELEMENT_WIDTH_OFFSET * elementInputStride;
  view.heightValues = elementInput + SPRITE_ELEMENT_HEIGHT_OFFSET * elementInputStride;
  view.scaleValues = elementInput + SPRITE_ELEMENT_SCALE_OFFSET * elementInputStride;
  view.scaleFromValues =
      elementInput + SPRITE_ELEMENT_SCALE_FROM_OFFSET * elementInputStride;
  view.scaleToValues = elementInput + SPRITE_ELEMENT_SCALE_TO_OFFSET * elementInputStride;
  view.scaleStartValues =
      elementInput + SPRITE_ELEMENT_SCALE_START_TIMESTAMP_OFFSET * elementInputStride;
  view.scaleDurationValues =
      elementInput + SPRITE_ELEMENT_SCALE_DURATION_OFFSET * elementInputStride;
  view.scaleEasingValues =
      elementInput + SPRITE_ELEMENT_SCALE_EASING_OFFSET * elementInputStride;
  view.scaleEasingParam0Values =
      elementInput + SPRITE_ELEMENT_SCALE_EASING_PARAM0_OFFSET * elementInputStride;
  view.scaleEasingParam1Values =
      elementInput + SPRITE_ELEMENT_SCALE_EASING_PARAM1_OFFSET * elementInputStride;
  view.scaleEasingParam2Values =
      elementInput + SPRITE_ELEMENT_SCALE_EASING_PARAM2_OFFSET * elementInputStride;
  view.scaleEasingParam3Values =
      elementInput + SPRITE_ELEMENT_SCALE_EASING_PARAM3_OFFSET * elementInputStride;
  view.opacityValues = elementInput + SPRITE_ELEMENT_OPACITY_OFFSET * elementInputStride;
  view.renderOpacityValues =
      elementInput + SPRITE_ELEMENT_RENDER_OPACITY_OFFSET * elementInputStride;
  view.borderWidthValues =
      elementInput + SPRITE_ELEMENT_BORDER_WIDTH_OFFSET * elementInputStride;
  view.borderColorRValues =
      elementInput + SPRITE_ELEMENT_BORDER_COLOR_R_OFFSET * elementInputStride;
  view.borderColorGValues =
      elementInput + SPRITE_ELEMENT_BORDER_COLOR_G_OFFSET * elementInputStride;
  view.borderColorBValues =
      elementInput + SPRITE_ELEMENT_BORDER_COLOR_B_OFFSET * elementInputStride;
  view.borderColorAValues =
      elementInput + SPRITE_ELEMENT_BORDER_COLOR_A_OFFSET * elementInputStride;
  view.leaderlineWidthValues =
      elementInput + SPRITE_ELEMENT_LEADERLINE_WIDTH_OFFSET * elementInputStride;
  view.leaderlineWidthFromValues =
      elementInput + SPRITE_ELEMENT_LEADERLINE_WIDTH_FROM_OFFSET * elementInputStride;
  view.leaderlineWidthToValues =
      elementInput + SPRITE_ELEMENT_LEADERLINE_WIDTH_TO_OFFSET * elementInputStride;
  view.leaderlineWidthStartValues =
      elementInput + SPRITE_ELEMENT_LEADERLINE_WIDTH_START_TIMESTAMP_OFFSET *
          elementInputStride;
  view.leaderlineWidthDurationValues =
      elementInput + SPRITE_ELEMENT_LEADERLINE_WIDTH_DURATION_OFFSET *
          elementInputStride;
  view.leaderlineWidthEasingValues =
      elementInput + SPRITE_ELEMENT_LEADERLINE_WIDTH_EASING_OFFSET *
          elementInputStride;
  view.leaderlineWidthEasingParam0Values =
      elementInput + SPRITE_ELEMENT_LEADERLINE_WIDTH_EASING_PARAM0_OFFSET *
          elementInputStride;
  view.leaderlineWidthEasingParam1Values =
      elementInput + SPRITE_ELEMENT_LEADERLINE_WIDTH_EASING_PARAM1_OFFSET *
          elementInputStride;
  view.leaderlineWidthEasingParam2Values =
      elementInput + SPRITE_ELEMENT_LEADERLINE_WIDTH_EASING_PARAM2_OFFSET *
          elementInputStride;
  view.leaderlineWidthEasingParam3Values =
      elementInput + SPRITE_ELEMENT_LEADERLINE_WIDTH_EASING_PARAM3_OFFSET *
          elementInputStride;
  view.leaderlineColor0RValues =
      elementInput + SPRITE_ELEMENT_LEADERLINE_COLOR0_R_OFFSET * elementInputStride;
  view.leaderlineColor0GValues =
      elementInput + SPRITE_ELEMENT_LEADERLINE_COLOR0_G_OFFSET * elementInputStride;
  view.leaderlineColor0BValues =
      elementInput + SPRITE_ELEMENT_LEADERLINE_COLOR0_B_OFFSET * elementInputStride;
  view.leaderlineColor0AValues =
      elementInput + SPRITE_ELEMENT_LEADERLINE_COLOR0_A_OFFSET * elementInputStride;
  view.leaderlineColor1RValues =
      elementInput + SPRITE_ELEMENT_LEADERLINE_COLOR1_R_OFFSET * elementInputStride;
  view.leaderlineColor1GValues =
      elementInput + SPRITE_ELEMENT_LEADERLINE_COLOR1_G_OFFSET * elementInputStride;
  view.leaderlineColor1BValues =
      elementInput + SPRITE_ELEMENT_LEADERLINE_COLOR1_B_OFFSET * elementInputStride;
  view.leaderlineColor1AValues =
      elementInput + SPRITE_ELEMENT_LEADERLINE_COLOR1_A_OFFSET * elementInputStride;
  view.leaderlineRepeatLengthValues =
      elementInput + SPRITE_ELEMENT_LEADERLINE_REPEAT_LENGTH_OFFSET *
          elementInputStride;
  view.anchorXValues = elementInput + SPRITE_ELEMENT_ANCHOR_X_OFFSET * elementInputStride;
  view.anchorYValues = elementInput + SPRITE_ELEMENT_ANCHOR_Y_OFFSET * elementInputStride;
  view.anchorXFromValues =
      elementInput + SPRITE_ELEMENT_ANCHOR_X_FROM_OFFSET * elementInputStride;
  view.anchorXToValues =
      elementInput + SPRITE_ELEMENT_ANCHOR_X_TO_OFFSET * elementInputStride;
  view.anchorXStartValues =
      elementInput + SPRITE_ELEMENT_ANCHOR_X_START_TIMESTAMP_OFFSET * elementInputStride;
  view.anchorXDurationValues =
      elementInput + SPRITE_ELEMENT_ANCHOR_X_DURATION_OFFSET * elementInputStride;
  view.anchorXEasingValues =
      elementInput + SPRITE_ELEMENT_ANCHOR_X_EASING_OFFSET * elementInputStride;
  view.anchorXEasingParam0Values =
      elementInput + SPRITE_ELEMENT_ANCHOR_X_EASING_PARAM0_OFFSET * elementInputStride;
  view.anchorXEasingParam1Values =
      elementInput + SPRITE_ELEMENT_ANCHOR_X_EASING_PARAM1_OFFSET * elementInputStride;
  view.anchorXEasingParam2Values =
      elementInput + SPRITE_ELEMENT_ANCHOR_X_EASING_PARAM2_OFFSET * elementInputStride;
  view.anchorXEasingParam3Values =
      elementInput + SPRITE_ELEMENT_ANCHOR_X_EASING_PARAM3_OFFSET * elementInputStride;
  view.anchorYFromValues =
      elementInput + SPRITE_ELEMENT_ANCHOR_Y_FROM_OFFSET * elementInputStride;
  view.anchorYToValues =
      elementInput + SPRITE_ELEMENT_ANCHOR_Y_TO_OFFSET * elementInputStride;
  view.anchorYStartValues =
      elementInput + SPRITE_ELEMENT_ANCHOR_Y_START_TIMESTAMP_OFFSET * elementInputStride;
  view.anchorYDurationValues =
      elementInput + SPRITE_ELEMENT_ANCHOR_Y_DURATION_OFFSET * elementInputStride;
  view.anchorYEasingValues =
      elementInput + SPRITE_ELEMENT_ANCHOR_Y_EASING_OFFSET * elementInputStride;
  view.anchorYEasingParam0Values =
      elementInput + SPRITE_ELEMENT_ANCHOR_Y_EASING_PARAM0_OFFSET * elementInputStride;
  view.anchorYEasingParam1Values =
      elementInput + SPRITE_ELEMENT_ANCHOR_Y_EASING_PARAM1_OFFSET * elementInputStride;
  view.anchorYEasingParam2Values =
      elementInput + SPRITE_ELEMENT_ANCHOR_Y_EASING_PARAM2_OFFSET * elementInputStride;
  view.anchorYEasingParam3Values =
      elementInput + SPRITE_ELEMENT_ANCHOR_Y_EASING_PARAM3_OFFSET * elementInputStride;
  view.orderValues = elementInput + SPRITE_ELEMENT_ORDER_OFFSET * elementInputStride;
  view.layerValues = elementInput + SPRITE_ELEMENT_LAYER_OFFSET * elementInputStride;
  view.renderModeValues =
      elementInput + SPRITE_ELEMENT_RENDER_MODE_OFFSET * elementInputStride;
  view.texIndexValues = elementInput + SPRITE_ELEMENT_TEX_INDEX_OFFSET * elementInputStride;
  view.originLocationSlotValues = elementInput + SPRITE_ELEMENT_ORIGIN_LOCATION_SLOT_OFFSET * elementInputStride;
  view.originLocationUseResolvedAnchorValues =
      elementInput + SPRITE_ELEMENT_ORIGIN_LOCATION_USE_RESOLVED_ANCHOR_OFFSET * elementInputStride;
  view.ownerSlotValues = elementInput + SPRITE_ELEMENT_OWNER_SLOT_OFFSET * elementInputStride;
  view.rotateDegValues = elementInput + SPRITE_ELEMENT_ROTATE_DEG_OFFSET * elementInputStride;
  view.autoDirectionSpaceValues =
      elementInput + SPRITE_ELEMENT_AUTO_DIRECTION_SPACE_OFFSET * elementInputStride;
  view.autoDirectionModeValues =
      elementInput + SPRITE_ELEMENT_AUTO_DIRECTION_MODE_OFFSET * elementInputStride;
  view.autoDirectionShiftAngleRotationValues =
      elementInput + SPRITE_ELEMENT_AUTO_DIRECTION_SHIFT_ANGLE_ROTATION_OFFSET *
          elementInputStride;
  view.autoDirectionMinDistanceValues =
      elementInput + SPRITE_ELEMENT_AUTO_DIRECTION_MIN_DISTANCE_OFFSET *
          elementInputStride;
  view.autoDirectionDegValues =
      elementInput + SPRITE_ELEMENT_AUTO_DIRECTION_DEG_OFFSET * elementInputStride;
  view.autoDirectionPrevPivotXValues =
      elementInput + SPRITE_ELEMENT_AUTO_DIRECTION_PREV_PIVOT_X_OFFSET *
          elementInputStride;
  view.autoDirectionPrevPivotYValues =
      elementInput + SPRITE_ELEMENT_AUTO_DIRECTION_PREV_PIVOT_Y_OFFSET *
          elementInputStride;
  view.autoDirectionHasPrevValues =
      elementInput + SPRITE_ELEMENT_AUTO_DIRECTION_HAS_PREV_OFFSET *
          elementInputStride;
  view.autoDirectionFlipXEnabledValues =
      elementInput + SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_X_ENABLED_OFFSET *
          elementInputStride;
  view.autoDirectionFlipYEnabledValues =
      elementInput + SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_Y_ENABLED_OFFSET *
          elementInputStride;
  view.autoDirectionFlipInterpConfigDurationValues =
      elementInput +
      SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_CONFIG_DURATION_OFFSET *
          elementInputStride;
  view.autoDirectionFlipInterpModeValues =
      elementInput + SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_MODE_OFFSET *
          elementInputStride;
  view.autoDirectionFlipInterpEasingValues =
      elementInput + SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_EASING_OFFSET *
          elementInputStride;
  view.autoDirectionFlipInterpParam0Values =
      elementInput + SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_PARAM0_OFFSET *
          elementInputStride;
  view.autoDirectionFlipInterpParam1Values =
      elementInput + SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_PARAM1_OFFSET *
          elementInputStride;
  view.autoDirectionFlipInterpParam2Values =
      elementInput + SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_PARAM2_OFFSET *
          elementInputStride;
  view.autoDirectionFlipInterpParam3Values =
      elementInput + SPRITE_ELEMENT_AUTO_DIRECTION_FLIP_INTERP_PARAM3_OFFSET *
          elementInputStride;
  view.finalRotateDegValues =
      elementInput + SPRITE_ELEMENT_FINAL_ROTATE_DEG_OFFSET * elementInputStride;
  view.finalRotateFromValues =
      elementInput + SPRITE_ELEMENT_FINAL_ROTATE_FROM_OFFSET * elementInputStride;
  view.finalRotateToValues =
      elementInput + SPRITE_ELEMENT_FINAL_ROTATE_TO_OFFSET * elementInputStride;
  view.finalRotateStartValues =
      elementInput + SPRITE_ELEMENT_FINAL_ROTATE_START_TIMESTAMP_OFFSET * elementInputStride;
  view.finalRotateDurationValues =
      elementInput + SPRITE_ELEMENT_FINAL_ROTATE_DURATION_OFFSET * elementInputStride;
  view.finalRotatePrevTargetValues =
      elementInput + SPRITE_ELEMENT_FINAL_ROTATE_PREV_TARGET_OFFSET * elementInputStride;
  view.finalRotateConfigDurationValues =
      elementInput + SPRITE_ELEMENT_FINAL_ROTATE_CONFIG_DURATION_OFFSET * elementInputStride;
  view.finalShiftAngleDegValues =
      elementInput + SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_DEG_OFFSET * elementInputStride;
  view.finalShiftAngleFromValues =
      elementInput + SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_FROM_OFFSET * elementInputStride;
  view.finalShiftAngleToValues =
      elementInput + SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_TO_OFFSET * elementInputStride;
  view.finalShiftAngleStartValues =
      elementInput + SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_START_TIMESTAMP_OFFSET *
          elementInputStride;
  view.finalShiftAngleDurationValues =
      elementInput + SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_DURATION_OFFSET *
          elementInputStride;
  view.finalShiftAnglePrevTargetValues =
      elementInput + SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_PREV_TARGET_OFFSET *
          elementInputStride;
  view.finalShiftAngleConfigDurationValues =
      elementInput + SPRITE_ELEMENT_FINAL_SHIFT_ANGLE_CONFIG_DURATION_OFFSET *
          elementInputStride;
  view.autoFlipXValues =
      elementInput + SPRITE_ELEMENT_AUTO_FLIP_X_OFFSET * elementInputStride;
  view.autoFlipXFromValues =
      elementInput + SPRITE_ELEMENT_AUTO_FLIP_X_FROM_OFFSET * elementInputStride;
  view.autoFlipXToValues =
      elementInput + SPRITE_ELEMENT_AUTO_FLIP_X_TO_OFFSET * elementInputStride;
  view.autoFlipXPrevTargetValues =
      elementInput + SPRITE_ELEMENT_AUTO_FLIP_X_PREV_TARGET_OFFSET *
          elementInputStride;
  view.autoFlipYValues =
      elementInput + SPRITE_ELEMENT_AUTO_FLIP_Y_OFFSET * elementInputStride;
  view.autoFlipYFromValues =
      elementInput + SPRITE_ELEMENT_AUTO_FLIP_Y_FROM_OFFSET * elementInputStride;
  view.autoFlipYToValues =
      elementInput + SPRITE_ELEMENT_AUTO_FLIP_Y_TO_OFFSET * elementInputStride;
  view.autoFlipYPrevTargetValues =
      elementInput + SPRITE_ELEMENT_AUTO_FLIP_Y_PREV_TARGET_OFFSET *
          elementInputStride;
  view.autoFlipStartValues =
      elementInput + SPRITE_ELEMENT_AUTO_FLIP_START_TIMESTAMP_OFFSET *
          elementInputStride;
  view.autoFlipDurationValues =
      elementInput + SPRITE_ELEMENT_AUTO_FLIP_DURATION_OFFSET *
          elementInputStride;
  view.opacityEasingValues =
      elementInput + SPRITE_ELEMENT_OPACITY_EASING_OFFSET * elementInputStride;
  view.opacityEasingParam0Values =
      elementInput + SPRITE_ELEMENT_OPACITY_EASING_PARAM0_OFFSET * elementInputStride;
  view.opacityEasingParam1Values =
      elementInput + SPRITE_ELEMENT_OPACITY_EASING_PARAM1_OFFSET * elementInputStride;
  view.opacityEasingParam2Values =
      elementInput + SPRITE_ELEMENT_OPACITY_EASING_PARAM2_OFFSET * elementInputStride;
  view.opacityEasingParam3Values =
      elementInput + SPRITE_ELEMENT_OPACITY_EASING_PARAM3_OFFSET * elementInputStride;
  view.opacityConfigDurationValues =
      elementInput + SPRITE_ELEMENT_OPACITY_CONFIG_DURATION_OFFSET * elementInputStride;
  view.renderOpacityConfigDurationValues =
      elementInput + SPRITE_ELEMENT_RENDER_OPACITY_CONFIG_DURATION_OFFSET * elementInputStride;
  view.renderOpacityEasingValues =
      elementInput + SPRITE_ELEMENT_RENDER_OPACITY_EASING_OFFSET * elementInputStride;
  view.renderOpacityEasingParam0Values =
      elementInput + SPRITE_ELEMENT_RENDER_OPACITY_EASING_PARAM0_OFFSET * elementInputStride;
  view.renderOpacityEasingParam1Values =
      elementInput + SPRITE_ELEMENT_RENDER_OPACITY_EASING_PARAM1_OFFSET * elementInputStride;
  view.renderOpacityEasingParam2Values =
      elementInput + SPRITE_ELEMENT_RENDER_OPACITY_EASING_PARAM2_OFFSET * elementInputStride;
  view.renderOpacityEasingParam3Values =
      elementInput + SPRITE_ELEMENT_RENDER_OPACITY_EASING_PARAM3_OFFSET * elementInputStride;
  view.rotationEasingValues =
      elementInput + SPRITE_ELEMENT_ROTATE_EASING_OFFSET * elementInputStride;
  view.rotationEasingParam0Values =
      elementInput + SPRITE_ELEMENT_ROTATE_EASING_PARAM0_OFFSET * elementInputStride;
  view.rotationEasingParam1Values =
      elementInput + SPRITE_ELEMENT_ROTATE_EASING_PARAM1_OFFSET * elementInputStride;
  view.rotationEasingParam2Values =
      elementInput + SPRITE_ELEMENT_ROTATE_EASING_PARAM2_OFFSET * elementInputStride;
  view.rotationEasingParam3Values =
      elementInput + SPRITE_ELEMENT_ROTATE_EASING_PARAM3_OFFSET * elementInputStride;
  view.shiftDistanceEasingValues =
      elementInput + SPRITE_ELEMENT_SHIFT_DISTANCE_EASING_OFFSET * elementInputStride;
  view.shiftDistanceEasingParam0Values =
      elementInput + SPRITE_ELEMENT_SHIFT_DISTANCE_EASING_PARAM0_OFFSET * elementInputStride;
  view.shiftDistanceEasingParam1Values =
      elementInput + SPRITE_ELEMENT_SHIFT_DISTANCE_EASING_PARAM1_OFFSET * elementInputStride;
  view.shiftDistanceEasingParam2Values =
      elementInput + SPRITE_ELEMENT_SHIFT_DISTANCE_EASING_PARAM2_OFFSET * elementInputStride;
  view.shiftDistanceEasingParam3Values =
      elementInput + SPRITE_ELEMENT_SHIFT_DISTANCE_EASING_PARAM3_OFFSET * elementInputStride;
  view.shiftAngleDegEasingValues =
      elementInput + SPRITE_ELEMENT_SHIFT_ANGLE_DEG_EASING_OFFSET * elementInputStride;
  view.shiftAngleDegEasingParam0Values =
      elementInput + SPRITE_ELEMENT_SHIFT_ANGLE_DEG_EASING_PARAM0_OFFSET * elementInputStride;
  view.shiftAngleDegEasingParam1Values =
      elementInput + SPRITE_ELEMENT_SHIFT_ANGLE_DEG_EASING_PARAM1_OFFSET * elementInputStride;
  view.shiftAngleDegEasingParam2Values =
      elementInput + SPRITE_ELEMENT_SHIFT_ANGLE_DEG_EASING_PARAM2_OFFSET * elementInputStride;
  view.shiftAngleDegEasingParam3Values =
      elementInput + SPRITE_ELEMENT_SHIFT_ANGLE_DEG_EASING_PARAM3_OFFSET * elementInputStride;
  view.rotationFromValues =
      elementInput + SPRITE_ELEMENT_ROTATE_FROM_OFFSET * elementInputStride;
  view.rotationToValues = elementInput + SPRITE_ELEMENT_ROTATE_TO_OFFSET * elementInputStride;
  view.rotationStartValues =
      elementInput + SPRITE_ELEMENT_ROTATE_START_TIMESTAMP_OFFSET * elementInputStride;
  view.rotationDurationValues =
      elementInput + SPRITE_ELEMENT_ROTATE_DURATION_OFFSET * elementInputStride;
  view.rotationModeValues =
      elementInput + SPRITE_ELEMENT_ROTATE_MODE_OFFSET * elementInputStride;
  view.opacityFromValues =
      elementInput + SPRITE_ELEMENT_OPACITY_FROM_OFFSET * elementInputStride;
  view.opacityToValues = elementInput + SPRITE_ELEMENT_OPACITY_TO_OFFSET * elementInputStride;
  view.opacityStartValues =
      elementInput + SPRITE_ELEMENT_OPACITY_START_TIMESTAMP_OFFSET * elementInputStride;
  view.opacityDurationValues =
      elementInput + SPRITE_ELEMENT_OPACITY_DURATION_OFFSET * elementInputStride;
  view.renderOpacityFromValues =
      elementInput + SPRITE_ELEMENT_RENDER_OPACITY_FROM_OFFSET * elementInputStride;
  view.renderOpacityToValues =
      elementInput + SPRITE_ELEMENT_RENDER_OPACITY_TO_OFFSET * elementInputStride;
  view.renderOpacityStartValues =
      elementInput + SPRITE_ELEMENT_RENDER_OPACITY_START_TIMESTAMP_OFFSET *
          elementInputStride;
  view.renderOpacityDurationValues =
      elementInput + SPRITE_ELEMENT_RENDER_OPACITY_DURATION_OFFSET *
          elementInputStride;
  view.shiftDistanceFromValues =
      elementInput + SPRITE_ELEMENT_SHIFT_DISTANCE_FROM_OFFSET * elementInputStride;
  view.shiftDistanceToValues =
      elementInput + SPRITE_ELEMENT_SHIFT_DISTANCE_TO_OFFSET * elementInputStride;
  view.shiftDistanceStartValues =
      elementInput + SPRITE_ELEMENT_SHIFT_DISTANCE_START_TIMESTAMP_OFFSET * elementInputStride;
  view.shiftDistanceDurationValues =
      elementInput + SPRITE_ELEMENT_SHIFT_DISTANCE_DURATION_OFFSET * elementInputStride;
  view.shiftAngleDegFromValues =
      elementInput + SPRITE_ELEMENT_SHIFT_ANGLE_DEG_FROM_OFFSET * elementInputStride;
  view.shiftAngleDegToValues =
      elementInput + SPRITE_ELEMENT_SHIFT_ANGLE_DEG_TO_OFFSET * elementInputStride;
  view.shiftAngleDegStartValues =
      elementInput + SPRITE_ELEMENT_SHIFT_ANGLE_DEG_START_TIMESTAMP_OFFSET * elementInputStride;
  view.shiftAngleDegDurationValues =
      elementInput + SPRITE_ELEMENT_SHIFT_ANGLE_DEG_DURATION_OFFSET * elementInputStride;
  view.shiftAngleDegModeValues =
      elementInput + SPRITE_ELEMENT_SHIFT_ANGLE_DEG_MODE_OFFSET * elementInputStride;
  view.shiftDistanceValues =
      elementInput + SPRITE_ELEMENT_SHIFT_DISTANCE_OFFSET * elementInputStride;
  view.shiftAngleDegValues =
      elementInput + SPRITE_ELEMENT_SHIFT_ANGLE_DEG_OFFSET * elementInputStride;
  return view;
}

PolylineInputView makePolylineInputView(
    scalar_t *polylineInput,
    int polylineInputStride) {
  PolylineInputView view{};
  view.layerValues = polylineInput + POLYLINE_LAYER_OFFSET * polylineInputStride;
  view.opacityValues = polylineInput + POLYLINE_OPACITY_OFFSET * polylineInputStride;
  view.opacityFromValues =
      polylineInput + POLYLINE_OPACITY_FROM_OFFSET * polylineInputStride;
  view.opacityToValues =
      polylineInput + POLYLINE_OPACITY_TO_OFFSET * polylineInputStride;
  view.opacityStartValues =
      polylineInput + POLYLINE_OPACITY_START_TIMESTAMP_OFFSET * polylineInputStride;
  view.opacityDurationValues =
      polylineInput + POLYLINE_OPACITY_DURATION_OFFSET * polylineInputStride;
  view.opacityModeValues =
      polylineInput + POLYLINE_OPACITY_MODE_OFFSET * polylineInputStride;
  view.opacityEasingValues =
      polylineInput + POLYLINE_OPACITY_EASING_OFFSET * polylineInputStride;
  view.opacityEasingParam0Values =
      polylineInput + POLYLINE_OPACITY_EASING_PARAM0_OFFSET * polylineInputStride;
  view.opacityEasingParam1Values =
      polylineInput + POLYLINE_OPACITY_EASING_PARAM1_OFFSET * polylineInputStride;
  view.opacityEasingParam2Values =
      polylineInput + POLYLINE_OPACITY_EASING_PARAM2_OFFSET * polylineInputStride;
  view.opacityEasingParam3Values =
      polylineInput + POLYLINE_OPACITY_EASING_PARAM3_OFFSET * polylineInputStride;
  view.opacityPrevTargetValues =
      polylineInput + POLYLINE_OPACITY_PREV_TARGET_OFFSET * polylineInputStride;
  view.color0RValues =
      polylineInput + POLYLINE_COLOR0_R_OFFSET * polylineInputStride;
  view.color0GValues =
      polylineInput + POLYLINE_COLOR0_G_OFFSET * polylineInputStride;
  view.color0BValues =
      polylineInput + POLYLINE_COLOR0_B_OFFSET * polylineInputStride;
  view.color0AValues =
      polylineInput + POLYLINE_COLOR0_A_OFFSET * polylineInputStride;
  view.color1RValues =
      polylineInput + POLYLINE_COLOR1_R_OFFSET * polylineInputStride;
  view.color1GValues =
      polylineInput + POLYLINE_COLOR1_G_OFFSET * polylineInputStride;
  view.color1BValues =
      polylineInput + POLYLINE_COLOR1_B_OFFSET * polylineInputStride;
  view.color1AValues =
      polylineInput + POLYLINE_COLOR1_A_OFFSET * polylineInputStride;
  view.repeatLengthValues =
      polylineInput + POLYLINE_REPEAT_LENGTH_OFFSET * polylineInputStride;
  view.joinCorrectionModeValues =
      polylineInput + POLYLINE_JOIN_CORRECTION_MODE_OFFSET * polylineInputStride;
  view.joinCorrectionIntermediatePointCountValues =
      polylineInput +
      POLYLINE_JOIN_CORRECTION_INTERMEDIATE_POINT_COUNT_OFFSET *
          polylineInputStride;
  view.capCorrectionModeValues =
      polylineInput + POLYLINE_CAP_CORRECTION_MODE_OFFSET * polylineInputStride;
  view.capCorrectionPointCountValues =
      polylineInput + POLYLINE_CAP_CORRECTION_POINT_COUNT_OFFSET * polylineInputStride;
  view.nodeOffsetValues =
      polylineInput + POLYLINE_NODE_OFFSET_OFFSET * polylineInputStride;
  view.nodeCountValues =
      polylineInput + POLYLINE_NODE_COUNT_OFFSET * polylineInputStride;
  return view;
}

PolylineNodeInputView makePolylineNodeInputView(
    scalar_t *polylineNodeInput,
    int polylineNodeInputStride) {
  PolylineNodeInputView view{};
  view.xValues =
      polylineNodeInput + POLYLINE_NODE_X_OFFSET * polylineNodeInputStride;
  view.yValues =
      polylineNodeInput + POLYLINE_NODE_Y_OFFSET * polylineNodeInputStride;
  view.thicknessValues =
      polylineNodeInput + POLYLINE_NODE_THICKNESS_OFFSET * polylineNodeInputStride;
  return view;
}

} // namespace msp_wasm
