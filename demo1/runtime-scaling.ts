// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type { DistanceScalingOptions } from 'massive-sprites';

export type RuntimeScalingLimitPresetId =
  | 'unlimited'
  | 'near'
  | 'balanced'
  | 'wide';

export interface RuntimeScalingLimitPreset {
  readonly id: RuntimeScalingLimitPresetId;
  readonly label: string;
  readonly spriteScaling: DistanceScalingOptions;
  readonly polylineScaling: DistanceScalingOptions;
}

const DEFAULT_RUNTIME_SCALING_LIMIT_PRESET: RuntimeScalingLimitPreset = {
  id: 'unlimited',
  label: 'Unlimited',
  spriteScaling: { maxScaleDistance: Number.POSITIVE_INFINITY },
  polylineScaling: { maxScaleDistance: Number.POSITIVE_INFINITY },
};

const cloneDistanceScalingOptions = (
  options: DistanceScalingOptions
): DistanceScalingOptions => ({
  ...(options.minScaleDistance !== undefined
    ? { minScaleDistance: options.minScaleDistance }
    : {}),
  ...(options.maxScaleDistance !== undefined
    ? { maxScaleDistance: options.maxScaleDistance }
    : {}),
});

export const RUNTIME_SCALING_LIMIT_PRESETS: readonly RuntimeScalingLimitPreset[] =
  [
    DEFAULT_RUNTIME_SCALING_LIMIT_PRESET,
    {
      id: 'near',
      label: 'Near Clamp (6000-120000)',
      spriteScaling: { minScaleDistance: 6000, maxScaleDistance: 120000 },
      polylineScaling: { minScaleDistance: 6000, maxScaleDistance: 120000 },
    },
    {
      id: 'balanced',
      label: 'Balanced Clamp (12000-240000)',
      spriteScaling: { minScaleDistance: 12000, maxScaleDistance: 240000 },
      polylineScaling: { minScaleDistance: 12000, maxScaleDistance: 240000 },
    },
    {
      id: 'wide',
      label: 'Wide Clamp (24000-480000)',
      spriteScaling: { minScaleDistance: 24000, maxScaleDistance: 480000 },
      polylineScaling: { minScaleDistance: 24000, maxScaleDistance: 480000 },
    },
  ] as const;

export const DEFAULT_RUNTIME_SCALING_LIMIT_PRESET_ID: RuntimeScalingLimitPresetId =
  'unlimited';

export const resolveRuntimeScalingLimitPreset = (
  value: string
): RuntimeScalingLimitPreset => {
  const preset = RUNTIME_SCALING_LIMIT_PRESETS.find(
    (entry) => entry.id === value
  );
  if (!preset) {
    return {
      id: DEFAULT_RUNTIME_SCALING_LIMIT_PRESET.id,
      label: DEFAULT_RUNTIME_SCALING_LIMIT_PRESET.label,
      spriteScaling: cloneDistanceScalingOptions(
        DEFAULT_RUNTIME_SCALING_LIMIT_PRESET.spriteScaling
      ),
      polylineScaling: cloneDistanceScalingOptions(
        DEFAULT_RUNTIME_SCALING_LIMIT_PRESET.polylineScaling
      ),
    };
  }
  return {
    id: preset.id,
    label: preset.label,
    spriteScaling: cloneDistanceScalingOptions(preset.spriteScaling),
    polylineScaling: cloneDistanceScalingOptions(preset.polylineScaling),
  };
};
