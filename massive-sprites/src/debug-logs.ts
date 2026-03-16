// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

import { toDegrees, toRadians, wrapDegrees, wrapRadians } from './utils';

declare global {
  // Enable rotation logging with: globalThis.outputRotationLog = true
  // eslint-disable-next-line no-var
  var outputRotationLog: boolean | undefined;
  // Enable verbose rotation logging with: globalThis.outputRotationLogVerbose = true
  // eslint-disable-next-line no-var
  var outputRotationLogVerbose: boolean | undefined;
  // Enable per-entry rotation logging with: globalThis.outputRotationLogEntries = true
  // eslint-disable-next-line no-var
  var outputRotationLogEntries: boolean | undefined;
  // Optional sink for rotation logs (e.g. console.log in tests).
  // eslint-disable-next-line no-var
  var rotationLogSink: ((message: string) => void) | undefined;
  // Enable element animation profiling with: globalThis.outputElementAnimProfile = true
  // eslint-disable-next-line no-var
  var outputElementAnimProfile: boolean | undefined;
  // Optional sink for element animation profiling logs.
  // eslint-disable-next-line no-var
  var elementAnimProfileSink: ((message: string) => void) | undefined;
}

interface RotationLogInput {
  viewProjection: Float32Array;
  viewMatrix?: Float32Array;
  vertices: Float32Array;
  nowMs: number;
  aspectRatio?: number;
  renderMode?: number;
  rotateDeg?: number;
  finalRotateDeg?: number;
  rotationFromDeg?: number;
  rotationToDeg?: number;
  rotationStartMs?: number;
  rotationDurationMs?: number;
  rotationT?: number;
  rotationTEased?: number;
  rotationDeltaDeg?: number;
  finalRotationFromDeg?: number;
  finalRotationToDeg?: number;
  finalRotationStartMs?: number;
  finalRotationDurationMs?: number;
  finalRotationT?: number;
  finalRotationTEased?: number;
  finalRotationDeltaDeg?: number;
  entryCount?: number;
  entryStride?: number;
  texIndices?: Int32Array;
  entryIndices?: Int32Array;
  entrySolveModes?: Int32Array;
  entryScreenFromDeg?: Float32Array | Float64Array;
  entryScreenToDeg?: Float32Array | Float64Array;
  entryScreenAnglesDeg?: Float32Array | Float64Array;
  entryRotateDeg?: Float32Array | Float64Array;
  entryFinalRotateDeg?: Float32Array | Float64Array;
  entryRotationFromDeg?: Float32Array | Float64Array;
  entryRotationToDeg?: Float32Array | Float64Array;
  entryRotationDurationMs?: Float32Array | Float64Array;
  entryFinalRotationFromDeg?: Float32Array | Float64Array;
  entryFinalRotationToDeg?: Float32Array | Float64Array;
  entryFinalRotationDurationMs?: Float32Array | Float64Array;
}

interface RotationLogState {
  lastTimeMs: number | undefined;
  frame: number;
  wasEnabled: boolean;
  entryPrevPivotX: number[];
  entryPrevPivotY: number[];
  entryPrevPivotNdcX: number[];
  entryPrevPivotNdcY: number[];
  elementPrevEdgeLeftDeg: number[];
  elementPrevScreenTargetDeg: number[];
  elementPrevEdgeDir: number[];
  elementPrevScreenDir: number[];
}

const project = (x: number, y: number, z: number, m: Float32Array) => {
  const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  const cz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  if (!Number.isFinite(cw) || Math.abs(cw) < 1e-6) {
    return undefined;
  }
  return { x: cx / cw, y: cy / cw, z: cz / cw };
};

const projectWithW = (x: number, y: number, z: number, m: Float32Array) => {
  const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!;
  const cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  const cz = m[2]! * x + m[6]! * y + m[10]! * z + m[14]!;
  const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  if (!Number.isFinite(cw) || Math.abs(cw) < 1e-12) {
    return undefined;
  }
  return { x: cx / cw, y: cy / cw, z: cz / cw, w: cw };
};

const resolveEdgeAngleDeg = (
  a: { x: number; y: number } | undefined,
  b: { x: number; y: number } | undefined,
  safeAspect: number
) => {
  if (!a || !b) {
    return Number.NaN;
  }
  const dx = (b.x - a.x) * safeAspect;
  const dy = b.y - a.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) {
    return Number.NaN;
  }
  return toDegrees(Math.atan2(dy, dx));
};

const resolveScreenDirection = (
  viewProjection: Float32Array,
  clipX: number,
  clipY: number,
  clipW: number,
  dirX: number,
  dirY: number,
  dirZ: number
) => {
  if (!Number.isFinite(clipW)) {
    return undefined;
  }
  const eps = 1e-9;
  const safeW = Math.abs(clipW) < eps ? (clipW < 0 ? -eps : eps) : clipW;
  const dclipX =
    viewProjection[0]! * dirX +
    viewProjection[4]! * dirY +
    viewProjection[8]! * dirZ;
  const dclipY =
    viewProjection[1]! * dirX +
    viewProjection[5]! * dirY +
    viewProjection[9]! * dirZ;
  const dclipW =
    viewProjection[3]! * dirX +
    viewProjection[7]! * dirY +
    viewProjection[11]! * dirZ;
  const invW2 = 1 / (safeW * safeW);
  const outX = (dclipX * safeW - clipX * dclipW) * invW2;
  const outY = (dclipY * safeW - clipY * dclipW) * invW2;
  if (!Number.isFinite(outX) || !Number.isFinite(outY)) {
    return undefined;
  }
  const lenSq = outX * outX + outY * outY;
  if (lenSq < 1e-12) {
    return undefined;
  }
  const invLen = 1 / Math.sqrt(lenSq);
  return { x: outX * invLen, y: outY * invLen };
};

