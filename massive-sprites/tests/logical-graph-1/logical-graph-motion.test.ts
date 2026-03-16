// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { Graph, Node, Way, WayPoint } from '../../src/logical-graph';
import {
  createGraphGeometry,
  resolveGraphMotionPath,
  resolveGraphMotionPathAddress,
  resolveGraphMotionPathPosition,
  resolveGraphPositionAddress,
} from '../../src/logical-graph';

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

const buildSimpleGraph = (): Graph => {
  const wayPointA = createWayPoint('A', 0, 0);
  const wayPointB = createWayPoint('B', 10, 0);

  return {
    wayPointList: [wayPointA, wayPointB],
    wayList: [
      createWay('ab', wayPointA.id, wayPointB.id, [wayPointA, wayPointB]),
    ],
  };
};

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

describe('logical-graph motion', () => {
  it('resolves direct motion inside the same way', () => {
    const geometry = createGraphGeometry(buildSimpleGraph());
    const motionPath = resolveGraphMotionPath(
      geometry,
      {
        fromWayPointId: 'A',
        toWayPointId: 'B',
        ratio: 0.2,
      },
      {
        fromWayPointId: 'A',
        toWayPointId: 'B',
        ratio: 0.8,
      }
    );

    expect(motionPath.segmentList).toHaveLength(1);
    expect(motionPath.totalLength).toBeCloseTo(6, 6);

    const middle = resolveGraphMotionPathPosition(geometry, motionPath, 0.5);
    expect(middle.lng).toBeCloseTo(5, 6);
    expect(middle.lat).toBeCloseTo(0, 6);
  });

  it('resolves motion across a unique branch path from arbitrary positions', () => {
    const geometry = createGraphGeometry(buildBranchGraph());
    const motionPath = resolveGraphMotionPath(
      geometry,
      {
        fromWayPointId: 'A',
        toWayPointId: 'C',
        ratio: 0.25,
      },
      {
        fromWayPointId: 'B',
        toWayPointId: 'D',
        ratio: 0.5,
      }
    );

    expect(motionPath.segmentList.map((segment) => segment.wayId)).toEqual([
      'ab',
      'bd',
    ]);
    expect(motionPath.totalLength).toBeCloseTo(10, 6);

    const middle = resolveGraphMotionPathAddress(geometry, motionPath, 0.5);
    expect(middle.kind).toBe('wayPoint');
    if (middle.kind === 'wayPoint') {
      expect(middle.wayPointId).toBe('B');
    }
  });

  it('resolves an intermediate graph position as a waypoint when ratio lands on a joint', () => {
    const geometry = createGraphGeometry(buildBranchGraph());
    const resolved = resolveGraphPositionAddress(geometry, {
      fromWayPointId: 'A',
      toWayPointId: 'C',
      ratio: 0.5,
    });

    expect(resolved.kind).toBe('wayPoint');
    if (resolved.kind === 'wayPoint') {
      expect(resolved.wayPointId).toBe('B');
    }
  });

  it('resolves exact waypoints and specific ways even on cyclic graphs', () => {
    const geometry = createGraphGeometry(buildTriangleGraph());

    const exactWayPoint = resolveGraphPositionAddress(geometry, {
      wayPointId: 'A',
    });
    const exactWay = resolveGraphPositionAddress(geometry, {
      wayId: 'ab',
      ratio: 1,
    });
    const motionPath = resolveGraphMotionPath(
      geometry,
      {
        wayPointId: 'A',
      },
      {
        wayId: 'ab',
        ratio: 1,
      }
    );

    expect(exactWayPoint.kind).toBe('wayPoint');
    if (exactWayPoint.kind === 'wayPoint') {
      expect(exactWayPoint.wayPointId).toBe('A');
    }

    expect(exactWay.kind).toBe('way');
    if (exactWay.kind === 'way') {
      expect(exactWay.wayId).toBe('ab');
      expect(exactWay.distanceOnWay).toBeCloseTo(10, 6);
      expect(exactWay.point.lng).toBeCloseTo(10, 6);
      expect(exactWay.point.lat).toBeCloseTo(0, 6);
    }

    expect(motionPath.segmentList).toHaveLength(1);
    expect(motionPath.segmentList[0]?.wayId).toBe('ab');
    expect(motionPath.totalLength).toBeCloseTo(10, 6);
  });

  it('rejects ambiguous motion paths between arbitrary positions', () => {
    const geometry = createGraphGeometry(buildAmbiguousGraph());

    expect(() =>
      resolveGraphMotionPath(
        geometry,
        {
          fromWayPointId: 'A',
          toWayPointId: 'B',
          ratio: 0.5,
        },
        {
          fromWayPointId: 'B',
          toWayPointId: 'C',
          ratio: 0.5,
        }
      )
    ).toThrow(/ambiguous/i);
  });
});
