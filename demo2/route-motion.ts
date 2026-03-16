// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  GraphGeometry,
  GraphIncidentWay,
  GraphPath,
  GraphPosition,
} from 'massive-sprites/logical-graph';
import { listGraphPaths } from 'massive-sprites/logical-graph';

///////////////////////////////////////////////////////////////////////////////////

export interface RouteTraversalOption {
  readonly wayId: string;
  readonly fromWayPointId: string;
  readonly toWayPointId: string;
}

const clampRandom = (value: number) =>
  Math.min(1 - Number.EPSILON, Math.max(0, Number.isFinite(value) ? value : 0));

const resolveNextWayPointId = (
  currentWayPointId: string,
  incidentWay: GraphIncidentWay
) => {
  if (incidentWay.fromWayPointId === currentWayPointId) {
    return incidentWay.toWayPointId;
  }
  if (incidentWay.toWayPointId === currentWayPointId) {
    return incidentWay.fromWayPointId;
  }
  throw new Error(
    `Way point ${currentWayPointId} is not connected to way ${incidentWay.wayId}.`
  );
};

export const resolveRouteTraversalOptions = (
  geometry: GraphGeometry,
  currentWayPointId: string,
  incomingWayId: string | undefined
): readonly RouteTraversalOption[] => {
  const incidentWays = geometry.adjacencyByWayPointId.get(currentWayPointId);
  if (!incidentWays || incidentWays.length === 0) {
    throw new Error(
      `Way point ${currentWayPointId} does not connect to any way.`
    );
  }

  const forwardWays =
    incomingWayId === undefined
      ? incidentWays
      : incidentWays.filter(
          (incidentWay) => incidentWay.wayId !== incomingWayId
        );
  const candidates = forwardWays.length > 0 ? forwardWays : incidentWays;

  return candidates.map((incidentWay) => ({
    wayId: incidentWay.wayId,
    fromWayPointId: currentWayPointId,
    toWayPointId: resolveNextWayPointId(currentWayPointId, incidentWay),
  }));
};

export const pickRouteTraversalOption = (
  geometry: GraphGeometry,
  currentWayPointId: string,
  incomingWayId: string | undefined,
  randomValue: number
): RouteTraversalOption => {
  const candidates = resolveRouteTraversalOptions(
    geometry,
    currentWayPointId,
    incomingWayId
  );
  const index = Math.min(
    candidates.length - 1,
    Math.floor(clampRandom(randomValue) * candidates.length)
  );
  const candidate = candidates[index];
  if (!candidate) {
    throw new Error('Route traversal candidates are missing.');
  }
  return candidate;
};

export const createWayPointGraphPosition = (
  wayPointId: string
): GraphPosition => ({
  wayPointId,
});

export const resolveRouteTraversalPath = (
  geometry: GraphGeometry,
  traversalOption: RouteTraversalOption
): GraphPath => {
  const searchResult = listGraphPaths(
    geometry,
    traversalOption.fromWayPointId,
    traversalOption.toWayPointId
  );
  const path = searchResult.paths.find(
    (candidate) =>
      candidate.traversalList[0]?.wayId === traversalOption.wayId &&
      candidate.traversalList.length === 1
  );
  if (!path) {
    throw new Error(
      `No direct path matched way ${traversalOption.wayId} from ${traversalOption.fromWayPointId} to ${traversalOption.toWayPointId}.`
    );
  }
  return path;
};