const resolveScreenAngleFromWorld = (
  viewProjection: Float32Array,
  pivotX: number,
  pivotY: number,
  pivotZ: number,
  worldAngleRad: number
) => {
  const clipX =
    viewProjection[0]! * pivotX +
    viewProjection[4]! * pivotY +
    viewProjection[8]! * pivotZ +
    viewProjection[12]!;
  const clipY =
    viewProjection[1]! * pivotX +
    viewProjection[5]! * pivotY +
    viewProjection[9]! * pivotZ +
    viewProjection[13]!;
  const clipW =
    viewProjection[3]! * pivotX +
    viewProjection[7]! * pivotY +
    viewProjection[11]! * pivotZ +
    viewProjection[15]!;
  const dirWorldX = Math.sin(worldAngleRad);
  const dirWorldY = -Math.cos(worldAngleRad);
  const dirWorldZ = 0;
  const dirScreen = resolveScreenDirection(
    viewProjection,
    clipX,
    clipY,
    clipW,
    dirWorldX,
    dirWorldY,
    dirWorldZ
  );
  if (!dirScreen) {
    return undefined;
  }
  return Math.atan2(dirScreen.y, dirScreen.x);
};

const resolveScreenAngleFromWorldDir = (
  viewProjection: Float32Array,
  pivotX: number,
  pivotY: number,
  pivotZ: number,
  dirWorldX: number,
  dirWorldY: number,
  dirWorldZ: number
) => {
  const clipX =
    viewProjection[0]! * pivotX +
    viewProjection[4]! * pivotY +
    viewProjection[8]! * pivotZ +
    viewProjection[12]!;
  const clipY =
    viewProjection[1]! * pivotX +
    viewProjection[5]! * pivotY +
    viewProjection[9]! * pivotZ +
    viewProjection[13]!;
  const clipW =
    viewProjection[3]! * pivotX +
    viewProjection[7]! * pivotY +
    viewProjection[11]! * pivotZ +
    viewProjection[15]!;
  const dirScreen = resolveScreenDirection(
    viewProjection,
    clipX,
    clipY,
    clipW,
    dirWorldX,
    dirWorldY,
    dirWorldZ
  );
  if (!dirScreen) {
    return undefined;
  }
  return Math.atan2(dirScreen.y, dirScreen.x);
};

const resolveBillboardBasis = (viewMatrix: Float32Array) => {
  const forwardX = viewMatrix[2]!;
  const forwardY = viewMatrix[6]!;
  const forwardZ = viewMatrix[10]!;
  let upX = -forwardX * forwardY;
  let upY = 1 - forwardY * forwardY;
  let upZ = -forwardZ * forwardY;
  let upLenSq = upX * upX + upY * upY + upZ * upZ;
  if (upLenSq < 1e-6) {
    upX = 1 - forwardX * forwardX;
    upY = -forwardY * forwardX;
    upZ = -forwardZ * forwardX;
    upLenSq = upX * upX + upY * upY + upZ * upZ;
  }
  if (upLenSq < 1e-6) {
    upX = 0;
    upY = 1;
    upZ = 0;
    upLenSq = 1;
  }
  const upInvLen = 1 / Math.sqrt(upLenSq);
  upX *= upInvLen;
  upY *= upInvLen;
  upZ *= upInvLen;

  let rightX = upY * forwardZ - upZ * forwardY;
  let rightY = upZ * forwardX - upX * forwardZ;
  let rightZ = upX * forwardY - upY * forwardX;
  const rightLenSq = rightX * rightX + rightY * rightY + rightZ * rightZ;
  if (rightLenSq > 0) {
    const rightInvLen = 1 / Math.sqrt(rightLenSq);
    rightX *= rightInvLen;
    rightY *= rightInvLen;
    rightZ *= rightInvLen;
  }

  const correctedUpX = forwardY * rightZ - forwardZ * rightY;
  const correctedUpY = forwardZ * rightX - forwardX * rightZ;
  const correctedUpZ = forwardX * rightY - forwardY * rightX;
  return {
    rightX,
    rightY,
    rightZ,
    upX: correctedUpX,
    upY: correctedUpY,
    upZ: correctedUpZ,
  };
};

type RenderBasis = {
  rightX: number;
  rightY: number;
  rightZ: number;
  upX: number;
  upY: number;
  upZ: number;
};

const resolveRenderBasis = (
  renderMode: number | undefined,
  viewMatrix: Float32Array | undefined
): RenderBasis | undefined => {
  if (!Number.isFinite(renderMode ?? Number.NaN)) {
    return { rightX: 1, rightY: 0, rightZ: 0, upX: 0, upY: 1, upZ: 0 };
  }
  const mode = renderMode ?? 0;
  if (mode === 1) {
    if (!viewMatrix || viewMatrix.length < 16) {
      return undefined;
    }
    return resolveBillboardBasis(viewMatrix);
  }
  if (mode === 2) {
    if (!viewMatrix || viewMatrix.length < 16) {
      return undefined;
    }
    return {
      rightX: viewMatrix[0]!,
      rightY: viewMatrix[4]!,
      rightZ: viewMatrix[8]!,
      upX: viewMatrix[1]!,
      upY: viewMatrix[5]!,
      upZ: viewMatrix[9]!,
    };
  }
  return { rightX: 1, rightY: 0, rightZ: 0, upX: 0, upY: 1, upZ: 0 };
};

interface Option1Metrics {
  targetDeg: number | undefined;
  worldDeg: number | undefined;
  screenUpDeg: number | undefined;
  screenRightDeg: number | undefined;
  screenErrorDeg: number | undefined;
  edgeErrorDeg: number | undefined;
}

