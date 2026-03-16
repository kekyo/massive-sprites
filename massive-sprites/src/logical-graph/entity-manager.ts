// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type { ObjectInterpolationParameter, SpriteBulkUpdate } from '../types';
import type {
  GraphGeometry,
  GraphMotionPath,
  GraphMotionPathSegment,
  GraphPath,
  LogicalGraphEntityManager,
  LogicalGraphEntityManagerOptions,
  LogicalGraphEntityMove,
  LogicalGraphEntityPathMove,
  LogicalGraphEntityRegistration,
  LogicalGraphEntityScheduler,
  LogicalGraphEntityState,
  LogicalGraphTimerId,
  ResolvedGraphPosition,
} from './types';
import {
  resolveGraphMotionPathAddress,
  resolveGraphMotionPathBetweenResolvedPositions,
  resolveGraphPositionAddress,
} from './geometry';

///////////////////////////////////////////////////////////////////////////////////

const DISTANCE_EPSILON = 1e-9;

interface LogicalGraphEntityMotionState {
  readonly path: GraphMotionPath;
  readonly startMs: number;
  readonly endMs: number;
  nextTickMs: number;
}

interface LogicalGraphEntityRecord<TEntityData> {
  readonly entityId: string;
  readonly data: TEntityData;
  readonly spriteId: number;
  currentPosition: ResolvedGraphPosition;
  motionTargetPosition: ResolvedGraphPosition | undefined;
  updatedAtMs: number;
  motionEndMs: number | undefined;
  motion: LogicalGraphEntityMotionState | undefined;
}

interface PendingLogicalGraphEntityUpdate<TEntityData> {
  readonly record: LogicalGraphEntityRecord<TEntityData>;
  readonly nextCurrentPosition: ResolvedGraphPosition;
  readonly nextMotionTargetPosition: ResolvedGraphPosition | undefined;
  readonly nextUpdatedAtMs: number;
  readonly nextMotionEndMs: number | undefined;
  readonly nextMotion: LogicalGraphEntityMotionState | undefined;
  readonly spriteUpdate: SpriteBulkUpdate | undefined;
}

const createDefaultScheduler = (): LogicalGraphEntityScheduler => ({
  now: () => Date.now(),
  setTimeout: (handler, timeoutMs) => setTimeout(handler, timeoutMs),
  clearTimeout: (handle) => clearTimeout(handle),
});

const createInterpolation = (
  base: LogicalGraphEntityManagerOptions['interpolation'],
  durationMs: number
): ObjectInterpolationParameter | null => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return null;
  }
  return {
    mode: base.mode,
    durationMs,
    easing: base.easing,
  };
};

const buildSpriteUpdate = <TEntityData>(
  options: LogicalGraphEntityManagerOptions<TEntityData>,
  spriteId: number,
  position: ResolvedGraphPosition,
  durationMs: number
): SpriteBulkUpdate => ({
  spriteId,
  sx: {
    value: position.point.lng,
    interpolation: createInterpolation(options.interpolation, durationMs),
  },
  sy: {
    value: position.point.lat,
    interpolation: createInterpolation(options.interpolation, durationMs),
  },
});

const createEntityStateSnapshot = <TEntityData>(
  record: LogicalGraphEntityRecord<TEntityData>
): LogicalGraphEntityState<TEntityData> => ({
  entityId: record.entityId,
  data: record.data,
  spriteId: record.spriteId,
  currentPosition: record.currentPosition,
  motionTargetPosition: record.motionTargetPosition,
  updatedAtMs: record.updatedAtMs,
  motionEndMs: record.motionEndMs,
});

const resolveMotionRatio = (
  motion: LogicalGraphEntityMotionState,
  timestampMs: number
) => {
  if (motion.endMs <= motion.startMs) {
    return 1;
  }
  return Math.min(
    1,
    Math.max(
      0,
      (timestampMs - motion.startMs) / (motion.endMs - motion.startMs)
    )
  );
};

const resolveRecordPositionAt = <TEntityData>(
  options: LogicalGraphEntityManagerOptions<TEntityData>,
  record: LogicalGraphEntityRecord<TEntityData>,
  timestampMs: number
) => {
  if (!record.motion) {
    return record.currentPosition;
  }
  if (timestampMs >= record.motion.endMs) {
    return record.motion.path.to;
  }
  if (timestampMs <= record.motion.startMs) {
    return record.motion.path.from;
  }
  return resolveGraphMotionPathAddress(
    options.geometry,
    record.motion.path,
    resolveMotionRatio(record.motion, timestampMs)
  );
};

