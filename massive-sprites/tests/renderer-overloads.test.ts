// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type {
  SpritePlacement,
  CameraUpdate,
  CameraAdjustPositionOptions,
  ObjectCameraState,
  ObjectCanvasCameraChangeEvent,
  ObjectCanvasCameraInteractionEvent,
  ObjectCanvasCameraControlsOptions,
  ObjectCanvasRenderer,
  ObjectRendererCameraStateChangeEvent,
  ObjectInterpolationParameter,
  ObjectPickResult,
  PositionInPixel,
  ObjectRendererCommon,
  ObjectRenderer,
  ObjectWorldPosition,
  SizeInPixel,
  SpriteBulkUpdate,
  SpriteUpdate,
  PolylinePlacement,
  PolylineBulkUpdate,
  PolylineUpdate,
  PolylineState,
} from '../src/types';

type Assert<T extends true> = T;
type IsAssignable<From, To> = [From] extends [To] ? true : false;

export type AddSpriteAwaitableTrue = Assert<
  IsAssignable<
    ObjectRendererCommon['addSprite'],
    (placement: SpritePlacement, awaitable: true) => Promise<number>
  >
>;
export type AddSpriteAwaitableFalse = Assert<
  IsAssignable<
    ObjectRendererCommon['addSprite'],
    (placement: SpritePlacement, awaitable: false) => void
  >
>;
export type AddSpriteDefault = Assert<
  IsAssignable<
    ObjectRendererCommon['addSprite'],
    (placement: SpritePlacement) => void
  >
>;

export type AddSpritesAwaitableTrue = Assert<
  IsAssignable<
    ObjectRendererCommon['addSprites'],
    (
      placements: readonly SpritePlacement[],
      awaitable: true
    ) => Promise<number[]>
  >
>;
export type AddSpritesAwaitableFalse = Assert<
  IsAssignable<
    ObjectRendererCommon['addSprites'],
    (placements: readonly SpritePlacement[], awaitable: false) => void
  >
>;
export type AddSpritesDefault = Assert<
  IsAssignable<
    ObjectRendererCommon['addSprites'],
    (placements: readonly SpritePlacement[]) => void
  >
>;

export type UpdateSpriteAwaitableTrue = Assert<
  IsAssignable<
    ObjectRendererCommon['updateSprite'],
    (spriteId: number, update: SpriteUpdate, awaitable: true) => Promise<void>
  >
>;
export type UpdateSpriteAwaitableFalse = Assert<
  IsAssignable<
    ObjectRendererCommon['updateSprite'],
    (spriteId: number, update: SpriteUpdate, awaitable: false) => void
  >
>;
export type UpdateSpriteDefault = Assert<
  IsAssignable<
    ObjectRendererCommon['updateSprite'],
    (spriteId: number, update: SpriteUpdate) => void
  >
>;

export type UpdateSpritesAwaitableTrue = Assert<
  IsAssignable<
    ObjectRendererCommon['updateSprites'],
    (updates: readonly SpriteBulkUpdate[], awaitable: true) => Promise<void>
  >
>;
export type UpdateSpritesAwaitableFalse = Assert<
  IsAssignable<
    ObjectRendererCommon['updateSprites'],
    (updates: readonly SpriteBulkUpdate[], awaitable: false) => void
  >
>;
export type UpdateSpritesDefault = Assert<
  IsAssignable<
    ObjectRendererCommon['updateSprites'],
    (updates: readonly SpriteBulkUpdate[]) => void
  >
>;

export type AddPolylineAwaitableTrue = Assert<
  IsAssignable<
    ObjectRendererCommon['addPolyline'],
    (placement: PolylinePlacement, awaitable: true) => Promise<number>
  >
>;
export type AddPolylineAwaitableFalse = Assert<
  IsAssignable<
    ObjectRendererCommon['addPolyline'],
    (placement: PolylinePlacement, awaitable: false) => void
  >
>;
export type AddPolylineDefault = Assert<
  IsAssignable<
    ObjectRendererCommon['addPolyline'],
    (placement: PolylinePlacement) => void
  >
>;

