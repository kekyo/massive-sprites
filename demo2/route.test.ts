// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';
import { createGraphGeometry } from 'massive-sprites/logical-graph';
import { asWayPoint, buildRouteLayout, type RouteData } from './route-utils';

const loadRouteDataFixture = (): RouteData =>
  JSON.parse(
    readFileSync(new URL('./public/route-real.json', import.meta.url), 'utf8')
  ) as RouteData;

const resolveWayPoint = (
  graph: ReturnType<typeof buildRouteLayout>['graph'],
  label: string
) => {
  const wayPoint = graph.routeWayPointList.find(
    (candidate) => candidate.label === label
  );
  if (!wayPoint) {
    throw new Error(`Missing route way point: ${label}`);
  }
  return wayPoint;
};

describe('demo2 route', () => {
  it('builds a full graph from route json while keeping the requested route waypoints', () => {
    const { bounds, graph } = buildRouteLayout(loadRouteDataFixture());
    const geometry = createGraphGeometry(graph);

    expect(graph.routeWayPointList).toHaveLength(6);
    expect(graph.wayPointList).toHaveLength(7);
    expect(graph.wayList).toHaveLength(8);
    expect(bounds.minX).toBeCloseTo(0, 6);
    expect(bounds.minY).toBeCloseTo(0, 6);
    expect(bounds.width).toBeCloseTo(1230.913742, 6);
    expect(bounds.height).toBeCloseTo(534.629988, 6);

    expect(graph.routeWayPointList.map((wayPoint) => wayPoint.label)).toEqual([
      'Path1 Top',
      'Path1 Path2 Junction',
      'Path2 Path3 Junction',
      'Path3 Upper Third',
      'Path3 Right End',
      'Path3 Lower Center',
    ]);

    expect(graph.routeWayPointList[0]?.lat).toBeCloseTo(534.629988, 6);
    expect(graph.routeWayPointList[1]?.lng).toBeCloseTo(261.852464, 6);
    expect(graph.routeWayPointList[1]?.lat).toBeCloseTo(44.629988, 6);
    expect(graph.routeWayPointList[2]?.lng).toBeCloseTo(335.305975, 6);
    expect(graph.routeWayPointList[4]?.lng).toBeCloseTo(1230.913742, 6);

    const leftJunction = resolveWayPoint(graph, 'Path1 Path2 Junction');
    const centerJunction = resolveWayPoint(graph, 'Path2 Path3 Junction');
    const helperWayPoint = graph.wayPointList.find(
      (wayPoint) => asWayPoint(wayPoint) === undefined
    );

    expect(helperWayPoint?.id).toBe('route-helper-left-bottom');
    expect(geometry.adjacencyByWayPointId.get(leftJunction.id)).toHaveLength(3);
    expect(geometry.adjacencyByWayPointId.get(centerJunction.id)).toHaveLength(
      3
    );
    expect(
      geometry.adjacencyByWayPointId.get(helperWayPoint?.id ?? '')
    ).toHaveLength(2);
  });

  it('recognizes visible route waypoints by shape and ignores helper waypoints', () => {
    const { graph } = buildRouteLayout(loadRouteDataFixture());
    const candidate = graph.routeWayPointList[0];
    if (!candidate) {
      throw new Error('Missing route waypoint node.');
    }

    const wayPoint = asWayPoint(candidate);
    expect(wayPoint).toBeDefined();
    expect(wayPoint?.label).toBe('Path1 Top');
    expect(wayPoint?.image).toBe('drop.png');

    const helperWayPoint = graph.wayPointList.find(
      (graphWayPoint) => graphWayPoint.id === 'route-helper-left-bottom'
    );
    if (!helperWayPoint) {
      throw new Error('Missing helper waypoint node.');
    }

    expect(asWayPoint(helperWayPoint)).toBeUndefined();
    expect(asWayPoint({ lat: 0, lng: 0 })).toBeUndefined();
  });
});
