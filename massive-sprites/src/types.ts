// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

///////////////////////////////////////////////////////////////////////////////////

/**
 * Log levels for the logger interface
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Logger interface for customizable logging
 */
export interface Logger {
  /** Emits a debug-level message. */
  readonly debug: (message: string, ...args: unknown[]) => void;
  /** Emits an info-level message. */
  readonly info: (message: string, ...args: unknown[]) => void;
  /** Emits a warning-level message. */
  readonly warn: (message: string, ...args: unknown[]) => void;
  /** Emits an error-level message. */
  readonly error: (message: string, ...args: unknown[]) => void;
}

///////////////////////////////////////////////////////////////////////////////////

/**
 * CSS-like RGBA color string accepted by the renderer.
 */
export type ColorRGBA = `#${string}`;

/**
 * Interpolation strategy used when applying object updates.
 */
export type ObjectInterpolationMode = 'feedback' | 'feedforward';
/**
 * Directional variant used by easing functions that support asymmetric curves.
 */
export type ObjectInterpolationEasingMode = 'in' | 'out' | 'in-out';

/**
 * Linear interpolation easing.
 */
export interface ObjectInterpolationLinearEasing {
  /** Easing kind discriminant. */
  readonly type: 'linear';
}

/**
 * Power-based ease interpolation easing.
 */
export interface ObjectInterpolationEaseEasing {
  /** Easing kind discriminant. */
  readonly type: 'ease';
  /** Optional curve power. */
  readonly power?: number;
  /** Directional variant of the curve. */
  readonly mode?: ObjectInterpolationEasingMode;
}

/**
 * Exponential interpolation easing.
 */
export interface ObjectInterpolationExponentialEasing {
  /** Easing kind discriminant. */
  readonly type: 'exponential';
  /** Exponent applied by the curve. */
  readonly exponent?: number;
  /** Directional variant of the curve. */
  readonly mode?: ObjectInterpolationEasingMode;
}

/**
 * Quadratic interpolation easing.
 */
export interface ObjectInterpolationQuadraticEasing {
  /** Easing kind discriminant. */
  readonly type: 'quadratic';
  /** Directional variant of the curve. */
  readonly mode?: ObjectInterpolationEasingMode;
}

/**
 * Cubic interpolation easing.
 */
export interface ObjectInterpolationCubicEasing {
  /** Easing kind discriminant. */
  readonly type: 'cubic';
  /** Directional variant of the curve. */
  readonly mode?: ObjectInterpolationEasingMode;
}

/**
 * Sine-wave interpolation easing.
 */
export interface ObjectInterpolationSineEasing {
  /** Easing kind discriminant. */
  readonly type: 'sine';
  /** Directional variant of the curve. */
  readonly mode?: ObjectInterpolationEasingMode;
  /** Optional amplitude applied to the sine curve. */
  readonly amplitude?: number;
}

/**
 * Bouncing interpolation easing.
 */
export interface ObjectInterpolationBounceEasing {
  /** Easing kind discriminant. */
  readonly type: 'bounce';
  /** Number of bounce repetitions. */
  readonly bounces?: number;
  /** Damping factor applied across bounces. */
  readonly decay?: number;
}

/**
 * Overshooting interpolation easing.
 */
export interface ObjectInterpolationBackEasing {
  /** Easing kind discriminant. */
  readonly type: 'back';
  /** Overshoot amount for the back curve. */
  readonly overshoot?: number;
}

/**
 * Sigmoid-based interpolation easing.
 */
export interface ObjectInterpolationSigmoidEasing {
  /** Easing kind discriminant. */
  readonly type: 'sigmoid';
  /** Sigmoid steepness. */
  readonly k?: number;
  /** Midpoint used by the sigmoid. */
  readonly mid?: number;
}

/**
 * Supported interpolation easing definitions.
 */
export type ObjectInterpolationEasing =
  | ObjectInterpolationLinearEasing
  | ObjectInterpolationEaseEasing
  | ObjectInterpolationExponentialEasing
  | ObjectInterpolationQuadraticEasing
  | ObjectInterpolationCubicEasing
  | ObjectInterpolationSineEasing
  | ObjectInterpolationBounceEasing
  | ObjectInterpolationBackEasing
  | ObjectInterpolationSigmoidEasing;

/**
 * Interpolation configuration shared by placement and update values.
 */
export interface ObjectInterpolationParameter {
  /** Interpolation strategy. */
  readonly mode: ObjectInterpolationMode;
  /** Duration in milliseconds. */
  readonly durationMs: number;
  /** Easing definition. */
  readonly easing: ObjectInterpolationEasing;
}

///////////////////////////////////////////////////////////////////////////////////

/**
 * Initial value container with optional interpolation metadata.
 * @typeParam T - Value type.
 */
export interface ObjectPlacementValue<T> {
  /** Initial value. */
  readonly value: T;
  /** Optional interpolation used when the value is first applied. */
  readonly interpolation?: ObjectInterpolationParameter;
}

/**
 * Partial update container for a stateful value.
 * @typeParam T - Value type.
 */
export interface ObjectUpdateValue<T> {
  /**
   * `undefined` keeps the current value. When `interpolation` is provided,
   * the interpolation parameters are updated and (if applicable) the
   * interpolation restarts toward the last target.
   *
   * When both `value` and `interpolation` are `undefined`, the update is ignored.
   */
  readonly value?: T;
  /**
   * `undefined` keeps the previous interpolation config (if any) and restarts interpolation.
   * `null` means "apply immediately without interpolation" and clears the config.
   */
  readonly interpolation?: ObjectInterpolationParameter | null;
}

/**
 * Active interpolation state resolved by the renderer.
 * @typeParam T - Value type.
 */
export interface ObjectStateInterpolationParameter<
  T,
> extends ObjectInterpolationParameter {
  /** Value at the start of the active interpolation. */
  readonly fromValue: T;
  /** Value at the target of the active interpolation. */
  readonly toValue: T;
}

/**
 * Current value and its active interpolation state.
 * @typeParam T - Value type.
 */
export interface ObjectStateValue<T> {
  /** Current resolved value. */
  readonly value: T;
  /** Active interpolation state, when one exists. */
  readonly interpolation: ObjectStateInterpolationParameter<T> | undefined;
}

///////////////////////////////////////////////////////////////////////////////////

/**
 * Automatic direction mode that applies the detected direction to rotation.
 */
export interface SpriteAutoRotationMode {
  /** Discriminator for the rotation mode. */
  readonly type: 'rotation';
}

/**
 * Automatic direction mode that applies the detected direction to local-axis flipping.
 */
export interface SpriteAutoFlippingMode {
  /** Discriminator for the flipping mode. */
  readonly type: 'flipping';
  /** Whether the detected direction controls the local X axis. */
  readonly flipX?: boolean;
  /** Whether the detected direction controls the local Y axis. */
  readonly flipY?: boolean;
  /** Optional interpolation applied to both flip axes. */
  readonly interpolation?: ObjectInterpolationParameter;
}

/**
 * Automatic direction mode for an element.
 */
export type SpriteAutoDirectionMode =
  | SpriteAutoRotationMode
  | SpriteAutoFlippingMode;

/**
 * Coordinate space used to detect automatic direction.
 */
export type SpriteAutoDirectionSpace = 'world' | 'parent_local';

/**
 * Initial automatic direction configuration for a sprite element.
 */
export interface SpritePlacementAutoDirection {
  /** Coordinate space used to detect movement direction. */
  readonly space: SpriteAutoDirectionSpace;
  /** Optional automatic direction mode. */
  readonly mode?: SpriteAutoDirectionMode;
  /** Whether the detected direction also rotates `shiftAngleDeg`. */
  readonly shiftAngleRotation?: boolean;
  /** Minimum movement distance before direction updates are accepted. */
  readonly minDistance?: number;
}

/**
 * Automatic direction flipping mode update for a sprite element.
 */
export interface SpriteUpdateAutoFlippingMode {
  /** Discriminator for the flipping mode. */
  readonly type: 'flipping';
  /** Whether the detected direction controls the local X axis. */
  readonly flipX?: boolean;
  /** Whether the detected direction controls the local Y axis. */
  readonly flipY?: boolean;
  /**
   * `undefined` keeps the previous interpolation config.
   * `null` clears interpolation and applies target values immediately.
   */
  readonly interpolation?: ObjectInterpolationParameter | null;
}

/**
 * Automatic direction mode update for a sprite element.
 */
export type SpriteUpdateAutoDirectionMode =
  | SpriteAutoRotationMode
  | SpriteUpdateAutoFlippingMode;

/**
 * Automatic direction update for a sprite element.
 */
export interface SpriteUpdateAutoDirection {
  /** `undefined` keeps the current observation space. */
  readonly space?: SpriteAutoDirectionSpace;
  /**
   * `undefined` keeps the current mode.
   * `null` clears the current mode but preserves other auto-direction settings.
   */
  readonly mode?: SpriteUpdateAutoDirectionMode | null;
  /** `undefined` keeps the current shift-angle rotation flag. */
  readonly shiftAngleRotation?: boolean;
  /** `undefined` keeps the current minimum distance threshold. */
  readonly minDistance?: number;
}

/**
 * Resolved automatic flip state for one local axis.
 */
export interface SpriteStateAutoFlipAxis {
  /** Whether automatic direction controls this axis. */
  readonly enabled: boolean;
  /** Requested target value derived from the latest detected direction. */
  readonly commandValue: 1 | -1;
  /** Current interpolated local-axis scale in the range `[-1, 1]`. */
  readonly value: number;
}

/**
 * Resolved automatic direction mode that applies the detected direction to rotation.
 */
export interface SpriteStateAutoRotationMode {
  /** Discriminator for the rotation mode. */
  readonly type: 'rotation';
}

/**
 * Resolved automatic direction mode that applies the detected direction to local-axis flipping.
 */
export interface SpriteStateAutoFlippingMode {
  /** Discriminator for the flipping mode. */
  readonly type: 'flipping';
  /** Current automatic X-axis flipping state. */
  readonly flipX: SpriteStateAutoFlipAxis;
  /** Current automatic Y-axis flipping state. */
  readonly flipY: SpriteStateAutoFlipAxis;
  /** Shared interpolation config for the flip-axis runtime. */
  readonly interpolation: ObjectInterpolationParameter | undefined;
}

