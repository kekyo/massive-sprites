// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it } from 'vitest';

import * as cl from '../src/generated/command-layout.generated';
import * as wl from '../src/generated/wasm-layout.generated';

describe('layout ordering', () => {
  it('places autoDirection command fields after rotation interpolation block', () => {
    expect(cl.COMMAND_ELEMENT_AUTO_DIRECTION_MODE_HAS_OFFSET).toBeGreaterThan(
      cl.COMMAND_ROTATION_PARAM3_OFFSET
    );
    expect(
      cl.COMMAND_ELEMENT_AUTO_DIRECTION_MIN_DISTANCE_OFFSET
    ).toBeGreaterThan(cl.COMMAND_ROTATION_PARAM3_OFFSET);
  });

  it('places element optional command fields before animated fields', () => {
    expect(cl.COMMAND_ELEMENT_ORDER_HAS_OFFSET).toBeLessThan(
      cl.COMMAND_ELEMENT_SHIFT_DISTANCE_HAS_OFFSET
    );
    expect(cl.COMMAND_ELEMENT_LAYER_HAS_OFFSET).toBeLessThan(
      cl.COMMAND_ELEMENT_SHIFT_DISTANCE_HAS_OFFSET
    );
    expect(cl.COMMAND_ELEMENT_RENDER_MODE_HAS_OFFSET).toBeLessThan(
      cl.COMMAND_ELEMENT_SHIFT_DISTANCE_HAS_OFFSET
    );
  });

  it('groups camera base values before interpolation and flags at the end', () => {
    expect(wl.CAMERA_VIEWPORT_ASPECT_OFFSET).toBeLessThan(
      wl.CAMERA_POSITION_X_FROM_OFFSET
    );
    expect(wl.CAMERA_SPRITE_SCALING_MIN_DISTANCE_OFFSET).toBeGreaterThan(
      wl.CAMERA_VIEWPORT_ASPECT_OFFSET
    );
    expect(wl.CAMERA_POLYLINE_SCALING_MAX_DISTANCE_OFFSET).toBeLessThan(
      wl.CAMERA_POSITION_X_FROM_OFFSET
    );
    expect(wl.CAMERA_POSITION_X_HAS_INTERPOLATION_OFFSET).toBeGreaterThan(
      wl.CAMERA_FOV_Y_PREV_TARGET_OFFSET
    );
  });

  it('keeps element animation groups ordered by update sequence', () => {
    expect(wl.SPRITE_ELEMENT_OPACITY_OFFSET).toBeLessThan(
      wl.SPRITE_ELEMENT_ROTATE_DEG_OFFSET
    );
    expect(wl.SPRITE_ELEMENT_ROTATE_DEG_OFFSET).toBeLessThan(
      wl.SPRITE_ELEMENT_SCALE_OFFSET
    );
    expect(wl.SPRITE_ELEMENT_SCALE_OFFSET).toBeLessThan(
      wl.SPRITE_ELEMENT_ANCHOR_X_OFFSET
    );
    expect(wl.SPRITE_ELEMENT_ANCHOR_X_OFFSET).toBeLessThan(
      wl.SPRITE_ELEMENT_SHIFT_DISTANCE_OFFSET
    );
    expect(wl.SPRITE_ELEMENT_SHIFT_ANGLE_DEG_OFFSET).toBeLessThan(
      wl.SPRITE_ELEMENT_AUTO_DIRECTION_MODE_OFFSET
    );
  });

  it('puts state element render info after rotation runtime fields', () => {
    expect(wl.STATE_ELEMENT_TEX_INDEX_OFFSET).toBeGreaterThan(
      wl.STATE_ELEMENT_FINAL_ROTATION_DELTA_DEG_OFFSET
    );
  });

  it('places polyline layer after opacity block', () => {
    expect(wl.POLYLINE_LAYER_OFFSET).toBeGreaterThan(
      wl.POLYLINE_OPACITY_EASING_PARAM3_OFFSET
    );
  });

  it('keeps sprite render opacity runtime before visibility distance', () => {
    expect(wl.SPRITE_RENDER_OPACITY_OFFSET).toBeGreaterThan(
      wl.SPRITE_PARENT_OPACITY_EASING_PARAM3_OFFSET
    );
    expect(wl.SPRITE_VISIBILITY_DISTANCE_OFFSET).toBeGreaterThan(
      wl.SPRITE_RENDER_OPACITY_EASING_PARAM3_OFFSET
    );
    expect(wl.SPRITE_LOD_VISIBLE_OFFSET).toBeGreaterThan(
      wl.SPRITE_VISIBILITY_DISTANCE_OFFSET
    );
    expect(wl.SPRITE_Z_OFFSET).toBeGreaterThan(wl.SPRITE_LOD_VISIBLE_OFFSET);
    expect(wl.STATE_SPRITE_VISIBILITY_DISTANCE_OFFSET).toBeGreaterThan(
      wl.STATE_SPRITE_OPACITY_EASING_PARAM1_OFFSET
    );
  });

  it('exposes shared protocol enums from generated layouts', () => {
    expect(wl.AUTO_DIRECTION_MODE_NONE).toBe(0);
    expect(wl.AUTO_DIRECTION_MODE_ROTATION).toBe(1);
    expect(wl.AUTO_DIRECTION_MODE_FLIPPING).toBe(2);
    expect(wl.AUTO_DIRECTION_SPACE_WORLD).toBe(0);
    expect(wl.AUTO_DIRECTION_SPACE_PARENT_LOCAL).toBe(1);
    expect(wl.POLYLINE_CORRECTION_MODE_NONE).toBe(0);
    expect(wl.POLYLINE_CORRECTION_MODE_FAN).toBe(1);
    expect(cl.COMMAND_BORDER_MODE_KEEP).toBe(0);
    expect(cl.COMMAND_BORDER_MODE_CLEAR).toBe(1);
    expect(cl.COMMAND_BORDER_MODE_SET).toBe(2);
    expect(cl.COMMAND_POLYLINE_CORRECTION_MODE_NONE).toBe(
      wl.POLYLINE_CORRECTION_MODE_NONE
    );
    expect(cl.COMMAND_POLYLINE_CORRECTION_MODE_FAN).toBe(
      wl.POLYLINE_CORRECTION_MODE_FAN
    );
  });
});