export type AddPolylinesAwaitableTrue = Assert<
  IsAssignable<
    ObjectRendererCommon['addPolylines'],
    (
      placements: readonly PolylinePlacement[],
      awaitable: true
    ) => Promise<number[]>
  >
>;
export type AddPolylinesAwaitableFalse = Assert<
  IsAssignable<
    ObjectRendererCommon['addPolylines'],
    (placements: readonly PolylinePlacement[], awaitable: false) => void
  >
>;
export type AddPolylinesDefault = Assert<
  IsAssignable<
    ObjectRendererCommon['addPolylines'],
    (placements: readonly PolylinePlacement[]) => void
  >
>;

export type UpdatePolylineAwaitableTrue = Assert<
  IsAssignable<
    ObjectRendererCommon['updatePolyline'],
    (
      polylineId: number,
      update: PolylineUpdate,
      awaitable: true
    ) => Promise<void>
  >
>;
export type UpdatePolylineAwaitableFalse = Assert<
  IsAssignable<
    ObjectRendererCommon['updatePolyline'],
    (polylineId: number, update: PolylineUpdate, awaitable: false) => void
  >
>;
export type UpdatePolylineDefault = Assert<
  IsAssignable<
    ObjectRendererCommon['updatePolyline'],
    (polylineId: number, update: PolylineUpdate) => void
  >
>;

export type UpdatePolylinesAwaitableTrue = Assert<
  IsAssignable<
    ObjectRendererCommon['updatePolylines'],
    (updates: readonly PolylineBulkUpdate[], awaitable: true) => Promise<void>
  >
>;
export type UpdatePolylinesAwaitableFalse = Assert<
  IsAssignable<
    ObjectRendererCommon['updatePolylines'],
    (updates: readonly PolylineBulkUpdate[], awaitable: false) => void
  >
>;
export type UpdatePolylinesDefault = Assert<
  IsAssignable<
    ObjectRendererCommon['updatePolylines'],
    (updates: readonly PolylineBulkUpdate[]) => void
  >
>;

export type GetSpriteStateDefault = Assert<
  IsAssignable<
    ObjectRendererCommon['getSpriteState'],
    (
      spriteId: number,
      timestampMs?: number
    ) => import('../src/types').SpriteState
  >
>;

export type GetPolylineStateDefault = Assert<
  IsAssignable<
    ObjectRendererCommon['getPolylineState'],
    (polylineId: number, timestampMs?: number) => PolylineState
  >
>;

export type UpdateCameraAwaitableTrue = Assert<
  IsAssignable<
    ObjectRendererCommon['updateCamera'],
    (camera: CameraUpdate, awaitable: true) => Promise<void>
  >
>;
export type UpdateCameraAwaitableFalse = Assert<
  IsAssignable<
    ObjectRendererCommon['updateCamera'],
    (camera: CameraUpdate, awaitable: false) => void
  >
>;
export type UpdateCameraDefault = Assert<
  IsAssignable<
    ObjectRendererCommon['updateCamera'],
    (camera: CameraUpdate) => void
  >
>;

export type AdjustCameraAwaitableTrue = Assert<
  IsAssignable<
    ObjectRendererCommon['adjustCameraPosition'],
    (options: CameraAdjustPositionOptions, awaitable: true) => Promise<void>
  >
>;
export type AdjustCameraAwaitableFalse = Assert<
  IsAssignable<
    ObjectRendererCommon['adjustCameraPosition'],
    (options: CameraAdjustPositionOptions, awaitable: false) => void
  >
>;
export type AdjustCameraDefault = Assert<
  IsAssignable<
    ObjectRendererCommon['adjustCameraPosition'],
    (options: CameraAdjustPositionOptions) => void
  >
>;

export type SetViewPortSizeAwaitableTrue = Assert<
  IsAssignable<
    ObjectRenderer['setViewPortSize'],
    (size: SizeInPixel, awaitable: true) => Promise<void>
  >
>;
export type SetViewPortSizeAwaitableFalse = Assert<
  IsAssignable<
    ObjectRenderer['setViewPortSize'],
    (size: SizeInPixel, awaitable: false) => void
  >
