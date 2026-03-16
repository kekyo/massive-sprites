// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import {
  createGraphGeometry,
  type Graph,
  type WayPoint,
} from 'massive-sprites/logical-graph';
import { buildRouteLayout, type RouteData } from './route-utils';
import {
  createWayPointGraphPosition,
  pickRouteTraversalOption,
  resolveRouteTraversalPath,
  resolveRouteTraversalOptions,
} from './route-motion';

const loadRouteDataFixture = (): RouteData =>
  JSON.parse(
    readFileSync(new URL('./public/route-real.json', import.meta.url), 'utf8')
  ) as RouteData;

const resolveRouteWayPointId = (
  graph: ReturnType<typeof buildRouteLayout>['graph'],
  label: string
) => {
  const wayPoint = graph.routeWayPointList.find(
    (candidate) => candidate.label === label
  );
  if (!wayPoint) {
    throw new Error(`Missing route way point: ${label}`);
  }
  return wayPoint.id;
};

const createWayPoint = (id: string, lng: number, lat: number): WayPoint => ({
  id,
  lng,
  lat,
});

describe('demo2 route motion', () => {
  it('excludes the incoming way when another outgoing way exists', () => {
    const { graph } = buildRouteLayout(loadRouteDataFixture());
    const geometry = createGraphGeometry(graph);
    const leftJunctionId = resolveRouteWayPointId(
      graph,
      'Path1 Path2 Junction'
    );

    const options = resolveRouteTraversalOptions(
      geometry,
      leftJunctionId,
      'route-way-bridge'
    );

    expect(options.map((option) => option.wayId).sort()).toEqual([
      'route-way-left-bottom-to-junction',
      'route-way-left-junction-to-top',
    ]);
    expect(options.every((option) => option.wayId !== 'route-way-bridge')).toBe(
      true
    );
  });

  it('continues through helper waypoints without reversing when another segment exists', () => {
    const { graph } = buildRouteLayout(loadRouteDataFixture());
    const geometry = createGraphGeometry(graph);

    const options = resolveRouteTraversalOptions(
      geometry,
      'route-helper-left-bottom',
      'route-way-left-top-to-bottom'
    );

    expect(options).toEqual([
      {
        wayId: 'route-way-left-bottom-to-junction',
        fromWayPointId: 'route-helper-left-bottom',
        toWayPointId: resolveRouteWayPointId(graph, 'Path1 Path2 Junction'),
      },
    ]);
  });

  it('allows reversing only when the waypoint is a dead end', () => {
    const wayPointA = createWayPoint('A', 0, 0);
    const wayPointB = createWayPoint('B', 10, 0);
    const graph: Graph = {
      wayPointList: [wayPointA, wayPointB],
      wayList: [
        {
          id: 'ab',
          fromWayPointId: 'A',
          toWayPointId: 'B',
          nodeList: [wayPointA, wayPointB],
        },
      ],
    };
    const geometry = createGraphGeometry(graph);

    const options = resolveRouteTraversalOptions(geometry, 'B', 'ab');

    expect(options).toEqual([
      {
        wayId: 'ab',
        fromWayPointId: 'B',
        toWayPointId: 'A',
      },
    ]);
  });

  it('builds exact waypoint positions and resolves direct traversal paths', () => {
    const { graph } = buildRouteLayout(loadRouteDataFixture());
    const geometry = createGraphGeometry(graph);
    const topWayPointId = resolveRouteWayPointId(graph, 'Path1 Top');
    const leftJunctionId = resolveRouteWayPointId(
      graph,
      'Path1 Path2 Junction'
    );

    expect(createWayPointGraphPosition(topWayPointId)).toEqual({
      wayPointId: topWayPointId,
    });
    expect(
      resolveRouteTraversalPath(geometry, {
        wayId: 'route-way-left-junction-to-top',
        fromWayPointId: leftJunctionId,
        toWayPointId: topWayPointId,
      })
    ).toMatchObject({
      fromWayPointId: leftJunctionId,
      toWayPointId: topWayPointId,
      totalLength: expect.any(Number),
      traversalList: [
        {
          wayId: 'route-way-left-junction-to-top',
          fromWayPointId: leftJunctionId,
          toWayPointId: topWayPointId,
        },
      ],
    });
  });

  it('selects a deterministic traversal candidate from a random value', () => {
    const { graph } = buildRouteLayout(loadRouteDataFixture());
    const geometry = createGraphGeometry(graph);
    const leftJunctionId = resolveRouteWayPointId(
      graph,
      'Path1 Path2 Junction'
    );

    const selected = pickRouteTraversalOption(
      geometry,
      leftJunctionId,
      'route-way-left-junction-to-top',
      0.9
    );

    expect(selected).toEqual({
      wayId: 'route-way-bridge',
      fromWayPointId: leftJunctionId,
      toWayPointId: resolveRouteWayPointId(graph, 'Path2 Path3 Junction'),
    });
  });
});
