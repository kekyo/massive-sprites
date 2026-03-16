// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

#pragma once

#include <cmath>

#include "compute_internal.h"

namespace msp_wasm::detail {

/**
 * @brief Normalizes a 3D vector.
 * @param x Input X component.
 * @param y Input Y component.
 * @param z Input Z component.
 * @param outX Receives the normalized X component.
 * @param outY Receives the normalized Y component.
 * @param outZ Receives the normalized Z component.
 * @return `true` when the input had sufficient length to normalize.
 */
static constexpr inline bool normalize3(
    scalar_t x,
    scalar_t y,
    scalar_t z,
    scalar_t &outX,
    scalar_t &outY,
    scalar_t &outZ) {
  const scalar_t lenSq = x * x + y * y + z * z;
  const scalar_t eps = static_cast<scalar_t>(1e-12f);
  if (lenSq < eps) {
    return false;
  }
  const scalar_t invLen = static_cast<scalar_t>(1.0f) / std::sqrt(lenSq);
  outX = x * invLen;
  outY = y * invLen;
  outZ = z * invLen;
  return true;
}

static constexpr inline void resolveBillboardBasisFromForward(
    scalar_t forwardX,
    scalar_t forwardY,
    scalar_t forwardZ,
    scalar_t &rightX,
    scalar_t &rightY,
    scalar_t &rightZ,
    scalar_t &upX,
    scalar_t &upY,
    scalar_t &upZ) {
  if (!normalize3(forwardX, forwardY, forwardZ, forwardX, forwardY, forwardZ)) {
    forwardX = static_cast<scalar_t>(0.0f);
    forwardY = static_cast<scalar_t>(0.0f);
    forwardZ = static_cast<scalar_t>(1.0f);
  }

  // When forward is close to a cardinal axis, retry with an alternate axis so
  // the local up vector stays well-defined.
  upX = -forwardX * forwardY;
  upY = static_cast<scalar_t>(1.0f) - forwardY * forwardY;
  upZ = -forwardZ * forwardY;
  scalar_t upLenSq = upX * upX + upY * upY + upZ * upZ;
  if (upLenSq < static_cast<scalar_t>(1e-6f)) {
    upX = static_cast<scalar_t>(1.0f) - forwardX * forwardX;
    upY = -forwardY * forwardX;
    upZ = -forwardZ * forwardX;
    upLenSq = upX * upX + upY * upY + upZ * upZ;
  }
  if (upLenSq < static_cast<scalar_t>(1e-6f)) {
    upX = static_cast<scalar_t>(0.0f);
    upY = static_cast<scalar_t>(1.0f);
    upZ = static_cast<scalar_t>(0.0f);
    upLenSq = static_cast<scalar_t>(1.0f);
  }
  const scalar_t upInvLen = static_cast<scalar_t>(1.0f) / std::sqrt(upLenSq);
  upX *= upInvLen;
  upY *= upInvLen;
  upZ *= upInvLen;

  rightX = upY * forwardZ - upZ * forwardY;
  rightY = upZ * forwardX - upX * forwardZ;
  rightZ = upX * forwardY - upY * forwardX;
  const scalar_t rightLenSq = rightX * rightX + rightY * rightY + rightZ * rightZ;
  if (rightLenSq > static_cast<scalar_t>(0.0f)) {
    const scalar_t rightInvLen =
        static_cast<scalar_t>(1.0f) / std::sqrt(rightLenSq);
    rightX *= rightInvLen;
    rightY *= rightInvLen;
    rightZ *= rightInvLen;
  }

  const scalar_t correctedUpX = forwardY * rightZ - forwardZ * rightY;
  const scalar_t correctedUpY = forwardZ * rightX - forwardX * rightZ;
  const scalar_t correctedUpZ = forwardX * rightY - forwardY * rightX;
  upX = correctedUpX;
  upY = correctedUpY;
  upZ = correctedUpZ;
}

static constexpr inline void resolveBillboardBasis(
    const scalar_t *viewMatrix,
    scalar_t &rightX,
    scalar_t &rightY,
    scalar_t &rightZ,
    scalar_t &upX,
    scalar_t &upY,
    scalar_t &upZ) {
  resolveBillboardBasisFromForward(
      viewMatrix[2],
      viewMatrix[6],
      viewMatrix[10],
      rightX,
      rightY,
      rightZ,
      upX,
      upY,
      upZ);
}

static constexpr inline bool normalize2(
    scalar_t x,
    scalar_t y,
    scalar_t &outX,
    scalar_t &outY) {
  const scalar_t lenSq = x * x + y * y;
  const scalar_t eps = static_cast<scalar_t>(1e-12f);
  if (lenSq < eps) {
    return false;
  }
  const scalar_t invLen = static_cast<scalar_t>(1.0f) / std::sqrt(lenSq);
  outX = x * invLen;
  outY = y * invLen;
  return true;
}

static constexpr inline bool resolveScreenDirection(
    const scalar_t *viewProjection,
    scalar_t clipX,
    scalar_t clipY,
    scalar_t clipW,
    scalar_t dirX,
    scalar_t dirY,
    scalar_t dirZ,
    scalar_t aspectRatio,
    scalar_t &outX,
    scalar_t &outY) {
  if (!std::isfinite(clipW)) {
    return false;
  }
  const scalar_t eps = static_cast<scalar_t>(1e-9f);
  const scalar_t safeW =
      std::abs(clipW) < eps
          ? (clipW < static_cast<scalar_t>(0.0f) ? -eps : eps)
          : clipW;
  const scalar_t dclipX =
      viewProjection[0] * dirX + viewProjection[4] * dirY +
      viewProjection[8] * dirZ;
  const scalar_t dclipY =
      viewProjection[1] * dirX + viewProjection[5] * dirY +
      viewProjection[9] * dirZ;
  const scalar_t dclipW =
      viewProjection[3] * dirX + viewProjection[7] * dirY +
      viewProjection[11] * dirZ;
  const scalar_t invW2 =
      static_cast<scalar_t>(1.0f) / (safeW * safeW);
  outX = (dclipX * safeW - clipX * dclipW) * invW2;
  outY = (dclipY * safeW - clipY * dclipW) * invW2;
  if (std::isfinite(outX) && std::isfinite(outY) &&
      std::isfinite(aspectRatio) && aspectRatio > static_cast<scalar_t>(0.0f)) {
    outX *= aspectRatio;
  }
  return std::isfinite(outX) && std::isfinite(outY);
}

static constexpr inline bool projectToClip(
    const scalar_t *viewProjection,
    scalar_t x,
    scalar_t y,
    scalar_t z,
    scalar_t &clipX,
    scalar_t &clipY,
    scalar_t &clipW) {
  clipX = viewProjection[0] * x + viewProjection[4] * y +
          viewProjection[8] * z + viewProjection[12];
  clipY = viewProjection[1] * x + viewProjection[5] * y +
          viewProjection[9] * z + viewProjection[13];
  clipW = viewProjection[3] * x + viewProjection[7] * y +
          viewProjection[11] * z + viewProjection[15];
  return std::isfinite(clipX) && std::isfinite(clipY) && std::isfinite(clipW);
}

static constexpr inline bool projectToNdc(
    const scalar_t *viewProjection,
    scalar_t x,
    scalar_t y,
    scalar_t z,
    scalar_t &outX,
    scalar_t &outY) {
  scalar_t clipX = static_cast<scalar_t>(0.0f);
  scalar_t clipY = static_cast<scalar_t>(0.0f);
  scalar_t clipW = static_cast<scalar_t>(0.0f);
  if (!projectToClip(viewProjection, x, y, z, clipX, clipY, clipW)) {
    return false;
  }
  const scalar_t eps = static_cast<scalar_t>(1e-9f);
  const scalar_t safeW =
      std::abs(clipW) < eps
          ? (clipW < static_cast<scalar_t>(0.0f) ? -eps : eps)
          : clipW;
  outX = clipX / safeW;
  outY = clipY / safeW;
  return std::isfinite(outX) && std::isfinite(outY);
}

static constexpr inline bool resolveBillboardSegmentScreenDir(
    const scalar_t *viewProjection,
    scalar_t pivotX,
    scalar_t pivotY,
    scalar_t pivotZ,
    scalar_t baseRightX,
    scalar_t baseRightY,
    scalar_t baseRightZ,
    scalar_t baseUpX,
    scalar_t baseUpY,
    scalar_t baseUpZ,
    scalar_t localTop,
    scalar_t localBottom,
    scalar_t angle,
    scalar_t aspectRatio,
    scalar_t &outDirX,
    scalar_t &outDirY) {
  scalar_t s = static_cast<scalar_t>(0.0f);
  scalar_t c = static_cast<scalar_t>(1.0f);
  computeSinCos(angle, s, c);
  const scalar_t upX = baseRightX * s + baseUpX * c;
  const scalar_t upY = baseRightY * s + baseUpY * c;
  const scalar_t upZ = baseRightZ * s + baseUpZ * c;

  const scalar_t topX = pivotX + upX * localTop;
  const scalar_t topY = pivotY + upY * localTop;
  const scalar_t topZ = pivotZ + upZ * localTop;
  const scalar_t bottomX = pivotX + upX * localBottom;
  const scalar_t bottomY = pivotY + upY * localBottom;
  const scalar_t bottomZ = pivotZ + upZ * localBottom;

  scalar_t topScreenX = static_cast<scalar_t>(0.0f);
  scalar_t topScreenY = static_cast<scalar_t>(0.0f);
  scalar_t bottomScreenX = static_cast<scalar_t>(0.0f);
  scalar_t bottomScreenY = static_cast<scalar_t>(0.0f);
  if (!projectToNdc(
          viewProjection, topX, topY, topZ, topScreenX, topScreenY) ||
      !projectToNdc(
          viewProjection,
          bottomX,
          bottomY,
          bottomZ,
          bottomScreenX,
          bottomScreenY)) {
    return false;
  }
  const scalar_t dirX = topScreenX - bottomScreenX;
  const scalar_t dirY = topScreenY - bottomScreenY;
  scalar_t scaledX = dirX;
  if (std::isfinite(aspectRatio) && aspectRatio > static_cast<scalar_t>(0.0f)) {
    scaledX *= aspectRatio;
  }
  return normalize2(scaledX, dirY, outDirX, outDirY);
}

// Refine the billboard-local rotation with a secant iteration against the
// projected segment direction measured in screen space.
static constexpr inline bool solveBillboardAngleForScreenDir(
    const scalar_t *viewProjection,
    scalar_t pivotX,
    scalar_t pivotY,
    scalar_t pivotZ,
    scalar_t baseRightX,
    scalar_t baseRightY,
    scalar_t baseRightZ,
    scalar_t baseUpX,
    scalar_t baseUpY,
    scalar_t baseUpZ,
    scalar_t localTop,
    scalar_t localBottom,
    scalar_t targetDirX,
    scalar_t targetDirY,
    scalar_t seedA,
    scalar_t seedB,
    scalar_t aspectRatio,
    scalar_t &outAngle) {
  const scalar_t extent = std::abs(localTop - localBottom);
  const scalar_t extentEps = static_cast<scalar_t>(1.0e-6f);
  if (!std::isfinite(extent) || extent < extentEps) {
    return false;
  }
  scalar_t targetX = targetDirX;
  scalar_t targetY = targetDirY;
  if (!normalize2(targetX, targetY, targetX, targetY)) {
    return false;
  }

  const auto evalError = [&](scalar_t angle, scalar_t &outError) -> bool {
    scalar_t dirX = static_cast<scalar_t>(0.0f);
    scalar_t dirY = static_cast<scalar_t>(0.0f);
    if (!resolveBillboardSegmentScreenDir(
            viewProjection,
            pivotX,
            pivotY,
            pivotZ,
            baseRightX,
            baseRightY,
            baseRightZ,
            baseUpX,
            baseUpY,
            baseUpZ,
            localTop,
            localBottom,
            angle,
            aspectRatio,
            dirX,
            dirY)) {
      return false;
    }
    const scalar_t dot = dirX * targetX + dirY * targetY;
    const scalar_t cross = dirX * targetY - dirY * targetX;
    outError = std::atan2(cross, dot);
    return std::isfinite(outError);
  };

  scalar_t angle0 = seedA;
  scalar_t angle1 = seedA + wrapRadians(seedB - seedA);
  scalar_t f0 = static_cast<scalar_t>(0.0f);
  scalar_t f1 = static_cast<scalar_t>(0.0f);
  if (!evalError(angle0, f0) || !evalError(angle1, f1)) {
    return false;
  }

  scalar_t bestAngle = angle1;
  scalar_t bestError = std::abs(f1);
  if (std::abs(f0) < bestError) {
    bestAngle = angle0;
    bestError = std::abs(f0);
  }

  const scalar_t tolerance = static_cast<scalar_t>(1.0e-4f);
  if (std::abs(f1) <= tolerance) {
    outAngle = angle1;
    return true;
  }

  const int maxIterations = 24;
  const scalar_t denomEps = static_cast<scalar_t>(1.0e-6f);
  const scalar_t maxStep = static_cast<scalar_t>(1.5f);
  for (int i = 0; i < maxIterations; ++i) {
    const scalar_t denom = f1 - f0;
    if (std::abs(denom) < denomEps) {
      break;
    }
    scalar_t angle2 = angle1 - f1 * (angle1 - angle0) / denom;
    const scalar_t step = angle2 - angle1;
    if (std::abs(step) > maxStep) {
      angle2 =
          angle1 + (step < static_cast<scalar_t>(0.0f) ? -maxStep : maxStep);
    }
    scalar_t f2 = static_cast<scalar_t>(0.0f);
    if (!evalError(angle2, f2)) {
      break;
    }
    const scalar_t absF2 = std::abs(f2);
    if (absF2 < bestError) {
      bestAngle = angle2;
      bestError = absF2;
    }
    angle0 = angle1;
    f0 = f1;
    angle1 = angle2;
    f1 = f2;
    if (std::abs(f1) <= tolerance) {
      outAngle = angle1;
      return true;
    }
  }

  if (std::isfinite(bestError)) {
    outAngle = bestAngle;
    return true;
  }
  return false;
}

// Recover the billboard-local angle by solving the projected basis vectors as a
// 2x2 system in screen space.
static constexpr inline bool resolveBillboardScreenAngleFromDirScreen(
    const scalar_t *viewProjection,
    scalar_t pivotX,
    scalar_t pivotY,
    scalar_t pivotZ,
    scalar_t dirScreenX,
    scalar_t dirScreenY,
    scalar_t baseRightX,
    scalar_t baseRightY,
    scalar_t baseRightZ,
    scalar_t baseUpX,
    scalar_t baseUpY,
    scalar_t baseUpZ,
    scalar_t aspectRatio,
    scalar_t &outAngle) {
  const scalar_t clipX =
      viewProjection[0] * pivotX + viewProjection[4] * pivotY +
      viewProjection[8] * pivotZ + viewProjection[12];
  const scalar_t clipY =
      viewProjection[1] * pivotX + viewProjection[5] * pivotY +
      viewProjection[9] * pivotZ + viewProjection[13];
  const scalar_t clipW =
      viewProjection[3] * pivotX + viewProjection[7] * pivotY +
      viewProjection[11] * pivotZ + viewProjection[15];
  dirScreenY = -dirScreenY;
  if (!normalize2(dirScreenX, dirScreenY, dirScreenX, dirScreenY)) {
    return false;
  }
  if (!std::isfinite(dirScreenX) || !std::isfinite(dirScreenY)) {
    return false;
  }
  scalar_t rightScreenX = static_cast<scalar_t>(0.0f);
  scalar_t rightScreenY = static_cast<scalar_t>(0.0f);
  if (!resolveScreenDirection(
          viewProjection,
          clipX,
          clipY,
          clipW,
          baseRightX,
          baseRightY,
          baseRightZ,
          aspectRatio,
          rightScreenX,
          rightScreenY)) {
    return false;
  }
  rightScreenY = -rightScreenY;

  scalar_t upScreenX = static_cast<scalar_t>(0.0f);
  scalar_t upScreenY = static_cast<scalar_t>(0.0f);
  if (!resolveScreenDirection(
          viewProjection,
          clipX,
          clipY,
          clipW,
          baseUpX,
          baseUpY,
          baseUpZ,
          aspectRatio,
          upScreenX,
          upScreenY)) {
    return false;
  }
  upScreenY = -upScreenY;
  const scalar_t det = rightScreenX * upScreenY - rightScreenY * upScreenX;
  const scalar_t detEps = static_cast<scalar_t>(1e-12f);
  if (std::abs(det) < detEps || !std::isfinite(det)) {
    return false;
  }
  const scalar_t invDet = static_cast<scalar_t>(1.0f) / det;
  const scalar_t s =
      (dirScreenX * upScreenY - dirScreenY * upScreenX) * invDet;
  const scalar_t c =
      (rightScreenX * dirScreenY - rightScreenY * dirScreenX) * invDet;
  outAngle = std::atan2(s, c);
  return std::isfinite(outAngle);
}

static constexpr inline bool resolveScreenAngleFromWorld(
    const scalar_t *viewProjection,
    scalar_t pivotX,
    scalar_t pivotY,
    scalar_t pivotZ,
    scalar_t worldAngle,
    scalar_t aspectRatio,
    scalar_t &outAngle) {
  const scalar_t clipX =
      viewProjection[0] * pivotX + viewProjection[4] * pivotY +
      viewProjection[8] * pivotZ + viewProjection[12];
  const scalar_t clipY =
      viewProjection[1] * pivotX + viewProjection[5] * pivotY +
      viewProjection[9] * pivotZ + viewProjection[13];
  const scalar_t clipW =
      viewProjection[3] * pivotX + viewProjection[7] * pivotY +
      viewProjection[11] * pivotZ + viewProjection[15];
  scalar_t sWorld = static_cast<scalar_t>(0.0f);
  scalar_t cWorld = static_cast<scalar_t>(1.0f);
  computeSinCos(worldAngle, sWorld, cWorld);
  const scalar_t dirWorldX = sWorld;
  const scalar_t dirWorldY = -cWorld;
  scalar_t dirScreenX = static_cast<scalar_t>(0.0f);
  scalar_t dirScreenY = static_cast<scalar_t>(0.0f);
  if (!resolveScreenDirection(
          viewProjection,
          clipX,
          clipY,
          clipW,
          dirWorldX,
          dirWorldY,
          static_cast<scalar_t>(0.0f),
          aspectRatio,
          dirScreenX,
          dirScreenY)) {
    return false;
  }
  if (!normalize2(dirScreenX, dirScreenY, dirScreenX, dirScreenY)) {
    return false;
  }
  outAngle = std::atan2(dirScreenY, dirScreenX);
  return std::isfinite(outAngle);
}

static constexpr inline bool resolveBillboardScreenAngle(
    const scalar_t *viewProjection,
    scalar_t pivotX,
    scalar_t pivotY,
    scalar_t pivotZ,
    scalar_t dirX,
    scalar_t dirY,
    scalar_t dirZ,
    scalar_t baseRightX,
    scalar_t baseRightY,
    scalar_t baseRightZ,
    scalar_t baseUpX,
    scalar_t baseUpY,
    scalar_t baseUpZ,
    scalar_t aspectRatio,
    scalar_t &outAngle) {
  const scalar_t clipX =
      viewProjection[0] * pivotX + viewProjection[4] * pivotY +
      viewProjection[8] * pivotZ + viewProjection[12];
  const scalar_t clipY =
      viewProjection[1] * pivotX + viewProjection[5] * pivotY +
      viewProjection[9] * pivotZ + viewProjection[13];
  const scalar_t clipW =
      viewProjection[3] * pivotX + viewProjection[7] * pivotY +
      viewProjection[11] * pivotZ + viewProjection[15];
  scalar_t dirScreenX = static_cast<scalar_t>(0.0f);
  scalar_t dirScreenY = static_cast<scalar_t>(0.0f);
  if (!resolveScreenDirection(
          viewProjection,
          clipX,
          clipY,
          clipW,
          dirX,
          dirY,
          dirZ,
          aspectRatio,
          dirScreenX,
          dirScreenY)) {
    return false;
  }
  return resolveBillboardScreenAngleFromDirScreen(
      viewProjection,
      pivotX,
      pivotY,
      pivotZ,
      dirScreenX,
      dirScreenY,
      baseRightX,
      baseRightY,
      baseRightZ,
      baseUpX,
      baseUpY,
      baseUpZ,
      aspectRatio,
      outAngle);
}

static constexpr inline bool resolveScreenAngleFromBillboardDir(
    const scalar_t *viewProjection,
    scalar_t pivotX,
    scalar_t pivotY,
    scalar_t pivotZ,
    scalar_t baseRightX,
    scalar_t baseRightY,
    scalar_t baseRightZ,
    scalar_t baseUpX,
    scalar_t baseUpY,
    scalar_t baseUpZ,
    scalar_t angle,
    scalar_t aspectRatio,
    scalar_t &outAngle) {
  const scalar_t clipX =
      viewProjection[0] * pivotX + viewProjection[4] * pivotY +
      viewProjection[8] * pivotZ + viewProjection[12];
  const scalar_t clipY =
      viewProjection[1] * pivotX + viewProjection[5] * pivotY +
      viewProjection[9] * pivotZ + viewProjection[13];
  const scalar_t clipW =
      viewProjection[3] * pivotX + viewProjection[7] * pivotY +
      viewProjection[11] * pivotZ + viewProjection[15];
  scalar_t s = static_cast<scalar_t>(0.0f);
  scalar_t c = static_cast<scalar_t>(1.0f);
  computeSinCos(angle, s, c);
  const scalar_t dirX = baseRightX * s + baseUpX * c;
  const scalar_t dirY = baseRightY * s + baseUpY * c;
  const scalar_t dirZ = baseRightZ * s + baseUpZ * c;
  scalar_t dirScreenX = static_cast<scalar_t>(0.0f);
  scalar_t dirScreenY = static_cast<scalar_t>(0.0f);
  if (!resolveScreenDirection(
          viewProjection,
          clipX,
          clipY,
          clipW,
          dirX,
          dirY,
          dirZ,
          aspectRatio,
          dirScreenX,
          dirScreenY)) {
    return false;
  }
  outAngle = std::atan2(dirScreenY, dirScreenX);
  return std::isfinite(outAngle);
}

static constexpr inline bool resolveScreenAngleFromBillboardSegment(
    const scalar_t *viewProjection,
    scalar_t pivotX,
    scalar_t pivotY,
    scalar_t pivotZ,
    scalar_t baseRightX,
    scalar_t baseRightY,
    scalar_t baseRightZ,
    scalar_t baseUpX,
    scalar_t baseUpY,
    scalar_t baseUpZ,
    scalar_t localTop,
    scalar_t localBottom,
    scalar_t angle,
    scalar_t aspectRatio,
    scalar_t &outAngle) {
  scalar_t dirX = static_cast<scalar_t>(0.0f);
  scalar_t dirY = static_cast<scalar_t>(0.0f);
  if (!resolveBillboardSegmentScreenDir(
          viewProjection,
          pivotX,
          pivotY,
          pivotZ,
          baseRightX,
          baseRightY,
          baseRightZ,
          baseUpX,
          baseUpY,
          baseUpZ,
          localTop,
          localBottom,
          angle,
          aspectRatio,
          dirX,
          dirY)) {
    return false;
  }
  outAngle = std::atan2(dirY, dirX);
  return std::isfinite(outAngle);
}

/**
 * @brief Emits one billboard quad into the wasm output buffer.
 * @param viewProjection Current view-projection matrix.
 * @param aspectRatio Viewport aspect ratio.
 * @param cameraX Camera world X position.
 * @param cameraY Camera world Y position.
 * @param cameraZ Camera world Z position.
 * @param pivotX Billboard pivot world X position.
 * @param pivotY Billboard pivot world Y position.
 * @param z Billboard pivot world Z position.
 * @param localLeft Local left extent relative to the pivot.
 * @param localRight Local right extent relative to the pivot.
 * @param localTop Local top extent relative to the pivot.
 * @param localBottom Local bottom extent relative to the pivot.
 * @param rotateDeg Element rotation in degrees.
 * @param u0 Left texture coordinate.
 * @param v0 Top texture coordinate.
 * @param u1 Right texture coordinate.
 * @param v1 Bottom texture coordinate.
 * @param renderMode Render mode defined by the generated layout constants.
 * @param viewRightX Camera-right basis X component.
 * @param viewRightY Camera-right basis Y component.
 * @param viewRightZ Camera-right basis Z component.
 * @param viewUpX Camera-up basis X component.
 * @param viewUpY Camera-up basis Y component.
 * @param viewUpZ Camera-up basis Z component.
 * @param opacity Final vertex opacity.
 * @param out Receives four vertices in wasm output layout order.
 * @param outSolveMode Receives the billboard angle solve path used by debug output.
 * @param outScreenAngleDeg Receives the resolved screen-facing angle in degrees.
 */
static constexpr inline void writeBillboardVertices(
    const scalar_t *viewProjection,
    scalar_t aspectRatio,
    scalar_t cameraX,
    scalar_t cameraY,
    scalar_t cameraZ,
    scalar_t pivotX,
    scalar_t pivotY,
    scalar_t z,
    scalar_t localLeft,
    scalar_t localRight,
    scalar_t localTop,
    scalar_t localBottom,
    scalar_t rotateDeg,
    scalar_t u0,
    scalar_t v0,
    scalar_t u1,
    scalar_t v1,
    int renderMode,
    scalar_t viewRightX,
    scalar_t viewRightY,
    scalar_t viewRightZ,
    scalar_t viewUpX,
    scalar_t viewUpY,
    scalar_t viewUpZ,
    float opacity,
    float *out,
    int &outSolveMode,
    scalar_t &outScreenAngleDeg) {
  scalar_t baseRightX = viewRightX;
  scalar_t baseRightY = viewRightY;
  scalar_t baseRightZ = viewRightZ;
  scalar_t baseUpX = viewUpX;
  scalar_t baseUpY = viewUpY;
  scalar_t baseUpZ = viewUpZ;
  scalar_t s = static_cast<scalar_t>(0.0f);
  scalar_t c = static_cast<scalar_t>(1.0f);
  const scalar_t angle = -toRadians(rotateDeg);
  bool resolved = false;
  const auto resolveFromScreenAngle = [&](scalar_t screenAngle) -> int {
    const scalar_t targetDirX = std::cos(screenAngle);
    const scalar_t targetDirY = std::sin(screenAngle);
    scalar_t dirScreenX = targetDirX;
    scalar_t dirScreenY = targetDirY;
    if (localTop < localBottom) {
      dirScreenX = -dirScreenX;
      dirScreenY = -dirScreenY;
    }
    scalar_t outAngle = static_cast<scalar_t>(0.0f);
    if (resolveBillboardScreenAngleFromDirScreen(
            viewProjection,
            pivotX,
            pivotY,
            z,
            dirScreenX,
            dirScreenY,
            baseRightX,
            baseRightY,
            baseRightZ,
            baseUpX,
            baseUpY,
            baseUpZ,
            aspectRatio,
            outAngle)) {
      const auto resolveVisualError = [&](scalar_t candidate) -> scalar_t {
        scalar_t actualAngle = static_cast<scalar_t>(0.0f);
        if (!resolveScreenAngleFromBillboardSegment(
                viewProjection,
                pivotX,
                pivotY,
                z,
                baseRightX,
                baseRightY,
                baseRightZ,
                baseUpX,
                baseUpY,
                baseUpZ,
                localTop,
                localBottom,
                candidate,
                aspectRatio,
                actualAngle)) {
          return 0;  // NaN
        }
        return std::abs(wrapRadians(actualAngle - screenAngle));
      };

      scalar_t selectedAngle = outAngle;
      scalar_t bestError = resolveVisualError(selectedAngle);
      const scalar_t altAngle =
          outAngle + static_cast<scalar_t>(180.0f) * kDegToRad;
      const scalar_t altError = resolveVisualError(altAngle);
      // The mirrored solution can yield the same projected segment direction
      // while avoiding a visual flip for asymmetric quads.
      if (altError < bestError) {
        selectedAngle = altAngle;
      }
      computeSinCos(selectedAngle, s, c);
      return 2;
    }
    return 0;
  };
  const auto resolveScreenBaseAngle = [&](scalar_t basisRightX,
                                          scalar_t basisRightY,
                                          scalar_t basisRightZ,
                                          scalar_t basisUpX,
                                          scalar_t basisUpY,
                                          scalar_t basisUpZ,
                                          scalar_t &outAngle) -> bool {
    bool ok = resolveScreenAngleFromBillboardSegment(
        viewProjection,
        pivotX,
        pivotY,
        z,
        basisRightX,
        basisRightY,
        basisRightZ,
        basisUpX,
        basisUpY,
        basisUpZ,
        localTop,
        localBottom,
        static_cast<scalar_t>(0.0f),
        aspectRatio,
        outAngle);
    if (!ok) {
      ok = resolveScreenAngleFromBillboardDir(
          viewProjection,
          pivotX,
          pivotY,
          z,
          basisRightX,
          basisRightY,
          basisRightZ,
          basisUpX,
          basisUpY,
          basisUpZ,
          static_cast<scalar_t>(0.0f),
          aspectRatio,
          outAngle);
    }
    return ok;
  };
  scalar_t screenBaseAngle = static_cast<scalar_t>(0.0f);
  bool hasScreenBase = false;
  if (renderMode == COMMON_RENDER_MODE_BILLBOARD_PERSPECTIVE) {
    scalar_t ldegRightX = baseRightX;
    scalar_t ldegRightY = baseRightY;
    scalar_t ldegRightZ = baseRightZ;
    scalar_t ldegUpX = baseUpX;
    scalar_t ldegUpY = baseUpY;
    scalar_t ldegUpZ = baseUpZ;
    const scalar_t forwardX = cameraX - pivotX;
    const scalar_t forwardY = cameraY - pivotY;
    const scalar_t forwardZ = cameraZ - z;
    resolveBillboardBasisFromForward(
        forwardX,
        forwardY,
        forwardZ,
        ldegRightX,
        ldegRightY,
        ldegRightZ,
        ldegUpX,
        ldegUpY,
        ldegUpZ);
    hasScreenBase = resolveScreenBaseAngle(
        ldegRightX,
        ldegRightY,
        ldegRightZ,
        ldegUpX,
        ldegUpY,
        ldegUpZ,
        screenBaseAngle);
  } else {
    hasScreenBase = resolveScreenBaseAngle(
        baseRightX,
        baseRightY,
        baseRightZ,
        baseUpX,
        baseUpY,
        baseUpZ,
        screenBaseAngle);
  }
  if (hasScreenBase) {
    const scalar_t screenAngle = screenBaseAngle + angle;
    if (renderMode == COMMON_RENDER_MODE_BILLBOARD_PERSPECTIVE) {
      outScreenAngleDeg = screenAngle / kDegToRad;
    }
    const int mode = resolveFromScreenAngle(screenAngle);
    if (mode != 0) {
      resolved = true;
      if (renderMode == COMMON_RENDER_MODE_BILLBOARD_PERSPECTIVE) {
        outSolveMode = mode;
      }
    }
  }
  if (!resolved) {
    computeSinCos(angle, s, c);
  }
  const scalar_t rightX = baseRightX * c - baseUpX * s;
  const scalar_t rightY = baseRightY * c - baseUpY * s;
  const scalar_t rightZ = baseRightZ * c - baseUpZ * s;
  const scalar_t upX = baseRightX * s + baseUpX * c;
  const scalar_t upY = baseRightY * s + baseUpY * c;
  const scalar_t upZ = baseRightZ * s + baseUpZ * c;

  const scalar_t lbx = pivotX + rightX * localLeft + upX * localBottom;
  const scalar_t lby = pivotY + rightY * localLeft + upY * localBottom;
  const scalar_t lbz = z + rightZ * localLeft + upZ * localBottom;
  const scalar_t rbx = pivotX + rightX * localRight + upX * localBottom;
  const scalar_t rby = pivotY + rightY * localRight + upY * localBottom;
  const scalar_t rbz = z + rightZ * localRight + upZ * localBottom;
  const scalar_t ltx = pivotX + rightX * localLeft + upX * localTop;
  const scalar_t lty = pivotY + rightY * localLeft + upY * localTop;
  const scalar_t ltz = z + rightZ * localLeft + upZ * localTop;
  const scalar_t rtx = pivotX + rightX * localRight + upX * localTop;
  const scalar_t rty = pivotY + rightY * localRight + upY * localTop;
  const scalar_t rtz = z + rightZ * localRight + upZ * localTop;

  out[0] = lbx;
  out[1] = lby;
  out[2] = lbz;
  out[3] = static_cast<float>(u0);
  out[4] = static_cast<float>(v0);
  out[5] = opacity;
  out[6] = rbx;
  out[7] = rby;
  out[8] = rbz;
  out[9] = static_cast<float>(u1);
  out[10] = static_cast<float>(v0);
  out[11] = opacity;
  out[12] = ltx;
  out[13] = lty;
  out[14] = ltz;
  out[15] = static_cast<float>(u0);
  out[16] = static_cast<float>(v1);
  out[17] = opacity;
  out[18] = rtx;
  out[19] = rty;
  out[20] = rtz;
  out[21] = static_cast<float>(u1);
  out[22] = static_cast<float>(v1);
  out[23] = opacity;
}

} // namespace msp_wasm::detail