/**
 * Resolved automatic direction mode for a sprite element.
 */
export type SpriteStateAutoDirectionMode =
  | SpriteStateAutoRotationMode
  | SpriteStateAutoFlippingMode;

/**
 * Resolved automatic direction state for a sprite element.
 */
export interface SpriteStateAutoDirection {
  /** Coordinate space used to detect movement direction. */
  readonly space: SpriteAutoDirectionSpace;
  /** Current automatic direction mode, when configured. */
  readonly mode: SpriteStateAutoDirectionMode | undefined;
  /** Whether the detected direction also rotates `shiftAngleDeg`. */
  readonly shiftAngleRotation: boolean;
  /** Minimum movement distance before direction updates are accepted. */
  readonly minDistance: number;
  /** Latest detected direction in degrees. */
  readonly directionDeg: number;
  /** Effective rotation after applying automatic direction. */
  readonly finalRotateDeg: number;
  /** Effective shift angle after applying automatic direction. */
  readonly finalShiftAngleDeg: number;
}

/**
 * Rendering mode used for a sprite element quad.
 */
export type SpriteElementRenderMode =
  | 'surface'
  | 'billboard'
  | 'billboard_perspective';

/**
 * Leaderline options for an initially placed sprite element.
 */
export interface SpriteElementLeaderlinePlacement {
  /** Optional leaderline width. */
  readonly width?: ObjectPlacementValue<number>;
  /** Leaderline color or gradient. */
  readonly color: PolylineColor;
}

/**
 * Leaderline update payload for a sprite element.
 */
export interface SpriteElementLeaderlineUpdate {
  /** Optional leaderline width update. */
  readonly width?: ObjectUpdateValue<number>;
  /** New leaderline color or gradient. */
  readonly color: PolylineColor;
}

/**
 * Resolved leaderline state for a sprite element.
 */
export interface SpriteElementLeaderlineState {
  /** Resolved leaderline width. */
  readonly width: ObjectStateValue<number>;
  /** Resolved leaderline gradient. */
  readonly color: PolylineGradient;
}

/**
 * Border options for an initially placed sprite element.
 */
export interface SpriteElementBorderPlacement {
  /** Border color rendered around the sprite quad. */
  readonly color: ColorRGBA;
  /** Border width in world units. */
  readonly width: number;
}

/**
 * Border update payload for a sprite element.
 */
export interface SpriteElementBorderUpdate {
  /** New border color. `undefined` keeps the current value. */
  readonly color?: ColorRGBA;
  /** New border width in world units. `undefined` keeps the current value. */
  readonly width?: number;
}

/**
 * Resolved border state for a sprite element.
 */
export interface SpriteElementBorderState {
  /** Resolved border color. */
  readonly color: ColorRGBA;
  /** Resolved border width in world units. */
  readonly width: number;
}

/**
 * Origin reference for positioning a sprite element relative to another element.
 */
export interface SpriteElementOriginLocationPlacement {
  /**
   * Sprite element reference index.
   */
  readonly index: number;
  /**
   * When true, uses the parent's resolved anchor position (current behavior).
   * When false or undefined, uses the parent's pre-anchor position.
   * Defaults to false.
   */
  readonly useResolvedAnchor?: boolean;
}

/**
 * Element placement in world unit coordinates.
 */
export interface SpriteElementPlacement {
  /** Registered image id used by the element. */
  readonly imageId: string;
  /** Optional origin reference to another element. */
  readonly originLocation?: SpriteElementOriginLocationPlacement;
  /** Rendering mode for the element quad. */
  readonly mode?: SpriteElementRenderMode;
  /**
   * Draw order layer. Larger values render in front. Integer range 0..31.
   * Defaults to 0.
   */
  readonly layer?: number;
  /**
   * Draw order within a sprite. Larger values render in front. Integer range 0..7.
   * Defaults to 0.
   */
  readonly order?: number;
  /** Radial shift distance from the sprite origin. */
  readonly shiftDistance?: ObjectPlacementValue<number>;
  /** Shift direction in degrees. */
  readonly shiftAngleDeg?: ObjectPlacementValue<number>;
  /** Element scale factor. */
  readonly scale?: ObjectPlacementValue<number>;
  /** Element opacity multiplier. */
  readonly opacity?: ObjectPlacementValue<number>;
  /** Optional border configuration. */
  readonly border?: SpriteElementBorderPlacement;
  /** Optional leaderline configuration. */
  readonly leaderline?: SpriteElementLeaderlinePlacement;
  /** Horizontal anchor offset. */
  readonly anchorX?: ObjectPlacementValue<number>;
  /** Vertical anchor offset. */
  readonly anchorY?: ObjectPlacementValue<number>;
  /** Rotation configuration. */
  readonly rotation?: ObjectPlacementValue<number>;
  /** Automatic direction configuration. */
  readonly autoDirection?: SpritePlacementAutoDirection;
}

/**
 * Sprite placement in world unit coordinates.
 */
export interface SpritePlacement {
  /** Initial world X coordinate. */
  readonly sx: ObjectPlacementValue<number>;
  /** Initial world Y coordinate. */
  readonly sy: ObjectPlacementValue<number>;
  /** Initial world Z coordinate. */
  readonly sz?: number;
  /** Initial sprite opacity multiplier. */
  readonly opacity?: ObjectPlacementValue<number>;
  /**
   * Pseudo LOD threshold in world units. When the camera distance to the sprite
   * base point exceeds this value, the sprite fades out via opacity.
   */
  readonly visibilityDistance?: number;
  /** Element placements stored by element index. */
  readonly elements: readonly (SpriteElementPlacement | null | undefined)[]; // WASM_MAX_ELEMENTS_PER_SPRITE
}

///////////////////////////////////////////////////////////////////////////////////

/**
 * Sprite update in world unit coordinates.
 */
export interface SpriteElementUpdate {
  /**
   * `undefined`: keep current image binding.
   * `null`: clear current image binding.
   * `string`: bind image by id.
   */
  readonly imageId?: string | null;
  /** Optional origin reference update. */
  readonly originLocation?: SpriteElementOriginLocationPlacement;
  /** Optional render mode update. */
  readonly mode?: SpriteElementRenderMode;
  /**
   * Draw order layer. Larger values render in front. Integer range 0..31.
   * Defaults to 0.
   */
  readonly layer?: number;
  /**
   * Draw order within a sprite. Larger values render in front. Integer range 0..7.
   * Defaults to 0.
   */
  readonly order?: number;
  /** Optional radial shift distance update. */
  readonly shiftDistance?: ObjectUpdateValue<number>;
  /** Optional shift direction update. */
  readonly shiftAngleDeg?: ObjectUpdateValue<number>;
  /** Optional scale update. */
  readonly scale?: ObjectUpdateValue<number>;
  /** Optional opacity update. */
  readonly opacity?: ObjectUpdateValue<number>;
  /**
   * Optional border update.
   * `null` removes the current border.
   */
  readonly border?: SpriteElementBorderUpdate | null;
  /** Optional leaderline update. */
  readonly leaderline?: SpriteElementLeaderlineUpdate;
  /** Optional horizontal anchor update. */
  readonly anchorX?: ObjectUpdateValue<number>;
  /** Optional vertical anchor update. */
  readonly anchorY?: ObjectUpdateValue<number>;
  /** Optional rotation update. */
  readonly rotation?: ObjectUpdateValue<number>;
  /**
   * Optional automatic direction update.
   * `null` clears all automatic direction settings.
   */
  readonly autoDirection?: SpriteUpdateAutoDirection | null;
}

/**
 * Sprite update payload in world unit coordinates.
 */
export interface SpriteUpdate {
  /** Optional world X update. */
  readonly sx?: ObjectUpdateValue<number>;
  /** Optional world Y update. */
  readonly sy?: ObjectUpdateValue<number>;
  /** Optional world Z update. */
  readonly sz?: number;
  /** Optional sprite opacity update. */
  readonly opacity?: ObjectUpdateValue<number>;
  /**
   * `undefined` keeps the current threshold.
   * `null` disables pseudo LOD.
   * Positive finite numbers enable the distance check.
   */
  readonly visibilityDistance?: number | null;
  /**
   * Element update entries are index-based.
   *
   * - `undefined` at an entry: no-op for that element index.
   * - `null` at an entry: remove the element at that index (compacts indices).
   * - object at an entry: update existing element, or append when index equals current element count.
   *
   * Notes:
   * - Skipping indices when appending is invalid and will throw in `updateSprite`.
   * - `originLocation.index` remapping after compaction is caller responsibility.
   */
  readonly elements?: readonly (SpriteElementUpdate | undefined | null)[]; // WASM_MAX_ELEMENTS_PER_SPRITE
}

/**
 * Bulk sprite update with explicit target sprite id.
 */
export interface SpriteBulkUpdate extends SpriteUpdate {
  /** Target sprite id. */
  readonly spriteId: number;
}

///////////////////////////////////////////////////////////////////////////////////

/**
 * Resolved origin reference for a sprite element.
 */
export interface SpriteElementOriginLocationState {
  /** Referenced element index. */
  readonly index: number;
  /** Whether the resolved anchor position is used. */
  readonly useResolvedAnchor: boolean;
}

/**
 * Sprite state in world unit coordinates.
 */
export interface SpriteElementState {
  /** Bound image id, if any. */
  readonly imageId: string | undefined;
  /** Resolved origin reference. */
  readonly originLocation: SpriteElementOriginLocationState;
  /** Effective rendering mode. */
  readonly mode: SpriteElementRenderMode;
  /**
   * Draw order layer. Larger values render in front. Integer range 0..31.
   */
  readonly layer: number;
  /**
   * Draw order within a sprite. Larger values render in front. Integer range 0..7.
   */
  readonly order: number;
  /** Resolved radial shift distance. */
  readonly shiftDistance: ObjectStateValue<number>;
  /** Resolved shift angle in degrees. */
  readonly shiftAngleDeg: ObjectStateValue<number>;
  /** Resolved scale factor. */
  readonly scale: ObjectStateValue<number>;
  /** Resolved opacity multiplier. */
  readonly opacity: ObjectStateValue<number>;
  /** Resolved border state, when configured. */
  readonly border: SpriteElementBorderState | undefined;
  /** Resolved leaderline state. */
  readonly leaderline: SpriteElementLeaderlineState;
  /** Resolved horizontal anchor offset. */
  readonly anchorX: ObjectStateValue<number>;
  /** Resolved vertical anchor offset. */
  readonly anchorY: ObjectStateValue<number>;
  /** Resolved rotation state. */
  readonly rotation: ObjectStateValue<number>;
  /** Resolved automatic direction state. */
  readonly autoDirection: SpriteStateAutoDirection;
}

