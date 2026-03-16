// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  Graph,
  GraphGeometry,
  GraphIncidentWay,
  GraphMotionPath,
  GraphMotionPathSegment,
  GraphPath,
  GraphPathSearchOptions,
  GraphPathSearchResult,
  GraphPathTraversal,
  GraphPosition,
  GraphWayGeometry,
  Node,
  ResolvedGraphPosition,
  Way,
  WayPoint,
} from './types';

///////////////////////////////////////////////////////////////////////////////////

const graphPathCacheMap = new WeakMap<GraphGeometry, Map<string, GraphPath>>();
const DISTANCE_EPSILON = 1e-9;
const MOTION_START_NODE_ID = '\u0001graph-motion-start';
const MOTION_END_NODE_ID = '\u0001graph-motion-end';

type PendingGraphTraversal = Omit<
  GraphPathTraversal,
  'startDistance' | 'endDistance'
>;

interface GraphPathLocation {
  readonly traversal: GraphPathTraversal;
  readonly traversalIndex: number;
  readonly wayGeometry: GraphWayGeometry;
  readonly distanceOnTraversal: number;
}

interface MotionAdjacencyEdge {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly wayId: string;
  readonly startDistanceOnWay: number;
  readonly endDistanceOnWay: number;
  readonly length: number;
}

interface WaySplitPoint {
  readonly nodeId: string;
  readonly distanceOnWay: number;
}

///////////////////////////////////////////////////////////////////////////////////

const clampRatio = (ratio: number) =>
  Math.min(1, Math.max(0, Number.isFinite(ratio) ? ratio : 0));

const normalizePathSearchLimit = (limit: number | undefined) => {
  if (limit === undefined) {
    return Number.POSITIVE_INFINITY;
  }
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error('Path search limit must be a positive integer.');
  }
  return limit;
};

const isGraphWayPointPosition = (
  position: GraphPosition
): position is Extract<GraphPosition, { wayPointId: string }> =>
  'wayPointId' in position;

const isGraphWayPosition = (
  position: GraphPosition
): position is Extract<GraphPosition, { wayId: string; ratio: number }> =>
  'wayId' in position;

const measureDistance = (from: Node, to: Node) =>
  Math.hypot(to.lng - from.lng, to.lat - from.lat);

const isSameCoordinate = (left: Node, right: Node) =>
  left.lng === right.lng && left.lat === right.lat;

const createPairKey = (leftWayPointId: string, rightWayPointId: string) =>
  [leftWayPointId, rightWayPointId].sort().join('\u0000');

const createPathKey = (fromWayPointId: string, toWayPointId: string) =>
  `${fromWayPointId}\u0000${toWayPointId}`;

const getGraphPathCache = (geometry: GraphGeometry) => {
  let cache = graphPathCacheMap.get(geometry);
  if (!cache) {
    cache = new Map<string, GraphPath>();
    graphPathCacheMap.set(geometry, cache);
  }
  return cache;
};

const assertFiniteNode = (node: Node, label: string) => {
  if (!Number.isFinite(node.lng) || !Number.isFinite(node.lat)) {
    throw new Error(`${label} must have finite coordinates.`);
  }
};

const resolveWayPoint = (
  wayPointById: ReadonlyMap<string, WayPoint>,
  wayPointId: string
) => {
  const wayPoint = wayPointById.get(wayPointId);
  if (!wayPoint) {
    throw new Error(`Unknown way point id: ${wayPointId}`);
  }
  return wayPoint;
};

const resolveWayGeometry = (geometry: GraphGeometry, wayId: string) => {
  const wayGeometry = geometry.wayGeometryById.get(wayId);
  if (!wayGeometry) {
    throw new Error(`Unknown way id: ${wayId}`);
  }
  return wayGeometry;
};

const buildWayLengths = (nodes: readonly Node[]) => {
  const segmentLengths: number[] = [];
  const cumulativeLengths: number[] = [0];
  let totalLength = 0;

  for (let index = 0; index < nodes.length - 1; index += 1) {
    const from = nodes[index];
    const to = nodes[index + 1];
    if (!from || !to) {
      continue;
    }
    const length = measureDistance(from, to);
    segmentLengths.push(length);
    totalLength += length;
    cumulativeLengths.push(totalLength);
  }

  return {
    segmentLengths,
    cumulativeLengths,
    totalLength,
  };
};

