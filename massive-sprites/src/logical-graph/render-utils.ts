// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import type {
  GraphGeometry,
  GraphPolylinePlacementEntry,
  GraphWayGeometry,
  GraphWayPointSpritePlacementEntry,
  WayPoint,
} from './types';
import type { PolylinePlacement, SpritePlacement } from '../types';

///////////////////////////////////////////////////////////////////////////////////

/**
 * Builds one polyline placement per way in graph order.
 *
 * @typeParam TPolylinePlacement - Concrete placement type produced by the caller.
 * @param geometry - Indexed graph geometry.
 * @param factory - Factory invoked once for each way geometry.
 * @returns Placement entries in the same order as `geometry.graph.wayList`.
 */
export const buildGraphPolylinePlacements = <
  TPolylinePlacement extends PolylinePlacement,
>(
  geometry: GraphGeometry,
  factory: (wayGeometry: GraphWayGeometry, index: number) => TPolylinePlacement
): GraphPolylinePlacementEntry<TPolylinePlacement>[] => {
  return geometry.graph.wayList.map((way, index) => {
    const wayGeometry = geometry.wayGeometryById.get(way.id);
    if (!wayGeometry) {
      throw new Error(`Unknown way id: ${way.id}`);
    }
    return {
      wayId: way.id,
      placement: factory(wayGeometry, index),
    };
  });
};

/**
 * Builds one sprite placement per waypoint in graph order.
 *
 * @typeParam TSpritePlacement - Concrete placement type produced by the caller.
 * @param geometry - Indexed graph geometry.
 * @param factory - Factory invoked once for each waypoint.
 * @returns Placement entries in the same order as `geometry.graph.wayPointList`.
 */
export const buildGraphWayPointSpritePlacements = <
  TSpritePlacement extends SpritePlacement,
>(
  geometry: GraphGeometry,
  factory: (wayPoint: WayPoint, index: number) => TSpritePlacement
): GraphWayPointSpritePlacementEntry<TSpritePlacement>[] => {
  return geometry.graph.wayPointList.map((wayPoint, index) => ({
    wayPointId: wayPoint.id,
    placement: factory(wayPoint, index),
  }));
};
