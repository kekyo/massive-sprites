// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it } from 'vitest';
import {
  createGraphGeometry,
  listGraphPaths,
  resolveGraphPath,
  resolveGraphPosition,
  type Graph,
  type Node,
  type Way,
  type WayPoint,
} from '../../src/logical-graph';

const createWayPoint = (id: string, lng: number, lat: number): WayPoint => ({
  id,
  lng,
  lat,
});

const createNode = (lng: number, lat: number): Node => ({
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
      createWay('ab', wayPointA.id, wayPointB.id, [
        wayPointA,
        createNode(5, 0),
        wayPointB,
      ]),
      createWay('bc', wayPointB.id, wayPointC.id, [
        wayPointB,
        createNode(15, 0),
        wayPointC,
      ]),
      createWay('bd', wayPointB.id, wayPointD.id, [
        wayPointB,
        createNode(10, 5),
        wayPointD,
      ]),
    ],
  };
};

const buildCycleGraph = (): Graph => {
  const wayPointA = createWayPoint('A', 0, 0);
  const wayPointB = createWayPoint('B', 10, 0);
  const wayPointC = createWayPoint('C', 20, 0);
  const wayPointD = createWayPoint('D', 20, 10);
  const wayPointE = createWayPoint('E', 10, 10);

  return {
    wayPointList: [wayPointA, wayPointB, wayPointC, wayPointD, wayPointE],
    wayList: [
      createWay('ab', wayPointA.id, wayPointB.id, [wayPointA, wayPointB]),
      createWay('bc', wayPointB.id, wayPointC.id, [wayPointB, wayPointC]),
      createWay('cd', wayPointC.id, wayPointD.id, [wayPointC, wayPointD]),
      createWay('de', wayPointD.id, wayPointE.id, [wayPointD, wayPointE]),
      createWay('ec', wayPointE.id, wayPointC.id, [wayPointE, wayPointC]),
    ],
  };
};

const buildAmbiguousGraph = (): Graph => {
  const wayPointA = createWayPoint('A', 0, 0);
  const wayPointB = createWayPoint('B', 10, 0);
  const wayPointC = createWayPoint('C', 20, 0);
  const wayPointD = createWayPoint('D', 10, 10);

  return {
    wayPointList: [wayPointA, wayPointB, wayPointC, wayPointD],
    wayList: [
      createWay('ab', wayPointA.id, wayPointB.id, [wayPointA, wayPointB]),
      createWay('bc', wayPointB.id, wayPointC.id, [wayPointB, wayPointC]),
      createWay('ad', wayPointA.id, wayPointD.id, [wayPointA, wayPointD]),
      createWay('dc', wayPointD.id, wayPointC.id, [wayPointD, wayPointC]),
    ],
  };
};

const buildPolylineGraph = (): Graph => {
  const wayPointA = createWayPoint('A', 0, 0);
  const wayPointB = createWayPoint('B', 8, 6);

  return {
    wayPointList: [wayPointA, wayPointB],
    wayList: [
      createWay('ab', wayPointA.id, wayPointB.id, [
        wayPointA,
        createNode(0, 6),
        wayPointB,
      ]),
    ],
  };
};

