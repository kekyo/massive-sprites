// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  GraphGeometry,
  LogicalGraphEntityManager,
  LogicalGraphEntityState,
} from 'massive-sprites/logical-graph';

import {
  pickRouteTraversalOption,
  resolveRouteTraversalPath,
} from './route-motion';

///////////////////////////////////////////////////////////////////////////////////

/**
 * Timer abstraction used by route traversal controllers.
 */
export interface RouteTraversalControllerTimer {
  /**
   * Returns the current timestamp in milliseconds.
   *
   * @returns Current time used for scheduling.
   */
  readonly now: () => number;
  /**
   * Schedules a callback after the requested delay.
   *
   * @param handler - Callback to execute.
   * @param timeoutMs - Delay in milliseconds.
   * @returns Timer identifier that can be passed to `clearTimeout`.
   */
  readonly setTimeout: (handler: () => void, timeoutMs: number) => number;
  /**
   * Cancels a previously scheduled callback.
   *
   * @param timeoutId - Timer identifier returned by `setTimeout`.
   */
  readonly clearTimeout: (timeoutId: number) => void;
}

/**
 * Options for creating a route traversal controller.
 */
export interface RouteTraversalControllerOptions {
  /** Graph geometry that defines route adjacency and path lengths. */
  readonly geometry: GraphGeometry;
  /** Entity manager used to inspect and move the controlled entity. */
  readonly entityManager: Pick<
    LogicalGraphEntityManager<unknown>,
    'getEntityState' | 'updateEntityByPathList'
  >;
  /** Identifier of the controlled entity. */
  readonly entityId: string;
  /** Current speed used to resolve per-way travel durations. */
  readonly speed: number;
  /** Previously traversed way, if any. */
  readonly incomingWayId: string | undefined;
  /** Visible route waypoints that should pause before the next departure. */
  readonly routeWayPointIdSet: ReadonlySet<string>;
  /** Returns the pause duration to apply at visible route waypoints. */
  readonly pickPauseDurationMs: () => number;
  /**
   * Resolves the duration required to traverse a way at `speed`.
   *
   * @param wayId - Traversed way identifier.
   * @param speed - Current entity speed.
   * @returns Travel duration in milliseconds.
   */
  readonly resolveTravelDurationMs: (wayId: string, speed: number) => number;
  /** Random source used to pick the next traversal candidate. */
  readonly random: () => number;
  /** Delay used when the entity state has not yet settled to an exact waypoint. */
  readonly retryDelayMs: number;
  /** Timer implementation used to schedule departures. */
  readonly timer: RouteTraversalControllerTimer;
}

/**
 * Controller that keeps a route-traversing entity moving until stopped.
 */
export interface RouteTraversalController {
  /**
   * Stops future departures and clears pending timers.
   */
  readonly stop: () => void;
}

type DepartureReadiness =
  | {
      readonly kind: 'ready';
      readonly wayPointId: string;
    }
  | {
      readonly kind: 'waiting';
      readonly delayMs: number;
    };

const resolveReadyWayPointId = (
  state: LogicalGraphEntityState<unknown>,
  now: number,
  retryDelayMs: number
): DepartureReadiness => {
  // Entity state snapshots can lag one timer turn behind the motion end tick,
  // so use motion metadata to determine when a path-list move is safe.
  if (state.motionEndMs !== undefined && now < state.motionEndMs) {
    return {
      kind: 'waiting',
      delayMs: Math.max(0, state.motionEndMs - now),
    };
  }
  if (
    state.motionEndMs !== undefined &&
    state.motionTargetPosition?.kind === 'wayPoint'
  ) {
    return {
      kind: 'ready',
      wayPointId: state.motionTargetPosition.wayPointId,
    };
  }
  if (state.currentPosition.kind === 'wayPoint') {
    return {
      kind: 'ready',
      wayPointId: state.currentPosition.wayPointId,
    };
  }
  return {
    kind: 'waiting',
    delayMs: retryDelayMs,
  };
};

/**
 * Creates a controller that repeatedly dispatches explicit route traversals for
 * one entity while waiting for exact waypoint readiness between moves.
 *
 * @param options - Route traversal controller configuration.
 * @returns Controller that can stop the scheduled traversal loop.
 */
export const createRouteTraversalController = (
  options: RouteTraversalControllerOptions
): RouteTraversalController => {
  if (!Number.isFinite(options.retryDelayMs) || options.retryDelayMs < 0) {
    throw new Error('retryDelayMs must be a finite non-negative number.');
  }

  let incomingWayId = options.incomingWayId;
  let timeoutId: number | undefined = undefined;
  let stopped = false;

  const clearTimer = () => {
    if (timeoutId !== undefined) {
      options.timer.clearTimeout(timeoutId);
      timeoutId = undefined;
    }
  };

  const scheduleAttempt = (delayMs: number) => {
    if (stopped) {
      return;
    }
    clearTimer();
    timeoutId = options.timer.setTimeout(
      () => {
        clearTimer();
        if (stopped) {
          return;
        }

        const now = options.timer.now();
        const state = options.entityManager.getEntityState(options.entityId);
        const readiness = resolveReadyWayPointId(
          state,
          now,
          options.retryDelayMs
        );
        if (readiness.kind === 'waiting') {
          scheduleAttempt(readiness.delayMs);
          return;
        }

        const traversal = pickRouteTraversalOption(
          options.geometry,
          readiness.wayPointId,
          incomingWayId,
          options.random()
        );
        const traversalPath = resolveRouteTraversalPath(
          options.geometry,
          traversal
        );
        const travelMs = options.resolveTravelDurationMs(
          traversal.wayId,
          options.speed
        );
        options.entityManager.updateEntityByPathList({
          entityId: options.entityId,
          pathList: [traversalPath],
          timestampMs: now + travelMs,
        });
        incomingWayId = traversal.wayId;

        scheduleAttempt(
          travelMs +
            (options.routeWayPointIdSet.has(traversal.toWayPointId)
              ? options.pickPauseDurationMs()
              : 0)
        );
      },
      Math.max(0, delayMs)
    );
  };

  scheduleAttempt(options.pickPauseDurationMs());

  return {
    stop: () => {
      stopped = true;
      clearTimer();
    },
  };
};
