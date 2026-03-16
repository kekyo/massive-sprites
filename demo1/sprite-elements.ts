// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  SpriteElementPlacement,
  SpriteElementUpdate,
  SpriteElementOriginLocationPlacement,
  ObjectInterpolationParameter,
  ObjectUpdateValue,
} from 'massive-sprites';
import {
  applyInterpolatedUpdateSpecs,
  createInterpolatedParameter,
} from './element-params';

export const CAUTION_IMAGE_ID = 'caution';
export const CAR_IMAGE_ID = 'car';
export const PRIMARY_SHIFT_DISTANCE = 200;
export const PRIMARY_SHIFT_ANGLE_DEG = -30;
export const CAUTION_SHIFT_DISTANCE = 650;
export const CAUTION_SHIFT_ANGLE_DEG = 130;
export const CAR_SHIFT_DISTANCE = 360;
export const CAR_SHIFT_ANGLE_DEG = -90;
export type ElementMode = 'none' | 'fixed' | 'orbit';
export type ExtraCautionMode = ElementMode;
export type ElementTuple<T> = [T, T, T];
export type ElementModes = ElementTuple<ElementMode>;
export type ElementRotateDegs = ElementTuple<number>;
export type ElementInterpolationTuple = ElementTuple<
  ObjectInterpolationParameter | null | undefined
>;
export type ElementShiftInterpolations = ElementInterpolationTuple;
export type ElementRotationInterpolations = ElementInterpolationTuple;
export type ElementScaleInterpolations = ElementInterpolationTuple;
export type ElementAnchorValues = ElementTuple<number>;
export type ElementOriginUseResolvedAnchors = ElementTuple<boolean>;

type ElementDefinition = {
  readonly imageId: string;
  readonly originLocation?: SpriteElementOriginLocationPlacement;
  readonly shiftDistance: number;
  readonly fixedShiftAngleDeg: number;
  readonly rotateSign: -1 | 1;
};

const SECONDARY_DEFINITION: ElementDefinition = {
  imageId: CAUTION_IMAGE_ID,
  originLocation: { index: 0 },
  shiftDistance: CAUTION_SHIFT_DISTANCE,
  fixedShiftAngleDeg: CAUTION_SHIFT_ANGLE_DEG,
  rotateSign: -1,
};

const TERTIARY_DEFINITION: ElementDefinition = {
  imageId: CAR_IMAGE_ID,
  originLocation: { index: 1 },
  shiftDistance: CAR_SHIFT_DISTANCE,
  fixedShiftAngleDeg: CAR_SHIFT_ANGLE_DEG,
  rotateSign: -1,
};

const PRIMARY_DEFINITION = (
  imageId: string,
  scale: number
): { placement: SpriteElementPlacement; update: ElementDefinition } => ({
  placement: {
    imageId,
    scale: { value: scale },
  },
  update: {
    imageId,
    shiftDistance: PRIMARY_SHIFT_DISTANCE,
    fixedShiftAngleDeg: PRIMARY_SHIFT_ANGLE_DEG,
    rotateSign: 1,
  },
});

const resolvePlacementShiftAngleDeg = (
  mode: ElementMode,
  fixedShiftAngleDeg: number
) => {
  if (mode === 'fixed') {
    return fixedShiftAngleDeg;
  }
  return 0;
};

const resolveShiftAngleDeg = (
  mode: ElementMode,
  shiftDeg: number,
  fixedShiftAngleDeg: number
) => {
  if (mode === 'orbit') {
    return -shiftDeg;
  }
  if (mode === 'fixed') {
    return fixedShiftAngleDeg;
  }
  return 0;
};

const resolveOriginLocation = (
  originLocation: SpriteElementOriginLocationPlacement | undefined,
  useResolvedAnchor: boolean
): SpriteElementOriginLocationPlacement | undefined => {
  if (!originLocation) {
    return undefined;
  }
  if (!useResolvedAnchor) {
    return originLocation;
  }
  return {
    ...originLocation,
    useResolvedAnchor: true,
  };
};