describe('logical-graph geometry', () => {
  it('resolves a unique path across multiple ways', () => {
    const geometry = createGraphGeometry(buildBranchGraph());
    const path = resolveGraphPath(geometry, 'A', 'C');

    expect(path.traversalList.map((traversal) => traversal.wayId)).toEqual([
      'ab',
      'bc',
    ]);
    expect(path.totalLength).toBeCloseTo(20, 6);
    expect(path.traversalList[0]?.startDistance).toBeCloseTo(0, 6);
    expect(path.traversalList[0]?.endDistance).toBeCloseTo(10, 6);
    expect(path.traversalList[1]?.startDistance).toBeCloseTo(10, 6);
    expect(path.traversalList[1]?.endDistance).toBeCloseTo(20, 6);

    const position = resolveGraphPosition(geometry, {
      fromWayPointId: 'A',
      toWayPointId: 'C',
      ratio: 0.75,
    });

    expect(position.lng).toBeCloseTo(15, 6);
    expect(position.lat).toBeCloseTo(0, 6);
  });

  it('resolves reverse traversal along the same path', () => {
    const geometry = createGraphGeometry(buildBranchGraph());

    const position = resolveGraphPosition(geometry, {
      fromWayPointId: 'C',
      toWayPointId: 'A',
      ratio: 0.25,
    });

    expect(position.lng).toBeCloseTo(15, 6);
    expect(position.lat).toBeCloseTo(0, 6);
  });

  it('keeps resolving unique paths even when the graph contains a cycle', () => {
    const geometry = createGraphGeometry(buildCycleGraph());
    const path = resolveGraphPath(geometry, 'A', 'C');

    expect(path.traversalList.map((traversal) => traversal.wayId)).toEqual([
      'ab',
      'bc',
    ]);

    const position = resolveGraphPosition(geometry, {
      fromWayPointId: 'A',
      toWayPointId: 'C',
      ratio: 0.5,
    });

    expect(position.lng).toBeCloseTo(10, 6);
    expect(position.lat).toBeCloseTo(0, 6);
  });

  it('uses cumulative segment lengths inside a way polyline', () => {
    const geometry = createGraphGeometry(buildPolylineGraph());

    const position = resolveGraphPosition(geometry, {
      fromWayPointId: 'A',
      toWayPointId: 'B',
      ratio: 0.5,
    });

    expect(position.lng).toBeCloseTo(1, 6);
    expect(position.lat).toBeCloseTo(6, 6);
  });

  it('clamps out-of-range ratios to path endpoints', () => {
    const geometry = createGraphGeometry(buildBranchGraph());

    const beforeStart = resolveGraphPosition(geometry, {
      fromWayPointId: 'A',
      toWayPointId: 'C',
      ratio: -1,
    });
    const afterEnd = resolveGraphPosition(geometry, {
      fromWayPointId: 'A',
      toWayPointId: 'C',
      ratio: 2,
    });

    expect(beforeStart.lng).toBeCloseTo(0, 6);
    expect(beforeStart.lat).toBeCloseTo(0, 6);
    expect(afterEnd.lng).toBeCloseTo(20, 6);
    expect(afterEnd.lat).toBeCloseTo(0, 6);
  });

  it('rejects ambiguous paths between the same way points', () => {
    const geometry = createGraphGeometry(buildAmbiguousGraph());

    expect(() => resolveGraphPath(geometry, 'A', 'C')).toThrow(/ambiguous/i);
    expect(() =>
      resolveGraphPosition(geometry, {
        fromWayPointId: 'A',
        toWayPointId: 'C',
        ratio: 0.5,
      })
    ).toThrow(/ambiguous/i);
  });

  it('lists simple paths between ambiguous endpoints with optional truncation', () => {
    const geometry = createGraphGeometry(buildAmbiguousGraph());
    const result = listGraphPaths(geometry, 'A', 'C', {
      limit: 1,
    });

    expect(result.truncated).toBe(true);
    expect(result.paths).toHaveLength(1);
    expect(
      result.paths[0]?.traversalList.map((traversal) => traversal.wayId)
    ).toEqual(['ab', 'bc']);
  });

  it('can sort listed paths by total length', () => {
    const wayPointA = createWayPoint('A', 0, 0);
    const wayPointB = createWayPoint('B', 10, 0);
    const wayPointC = createWayPoint('C', 20, 0);
    const wayPointD = createWayPoint('D', 10, 10);
    const geometry = createGraphGeometry({
      wayPointList: [wayPointA, wayPointB, wayPointC, wayPointD],
      wayList: [
        createWay('ad', wayPointA.id, wayPointD.id, [wayPointA, wayPointD]),
        createWay('dc', wayPointD.id, wayPointC.id, [wayPointD, wayPointC]),
        createWay('ab', wayPointA.id, wayPointB.id, [wayPointA, wayPointB]),
        createWay('bc', wayPointB.id, wayPointC.id, [wayPointB, wayPointC]),
      ],
    });
    const result = listGraphPaths(geometry, 'A', 'C', {
      sort: 'total-length-asc',
    });

    expect(result.truncated).toBe(false);
    expect(result.paths).toHaveLength(2);
    expect(result.paths[0]?.totalLength).toBeLessThan(
      result.paths[1]?.totalLength ?? Number.POSITIVE_INFINITY
    );
    expect(
      result.paths[0]?.traversalList.map((traversal) => traversal.wayId)
    ).toEqual(['ab', 'bc']);
    expect(
      result.paths[1]?.traversalList.map((traversal) => traversal.wayId)
    ).toEqual(['ad', 'dc']);
  });

  it('rejects duplicate direct connections between the same way points', () => {
    const wayPointA = createWayPoint('A', 0, 0);
    const wayPointB = createWayPoint('B', 10, 0);

    const graph: Graph = {
      wayPointList: [wayPointA, wayPointB],
      wayList: [
        createWay('ab-0', wayPointA.id, wayPointB.id, [wayPointA, wayPointB]),
        createWay('ab-1', wayPointB.id, wayPointA.id, [wayPointB, wayPointA]),
      ],
    };

    expect(() => createGraphGeometry(graph)).toThrow(/direct connection/i);
  });

  it('rejects ways whose endpoints do not match their way points', () => {
    const wayPointA = createWayPoint('A', 0, 0);
    const wayPointB = createWayPoint('B', 10, 0);

    const graph: Graph = {
      wayPointList: [wayPointA, wayPointB],
      wayList: [
        createWay('ab', wayPointA.id, wayPointB.id, [
          wayPointA,
          createNode(5, 0),
          createNode(9, 0),
        ]),
      ],
    };

    expect(() => createGraphGeometry(graph)).toThrow(/end node/i);
  });
});