>;
export type SetViewPortSizeDefault = Assert<
  IsAssignable<ObjectRenderer['setViewPortSize'], (size: SizeInPixel) => void>
>;

export type RemoveSpriteAwaitableTrue = Assert<
  IsAssignable<
    ObjectRendererCommon['removeSprite'],
    (spriteId: number, awaitable: true) => Promise<void>
  >
>;
export type RemoveSpriteAwaitableFalse = Assert<
  IsAssignable<
    ObjectRendererCommon['removeSprite'],
    (spriteId: number, awaitable: false) => void
  >
>;
export type RemoveSpriteDefault = Assert<
  IsAssignable<ObjectRendererCommon['removeSprite'], (spriteId: number) => void>
>;

export type RemoveSpritesAwaitableTrue = Assert<
  IsAssignable<
    ObjectRendererCommon['removeSprites'],
    (spriteIds: readonly number[], awaitable: true) => Promise<void>
  >
>;
export type RemoveSpritesAwaitableFalse = Assert<
  IsAssignable<
    ObjectRendererCommon['removeSprites'],
    (spriteIds: readonly number[], awaitable: false) => void
  >
>;
export type RemoveSpritesDefault = Assert<
  IsAssignable<
    ObjectRendererCommon['removeSprites'],
    (spriteIds: readonly number[]) => void
  >
>;

export type RemovePolylineAwaitableTrue = Assert<
  IsAssignable<
    ObjectRendererCommon['removePolyline'],
    (polylineId: number, awaitable: true) => Promise<void>
  >
>;
export type RemovePolylineAwaitableFalse = Assert<
  IsAssignable<
    ObjectRendererCommon['removePolyline'],
    (polylineId: number, awaitable: false) => void
  >
>;
export type RemovePolylineDefault = Assert<
  IsAssignable<
    ObjectRendererCommon['removePolyline'],
    (polylineId: number) => void
  >
>;

export type RemovePolylinesAwaitableTrue = Assert<
  IsAssignable<
    ObjectRendererCommon['removePolylines'],
    (polylineIds: readonly number[], awaitable: true) => Promise<void>
  >
>;
export type RemovePolylinesAwaitableFalse = Assert<
  IsAssignable<
    ObjectRendererCommon['removePolylines'],
    (polylineIds: readonly number[], awaitable: false) => void
  >
>;
export type RemovePolylinesDefault = Assert<
  IsAssignable<
    ObjectRendererCommon['removePolylines'],
    (polylineIds: readonly number[]) => void
  >
>;

export type GetCameraStateSignature = Assert<
  IsAssignable<ObjectRendererCommon['getCameraState'], () => ObjectCameraState>
>;

export type GetPolylineStateSignature = Assert<
  IsAssignable<
    ObjectRendererCommon['getPolylineState'],
    (polylineId: number) => PolylineState
  >
>;

export type ViewportToWorldOnPlaneSignature = Assert<
  IsAssignable<
    ObjectRenderer['viewportToWorldOnPlane'],
    (
      viewportXPixel: number,
      viewportYPixel: number,
      viewPortSize: SizeInPixel,
      planeZ: number,
      cameraState?: ObjectCameraState
    ) => { x: number; y: number } | undefined
  >
>;

export type ProjectWorldToViewportSignature = Assert<
  IsAssignable<
    ObjectRenderer['projectWorldToViewport'],
    (
      world: ObjectWorldPosition,
      cameraState?: ObjectCameraState
    ) => PositionInPixel | undefined
  >
>;

export type RendererPickAtSignature = Assert<
  IsAssignable<
    ObjectRenderer['pickAt'],
    (
      viewportXPixel: number,
      viewportYPixel: number,
      timestampMs?: number
    ) => ObjectPickResult | undefined
  >
>;

export type WorldToCanvasSignature = Assert<
  IsAssignable<
    ObjectCanvasRenderer['worldToCanvas'],
    (
      world: ObjectWorldPosition,
      cameraState?: ObjectCameraState
    ) => PositionInPixel | undefined
  >
>;