const buildOriginLocationEntry = (
  originLocation: SpriteElementOriginLocationPlacement | undefined,
  useResolvedAnchor: boolean
) => {
  const resolvedOriginLocation = resolveOriginLocation(
    originLocation,
    useResolvedAnchor
  );
  return resolvedOriginLocation
    ? { originLocation: resolvedOriginLocation }
    : {};
};

const createPlacementElement = (
  definition: ElementDefinition,
  mode: ElementMode,
  useResolvedAnchor: boolean,
  scale: number,
  anchorX: number,
  anchorY: number
): SpriteElementPlacement => ({
  imageId: definition.imageId,
  ...buildOriginLocationEntry(definition.originLocation, useResolvedAnchor),
  scale: { value: scale },
  anchorX: { value: anchorX },
  anchorY: { value: anchorY },
  shiftDistance: { value: definition.shiftDistance },
  shiftAngleDeg: {
    value: resolvePlacementShiftAngleDeg(mode, definition.fixedShiftAngleDeg),
  },
});

const createPlacementElement0 = (
  imageId: string,
  scale: number,
  mode: ElementMode,
  anchorX: number,
  anchorY: number
) => {
  const { placement, update } = PRIMARY_DEFINITION(imageId, scale);
  if (mode === 'none') {
    return {
      ...placement,
      anchorX: { value: anchorX },
      anchorY: { value: anchorY },
    };
  }
  return {
    imageId,
    scale: { value: scale },
    anchorX: { value: anchorX },
    anchorY: { value: anchorY },
    shiftDistance: { value: update.shiftDistance },
    shiftAngleDeg: {
      value: resolvePlacementShiftAngleDeg(mode, update.fixedShiftAngleDeg),
    },
  };
};

const createHiddenPlacementElement = (
  definition: ElementDefinition,
  useResolvedAnchor: boolean,
  scale: number,
  anchorX: number,
  anchorY: number
): SpriteElementPlacement => ({
  imageId: definition.imageId,
  ...buildOriginLocationEntry(definition.originLocation, useResolvedAnchor),
  scale: { value: scale },
  anchorX: { value: anchorX },
  anchorY: { value: anchorY },
  shiftDistance: { value: 0 },
  shiftAngleDeg: { value: 0 },
  opacity: { value: 0 },
  rotation: { value: 0 },
});

export const createPlacementElements = (
  imageId: string,
  elementScales: Readonly<ElementTuple<number>>,
  elementModes: Readonly<ElementModes>,
  elementOriginUseResolvedAnchors: Readonly<ElementOriginUseResolvedAnchors>,
  elementAnchorXs: Readonly<ElementAnchorValues>,
  elementAnchorYs: Readonly<ElementAnchorValues>
) => {
  const elements: (SpriteElementPlacement | undefined)[] = [
    createPlacementElement0(
      imageId,
      elementScales[0],
      elementModes[0],
      elementAnchorXs[0],
      elementAnchorYs[0]
    ),
  ];
  elements[1] =
    elementModes[1] === 'none'
      ? createHiddenPlacementElement(
          SECONDARY_DEFINITION,
          elementOriginUseResolvedAnchors[1],
          elementScales[1],
          elementAnchorXs[1],
          elementAnchorYs[1]
        )
      : createPlacementElement(
          SECONDARY_DEFINITION,
          elementModes[1],
          elementOriginUseResolvedAnchors[1],
          elementScales[1],
          elementAnchorXs[1],
          elementAnchorYs[1]
        );
  elements[2] =
    elementModes[2] === 'none'
      ? createHiddenPlacementElement(
          TERTIARY_DEFINITION,
          elementOriginUseResolvedAnchors[2],
          elementScales[2],
          elementAnchorXs[2],
          elementAnchorYs[2]
        )
      : createPlacementElement(
          TERTIARY_DEFINITION,
          elementModes[2],
          elementOriginUseResolvedAnchors[2],
          elementScales[2],
          elementAnchorXs[2],
          elementAnchorYs[2]
        );
  return elements;
};