/**
 * Screen-space position in CSS pixels.
 */
export interface PositionInPixel {
  /** Horizontal screen coordinate in CSS pixels. */
  readonly xPixel: number;
  /** Vertical screen coordinate in CSS pixels. */
  readonly yPixel: number;
}

/**
 * Current sprite state in world unit coordinates.
 */
export interface SpriteState {
  /**
   * Timestamp used as the basis of this snapshot in milliseconds.
   *
   * `0` means the renderer has no computed snapshot timestamp yet.
   */
  readonly timestampMs: number;
  /** Current world X state. */
  readonly sx: ObjectStateValue<number>;
  /** Current world Y state. */
  readonly sy: ObjectStateValue<number>;
  /** Current world Z coordinate. */
  readonly sz: number;
  /**
   * Projected base-point position in CSS pixels relative to the viewport.
   * `undefined` when projection is unavailable for the snapshot.
   */
  readonly viewportBasePosition: PositionInPixel | undefined;
  /** Current sprite opacity state. */
  readonly opacity: ObjectStateValue<number>;
  /** Effective visibility distance threshold, when enabled. */
  readonly visibilityDistance: number | undefined;
  /** Element states stored by element index. */
  readonly elements: readonly (SpriteElementState | undefined)[]; // WASM_MAX_ELEMENTS_PER_SPRITE
}

///////////////////////////////////////////////////////////////////////////////////

/**
 * Two-color gradient definition for a polyline.
 */
export interface PolylineGradient {
  /** Gradient start color. */
  readonly color0: ColorRGBA;
  /** Gradient end color. */
  readonly color1: ColorRGBA;
  /** World-space repeat length. */
  readonly repeatLength: number; // world units, >0
}

/**
 * Color input accepted by polyline APIs.
 */
export type PolylineColor = ColorRGBA | PolylineGradient;

/**
 * Initial node definition for a polyline.
 */
export interface PolylineNodePlacement {
  /** Node X coordinate. */
  readonly x: number;
  /** Node Y coordinate. */
  readonly y: number;
  /** Node thickness in world units. */
  readonly thickness: number; // world units, >0
}

/**
 * Disables additional polyline join correction geometry.
 */
export interface PolylineJoinCorrectionNone {
  /** Join correction kind discriminant. */
  readonly type: 'none';
}

/**
 * Inserts an outer-side triangle fan at non-collinear polyline joins.
 */
export interface PolylineJoinCorrectionFan {
  /** Join correction kind discriminant. */
  readonly type: 'fan';
  /**
   * Number of intermediate fan points inserted between the two outer join edges.
   * `0` emits a single triangle.
   */
  readonly intermediatePointCount: number;
}

/**
 * Join correction accepted by polyline APIs.
 */
export type PolylineJoinCorrection =
  | PolylineJoinCorrectionNone
  | PolylineJoinCorrectionFan;

/**
 * Disables additional polyline cap correction geometry.
 */
export interface PolylineCapCorrectionNone {
  /** Cap correction kind discriminant. */
  readonly type: 'none';
}

/**
 * Inserts a triangle fan at each visible end of the polyline.
 */
export interface PolylineCapCorrectionFan {
  /** Cap correction kind discriminant. */
  readonly type: 'fan';
  /**
   * Number of fan points inserted between the two segment edge points.
   * Must be greater than or equal to `1`.
   */
  readonly pointCount: number;
}

/**
 * End-cap correction accepted by polyline APIs.
 */
export type PolylineCapCorrection =
  | PolylineCapCorrectionNone
  | PolylineCapCorrectionFan;

/**
 * Initial polyline placement payload.
 */
export interface PolylinePlacement {
  /** Ordered node list that defines the polyline path. */
  readonly nodes: readonly PolylineNodePlacement[]; // length >= 2
  /**
   * Draw order layer. Larger values render in front. Integer range 0..31.
   * Defaults to 0.
   */
  readonly layer?: number;
  /** Initial opacity multiplier. */
  readonly opacity?: ObjectPlacementValue<number>;
  /** Initial solid color or gradient. */
  readonly color: PolylineColor;
  /**
   * Optional join correction.
   * Defaults to `{ type: 'fan', intermediatePointCount: 0 }`.
   */
  readonly joinCorrection?: PolylineJoinCorrection;
  /**
   * Optional end-cap correction.
   * Defaults to `{ type: 'none' }`.
   */
  readonly capCorrection?: PolylineCapCorrection;
}

/**
 * Polyline update payload.
 */
export interface PolylineUpdate {
  /** Optional replacement node list. */
  readonly nodes?: readonly PolylineNodePlacement[]; // length >= 2
  /**
   * Draw order layer. Larger values render in front. Integer range 0..31.
   */
  readonly layer?: number;
  /** Optional opacity update. */
  readonly opacity?: ObjectUpdateValue<number>;
  /** Optional color update. */
  readonly color?: PolylineColor;
  /** Optional join correction update. `undefined` keeps the current setting. */
  readonly joinCorrection?: PolylineJoinCorrection;
  /** Optional cap correction update. `undefined` keeps the current setting. */
  readonly capCorrection?: PolylineCapCorrection;
}

/**
 * Bulk polyline update with explicit target polyline id.
 */
export interface PolylineBulkUpdate extends PolylineUpdate {
  /** Target polyline id. */
  readonly polylineId: number;
}

/**
 * Resolved node state for a polyline.
 */
export interface PolylineNodeState {
  /** Resolved node X coordinate. */
  readonly x: number;
  /** Resolved node Y coordinate. */
  readonly y: number;
  /** Resolved node thickness. */
  readonly thickness: number;
}

/**
 * Current polyline state.
 */
export interface PolylineState {
  /**
   * Timestamp used as the basis of this snapshot in milliseconds.
   *
   * `0` means the renderer has no computed snapshot timestamp yet.
   */
  readonly timestampMs: number;
  /** Resolved node list. */
  readonly nodes: readonly PolylineNodeState[];
  /**
   * Draw order layer. Larger values render in front. Integer range 0..31.
   */
  readonly layer: number;
  /** Resolved opacity multiplier. */
  readonly opacity: ObjectStateValue<number>;
  /** Resolved gradient representation. */
  readonly color: PolylineGradient;
  /** Resolved join correction. */
  readonly joinCorrection: PolylineJoinCorrection;
  /** Resolved end-cap correction. */
  readonly capCorrection: PolylineCapCorrection;
}

///////////////////////////////////////////////////////////////////////////////////

/**
 * Camera position in world units (Y grows upward).
 */
export interface CameraUpdatePosition {
  /**
   * `undefined` keeps the current state (including any active interpolation).
   */
  readonly x?: ObjectUpdateValue<number>;
  /**
   * `undefined` keeps the current state (including any active interpolation).
   */
  readonly y?: ObjectUpdateValue<number>;
  /**
   * `undefined` keeps the current state (including any active interpolation).
   */
  readonly z?: ObjectUpdateValue<number>;
}

/**
 * Rotation update payload for one camera axis.
 */
export interface CameraUpdateRotationValue {
  /**
   * `undefined` keeps the current value. When `interpolation` is provided,
   * the interpolation parameters are updated and (if applicable) the
   * interpolation restarts toward the last target.
   *
   * When both `value` and `interpolation` are `undefined`, the update is ignored.
   */
  readonly value?: number;
  /** Optional interpolation override for the axis update. */
  readonly interpolation?: ObjectInterpolationParameter | null;
}

/**
 * Camera rotation update grouped by axis.
 */
export interface CameraUpdateRotation {
  /**
   * `undefined` keeps the current state (including any active interpolation).
   */
  readonly yaw?: CameraUpdateRotationValue;
  /**
   * `undefined` keeps the current state (including any active interpolation).
   */
  readonly pitch?: CameraUpdateRotationValue;
  /**
   * `undefined` keeps the current state (including any active interpolation).
   */
  readonly roll?: CameraUpdateRotationValue;
}

/**
 * Camera configurations.
 */
export interface CameraUpdate {
  /** Optional position update. */
  readonly position?: CameraUpdatePosition;
  /** Optional rotation update. */
  readonly rotation?: CameraUpdateRotation;
  /** Optional vertical field-of-view update. */
  readonly fovY?: ObjectUpdateValue<number>;
  /** Optional near clip plane. */
  readonly near?: number;
  /** Optional far clip plane. */
  readonly far?: number;
}

/**
 * Options used when fitting the camera to visible objects.
 */
export interface CameraAdjustPositionOptions {
  /** Optional pitch override applied during fitting. */
  readonly pitch?: CameraUpdateRotationValue;
  /** Optional field-of-view override applied during fitting. */
  readonly fov?: ObjectUpdateValue<number>;
  /** Optional interpolation applied to the fit result. */
  readonly interpolation?: ObjectInterpolationParameter | null;
  /** Optional near clip plane override. */
  readonly near?: number;
  /** Optional far clip plane override. */
  readonly far?: number;
}

/**
 * Resolved camera position state.
 */
export interface CameraStatePosition {
  /** Current X position state. */
  readonly x: ObjectStateValue<number>;
  /** Current Y position state. */
  readonly y: ObjectStateValue<number>;
  /** Current Z position state. */
  readonly z: ObjectStateValue<number>;
}

/**
 * Resolved camera rotation state for one axis.
 */
export interface CameraStateRotationValue {
  /** Current rotation value in degrees. */
  readonly value: number;
  /** Active interpolation state, when one exists. */
  readonly interpolation: ObjectStateInterpolationParameter<number> | undefined;
}

/**
 * Resolved camera rotation state grouped by axis.
 */
