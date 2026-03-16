// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

// @vitest-environment node

import { describe, expect, it } from 'vitest';
import type { Graph, Node, Way, WayPoint } from '../../src/logical-graph';
import {
  buildGraphPolylinePlacements,
  buildGraphWayPointSpritePlacements,
  createGraphGeometry,
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

const buildGraph = (): Graph => {
  const wayPointA = createWayPoint('A', 0, 0);
  const wayPointB = createWayPoint('B', 10, 0);
  const wayPointC = createWayPoint('C', 10, 10);

  return {
    wayPointList: [wayPointA, wayPointB, wayPointC],
    wayList: [
      createWay('ab', wayPointA.id, wayPointB.id, [
        wayPointA,
        createNode(5, 0),
        wayPointB,
      ]),
      createWay('bc', wayPointB.id, wayPointC.id, [
        wayPointB,
        createNode(10, 5),
        wayPointC,
      ]),
    ],
  };
};

describe('logical-graph render utils', () => {
  it('builds a polyline placement for each way without flattening the graph', () => {
    const geometry = createGraphGeometry(buildGraph());
    const entries = buildGraphPolylinePlacements(
      geometry,
      (wayGeometry, index) => ({
        nodes: wayGeometry.nodeList.map((node) => ({
          x: node.lng,
          y: node.lat,
          thickness: index + 1,
        })),
        color: '#112233',
        layer: index,
      })
    );

    expect(entries.map((entry) => entry.wayId)).toEqual(['ab', 'bc']);
    expect(entries[0]?.placement.nodes.map((node) => [node.x, node.y])).toEqual(
      [
        [0, 0],
        [5, 0],
        [10, 0],
      ]
    );
    expect(entries[1]?.placement.nodes.map((node) => [node.x, node.y])).toEqual(
      [
        [10, 0],
        [10, 5],
        [10, 10],
      ]
    );
  });

  it('builds a sprite placement for each waypoint', () => {
    const geometry = createGraphGeometry(buildGraph());
    const entries = buildGraphWayPointSpritePlacements(
      geometry,
      (wayPoint, index) => ({
        sx: { value: wayPoint.lng },
        sy: { value: wayPoint.lat },
        elements: [
          {
            imageId: `marker-${index}.png`,
            mode: 'billboard',
          },
        ],
      })
    );

    expect(entries.map((entry) => entry.wayPointId)).toEqual(['A', 'B', 'C']);
    expect(entries[2]?.placement.sx.value).toBeCloseTo(10, 6);
    expect(entries[2]?.placement.sy.value).toBeCloseTo(10, 6);
    expect(entries[2]?.placement.elements[0]?.imageId).toBe('marker-2.png');
  });
});