const createElementUpdate = (
  definition: ElementDefinition,
  useResolvedAnchor: boolean,
  mode: ElementMode,
  shiftDeg: number,
  rotateDeg: number,
  shiftInterpolation: ObjectInterpolationParameter | null | undefined,
  rotationInterpolation: ObjectInterpolationParameter | null | undefined,
  scaleInterpolation: ObjectInterpolationParameter | null | undefined,
  scale: number,
  anchorX: number,
  anchorY: number
): SpriteElementUpdate => ({
  imageId: definition.imageId,
  ...buildOriginLocationEntry(definition.originLocation, useResolvedAnchor),
  scale: createInterpolatedParameter(scale, scaleInterpolation),
  anchorX: createInterpolatedParameter(anchorX, undefined),
  anchorY: createInterpolatedParameter(anchorY, undefined),
  shiftDistance: createInterpolatedParameter(
    mode === 'none' ? 0 : definition.shiftDistance,
    shiftInterpolation
  ),
  shiftAngleDeg: createInterpolatedParameter(
    resolveShiftAngleDeg(mode, shiftDeg, definition.fixedShiftAngleDeg),
    shiftInterpolation
  ),
  rotation: createInterpolatedParameter(
    rotateDeg * definition.rotateSign,
    rotationInterpolation
  ),
});

const createElement0Update = (
  imageId: string,
  useResolvedAnchor: boolean,
  mode: ElementMode,
  shiftDeg: number,
  rotateDeg: number,
  shiftInterpolation: ObjectInterpolationParameter | null | undefined,
  rotationInterpolation: ObjectInterpolationParameter | null | undefined,
  scaleInterpolation: ObjectInterpolationParameter | null | undefined,
  scale: number,
  anchorX: number,
  anchorY: number
) => {
  const { update } = PRIMARY_DEFINITION(imageId, scale);
  return createElementUpdate(
    update,
    useResolvedAnchor,
    mode,
    shiftDeg,
    rotateDeg,
    shiftInterpolation,
    rotationInterpolation,
    scaleInterpolation,
    scale,
    anchorX,
    anchorY
  );
};

const createHiddenElementUpdate = (
  definition: ElementDefinition,
  useResolvedAnchor: boolean,
  shiftInterpolation: ObjectInterpolationParameter | null | undefined,
  scaleInterpolation: ObjectInterpolationParameter | null | undefined,
  scale: number,
  anchorX: number,
  anchorY: number
): SpriteElementUpdate =>
  applyInterpolatedUpdateSpecs(
    {
      imageId: definition.imageId,
      ...buildOriginLocationEntry(definition.originLocation, useResolvedAnchor),
      scale: createInterpolatedParameter(scale, scaleInterpolation),
      anchorX: createInterpolatedParameter(anchorX, undefined),
      anchorY: createInterpolatedParameter(anchorY, undefined),
    },
    [
      {
        key: 'shiftDistance',
        value: 0,
        interpolation: shiftInterpolation,
        preserveExistingInterpolation: shiftInterpolation === undefined,
      },
      {
        key: 'shiftAngleDeg',
        value: 0,
        interpolation: shiftInterpolation,
        preserveExistingInterpolation: shiftInterpolation === undefined,
      },
      {
        key: 'opacity',
        value: 0,
        interpolation: null,
      },
      {
        key: 'rotation',
        value: 0,
        interpolation: null,
      },
    ]
  );

