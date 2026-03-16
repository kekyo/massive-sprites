// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  ObjectInterpolationEasing,
  ObjectInterpolationMode,
  PolylinePlacement,
  Releaseable,
  SpriteBulkUpdate,
  SpritePlacement,
} from '../types';

///////////////////////////////////////////////////////////////////////////////////

/**
 * A point in graph space expressed as longitude-like and latitude-like values.
 */
export interface Node {
  /** Vertical coordinate in graph space. */
  readonly lat: number;
  /** Horizontal coordinate in graph space. */
  readonly lng: number;
}

/**
 * A named graph node that can be used as a routing endpoint.
 */
export interface WayPoint extends Node {
  /** Stable identifier of the waypoint within the graph. */
  readonly id: string;
}

/**
 * A polyline edge that connects two distinct waypoints.
 *
 * @remarks
 * When validated by `createGraphGeometry`, the first and last nodes must match
 * the referenced waypoints exactly, and the endpoints must be distinct.
 */
export interface Way {
  /** Stable identifier of the way within the graph. */
  readonly id: string;
  /** Identifier of the waypoint at the start of the way. */
  readonly fromWayPointId: string;
  /** Identifier of the waypoint at the end of the way. */
  readonly toWayPointId: string;
  /** Polyline nodes of the way, including both endpoint waypoints. */
  readonly nodeList: readonly Node[];
}

/**
 * A waypoint graph composed of named waypoints and connecting ways.
 */
export interface Graph {
  /** All waypoints that may be used as routing endpoints. */
  readonly wayPointList: readonly WayPoint[];
  /** All ways that connect the graph's waypoints. */
  readonly wayList: readonly Way[];
}

/**
 * A position expressed as a ratio on a uniquely resolvable path between two
 * waypoints.
 *
 * @remarks
 * Resolution requires exactly one simple path between the two waypoints.
 * Ratios are clamped to the `[0, 1]` range when resolved.
 */
export interface GraphPathPosition {
  /** Waypoint id at the start of the resolved path. */
  readonly fromWayPointId: string;
  /** Waypoint id at the end of the resolved path. */
  readonly toWayPointId: string;
  /** Relative position on the resolved path. */
  readonly ratio: number;
}

/**
 * A position expressed as a ratio on a specific way.
 *
 * @remarks
 * Ratios are clamped to the `[0, 1]` range when resolved.
 */
export interface GraphWayPosition {
  /** Exact way to use for resolution. */
  readonly wayId: string;
  /** Relative position on the referenced way. */
  readonly ratio: number;
}

/**
 * A position snapped exactly onto a specific waypoint.
 */
export interface GraphWayPointPosition {
  /** Exact waypoint to use for resolution. */
  readonly wayPointId: string;
}

/**
 * Public position formats accepted by logical-graph helpers and entity movement
 * APIs.
 */
export type GraphPosition =
  | GraphPathPosition
  | GraphWayPosition
  | GraphWayPointPosition;

/**
 * A way seen from the perspective of a specific incident waypoint.
 */
export interface GraphIncidentWay {
  /** Identifier of the incident way. */
  readonly wayId: string;
  /** Waypoint id treated as the local origin of this incident edge. */
  readonly fromWayPointId: string;
  /** Waypoint id reachable from `fromWayPointId` via the incident way. */
  readonly toWayPointId: string;
}

/**
 * Geometry metadata precomputed for a way.
 */
export interface GraphWayGeometry {
  /** Identifier of the way this geometry belongs to. */
  readonly wayId: string;
  /** Waypoint id at the start of the way. */
  readonly fromWayPointId: string;
  /** Waypoint id at the end of the way. */
  readonly toWayPointId: string;
  /** Full node list of the way, including endpoints. */
  readonly nodeList: readonly Node[];
  /** Length of each segment between consecutive nodes. */
  readonly segmentLengths: readonly number[];
  /** Prefix sums of `segmentLengths`, starting at `0`. */
  readonly cumulativeLengths: readonly number[];
  /** Total polyline length of the way. */
  readonly totalLength: number;
}

/**
 * Lookup-oriented geometry caches derived from a graph.
 */
export interface GraphGeometry {
  /** Original graph used to build the geometry. */
  readonly graph: Graph;
  /** Waypoints indexed by id. */
  readonly wayPointById: ReadonlyMap<string, WayPoint>;
  /** Precomputed way geometries indexed by way id. */
  readonly wayGeometryById: ReadonlyMap<string, GraphWayGeometry>;
  /** Incident ways indexed by waypoint id. */
  readonly adjacencyByWayPointId: ReadonlyMap<
    string,
    readonly GraphIncidentWay[]
  >;
}

/**
 * One directed traversal segment in a resolved graph path.
 */
