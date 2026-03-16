// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { readFile } from 'fs/promises';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';
import { loadWasmModule } from '../src/wasm';

describe('compute.wasm exports', () => {
  it('exports command buffer APIs for f32/f64', async () => {
    const wasmPath = resolve(import.meta.dirname, '../src/wasm/compute.wasm');
    const bytes = await readFile(wasmPath);
    const wasmModule = await loadWasmModule(bytes);
    const exports = wasmModule.exports;

    const memAlloc = exports.mem_alloc;
    const memFree = exports.mem_free;
    const memRealloc = exports.mem_realloc;

    const createContextF32 = exports.create_context_f32;
    const releaseContextF32 = exports.release_context_f32;
    const setCommandBufferF32 = exports.set_command_buffer_f32;
    const setResultBufferF32 = exports.set_result_buffer_f32;
    const setApplyStatsBufferF32 = exports.set_apply_stats_buffer_f32;
    const setComputeStatsBufferF32 = exports.set_compute_stats_buffer_f32;
    const setPickMaskPageTableBufferF32 =
      exports.set_pick_mask_page_table_buffer_f32;
    const setPickMaskWordBufferF32 = exports.set_pick_mask_word_buffer_f32;
    const setScalingOptionsF32 = exports.set_scaling_options_f32;
    const applyCommandsF32 = exports.apply_commands_f32;
    const getSpriteStateF32 = exports.get_sprite_state_f32;
    const getPolylineStateF32 = exports.get_polyline_state_f32;
    const getCameraStateF32 = exports.get_camera_state_f32;
    const screenToWorldOnPlaneF32 = exports.screen_to_world_on_plane_f32;
    const screenToWorldOnPlaneWithCameraF32 =
      exports.screen_to_world_on_plane_with_camera_f32;
    const projectWorldToViewportF32 = exports.project_world_to_viewport_f32;
    const projectWorldToViewportWithCameraF32 =
      exports.project_world_to_viewport_with_camera_f32;
    const computeVerticesF32 = exports.compute_vertices_f32;
    const pickAtF32 = exports.pick_at_f32;
    const pickAtCachedF32 = exports.pick_at_cached_f32;
    const setEntryDebugEnabledF32 = exports.set_entry_debug_enabled_f32;
    const setElementAnimDetailEnabledF32 =
      exports.set_element_anim_detail_enabled_f32;
    const getEntryDebugF32 = exports.get_entry_debug_f32;
    const setCameraTrackingF32 = exports.set_camera_tracking_f32;
    const clearCameraTrackingF32 = exports.clear_camera_tracking_f32;

    const createContextF64 = exports.create_context_f64;
    const releaseContextF64 = exports.release_context_f64;
    const setCommandBufferF64 = exports.set_command_buffer_f64;
    const setResultBufferF64 = exports.set_result_buffer_f64;
    const setApplyStatsBufferF64 = exports.set_apply_stats_buffer_f64;
    const setComputeStatsBufferF64 = exports.set_compute_stats_buffer_f64;
    const setPickMaskPageTableBufferF64 =
      exports.set_pick_mask_page_table_buffer_f64;
    const setPickMaskWordBufferF64 = exports.set_pick_mask_word_buffer_f64;
    const setScalingOptionsF64 = exports.set_scaling_options_f64;
    const applyCommandsF64 = exports.apply_commands_f64;
    const getSpriteStateF64 = exports.get_sprite_state_f64;
    const getPolylineStateF64 = exports.get_polyline_state_f64;
    const getCameraStateF64 = exports.get_camera_state_f64;
    const screenToWorldOnPlaneF64 = exports.screen_to_world_on_plane_f64;
    const screenToWorldOnPlaneWithCameraF64 =
      exports.screen_to_world_on_plane_with_camera_f64;
    const projectWorldToViewportF64 = exports.project_world_to_viewport_f64;
    const projectWorldToViewportWithCameraF64 =
      exports.project_world_to_viewport_with_camera_f64;
    const computeVerticesF64 = exports.compute_vertices_f64;
    const pickAtF64 = exports.pick_at_f64;
    const pickAtCachedF64 = exports.pick_at_cached_f64;
    const setEntryDebugEnabledF64 = exports.set_entry_debug_enabled_f64;
    const setElementAnimDetailEnabledF64 =
      exports.set_element_anim_detail_enabled_f64;
    const getEntryDebugF64 = exports.get_entry_debug_f64;
    const setCameraTrackingF64 = exports.set_camera_tracking_f64;
    const clearCameraTrackingF64 = exports.clear_camera_tracking_f64;

    expect(typeof memAlloc).toBe('function');
    expect(typeof memFree).toBe('function');
    expect(typeof memRealloc).toBe('function');
    expect(typeof createContextF32).toBe('function');
    expect(typeof releaseContextF32).toBe('function');
    expect(typeof setCommandBufferF32).toBe('function');
    expect(typeof setResultBufferF32).toBe('function');
    expect(typeof setApplyStatsBufferF32).toBe('function');
    expect(typeof setComputeStatsBufferF32).toBe('function');
    expect(typeof setPickMaskPageTableBufferF32).toBe('function');
    expect(typeof setPickMaskWordBufferF32).toBe('function');
    expect(typeof setScalingOptionsF32).toBe('function');
    expect(typeof applyCommandsF32).toBe('function');
    expect(typeof getSpriteStateF32).toBe('function');
    expect(typeof getPolylineStateF32).toBe('function');
    expect(typeof getCameraStateF32).toBe('function');
    expect(typeof screenToWorldOnPlaneF32).toBe('function');
    expect(typeof screenToWorldOnPlaneWithCameraF32).toBe('function');
    expect(typeof projectWorldToViewportF32).toBe('function');
    expect(typeof projectWorldToViewportWithCameraF32).toBe('function');
    expect(typeof computeVerticesF32).toBe('function');
    expect(typeof pickAtF32).toBe('function');
    expect(typeof pickAtCachedF32).toBe('function');
    expect(typeof setEntryDebugEnabledF32).toBe('function');
    expect(typeof setElementAnimDetailEnabledF32).toBe('function');
    expect(typeof getEntryDebugF32).toBe('function');
    expect(typeof setCameraTrackingF32).toBe('function');
    expect(typeof clearCameraTrackingF32).toBe('function');
    expect(typeof createContextF64).toBe('function');
    expect(typeof releaseContextF64).toBe('function');
    expect(typeof setCommandBufferF64).toBe('function');
    expect(typeof setResultBufferF64).toBe('function');
    expect(typeof setApplyStatsBufferF64).toBe('function');
    expect(typeof setComputeStatsBufferF64).toBe('function');
    expect(typeof setPickMaskPageTableBufferF64).toBe('function');
    expect(typeof setPickMaskWordBufferF64).toBe('function');
    expect(typeof setScalingOptionsF64).toBe('function');
    expect(typeof applyCommandsF64).toBe('function');
    expect(typeof getSpriteStateF64).toBe('function');
    expect(typeof getPolylineStateF64).toBe('function');
    expect(typeof getCameraStateF64).toBe('function');
    expect(typeof screenToWorldOnPlaneF64).toBe('function');
    expect(typeof screenToWorldOnPlaneWithCameraF64).toBe('function');
    expect(typeof projectWorldToViewportF64).toBe('function');
    expect(typeof projectWorldToViewportWithCameraF64).toBe('function');
    expect(typeof computeVerticesF64).toBe('function');
    expect(typeof pickAtF64).toBe('function');
    expect(typeof pickAtCachedF64).toBe('function');
    expect(typeof setEntryDebugEnabledF64).toBe('function');
    expect(typeof setElementAnimDetailEnabledF64).toBe('function');
    expect(typeof getEntryDebugF64).toBe('function');
    expect(typeof setCameraTrackingF64).toBe('function');
    expect(typeof clearCameraTrackingF64).toBe('function');
  });
});