export const createRotateElementsUpdate = (
  elementImageIds: Readonly<ElementTuple<string>>,
  elementModes: Readonly<ElementModes>,
  elementShiftDegs: Readonly<ElementRotateDegs>,
  elementRotateDegs: Readonly<ElementRotateDegs>,
  elementShiftInterpolations: Readonly<ElementShiftInterpolations>,
  elementRotationInterpolations: Readonly<ElementRotationInterpolations>,
  elementScaleInterpolations: Readonly<ElementScaleInterpolations>,
  elementScales: Readonly<ElementTuple<number>>,
  elementOriginUseResolvedAnchors: Readonly<ElementOriginUseResolvedAnchors>,
  elementAnchorXs: Readonly<ElementAnchorValues>,
  elementAnchorYs: Readonly<ElementAnchorValues>
) => {
  const secondaryDefinition: ElementDefinition = {
    ...SECONDARY_DEFINITION,
    imageId: elementImageIds[1],
  };
  const tertiaryDefinition: ElementDefinition = {
    ...TERTIARY_DEFINITION,
    imageId: elementImageIds[2],
  };
  const elements: (SpriteElementUpdate | undefined)[] = [
    createElement0Update(
      elementImageIds[0],
      elementOriginUseResolvedAnchors[0],
      elementModes[0],
      elementShiftDegs[0],
      elementRotateDegs[0],
      elementShiftInterpolations[0],
      elementRotationInterpolations[0],
      elementScaleInterpolations[0],
      elementScales[0],
      elementAnchorXs[0],
      elementAnchorYs[0]
    ),
  ];
  if (elementModes[1] !== 'none') {
    elements[1] = createElementUpdate(
      secondaryDefinition,
      elementOriginUseResolvedAnchors[1],
      elementModes[1],
      elementShiftDegs[1],
      elementRotateDegs[1],
      elementShiftInterpolations[1],
      elementRotationInterpolations[1],
      elementScaleInterpolations[1],
      elementScales[1],
      elementAnchorXs[1],
      elementAnchorYs[1]
    );
  }
  if (elementModes[2] !== 'none') {
    elements[2] = createElementUpdate(
      tertiaryDefinition,
      elementOriginUseResolvedAnchors[2],
      elementModes[2],
      elementShiftDegs[2],
      elementRotateDegs[2],
      elementShiftInterpolations[2],
      elementRotationInterpolations[2],
      elementScaleInterpolations[2],
      elementScales[2],
      elementAnchorXs[2],
      elementAnchorYs[2]
    );
  }
  return elements;
};

export const createElementModeElementsUpdate = (
  elementImageIds: Readonly<ElementTuple<string>>,
  elementModes: Readonly<ElementModes>,
  elementShiftDegs: Readonly<ElementRotateDegs>,
  elementRotateDegs: Readonly<ElementRotateDegs>,
  elementShiftInterpolations: Readonly<ElementShiftInterpolations>,
  elementRotationInterpolations: Readonly<ElementRotationInterpolations>,
  elementScaleInterpolations: Readonly<ElementScaleInterpolations>,
  elementScales: Readonly<ElementTuple<number>>,
  elementOriginUseResolvedAnchors: Readonly<ElementOriginUseResolvedAnchors>,
  elementAnchorXs: Readonly<ElementAnchorValues>,
  elementAnchorYs: Readonly<ElementAnchorValues>
) => {
  const secondaryDefinition: ElementDefinition = {
    ...SECONDARY_DEFINITION,
    imageId: elementImageIds[1],
  };
  const tertiaryDefinition: ElementDefinition = {
    ...TERTIARY_DEFINITION,
    imageId: elementImageIds[2],
  };
  const elements: (SpriteElementUpdate | null | undefined)[] = [
    createElement0Update(
      elementImageIds[0],
      elementOriginUseResolvedAnchors[0],
      elementModes[0],
      elementShiftDegs[0],
      elementRotateDegs[0],
      elementShiftInterpolations[0],
      elementRotationInterpolations[0],
      elementScaleInterpolations[0],
      elementScales[0],
      elementAnchorXs[0],
      elementAnchorYs[0]
    ),
  ];
  elements[1] =
    elementModes[1] === 'none'
      ? createHiddenElementUpdate(
          secondaryDefinition,
          elementOriginUseResolvedAnchors[1],
          elementShiftInterpolations[1],
          elementScaleInterpolations[1],
          elementScales[1],
          elementAnchorXs[1],
          elementAnchorYs[1]
        )
      : createElementUpdate(
          secondaryDefinition,
          elementOriginUseResolvedAnchors[1],
          elementModes[1],
          elementShiftDegs[1],
          elementRotateDegs[1],
          elementShiftInterpolations[1],
          elementRotationInterpolations[1],
          elementScaleInterpolations[1],
          elementScales[1],
          elementAnchorXs[1],
          elementAnchorYs[1]
        );
  elements[2] =
    elementModes[2] === 'none'
      ? createHiddenElementUpdate(
          tertiaryDefinition,
          elementOriginUseResolvedAnchors[2],
          elementShiftInterpolations[2],
          elementScaleInterpolations[2],
          elementScales[2],
          elementAnchorXs[2],
          elementAnchorYs[2]
        )
      : createElementUpdate(
          tertiaryDefinition,
          elementOriginUseResolvedAnchors[2],
          elementModes[2],
          elementShiftDegs[2],
          elementRotateDegs[2],
          elementShiftInterpolations[2],
          elementRotationInterpolations[2],
          elementScaleInterpolations[2],
          elementScales[2],
          elementAnchorXs[2],
          elementAnchorYs[2]
        );
  return elements;
};