const findSegmentIndex = (
  cumulativeLengths: readonly number[],
  distance: number
) => {
  const lastIndex = Math.max(0, cumulativeLengths.length - 2);
  let low = 0;
  let high = lastIndex;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const start = cumulativeLengths[mid] ?? 0;
    const end = cumulativeLengths[mid + 1] ?? start;

    if (distance < start) {
      high = mid - 1;
    } else if (distance > end) {
      low = mid + 1;
    } else {
      return mid;
    }
  }

  if (low < 0) {
    return 0;
  }
  return Math.min(low, lastIndex);
};

const resolveWayPositionAtDistance = (
  wayGeometry: GraphWayGeometry,
  distance: number
): Node => {
  const nodes = wayGeometry.nodeList;
  if (nodes.length === 0) {
    return { lat: 0, lng: 0 };
  }
  if (nodes.length === 1 || wayGeometry.totalLength <= 0) {
    return nodes[0]!;
  }

  const cappedDistance = Math.min(
    Math.max(distance, 0),
    wayGeometry.totalLength
  );
  const segmentIndex = findSegmentIndex(
    wayGeometry.cumulativeLengths,
    cappedDistance
  );
  const startNode = nodes[segmentIndex]!;
  const endNode = nodes[segmentIndex + 1] ?? startNode;
  const segmentLength = wayGeometry.segmentLengths[segmentIndex] ?? 0;

  if (segmentLength <= 0) {
    return startNode;
  }

  const startDistance = wayGeometry.cumulativeLengths[segmentIndex] ?? 0;
  const t = (cappedDistance - startDistance) / segmentLength;

  return {
    lat: startNode.lat + (endNode.lat - startNode.lat) * t,
    lng: startNode.lng + (endNode.lng - startNode.lng) * t,
  };
};

const buildPathTraversalList = (
  fromWayPointId: string,
  toWayPointId: string,
  traversals: readonly PendingGraphTraversal[]
): GraphPath => {
  let totalLength = 0;
  const traversalList = traversals.map((traversal) => {
    const startDistance = totalLength;
    totalLength += traversal.length;
    return {
      ...traversal,
      startDistance,
      endDistance: totalLength,
    };
  });

  return {
    fromWayPointId,
    toWayPointId,
    traversalList,
    totalLength,
  };
};

const validateWay = (
  way: Way,
  wayPointById: ReadonlyMap<string, WayPoint>,
  directPairKeys: Set<string>
): GraphWayGeometry => {
  if (way.fromWayPointId === way.toWayPointId) {
    throw new Error(`Way ${way.id} must connect distinct way points.`);
  }

  const fromWayPoint = resolveWayPoint(wayPointById, way.fromWayPointId);
  const toWayPoint = resolveWayPoint(wayPointById, way.toWayPointId);

  if (way.nodeList.length < 2) {
    throw new Error(`Way ${way.id} must contain at least 2 nodes.`);
  }

  way.nodeList.forEach((node, index) => {
    assertFiniteNode(node, `Way ${way.id} node ${index}`);
  });

  const firstNode = way.nodeList[0];
  const lastNode = way.nodeList[way.nodeList.length - 1];

  if (!firstNode || !isSameCoordinate(firstNode, fromWayPoint)) {
    throw new Error(
      `Way ${way.id} start node must match way point ${way.fromWayPointId}.`
    );
  }
  if (!lastNode || !isSameCoordinate(lastNode, toWayPoint)) {
    throw new Error(
      `Way ${way.id} end node must match way point ${way.toWayPointId}.`
    );
  }

  const directPairKey = createPairKey(way.fromWayPointId, way.toWayPointId);
  if (directPairKeys.has(directPairKey)) {
    throw new Error(
      `Way ${way.id} duplicates a direct connection between ${way.fromWayPointId} and ${way.toWayPointId}.`
    );
  }
  directPairKeys.add(directPairKey);

  const lengths = buildWayLengths(way.nodeList);
  if (!Number.isFinite(lengths.totalLength) || lengths.totalLength <= 0) {
    throw new Error(`Way ${way.id} must have positive length.`);
  }

  return {
    wayId: way.id,
    fromWayPointId: way.fromWayPointId,
    toWayPointId: way.toWayPointId,
    nodeList: way.nodeList,
    segmentLengths: lengths.segmentLengths,
    cumulativeLengths: lengths.cumulativeLengths,
    totalLength: lengths.totalLength,
  };
};