export interface GraphPathTraversal {
  /** Way traversed by this segment. */
  readonly wayId: string;
  /** Waypoint id at the start of this traversal segment. */
  readonly fromWayPointId: string;
  /** Waypoint id at the end of this traversal segment. */
  readonly toWayPointId: string;
  /** Length of this traversal segment. */
  readonly length: number;
  /** Distance from the start of the path to the start of this segment. */
  readonly startDistance: number;
  /** Distance from the start of the path to the end of this segment. */
  readonly endDistance: number;
}

/**
 * A unique directed path between two waypoints.
 */
export interface GraphPath {
  /** Waypoint id at the start of the path. */
  readonly fromWayPointId: string;
  /** Waypoint id at the end of the path. */
  readonly toWayPointId: string;
  /** Ordered traversal segments that compose the path. */
  readonly traversalList: readonly GraphPathTraversal[];
  /** Total path length. */
  readonly totalLength: number;
}

/**
 * Sort order for `listGraphPaths(...)`.
 */
export type GraphPathSearchSort = 'graph-order' | 'total-length-asc';

/**
 * Options for enumerating graph paths between two waypoints.
 */
export interface GraphPathSearchOptions {
  /**
   * Maximum number of paths to return.
   *
   * @remarks
   * Must be a positive integer when specified.
   */
  readonly limit?: number;
  /**
   * Sort order applied to the returned paths.
   *
   * @remarks
   * `graph-order` preserves DFS enumeration order based on the graph's way
   * order, while `total-length-asc` sorts by total path length.
   */
  readonly sort?: GraphPathSearchSort;
}

/**
 * Result of enumerating graph paths between two waypoints.
 */
export interface GraphPathSearchResult {
  /** Enumerated paths that matched the query. */
  readonly paths: readonly GraphPath[];
  /**
   * Whether additional paths existed beyond the configured `limit`.
   *
   * @remarks
   * This is always `false` when no `limit` is specified.
   */
  readonly truncated: boolean;
}

/**
 * A resolved position that lands exactly on a waypoint.
 */
export interface ResolvedGraphWayPointPosition {
  /** Discriminant for waypoint positions. */
  readonly kind: 'wayPoint';
  /** Concrete coordinate of the resolved waypoint. */
  readonly point: Node;
  /** Waypoint id of the resolved position. */
  readonly wayPointId: string;
}

/**
 * A resolved position that lands somewhere along a specific way.
 */
export interface ResolvedGraphWayPosition {
  /** Discriminant for way positions. */
  readonly kind: 'way';
  /** Concrete coordinate of the resolved position. */
  readonly point: Node;
  /** Way id containing the resolved position. */
  readonly wayId: string;
  /** Waypoint id at the start of the containing way. */
  readonly fromWayPointId: string;
  /** Waypoint id at the end of the containing way. */
  readonly toWayPointId: string;
  /** Distance from the start of the containing way. */
  readonly distanceOnWay: number;
  /** Total length of the containing way. */
  readonly totalWayLength: number;
}

/**
 * Concrete graph positions returned after resolving a public `GraphPosition`.
 */
export type ResolvedGraphPosition =
  | ResolvedGraphWayPointPosition
  | ResolvedGraphWayPosition;

/**
 * One directed segment in a motion path.
 */
export interface GraphMotionPathSegment {
  /** Way traversed by this motion segment. */
  readonly wayId: string;
  /** Distance from the start of the motion path to the start of this segment. */
  readonly startDistance: number;
  /** Distance from the start of the motion path to the end of this segment. */
  readonly endDistance: number;
  /** Distance on the way where this segment starts. */
  readonly startDistanceOnWay: number;
  /** Distance on the way where this segment ends. */
  readonly endDistanceOnWay: number;
  /** Length of this motion segment. */
  readonly length: number;
}

/**
 * A unique motion route between two resolved positions.
 */
export interface GraphMotionPath {
  /** Starting resolved position. */
  readonly from: ResolvedGraphPosition;
  /** Ending resolved position. */
  readonly to: ResolvedGraphPosition;
  /** Ordered motion segments that compose the route. */
  readonly segmentList: readonly GraphMotionPathSegment[];
  /** Total motion length. */
  readonly totalLength: number;
}

/**
 * Associates a way id with a generated polyline placement.
 *
 * @typeParam TPolylinePlacement - Concrete placement type produced by the caller.
 */
export interface GraphPolylinePlacementEntry<
  TPolylinePlacement extends PolylinePlacement = PolylinePlacement,
> {
  /** Way id associated with the placement. */
  readonly wayId: string;
  /** Placement generated for the way. */
  readonly placement: TPolylinePlacement;
}

/**
 * Associates a waypoint id with a generated sprite placement.
 *
 * @typeParam TSpritePlacement - Concrete placement type produced by the caller.
 */