const toInterpolationOnlyUpdateValue = (
  value: ObjectUpdateValue<number> | undefined
): ObjectUpdateValue<number> | undefined => {
  if (!value || value.interpolation === undefined) {
    return undefined;
  }
  return { interpolation: value.interpolation };
};

const toInterpolationOnlyRotationValue = (
  value: ObjectUpdateValue<number> | undefined
): ObjectUpdateValue<number> | undefined => {
  if (!value || value.interpolation === undefined) {
    return undefined;
  }
  return { interpolation: value.interpolation };
};

export const toInterpolationOnlyElementUpdate = (
  elementUpdate: SpriteElementUpdate | null | undefined
): SpriteElementUpdate | null | undefined => {
  if (!elementUpdate) {
    return elementUpdate;
  }
  const {
    imageId,
    originLocation,
    mode,
    layer,
    order,
    shiftDistance,
    shiftAngleDeg,
    scale,
    opacity,
    anchorX,
    anchorY,
    rotation,
  } = elementUpdate;
  const nextShiftDistance = toInterpolationOnlyUpdateValue(shiftDistance);
  const nextShiftAngleDeg = toInterpolationOnlyUpdateValue(shiftAngleDeg);
  const nextScale = toInterpolationOnlyUpdateValue(scale);
  const nextOpacity = toInterpolationOnlyUpdateValue(opacity);
  const nextAnchorX = toInterpolationOnlyUpdateValue(anchorX);
  const nextAnchorY = toInterpolationOnlyUpdateValue(anchorY);
  const nextRotation = toInterpolationOnlyRotationValue(rotation);
  return {
    ...(imageId !== undefined ? { imageId } : {}),
    ...(originLocation !== undefined ? { originLocation } : {}),
    ...(mode !== undefined ? { mode } : {}),
    ...(layer !== undefined ? { layer } : {}),
    ...(order !== undefined ? { order } : {}),
    ...(nextShiftDistance ? { shiftDistance: nextShiftDistance } : {}),
    ...(nextShiftAngleDeg ? { shiftAngleDeg: nextShiftAngleDeg } : {}),
    ...(nextScale ? { scale: nextScale } : {}),
    ...(nextOpacity ? { opacity: nextOpacity } : {}),
    ...(nextAnchorX ? { anchorX: nextAnchorX } : {}),
    ...(nextAnchorY ? { anchorY: nextAnchorY } : {}),
    ...(nextRotation ? { rotation: nextRotation } : {}),
  };
};
