// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RUNTIME_SCALING_LIMIT_PRESET_ID,
  RUNTIME_SCALING_LIMIT_PRESETS,
  resolveRuntimeScalingLimitPreset,
} from './runtime-scaling';

describe('runtime scaling presets', () => {
  it('defaults to unlimited preset', () => {
    expect(DEFAULT_RUNTIME_SCALING_LIMIT_PRESET_ID).toBe('unlimited');
    const preset = resolveRuntimeScalingLimitPreset(
      DEFAULT_RUNTIME_SCALING_LIMIT_PRESET_ID
    );

    expect(preset.id).toBe('unlimited');
    expect(preset.spriteScaling.maxScaleDistance).toBe(
      Number.POSITIVE_INFINITY
    );
    expect(preset.polylineScaling.maxScaleDistance).toBe(
      Number.POSITIVE_INFINITY
    );
  });

  it('includes finite clamp presets for runtime switching', () => {
    expect(RUNTIME_SCALING_LIMIT_PRESETS).toHaveLength(4);
    expect(RUNTIME_SCALING_LIMIT_PRESETS.map((preset) => preset.id)).toContain(
      'near'
    );
    expect(RUNTIME_SCALING_LIMIT_PRESETS.map((preset) => preset.id)).toContain(
      'balanced'
    );
    expect(RUNTIME_SCALING_LIMIT_PRESETS.map((preset) => preset.id)).toContain(
      'wide'
    );
  });

  it('falls back to the default preset for unknown ids', () => {
    const preset = resolveRuntimeScalingLimitPreset('missing');

    expect(preset.id).toBe(DEFAULT_RUNTIME_SCALING_LIMIT_PRESET_ID);
  });

  it('returns cloned scaling objects', () => {
    const preset = resolveRuntimeScalingLimitPreset('near');
    const definition = RUNTIME_SCALING_LIMIT_PRESETS.find(
      (entry) => entry.id === 'near'
    );

    if (!definition) {
      throw new Error('Missing near scaling preset.');
    }

    expect(preset.spriteScaling).toEqual(definition.spriteScaling);
    expect(preset.polylineScaling).toEqual(definition.polylineScaling);
    expect(preset.spriteScaling).not.toBe(preset.polylineScaling);
    expect(preset.spriteScaling).not.toBe(definition.spriteScaling);
    expect(preset.polylineScaling).not.toBe(definition.polylineScaling);
  });
});