export interface CameraStateRotation {
  /** Current yaw state. */
  readonly yaw: CameraStateRotationValue;
  /** Current pitch state. */
  readonly pitch: CameraStateRotationValue;
  /** Current roll state. */
  readonly roll: CameraStateRotationValue;
}

/**
 * Camera state in world units (Y grows upward).
 */
export interface ObjectCameraState {
  /** Current camera position state. */
  readonly position: CameraStatePosition;
  /** Current camera rotation state. */
  readonly rotation: CameraStateRotation;
  /** Current vertical field-of-view state. */
  readonly fovY: ObjectStateValue<number>;
  /** Near clip plane. */
  readonly near: number;
  /** Far clip plane. */
  readonly far: number;
  /** Current viewport aspect ratio. */
  readonly aspectRatio: number;
}

/**
 * Camera tracking mode resolved from the current target list.
 */
export type ObjectCameraTrackingMode = 'single' | 'fit';

/**
 * Content source used when resolving camera tracking bounds.
 */
export type ObjectCameraTrackingTargetMode = 'base' | 'contentApprox';

/**
 * Camera tracking configuration.
 */
export interface ObjectCameraTrackingOptions {
  /**
   * Sprite ids to track.
   *
   * When exactly one sprite id is provided, tracking keeps that sprite base
   * point centered while preserving `distance` (or resolving it from the
   * current camera state when omitted). When multiple sprite ids are provided,
   * tracking switches to fit mode automatically.
   */
  readonly spriteIds: readonly number[];
  /**
   * Content source used to resolve tracking bounds.
   *
   * `base` tracks sprite base points only.
   * `contentApprox` tracks all visible sprite elements using an approximate
   * content bounds calculation.
   *
   * Defaults to `base`.
   */
  readonly targetMode?: ObjectCameraTrackingTargetMode;
  /**
   * Optional fixed camera distance used for single-target tracking.
   *
   * When omitted for a single target, the current camera-to-target distance is
   * resolved at runtime and reused as the tracking distance.
   *
   * When `targetMode` is `contentApprox`, tracking may still increase the
   * effective distance to keep the resolved content bounds visible.
   */
  readonly distance?: number;
  /**
   * Minimum camera distance enforced after tracking resolves.
   *
   * This lower bound applies to both single-target and fit tracking. When the
   * resolved distance would move the camera closer than this limit, tracking
   * keeps the camera at `minDistance` instead.
   */
  readonly minDistance?: number;
  /**
   * Fit padding multiplier used when tracking multiple targets.
   * Defaults to `1.1`.
   */
  readonly fitPadding?: number;
  /**
   * Additional zoom multiplier applied to the fitted distance when tracking
   * multiple targets. Defaults to `1.0`.
   */
  readonly fitZoomBias?: number;
  /**
   * Optional interpolation applied to tracking-generated camera position
   * updates. When omitted, tracking updates are applied immediately.
   */
  readonly interpolation?: ObjectInterpolationParameter | null;
}

/**
 * Current camera tracking state.
 */
export interface ObjectCameraTrackingState extends ObjectCameraTrackingOptions {
  /**
   * Tracking mode resolved from the active target list.
   */
  readonly mode: ObjectCameraTrackingMode;
  /**
   * Effective distance currently used by tracking.
   *
   * For single-target tracking this is the fixed or resolved distance after
   * applying `minDistance`.
   * For fit tracking this is the most recent fitted distance after applying
   * `fitZoomBias` and `minDistance`.
   */
  readonly resolvedDistance: number | undefined;
}

/**
 * Size in pixel unit.
 */
export interface SizeInPixel {
  /** Width in CSS or logical pixels. */
  readonly widthPixel: number;
  /** Height in CSS or logical pixels. */
  readonly heightPixel: number;
}

/**
 * Resize strategy used before uploading a sprite image to an atlas.
 */
export type SpriteImageResizeMode = 'contain' | 'cover' | 'stretch';

/**
 * Quality hint used while resizing sprite images.
 */
export type SpriteImageResizeQuality = 'low' | 'medium' | 'high';

/**
 * Resize options applied before atlas upload.
 */
export interface SpriteImageResizeOptions {
  /**
   * Maximum width in pixels for the uploaded texture.
   */
  readonly maxWidth?: number;
  /**
   * Maximum height in pixels for the uploaded texture.
   */
  readonly maxHeight?: number;
  /**
   * Resize behavior when both max width/height are provided.
   */
  readonly mode?: SpriteImageResizeMode;
  /**
   * Allow upscaling above the source dimensions.
   */
  readonly allowUpscale?: boolean;
  /**
   * Resize quality hint.
   */
  readonly quality?: SpriteImageResizeQuality;
}

/**
 * Image registration options used by atlas upload APIs.
 */
export interface SpriteImageRegisterOptions {
  /**
   * Resize options applied before atlas upload.
   */
  readonly resize?: SpriteImageResizeOptions;
  /**
   * Logical size used for sprite layout (defaults to source size).
   */
  readonly logicalSize?: SizeInPixel;
}

/**
 * Horizontal alignment options for text glyphs.
 */
export type SpriteTextGlyphHorizontalAlign = 'left' | 'center' | 'right';

/**
 * Padding in pixels applied when rendering text glyphs.
 */
export type SpriteTextGlyphPaddingPixel =
  | number
  | {
      readonly top?: number;
      readonly right?: number;
      readonly bottom?: number;
      readonly left?: number;
    };

/**
 * Border sides that can be rendered for a text glyph outline.
 */
export type SpriteTextGlyphBorderSide = 'top' | 'right' | 'bottom' | 'left';

/**
 * Additional size options accepted by registerTextGlyph.
 */
export type SpriteTextGlyphDimensions =
  | { readonly lineHeightPixel: number; readonly maxWidthPixel?: never }
  | { readonly maxWidthPixel: number; readonly lineHeightPixel?: never };

/**
 * Text glyph appearance options.
 */
export interface SpriteTextGlyphOptions {
  /** Font family name. */
  readonly fontFamily?: string;
  /** CSS font-weight value. */
  readonly fontWeight?: string;
  /** CSS font-style value. */
  readonly fontStyle?: 'normal' | 'italic';
  /** Text fill color. */
  readonly color?: string;
  /** Letter spacing in pixels. */
  readonly letterSpacingPixel?: number;
  /** Background color applied behind the text. */
  readonly backgroundColor?: string;
  /** Padding around the glyph. */
  readonly paddingPixel?: SpriteTextGlyphPaddingPixel;
  /** Outline color. */
  readonly borderColor?: string;
  /** Outline width in pixels. */
  readonly borderWidthPixel?: number;
  /** Border sides to draw; defaults to all four sides when omitted. */
  readonly borderSides?: readonly SpriteTextGlyphBorderSide[];
  /** Border radius in pixels. */
  readonly borderRadiusPixel?: number;
  /** Horizontal alignment of multiline text. */
  readonly textAlign?: SpriteTextGlyphHorizontalAlign;
  /** Preferred font size in pixels; may shrink automatically to satisfy provided dimensions. */
  readonly fontSizePixelHint?: number;
  /** Pixel ratio used when rendering the glyph; defaults to 1 and values > 1 render at higher resolution. */
  readonly renderPixelRatio?: number;
}

/**
 * Supported texture minification filters for atlas pages.
 */
export type SpriteTextureMinFilter =
  | 'nearest'
  | 'linear'
  | 'nearestMipmapNearest'
  | 'linearMipmapNearest'
  | 'nearestMipmapLinear'
  | 'linearMipmapLinear';

/**
 * Supported texture magnification filters for atlas pages.
 */
export type SpriteTextureMagFilter = 'nearest' | 'linear';

/**
 * Supported texture wrap modes for atlas pages.
 */
export type SpriteTextureWrapMode = 'clampToEdge' | 'repeat' | 'mirroredRepeat';

/**
 * Behavior when NPOT texture sampling is incompatible with WebGL1.
 */
export type SpriteTextureNpotPolicy = 'fallback' | 'error';

/**
 * Texture sampling options for atlas pages.
 */
export interface SpriteTextureSamplingOptions {
  /** Minification filter used for atlas pages. */
  readonly minFilter?: SpriteTextureMinFilter;
  /** Magnification filter used for atlas pages. */
  readonly magFilter?: SpriteTextureMagFilter;
  /** Horizontal wrap mode. */
  readonly wrapS?: SpriteTextureWrapMode;
  /** Vertical wrap mode. */
  readonly wrapT?: SpriteTextureWrapMode;
  /** NPOT fallback policy used under WebGL1 restrictions. */
  readonly npotPolicy?: SpriteTextureNpotPolicy;
  /** Requested anisotropy level when supported. */
  readonly maxAnisotropy?: number;
}

/**
 * Pick-mask configuration applied to every page in an atlas.
 */
export interface SpriteAtlasPickMaskOptions {
  /**
   * Enables alpha-threshold-based sprite picking for images uploaded to the atlas.
   * When omitted, the presence of {@link SpriteAtlasOptions.pickMask} enables it.
   */
  readonly enabled?: boolean;
  /**
   * Inclusive alpha threshold in byte units (`0..255`) used to build the 1-bit mask.
   * Pixels whose alpha is below this threshold are treated as transparent for picking.
   */
  readonly alphaThreshold?: number;
}

/**
 * Atlas configuration options.
 */
export interface SpriteAtlasOptions {
  /**
   * Atlas page width in pixels.
   */
  readonly widthPixel?: number;
  /**
   * Atlas page height in pixels.
   */
  readonly heightPixel?: number;
  /**
   * Padding between images in pixels.
   */
  readonly paddingPixel?: number;
  /**
   * UV inset in pixels to reduce filtering bleed.
   */
  readonly uvInsetPixel?: number;
  /**
   * Maximum number of pages. `undefined` or non-positive means unlimited.
   */
  readonly maxPages?: number;
  /**
   * Default resize options for images registered to this atlas.
   */
  readonly defaultImageResize?: SpriteImageResizeOptions;
  /**
   * Texture sampling options used for pages in this atlas.
   */
  readonly textureSampling?: SpriteTextureSamplingOptions;
  /**
   * Optional alpha-threshold mask used by sprite picking.
   * The mask is generated once during upload and shared with WASM as a 1-bit page buffer.
   */
  readonly pickMask?: SpriteAtlasPickMaskOptions;
}