export interface GraphWayPointSpritePlacementEntry<
  TSpritePlacement extends SpritePlacement = SpritePlacement,
> {
  /** Waypoint id associated with the placement. */
  readonly wayPointId: string;
  /** Placement generated for the waypoint. */
  readonly placement: TSpritePlacement;
}

/**
 * Minimal sprite renderer surface required by the logical graph entity manager.
 */
export interface LogicalGraphSpriteRenderer {
  /**
   * Adds sprite placements to the renderer.
   *
   * @param placements - Sprite placements to add.
   * @param awaitable - When `true`, the renderer should resolve sprite ids asynchronously.
   * @returns Added sprite ids when `awaitable` is `true`; otherwise no return value.
   * @remarks
   * When `awaitable` is `true`, the method must resolve to sprite ids in the
   * same order as the given placements.
   */
  readonly addSprites: (
    placements: readonly SpritePlacement[],
    awaitable?: boolean
  ) => void | Promise<number[]>;
  /**
   * Applies bulk sprite updates to the renderer.
   *
   * @param updates - Sprite updates to apply.
   * @param awaitable - When `true`, the renderer may complete asynchronously.
   * @returns A promise when `awaitable` is `true`; otherwise no return value.
   * @remarks
   * When `awaitable` is `true`, the method may defer completion until all
   * updates have been queued or applied.
   */
  readonly updateSprites: (
    updates: readonly SpriteBulkUpdate[],
    awaitable?: boolean
  ) => void | Promise<void>;
  /**
   * Removes sprites from the renderer.
   *
   * @param spriteIds - Sprite ids to remove.
   * @param awaitable - When `true`, the renderer may complete asynchronously.
   * @returns A promise when `awaitable` is `true`; otherwise no return value.
   * @remarks
   * Unknown sprite ids are expected to be handled by the renderer contract.
   */
  readonly removeSprites: (
    spriteIds: readonly number[],
    awaitable?: boolean
  ) => void | Promise<void>;
}

/**
 * Timer handle type used by the logical graph scheduler abstraction.
 */
export type LogicalGraphTimerId = ReturnType<typeof setTimeout>;

/**
 * Scheduler abstraction used to drive entity interpolation.
 */
export interface LogicalGraphEntityScheduler {
  /** Returns the scheduler's current timestamp in milliseconds. */
  readonly now: () => number;
  /**
   * Schedules a handler to run after the given delay.
   *
   * @param handler - Callback to invoke when the timer fires.
   * @param timeoutMs - Delay before the callback runs.
   * @returns Timer handle that can later be passed to `clearTimeout`.
   */
  readonly setTimeout: (
    handler: () => void,
    timeoutMs: number
  ) => LogicalGraphTimerId;
  /**
   * Cancels a timer previously returned by `setTimeout`.
   *
   * @param handle - Timer handle to cancel.
   */
  readonly clearTimeout: (handle: LogicalGraphTimerId) => void;
}

/**
 * Registration input for a logical graph entity.
 *
 * @typeParam TEntityData - User data stored alongside the entity.
 * @remarks
 * When `timestampMs` is omitted, the entity manager uses the scheduler's
 * current time.
 */
export interface LogicalGraphEntityRegistration<TEntityData = unknown> {
  /** Stable identifier of the entity. */
  readonly entityId: string;
  /** Caller-defined data attached to the entity. */
  readonly data: TEntityData;
  /** Initial graph position of the entity. */
  readonly position: GraphPosition;
  /** Timestamp associated with the initial position. */
  readonly timestampMs?: number;
}

/**
 * Movement request for an already registered entity.
 *
 * @remarks
 * When `timestampMs` is omitted, the move is applied at the scheduler's
 * current time. Past timestamps collapse the move to an immediate update.
 */
export interface LogicalGraphEntityMove {
  /** Identifier of the entity to move. */
  readonly entityId: string;
  /** Target graph position of the move. */
  readonly position: GraphPosition;
  /** Timestamp at which the entity should reach `position`. */
  readonly timestampMs?: number;
}

/**
 * Movement request expressed as an explicit sequence of graph paths.
 *
 * @remarks
 * The first path must start at the entity's current exact waypoint. Path and
 * traversal metadata are validated before any state change is applied.
 */
export interface LogicalGraphEntityPathMove {
  /** Identifier of the entity to move. */
  readonly entityId: string;
  /** Explicit path sequence that the entity must follow. */
  readonly pathList: readonly GraphPath[];
  /** Timestamp at which the entity should reach the end of the path list. */
  readonly timestampMs?: number;
}

/**
 * Read-only snapshot of a registered entity.
 *
 * @typeParam TEntityData - User data stored alongside the entity.
 */
