// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import {
  type Graph,
  type Node,
  type Way,
  type WayPoint as GraphWayPoint,
} from 'massive-sprites/logical-graph';

///////////////////////////////////////////////////////////////////////////////////

export interface WayPoint extends GraphWayPoint {
  readonly label: string;
  readonly image: string;
}

export interface RoutePoint {
  readonly x: number;
  readonly y: number;
}

export interface RouteBounds {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  readonly width: number;
  readonly height: number;
}

export interface RoutePolylineData {
  readonly id: string;
  readonly closed: boolean;
  readonly points: readonly RoutePoint[];
}

export interface RouteData {
  readonly bbox: RouteBounds;
  readonly polylines: readonly RoutePolylineData[];
}

export interface RouteGraph extends Graph {
  readonly routeWayPointList: readonly WayPoint[];
}

export interface RouteLayout {
  readonly bounds: RouteBounds;
  readonly graph: RouteGraph;
}

const WAYPOINT_IMAGE_ID = 'drop.png';
const PATH_POINT_EPSILON = 1e-6;

///////////////////////////////////////////////////////////////////////////////////

const toNode = (point: RoutePoint): Node => ({
  lat: point.y,
  lng: point.x,
});

const createRoutePoint = (x: number, y: number): RoutePoint => ({
  x,
  y,
});

const createGraphWayPoint = (id: string, point: RoutePoint): GraphWayPoint => ({
  id,
  lat: point.y,
  lng: point.x,
});

const createRouteWayPoint = (
  id: string,
  label: string,
  point: RoutePoint
): WayPoint => ({
  ...createGraphWayPoint(id, point),
  label,
  image: WAYPOINT_IMAGE_ID,
});

const cloneRoutePoint = (point: RoutePoint): RoutePoint =>
  createRoutePoint(point.x, point.y);

const normalizeRouteData = (data: RouteData): RouteData => ({
  bbox: {
    minX: 0,
    minY: 0,
    maxX: data.bbox.width,
    maxY: data.bbox.height,
    width: data.bbox.width,
    height: data.bbox.height,
  },
  polylines: data.polylines.map((polyline) => ({
    ...polyline,
    points: polyline.points.map((point) =>
      createRoutePoint(point.x - data.bbox.minX, data.bbox.maxY - point.y)
    ),
  })),
});

const isFiniteRoutePoint = (point: RoutePoint) =>
  Number.isFinite(point.x) && Number.isFinite(point.y);

const isSameRoutePoint = (lhs: RoutePoint, rhs: RoutePoint) =>
  Math.abs(lhs.x - rhs.x) <= PATH_POINT_EPSILON &&
  Math.abs(lhs.y - rhs.y) <= PATH_POINT_EPSILON;

const measureSegmentLength = (from: RoutePoint, to: RoutePoint) =>
  Math.hypot(to.x - from.x, to.y - from.y);

const interpolateRoutePoint = (
  from: RoutePoint,
  to: RoutePoint,
  ratio: number
): RoutePoint => ({
  x: from.x + (to.x - from.x) * ratio,
  y: from.y + (to.y - from.y) * ratio,
});

const buildCumulativeLengths = (points: readonly RoutePoint[]) => {
  const cumulativeLengths = [0];
  for (let index = 1; index < points.length; index += 1) {
    cumulativeLengths.push(
      cumulativeLengths[index - 1]! +
        measureSegmentLength(points[index - 1]!, points[index]!)
    );
  }
  return cumulativeLengths;
};

const resolvePointAtDistance = (
  points: readonly RoutePoint[],
  cumulativeLengths: readonly number[],
  distance: number
) => {
  const totalLength = cumulativeLengths[cumulativeLengths.length - 1] ?? 0;
  const clampedDistance = Math.min(Math.max(distance, 0), totalLength);
  if (points.length === 0) {
    throw new Error('Polyline must contain at least 1 point.');
  }
  if (clampedDistance <= 0) {
    return points[0]!;
  }
  if (clampedDistance >= totalLength) {
    return points[points.length - 1]!;
  }
  for (let index = 0; index < points.length - 1; index += 1) {
    const fromDistance = cumulativeLengths[index]!;
    const toDistance = cumulativeLengths[index + 1]!;
    if (clampedDistance > toDistance) {
      continue;
    }
    const segmentLength = toDistance - fromDistance;
    if (segmentLength <= PATH_POINT_EPSILON) {
      return points[index + 1]!;
    }
    return interpolateRoutePoint(
      points[index]!,
      points[index + 1]!,
      (clampedDistance - fromDistance) / segmentLength
    );
  }
  return points[points.length - 1]!;
};

