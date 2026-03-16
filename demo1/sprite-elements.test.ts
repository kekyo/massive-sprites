// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { describe, expect, it } from 'vitest';
import {
  CAR_IMAGE_ID,
  CAR_SHIFT_ANGLE_DEG,
  CAR_SHIFT_DISTANCE,
  CAUTION_IMAGE_ID,
  CAUTION_SHIFT_ANGLE_DEG,
  CAUTION_SHIFT_DISTANCE,
  createElementModeElementsUpdate,
  createPlacementElements,
  createRotateElementsUpdate,
  PRIMARY_SHIFT_ANGLE_DEG,
  PRIMARY_SHIFT_DISTANCE,
  toInterpolationOnlyElementUpdate,
} from './sprite-elements';

const ORIGIN_USE_RESOLVED_ANCHORS: [boolean, boolean, boolean] = [
  false,
  false,
  false,
];

describe('sprite-elements helpers', () => {
  it('creates placement elements for each element mode', () => {
    const anchorXs: [number, number, number] = [0.25, -0.5, 0.75];
    const anchorYs: [number, number, number] = [-0.4, 0.3, -0.6];
    expect(
      createPlacementElements(
        'curve',
        [0.5, 1.2, 0.8],
        ['none', 'none', 'none'],
        ORIGIN_USE_RESOLVED_ANCHORS,
        anchorXs,
        anchorYs
      )
    ).toEqual([
      {
        imageId: 'curve',
        scale: { value: 0.5 },
        anchorX: { value: 0.25 },
        anchorY: { value: -0.4 },
      },
      {
        imageId: CAUTION_IMAGE_ID,
        originLocation: { index: 0 },
        scale: { value: 1.2 },
        anchorX: { value: -0.5 },
        anchorY: { value: 0.3 },
        shiftDistance: { value: 0 },
        shiftAngleDeg: { value: 0 },
        opacity: { value: 0 },
        rotation: { value: 0 },
      },
      {
        imageId: CAR_IMAGE_ID,
        originLocation: { index: 1 },
        scale: { value: 0.8 },
        anchorX: { value: 0.75 },
        anchorY: { value: -0.6 },
        shiftDistance: { value: 0 },
        shiftAngleDeg: { value: 0 },
        opacity: { value: 0 },
        rotation: { value: 0 },
      },
    ]);

    expect(
      createPlacementElements(
        'walker',
        [1, 0.9, 1.1],
        ['fixed', 'fixed', 'none'],
        ORIGIN_USE_RESOLVED_ANCHORS,
        anchorXs,
        anchorYs
      )
    ).toEqual([
      {
        imageId: 'walker',
        scale: { value: 1 },
        anchorX: { value: 0.25 },
        anchorY: { value: -0.4 },
        shiftDistance: { value: PRIMARY_SHIFT_DISTANCE },
        shiftAngleDeg: { value: PRIMARY_SHIFT_ANGLE_DEG },
      },
      {
        imageId: CAUTION_IMAGE_ID,
        originLocation: { index: 0 },
        scale: { value: 0.9 },
        anchorX: { value: -0.5 },
        anchorY: { value: 0.3 },
        shiftDistance: { value: CAUTION_SHIFT_DISTANCE },
        shiftAngleDeg: { value: CAUTION_SHIFT_ANGLE_DEG },
      },
      {
        imageId: CAR_IMAGE_ID,
        originLocation: { index: 1 },
        scale: { value: 1.1 },
        anchorX: { value: 0.75 },
        anchorY: { value: -0.6 },
        shiftDistance: { value: 0 },
        shiftAngleDeg: { value: 0 },
        opacity: { value: 0 },
        rotation: { value: 0 },
      },
    ]);

    expect(
      createPlacementElements(
        'walker',
        [1, 1.3, 0.7],
        ['orbit', 'none', 'fixed'],
        ORIGIN_USE_RESOLVED_ANCHORS,
        anchorXs,
        anchorYs
      )
    ).toEqual([
      {
        imageId: 'walker',
        scale: { value: 1 },
        anchorX: { value: 0.25 },
        anchorY: { value: -0.4 },
        shiftDistance: { value: PRIMARY_SHIFT_DISTANCE },
        shiftAngleDeg: { value: 0 },
      },
      {
        imageId: CAUTION_IMAGE_ID,
        originLocation: { index: 0 },
        scale: { value: 1.3 },
        anchorX: { value: -0.5 },
        anchorY: { value: 0.3 },
        shiftDistance: { value: 0 },
        shiftAngleDeg: { value: 0 },
        opacity: { value: 0 },
        rotation: { value: 0 },
      },
      {
        imageId: CAR_IMAGE_ID,
        originLocation: { index: 1 },
        scale: { value: 0.7 },
        anchorX: { value: 0.75 },
        anchorY: { value: -0.6 },
        shiftDistance: { value: CAR_SHIFT_DISTANCE },
        shiftAngleDeg: { value: CAR_SHIFT_ANGLE_DEG },
      },
    ]);

    expect(
      createPlacementElements(
        'walker',
        [1, 0.8, 1.6],
        ['none', 'none', 'orbit'],
        ORIGIN_USE_RESOLVED_ANCHORS,
        anchorXs,
        anchorYs
      )
    ).toEqual([
      {
        imageId: 'walker',
        scale: { value: 1 },
        anchorX: { value: 0.25 },
        anchorY: { value: -0.4 },
      },
      {
        imageId: CAUTION_IMAGE_ID,
        originLocation: { index: 0 },
        scale: { value: 0.8 },
        anchorX: { value: -0.5 },
        anchorY: { value: 0.3 },
        shiftDistance: { value: 0 },
        shiftAngleDeg: { value: 0 },
        opacity: { value: 0 },
        rotation: { value: 0 },
      },
      {
        imageId: CAR_IMAGE_ID,
        originLocation: { index: 1 },
        scale: { value: 1.6 },
        anchorX: { value: 0.75 },
        anchorY: { value: -0.6 },
        shiftDistance: { value: CAR_SHIFT_DISTANCE },
        shiftAngleDeg: { value: 0 },
      },
    ]);
  });

  it('adds resolved anchor flag to origin locations when enabled', () => {
    const anchorXs: [number, number, number] = [0.2, -0.2, 0.4];
    const anchorYs: [number, number, number] = [-0.1, 0.1, -0.3];
    const elements = createPlacementElements(
      'curve',
      [1, 1, 1],
      ['none', 'fixed', 'fixed'],
      [false, true, true],
      anchorXs,
      anchorYs
    );
    expect(elements[1]).toMatchObject({
      originLocation: { index: 0, useResolvedAnchor: true },
    });
    expect(elements[2]).toMatchObject({
      originLocation: { index: 1, useResolvedAnchor: true },
    });
  });

  it('creates rotate updates with independent shift and rotation interpolation', () => {
    const shiftLinear = {
      mode: 'feedback' as const,
      durationMs: 500,
      easing: { type: 'linear' as const },
    };
    const shiftSigmoid = {
      mode: 'feedforward' as const,
      durationMs: 300,
      easing: { type: 'sigmoid' as const },
    };
    const rotationLinear = {
      mode: 'feedback' as const,
      durationMs: 200,
      easing: { type: 'linear' as const },
    };
    const rotationSigmoid = {
      mode: 'feedforward' as const,
      durationMs: 250,
      easing: { type: 'sigmoid' as const },
    };
    const anchorXs: [number, number, number] = [0.1, 0.2, 0.3];
    const anchorYs: [number, number, number] = [-0.1, -0.2, -0.3];

    expect(
      createRotateElementsUpdate(
        ['curve', CAUTION_IMAGE_ID, CAR_IMAGE_ID],
        ['none', 'none', 'none'],
        [120, 10, 20],
        [45, 10, 20],
        [undefined, undefined, undefined],
        [undefined, undefined, undefined],
        [undefined, undefined, undefined],
        [0.7, 0.8, 0.9],
        ORIGIN_USE_RESOLVED_ANCHORS,
        anchorXs,
        anchorYs
      )
    ).toEqual([
      {
        imageId: 'curve',
        scale: {
          value: 0.7,
        },
        anchorX: {
          value: 0.1,
        },
        anchorY: {
          value: -0.1,
        },
        shiftDistance: {
          value: 0,
        },
        shiftAngleDeg: {
          value: 0,
        },
        rotation: {
          value: 45,
        },
      },
    ]);

    expect(
      createRotateElementsUpdate(
        ['walker', CAUTION_IMAGE_ID, CAR_IMAGE_ID],
        ['fixed', 'orbit', 'fixed'],
        [70, 30, 150],
        [-90, 30, -10],
        [shiftLinear, shiftSigmoid, undefined],
        [undefined, rotationLinear, rotationSigmoid],
        [undefined, undefined, undefined],
        [1.1, 0.9, 1.3],
        ORIGIN_USE_RESOLVED_ANCHORS,
        anchorXs,
        anchorYs
      )
    ).toEqual([
      {
        imageId: 'walker',
        scale: {
          value: 1.1,
        },
        anchorX: {
          value: 0.1,
        },
        anchorY: {
          value: -0.1,
        },
        shiftDistance: {
          value: PRIMARY_SHIFT_DISTANCE,
          interpolation: shiftLinear,
        },
        shiftAngleDeg: {
          value: PRIMARY_SHIFT_ANGLE_DEG,
          interpolation: shiftLinear,
        },
        rotation: {
          value: -90,
        },
      },
      {
        imageId: CAUTION_IMAGE_ID,
        originLocation: { index: 0 },
        scale: {
          value: 0.9,
        },
        anchorX: {
          value: 0.2,
        },
        anchorY: {
          value: -0.2,
        },
        shiftDistance: {
          value: CAUTION_SHIFT_DISTANCE,
          interpolation: shiftSigmoid,
        },
        shiftAngleDeg: {
          value: -30,
          interpolation: shiftSigmoid,
        },
        rotation: {
          value: -30,
          interpolation: rotationLinear,
        },
      },
      {
        imageId: CAR_IMAGE_ID,
        originLocation: { index: 1 },
        scale: {
          value: 1.3,
        },
        anchorX: {
          value: 0.3,
        },
        anchorY: {
          value: -0.3,
        },
        shiftDistance: {
          value: CAR_SHIFT_DISTANCE,
        },
        shiftAngleDeg: {
          value: CAR_SHIFT_ANGLE_DEG,
        },
        rotation: {
          value: 10,
          interpolation: rotationSigmoid,
        },
      },
    ]);
  });

  it('strips values when creating interpolation-only element updates', () => {
    const linear = {
      mode: 'feedback' as const,
      durationMs: 400,
      easing: { type: 'linear' as const },
    };
    expect(
      toInterpolationOnlyElementUpdate({
        imageId: 'curve',
        layer: 2,
        shiftDistance: { value: 12, interpolation: linear },
        shiftAngleDeg: { value: 24, interpolation: null },
        scale: { value: 1.1 },
        opacity: { value: 0.5, interpolation: linear },
        rotation: {
          value: 10,
          interpolation: linear,
        },
      })
    ).toEqual({
      imageId: 'curve',
      layer: 2,
      shiftDistance: { interpolation: linear },
      shiftAngleDeg: { interpolation: null },
      opacity: { interpolation: linear },
      rotation: { interpolation: linear },
    });
  });

  it('creates mode update payload that clears inactive child elements', () => {
    const shiftLinear = {
      mode: 'feedback' as const,
      durationMs: 500,
      easing: { type: 'linear' as const },
    };
    const shiftSigmoid = {
      mode: 'feedforward' as const,
      durationMs: 300,
      easing: { type: 'sigmoid' as const },
    };
    const rotationSigmoid = {
      mode: 'feedforward' as const,
      durationMs: 300,
      easing: { type: 'sigmoid' as const },
    };
    const anchorXs: [number, number, number] = [0.15, -0.25, 0.35];
    const anchorYs: [number, number, number] = [-0.45, 0.55, -0.65];

    expect(
      createElementModeElementsUpdate(
        ['curve', CAUTION_IMAGE_ID, CAR_IMAGE_ID],
        ['none', 'none', 'none'],
        [45, 50, -30],
        [12, 50, -30],
        [shiftLinear, undefined, undefined],
        [undefined, undefined, undefined],
        [undefined, undefined, undefined],
        [0.6, 1.25, 0.75],
        ORIGIN_USE_RESOLVED_ANCHORS,
        anchorXs,
        anchorYs
      )
    ).toEqual([
      {
        imageId: 'curve',
        scale: {
          value: 0.6,
        },
        anchorX: {
          value: 0.15,
        },
        anchorY: {
          value: -0.45,
        },
        shiftDistance: {
          value: 0,
          interpolation: shiftLinear,
        },
        shiftAngleDeg: {
          value: 0,
          interpolation: shiftLinear,
        },
        rotation: {
          value: 12,
        },
      },
      {
        imageId: CAUTION_IMAGE_ID,
        originLocation: { index: 0 },
        shiftDistance: {
          value: 0,
        },
        shiftAngleDeg: {
          value: 0,
        },
        scale: {
          value: 1.25,
        },
        opacity: {
          value: 0,
          interpolation: null,
        },
        anchorX: {
          value: -0.25,
        },
        anchorY: {
          value: 0.55,
        },
        rotation: {
          value: 0,
          interpolation: null,
        },
      },
      {
        imageId: CAR_IMAGE_ID,
        originLocation: { index: 1 },
        shiftDistance: {
          value: 0,
        },
        shiftAngleDeg: {
          value: 0,
        },
        scale: {
          value: 0.75,
        },
        opacity: {
          value: 0,
          interpolation: null,
        },
        anchorX: {
          value: 0.35,
        },
        anchorY: {
          value: -0.65,
        },
        rotation: {
          value: 0,
          interpolation: null,
        },
      },
    ]);

    expect(
      createElementModeElementsUpdate(
        ['walker', CAUTION_IMAGE_ID, CAR_IMAGE_ID],
        ['fixed', 'none', 'orbit'],
        [90, -45, 30],
        [60, -45, 30],
        [undefined, shiftLinear, shiftSigmoid],
        [undefined, undefined, rotationSigmoid],
        [undefined, undefined, undefined],
        [1.2, 0.8, 1.4],
        ORIGIN_USE_RESOLVED_ANCHORS,
        anchorXs,
        anchorYs
      )
    ).toEqual([
      {
        imageId: 'walker',
        scale: {
          value: 1.2,
        },
        anchorX: {
          value: 0.15,
        },
        anchorY: {
          value: -0.45,
        },
        shiftDistance: {
          value: PRIMARY_SHIFT_DISTANCE,
        },
        shiftAngleDeg: {
          value: PRIMARY_SHIFT_ANGLE_DEG,
        },
        rotation: {
          value: 60,
        },
      },
      {
        imageId: CAUTION_IMAGE_ID,
        originLocation: { index: 0 },
        shiftDistance: {
          value: 0,
          interpolation: shiftLinear,
        },
        shiftAngleDeg: {
          value: 0,
          interpolation: shiftLinear,
        },
        scale: {
          value: 0.8,
        },
        opacity: {
          value: 0,
          interpolation: null,
        },
        anchorX: {
          value: -0.25,
        },
        anchorY: {
          value: 0.55,
        },
        rotation: {
          value: 0,
          interpolation: null,
        },
      },
      {
        imageId: CAR_IMAGE_ID,
        originLocation: { index: 1 },
        scale: {
          value: 1.4,
        },
        anchorX: {
          value: 0.35,
        },
        anchorY: {
          value: -0.65,
        },
        shiftDistance: {
          value: CAR_SHIFT_DISTANCE,
          interpolation: shiftSigmoid,
        },
        shiftAngleDeg: {
          value: -30,
          interpolation: shiftSigmoid,
        },
        rotation: {
          value: -30,
          interpolation: rotationSigmoid,
        },
      },
    ]);

    const hiddenInterpolated = createElementModeElementsUpdate(
      ['walker', CAUTION_IMAGE_ID, CAR_IMAGE_ID],
      ['fixed', 'none', 'none'],
      [90, -45, 30],
      [60, -45, 30],
      [undefined, shiftLinear, shiftSigmoid],
      [undefined, undefined, rotationSigmoid],
      [undefined, undefined, undefined],
      [1.3, 0.7, 1.1],
      ORIGIN_USE_RESOLVED_ANCHORS,
      anchorXs,
      anchorYs
    );
    expect(hiddenInterpolated[1]).toMatchObject({
      shiftDistance: {
        interpolation: shiftLinear,
      },
      shiftAngleDeg: {
        interpolation: shiftLinear,
      },
    });
    expect(hiddenInterpolated[2]).toMatchObject({
      shiftDistance: {
        interpolation: shiftSigmoid,
      },
      shiftAngleDeg: {
        interpolation: shiftSigmoid,
      },
    });
  });
});