export interface LogicalGraphEntityState<TEntityData = unknown> {
  /** Stable identifier of the entity. */
  readonly entityId: string;
  /** Caller-defined data attached to the entity. */
  readonly data: TEntityData;
  /** Renderer sprite id assigned to the entity. */
  readonly spriteId: number;
  /** Current resolved position of the entity. */
  readonly currentPosition: ResolvedGraphPosition;
  /** Target resolved position if the entity is currently moving. */
  readonly motionTargetPosition: ResolvedGraphPosition | undefined;
  /** Timestamp at which `currentPosition` was last updated. */
  readonly updatedAtMs: number;
  /** Timestamp at which the current motion will end, if any. */
  readonly motionEndMs: number | undefined;
}

/**
 * Configuration for creating a logical graph entity manager.
 *
 * @typeParam TEntityData - User data stored alongside each entity.
 */
export interface LogicalGraphEntityManagerOptions<TEntityData = unknown> {
  /** Graph geometry used for position and motion resolution. */
  readonly geometry: GraphGeometry;
  /** Renderer used to create and update sprites. */
  readonly renderer: LogicalGraphSpriteRenderer;
  /** Maximum interval between interpolation ticks, in milliseconds. */
  readonly tickIntervalMs: number;
  /** Interpolation settings applied to sprite position updates. */
  readonly interpolation: {
    /** Interpolation mode used by the renderer. */
    readonly mode: ObjectInterpolationMode;
    /** Easing used by the renderer for interpolated updates. */
    readonly easing: ObjectInterpolationEasing;
  };
  /**
   * Builds the initial sprite placement for a newly registered entity.
   *
   * @param entity - Registration input for the entity.
   * @param position - Resolved initial position of the entity.
   * @returns Sprite placement to pass to the renderer.
   */
  readonly createSpritePlacement: (
    entity: LogicalGraphEntityRegistration<TEntityData>,
    position: ResolvedGraphPosition
  ) => SpritePlacement;
  /** Optional scheduler override used instead of the default timer-based scheduler. */
  readonly scheduler?: LogicalGraphEntityScheduler;
}

/**
 * Controller for registering, moving, and removing entities on a graph.
 *
 * @typeParam TEntityData - User data stored alongside each entity.
 */
export interface LogicalGraphEntityManager<
  TEntityData = unknown,
> extends Releaseable {
  /**
   * Registers a single entity and resolves to its sprite id.
   *
   * @param entity - Entity registration input.
   * @returns Sprite id assigned by the renderer.
   */
  readonly registerEntity: (
    entity: LogicalGraphEntityRegistration<TEntityData>
  ) => Promise<number>;
  /**
   * Registers multiple entities and resolves to sprite ids in input order.
   *
   * @param entities - Entity registration inputs.
   * @returns Sprite ids in the same order as `entities`.
   */
  readonly registerEntities: (
    entities: readonly LogicalGraphEntityRegistration<TEntityData>[]
  ) => Promise<readonly number[]>;
  /**
   * Updates a single entity toward a new graph position.
   *
   * @param move - Movement request to apply.
   * @remarks
   * Ambiguous or impossible motion paths are reported as errors.
   */
  readonly updateEntity: (move: LogicalGraphEntityMove) => void;
  /**
   * Updates multiple entities in one batch.
   *
   * @param moves - Movement requests to apply.
   * @remarks
   * Duplicate entity ids in the same batch are rejected.
   */
  readonly updateEntities: (moves: readonly LogicalGraphEntityMove[]) => void;
  /**
   * Unregisters a single entity and removes its sprite.
   *
   * @param entityId - Identifier of the entity to remove.
   */
  readonly unregisterEntity: (entityId: string) => void;
  /**
   * Unregisters multiple entities and removes their sprites.
   *
   * @param entityIds - Identifiers of the entities to remove.
   * @remarks
   * Duplicate ids in the same batch are rejected.
   */
  readonly unregisterEntities: (entityIds: readonly string[]) => void;
  /**
   * Returns the current state snapshot of a registered entity.
   *
   * @param entityId - Identifier of the entity to inspect.
   * @returns Current state snapshot.
   */
  readonly getEntityState: (
    entityId: string
  ) => LogicalGraphEntityState<TEntityData>;
  /**
   * Updates a single entity by following an explicit path list.
   *
   * @param move - Path-list movement request to apply.
   * @remarks
   * The request is rejected if the path list is structurally invalid or if the
   * entity is not currently located on the first path's starting waypoint.
   */
  readonly updateEntityByPathList: (move: LogicalGraphEntityPathMove) => void;
  /**
   * Updates multiple entities by following explicit path lists.
   *
   * @param moves - Path-list movement requests to apply.
   * @remarks
   * Duplicate entity ids in the same batch are rejected.
   */
  readonly updateEntitiesByPathList: (
    moves: readonly LogicalGraphEntityPathMove[]
  ) => void;
}
