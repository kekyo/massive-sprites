// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { describe, expect, it } from 'vitest';
import {
  applyOpacityModeToElementUpdate,
  applyRotationModeToElementUpdate,
  resolveElementOpacity,
  shouldAnimateOpacityWaveFromModes,
  shouldAdvanceElementRotatePhase,
  shouldAdvanceElementShiftPhase,
} from './sprite-element-motion';

describe('sprite-element-motion helpers', () => {
  it('advances shift phase only while orbit mode is active', () => {
    expect(shouldAdvanceElementShiftPhase(0, 'orbit')).toBe(true);
    expect(shouldAdvanceElementShiftPhase(1, 'orbit')).toBe(true);
    expect(shouldAdvanceElementShiftPhase(0, 'fixed')).toBe(false);
    expect(shouldAdvanceElementShiftPhase(2, 'fixed')).toBe(false);
  });

  it('does not advance hidden secondary and tertiary elements for shift phase', () => {
    expect(shouldAdvanceElementShiftPhase(1, 'none')).toBe(false);
    expect(shouldAdvanceElementShiftPhase(2, 'none')).toBe(false);
  });

  it('advances rotation phase for visible elements regardless of interpolation mode', () => {
    expect(shouldAdvanceElementRotatePhase(0, 'orbit', 'none')).toBe(true);
    expect(shouldAdvanceElementRotatePhase(0, 'orbit', 'linear')).toBe(true);
    expect(shouldAdvanceElementRotatePhase(1, 'fixed', 'sigmoid')).toBe(true);
    expect(shouldAdvanceElementRotatePhase(2, 'fixed', 'bounce')).toBe(true);
  });

  it('does not advance hidden secondary and tertiary elements for rotation phase', () => {
    expect(shouldAdvanceElementRotatePhase(1, 'none', 'none')).toBe(false);
    expect(shouldAdvanceElementRotatePhase(2, 'none', 'linear')).toBe(false);
  });

  it('keeps rotation value as-is when rotation mode is none (skip interpolation)', () => {
    expect(
      applyRotationModeToElementUpdate('none', {
        imageId: 'curve',
        rotation: {
          value: 90,
          interpolation: {
            mode: 'feedback',
            durationMs: 500,
            easing: { type: 'linear' },
          },
        },
      })
    ).toEqual({
      imageId: 'curve',
      rotation: {
        value: 90,
        interpolation: {
          mode: 'feedback',
          durationMs: 500,
          easing: { type: 'linear' },
        },
      },
    });
    expect(applyRotationModeToElementUpdate('none', null)).toBe(null);
    expect(applyRotationModeToElementUpdate('none', undefined)).toBe(undefined);
  });

  it('resolves wave opacity with the same phase pattern as movement', () => {
    expect(resolveElementOpacity('none', 1, true)).toBe(1);
    expect(resolveElementOpacity('wave', 1, true)).toBe(1);
    expect(resolveElementOpacity('wave', 0, true)).toBe(0.75);
    expect(resolveElementOpacity('wave', -1, true)).toBe(0.5);
    expect(resolveElementOpacity('wave', 0, false)).toBe(1);
  });

  it('applies opacity mode to element updates', () => {
    const interpolation = {
      mode: 'feedback' as const,
      durationMs: 500,
      easing: { type: 'linear' as const },
    };
    expect(
      applyOpacityModeToElementUpdate('wave', interpolation, -1, true, {
        imageId: 'curve',
      })
    ).toEqual({
      imageId: 'curve',
      opacity: {
        value: 0.5,
        interpolation,
      },
    });
    expect(
      applyOpacityModeToElementUpdate('none', undefined, 1, true, {
        imageId: 'curve',
      })
    ).toEqual({
      imageId: 'curve',
      opacity: {
        value: 1,
      },
    });
    expect(
      applyOpacityModeToElementUpdate('none', interpolation, 1, true, {
        imageId: null,
      })
    ).toEqual({
      imageId: null,
      opacity: {
        value: 0,
        interpolation,
      },
    });
    expect(
      applyOpacityModeToElementUpdate('wave', interpolation, 1, true, {
        imageId: 'curve',
        opacity: {
          value: 0,
          interpolation: null,
        },
      })
    ).toEqual({
      imageId: 'curve',
      opacity: {
        value: 0,
        interpolation,
      },
    });
    expect(
      applyOpacityModeToElementUpdate('wave', undefined, 0, true, null)
    ).toBe(null);
    expect(
      applyOpacityModeToElementUpdate('wave', undefined, 0, true, undefined)
    ).toBe(undefined);
  });

  it('detects whether opacity wave animation is required by element modes', () => {
    expect(shouldAnimateOpacityWaveFromModes(['none', 'none', 'none'])).toBe(
      false
    );
    expect(shouldAnimateOpacityWaveFromModes(['none', 'wave', 'none'])).toBe(
      true
    );
  });
});
