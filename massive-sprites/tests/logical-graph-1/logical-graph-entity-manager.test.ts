// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type {
  Graph,
  LogicalGraphEntityScheduler,
  LogicalGraphSpriteRenderer,
  Node,
  Way,
  WayPoint,
} from '../../src/logical-graph';
import {
  createGraphGeometry,
  createLogicalGraphEntityManager,
  listGraphPaths,
} from '../../src/logical-graph';
import type { SpriteBulkUpdate, SpritePlacement } from '../../src/types';

const createWayPoint = (id: string, lng: number, lat: number): WayPoint => ({
  id,
  lng,
  lat,
});

const createWay = (
  id: string,
  fromWayPointId: string,
  toWayPointId: string,
  nodeList: readonly Node[]
): Way => ({
  id,
  fromWayPointId,
  toWayPointId,
  nodeList,
});

const buildBranchGraph = (): Graph => {
  const wayPointA = createWayPoint('A', 0, 0);
  const wayPointB = createWayPoint('B', 10, 0);
  const wayPointC = createWayPoint('C', 20, 0);
  const wayPointD = createWayPoint('D', 10, 10);

  return {
    wayPointList: [wayPointA, wayPointB, wayPointC, wayPointD],
    wayList: [
      createWay('ab', wayPointA.id, wayPointB.id, [wayPointA, wayPointB]),
      createWay('bc', wayPointB.id, wayPointC.id, [wayPointB, wayPointC]),
      createWay('bd', wayPointB.id, wayPointD.id, [wayPointB, wayPointD]),
    ],
  };
};

const buildAmbiguousGraph = (): Graph => {
  const wayPointE = createWayPoint('E', -10, 0);
  const wayPointA = createWayPoint('A', 0, 0);
  const wayPointB = createWayPoint('B', 10, 0);
  const wayPointC = createWayPoint('C', 20, 0);
  const wayPointD = createWayPoint('D', 10, 10);

  return {
    wayPointList: [wayPointE, wayPointA, wayPointB, wayPointC, wayPointD],
    wayList: [
      createWay('ea', wayPointE.id, wayPointA.id, [wayPointE, wayPointA]),
      createWay('ab', wayPointA.id, wayPointB.id, [wayPointA, wayPointB]),
      createWay('bc', wayPointB.id, wayPointC.id, [wayPointB, wayPointC]),
      createWay('ad', wayPointA.id, wayPointD.id, [wayPointA, wayPointD]),
      createWay('dc', wayPointD.id, wayPointC.id, [wayPointD, wayPointC]),
    ],
  };
};

const buildTriangleGraph = (): Graph => {
  const wayPointA = createWayPoint('A', 0, 0);
  const wayPointB = createWayPoint('B', 10, 0);
  const wayPointC = createWayPoint('C', 5, 10);

  return {
    wayPointList: [wayPointA, wayPointB, wayPointC],
    wayList: [
      createWay('ab', wayPointA.id, wayPointB.id, [wayPointA, wayPointB]),
      createWay('bc', wayPointB.id, wayPointC.id, [wayPointB, wayPointC]),
      createWay('ca', wayPointC.id, wayPointA.id, [wayPointC, wayPointA]),
    ],
  };
};

const createSchedulerHarness = () => {
  let now = 0;
  let nextId = 1;
  const taskMap = new Map<number, { dueAtMs: number; handler: () => void }>();

  const scheduler: LogicalGraphEntityScheduler = {
    now: () => now,
    setTimeout: (handler, timeoutMs) => {
      const id = nextId++;
      taskMap.set(id, {
        dueAtMs: now + timeoutMs,
        handler,
      });
      return id as unknown as ReturnType<typeof setTimeout>;
    },
    clearTimeout: (handle) => {
      taskMap.delete(handle as unknown as number);
    },
  };

  const advanceTo = (targetMs: number) => {
    while (true) {
      const dueEntry = [...taskMap.entries()]
        .filter(([, task]) => task.dueAtMs <= targetMs)
        .sort((left, right) => left[1].dueAtMs - right[1].dueAtMs)[0];
      if (!dueEntry) {
        break;
      }
      const [taskId, task] = dueEntry;
      taskMap.delete(taskId);
      now = task.dueAtMs;
      task.handler();
    }
    now = targetMs;
  };

  return {
    scheduler,
    advanceTo,
    getPendingDueAtMs: () =>
      [...taskMap.values()]
        .map((task) => task.dueAtMs)
        .sort((left, right) => left - right),
  };
};

