// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  SpriteElementUpdate,
  ObjectInterpolationParameter,
  ObjectUpdateValue,
} from 'massive-sprites';

export const ELEMENT_INTERPOLATED_KEYS = [
  'shiftDistance',
  'shiftAngleDeg',
  'opacity',
  'rotation',
] as const;

export type ElementInterpolatedKey = (typeof ELEMENT_INTERPOLATED_KEYS)[number];

export type ElementInterpolatedUpdateSpec = {
  readonly key: ElementInterpolatedKey;
  readonly value: number;
  readonly interpolation?: ObjectInterpolationParameter | null | undefined;
  readonly preserveExistingValue?: boolean;
  readonly preserveExistingInterpolation?: boolean;
};

export const createUpdateValue = (
  value: number | undefined,
  interpolation: ObjectInterpolationParameter | null | undefined
): ObjectUpdateValue<number> | undefined => {
  if (value === undefined && interpolation === undefined) {
    return undefined;
  }
  return {
    ...(value !== undefined ? { value } : {}),
    ...(interpolation !== undefined ? { interpolation } : {}),
  };
};

export const createInterpolatedParameter = (
  value: number,
  interpolation?: ObjectInterpolationParameter | null
): ObjectUpdateValue<number> =>
  interpolation === undefined ? { value } : { value, interpolation };

const readInterpolatedParameter = (
  elementUpdate: SpriteElementUpdate,
  key: ElementInterpolatedKey
) => elementUpdate[key];

const writeInterpolatedParameter = (
  elementUpdate: SpriteElementUpdate,
  key: ElementInterpolatedKey,
  value: ObjectUpdateValue<number>
): SpriteElementUpdate => {
  switch (key) {
    case 'shiftDistance':
      return {
        ...elementUpdate,
        shiftDistance: value,
      };
    case 'shiftAngleDeg':
      return {
        ...elementUpdate,
        shiftAngleDeg: value,
      };
    case 'opacity':
      return {
        ...elementUpdate,
        opacity: value,
      };
    case 'rotation':
      return {
        ...elementUpdate,
        rotation: value,
      };
    default:
      return elementUpdate;
  }
};

export const applyInterpolatedUpdateSpecs = (
  elementUpdate: SpriteElementUpdate,
  specs: readonly ElementInterpolatedUpdateSpec[]
): SpriteElementUpdate => {
  let current = elementUpdate;
  for (const spec of specs) {
    const previous = readInterpolatedParameter(current, spec.key);
    const previousValue = previous?.value;
    const nextValue =
      spec.preserveExistingValue && previousValue !== undefined
        ? previousValue
        : spec.value;
    const nextInterpolation =
      spec.interpolation !== undefined
        ? spec.interpolation
        : spec.preserveExistingInterpolation
          ? undefined
          : null;
    current = writeInterpolatedParameter(
      current,
      spec.key,
      createInterpolatedParameter(nextValue, nextInterpolation)
    );
  }
  return current;
};

export const applyInterpolatedUpdateSpecsOptional = (
  elementUpdate: SpriteElementUpdate | null | undefined,
  specs: readonly ElementInterpolatedUpdateSpec[]
): SpriteElementUpdate | null | undefined => {
  if (!elementUpdate) {
    return elementUpdate;
  }
  return applyInterpolatedUpdateSpecs(elementUpdate, specs);
};