///////////////////////////////////////////////////////////////////////////////////

/**
 * Object renderer performance snapshot.
 */
export interface ObjectPerformanceSnapshot {
  /**
   * Timestamp of the latest render sample included in this snapshot.
   * The value is based on `performance.now()` when available, otherwise `Date.now()`.
   */
  readonly timestampMs: number;
  /**
   * Rolling aggregation window in milliseconds.
   * Samples older than this range from `timestampMs` are excluded.
   */
  readonly windowMs: number;
  /**
   * Number of render samples currently included in the rolling window.
   */
  readonly sampleCount: number;
  /**
   * Average render pace derived from consecutive render sample timestamps.
   * Calculated as `(sampleCount - 1) * 1000 / elapsedWindowTimeMs`.
   */
  readonly fps: number;
  /**
   * Average interval between consecutive render samples in milliseconds.
   */
  readonly avgFrameIntervalMs: number;
  /**
   * Average duration of the outer canvas renderer `render()` call in milliseconds.
   * This includes viewport synchronization, `gl.clear*`, and object renderer execution.
   * For bare `ObjectRenderer`, this matches `avgSpriteRenderDurationMs`.
   */
  readonly avgCanvasRenderDurationMs: number;
  /**
   * Average duration of object renderer `render()` in milliseconds.
   * This covers buffer preparation, WASM invocation, and WebGL command submission.
   */
  readonly avgSpriteRenderDurationMs: number;
  /**
   * Average elapsed time spent in the WASM `compute_vertices` call in milliseconds.
   */
  readonly avgWasmComputeDurationMs: number;
  /**
   * Average time spent inside the WASM `compute_vertices` implementation.
   * This is a WASM-internal breakdown total and may differ slightly from `avgWasmComputeDurationMs`.
   */
  readonly avgWasmComputeInternalDurationMs: number;
  /**
   * Average time spent updating the projection matrix inside WASM.
   */
  readonly avgWasmComputeProjectionDurationMs: number;
  /**
   * Average time spent updating sprite animations inside WASM.
   */
  readonly avgWasmComputeSpriteAnimationDurationMs: number;
  /**
   * Average time spent updating element animations and pivots inside WASM.
   */
  readonly avgWasmComputeElementAnimationDurationMs: number;
  /**
   * Average time spent resolving pivot hierarchy inside WASM.
   */
  readonly avgWasmComputePivotResolveDurationMs: number;
  /**
   * Average time spent applying auto rotation inside WASM.
   */
  readonly avgWasmComputeAutoRotationDurationMs: number;
  /**
   * Average time spent collecting sprite entries inside WASM.
   */
  readonly avgWasmComputeCollectEntriesDurationMs: number;
  /**
   * Average time spent sorting sprite entries inside WASM.
   */
  readonly avgWasmComputeSortEntriesDurationMs: number;
  /**
   * Average time spent writing output vertices inside WASM.
   */
  readonly avgWasmComputeWriteOutputDurationMs: number;
  /**
   * Average time spent resolving camera tracking on the JS side.
   */
  readonly avgCameraTrackingDurationMs: number;
  /**
   * Average non-WASM CPU time in milliseconds.
   * Computed as `avgSpriteRenderDurationMs - avgWasmComputeDurationMs`.
   * This represents JavaScript-side work and WebGL command submission time.
   */
  readonly avgCpuDurationMs: number;
  /**
   * Share of sprite render time consumed by WASM compute.
   * Computed as `avgWasmComputeDurationMs / avgSpriteRenderDurationMs`, clamped to `0..1`.
   */
  readonly wasmComputeRatio: number;
  /**
   * Average duration spent applying queued sprite commands per render sample.
   * This includes WASM command application plus JS-side result handling.
   */
  readonly avgCommandApplyDurationMs: number;
  /**
   * Average elapsed time spent in the WASM `apply_commands` call per render sample.
   */
  readonly avgCommandApplyCallDurationMs: number;
  /**
   * Average JS-side time spent after applying WASM commands per render sample.
   * This includes result handling and command buffer resets.
   */
  readonly avgCommandApplyJsDurationMs: number;
  /**
   * Average time spent inside WASM `apply_commands` per render sample.
   * This excludes JS-side result handling and buffer management.
   */
  readonly avgCommandApplyWasmDurationMs: number;
  /**
   * Average time spent in the WASM command loop (command parsing + apply).
   * This includes any sync-slot processing invoked by update/remove commands.
   */
  readonly avgCommandApplyWasmLoopDurationMs: number;
  /**
   * Average time spent synchronizing element owner/originLocation slots in WASM.
   */
  readonly avgCommandApplyWasmSyncSlotsDurationMs: number;
  /**
   * Average time spent clearing the command buffer in WASM.
   */
  readonly avgCommandApplyWasmClearDurationMs: number;
  /**
   * Average time spent setting up GL state for drawing per render sample.
   */
  readonly avgDrawSetupDurationMs: number;
  /**
   * Average time spent ensuring render buffers per render sample.
   * This includes JS-side buffer growth checks and memory sync.
   */
  readonly avgEnsureRenderBuffersDurationMs: number;
  /**
   * Average time spent uploading vertex data to WebGL per render sample.
   */
  readonly avgVertexUploadDurationMs: number;
  /**
   * Average time spent in the JS draw loop (texture binds + draw calls).
   */
  readonly avgDrawLoopDurationMs: number;
  /**
   * Average number of queued sprite commands applied per render sample.
   */
  readonly avgCommandCount: number;
  /**
   * Average number of updateSprite commands applied per render sample.
   */
  readonly avgUpdateSpriteCommandCount: number;
  /**
   * Share of render samples that processed at least one updateSprite command.
   * The value is clamped to `0..1`.
   */
  readonly updateFrameRatio: number;
  /**
   * Average delay between the first queued updateSprite command and its application.
   * Calculated only on render samples that processed updateSprite commands.
   */
  readonly avgUpdateQueueDelayMs: number;
  /**
   * Average number of active elements returned by `compute_vertices` per render sample.
   */
  readonly avgActiveElementCount: number;
  /**
   * Average number of `gl.drawArrays` calls issued per render sample.
   */
  readonly avgDrawCallCount: number;
  /**
   * Average number of texture binds issued per render sample.
   */
  readonly avgTextureBindCount: number;
  /**
   * Average number of active elements skipped from drawing per render sample.
   */
  readonly avgSkippedDrawCount: number;
  /**
   * Average time spent in `gl.bindTexture` calls per render sample.
   */
  readonly avgTextureBindDurationMs: number;
  /**
   * Average time spent in `gl.uniform1f` opacity updates per render sample.
   */
  readonly avgOpacityUniformDurationMs: number;
  /**
   * Average time spent in `gl.drawArrays` calls per render sample.
   */
  readonly avgDrawCallDurationMs: number;
  /**
   * Average number of WASM buffer resize events per render sample.
   * Resize events include capacity growth of sprite/input/output/texture-index/opacity buffers.
   */
  readonly avgWasmBufferResizeCount: number;
  /**
   * Cumulative number of WASM buffer resize events since the last reset/release.
   */
  readonly totalWasmBufferResizeCount: number;
}

///////////////////////////////////////////////////////////////////////////////////

/**
 * Disposable object with an explicit release method.
 */
export interface Releaseable extends Disposable {
  /** Releases owned resources and makes the object unusable. */
  readonly release: () => void;
}

/**
 * Input precision used by the compute WASM module.
 */
export type WasmInputPrecision = 'f32' | 'f64';

/**
 * Distance-based scaling limits in world units.
 */
export interface DistanceScalingOptions {
  /**
   * Distance from the camera at or below which objects stop shrinking further.
   * Set to `0` or omit to disable the near-distance clamp.
   */
  readonly minScaleDistance?: number;
  /**
   * Distance from the camera at or above which objects stop growing further.
   * Set to `0`, `Infinity`, or omit to disable the far-distance clamp.
   */
  readonly maxScaleDistance?: number;
}

/**
 * Options for creating an object renderer.
 */
export interface ObjectRendererOptions {
  /** WASM input precision used by the renderer. */
  readonly precision?: WasmInputPrecision;
  /** Logger used for warnings and diagnostics. */
  readonly logger?: Logger;
  /**
   * Optional scaling limits applied to sprite geometry.
   * Defaults to `UNLIMITED_DISTANCE_SCALING_OPTIONS`.
   */
  readonly spriteScaling?: DistanceScalingOptions;
  /**
   * Optional scaling limits applied to polyline thickness.
   * Defaults to `UNLIMITED_DISTANCE_SCALING_OPTIONS`.
   */
  readonly polylineScaling?: DistanceScalingOptions;
}

/**
 * Common WebGL object renderer interface
 */
export interface ObjectRendererCommon {
  /**
   * Makes initialization scope, handler body will run safer with awaitable.
   * @param body - Initialization body
   * @remarks Several functions in ObjectRendererCommon return Promises.
   *          Initialization code can safely await within this handler.
   *          Otherwise, it may cause deadlocks, this occurs because promises are not processed by render.
   * @returns Promise resolved after the initialization body completes.
   */
  readonly initializeScope: (body: () => Promise<void>) => Promise<void>;

  /**
   * Gets the maximum atlas size supported by the current WebGL context.
   * @returns Maximum atlas size in pixels.
   */
  readonly getMaxAtlasSize: () => SizeInPixel;
  /**
   * Allocates a new atlas and returns its id.
   * @param options - Atlas allocation options.
   * @returns Allocated atlas id.
   */
  readonly allocateAtlas: (options?: SpriteAtlasOptions) => number;
  /**
   * Releases an atlas and unregisters images stored in it.
   * @param atlasId - Atlas id to release.
   */
  readonly releaseAtlas: (atlasId: number) => void;