const createRendererHarness = () => {
  let nextSpriteId = 100;
  const addCalls: SpritePlacement[][] = [];
  const updateCalls: SpriteBulkUpdate[][] = [];
  const removeCalls: number[][] = [];

  const renderer: LogicalGraphSpriteRenderer = {
    addSprites: (
      placements: readonly SpritePlacement[],
      awaitable?: boolean
    ) => {
      addCalls.push([...placements]);
      const spriteIds = placements.map(() => nextSpriteId++);
      return awaitable === true ? Promise.resolve(spriteIds) : undefined;
    },
    updateSprites: (updates: readonly SpriteBulkUpdate[]) => {
      updateCalls.push([...updates]);
    },
    removeSprites: (spriteIds: readonly number[]) => {
      removeCalls.push([...spriteIds]);
    },
  };

  return {
    renderer,
    addCalls,
    updateCalls,
    removeCalls,
  };
};

const createSpritePlacement = (
  label: string,
  x: number,
  y: number
): SpritePlacement => ({
  sx: { value: x },
  sy: { value: y },
  elements: [
    {
      imageId: `${label}.png`,
      mode: 'billboard',
    },
  ],
});

describe('logical-graph entity manager', () => {
  it('registers an entity with its resolved initial sprite placement', async () => {
    const schedulerHarness = createSchedulerHarness();
    const rendererHarness = createRendererHarness();
    const manager = createLogicalGraphEntityManager<string>({
      geometry: createGraphGeometry(buildBranchGraph()),
      renderer: rendererHarness.renderer,
      tickIntervalMs: 500,
      interpolation: {
        mode: 'feedback',
        easing: { type: 'linear' },
      },
      scheduler: schedulerHarness.scheduler,
      createSpritePlacement: (entity, position) =>
        createSpritePlacement(
          entity.data,
          position.point.lng,
          position.point.lat
        ),
    });

    const spriteId = await manager.registerEntity({
      entityId: 'car-0',
      data: 'car',
      position: {
        fromWayPointId: 'A',
        toWayPointId: 'C',
        ratio: 0.25,
      },
    });

    expect(spriteId).toBe(100);
    expect(rendererHarness.addCalls).toHaveLength(1);
    expect(rendererHarness.addCalls[0]?.[0]?.sx.value).toBeCloseTo(5, 6);
    expect(rendererHarness.addCalls[0]?.[0]?.sy.value).toBeCloseTo(0, 6);
    expect(
      manager.getEntityState('car-0').currentPosition.point.lng
    ).toBeCloseTo(5, 6);
  });

  it('uses a single timer to advance interpolation in fixed intervals', async () => {
    const schedulerHarness = createSchedulerHarness();
    const rendererHarness = createRendererHarness();
    const manager = createLogicalGraphEntityManager<string>({
      geometry: createGraphGeometry(buildBranchGraph()),
      renderer: rendererHarness.renderer,
      tickIntervalMs: 500,
      interpolation: {
        mode: 'feedback',
        easing: { type: 'linear' },
      },
      scheduler: schedulerHarness.scheduler,
      createSpritePlacement: (_entity, position) =>
        createSpritePlacement('car', position.point.lng, position.point.lat),
    });

    await manager.registerEntity({
      entityId: 'car-0',
      data: 'car',
      position: {
        fromWayPointId: 'A',
        toWayPointId: 'C',
        ratio: 0,
      },
      timestampMs: 0,
    });

    manager.updateEntity({
      entityId: 'car-0',
      position: {
        fromWayPointId: 'A',
        toWayPointId: 'C',
        ratio: 1,
      },
      timestampMs: 1000,
    });

    expect(rendererHarness.updateCalls).toHaveLength(1);
    expect(rendererHarness.updateCalls[0]).toHaveLength(1);
    expect(rendererHarness.updateCalls[0]?.[0]?.sx?.value).toBeCloseTo(10, 6);
    expect(
      rendererHarness.updateCalls[0]?.[0]?.sx?.interpolation?.durationMs
    ).toBeCloseTo(500, 6);
    expect(schedulerHarness.getPendingDueAtMs()).toEqual([500]);

    schedulerHarness.advanceTo(500);

    expect(rendererHarness.updateCalls).toHaveLength(2);
    expect(rendererHarness.updateCalls[1]?.[0]?.sx?.value).toBeCloseTo(20, 6);
    expect(schedulerHarness.getPendingDueAtMs()).toEqual([1000]);

    schedulerHarness.advanceTo(1000);

    expect(schedulerHarness.getPendingDueAtMs()).toEqual([]);
    expect(
      manager.getEntityState('car-0').currentPosition.point.lng
    ).toBeCloseTo(20, 6);
  });

  it('batches due entity updates on the same timer wake', async () => {
    const schedulerHarness = createSchedulerHarness();
    const rendererHarness = createRendererHarness();
    const manager = createLogicalGraphEntityManager<string>({
      geometry: createGraphGeometry(buildBranchGraph()),
      renderer: rendererHarness.renderer,
      tickIntervalMs: 500,
      interpolation: {
        mode: 'feedback',
        easing: { type: 'linear' },
      },
      scheduler: schedulerHarness.scheduler,
      createSpritePlacement: (entity, position) =>
        createSpritePlacement(
          entity.data,
          position.point.lng,
          position.point.lat
        ),
    });

    await manager.registerEntities([
      {
        entityId: 'car-0',
        data: 'car-0',
        position: {
          fromWayPointId: 'A',
          toWayPointId: 'C',
          ratio: 0,
        },
        timestampMs: 0,
      },
      {
        entityId: 'car-1',
        data: 'car-1',
        position: {
          fromWayPointId: 'B',
          toWayPointId: 'D',
          ratio: 0,
        },
        timestampMs: 0,
      },
    ]);

    manager.updateEntities([
      {
        entityId: 'car-0',
        position: {
          fromWayPointId: 'A',
          toWayPointId: 'C',
          ratio: 1,
        },
        timestampMs: 1000,
      },
      {
        entityId: 'car-1',
        position: {
          fromWayPointId: 'B',
          toWayPointId: 'D',
          ratio: 1,
        },
        timestampMs: 1000,
      },
    ]);

    expect(rendererHarness.updateCalls[0]).toHaveLength(2);
    expect(schedulerHarness.getPendingDueAtMs()).toEqual([500]);

    schedulerHarness.advanceTo(500);

    expect(rendererHarness.updateCalls).toHaveLength(2);
    expect(rendererHarness.updateCalls[1]).toHaveLength(2);
    expect(schedulerHarness.getPendingDueAtMs()).toEqual([1000]);
  });

  it('removes scheduled work when an entity is unregistered', async () => {
    const schedulerHarness = createSchedulerHarness();
    const rendererHarness = createRendererHarness();
    const manager = createLogicalGraphEntityManager<string>({
      geometry: createGraphGeometry(buildBranchGraph()),
      renderer: rendererHarness.renderer,
      tickIntervalMs: 500,
      interpolation: {
        mode: 'feedback',
        easing: { type: 'linear' },
      },
      scheduler: schedulerHarness.scheduler,
      createSpritePlacement: (_entity, position) =>
        createSpritePlacement('car', position.point.lng, position.point.lat),
    });

    await manager.registerEntity({
      entityId: 'car-0',
      data: 'car',
      position: {
        fromWayPointId: 'A',
        toWayPointId: 'C',
        ratio: 0,
      },
      timestampMs: 0,
    });

    manager.updateEntity({
      entityId: 'car-0',
      position: {
        fromWayPointId: 'A',
        toWayPointId: 'C',
        ratio: 1,
      },
      timestampMs: 1000,
    });

    expect(schedulerHarness.getPendingDueAtMs()).toEqual([500]);

    manager.unregisterEntity('car-0');

    expect(rendererHarness.removeCalls).toEqual([[100]]);
    expect(schedulerHarness.getPendingDueAtMs()).toEqual([]);
  });

  it('rejects ambiguous motion updates', async () => {
    const schedulerHarness = createSchedulerHarness();
    const rendererHarness = createRendererHarness();
    const manager = createLogicalGraphEntityManager<string>({
      geometry: createGraphGeometry(buildAmbiguousGraph()),
      renderer: rendererHarness.renderer,
      tickIntervalMs: 500,
      interpolation: {
        mode: 'feedback',
        easing: { type: 'linear' },
      },
      scheduler: schedulerHarness.scheduler,
      createSpritePlacement: (_entity, position) =>
        createSpritePlacement('car', position.point.lng, position.point.lat),
    });

    await manager.registerEntity({
      entityId: 'car-0',
      data: 'car',
      position: {
        fromWayPointId: 'E',
        toWayPointId: 'A',
        ratio: 0.5,
      },
      timestampMs: 0,
    });

    expect(() =>
      manager.updateEntity({
        entityId: 'car-0',
        position: {
          fromWayPointId: 'B',
          toWayPointId: 'C',
          ratio: 0.5,
        },
        timestampMs: 1000,
      })
    ).toThrow(/ambiguous/i);
  });

  it('allows cyclic traversal updates when exact waypoints target specific ways', async () => {
    const schedulerHarness = createSchedulerHarness();
    const rendererHarness = createRendererHarness();
    const manager = createLogicalGraphEntityManager<string>({
      geometry: createGraphGeometry(buildTriangleGraph()),
      renderer: rendererHarness.renderer,
      tickIntervalMs: 500,
      interpolation: {
        mode: 'feedback',
        easing: { type: 'linear' },
      },
      scheduler: schedulerHarness.scheduler,
      createSpritePlacement: (_entity, position) =>
        createSpritePlacement('car', position.point.lng, position.point.lat),
    });

    await manager.registerEntity({
      entityId: 'car-0',
      data: 'car',
      position: {
        wayPointId: 'A',
      },
      timestampMs: 0,
    });

    manager.updateEntity({
      entityId: 'car-0',
      position: {
        wayId: 'ab',
        ratio: 1,
      },
      timestampMs: 1000,
    });

    expect(rendererHarness.updateCalls).toHaveLength(1);
    expect(rendererHarness.updateCalls[0]?.[0]?.sx?.value).toBeCloseTo(5, 6);
    expect(schedulerHarness.getPendingDueAtMs()).toEqual([500]);

    schedulerHarness.advanceTo(1000);

    expect(manager.getEntityState('car-0').currentPosition.kind).toBe('way');

    manager.updateEntity({
      entityId: 'car-0',
      position: {
        wayPointId: 'B',
      },
      timestampMs: 1000,
    });

    expect(manager.getEntityState('car-0').currentPosition.kind).toBe(
      'wayPoint'
    );
  });

  it('moves an entity along an explicit path list', async () => {
    const schedulerHarness = createSchedulerHarness();
    const rendererHarness = createRendererHarness();
    const geometry = createGraphGeometry(buildTriangleGraph());
    const manager = createLogicalGraphEntityManager<string>({
      geometry,
      renderer: rendererHarness.renderer,
      tickIntervalMs: 500,
      interpolation: {
        mode: 'feedback',
        easing: { type: 'linear' },
      },
      scheduler: schedulerHarness.scheduler,
      createSpritePlacement: (_entity, position) =>
        createSpritePlacement('car', position.point.lng, position.point.lat),
    });

    const viaCPath = listGraphPaths(geometry, 'A', 'B').paths.find(
      (path) =>
        path.traversalList.map((traversal) => traversal.wayId).join(',') ===
        'ca,bc'
    );
    if (!viaCPath) {
      throw new Error('Missing explicit path via C.');
    }

    await manager.registerEntity({
      entityId: 'car-0',
      data: 'car',
      position: {
        wayPointId: 'A',
      },
      timestampMs: 0,
    });

    manager.updateEntityByPathList({
      entityId: 'car-0',
      pathList: [viaCPath],
      timestampMs: 1000,
    });

    expect(rendererHarness.updateCalls).toHaveLength(1);
    expect(rendererHarness.updateCalls[0]?.[0]?.sx?.value).toBeCloseTo(5, 6);
    expect(rendererHarness.updateCalls[0]?.[0]?.sy?.value).toBeCloseTo(10, 6);
    expect(schedulerHarness.getPendingDueAtMs()).toEqual([500]);

    schedulerHarness.advanceTo(500);

    expect(rendererHarness.updateCalls).toHaveLength(2);
    expect(rendererHarness.updateCalls[1]?.[0]?.sx?.value).toBeCloseTo(10, 6);
    expect(rendererHarness.updateCalls[1]?.[0]?.sy?.value).toBeCloseTo(0, 6);

    schedulerHarness.advanceTo(1000);

    expect(manager.getEntityState('car-0').currentPosition.kind).toBe(
      'wayPoint'
    );
    expect(
      manager.getEntityState('car-0').currentPosition.point.lng
    ).toBeCloseTo(10, 6);
  });

  it('rejects invalid path list metadata before changing entity state', async () => {
    const schedulerHarness = createSchedulerHarness();
    const rendererHarness = createRendererHarness();
    const geometry = createGraphGeometry(buildTriangleGraph());
    const manager = createLogicalGraphEntityManager<string>({
      geometry,
      renderer: rendererHarness.renderer,
      tickIntervalMs: 500,
      interpolation: {
        mode: 'feedback',
        easing: { type: 'linear' },
      },
      scheduler: schedulerHarness.scheduler,
      createSpritePlacement: (_entity, position) =>
        createSpritePlacement('car', position.point.lng, position.point.lat),
    });

    const directPath = listGraphPaths(geometry, 'A', 'B').paths.find(
      (path) =>
        path.traversalList.map((traversal) => traversal.wayId).join(',') ===
        'ab'
    );
    if (!directPath) {
      throw new Error('Missing direct path.');
    }

    await manager.registerEntity({
      entityId: 'car-0',
      data: 'car',
      position: {
        wayPointId: 'A',
      },
      timestampMs: 0,
    });

    expect(() =>
      manager.updateEntityByPathList({
        entityId: 'car-0',
        pathList: [
          {
            ...directPath,
            totalLength: directPath.totalLength + 1,
          },
        ],
        timestampMs: 1000,
      })
    ).toThrow(/inconsistent/i);
    expect(rendererHarness.updateCalls).toHaveLength(0);
    expect(manager.getEntityState('car-0').currentPosition.kind).toBe(
      'wayPoint'
    );
    expect(schedulerHarness.getPendingDueAtMs()).toEqual([]);
  });
});