const resolveOption1Metrics = (
  viewProjection: Float32Array,
  pivotX: number,
  pivotY: number,
  pivotZ: number,
  screenTarget: number | undefined,
  base: RenderBasis | undefined,
  edgeBottomDeg: number | undefined
): Option1Metrics => {
  const metrics: Option1Metrics = {
    targetDeg: undefined,
    worldDeg: undefined,
    screenUpDeg: undefined,
    screenRightDeg: undefined,
    screenErrorDeg: undefined,
    edgeErrorDeg: undefined,
  };
  if (screenTarget === undefined || !Number.isFinite(screenTarget)) {
    return metrics;
  }
  metrics.targetDeg = toDegrees(screenTarget);
  if (!base) {
    return metrics;
  }
  const dirScreenX = -Math.cos(screenTarget);
  const dirScreenY = -Math.sin(screenTarget);
  const angle = resolveBillboardScreenAngleFromDirScreen(
    viewProjection,
    pivotX,
    pivotY,
    pivotZ,
    dirScreenX,
    dirScreenY,
    base.rightX,
    base.rightY,
    base.rightZ,
    base.upX,
    base.upY,
    base.upZ
  );
  if (angle === undefined || !Number.isFinite(angle)) {
    return metrics;
  }
  metrics.worldDeg = toDegrees(angle);
  const s = Math.sin(angle);
  const c = Math.cos(angle);
  const rightX = base.rightX * c - base.upX * s;
  const rightY = base.rightY * c - base.upY * s;
  const rightZ = base.rightZ * c - base.upZ * s;
  const upX = base.rightX * s + base.upX * c;
  const upY = base.rightY * s + base.upY * c;
  const upZ = base.rightZ * s + base.upZ * c;
  const screenRight = resolveScreenAngleFromWorldDir(
    viewProjection,
    pivotX,
    pivotY,
    pivotZ,
    rightX,
    rightY,
    rightZ
  );
  const screenUp = resolveScreenAngleFromWorldDir(
    viewProjection,
    pivotX,
    pivotY,
    pivotZ,
    upX,
    upY,
    upZ
  );
  const screenErrorDeg =
    screenUp !== undefined && Number.isFinite(screenUp)
      ? toDegrees(wrapRadians(screenUp - screenTarget))
      : undefined;
  const edgeErrorDeg =
    screenRight !== undefined &&
    Number.isFinite(screenRight) &&
    edgeBottomDeg !== undefined &&
    Number.isFinite(edgeBottomDeg)
      ? toDegrees(wrapRadians(toRadians(edgeBottomDeg) - screenRight))
      : undefined;
  metrics.screenUpDeg =
    screenUp !== undefined && Number.isFinite(screenUp)
      ? toDegrees(screenUp)
      : undefined;
  metrics.screenRightDeg =
    screenRight !== undefined && Number.isFinite(screenRight)
      ? toDegrees(screenRight)
      : undefined;
  metrics.screenErrorDeg = screenErrorDeg;
  metrics.edgeErrorDeg = edgeErrorDeg;
  return {
    ...metrics,
  };
};

const resolveBillboardScreenAngleFromDirScreen = (
  viewProjection: Float32Array,
  pivotX: number,
  pivotY: number,
  pivotZ: number,
  dirScreenX: number,
  dirScreenY: number,
  baseRightX: number,
  baseRightY: number,
  baseRightZ: number,
  baseUpX: number,
  baseUpY: number,
  baseUpZ: number
) => {
  const clipX =
    viewProjection[0]! * pivotX +
    viewProjection[4]! * pivotY +
    viewProjection[8]! * pivotZ +
    viewProjection[12]!;
  const clipY =
    viewProjection[1]! * pivotX +
    viewProjection[5]! * pivotY +
    viewProjection[9]! * pivotZ +
    viewProjection[13]!;
  const clipW =
    viewProjection[3]! * pivotX +
    viewProjection[7]! * pivotY +
    viewProjection[11]! * pivotZ +
    viewProjection[15]!;

  let dirX = dirScreenX;
  let dirY = -dirScreenY;
  const lenSq = dirX * dirX + dirY * dirY;
  if (!Number.isFinite(dirX) || !Number.isFinite(dirY) || lenSq < 1e-12) {
    return undefined;
  }
  const invLen = 1 / Math.sqrt(lenSq);
  dirX *= invLen;
  dirY *= invLen;

  const rightScreen = resolveScreenDirection(
    viewProjection,
    clipX,
    clipY,
    clipW,
    baseRightX,
    baseRightY,
    baseRightZ
  );
  if (!rightScreen) {
    return undefined;
  }
  const rightScreenX = rightScreen.x;
  const rightScreenY = -rightScreen.y;

  const upScreen = resolveScreenDirection(
    viewProjection,
    clipX,
    clipY,
    clipW,
    baseUpX,
    baseUpY,
    baseUpZ
  );
  if (!upScreen) {
    return undefined;
  }
  const upScreenX = upScreen.x;
  const upScreenY = -upScreen.y;

  const det = rightScreenX * upScreenY - rightScreenY * upScreenX;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    return undefined;
  }
  const invDet = 1 / det;
  const s = (dirX * upScreenY - dirY * upScreenX) * invDet;
  const c = (rightScreenX * dirY - rightScreenY * dirX) * invDet;
  const angle = Math.atan2(s, c);
  if (!Number.isFinite(angle)) {
    return undefined;
  }
  return angle;
};

/**
 * Creates a diagnostic logger for sprite rotation calculations.
 * @returns Rotation log sink function bound to an internal rolling state.
 * @remarks The returned function is intended for debug and test tooling rather than normal rendering paths.
 */