  /**
   * Registers an image inside an atlas.
   * @param atlasId - Target atlas id.
   * @param imageId - Unique image id.
   * @param imageSource - Image source to upload.
   * @param upScalingToPowerOfTwo - Whether the source may be resized to power-of-two dimensions.
   * @param options - Optional resize and logical-size settings.
   * @returns Uploaded logical image size.
   */
  readonly registerImage: (
    atlasId: number,
    imageId: string,
    imageSource: TexImageSource,
    upScalingToPowerOfTwo?: boolean,
    options?: SpriteImageRegisterOptions
  ) => Promise<SizeInPixel>;
  /**
   * Registers a text glyph texture for later use.
   *
   * @param {number} atlasId - Target atlas id for the glyph.
   * @param {string} imageId - Unique identifier for the text glyph.
   * @param {string} text - Text content to render.
   * @param {SpriteTextGlyphDimensions} dimensions - Glyph sizing options.
   * @param {SpriteTextGlyphOptions | undefined} options - Optional styling information.
   * @returns {Promise<SizeInPixel>} Resolves to the uploaded glyph size in pixels.
   */
  readonly registerTextGlyph: (
    atlasId: number,
    imageId: string,
    text: string,
    dimensions: SpriteTextGlyphDimensions,
    options?: SpriteTextGlyphOptions
  ) => Promise<SizeInPixel>;
  /**
   * Unregisters an image previously added to an atlas.
   * @param imageId - Image id to remove.
   */
  readonly unregisterImage: (imageId: string) => void;

  /**
   * Adds a sprite and returns an opaque `spriteId` when awaited.
   * The id is stable for the lifetime of the sprite and does not change when
   * other sprites are removed.
   * @param placement - Sprite placement and rendering parameters.
   *
   * - `awaitable === true`: returns an allocated promise that resolves with the sprite id,
   *   or rejects on validation failure.
   * - `awaitable !== true`: returns `undefined` and ignores validation failures.
   */
  addSprite(placement: SpritePlacement): void;
  /** @inheritdoc */
  addSprite(placement: SpritePlacement, awaitable: false): void;
  /** @inheritdoc */
  addSprite(placement: SpritePlacement, awaitable: true): Promise<number>;
  /** @inheritdoc */
  addSprite(
    placement: SpritePlacement,
    awaitable?: boolean
  ): void | Promise<number>;

  /**
   * Adds sprites in bulk and returns sprite ids when awaited.
   * @param placements - Sprite placements in submission order.
   *
   * - `awaitable === true`: returns an allocated promise that resolves with sprite ids
   *   in the same order as `placements`, or rejects on validation failure.
   * - `awaitable !== true`: returns `undefined` and ignores validation failures.
   */
  addSprites(placements: readonly SpritePlacement[]): void;
  /** @inheritdoc */
  addSprites(placements: readonly SpritePlacement[], awaitable: false): void;
  /** @inheritdoc */
  addSprites(
    placements: readonly SpritePlacement[],
    awaitable: true
  ): Promise<number[]>;
  /** @inheritdoc */
  addSprites(
    placements: readonly SpritePlacement[],
    awaitable?: boolean
  ): void | Promise<number[]>;

  /**
   * Updates a sprite by id.
   * @param spriteId - Target sprite id.
   * @param update - Partial sprite update payload.
   *
   * - `awaitable === true`: returns an allocated promise that rejects on validation failure.
   * - `awaitable !== true`: returns `undefined` and ignores validation failures.
   */
  updateSprite(spriteId: number, update: SpriteUpdate): void;
  /** @inheritdoc */
  updateSprite(spriteId: number, update: SpriteUpdate, awaitable: false): void;
  /** @inheritdoc */
  updateSprite(
    spriteId: number,
    update: SpriteUpdate,
    awaitable: true
  ): Promise<void>;
  /** @inheritdoc */
  updateSprite(
    spriteId: number,
    update: SpriteUpdate,
    awaitable?: boolean
  ): void | Promise<void>;

  /**
   * Updates sprites by id in bulk.
   * @param updates - Bulk sprite updates keyed by sprite id.
   *
   * - `awaitable === true`: returns an allocated promise that rejects on validation failure.
   * - `awaitable !== true`: returns `undefined` and ignores validation failures.
   */
  updateSprites(updates: readonly SpriteBulkUpdate[]): void;
  /** @inheritdoc */
  updateSprites(updates: readonly SpriteBulkUpdate[], awaitable: false): void;
  /** @inheritdoc */
  updateSprites(
    updates: readonly SpriteBulkUpdate[],
    awaitable: true
  ): Promise<void>;
  /** @inheritdoc */
  updateSprites(
    updates: readonly SpriteBulkUpdate[],
    awaitable?: boolean
  ): void | Promise<void>;

  /**
   * Removes a sprite by id.
   * Internal storage may be compacted, but issued ids are not reused within
   * the renderer instance.
   * @param spriteId - Target sprite id.
   *
   * - `awaitable === true`: returns an allocated promise that rejects on validation failure.
   * - `awaitable !== true`: returns `undefined` and ignores validation failures.
   */
  removeSprite(spriteId: number): void;
  /** @inheritdoc */
  removeSprite(spriteId: number, awaitable: false): void;
  /** @inheritdoc */
  removeSprite(spriteId: number, awaitable: true): Promise<void>;
  /** @inheritdoc */
  removeSprite(spriteId: number, awaitable?: boolean): void | Promise<void>;

  /**
   * Removes sprites by id in bulk.
   * @param spriteIds - Sprite ids to remove.
   *
   * - `awaitable === true`: returns an allocated promise that rejects on validation failure.
   * - `awaitable !== true`: returns `undefined` and ignores validation failures.
   */
  removeSprites(spriteIds: readonly number[]): void;
  /** @inheritdoc */
  removeSprites(spriteIds: readonly number[], awaitable: false): void;
  /** @inheritdoc */
  removeSprites(spriteIds: readonly number[], awaitable: true): Promise<void>;
  /** @inheritdoc */
  removeSprites(
    spriteIds: readonly number[],
    awaitable?: boolean
  ): void | Promise<void>;

  /**
   * Adds a polyline and returns an opaque `polylineId` when awaited.
   * The id is stable for the lifetime of the polyline and does not change when
   * other polylines are removed.
   * @param placement - Polyline placement and rendering parameters.
   *
   * - `awaitable === true`: returns an allocated promise that resolves with the polyline id,
   *   or rejects on validation failure.
   * - `awaitable !== true`: returns `undefined` and ignores validation failures.
   */
  addPolyline(placement: PolylinePlacement): void;
  /** @inheritdoc */
  addPolyline(placement: PolylinePlacement, awaitable: false): void;
  /** @inheritdoc */
  addPolyline(placement: PolylinePlacement, awaitable: true): Promise<number>;
  /** @inheritdoc */
  addPolyline(
    placement: PolylinePlacement,
    awaitable?: boolean
  ): void | Promise<number>;

  /**
   * Adds polylines in bulk and returns polyline ids when awaited.
   * @param placements - Polyline placements in submission order.
   *
   * - `awaitable === true`: returns an allocated promise that resolves with polyline ids
   *   in the same order as `placements`, or rejects on validation failure.
   * - `awaitable !== true`: returns `undefined` and ignores validation failures.
   */
  addPolylines(placements: readonly PolylinePlacement[]): void;
  /** @inheritdoc */
  addPolylines(
    placements: readonly PolylinePlacement[],
    awaitable: false
  ): void;
  /** @inheritdoc */
  addPolylines(
    placements: readonly PolylinePlacement[],
    awaitable: true
  ): Promise<number[]>;
  /** @inheritdoc */
  addPolylines(
    placements: readonly PolylinePlacement[],
    awaitable?: boolean
  ): void | Promise<number[]>;

  /**
   * Updates a polyline by id.
   * @param polylineId - Target polyline id.
   * @param update - Partial polyline update payload.
   *
   * - `awaitable === true`: returns an allocated promise that rejects on validation failure.
   * - `awaitable !== true`: returns `undefined` and ignores validation failures.
   */
  updatePolyline(polylineId: number, update: PolylineUpdate): void;
  /** @inheritdoc */
  updatePolyline(
    polylineId: number,
    update: PolylineUpdate,
    awaitable: false
  ): void;
  /** @inheritdoc */
  updatePolyline(
    polylineId: number,
    update: PolylineUpdate,
    awaitable: true
  ): Promise<void>;
  /** @inheritdoc */
  updatePolyline(
    polylineId: number,
    update: PolylineUpdate,
    awaitable?: boolean
  ): void | Promise<void>;

  /**
   * Updates polylines by id in bulk.
   * @param updates - Bulk polyline updates keyed by polyline id.
   *
   * - `awaitable === true`: returns an allocated promise that rejects on validation failure.
   * - `awaitable !== true`: returns `undefined` and ignores validation failures.
   */
  updatePolylines(updates: readonly PolylineBulkUpdate[]): void;
  /** @inheritdoc */
  updatePolylines(
    updates: readonly PolylineBulkUpdate[],
    awaitable: false
  ): void;
  /** @inheritdoc */
  updatePolylines(
    updates: readonly PolylineBulkUpdate[],
    awaitable: true
  ): Promise<void>;
  /** @inheritdoc */
  updatePolylines(
    updates: readonly PolylineBulkUpdate[],
    awaitable?: boolean
  ): void | Promise<void>;

  /**
   * Removes a polyline by id.
   * Internal storage may be compacted, but issued ids are not reused within
   * the renderer instance.
   * @param polylineId - Target polyline id.
   *
   * - `awaitable === true`: returns an allocated promise that rejects on validation failure.
   * - `awaitable !== true`: returns `undefined` and ignores validation failures.
   */
  removePolyline(polylineId: number): void;
  /** @inheritdoc */
  removePolyline(polylineId: number, awaitable: false): void;
  /** @inheritdoc */
  removePolyline(polylineId: number, awaitable: true): Promise<void>;
  /** @inheritdoc */
  removePolyline(polylineId: number, awaitable?: boolean): void | Promise<void>;

  /**
   * Removes polylines by id in bulk.
   * @param polylineIds - Polyline ids to remove.
   *
   * - `awaitable === true`: returns an allocated promise that rejects on validation failure.
   * - `awaitable !== true`: returns `undefined` and ignores validation failures.
   */
  removePolylines(polylineIds: readonly number[]): void;
  /** @inheritdoc */
  removePolylines(polylineIds: readonly number[], awaitable: false): void;
  /** @inheritdoc */
  removePolylines(
    polylineIds: readonly number[],
    awaitable: true
  ): Promise<void>;
  /** @inheritdoc */
  removePolylines(
    polylineIds: readonly number[],
    awaitable?: boolean
  ): void | Promise<void>;