export type WorldToPageSignature = Assert<
  IsAssignable<
    ObjectCanvasRenderer['worldToPage'],
    (
      world: ObjectWorldPosition,
      cameraState?: ObjectCameraState
    ) => PositionInPixel | undefined
  >
>;

export type CanvasPickAtSignature = Assert<
  IsAssignable<
    ObjectCanvasRenderer['pickAt'],
    (
      canvasXPixel: number,
      canvasYPixel: number,
      timestampMs?: number
    ) => ObjectPickResult | undefined
  >
>;

export type AttachCameraControlsSignature = Assert<
  IsAssignable<
    ObjectCanvasRenderer['attachCameraControls'],
    (
      options?: ObjectCanvasCameraControlsOptions
    ) => (releaseInterpolation?: ObjectInterpolationParameter | null) => void
  >
>;

export type OnCameraInteractionSignature = Assert<
  IsAssignable<
    ObjectCanvasRenderer['onCameraInteraction'],
    (
      listener: (event: ObjectCanvasCameraInteractionEvent) => void
    ) => () => void
  >
>;

export type OnCameraChangeSignature = Assert<
  IsAssignable<
    ObjectCanvasRenderer['onCameraChange'],
    (listener: (event: ObjectCanvasCameraChangeEvent) => void) => () => void
  >
>;

export type OnCameraStateChangeSignature = Assert<
  IsAssignable<
    ObjectRenderer['onCameraStateChange'],
    (
      listener: (event: ObjectRendererCameraStateChangeEvent) => void
    ) => () => void
  >
>;

export type CameraControlsOptionsShape = Assert<
  IsAssignable<
    {
      readonly pollingIntervalMs?: number;
      readonly interactionInterpolation?: ObjectInterpolationParameter | null;
      readonly pan?: {
        readonly trigger?: {
          readonly button?: 'left' | 'middle' | 'right' | 'back' | 'forward';
          readonly modifiers?: {
            readonly alt?: boolean;
            readonly ctrl?: boolean;
            readonly shift?: boolean;
            readonly meta?: boolean;
          };
        };
        readonly mode?: 'speed' | 'distance';
        readonly ratePerPixel?: number;
        readonly x?: {
          readonly invert?: boolean;
          readonly minValue?: number;
          readonly maxValue?: number;
        };
        readonly y?: {
          readonly invert?: boolean;
          readonly minValue?: number;
          readonly maxValue?: number;
        };
      };
      readonly rotation?: {
        readonly trigger?: {
          readonly button?: 'left' | 'middle' | 'right' | 'back' | 'forward';
          readonly modifiers?: {
            readonly alt?: boolean;
            readonly ctrl?: boolean;
            readonly shift?: boolean;
            readonly meta?: boolean;
          };
        };
        readonly mode?: 'free' | 'focusPlane';
        readonly yaw?: {
          readonly mode?: 'speed' | 'distance';
          readonly ratePerPixel?: number;
          readonly invert?: boolean;
          readonly enable?: boolean;
          readonly minDeg?: number;
          readonly maxDeg?: number;
        };
        readonly pitch?: {
          readonly mode?: 'speed' | 'distance';
          readonly ratePerPixel?: number;
          readonly invert?: boolean;
          readonly enable?: boolean;
          readonly minDeg?: number;
          readonly maxDeg?: number;
        };
      };
      readonly wheel?: {
        readonly planeZ?: number;
        readonly minDistance?: number;
        readonly maxDistance?: number;
        readonly sessionTimeoutMs?: number;
      };
    },
    ObjectCanvasCameraControlsOptions
  >
>;

export type InitializeScopeSignature = Assert<
  IsAssignable<
    ObjectRenderer['initializeScope'],
    (body: () => Promise<void>) => Promise<void>
  >
>;

export type AttachWebGLSignature = Assert<
  IsAssignable<
    ObjectRenderer['attachWebGL'],
    (gl: WebGLRenderingContext) => void
  >
>;

export type RenderSignature = Assert<
  IsAssignable<ObjectRenderer['render'], () => number | undefined>
>;

describe('sprite renderer awaitable overloads', () => {
  it('compiles overload constraints', () => {
    expect(true).toBe(true);
  });
});