const isSameDistance = (left: number, right: number) =>
  Math.abs(left - right) <= DISTANCE_EPSILON;

const assertFiniteDistance = (value: number, label: string) => {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite.`);
  }
};

const buildGraphMotionPath = (
  from: ResolvedGraphPosition,
  to: ResolvedGraphPosition,
  pendingSegments: readonly Omit<
    GraphMotionPathSegment,
    'startDistance' | 'endDistance'
  >[]
): GraphMotionPath => {
  let totalLength = 0;
  const segmentList = pendingSegments.map((segment) => {
    const startDistance = totalLength;
    totalLength += segment.length;
    return {
      ...segment,
      startDistance,
      endDistance: totalLength,
    };
  });

  return {
    from,
    to,
    segmentList,
    totalLength,
  };
};

const resolveMotionPathFromPathList = (
  geometry: GraphGeometry,
  currentPosition: ResolvedGraphPosition,
  pathList: readonly GraphPath[]
): GraphMotionPath => {
  if (currentPosition.kind !== 'wayPoint') {
    throw new Error(
      'Path list moves require the entity to be on an exact waypoint.'
    );
  }
  if (pathList.length === 0) {
    throw new Error('Path list move must contain at least 1 graph path.');
  }

  let expectedFromWayPointId = currentPosition.wayPointId;
  const pendingSegments: Omit<
    GraphMotionPathSegment,
    'startDistance' | 'endDistance'
  >[] = [];

  pathList.forEach((path, pathIndex) => {
    if (path.traversalList.length === 0) {
      throw new Error(`Path list entry ${pathIndex} must not be empty.`);
    }
    if (path.fromWayPointId !== expectedFromWayPointId) {
      throw new Error(
        `Path list entry ${pathIndex} must start at waypoint ${expectedFromWayPointId}.`
      );
    }
    if (path.fromWayPointId === path.toWayPointId) {
      throw new Error(
        `Path list entry ${pathIndex} must connect distinct waypoints.`
      );
    }

    let accumulatedLength = 0;
    let traversalStartWayPointId = path.fromWayPointId;

    path.traversalList.forEach((traversal, traversalIndex) => {
      assertFiniteDistance(
        traversal.length,
        `Path list entry ${pathIndex} traversal ${traversalIndex} length`
      );
      assertFiniteDistance(
        traversal.startDistance,
        `Path list entry ${pathIndex} traversal ${traversalIndex} startDistance`
      );
      assertFiniteDistance(
        traversal.endDistance,
        `Path list entry ${pathIndex} traversal ${traversalIndex} endDistance`
      );

      if (traversal.fromWayPointId !== traversalStartWayPointId) {
        throw new Error(
          `Path list entry ${pathIndex} traversal ${traversalIndex} is not connected to the previous traversal.`
        );
      }

      const wayGeometry = geometry.wayGeometryById.get(traversal.wayId);
      if (!wayGeometry) {
        throw new Error(
          `Unknown way id in path list entry ${pathIndex}: ${traversal.wayId}`
        );
      }

      const traversedForward =
        wayGeometry.fromWayPointId === traversal.fromWayPointId &&
        wayGeometry.toWayPointId === traversal.toWayPointId;
      const traversedBackward =
        wayGeometry.fromWayPointId === traversal.toWayPointId &&
        wayGeometry.toWayPointId === traversal.fromWayPointId;
      if (!traversedForward && !traversedBackward) {
        throw new Error(
          `Path list entry ${pathIndex} traversal ${traversalIndex} does not match way ${traversal.wayId}.`
        );
      }

      if (!isSameDistance(traversal.length, wayGeometry.totalLength)) {
        throw new Error(
          `Path list entry ${pathIndex} traversal ${traversalIndex} length does not match way ${traversal.wayId}.`
        );
      }
      if (!isSameDistance(traversal.startDistance, accumulatedLength)) {
        throw new Error(
          `Path list entry ${pathIndex} traversal ${traversalIndex} startDistance is inconsistent.`
        );
      }

      accumulatedLength += wayGeometry.totalLength;
      if (!isSameDistance(traversal.endDistance, accumulatedLength)) {
        throw new Error(
          `Path list entry ${pathIndex} traversal ${traversalIndex} endDistance is inconsistent.`
        );
      }

      pendingSegments.push({
        wayId: traversal.wayId,
        startDistanceOnWay: traversedForward ? 0 : wayGeometry.totalLength,
        endDistanceOnWay: traversedForward ? wayGeometry.totalLength : 0,
        length: wayGeometry.totalLength,
      });
      traversalStartWayPointId = traversal.toWayPointId;
    });

    if (traversalStartWayPointId !== path.toWayPointId) {
      throw new Error(
        `Path list entry ${pathIndex} does not end at waypoint ${path.toWayPointId}.`
      );
    }
    if (!isSameDistance(path.totalLength, accumulatedLength)) {
      throw new Error(
        `Path list entry ${pathIndex} totalLength is inconsistent.`
      );
    }
    expectedFromWayPointId = path.toWayPointId;
  });

  const targetPosition = resolveGraphPositionAddress(geometry, {
    wayPointId: expectedFromWayPointId,
  });

  return buildGraphMotionPath(currentPosition, targetPosition, pendingSegments);
};

const createPendingUpdate = <TEntityData>(
  options: LogicalGraphEntityManagerOptions<TEntityData>,
  record: LogicalGraphEntityRecord<TEntityData>,
  currentPosition: ResolvedGraphPosition,
  targetPosition: ResolvedGraphPosition,
  targetTimestampMs: number,
  motionPath: GraphMotionPath,
  now: number
): PendingLogicalGraphEntityUpdate<TEntityData> => {
  if (targetTimestampMs <= now || motionPath.totalLength <= DISTANCE_EPSILON) {
    return {
      record,
      nextCurrentPosition: targetPosition,
      nextMotionTargetPosition: undefined,
      nextUpdatedAtMs: now,
      nextMotionEndMs: undefined,
      nextMotion: undefined,
      spriteUpdate: buildSpriteUpdate(
        options,
        record.spriteId,
        targetPosition,
        0
      ),
    };
  }

  const nextTickMs = Math.min(now + options.tickIntervalMs, targetTimestampMs);
  const nextPosition = resolveGraphMotionPathAddress(
    options.geometry,
    motionPath,
    resolveMotionRatio(
      {
        path: motionPath,
        startMs: now,
        endMs: targetTimestampMs,
        nextTickMs,
      },
      nextTickMs
    )
  );

  return {
    record,
    nextCurrentPosition: currentPosition,
    nextMotionTargetPosition: targetPosition,
    nextUpdatedAtMs: now,
    nextMotionEndMs: targetTimestampMs,
    nextMotion: {
      path: motionPath,
      startMs: now,
      endMs: targetTimestampMs,
      nextTickMs,
    },
    spriteUpdate: buildSpriteUpdate(
      options,
      record.spriteId,
      nextPosition,
      nextTickMs - now
    ),
  };
};

///////////////////////////////////////////////////////////////////////////////////

/**
 * Creates an entity manager that keeps sprite positions synchronized with
 * motion on a logical graph.
 *
 * @typeParam TEntityData - User data stored alongside each entity.
 * @param options - Entity manager configuration.
 * @returns Entity manager bound to the provided geometry and renderer.
 *
 * @remarks
 * `tickIntervalMs` must be a positive finite number. Movement requests may
 * still fail later if their start and target positions do not define a unique
 * motion path.
 */
export const createLogicalGraphEntityManager = <TEntityData>(
  options: LogicalGraphEntityManagerOptions<TEntityData>
): LogicalGraphEntityManager<TEntityData> => {
  if (!Number.isFinite(options.tickIntervalMs) || options.tickIntervalMs <= 0) {
    throw new Error('tickIntervalMs must be a positive finite number.');
  }

  const scheduler = options.scheduler ?? createDefaultScheduler();
  const entityRecordById = new Map<
    string,
    LogicalGraphEntityRecord<TEntityData>
  >();
  let timerId: LogicalGraphTimerId | undefined = undefined;

  const clearTimer = () => {
    if (timerId !== undefined) {
      scheduler.clearTimeout(timerId);
      timerId = undefined;
    }
  };

  const resolveNextDueAtMs = () => {
    let nextDueAtMs: number | undefined = undefined;
    entityRecordById.forEach((record) => {
      if (!record.motion) {
        return;
      }
      if (nextDueAtMs === undefined || record.motion.nextTickMs < nextDueAtMs) {
        nextDueAtMs = record.motion.nextTickMs;
      }
    });
    return nextDueAtMs;
  };

  const scheduleNextTick = () => {
    clearTimer();
    const nextDueAtMs = resolveNextDueAtMs();
    if (nextDueAtMs === undefined) {
      return;
    }
    const delayMs = Math.max(0, nextDueAtMs - scheduler.now());
    timerId = scheduler.setTimeout(() => {
      timerId = undefined;
      const now = scheduler.now();
      const spriteUpdates: SpriteBulkUpdate[] = [];

      entityRecordById.forEach((record) => {
        const motion = record.motion;
        if (!motion || motion.nextTickMs > now) {
          return;
        }

        const currentPosition = resolveRecordPositionAt(options, record, now);
        record.currentPosition = currentPosition;
        record.updatedAtMs = now;

        if (now >= motion.endMs) {
          record.motion = undefined;
          record.motionTargetPosition = undefined;
          record.motionEndMs = undefined;
          return;
        }

        const nextTickMs = Math.min(now + options.tickIntervalMs, motion.endMs);
        const nextPosition = resolveGraphMotionPathAddress(
          options.geometry,
          motion.path,
          resolveMotionRatio(motion, nextTickMs)
        );
        motion.nextTickMs = nextTickMs;
        spriteUpdates.push(
          buildSpriteUpdate(
            options,
            record.spriteId,
            nextPosition,
            nextTickMs - now
          )
        );
      });

      if (spriteUpdates.length > 0) {
        options.renderer.updateSprites(spriteUpdates);
      }
      scheduleNextTick();
    }, delayMs);
  };

  const registerEntities = async (
    entities: readonly LogicalGraphEntityRegistration<TEntityData>[]
  ) => {
    const seenIds = new Set<string>();
    const resolvedEntities = entities.map((entity) => {
      if (seenIds.has(entity.entityId)) {
        throw new Error(`Duplicated entity id: ${entity.entityId}`);
      }
      if (entityRecordById.has(entity.entityId)) {
        throw new Error(`Entity id is already registered: ${entity.entityId}`);
      }
      seenIds.add(entity.entityId);
      const resolvedPosition = resolveGraphPositionAddress(
        options.geometry,
        entity.position
      );
      return {
        entity,
        resolvedPosition,
      };
    });

    const placements = resolvedEntities.map(({ entity, resolvedPosition }) =>
      options.createSpritePlacement(entity, resolvedPosition)
    );
    const spriteIds = (await options.renderer.addSprites(
      placements,
      true
    )) as number[];

    resolvedEntities.forEach(({ entity, resolvedPosition }, index) => {
      const spriteId = spriteIds[index];
      if (spriteId === undefined) {
        throw new Error(`Missing sprite id for entity ${entity.entityId}.`);
      }
      entityRecordById.set(entity.entityId, {
        entityId: entity.entityId,
        data: entity.data,
        spriteId,
        currentPosition: resolvedPosition,
        motionTargetPosition: undefined,
        updatedAtMs: entity.timestampMs ?? scheduler.now(),
        motionEndMs: undefined,
        motion: undefined,
      });
    });

    scheduleNextTick();
    return spriteIds;
  };

  const registerEntity = async (
    entity: LogicalGraphEntityRegistration<TEntityData>
  ) => {
    const spriteIds = await registerEntities([entity]);
    return spriteIds[0]!;
  };

  const updateEntities = (moves: readonly LogicalGraphEntityMove[]) => {
    const now = scheduler.now();
    const seenIds = new Set<string>();
    const pendingUpdates: PendingLogicalGraphEntityUpdate<TEntityData>[] =
      moves.map((move) => {
        if (seenIds.has(move.entityId)) {
          throw new Error(`Duplicated entity id: ${move.entityId}`);
        }
        seenIds.add(move.entityId);

        const record = entityRecordById.get(move.entityId);
        if (!record) {
          throw new Error(`Unknown entity id: ${move.entityId}`);
        }

        const currentPosition = resolveRecordPositionAt(options, record, now);
        const targetPosition = resolveGraphPositionAddress(
          options.geometry,
          move.position
        );
        const targetTimestampMs = move.timestampMs ?? now;
        const motionPath = resolveGraphMotionPathBetweenResolvedPositions(
          options.geometry,
          currentPosition,
          targetPosition
        );
        return createPendingUpdate(
          options,
          record,
          currentPosition,
          targetPosition,
          targetTimestampMs,
          motionPath,
          now
        );
      });

    pendingUpdates.forEach((pendingUpdate) => {
      pendingUpdate.record.currentPosition = pendingUpdate.nextCurrentPosition;
      pendingUpdate.record.motionTargetPosition =
        pendingUpdate.nextMotionTargetPosition;
      pendingUpdate.record.updatedAtMs = pendingUpdate.nextUpdatedAtMs;
      pendingUpdate.record.motionEndMs = pendingUpdate.nextMotionEndMs;
      pendingUpdate.record.motion = pendingUpdate.nextMotion;
    });

    const spriteUpdates = pendingUpdates
      .map((pendingUpdate) => pendingUpdate.spriteUpdate)
      .filter(
        (spriteUpdate): spriteUpdate is SpriteBulkUpdate => !!spriteUpdate
      );
    if (spriteUpdates.length > 0) {
      options.renderer.updateSprites(spriteUpdates);
    }

    scheduleNextTick();
  };

  const updateEntity = (move: LogicalGraphEntityMove) => {
    updateEntities([move]);
  };

  const updateEntitiesByPathList = (
    moves: readonly LogicalGraphEntityPathMove[]
  ) => {
    const now = scheduler.now();
    const seenIds = new Set<string>();
    const pendingUpdates: PendingLogicalGraphEntityUpdate<TEntityData>[] =
      moves.map((move) => {
        if (seenIds.has(move.entityId)) {
          throw new Error(`Duplicated entity id: ${move.entityId}`);
        }
        seenIds.add(move.entityId);

        const record = entityRecordById.get(move.entityId);
        if (!record) {
          throw new Error(`Unknown entity id: ${move.entityId}`);
        }

        const currentPosition = resolveRecordPositionAt(options, record, now);
        const motionPath = resolveMotionPathFromPathList(
          options.geometry,
          currentPosition,
          move.pathList
        );
        const targetTimestampMs = move.timestampMs ?? now;

        return createPendingUpdate(
          options,
          record,
          currentPosition,
          motionPath.to,
          targetTimestampMs,
          motionPath,
          now
        );
      });

    pendingUpdates.forEach((pendingUpdate) => {
      pendingUpdate.record.currentPosition = pendingUpdate.nextCurrentPosition;
      pendingUpdate.record.motionTargetPosition =
        pendingUpdate.nextMotionTargetPosition;
      pendingUpdate.record.updatedAtMs = pendingUpdate.nextUpdatedAtMs;
      pendingUpdate.record.motionEndMs = pendingUpdate.nextMotionEndMs;
      pendingUpdate.record.motion = pendingUpdate.nextMotion;
    });

    const spriteUpdates = pendingUpdates
      .map((pendingUpdate) => pendingUpdate.spriteUpdate)
      .filter(
        (spriteUpdate): spriteUpdate is SpriteBulkUpdate => !!spriteUpdate
      );
    if (spriteUpdates.length > 0) {
      options.renderer.updateSprites(spriteUpdates);
    }

    scheduleNextTick();
  };

  const updateEntityByPathList = (move: LogicalGraphEntityPathMove) => {
    updateEntitiesByPathList([move]);
  };

  const unregisterEntities = (entityIds: readonly string[]) => {
    const seenIds = new Set<string>();
    const spriteIds = entityIds.map((entityId) => {
      if (seenIds.has(entityId)) {
        throw new Error(`Duplicated entity id: ${entityId}`);
      }
      seenIds.add(entityId);
      const record = entityRecordById.get(entityId);
      if (!record) {
        throw new Error(`Unknown entity id: ${entityId}`);
      }
      entityRecordById.delete(entityId);
      return record.spriteId;
    });

    if (spriteIds.length > 0) {
      options.renderer.removeSprites(spriteIds);
    }
    scheduleNextTick();
  };

  const unregisterEntity = (entityId: string) => {
    unregisterEntities([entityId]);
  };

  const getEntityState = (entityId: string) => {
    const record = entityRecordById.get(entityId);
    if (!record) {
      throw new Error(`Unknown entity id: ${entityId}`);
    }
    return createEntityStateSnapshot(record);
  };

  const release = () => {
    clearTimer();
    const spriteIds = [...entityRecordById.values()].map(
      (record) => record.spriteId
    );
    entityRecordById.clear();
    if (spriteIds.length > 0) {
      options.renderer.removeSprites(spriteIds);
    }
  };

  return {
    registerEntity,
    registerEntities,
    updateEntity,
    updateEntities,
    updateEntityByPathList,
    updateEntitiesByPathList,
    unregisterEntity,
    unregisterEntities,
    getEntityState,
    release,
    [Symbol.dispose]: release,
  };
};