  /**
   * Gets current sprite state by id.
   *
   * When `timestampMs` is omitted or `0`, the renderer returns the last
   * computed snapshot. Non-zero values request a timestamp-based state read.
   * Throws when `spriteId` is invalid or the renderer does not support state queries.
   * @param spriteId - Target sprite id.
   * @param timestampMs - Optional timestamp for historical or current state lookup.
   * @returns Resolved sprite state.
   */
  readonly getSpriteState: (
    spriteId: number,
    timestampMs?: number
  ) => SpriteState;

  /**
   * Gets current polyline state by id.
   *
   * When `timestampMs` is omitted or `0`, the renderer returns the last
   * computed snapshot. Non-zero values request a timestamp-based state read.
   * Throws when `polylineId` is invalid or the renderer does not support state queries.
   * @param polylineId - Target polyline id.
   * @param timestampMs - Optional timestamp for historical or current state lookup.
   * @returns Resolved polyline state.
   */
  readonly getPolylineState: (
    polylineId: number,
    timestampMs?: number
  ) => PolylineState;

  /**
   * Updates camera parameters.
   * @param camera - Partial camera update payload.
   *
   * - `awaitable === true`: returns an allocated promise that rejects on validation failure.
   * - `awaitable !== true`: returns `undefined` and ignores validation failures.
   */
  updateCamera(camera: CameraUpdate): void;
  /** @inheritdoc */
  updateCamera(camera: CameraUpdate, awaitable: false): void;
  /** @inheritdoc */
  updateCamera(camera: CameraUpdate, awaitable: true): Promise<void>;
  /** @inheritdoc */
  updateCamera(camera: CameraUpdate, awaitable?: boolean): void | Promise<void>;

  /**
   * Adjusts camera position to fit all sprites and polylines in view.
   *
   * `options` can override pitch, field of view, near/far, and interpolation.
   * @param options - Camera fitting options.
   *
   * - `awaitable === true`: returns an allocated promise that rejects on validation failure.
   * - `awaitable !== true`: returns `undefined` and ignores validation failures.
   */
  adjustCameraPosition(options: CameraAdjustPositionOptions): void;
  /** @inheritdoc */
  adjustCameraPosition(
    options: CameraAdjustPositionOptions,
    awaitable: false
  ): void;
  /** @inheritdoc */
  adjustCameraPosition(
    options: CameraAdjustPositionOptions,
    awaitable: true
  ): Promise<void>;
  /** @inheritdoc */
  adjustCameraPosition(
    options: CameraAdjustPositionOptions,
    awaitable?: boolean
  ): void | Promise<void>;

  /**
   * Gets current camera state.
   * @returns Current camera state snapshot.
   */
  readonly getCameraState: () => ObjectCameraState;
  /**
   * Enables or replaces camera tracking.
   * @param tracking - Tracking configuration.
   */
  readonly setCameraTracking: (tracking: ObjectCameraTrackingOptions) => void;
  /**
   * Clears the current camera tracking configuration.
   */
  readonly clearCameraTracking: () => void;
  /**
   * Returns the current camera tracking state.
   * @returns Tracking state, or `null` when tracking is disabled.
   */
  readonly getCameraTrackingState: () => ObjectCameraTrackingState | null;

  /**
   * Returns the current rolling performance snapshot.
   * @returns Performance snapshot.
   */
  readonly getPerformanceSnapshot: () => ObjectPerformanceSnapshot;
  /**
   * Resets the rolling performance snapshot.
   */
  readonly resetPerformanceSnapshot: () => void;
}

///////////////////////////////////////////////////////////////////////////////////

/**
 * World-space position in renderer units.
 */
export interface ObjectWorldPosition {
  /** World X coordinate. */
  readonly x: number;
  /** World Y coordinate. */
  readonly y: number;
  /** World Z coordinate. */
  readonly z: number;
}

/**
 * WebGL object renderer interface
 */
export interface ObjectRenderer extends ObjectRendererCommon, Releaseable {
  /**
   * Attaches a WebGL context and resources needed for rendering.
   * @param gl - WebGL context to attach.
   */
  readonly attachWebGL: (gl: WebGLRenderingContext) => void;

  /**
   * Converts a viewport coordinate to a world position on the specified Z plane.
   * Returns `undefined` when the viewport ray does not intersect the plane.
   *
   * @param viewportXPixel - Horizontal viewport coordinate in CSS pixels.
   * @param viewportYPixel - Vertical viewport coordinate in CSS pixels.
   * @param viewPortSize - Viewport size in CSS pixels.
   * @param planeZ - Target world-space Z plane.
   * @param cameraState - Optional camera state override.
   * `viewportXPixel/viewportYPixel` are in CSS pixels relative to the viewport.
   * @returns World position on the plane, or `undefined` when projection fails.
   */
  readonly viewportToWorldOnPlane: (
    viewportXPixel: number,
    viewportYPixel: number,
    viewPortSize: SizeInPixel,
    planeZ: number,
    cameraState?: ObjectCameraState
  ) => ObjectWorldPosition | undefined;

  /**
   * Projects a world coordinate to the viewport.
   * Returns `undefined` when projection fails.
   *
   * @param world - World coordinate to project.
   * @param cameraState - Optional camera state override.
   * `screen` in the result is in CSS pixels relative to the viewport.
   * @returns Viewport coordinate, or `undefined` when projection fails.
   */
  readonly projectWorldToViewport: (
    world: ObjectWorldPosition,
    cameraState?: ObjectCameraState
  ) => PositionInPixel | undefined;

  /**
   * Updates the viewport size used for the camera aspect ratio.
   * @param size - Viewport size in CSS pixels.
   *
   * - `awaitable === true`: returns an allocated promise that rejects on validation failure.
   * - `awaitable !== true`: returns `undefined` and ignores validation failures.
   */
  setViewPortSize(size: SizeInPixel): void;
  /** @inheritdoc */
  setViewPortSize(size: SizeInPixel, awaitable: false): void;
  /** @inheritdoc */
  setViewPortSize(size: SizeInPixel, awaitable: true): Promise<void>;
  /** @inheritdoc */
  setViewPortSize(size: SizeInPixel, awaitable?: boolean): void | Promise<void>;

  /**
   * Render one frame.
   * Returns timestamp in milliseconds when rendering occurred.
   * Returns `undefined` when WebGL is not attached yet.
   * @returns Render timestamp in milliseconds, or `undefined` when skipped.
   */
  readonly render: () => number | undefined;

  /**
   * Picks a sprite or polyline at the viewport coordinate.
   * Returns `undefined` when nothing is hit.
   *
   * @param viewportXPixel - Horizontal viewport coordinate in CSS pixels.
   * @param viewportYPixel - Vertical viewport coordinate in CSS pixels.
   * @param timestampMs - Optional timestamp used for state-dependent picking.
   * `viewportXPixel/viewportYPixel` are in CSS pixels relative to the viewport.
   * `world` in the result is calculated on the Z=0 plane when available.
   * @returns Pick result, or `undefined` when no object is hit.
   */
  readonly pickAt: (
    viewportXPixel: number,
    viewportYPixel: number,
    timestampMs?: number
  ) => ObjectPickResult | undefined;

  /**
   * Subscribes to camera state change events.
   * @param listener - Camera state change listener.
   * @returns Release handler.
   */
  readonly onCameraStateChange: (
    listener: (event: ObjectRendererCameraStateChangeEvent) => void
  ) => () => void;
}

///////////////////////////////////////////////////////////////////////////////////

/**
 * Per-axis pan constraints for canvas camera controls.
 */
export interface ObjectCanvasCameraControlPanAxisOptions {
  /**
   * Invert pan direction on this axis (defaults to false).
   */
  readonly invert?: boolean;
  /**
   * Minimum allowed value for this axis.
   */
  readonly minValue?: number;
  /**
   * Maximum allowed value for this axis.
   */
  readonly maxValue?: number;
}

/**
 * Camera control rate mode.
 */
export type ObjectCanvasCameraControlRateMode = 'speed' | 'distance';

/**
 * Camera rotation mode.
 */
export type ObjectCanvasCameraControlRotationMode = 'free' | 'focusPlane';

/**
 * Pan interaction options for canvas camera controls.
 */
export interface ObjectCanvasCameraControlPanOptions {
  /**
   * Trigger for pan interaction (defaults to right button without ALT).
   */
  readonly trigger?: ObjectCanvasCameraControlPointerTrigger;
  /**
   * Pan rate mode (default to 'speed').
   */
  readonly mode?: ObjectCanvasCameraControlRateMode;
  /**
   * Pan rate per pixel (default to 5.0).
   *
   * - mode === 'speed': treated as velocity gain (per second).
   * - mode === 'distance': treated as distance gain.
   */
  readonly ratePerPixel?: number;
  /**
   * X axis pan options.
   */
  readonly x?: ObjectCanvasCameraControlPanAxisOptions;
  /**
   * Y axis pan options.
   */
  readonly y?: ObjectCanvasCameraControlPanAxisOptions;
}

/**
 * Rotation options for a single camera axis.
 */
export interface ObjectCanvasCameraControlRotationOptions {
  /**
   * Rotation rate mode (default to 'distance').
   */
  readonly mode?: ObjectCanvasCameraControlRateMode;
  /**
   * Rotation rate per pixel in degrees (default to 0.1).
   *
   * - mode === 'speed': treated as angular velocity gain (degrees/sec).
   * - mode === 'distance': treated as angular distance (degrees).
   */
  readonly ratePerPixel?: number;
  /**
   * Invert rotation direction.
   */
  readonly invert?: boolean;
  /**
   * Enables rotation on drag.
   */
  readonly enable?: boolean;
  /**
   * Minimum allowed rotation value in degrees.
   */
  readonly minDeg?: number;
  /**
   * Maximum allowed rotation value in degrees.
   */
  readonly maxDeg?: number;
}

/**
 * Rotation interaction options grouped by yaw and pitch.
 */