const slicePointsByDistance = (
  points: readonly RoutePoint[],
  startDistance: number,
  endDistance: number
) => {
  if (endDistance < startDistance) {
    throw new Error('Polyline slice end distance must not be less than start.');
  }
  const cumulativeLengths = buildCumulativeLengths(points);
  const result: RoutePoint[] = [
    resolvePointAtDistance(points, cumulativeLengths, startDistance),
  ];
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = cumulativeLengths[index]!;
    if (
      distance <= startDistance + PATH_POINT_EPSILON ||
      distance >= endDistance - PATH_POINT_EPSILON
    ) {
      continue;
    }
    result.push(points[index]!);
  }
  const endPoint = resolvePointAtDistance(
    points,
    cumulativeLengths,
    endDistance
  );
  if (!isSameRoutePoint(result[result.length - 1]!, endPoint)) {
    result.push(endPoint);
  }
  return result;
};

const extractClosedForwardPath = (
  points: readonly RoutePoint[],
  startIndex: number,
  endIndex: number
) => {
  const result = [points[startIndex]!];
  let index = startIndex;
  while (index !== endIndex) {
    index = (index + 1) % points.length;
    result.push(points[index]!);
  }
  return result;
};

const extractOpenPath = (
  points: readonly RoutePoint[],
  startIndex: number,
  endIndex: number
) =>
  startIndex <= endIndex
    ? points.slice(startIndex, endIndex + 1)
    : [...points.slice(endIndex, startIndex + 1)].reverse();

const openClosedPath = (points: readonly RoutePoint[], startIndex: number) => {
  const result = [points[startIndex]!];
  for (let offset = 1; offset < points.length; offset += 1) {
    result.push(points[(startIndex + offset) % points.length]!);
  }
  result.push(points[startIndex]!);
  return result;
};

const createSnapPoint = (lhs: RoutePoint, rhs: RoutePoint) =>
  isSameRoutePoint(lhs, rhs)
    ? createRoutePoint(lhs.x, lhs.y)
    : createRoutePoint((lhs.x + rhs.x) * 0.5, (lhs.y + rhs.y) * 0.5);

const createWayNodeList = (
  points: readonly RoutePoint[],
  start: GraphWayPoint,
  end: GraphWayPoint
) => {
  if (points.length <= 2) {
    return [start, end];
  }
  return [start, ...points.slice(1, -1).map(toNode), end];
};