const searchPendingGraphPaths = (
  geometry: GraphGeometry,
  fromWayPointId: string,
  toWayPointId: string,
  maxMatches: number
) => {
  const matches: PendingGraphTraversal[][] = [];
  const visitedWayPointIds = new Set<string>([fromWayPointId]);
  const pendingTraversals: PendingGraphTraversal[] = [];

  const visit = (currentWayPointId: string) => {
    if (matches.length >= maxMatches) {
      return;
    }
    if (currentWayPointId === toWayPointId) {
      matches.push([...pendingTraversals]);
      return;
    }

    const incidentWays =
      geometry.adjacencyByWayPointId.get(currentWayPointId) ?? [];
    for (const incidentWay of incidentWays) {
      if (matches.length >= maxMatches) {
        return;
      }
      if (visitedWayPointIds.has(incidentWay.toWayPointId)) {
        continue;
      }
      const wayGeometry = resolveWayGeometry(geometry, incidentWay.wayId);
      pendingTraversals.push({
        wayId: incidentWay.wayId,
        fromWayPointId: incidentWay.fromWayPointId,
        toWayPointId: incidentWay.toWayPointId,
        length: wayGeometry.totalLength,
      });
      visitedWayPointIds.add(incidentWay.toWayPointId);
      visit(incidentWay.toWayPointId);
      visitedWayPointIds.delete(incidentWay.toWayPointId);
      pendingTraversals.pop();
    }
  };

  visit(fromWayPointId);
  return matches;
};

const resolveGraphPathLocation = (
  geometry: GraphGeometry,
  graphPath: GraphPath,
  distance: number
): GraphPathLocation | undefined => {
  if (graphPath.traversalList.length === 0) {
    return undefined;
  }

  const cappedDistance = Math.min(Math.max(distance, 0), graphPath.totalLength);
  for (
    let traversalIndex = 0;
    traversalIndex < graphPath.traversalList.length;
    traversalIndex += 1
  ) {
    const traversal = graphPath.traversalList[traversalIndex]!;
    const isLastTraversal =
      traversalIndex === graphPath.traversalList.length - 1;
    if (cappedDistance > traversal.endDistance && !isLastTraversal) {
      continue;
    }
    return {
      traversal,
      traversalIndex,
      wayGeometry: resolveWayGeometry(geometry, traversal.wayId),
      distanceOnTraversal: Math.min(
        Math.max(cappedDistance - traversal.startDistance, 0),
        traversal.length
      ),
    };
  }

  return undefined;
};

const isDistanceZero = (distance: number) =>
  Math.abs(distance) <= DISTANCE_EPSILON;

const isSameResolvedPosition = (
  fromPosition: ResolvedGraphPosition,
  toPosition: ResolvedGraphPosition
) => {
  if (
    fromPosition.kind === 'wayPoint' &&
    toPosition.kind === 'wayPoint' &&
    fromPosition.wayPointId === toPosition.wayPointId
  ) {
    return true;
  }
  if (
    fromPosition.kind === 'way' &&
    toPosition.kind === 'way' &&
    fromPosition.wayId === toPosition.wayId &&
    isDistanceZero(fromPosition.distanceOnWay - toPosition.distanceOnWay)
  ) {
    return true;
  }
  return false;
};

const getDistanceOnWayForResolvedPosition = (
  wayGeometry: GraphWayGeometry,
  position: ResolvedGraphPosition
) => {
  if (position.kind === 'way' && position.wayId === wayGeometry.wayId) {
    return position.distanceOnWay;
  }
  if (position.kind === 'wayPoint') {
    if (position.wayPointId === wayGeometry.fromWayPointId) {
      return 0;
    }
    if (position.wayPointId === wayGeometry.toWayPointId) {
      return wayGeometry.totalLength;
    }
  }
  return undefined;
};

