// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import {
  createGraphGeometry,
  resolveGraphPositionAddress,
  type LogicalGraphEntityState,
} from 'massive-sprites/logical-graph';
import { createRouteTraversalController } from './route-traversal-controller';
import { buildRouteLayout, type RouteData } from './route-utils';

const loadRouteDataFixture = (): RouteData =>
  JSON.parse(
    readFileSync(new URL('./public/route-real.json', import.meta.url), 'utf8')
  ) as RouteData;

const createTimerHarness = () => {
  let now = 0;
  let nextId = 1;
  const taskMap = new Map<number, { dueAtMs: number; handler: () => void }>();

  return {
    timer: {
      now: () => now,
      setTimeout: (handler: () => void, timeoutMs: number) => {
        const id = nextId++;
        taskMap.set(id, {
          dueAtMs: now + timeoutMs,
          handler,
        });
        return id;
      },
      clearTimeout: (timeoutId: number) => {
        taskMap.delete(timeoutId);
      },
    },
    advanceTo: (targetMs: number) => {
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
    },
    getPendingDueAtMs: () =>
      [...taskMap.values()]
        .map((task) => task.dueAtMs)
        .sort((left, right) => left - right),
  };
};

const createEntityState = (
  state: Omit<
    LogicalGraphEntityState<unknown>,
    'entityId' | 'data' | 'spriteId'
  >
): LogicalGraphEntityState<unknown> => ({
  entityId: 'car-0',
  data: undefined,
  spriteId: 1,
  ...state,
});

describe('demo2 route traversal controller', () => {
  it('waits for the helper waypoint arrival before dispatching the next path list move', () => {
    const { graph } = buildRouteLayout(loadRouteDataFixture());
    const geometry = createGraphGeometry(graph);
    const timerHarness = createTimerHarness();
    const routeWayPointIdSet = new Set(
      graph.routeWayPointList.map((wayPoint) => wayPoint.id)
    );
    const helperWayPointPosition = resolveGraphPositionAddress(geometry, {
      wayPointId: 'route-helper-left-bottom',
    });
    const inFlightPosition = resolveGraphPositionAddress(geometry, {
      wayId: 'route-way-left-top-to-bottom',
      ratio: 0.5,
    });
    const updateCalls: {
      readonly pathList: readonly {
        readonly traversalList: readonly { readonly wayId: string }[];
      }[];
      readonly timestampMs: number | undefined;
    }[] = [];

    const entityManager = {
      getEntityState: () =>
        createEntityState({
          currentPosition: inFlightPosition,
          motionTargetPosition: helperWayPointPosition,
          updatedAtMs: 0,
          motionEndMs: 30,
        }),
      updateEntityByPathList: (move: {
        readonly entityId: string;
        readonly pathList: readonly {
          readonly fromWayPointId: string;
          readonly toWayPointId: string;
          readonly traversalList: readonly { readonly wayId: string }[];
        }[];
        readonly timestampMs?: number;
      }) => {
        if (timerHarness.timer.now() < 30) {
          throw new Error(
            'Path list moves require the entity to be on an exact waypoint.'
          );
        }
        updateCalls.push({
          pathList: move.pathList.map((path) => ({
            traversalList: path.traversalList.map((traversal) => ({
              wayId: traversal.wayId,
            })),
          })),
          timestampMs: move.timestampMs,
        });
      },
    };

    const controller = createRouteTraversalController({
      geometry,
      entityManager,
      entityId: 'car-0',
      speed: 1,
      incomingWayId: 'route-way-left-top-to-bottom',
      routeWayPointIdSet,
      pickPauseDurationMs: () => 0,
      resolveTravelDurationMs: () => 25,
      random: () => 0,
      retryDelayMs: 500,
      timer: timerHarness.timer,
    });

    timerHarness.advanceTo(0);

    expect(updateCalls).toHaveLength(0);
    expect(timerHarness.getPendingDueAtMs()).toEqual([30]);

    timerHarness.advanceTo(29);

    expect(updateCalls).toHaveLength(0);
    expect(timerHarness.getPendingDueAtMs()).toEqual([30]);

    timerHarness.advanceTo(30);

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.pathList[0]?.traversalList[0]?.wayId).toBe(
      'route-way-left-bottom-to-junction'
    );
    expect(updateCalls[0]?.timestampMs).toBe(55);

    controller.stop();
    expect(timerHarness.getPendingDueAtMs()).toEqual([]);
  });
});