export interface ObjectCanvasCameraControlRotationAxesOptions {
  /**
   * Trigger for rotation interaction (defaults to right button with ALT).
   */
  readonly trigger?: ObjectCanvasCameraControlPointerTrigger;
  /**
   * Rotation mode (default to 'free').
   */
  readonly mode?: ObjectCanvasCameraControlRotationMode;
  /**
   * Yaw rotation options (defaults: invert false, enable false).
   */
  readonly yaw?: ObjectCanvasCameraControlRotationOptions;
  /**
   * Pitch rotation options (defaults: invert true, enable true).
   */
  readonly pitch?: ObjectCanvasCameraControlRotationOptions;
}

/**
 * Wheel zoom options for canvas camera controls.
 */
export interface ObjectCanvasCameraControlWheelOptions {
  /**
   * Plane Z used to compute the zoom ray (defaults to 0).
   */
  readonly planeZ?: number;
  /**
   * Minimum distance from the plane (defaults to near * 1.1).
   */
  readonly minDistance?: number;
  /**
   * Maximum distance from the plane (defaults to far * 0.9).
   */
  readonly maxDistance?: number;
  /**
   * Wheel session timeout in milliseconds (defaults to 200ms).
   */
  readonly sessionTimeoutMs?: number;
}

/**
 * Keyboard modifier matching rules for pointer triggers.
 */
export interface ObjectCanvasCameraControlModifiers {
  /**
   * true => must be pressed, false => must NOT be pressed, undefined => ignore.
   */
  readonly alt?: boolean;
  /**
   * true => must be pressed, false => must NOT be pressed, undefined => ignore.
   */
  readonly ctrl?: boolean;
  /**
   * true => must be pressed, false => must NOT be pressed, undefined => ignore.
   */
  readonly shift?: boolean;
  /**
   * true => must be pressed, false => must NOT be pressed, undefined => ignore.
   */
  readonly meta?: boolean;
}

/**
 * Pointer button symbol names.
 */
export type ObjectCanvasCameraControlPointerButton =
  | 'left'
  | 'middle'
  | 'right'
  | 'back'
  | 'forward';

/**
 * Pointer trigger used to start a camera interaction.
 */
export interface ObjectCanvasCameraControlPointerTrigger {
  /**
   * Pointer button symbol. If omitted, any button matches.
   */
  readonly button?: ObjectCanvasCameraControlPointerButton;
  /**
   * Modifier conditions for the trigger.
   */
  readonly modifiers?: ObjectCanvasCameraControlModifiers;
}

/**
 * Full configuration object for canvas camera controls.
 */
export interface ObjectCanvasCameraControlsOptions {
  /**
   * Mouse movement polling interval (default to 200ms).
   */
  readonly pollingIntervalMs?: number;
  /**
   * Mouse movement interpolation parameter (default to linear easing interpolation).
   */
  readonly interactionInterpolation?: ObjectInterpolationParameter | null;
  /**
   * Pan control options.
   */
  readonly pan?: ObjectCanvasCameraControlPanOptions;
  /**
   * Rotation control options.
   */
  readonly rotation?: ObjectCanvasCameraControlRotationAxesOptions;
  /**
   * Wheel control options.
   */
  readonly wheel?: ObjectCanvasCameraControlWheelOptions;
}

/**
 * Lifecycle phase of a canvas camera interaction.
 */
export type ObjectCanvasCameraInteractionPhase = 'start' | 'update' | 'end';

/**
 * Interaction mode emitted by canvas camera controls.
 */
export type ObjectCanvasCameraInteractionMode = 'pan' | 'rotate' | 'wheel';

/**
 * Event emitted while camera interactions are processed on a canvas renderer.
 */
export interface ObjectCanvasCameraInteractionEvent {
  /**
   * Interaction phase.
   */
  readonly phase: ObjectCanvasCameraInteractionPhase;
  /**
   * Interaction mode.
   */
  readonly mode: ObjectCanvasCameraInteractionMode;
  /**
   * Camera state snapshot at the time of the event.
   */
  readonly cameraState: ObjectCameraState;
  /**
   * Camera update payload associated with the event.
   */
  readonly cameraUpdate?: CameraUpdate;
  /**
   * Timestamp in milliseconds.
   */
  readonly timestampMs: number;
}

/**
 * Source that triggered a canvas camera change event.
 */
export type ObjectCanvasCameraChangeSource =
  | 'external'
  | 'interaction'
  | 'tracking';

/**
 * Event emitted when the canvas renderer camera state changes.
 */
export interface ObjectCanvasCameraChangeEvent {
  /**
   * Camera change source.
   */
  readonly source: ObjectCanvasCameraChangeSource;
  /**
   * Camera state snapshot at the time of the event.
   */
  readonly cameraState: ObjectCameraState;
  /**
   * Camera update payload associated with the change.
   */
  readonly cameraUpdate: CameraUpdate;
  /**
   * Timestamp in milliseconds.
   */
  readonly timestampMs: number;
}

///////////////////////////////////////////////////////////////////////////////////

/**
 * Kinds of pick results produced by the renderer.
 */
export type ObjectPickKind = 'sprite' | 'polyline';

/**
 * Picked world-space position.
 */
export interface ObjectPickWorldPosition extends ObjectWorldPosition {}

/**
 * Common fields shared by all pick results.
 */
export interface ObjectPickBase {
  /** Screen-space hit position. */
  readonly screen: PositionInPixel;
  /**
   * World position on the Z=0 plane (when available).
   */
  readonly world?: ObjectPickWorldPosition;
  /**
   * Timestamp in milliseconds.
   */
  readonly timestampMs: number;
}

/**
 * Pick result for a sprite element.
 */
export interface ObjectPickSpriteResult extends ObjectPickBase {
  /** Discriminant for sprite hits. */
  readonly kind: 'sprite';
  /** Hit sprite id. */
  readonly spriteId: number;
  /** Hit element index within the sprite. */
  readonly elementIndex: number;
}

/**
 * Pick result for a polyline segment.
 */
export interface ObjectPickPolylineResult extends ObjectPickBase {
  /** Discriminant for polyline hits. */
  readonly kind: 'polyline';
  /** Hit polyline id. */
  readonly polylineId: number;
  /** Hit segment index within the polyline. */
  readonly segmentIndex: number;
}

/**
 * Union of all pick results produced by the renderer.
 */
export type ObjectPickResult =
  | ObjectPickSpriteResult
  | ObjectPickPolylineResult;

/**
 * Camera state change event from ObjectRenderer.
 */
export interface ObjectRendererCameraStateChangeEvent {
  /**
   * Camera state snapshot at the time of the event.
   */
  readonly cameraState: ObjectCameraState;
  /**
   * Camera change source when the renderer can identify it.
   */
  readonly source?: 'tracking';
  /**
   * Camera update payload associated with the change when available.
   */
  readonly cameraUpdate?: CameraUpdate;
  /**
   * Timestamp in milliseconds.
   */
  readonly timestampMs: number;
}

///////////////////////////////////////////////////////////////////////////////////

/**
 * HTMLCanvasElement renderer interface
 */
export interface ObjectCanvasRenderer
  extends ObjectRendererCommon, Releaseable {
  /**
   * Target canvas element.
   */
  readonly canvas: HTMLCanvasElement;
  /**
   * Projects a world coordinate to the canvas (CSS pixels relative to canvas).
   * Returns `undefined` when projection fails.
   * @param world - World coordinate to project.
   * @param cameraState - Optional camera state override.
   * @returns Canvas coordinate, or `undefined` when projection fails.
   */
  readonly worldToCanvas: (
    world: ObjectWorldPosition,
    cameraState?: ObjectCameraState
  ) => PositionInPixel | undefined;
  /**
   * Projects a world coordinate to the page (CSS pixels relative to viewport).
   * Returns `undefined` when projection fails.
   * @param world - World coordinate to project.
   * @param cameraState - Optional camera state override.
   * @returns Page coordinate, or `undefined` when projection fails.
   */
  readonly worldToPage: (
    world: ObjectWorldPosition,
    cameraState?: ObjectCameraState
  ) => PositionInPixel | undefined;
  /**
   * Start render process.
   * @returns Stop handler.
   */
  readonly start: () => () => void;
  /**
   * Subscribes to camera interaction events.
   * @param listener - Interaction event handler
   * @returns Release handler.
   */
  readonly onCameraInteraction: (
    listener: (event: ObjectCanvasCameraInteractionEvent) => void
  ) => () => void;
  /**
   * Subscribes to camera change events.
   * @param listener - Change event handler
   * @returns Release handler.
   */
  readonly onCameraChange: (
    listener: (event: ObjectCanvasCameraChangeEvent) => void
  ) => () => void;
  /**
   * Subscribes to pick events.
   * @param listener - Pick event handler
   * @returns Release handler.
   */
  readonly onPick: (
    listener: (event: ObjectCanvasPickEvent) => void
  ) => () => void;
  /**
   * Picks a sprite or polyline at the canvas coordinate.
   * Returns `undefined` when nothing is hit.
   *
   * @param canvasXPixel - Horizontal canvas coordinate in CSS pixels.
   * @param canvasYPixel - Vertical canvas coordinate in CSS pixels.
   * @param timestampMs - Optional timestamp used for state-dependent picking.
   * `canvasXPixel/canvasYPixel` are in CSS pixels relative to the canvas.
   * @returns Pick result, or `undefined` when no object is hit.
   */
  readonly pickAt: (
    canvasXPixel: number,
    canvasYPixel: number,
    timestampMs?: number
  ) => ObjectPickResult | undefined;
  /**
   * Attach camera interaction control.
   * @param options - Interaction options
   * @returns Release handler.
   */
  readonly attachCameraControls: (
    options?: ObjectCanvasCameraControlsOptions
  ) => () => void;
}

/**
 * Pick event payload emitted by {@link ObjectCanvasRenderer.onPick}.
 */
export type ObjectCanvasPickEvent = (
  | ObjectPickSpriteResult
  | ObjectPickPolylineResult
) & {
  /**
   * Target canvas element.
   */
  readonly canvas: HTMLCanvasElement;
  /**
   * Timestamp in milliseconds.
   */
  readonly timestampMs: number;
};