const buildMotionPath = (
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

const buildZeroMotionPath = (
  from: ResolvedGraphPosition,
  to: ResolvedGraphPosition
): GraphMotionPath => ({
  from,
  to,
  segmentList: [],
  totalLength: 0,
});

const tryResolveDirectMotionPath = (
  geometry: GraphGeometry,
  from: ResolvedGraphPosition,
  to: ResolvedGraphPosition
) => {
  if (isSameResolvedPosition(from, to)) {
    return buildZeroMotionPath(from, to);
  }

  const candidateWayIds = new Set<string>();
  if (from.kind === 'way') {
    candidateWayIds.add(from.wayId);
  }
  if (to.kind === 'way') {
    candidateWayIds.add(to.wayId);
  }

  for (const wayId of candidateWayIds) {
    const wayGeometry = resolveWayGeometry(geometry, wayId);
    const fromDistanceOnWay = getDistanceOnWayForResolvedPosition(
      wayGeometry,
      from
    );
    const toDistanceOnWay = getDistanceOnWayForResolvedPosition(
      wayGeometry,
      to
    );
    if (fromDistanceOnWay === undefined || toDistanceOnWay === undefined) {
      continue;
    }
    const length = Math.abs(toDistanceOnWay - fromDistanceOnWay);
    if (isDistanceZero(length)) {
      return buildZeroMotionPath(from, to);
    }
    return buildMotionPath(from, to, [
      {
        wayId,
        startDistanceOnWay: fromDistanceOnWay,
        endDistanceOnWay: toDistanceOnWay,
        length,
      },
    ]);
  }

  return undefined;
};

const addMotionAdjacencyEdge = (
  adjacencyMap: Map<string, MotionAdjacencyEdge[]>,
  fromNodeId: string,
  toNodeId: string,
  wayId: string,
  startDistanceOnWay: number,
  endDistanceOnWay: number
) => {
  const length = Math.abs(endDistanceOnWay - startDistanceOnWay);
  if (isDistanceZero(length)) {
    return;
  }
  const edge: MotionAdjacencyEdge = {
    fromNodeId,
    toNodeId,
    wayId,
    startDistanceOnWay,
    endDistanceOnWay,
    length,
  };
  const existing = adjacencyMap.get(fromNodeId);
  if (existing) {
    existing.push(edge);
  } else {
    adjacencyMap.set(fromNodeId, [edge]);
  }
};

const buildMotionAdjacencyMap = (
  geometry: GraphGeometry,
  from: ResolvedGraphPosition,
  to: ResolvedGraphPosition
) => {
  const splitPointsByWayId = new Map<string, WaySplitPoint[]>();
  const pushSplitPoint = (wayId: string, splitPoint: WaySplitPoint) => {
    const existing = splitPointsByWayId.get(wayId);
    if (existing) {
      existing.push(splitPoint);
    } else {
      splitPointsByWayId.set(wayId, [splitPoint]);
    }
  };

  if (from.kind === 'way') {
    pushSplitPoint(from.wayId, {
      nodeId: MOTION_START_NODE_ID,
      distanceOnWay: from.distanceOnWay,
    });
  }
  if (to.kind === 'way') {
    pushSplitPoint(to.wayId, {
      nodeId: MOTION_END_NODE_ID,
      distanceOnWay: to.distanceOnWay,
    });
  }

  const adjacencyMap = new Map<string, MotionAdjacencyEdge[]>();
  geometry.wayGeometryById.forEach((wayGeometry) => {
    const splitPoints = [
      ...(splitPointsByWayId.get(wayGeometry.wayId) ?? []),
    ].sort((left, right) => left.distanceOnWay - right.distanceOnWay);
    const points: WaySplitPoint[] = [
      {
        nodeId: wayGeometry.fromWayPointId,
        distanceOnWay: 0,
      },
      ...splitPoints,
      {
        nodeId: wayGeometry.toWayPointId,
        distanceOnWay: wayGeometry.totalLength,
      },
    ];

    for (let index = 0; index < points.length - 1; index += 1) {
      const fromPoint = points[index]!;
      const toPoint = points[index + 1]!;
      addMotionAdjacencyEdge(
        adjacencyMap,
        fromPoint.nodeId,
        toPoint.nodeId,
        wayGeometry.wayId,
        fromPoint.distanceOnWay,
        toPoint.distanceOnWay
      );
      addMotionAdjacencyEdge(
        adjacencyMap,
        toPoint.nodeId,
        fromPoint.nodeId,
        wayGeometry.wayId,
        toPoint.distanceOnWay,
        fromPoint.distanceOnWay
      );
    }
  });

  return adjacencyMap;
};

const searchPendingMotionEdges = (
  adjacencyMap: ReadonlyMap<string, readonly MotionAdjacencyEdge[]>,
  fromNodeId: string,
  toNodeId: string
) => {
  const matches: MotionAdjacencyEdge[][] = [];
  const visitedNodeIds = new Set<string>([fromNodeId]);
  const pendingEdges: MotionAdjacencyEdge[] = [];

  const visit = (currentNodeId: string) => {
    if (matches.length > 1) {
      return;
    }
    if (currentNodeId === toNodeId) {
      matches.push([...pendingEdges]);
      return;
    }

    const edges = adjacencyMap.get(currentNodeId) ?? [];
    for (const edge of edges) {
      if (matches.length > 1) {
        return;
      }
      if (visitedNodeIds.has(edge.toNodeId)) {
        continue;
      }
      pendingEdges.push(edge);
      visitedNodeIds.add(edge.toNodeId);
      visit(edge.toNodeId);
      visitedNodeIds.delete(edge.toNodeId);
      pendingEdges.pop();
    }
  };

  visit(fromNodeId);
  return matches;
};

const resolveGraphMotionPathFromResolvedPositions = (
  geometry: GraphGeometry,
  from: ResolvedGraphPosition,
  to: ResolvedGraphPosition
) => {
  const directMotionPath = tryResolveDirectMotionPath(geometry, from, to);
  if (directMotionPath) {
    return directMotionPath;
  }

  const adjacencyMap = buildMotionAdjacencyMap(geometry, from, to);
  const fromNodeId =
    from.kind === 'wayPoint' ? from.wayPointId : MOTION_START_NODE_ID;
  const toNodeId = to.kind === 'wayPoint' ? to.wayPointId : MOTION_END_NODE_ID;
  const pendingEdges = searchPendingMotionEdges(
    adjacencyMap,
    fromNodeId,
    toNodeId
  );

  if (pendingEdges.length === 0) {
    throw new Error(
      'No motion path could be resolved between graph positions.'
    );
  }
  if (pendingEdges.length > 1) {
    throw new Error('Motion path between graph positions is ambiguous.');
  }

  return buildMotionPath(
    from,
    to,
    pendingEdges[0]!.map((edge) => ({
      wayId: edge.wayId,
      startDistanceOnWay: edge.startDistanceOnWay,
      endDistanceOnWay: edge.endDistanceOnWay,
      length: edge.length,
    }))
  );
};

///////////////////////////////////////////////////////////////////////////////////

/**
 * Validates a graph and builds lookup-oriented geometry caches used by the rest
 * of the logical-graph API.
 *
 * @param graph - Graph to validate and index.
 * @returns Precomputed geometry and adjacency caches.
 *
 * @remarks
 * Validation rejects duplicate ids, non-finite coordinates, ways whose
 * endpoints do not match their waypoint ids, zero-length ways, and duplicate
 * direct connections between the same waypoint pair.
 */
export const createGraphGeometry = (graph: Graph): GraphGeometry => {
  const wayPointById = new Map<string, WayPoint>();
  const wayGeometryById = new Map<string, GraphWayGeometry>();
  const adjacencyByWayPointId = new Map<string, GraphIncidentWay[]>();
  const directPairKeys = new Set<string>();

  graph.wayPointList.forEach((wayPoint) => {
    if (wayPointById.has(wayPoint.id)) {
      throw new Error(`Duplicated way point id: ${wayPoint.id}`);
    }
    assertFiniteNode(wayPoint, `Way point ${wayPoint.id}`);
    wayPointById.set(wayPoint.id, wayPoint);
    adjacencyByWayPointId.set(wayPoint.id, []);
  });

  graph.wayList.forEach((way) => {
    if (wayGeometryById.has(way.id)) {
      throw new Error(`Duplicated way id: ${way.id}`);
    }
    const wayGeometry = validateWay(way, wayPointById, directPairKeys);
    wayGeometryById.set(way.id, wayGeometry);
    adjacencyByWayPointId.get(way.fromWayPointId)?.push({
      wayId: way.id,
      fromWayPointId: way.fromWayPointId,
      toWayPointId: way.toWayPointId,
    });
    adjacencyByWayPointId.get(way.toWayPointId)?.push({
      wayId: way.id,
      fromWayPointId: way.toWayPointId,
      toWayPointId: way.fromWayPointId,
    });
  });

  return {
    graph,
    wayPointById,
    wayGeometryById,
    adjacencyByWayPointId,
  };
};

/**
 * Resolves the unique directed path between two waypoints.
 *
 * @param geometry - Indexed graph geometry.
 * @param fromWayPointId - Waypoint id at the start of the path.
 * @param toWayPointId - Waypoint id at the end of the path.
 * @returns Unique directed path between the given waypoints.
 *
 * @remarks
 * Throws when no path exists or when multiple simple paths make the result
 * ambiguous.
 */
export const resolveGraphPath = (
  geometry: GraphGeometry,
  fromWayPointId: string,
  toWayPointId: string
): GraphPath => {
  if (fromWayPointId === toWayPointId) {
    throw new Error('Path endpoints must be different way points.');
  }

  resolveWayPoint(geometry.wayPointById, fromWayPointId);
  resolveWayPoint(geometry.wayPointById, toWayPointId);

  const cache = getGraphPathCache(geometry);
  const cacheKey = createPathKey(fromWayPointId, toWayPointId);
  const cached = cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const pendingPaths = searchPendingGraphPaths(
    geometry,
    fromWayPointId,
    toWayPointId,
    2
  );

  if (pendingPaths.length === 0) {
    throw new Error(
      `No path could be resolved from ${fromWayPointId} to ${toWayPointId}.`
    );
  }
  if (pendingPaths.length > 1) {
    throw new Error(
      `Path from ${fromWayPointId} to ${toWayPointId} is ambiguous.`
    );
  }

  const graphPath = buildPathTraversalList(
    fromWayPointId,
    toWayPointId,
    pendingPaths[0]!
  );
  cache.set(cacheKey, graphPath);
  return graphPath;
};

/**
 * Enumerates simple paths between two waypoints.
 *
 * @param geometry - Indexed graph geometry.
 * @param fromWayPointId - Waypoint id at the start of each path.
 * @param toWayPointId - Waypoint id at the end of each path.
 * @param options - Optional search configuration.
 * @returns Enumerated paths and whether the result was truncated.
 *
 * @remarks
 * Only simple paths are returned, meaning the same waypoint is not revisited
 * within a single path. Use `limit` to avoid enumerating a large number of
 * paths on dense graphs.
 */
export const listGraphPaths = (
  geometry: GraphGeometry,
  fromWayPointId: string,
  toWayPointId: string,
  options?: GraphPathSearchOptions
): GraphPathSearchResult => {
  if (fromWayPointId === toWayPointId) {
    throw new Error('Path endpoints must be different way points.');
  }

  resolveWayPoint(geometry.wayPointById, fromWayPointId);
  resolveWayPoint(geometry.wayPointById, toWayPointId);

  const normalizedLimit = normalizePathSearchLimit(options?.limit);
  const searchResult = searchPendingGraphPaths(
    geometry,
    fromWayPointId,
    toWayPointId,
    Number.isFinite(normalizedLimit)
      ? normalizedLimit + 1
      : Number.POSITIVE_INFINITY
  );
  const truncated =
    Number.isFinite(normalizedLimit) && searchResult.length > normalizedLimit;
  const graphPaths = (
    truncated ? searchResult.slice(0, normalizedLimit) : searchResult
  ).map((pendingPath) =>
    buildPathTraversalList(fromWayPointId, toWayPointId, pendingPath)
  );
  const sortedPaths =
    options?.sort === 'total-length-asc'
      ? graphPaths
          .map((path, index) => ({ path, index }))
          .sort((left, right) => {
            const lengthDelta = left.path.totalLength - right.path.totalLength;
            return lengthDelta !== 0 ? lengthDelta : left.index - right.index;
          })
          .map(({ path }) => path)
      : graphPaths;

  return {
    paths: sortedPaths,
    truncated,
  };
};

/**
 * Resolves a public graph position into a concrete waypoint or point on a way.
 *
 * @param geometry - Indexed graph geometry.
 * @param position - Public graph position to resolve.
 * @returns Resolved waypoint or way position.
 *
 * @remarks
 * `GraphPathPosition` requires a unique path, while `GraphWayPosition` and
 * `GraphWayPointPosition` target an exact way or waypoint directly.
 */
export const resolveGraphPositionAddress = (
  geometry: GraphGeometry,
  position: GraphPosition
): ResolvedGraphPosition => {
  if (isGraphWayPointPosition(position)) {
    return {
      kind: 'wayPoint',
      point: resolveWayPoint(geometry.wayPointById, position.wayPointId),
      wayPointId: position.wayPointId,
    };
  }

  if (isGraphWayPosition(position)) {
    const wayGeometry = resolveWayGeometry(geometry, position.wayId);
    const ratio = clampRatio(position.ratio);
    const distanceOnWay = wayGeometry.totalLength * ratio;
    return {
      kind: 'way',
      point: resolveWayPositionAtDistance(wayGeometry, distanceOnWay),
      wayId: wayGeometry.wayId,
      fromWayPointId: wayGeometry.fromWayPointId,
      toWayPointId: wayGeometry.toWayPointId,
      distanceOnWay,
      totalWayLength: wayGeometry.totalLength,
    };
  }

  const graphPath = resolveGraphPath(
    geometry,
    position.fromWayPointId,
    position.toWayPointId
  );
  const ratio = clampRatio(position.ratio);

  if (ratio <= 0) {
    return {
      kind: 'wayPoint',
      point: resolveWayPoint(geometry.wayPointById, position.fromWayPointId),
      wayPointId: position.fromWayPointId,
    };
  }
  if (ratio >= 1) {
    return {
      kind: 'wayPoint',
      point: resolveWayPoint(geometry.wayPointById, position.toWayPointId),
      wayPointId: position.toWayPointId,
    };
  }

  const location = resolveGraphPathLocation(
    geometry,
    graphPath,
    ratio * graphPath.totalLength
  );
  if (!location) {
    throw new Error('Graph path location could not be resolved.');
  }

  if (location.distanceOnTraversal <= DISTANCE_EPSILON) {
    const point = resolveWayPoint(
      geometry.wayPointById,
      location.traversal.fromWayPointId
    );
    return {
      kind: 'wayPoint',
      point,
      wayPointId: location.traversal.fromWayPointId,
    };
  }
  if (
    location.traversal.length - location.distanceOnTraversal <=
    DISTANCE_EPSILON
  ) {
    const point = resolveWayPoint(
      geometry.wayPointById,
      location.traversal.toWayPointId
    );
    return {
      kind: 'wayPoint',
      point,
      wayPointId: location.traversal.toWayPointId,
    };
  }

  const traversedForward =
    location.wayGeometry.fromWayPointId === location.traversal.fromWayPointId &&
    location.wayGeometry.toWayPointId === location.traversal.toWayPointId;
  const distanceOnWay = traversedForward
    ? location.distanceOnTraversal
    : location.wayGeometry.totalLength - location.distanceOnTraversal;

  return {
    kind: 'way',
    point: resolveWayPositionAtDistance(location.wayGeometry, distanceOnWay),
    wayId: location.wayGeometry.wayId,
    fromWayPointId: location.wayGeometry.fromWayPointId,
    toWayPointId: location.wayGeometry.toWayPointId,
    distanceOnWay,
    totalWayLength: location.wayGeometry.totalLength,
  };
};

/**
 * Resolves a public graph position and returns only its coordinate.
 *
 * @param geometry - Indexed graph geometry.
 * @param position - Public graph position to resolve.
 * @returns Coordinate of the resolved position.
 */
export const resolveGraphPosition = (
  geometry: GraphGeometry,
  position: GraphPosition
): Node => resolveGraphPositionAddress(geometry, position).point;

/**
 * Resolves the unique motion path between two already-resolved graph positions.
 *
 * @param geometry - Indexed graph geometry.
 * @param from - Starting resolved position.
 * @param to - Ending resolved position.
 * @returns Unique motion path between the two positions.
 *
 * @remarks
 * Throws when no motion path exists or when multiple candidate motion paths are
 * possible.
 */
export const resolveGraphMotionPathBetweenResolvedPositions = (
  geometry: GraphGeometry,
  from: ResolvedGraphPosition,
  to: ResolvedGraphPosition
): GraphMotionPath =>
  resolveGraphMotionPathFromResolvedPositions(geometry, from, to);

/**
 * Resolves the unique motion path between two public graph positions.
 *
 * @param geometry - Indexed graph geometry.
 * @param fromPosition - Starting public graph position.
 * @param toPosition - Ending public graph position.
 * @returns Unique motion path between the two positions.
 *
 * @remarks
 * Public positions are resolved first, so ambiguous `GraphPathPosition`
 * endpoints also surface here as errors.
 */
export const resolveGraphMotionPath = (
  geometry: GraphGeometry,
  fromPosition: GraphPosition,
  toPosition: GraphPosition
): GraphMotionPath =>
  resolveGraphMotionPathFromResolvedPositions(
    geometry,
    resolveGraphPositionAddress(geometry, fromPosition),
    resolveGraphPositionAddress(geometry, toPosition)
  );

/**
 * Resolves a point on a motion path at the given ratio and keeps waypoint/way
 * information intact.
 *
 * @param geometry - Indexed graph geometry.
 * @param motionPath - Motion path to sample.
 * @param ratio - Relative position on the motion path.
 * @returns Resolved waypoint or way position on the motion path.
 *
 * @remarks
 * Ratios are clamped to the `[0, 1]` range. Zero-length motion paths resolve
 * directly to `motionPath.to`.
 */
export const resolveGraphMotionPathAddress = (
  geometry: GraphGeometry,
  motionPath: GraphMotionPath,
  ratio: number
): ResolvedGraphPosition => {
  if (
    motionPath.totalLength <= DISTANCE_EPSILON ||
    motionPath.segmentList.length === 0
  ) {
    return motionPath.to;
  }

  const distance = clampRatio(ratio) * motionPath.totalLength;
  for (const segment of motionPath.segmentList) {
    if (distance > segment.endDistance) {
      continue;
    }
    const localDistance = Math.min(
      Math.max(distance - segment.startDistance, 0),
      segment.length
    );
    const t =
      segment.length <= DISTANCE_EPSILON ? 0 : localDistance / segment.length;
    const distanceOnWay =
      segment.startDistanceOnWay +
      (segment.endDistanceOnWay - segment.startDistanceOnWay) * t;
    const wayGeometry = resolveWayGeometry(geometry, segment.wayId);
    if (distanceOnWay <= DISTANCE_EPSILON) {
      const point = resolveWayPoint(
        geometry.wayPointById,
        wayGeometry.fromWayPointId
      );
      return {
        kind: 'wayPoint',
        point,
        wayPointId: wayGeometry.fromWayPointId,
      };
    }
    if (wayGeometry.totalLength - distanceOnWay <= DISTANCE_EPSILON) {
      const point = resolveWayPoint(
        geometry.wayPointById,
        wayGeometry.toWayPointId
      );
      return {
        kind: 'wayPoint',
        point,
        wayPointId: wayGeometry.toWayPointId,
      };
    }
    return {
      kind: 'way',
      point: resolveWayPositionAtDistance(wayGeometry, distanceOnWay),
      wayId: wayGeometry.wayId,
      fromWayPointId: wayGeometry.fromWayPointId,
      toWayPointId: wayGeometry.toWayPointId,
      distanceOnWay,
      totalWayLength: wayGeometry.totalLength,
    };
  }

  return motionPath.to;
};

/**
 * Resolves a point on a motion path at the given ratio and returns only its
 * coordinate.
 *
 * @param geometry - Indexed graph geometry.
 * @param motionPath - Motion path to sample.
 * @param ratio - Relative position on the motion path.
 * @returns Coordinate of the sampled motion path position.
 */
export const resolveGraphMotionPathPosition = (
  geometry: GraphGeometry,
  motionPath: GraphMotionPath,
  ratio: number
): Node => resolveGraphMotionPathAddress(geometry, motionPath, ratio).point;