const createBounds = (points: readonly RoutePoint[]): RouteBounds => {
  if (points.length === 0) {
    throw new Error('Cannot create bounds from empty point list.');
  }
  let minX = points[0]!.x;
  let minY = points[0]!.y;
  let maxX = points[0]!.x;
  let maxY = points[0]!.y;
  points.forEach((point) => {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  });
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

const findNearestPointPair = (
  lhsPoints: readonly RoutePoint[],
  rhsPoints: readonly RoutePoint[]
) => {
  let lhsIndex = -1;
  let rhsIndex = -1;
  let distance = Number.POSITIVE_INFINITY;
  lhsPoints.forEach((lhsPoint, lhsCandidateIndex) => {
    rhsPoints.forEach((rhsPoint, rhsCandidateIndex) => {
      const candidateDistance = measureSegmentLength(lhsPoint, rhsPoint);
      if (candidateDistance >= distance) {
        return;
      }
      lhsIndex = lhsCandidateIndex;
      rhsIndex = rhsCandidateIndex;
      distance = candidateDistance;
    });
  });
  if (lhsIndex < 0 || rhsIndex < 0) {
    throw new Error('Failed to resolve nearest polyline point pair.');
  }
  return {
    lhsIndex,
    rhsIndex,
    distance,
  };
};

const resolvePolyline = (data: RouteData, id: string) => {
  const polyline = data.polylines.find((candidate) => candidate.id === id);
  if (!polyline) {
    throw new Error(`Missing route polyline: ${id}`);
  }
  if (polyline.points.length < 2) {
    throw new Error(`Route polyline must contain at least 2 points: ${id}`);
  }
  polyline.points.forEach((point, index) => {
    if (!isFiniteRoutePoint(point)) {
      throw new Error(`Invalid point in polyline ${id} at index ${index}.`);
    }
  });
  return polyline;
};

const findMaximumIndex = (
  points: readonly RoutePoint[],
  selector: (point: RoutePoint) => number
) => {
  let bestIndex = 0;
  let bestValue = selector(points[0]!);
  points.forEach((point, index) => {
    const candidate = selector(point);
    if (candidate > bestValue) {
      bestIndex = index;
      bestValue = candidate;
    }
  });
  return bestIndex;
};

const findMinimumIndex = (
  points: readonly RoutePoint[],
  selector: (point: RoutePoint) => number
) => {
  let bestIndex = 0;
  let bestValue = selector(points[0]!);
  points.forEach((point, index) => {
    const candidate = selector(point);
    if (candidate < bestValue) {
      bestIndex = index;
      bestValue = candidate;
    }
  });
  return bestIndex;
};

const resolveOpenedIndex = (
  startIndex: number,
  targetIndex: number,
  pointCount: number
) =>
  targetIndex >= startIndex
    ? targetIndex - startIndex
    : pointCount - startIndex + targetIndex;

const replacePathEndpoints = (
  points: readonly RoutePoint[],
  startPoint: RoutePoint,
  endPoint: RoutePoint
) => {
  const result = points.map(cloneRoutePoint);
  result[0] = cloneRoutePoint(startPoint);
  result[result.length - 1] = cloneRoutePoint(endPoint);
  return result;
};

const buildWay = (
  id: string,
  points: readonly RoutePoint[],
  fromWayPoint: GraphWayPoint,
  toWayPoint: GraphWayPoint
): Way => ({
  id,
  fromWayPointId: fromWayPoint.id,
  toWayPointId: toWayPoint.id,
  nodeList: createWayNodeList(points, fromWayPoint, toWayPoint),
});

///////////////////////////////////////////////////////////////////////////////////

export const buildRouteLayout = (data: RouteData): RouteLayout => {
  const normalizedData = normalizeRouteData(data);
  const leftLoop = resolvePolyline(normalizedData, 'path1');
  const bridge = resolvePolyline(normalizedData, 'path3');
  const rightLoop = resolvePolyline(normalizedData, 'path2');

  const leftTopIndex = findMaximumIndex(leftLoop.points, (point) => point.y);
  const leftBottomIndex = findMinimumIndex(leftLoop.points, (point) => point.y);
  const leftBridgePair = findNearestPointPair(leftLoop.points, bridge.points);
  const bridgeRightPair = findNearestPointPair(bridge.points, rightLoop.points);
  const rightEndIndex = findMaximumIndex(rightLoop.points, (point) => point.x);

  const leftTopPoint = cloneRoutePoint(leftLoop.points[leftTopIndex]!);
  const leftBottomPoint = cloneRoutePoint(leftLoop.points[leftBottomIndex]!);
  const leftJunctionPoint = createSnapPoint(
    leftLoop.points[leftBridgePair.lhsIndex]!,
    bridge.points[leftBridgePair.rhsIndex]!
  );
  const centerJunctionPoint = createSnapPoint(
    bridge.points[bridgeRightPair.lhsIndex]!,
    rightLoop.points[bridgeRightPair.rhsIndex]!
  );

  const openedRightLoop = openClosedPath(
    rightLoop.points,
    bridgeRightPair.rhsIndex
  ).map(cloneRoutePoint);
  openedRightLoop[0] = cloneRoutePoint(centerJunctionPoint);
  openedRightLoop[openedRightLoop.length - 1] =
    cloneRoutePoint(centerJunctionPoint);

  const openedRightLoopLengths = buildCumulativeLengths(openedRightLoop);
  const rightEndOpenedIndex = resolveOpenedIndex(
    bridgeRightPair.rhsIndex,
    rightEndIndex,
    rightLoop.points.length
  );
  const rightEndDistance = openedRightLoopLengths[rightEndOpenedIndex]!;
  const totalRightLoopDistance =
    openedRightLoopLengths[openedRightLoopLengths.length - 1]!;
  if (rightEndDistance <= 0 || rightEndDistance >= totalRightLoopDistance) {
    throw new Error('Invalid right loop waypoint distances.');
  }

  const upperThirdDistance = rightEndDistance / 3;
  const lowerCenterDistance =
    rightEndDistance + (totalRightLoopDistance - rightEndDistance) * 0.5;

  const upperThirdPoint = resolvePointAtDistance(
    openedRightLoop,
    openedRightLoopLengths,
    upperThirdDistance
  );
  const rightEndPoint = cloneRoutePoint(rightLoop.points[rightEndIndex]!);
  const lowerCenterPoint = resolvePointAtDistance(
    openedRightLoop,
    openedRightLoopLengths,
    lowerCenterDistance
  );

  const topWayPoint = createRouteWayPoint(
    'route-way-point-top',
    'Path1 Top',
    leftTopPoint
  );
  const leftJunctionWayPoint = createRouteWayPoint(
    'route-way-point-left-junction',
    'Path1 Path2 Junction',
    leftJunctionPoint
  );
  const centerJunctionWayPoint = createRouteWayPoint(
    'route-way-point-center-junction',
    'Path2 Path3 Junction',
    centerJunctionPoint
  );
  const upperThirdWayPoint = createRouteWayPoint(
    'route-way-point-upper-third',
    'Path3 Upper Third',
    upperThirdPoint
  );
  const rightEndWayPoint = createRouteWayPoint(
    'route-way-point-right-end',
    'Path3 Right End',
    rightEndPoint
  );
  const lowerCenterWayPoint = createRouteWayPoint(
    'route-way-point-lower-center',
    'Path3 Lower Center',
    lowerCenterPoint
  );
  const leftBottomHelperWayPoint = createGraphWayPoint(
    'route-helper-left-bottom',
    leftBottomPoint
  );

  const routeWayPointList = [
    topWayPoint,
    leftJunctionWayPoint,
    centerJunctionWayPoint,
    upperThirdWayPoint,
    rightEndWayPoint,
    lowerCenterWayPoint,
  ] as const;

  const wayPointList = [
    ...routeWayPointList,
    leftBottomHelperWayPoint,
  ] as const satisfies readonly GraphWayPoint[];

  const wayList = [
    buildWay(
      'route-way-left-top-to-bottom',
      replacePathEndpoints(
        extractClosedForwardPath(
          leftLoop.points,
          leftTopIndex,
          leftBottomIndex
        ),
        leftTopPoint,
        leftBottomPoint
      ),
      topWayPoint,
      leftBottomHelperWayPoint
    ),
    buildWay(
      'route-way-left-bottom-to-junction',
      replacePathEndpoints(
        extractClosedForwardPath(
          leftLoop.points,
          leftBottomIndex,
          leftBridgePair.lhsIndex
        ),
        leftBottomPoint,
        leftJunctionPoint
      ),
      leftBottomHelperWayPoint,
      leftJunctionWayPoint
    ),
    buildWay(
      'route-way-left-junction-to-top',
      replacePathEndpoints(
        extractClosedForwardPath(
          leftLoop.points,
          leftBridgePair.lhsIndex,
          leftTopIndex
        ),
        leftJunctionPoint,
        leftTopPoint
      ),
      leftJunctionWayPoint,
      topWayPoint
    ),
    buildWay(
      'route-way-bridge',
      replacePathEndpoints(
        extractOpenPath(
          bridge.points,
          leftBridgePair.rhsIndex,
          bridgeRightPair.lhsIndex
        ),
        leftJunctionPoint,
        centerJunctionPoint
      ),
      leftJunctionWayPoint,
      centerJunctionWayPoint
    ),
    buildWay(
      'route-way-right-junction-to-upper-third',
      replacePathEndpoints(
        slicePointsByDistance(openedRightLoop, 0, upperThirdDistance),
        centerJunctionPoint,
        upperThirdPoint
      ),
      centerJunctionWayPoint,
      upperThirdWayPoint
    ),
    buildWay(
      'route-way-right-upper-third-to-end',
      replacePathEndpoints(
        slicePointsByDistance(
          openedRightLoop,
          upperThirdDistance,
          rightEndDistance
        ),
        upperThirdPoint,
        rightEndPoint
      ),
      upperThirdWayPoint,
      rightEndWayPoint
    ),
    buildWay(
      'route-way-right-end-to-lower-center',
      replacePathEndpoints(
        slicePointsByDistance(
          openedRightLoop,
          rightEndDistance,
          lowerCenterDistance
        ),
        rightEndPoint,
        lowerCenterPoint
      ),
      rightEndWayPoint,
      lowerCenterWayPoint
    ),
    buildWay(
      'route-way-right-lower-center-to-junction',
      replacePathEndpoints(
        slicePointsByDistance(
          openedRightLoop,
          lowerCenterDistance,
          totalRightLoopDistance
        ),
        lowerCenterPoint,
        centerJunctionPoint
      ),
      lowerCenterWayPoint,
      centerJunctionWayPoint
    ),
  ] as const satisfies readonly Way[];

  const graph: RouteGraph = {
    routeWayPointList,
    wayPointList,
    wayList,
  };

  const bounds = createBounds(
    graph.wayList.flatMap((way) =>
      way.nodeList.map((node) => createRoutePoint(node.lng, node.lat))
    )
  );

  return {
    bounds,
    graph,
  };
};

export const loadRouteLayout = async (url: string): Promise<RouteLayout> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load route json: ${response.status}`);
  }
  const data = (await response.json()) as RouteData;
  return buildRouteLayout(data);
};

export const asWayPoint = (node: Node): WayPoint | undefined => {
  const candidate = node as WayPoint;
  return typeof candidate.label === 'string' &&
    typeof candidate.image === 'string'
    ? candidate
    : undefined;
};
