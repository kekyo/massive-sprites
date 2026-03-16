// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

export * from './types';
export {
  createGraphGeometry,
  listGraphPaths,
  resolveGraphMotionPath,
  resolveGraphMotionPathAddress,
  resolveGraphMotionPathBetweenResolvedPositions,
  resolveGraphMotionPathPosition,
  resolveGraphPath,
  resolveGraphPositionAddress,
  resolveGraphPosition,
} from './geometry';
export {
  buildGraphPolylinePlacements,
  buildGraphWayPointSpritePlacements,
} from './render-utils';
export { createLogicalGraphEntityManager } from './entity-manager';