export const createRotationLogger = () => {
  const state: RotationLogState = {
    lastTimeMs: undefined,
    frame: 0,
    wasEnabled: false,
    entryPrevPivotX: [],
    entryPrevPivotY: [],
    entryPrevPivotNdcX: [],
    entryPrevPivotNdcY: [],
    elementPrevEdgeLeftDeg: [],
    elementPrevScreenTargetDeg: [],
    elementPrevEdgeDir: [],
    elementPrevScreenDir: [],
  };

  return ({
    viewProjection,
    viewMatrix,
    vertices,
    nowMs,
    aspectRatio,
    renderMode,
    rotateDeg,
    finalRotateDeg,
    rotationFromDeg,
    rotationToDeg,
    rotationStartMs,
    rotationDurationMs,
    rotationT,
    rotationTEased,
    rotationDeltaDeg,
    finalRotationFromDeg,
    finalRotationToDeg,
    finalRotationStartMs,
    finalRotationDurationMs,
    finalRotationT,
    finalRotationTEased,
    finalRotationDeltaDeg,
    entryCount,
    entryStride,
    texIndices,
    entryIndices,
    entrySolveModes,
    entryScreenFromDeg,
    entryScreenToDeg,
    entryScreenAnglesDeg,
    entryRotateDeg,
    entryFinalRotateDeg,
    entryRotationFromDeg,
    entryRotationToDeg,
    entryRotationDurationMs,
    entryFinalRotationFromDeg,
    entryFinalRotationToDeg,
    entryFinalRotationDurationMs,
  }: RotationLogInput) => {
    const enabled = globalThis.outputRotationLog === true;
    if (!enabled) {
      state.wasEnabled = false;
      return;
    }
    const sink = globalThis.rotationLogSink;
    if (typeof sink !== 'function') {
      state.wasEnabled = false;
      return;
    }
    if (!state.wasEnabled) {
      state.wasEnabled = true;
      state.lastTimeMs = undefined;
      state.frame = 0;
      state.entryPrevPivotX.length = 0;
      state.entryPrevPivotY.length = 0;
      state.entryPrevPivotNdcX.length = 0;
      state.entryPrevPivotNdcY.length = 0;
      state.elementPrevEdgeLeftDeg.length = 0;
      state.elementPrevScreenTargetDeg.length = 0;
      state.elementPrevEdgeDir.length = 0;
      state.elementPrevScreenDir.length = 0;
    }
    const stride =
      Number.isFinite(entryStride ?? Number.NaN) && (entryStride ?? 0) > 0
        ? (entryStride as number)
        : 20;
    const vertexStride = Math.max(1, Math.floor(stride / 4));
    if (viewProjection.length < 16 || vertices.length < vertexStride * 3 + 3) {
      return;
    }

    const v0 = 0;
    const v1 = vertexStride;
    const v2 = vertexStride * 2;
    const v3 = vertexStride * 3;
    const lb = {
      x: vertices[v0]!,
      y: vertices[v0 + 1]!,
      z: vertices[v0 + 2]!,
    };
    const rb = {
      x: vertices[v1]!,
      y: vertices[v1 + 1]!,
      z: vertices[v1 + 2]!,
    };
    const lt = {
      x: vertices[v2]!,
      y: vertices[v2 + 1]!,
      z: vertices[v2 + 2]!,
    };
    const rt = {
      x: vertices[v3]!,
      y: vertices[v3 + 1]!,
      z: vertices[v3 + 2]!,
    };
    const p1 = project(
      (lt.x + rt.x) / 2,
      (lt.y + rt.y) / 2,
      (lt.z + rt.z) / 2,
      viewProjection
    );
    const p2 = project(
      (lb.x + rb.x) / 2,
      (lb.y + rb.y) / 2,
      (lb.z + rb.z) / 2,
      viewProjection
    );
    if (!p1 || !p2) {
      return;
    }

    const safeAspect =
      Number.isFinite(aspectRatio) && (aspectRatio ?? 0) > 0
        ? (aspectRatio as number)
        : 1.0;
    const dx = (p1.x - p2.x) * safeAspect;
    const dy = p1.y - p2.y;
    const angleDeg = toDegrees(Math.atan2(dy, dx));
    const dt =
      state.lastTimeMs !== undefined && Number.isFinite(state.lastTimeMs)
        ? Math.max(0, nowMs - state.lastTimeMs)
        : 0;
    state.lastTimeMs = nowMs;
    const rotateValue = rotateDeg ?? Number.NaN;
    const finalRotateValue = finalRotateDeg ?? Number.NaN;
    const formatValue = (value: number, digits: number) =>
      Number.isFinite(value) ? value.toFixed(digits) : 'NaN';
    const formatOpt = (value: number | undefined, digits: number) =>
      value !== undefined && Number.isFinite(value)
        ? value.toFixed(digits)
        : 'NaN';

    sink(
      `[rotation-log] frame=${state.frame} t=${nowMs.toFixed(2)} dt=${dt.toFixed(
        2
      )} angleDeg=${angleDeg.toFixed(3)} rotateDeg=${formatValue(
        rotateValue,
        3
      )} finalRotateDeg=${formatValue(finalRotateValue, 3)} rotFrom=${formatValue(
        rotationFromDeg ?? Number.NaN,
        3
      )} rotTo=${formatValue(rotationToDeg ?? Number.NaN, 3)} rotDelta=${formatValue(
        rotationDeltaDeg ?? Number.NaN,
        3
      )} rotStart=${formatValue(rotationStartMs ?? Number.NaN, 2)} rotDur=${formatValue(
        rotationDurationMs ?? Number.NaN,
        2
      )} rotT=${formatValue(rotationT ?? Number.NaN, 5)} rotTEased=${formatValue(
        rotationTEased ?? Number.NaN,
        5
      )} finalFrom=${formatValue(finalRotationFromDeg ?? Number.NaN, 3)} finalTo=${formatValue(
        finalRotationToDeg ?? Number.NaN,
        3
      )} finalDelta=${formatValue(finalRotationDeltaDeg ?? Number.NaN, 3)} finalStart=${formatValue(
        finalRotationStartMs ?? Number.NaN,
        2
      )} finalDur=${formatValue(
        finalRotationDurationMs ?? Number.NaN,
        2
      )} finalT=${formatValue(
        finalRotationT ?? Number.NaN,
        5
      )} finalTEased=${formatValue(finalRotationTEased ?? Number.NaN, 5)}`
    );
    const verbose = globalThis.outputRotationLogVerbose === true;
    if (verbose) {
      const lb = {
        x: vertices[0]!,
        y: vertices[1]!,
        z: vertices[2]!,
      };
      const rb = {
        x: vertices[5]!,
        y: vertices[6]!,
        z: vertices[7]!,
      };
      const lt = {
        x: vertices[10]!,
        y: vertices[11]!,
        z: vertices[12]!,
      };
      const rt = {
        x: vertices[15]!,
        y: vertices[16]!,
        z: vertices[17]!,
      };
      const pivot = {
        x: (lb.x + rb.x + lt.x + rt.x) / 4,
        y: (lb.y + rb.y + lt.y + rt.y) / 4,
        z: (lb.z + rb.z + lt.z + rt.z) / 4,
      };

      const plb = projectWithW(lb.x, lb.y, lb.z, viewProjection);
      const prb = projectWithW(rb.x, rb.y, rb.z, viewProjection);
      const plt = projectWithW(lt.x, lt.y, lt.z, viewProjection);
      const prt = projectWithW(rt.x, rt.y, rt.z, viewProjection);

      const edgeBottomDeg = resolveEdgeAngleDeg(plb, prb, safeAspect);
      const edgeTopDeg = resolveEdgeAngleDeg(plt, prt, safeAspect);
      const centerBottom = projectWithW(
        (lb.x + rb.x) / 2,
        (lb.y + rb.y) / 2,
        (lb.z + rb.z) / 2,
        viewProjection
      );
      const centerTop = projectWithW(
        (lt.x + rt.x) / 2,
        (lt.y + rt.y) / 2,
        (lt.z + rt.z) / 2,
        viewProjection
      );
      const edgeLeftDeg = resolveEdgeAngleDeg(
        centerBottom,
        centerTop,
        safeAspect
      );
      const edgeRightDeg = resolveEdgeAngleDeg(prb, prt, safeAspect);

      const screenAngleRotate = Number.isFinite(rotateValue)
        ? resolveScreenAngleFromWorld(
            viewProjection,
            pivot.x,
            pivot.y,
            pivot.z,
            -toRadians(rotateValue)
          )
        : undefined;
      const screenAngleFinal = Number.isFinite(finalRotateValue)
        ? resolveScreenAngleFromWorld(
            viewProjection,
            pivot.x,
            pivot.y,
            pivot.z,
            -toRadians(finalRotateValue)
          )
        : undefined;

      const screenFromRot = Number.isFinite(rotationFromDeg ?? Number.NaN)
        ? resolveScreenAngleFromWorld(
            viewProjection,
            pivot.x,
            pivot.y,
            pivot.z,
            -toRadians(rotationFromDeg ?? 0)
          )
        : undefined;
      const screenToRot = Number.isFinite(rotationToDeg ?? Number.NaN)
        ? resolveScreenAngleFromWorld(
            viewProjection,
            pivot.x,
            pivot.y,
            pivot.z,
            -toRadians(rotationToDeg ?? 0)
          )
        : undefined;
      const screenFromFinal = Number.isFinite(
        finalRotationFromDeg ?? Number.NaN
      )
        ? resolveScreenAngleFromWorld(
            viewProjection,
            pivot.x,
            pivot.y,
            pivot.z,
            -toRadians(finalRotationFromDeg ?? 0)
          )
        : undefined;
      const screenToFinal = Number.isFinite(finalRotationToDeg ?? Number.NaN)
        ? resolveScreenAngleFromWorld(
            viewProjection,
            pivot.x,
            pivot.y,
            pivot.z,
            -toRadians(finalRotationToDeg ?? 0)
          )
        : undefined;

      const lerpScreen = (
        screenFrom: number | undefined,
        screenTo: number | undefined,
        t: number | undefined
      ) => {
        if (
          screenFrom === undefined ||
          screenTo === undefined ||
          t === undefined ||
          !Number.isFinite(t)
        ) {
          return undefined;
        }
        const delta = wrapRadians(screenTo - screenFrom);
        return screenFrom + delta * t;
      };

      const screenLerpRot = lerpScreen(
        screenFromRot,
        screenToRot,
        Number.isFinite(rotationTEased ?? Number.NaN)
          ? rotationTEased
          : rotationT
      );
      const screenLerpFinal = lerpScreen(
        screenFromFinal,
        screenToFinal,
        Number.isFinite(finalRotationTEased ?? Number.NaN)
          ? finalRotationTEased
          : finalRotationT
      );

      const renderBasis = resolveRenderBasis(renderMode, viewMatrix);
      const option1Rot = resolveOption1Metrics(
        viewProjection,
        pivot.x,
        pivot.y,
        pivot.z,
        screenLerpRot,
        renderBasis,
        edgeBottomDeg
      );
      const option1Final = resolveOption1Metrics(
        viewProjection,
        pivot.x,
        pivot.y,
        pivot.z,
        screenLerpFinal,
        renderBasis,
        edgeBottomDeg
      );

      let billboardAngleRot: number | undefined;
      let billboardAngleFinal: number | undefined;
      if (viewMatrix && viewMatrix.length >= 16) {
        const basis = resolveBillboardBasis(viewMatrix);
        if (screenLerpRot !== undefined) {
          const dirScreenX = -Math.cos(screenLerpRot);
          const dirScreenY = -Math.sin(screenLerpRot);
          const angle = resolveBillboardScreenAngleFromDirScreen(
            viewProjection,
            pivot.x,
            pivot.y,
            pivot.z,
            dirScreenX,
            dirScreenY,
            basis.rightX,
            basis.rightY,
            basis.rightZ,
            basis.upX,
            basis.upY,
            basis.upZ
          );
          billboardAngleRot =
            angle !== undefined ? toDegrees(angle) : undefined;
        }
        if (screenLerpFinal !== undefined) {
          const dirScreenX = -Math.cos(screenLerpFinal);
          const dirScreenY = -Math.sin(screenLerpFinal);
          const angle = resolveBillboardScreenAngleFromDirScreen(
            viewProjection,
            pivot.x,
            pivot.y,
            pivot.z,
            dirScreenX,
            dirScreenY,
            basis.rightX,
            basis.rightY,
            basis.rightZ,
            basis.upX,
            basis.upY,
            basis.upZ
          );
          billboardAngleFinal =
            angle !== undefined ? toDegrees(angle) : undefined;
        }
      }

      sink(
        `[rotation-log-verbose] frame=${state.frame} mode=${formatValue(
          renderMode ?? Number.NaN,
          0
        )} pivotX=${formatOpt(pivot.x, 3)} pivotY=${formatOpt(
          pivot.y,
          3
        )} pivotZ=${formatOpt(pivot.z, 3)} edgeBottomDeg=${formatOpt(
          edgeBottomDeg,
          3
        )} edgeTopDeg=${formatOpt(edgeTopDeg, 3)} edgeLeftDeg=${formatOpt(
          edgeLeftDeg,
          3
        )} edgeRightDeg=${formatOpt(edgeRightDeg, 3)} clipW0=${formatOpt(
          plb?.w,
          4
        )} clipW1=${formatOpt(prb?.w, 4)} clipW2=${formatOpt(
          plt?.w,
          4
        )} clipW3=${formatOpt(prt?.w, 4)} screenRotDeg=${formatOpt(
          screenAngleRotate !== undefined
            ? toDegrees(screenAngleRotate)
            : undefined,
          3
        )} screenFinalDeg=${formatOpt(
          screenAngleFinal !== undefined
            ? toDegrees(screenAngleFinal)
            : undefined,
          3
        )} screenFromRotDeg=${formatOpt(
          screenFromRot !== undefined ? toDegrees(screenFromRot) : undefined,
          3
        )} screenToRotDeg=${formatOpt(
          screenToRot !== undefined ? toDegrees(screenToRot) : undefined,
          3
        )} screenLerpRotDeg=${formatOpt(
          screenLerpRot !== undefined ? toDegrees(screenLerpRot) : undefined,
          3
        )} screenFromFinalDeg=${formatOpt(
          screenFromFinal !== undefined
            ? toDegrees(screenFromFinal)
            : undefined,
          3
        )} screenToFinalDeg=${formatOpt(
          screenToFinal !== undefined ? toDegrees(screenToFinal) : undefined,
          3
        )} screenLerpFinalDeg=${formatOpt(
          screenLerpFinal !== undefined
            ? toDegrees(screenLerpFinal)
            : undefined,
          3
        )} billboardRotDeg=${formatOpt(
          billboardAngleRot,
          3
        )} billboardFinalDeg=${formatOpt(
          billboardAngleFinal,
          3
        )} opt1BaseRightX=${formatOpt(
          renderBasis?.rightX,
          4
        )} opt1BaseRightY=${formatOpt(
          renderBasis?.rightY,
          4
        )} opt1BaseRightZ=${formatOpt(
          renderBasis?.rightZ,
          4
        )} opt1BaseUpX=${formatOpt(
          renderBasis?.upX,
          4
        )} opt1BaseUpY=${formatOpt(
          renderBasis?.upY,
          4
        )} opt1BaseUpZ=${formatOpt(
          renderBasis?.upZ,
          4
        )} opt1TargetRotDeg=${formatOpt(
          option1Rot.targetDeg,
          3
        )} opt1WorldRotDeg=${formatOpt(
          option1Rot.worldDeg,
          3
        )} opt1ScreenUpRotDeg=${formatOpt(
          option1Rot.screenUpDeg,
          3
        )} opt1ScreenErrRotDeg=${formatOpt(
          option1Rot.screenErrorDeg,
          3
        )} opt1ScreenRightRotDeg=${formatOpt(
          option1Rot.screenRightDeg,
          3
        )} opt1EdgeErrRotDeg=${formatOpt(
          option1Rot.edgeErrorDeg,
          3
        )} opt1TargetFinalDeg=${formatOpt(
          option1Final.targetDeg,
          3
        )} opt1WorldFinalDeg=${formatOpt(
          option1Final.worldDeg,
          3
        )} opt1ScreenUpFinalDeg=${formatOpt(
          option1Final.screenUpDeg,
          3
        )} opt1ScreenErrFinalDeg=${formatOpt(
          option1Final.screenErrorDeg,
          3
        )} opt1ScreenRightFinalDeg=${formatOpt(
          option1Final.screenRightDeg,
          3
        )} opt1EdgeErrFinalDeg=${formatOpt(option1Final.edgeErrorDeg, 3)}`
      );
    }
    const entryLogEnabled = globalThis.outputRotationLogEntries === true;
    if (entryLogEnabled) {
      const maxEntries = Math.floor(vertices.length / stride);
      const count =
        Number.isFinite(entryCount ?? Number.NaN) && (entryCount ?? 0) > 0
          ? Math.min(entryCount as number, maxEntries)
          : maxEntries;
      const texBuffer = texIndices;
      const entryBasis = resolveRenderBasis(renderMode, viewMatrix);
      for (let entryIndex = 0; entryIndex < count; entryIndex += 1) {
        const base = entryIndex * stride;
        const v0 = base;
        const v1 = base + vertexStride;
        const v2 = base + vertexStride * 2;
        const v3 = base + vertexStride * 3;
        if (v3 + 2 >= vertices.length) {
          continue;
        }
        const lbx = vertices[v0]!;
        const lby = vertices[v0 + 1]!;
        const lbz = vertices[v0 + 2]!;
        const rbx = vertices[v1]!;
        const rby = vertices[v1 + 1]!;
        const rbz = vertices[v1 + 2]!;
        const ltx = vertices[v2]!;
        const lty = vertices[v2 + 1]!;
        const ltz = vertices[v2 + 2]!;
        const rtx = vertices[v3]!;
        const rty = vertices[v3 + 1]!;
        const rtz = vertices[v3 + 2]!;
        const pivotX = (lbx + rbx + ltx + rtx) / 4;
        const pivotY = (lby + rby + lty + rty) / 4;
        const pivotZ = (lbz + rbz + ltz + rtz) / 4;

        const plb = projectWithW(lbx, lby, lbz, viewProjection);
        const prb = projectWithW(rbx, rby, rbz, viewProjection);
        const edgeBottomDeg = resolveEdgeAngleDeg(plb, prb, safeAspect);
        const centerBottom = projectWithW(
          (lbx + rbx) / 2,
          (lby + rby) / 2,
          (lbz + rbz) / 2,
          viewProjection
        );
        const centerTop = projectWithW(
          (ltx + rtx) / 2,
          (lty + rty) / 2,
          (ltz + rtz) / 2,
          viewProjection
        );
        const edgeLeftDeg = resolveEdgeAngleDeg(
          centerBottom,
          centerTop,
          safeAspect
        );

        const pivotClip = projectWithW(pivotX, pivotY, pivotZ, viewProjection);
        const pivotNdcX = pivotClip?.x;
        const pivotNdcY = pivotClip?.y;
        const pivotClipW = pivotClip?.w;

        const prevPivotNdcX = state.entryPrevPivotNdcX[entryIndex]!;
        const prevPivotNdcY = state.entryPrevPivotNdcY[entryIndex]!;
        const prevPivotX = state.entryPrevPivotX[entryIndex]!;
        const prevPivotY = state.entryPrevPivotY[entryIndex]!;
        let moveScreenDeg: number | undefined;
        let moveWorldDeg: number | undefined;
        if (
          pivotNdcX !== undefined &&
          pivotNdcY !== undefined &&
          Number.isFinite(prevPivotNdcX) &&
          Number.isFinite(prevPivotNdcY)
        ) {
          const moveDx = (pivotNdcX - prevPivotNdcX) * safeAspect;
          const moveDy = pivotNdcY - prevPivotNdcY;
          if (Number.isFinite(moveDx) && Number.isFinite(moveDy)) {
            const lenSq = moveDx * moveDx + moveDy * moveDy;
            if (lenSq > 1e-12) {
              moveScreenDeg = toDegrees(Math.atan2(moveDy, moveDx));
            }
          }
        }
        if (
          Number.isFinite(prevPivotX) &&
          Number.isFinite(prevPivotY) &&
          Number.isFinite(pivotX) &&
          Number.isFinite(pivotY)
        ) {
          const moveDx = pivotX - prevPivotX;
          const moveDy = pivotY - prevPivotY;
          if (Number.isFinite(moveDx) && Number.isFinite(moveDy)) {
            const lenSq = moveDx * moveDx + moveDy * moveDy;
            if (lenSq > 1e-12) {
              moveWorldDeg = toDegrees(Math.atan2(moveDx, moveDy));
            }
          }
        }

        let billboardMoveDeg: number | undefined;
        if (
          moveScreenDeg !== undefined &&
          entryBasis &&
          Number.isFinite(moveScreenDeg)
        ) {
          const screenTargetRad = toRadians(moveScreenDeg);
          const dirScreenX = -Math.cos(screenTargetRad);
          const dirScreenY = -Math.sin(screenTargetRad);
          const angle = resolveBillboardScreenAngleFromDirScreen(
            viewProjection,
            pivotX,
            pivotY,
            pivotZ,
            dirScreenX,
            dirScreenY,
            entryBasis.rightX,
            entryBasis.rightY,
            entryBasis.rightZ,
            entryBasis.upX,
            entryBasis.upY,
            entryBasis.upZ
          );
          billboardMoveDeg =
            angle !== undefined && Number.isFinite(angle)
              ? toDegrees(angle)
              : undefined;
        }

        if (pivotNdcX !== undefined) {
          state.entryPrevPivotNdcX[entryIndex] = pivotNdcX;
        }
        if (pivotNdcY !== undefined) {
          state.entryPrevPivotNdcY[entryIndex] = pivotNdcY;
        }
        if (Number.isFinite(pivotX)) {
          state.entryPrevPivotX[entryIndex] = pivotX;
        }
        if (Number.isFinite(pivotY)) {
          state.entryPrevPivotY[entryIndex] = pivotY;
        }

        const pageId =
          texBuffer && entryIndex < texBuffer.length
            ? texBuffer[entryIndex]
            : Number.NaN;
        const opacity =
          vertexStride >= 6 && base + 5 < vertices.length
            ? vertices[base + 5]
            : Number.NaN;
        const elementIndex =
          entryIndices && entryIndex < entryIndices.length
            ? entryIndices[entryIndex]!
            : Number.NaN;
        const elementSlot = Number.isFinite(elementIndex)
          ? Math.max(0, Math.floor(elementIndex))
          : entryIndex;
        const entryRotateValue =
          entryRotateDeg && entryIndex < entryRotateDeg.length
            ? entryRotateDeg[entryIndex]!
            : Number.NaN;
        const entryFinalRotateValue =
          entryFinalRotateDeg && entryIndex < entryFinalRotateDeg.length
            ? entryFinalRotateDeg[entryIndex]!
            : Number.NaN;
        const entryRotationFromValue =
          entryRotationFromDeg && entryIndex < entryRotationFromDeg.length
            ? entryRotationFromDeg[entryIndex]!
            : Number.NaN;
        const entryRotationToValue =
          entryRotationToDeg && entryIndex < entryRotationToDeg.length
            ? entryRotationToDeg[entryIndex]!
            : Number.NaN;
        const entryRotationDurationValue =
          entryRotationDurationMs && entryIndex < entryRotationDurationMs.length
            ? entryRotationDurationMs[entryIndex]!
            : Number.NaN;
        const entryFinalFromValue =
          entryFinalRotationFromDeg &&
          entryIndex < entryFinalRotationFromDeg.length
            ? entryFinalRotationFromDeg[entryIndex]!
            : Number.NaN;
        const entryFinalToValue =
          entryFinalRotationToDeg && entryIndex < entryFinalRotationToDeg.length
            ? entryFinalRotationToDeg[entryIndex]!
            : Number.NaN;
        const entryFinalDurationValue =
          entryFinalRotationDurationMs &&
          entryIndex < entryFinalRotationDurationMs.length
            ? entryFinalRotationDurationMs[entryIndex]!
            : Number.NaN;
        const solveMode =
          entrySolveModes && entryIndex < entrySolveModes.length
            ? entrySolveModes[entryIndex]
            : Number.NaN;
        const screenTargetDeg =
          entryScreenAnglesDeg && entryIndex < entryScreenAnglesDeg.length
            ? entryScreenAnglesDeg[entryIndex]!
            : Number.NaN;
        const screenFromDeg =
          entryScreenFromDeg && entryIndex < entryScreenFromDeg.length
            ? entryScreenFromDeg[entryIndex]!
            : Number.NaN;
        const screenToDeg =
          entryScreenToDeg && entryIndex < entryScreenToDeg.length
            ? entryScreenToDeg[entryIndex]!
            : Number.NaN;
        let screenDeltaRawDeg = Number.NaN;
        let screenDeltaDeg = Number.NaN;
        if (Number.isFinite(screenFromDeg) && Number.isFinite(screenToDeg)) {
          screenDeltaRawDeg = screenToDeg - screenFromDeg;
          screenDeltaDeg = toDegrees(wrapRadians(toRadians(screenDeltaRawDeg)));
        }

        const prevEdgeLeftDeg = state.elementPrevEdgeLeftDeg[elementSlot]!;
        const prevScreenTargetDeg =
          state.elementPrevScreenTargetDeg[elementSlot]!;
        let edgeLeftDeltaDeg = Number.NaN;
        let screenTargetDeltaDeg = Number.NaN;
        if (Number.isFinite(edgeLeftDeg) && Number.isFinite(prevEdgeLeftDeg)) {
          edgeLeftDeltaDeg = wrapDegrees(edgeLeftDeg - prevEdgeLeftDeg);
        }
        if (
          Number.isFinite(screenTargetDeg) &&
          Number.isFinite(prevScreenTargetDeg)
        ) {
          screenTargetDeltaDeg = wrapDegrees(
            screenTargetDeg - prevScreenTargetDeg
          );
        }
        const resolveDir = (delta: number) => {
          if (!Number.isFinite(delta)) {
            return 0;
          }
          const eps = 1e-3;
          if (Math.abs(delta) < eps) {
            return 0;
          }
          return delta > 0 ? 1 : -1;
        };
        const edgeLeftDir = resolveDir(edgeLeftDeltaDeg);
        const screenTargetDir = resolveDir(screenTargetDeltaDeg);
        const prevEdgeLeftDir = state.elementPrevEdgeDir[elementSlot] ?? 0;
        const prevScreenTargetDir =
          state.elementPrevScreenDir[elementSlot] ?? 0;
        const edgeLeftFlip =
          edgeLeftDir !== 0 &&
          prevEdgeLeftDir !== 0 &&
          edgeLeftDir !== prevEdgeLeftDir
            ? 1
            : 0;
        const screenTargetFlip =
          screenTargetDir !== 0 &&
          prevScreenTargetDir !== 0 &&
          screenTargetDir !== prevScreenTargetDir
            ? 1
            : 0;

        sink(
          `[rotation-log-entry] frame=${state.frame} t=${nowMs.toFixed(
            2
          )} entry=${entryIndex} elementIndex=${formatOpt(
            elementIndex,
            0
          )} solveMode=${formatOpt(solveMode, 0)} screenTargetDeg=${formatOpt(
            screenTargetDeg,
            3
          )} entryRotDeg=${formatOpt(entryRotateValue, 3)} entryFinalRotDeg=${formatOpt(
            entryFinalRotateValue,
            3
          )} entryRotFrom=${formatOpt(
            entryRotationFromValue,
            3
          )} entryRotTo=${formatOpt(
            entryRotationToValue,
            3
          )} entryRotDur=${formatOpt(
            entryRotationDurationValue,
            2
          )} entryFinalFrom=${formatOpt(
            entryFinalFromValue,
            3
          )} entryFinalTo=${formatOpt(
            entryFinalToValue,
            3
          )} entryFinalDur=${formatOpt(
            entryFinalDurationValue,
            2
          )} screenFromDeg=${formatOpt(
            screenFromDeg,
            3
          )} screenToDeg=${formatOpt(
            screenToDeg,
            3
          )} screenDeltaRawDeg=${formatOpt(
            screenDeltaRawDeg,
            3
          )} screenDeltaDeg=${formatOpt(
            screenDeltaDeg,
            3
          )} edgeLeftDeltaDeg=${formatOpt(
            edgeLeftDeltaDeg,
            3
          )} edgeLeftDir=${formatOpt(edgeLeftDir, 0)} edgeLeftFlip=${formatOpt(
            edgeLeftFlip,
            0
          )} screenTargetDeltaDeg=${formatOpt(
            screenTargetDeltaDeg,
            3
          )} screenTargetDir=${formatOpt(
            screenTargetDir,
            0
          )} screenTargetFlip=${formatOpt(
            screenTargetFlip,
            0
          )} pivotX=${formatOpt(pivotX, 3)} pivotY=${formatOpt(
            pivotY,
            3
          )} pivotZ=${formatOpt(pivotZ, 3)} pivotNdcX=${formatOpt(
            pivotNdcX,
            4
          )} pivotNdcY=${formatOpt(pivotNdcY, 4)} pivotClipW=${formatOpt(
            pivotClipW,
            4
          )} edgeLeftDeg=${formatOpt(edgeLeftDeg, 3)} edgeBottomDeg=${formatOpt(
            edgeBottomDeg,
            3
          )} pageId=${formatOpt(pageId, 0)} opacity=${formatOpt(
            opacity,
            3
          )} moveScreenDeg=${formatOpt(moveScreenDeg, 3)} moveWorldDeg=${formatOpt(
            moveWorldDeg,
            3
          )} billboardMoveDeg=${formatOpt(billboardMoveDeg, 3)}`
        );

        if (Number.isFinite(edgeLeftDeg)) {
          state.elementPrevEdgeLeftDeg[elementSlot] = edgeLeftDeg;
        }
        if (Number.isFinite(screenTargetDeg)) {
          state.elementPrevScreenTargetDeg[elementSlot] = screenTargetDeg;
        }
        if (edgeLeftDir !== 0) {
          state.elementPrevEdgeDir[elementSlot] = edgeLeftDir;
        }
        if (screenTargetDir !== 0) {
          state.elementPrevScreenDir[elementSlot] = screenTargetDir;
        }
      }
    }
    state.frame += 1;
  };
};
