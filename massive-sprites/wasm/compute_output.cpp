// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

#include <array>
#include <cmath>
#include <limits>

#include "compute_billboard.h"
#include "compute_internal.h"

///////////////////////////////////////////////////////////////////////////////////////////////

namespace msp_wasm {

/**
 * @brief Emits visible sprite quads into the wasm output buffer.
 * @remarks The function can reuse prior output slots when signatures still
 * match, which keeps debug channels and pick indices aligned across frames.
 */
int writeOutputVertices(
    const std::vector<SpriteEntry> &entries,
    const SpriteInputView &sprite,
    const ElementInputView &element,
    int spriteCount,
    const scalar_t *viewMatrix,
    const scalar_t *viewProjection,
    scalar_t aspectRatio,
    scalar_t cameraX,
    scalar_t cameraY,
    scalar_t cameraZ,
    scalar_t nowMs,
    const std::vector<scalar_t> &pivotXValues,
    const std::vector<scalar_t> &pivotYValues,
    const std::vector<scalar_t> &pivotZValues,
    const std::vector<scalar_t> &spriteDistanceScaleFactors,
    const std::vector<unsigned char> &pivotCameraDependentFlags,
    const std::vector<TextureInfo> &textures,
    float *output,
    int *outTexIndices,
    std::vector<int> &entryOutputIndices,
    std::vector<int> &entryOutputCounts,
    EntryDebugBuffers *entryDebug,
    std::vector<std::uint64_t> &outputSignatures,
    bool reuseOutput,
    std::uint64_t cameraSignature,
    int outputEntryCount) {
  const scalar_t nanValue = std::numeric_limits<scalar_t>::quiet_NaN();
  std::vector<int> *entryElementIndices = nullptr;
  std::vector<int> *entryBillboardSolveModes = nullptr;
  std::vector<scalar_t> *entryBillboardScreenFromDeg = nullptr;
  std::vector<scalar_t> *entryBillboardScreenToDeg = nullptr;
  std::vector<scalar_t> *entryBillboardScreenAngleDeg = nullptr;
  std::vector<scalar_t> *entryRotateDeg = nullptr;
  std::vector<scalar_t> *entryFinalRotateDeg = nullptr;
  std::vector<scalar_t> *entryRotationFromDeg = nullptr;
  std::vector<scalar_t> *entryRotationToDeg = nullptr;
  std::vector<scalar_t> *entryRotationDurationMs = nullptr;
  std::vector<scalar_t> *entryFinalRotationFromDeg = nullptr;
  std::vector<scalar_t> *entryFinalRotationToDeg = nullptr;
  std::vector<scalar_t> *entryFinalRotationDurationMs = nullptr;
  const bool canReuseOutput =
      reuseOutput &&
      outputEntryCount >= 0 &&
      outputSignatures.size() == static_cast<size_t>(outputEntryCount);
  const size_t debugEntryCount =
      outputEntryCount > 0 ? static_cast<size_t>(outputEntryCount) : 0;
  if (entryDebug) {
    entryElementIndices = entryDebug->entryElementIndices;
    entryBillboardSolveModes = entryDebug->entryBillboardSolveModes;
    entryBillboardScreenFromDeg = entryDebug->entryBillboardScreenFromDeg;
    entryBillboardScreenToDeg = entryDebug->entryBillboardScreenToDeg;
    entryBillboardScreenAngleDeg = entryDebug->entryBillboardScreenAngleDeg;
    entryRotateDeg = entryDebug->entryRotateDeg;
    entryFinalRotateDeg = entryDebug->entryFinalRotateDeg;
    entryRotationFromDeg = entryDebug->entryRotationFromDeg;
    entryRotationToDeg = entryDebug->entryRotationToDeg;
    entryRotationDurationMs = entryDebug->entryRotationDurationMs;
    entryFinalRotationFromDeg = entryDebug->entryFinalRotationFromDeg;
    entryFinalRotationToDeg = entryDebug->entryFinalRotationToDeg;
    entryFinalRotationDurationMs = entryDebug->entryFinalRotationDurationMs;
    if (!canReuseOutput ||
        entryElementIndices->size() != debugEntryCount) {
      entryElementIndices->assign(debugEntryCount, 0);
      entryBillboardSolveModes->assign(debugEntryCount, 0);
      entryBillboardScreenFromDeg->assign(debugEntryCount, nanValue);
      entryBillboardScreenToDeg->assign(debugEntryCount, nanValue);
      entryBillboardScreenAngleDeg->assign(debugEntryCount, nanValue);
      entryRotateDeg->assign(debugEntryCount, nanValue);
      entryFinalRotateDeg->assign(debugEntryCount, nanValue);
      entryRotationFromDeg->assign(debugEntryCount, nanValue);
      entryRotationToDeg->assign(debugEntryCount, nanValue);
      entryRotationDurationMs->assign(debugEntryCount, nanValue);
      entryFinalRotationFromDeg->assign(debugEntryCount, nanValue);
      entryFinalRotationToDeg->assign(debugEntryCount, nanValue);
      entryFinalRotationDurationMs->assign(debugEntryCount, nanValue);
    }
  }

  int outputIndex = 0;
  scalar_t billboardRightX = static_cast<scalar_t>(1.0f);
  scalar_t billboardRightY = static_cast<scalar_t>(0.0f);
  scalar_t billboardRightZ = static_cast<scalar_t>(0.0f);
  scalar_t billboardUpX = static_cast<scalar_t>(0.0f);
  scalar_t billboardUpY = static_cast<scalar_t>(1.0f);
  scalar_t billboardUpZ = static_cast<scalar_t>(0.0f);
  detail::resolveBillboardBasis(
      viewMatrix,
      billboardRightX,
      billboardRightY,
      billboardRightZ,
      billboardUpX,
      billboardUpY,
      billboardUpZ);
  const scalar_t viewRightX = viewMatrix[0];
  const scalar_t viewRightY = viewMatrix[4];
  const scalar_t viewRightZ = viewMatrix[8];
  const scalar_t viewUpX = viewMatrix[1];
  const scalar_t viewUpY = viewMatrix[5];
  const scalar_t viewUpZ = viewMatrix[9];
  const scalar_t safeAspectRatio =
      std::isfinite(aspectRatio) && aspectRatio > static_cast<scalar_t>(0.0f)
          ? aspectRatio
          : static_cast<scalar_t>(1.0f);

  if (!canReuseOutput && outputEntryCount >= 0) {
    outputSignatures.resize(static_cast<size_t>(outputEntryCount));
  }

  entryOutputIndices.assign(entries.size(), -1);
  entryOutputCounts.assign(entries.size(), 0);
  for (size_t entryIndex = 0; entryIndex < entries.size(); ++entryIndex) {
    const auto &entry = entries[entryIndex];
    const int index = entry.index;
    const int ownerSlot = static_cast<int>(element.ownerSlotValues[index]);
    if (ownerSlot < 0 || ownerSlot >= spriteCount) {
      continue;
    }
    const int texIndex = entry.texIndex;
    if (texIndex < 0 || texIndex >= static_cast<int>(textures.size()) ||
        textures[static_cast<size_t>(texIndex)].valid == 0) {
      continue;
    }
    const auto &texture = textures[static_cast<size_t>(texIndex)];
    const scalar_t pivotX = pivotXValues[static_cast<size_t>(index)];
    const scalar_t pivotY = pivotYValues[static_cast<size_t>(index)];
    const scalar_t pivotZ = pivotZValues[static_cast<size_t>(index)];
    const float opacity = static_cast<float>(entry.opacity);
    const scalar_t z = pivotZ;
    const scalar_t distanceScale =
        ownerSlot >= 0 && static_cast<size_t>(ownerSlot) < spriteDistanceScaleFactors.size()
            ? spriteDistanceScaleFactors[static_cast<size_t>(ownerSlot)]
            : static_cast<scalar_t>(1.0f);
    const scalar_t width =
        texture.width * element.scaleValues[index] * distanceScale;
    const scalar_t height =
        texture.height * element.scaleValues[index] * distanceScale;
    const scalar_t halfWidth = width * static_cast<scalar_t>(0.5f);
    const scalar_t halfHeight = height * static_cast<scalar_t>(0.5f);
    const scalar_t anchorOffsetX =
        element.anchorXValues[index] * halfWidth;
    const scalar_t anchorOffsetY =
        element.anchorYValues[index] * halfHeight;
    const scalar_t rotateDeg = element.finalRotateDegValues[index];
    const scalar_t flipScaleX =
        std::isfinite(element.autoFlipXValues[index])
            ? element.autoFlipXValues[index]
            : static_cast<scalar_t>(1.0f);
    const scalar_t flipScaleY =
        std::isfinite(element.autoFlipYValues[index])
            ? element.autoFlipYValues[index]
            : static_cast<scalar_t>(1.0f);
    const int renderMode =
        static_cast<int>(element.renderModeValues[index]);
    const std::uint64_t baseSignature = [&]() {
      std::uint64_t signature = 1469598103934665603ULL;
      signature = hashCombine(signature, hashInt(index));
      signature = hashCombine(signature, hashScalar(pivotX));
      signature = hashCombine(signature, hashScalar(pivotY));
      signature = hashCombine(signature, hashScalar(pivotZ));
      signature = hashCombine(signature, hashScalar(element.scaleValues[index]));
      signature = hashCombine(signature, hashScalar(distanceScale));
      signature = hashCombine(signature, hashScalar(element.anchorXValues[index]));
      signature = hashCombine(signature, hashScalar(element.anchorYValues[index]));
      signature = hashCombine(signature, hashScalar(rotateDeg));
      signature = hashCombine(signature, hashScalar(flipScaleX));
      signature = hashCombine(signature, hashScalar(flipScaleY));
      signature = hashCombine(signature, hashScalar(entry.opacity));
      signature = hashCombine(signature, hashInt(renderMode));
      signature = hashCombine(signature, hashScalar(texture.width));
      signature = hashCombine(signature, hashScalar(texture.height));
      return signature;
    }();
    const bool pivotCameraDependent =
        static_cast<size_t>(index) < pivotCameraDependentFlags.size() &&
        pivotCameraDependentFlags[static_cast<size_t>(index)] != 0;
    const bool useCameraSignature =
        renderMode == COMMON_RENDER_MODE_BILLBOARD_PERSPECTIVE ||
        renderMode == COMMON_RENDER_MODE_BILLBOARD ||
        pivotCameraDependent;
    const int entryFirstOutputIndex = outputIndex;
    const bool isTiled = !texture.tiles.empty();
    const int partCount =
        isTiled ? static_cast<int>(texture.tiles.size()) : 1;
    entryOutputIndices[entryIndex] = entryFirstOutputIndex;
    entryOutputCounts[entryIndex] = partCount;
    for (int partIndex = 0; partIndex < partCount; ++partIndex) {
      scalar_t localLeftRatio = static_cast<scalar_t>(-0.5f);
      scalar_t localTopRatio = static_cast<scalar_t>(-0.5f);
      scalar_t localRightRatio = static_cast<scalar_t>(0.5f);
      scalar_t localBottomRatio = static_cast<scalar_t>(0.5f);
      scalar_t u0 = texture.u0;
      scalar_t v0 = texture.v0;
      scalar_t u1 = texture.u1;
      scalar_t v1 = texture.v1;
      int pageId = texture.pageId;
      if (isTiled) {
        const auto &tile = texture.tiles[static_cast<size_t>(partIndex)];
        localLeftRatio = tile.leftRatio;
        localTopRatio = tile.topRatio;
        localRightRatio = tile.rightRatio;
        localBottomRatio = tile.bottomRatio;
        u0 = tile.u0;
        v0 = tile.v0;
        u1 = tile.u1;
        v1 = tile.v1;
        pageId = tile.pageId;
      }
      const scalar_t uCenter = (u0 + u1) * static_cast<scalar_t>(0.5f);
      const scalar_t vCenter = (v0 + v1) * static_cast<scalar_t>(0.5f);
      const scalar_t uHalf = (u1 - u0) * static_cast<scalar_t>(0.5f);
      const scalar_t vHalf = (v1 - v0) * static_cast<scalar_t>(0.5f);
      const scalar_t effectiveU0 = uCenter - uHalf;
      const scalar_t effectiveU1 = uCenter + uHalf;
      const scalar_t effectiveV0 = vCenter - vHalf;
      const scalar_t effectiveV1 = vCenter + vHalf;
      const scalar_t localLeft =
          (width * localLeftRatio - anchorOffsetX) * flipScaleX;
      const scalar_t localTop =
          (height * localTopRatio - anchorOffsetY) * flipScaleY;
      const scalar_t localRight =
          (width * localRightRatio - anchorOffsetX) * flipScaleX;
      const scalar_t localBottom =
          (height * localBottomRatio - anchorOffsetY) * flipScaleY;

      std::uint64_t signature = baseSignature;
      signature = hashCombine(signature, hashInt(pageId));
      signature = hashCombine(signature, hashScalar(localLeftRatio));
      signature = hashCombine(signature, hashScalar(localTopRatio));
      signature = hashCombine(signature, hashScalar(localRightRatio));
      signature = hashCombine(signature, hashScalar(localBottomRatio));
      signature = hashCombine(signature, hashScalar(effectiveU0));
      signature = hashCombine(signature, hashScalar(effectiveV0));
      signature = hashCombine(signature, hashScalar(effectiveU1));
      signature = hashCombine(signature, hashScalar(effectiveV1));
      if (useCameraSignature) {
        signature = hashCombine(signature, cameraSignature);
      }

      bool shouldWrite = true;
      if (canReuseOutput) {
        const std::uint64_t previous =
            outputSignatures[static_cast<size_t>(outputIndex)];
        if (previous == signature) {
          shouldWrite = false;
        } else {
          outputSignatures[static_cast<size_t>(outputIndex)] = signature;
        }
      } else if (outputIndex >= 0 &&
                 static_cast<size_t>(outputIndex) < outputSignatures.size()) {
        outputSignatures[static_cast<size_t>(outputIndex)] = signature;
      }

      if (shouldWrite) {
        float *out = output + outputIndex * WASM_OUTPUT_STRIDE;
        int billboardSolveMode = 0;
        scalar_t billboardScreenAngleDeg = nanValue;
        if (renderMode == COMMON_RENDER_MODE_BILLBOARD_PERSPECTIVE ||
            renderMode == COMMON_RENDER_MODE_BILLBOARD) {
          detail::writeBillboardVertices(
              viewProjection,
              safeAspectRatio,
              cameraX,
              cameraY,
              cameraZ,
              pivotX,
              pivotY,
              z,
              localLeft,
              localRight,
              localTop,
              localBottom,
              rotateDeg,
              effectiveU0,
              effectiveV0,
              effectiveU1,
              effectiveV1,
              renderMode,
              viewRightX,
              viewRightY,
              viewRightZ,
              viewUpX,
              viewUpY,
              viewUpZ,
              opacity,
              out,
              billboardSolveMode,
              billboardScreenAngleDeg);
        } else if (rotateDeg == 0.0f) {
          const scalar_t left = pivotX + localLeft;
          const scalar_t right = pivotX + localRight;
          const scalar_t top = pivotY + localTop;
          const scalar_t bottom = pivotY + localBottom;

          out[0] = left;
          out[1] = bottom;
          out[2] = z;
          out[3] = effectiveU0;
          out[4] = effectiveV0;
          out[5] = opacity;
          out[6] = right;
          out[7] = bottom;
          out[8] = z;
          out[9] = effectiveU1;
          out[10] = effectiveV0;
          out[11] = opacity;
          out[12] = left;
          out[13] = top;
          out[14] = z;
          out[15] = effectiveU0;
          out[16] = effectiveV1;
          out[17] = opacity;
          out[18] = right;
          out[19] = top;
          out[20] = z;
          out[21] = effectiveU1;
          out[22] = effectiveV1;
          out[23] = opacity;
        } else {
          const scalar_t angle = -toRadians(rotateDeg);
          scalar_t s = 0.0f;
          scalar_t c = 1.0f;
          computeSinCos(angle, s, c);

          const scalar_t lbx = pivotX + localLeft * c - localBottom * s;
          const scalar_t lby = pivotY + localLeft * s + localBottom * c;
          const scalar_t rbx = pivotX + localRight * c - localBottom * s;
          const scalar_t rby = pivotY + localRight * s + localBottom * c;
          const scalar_t ltx = pivotX + localLeft * c - localTop * s;
          const scalar_t lty = pivotY + localLeft * s + localTop * c;
          const scalar_t rtx = pivotX + localRight * c - localTop * s;
          const scalar_t rty = pivotY + localRight * s + localTop * c;

          out[0] = lbx;
          out[1] = lby;
          out[2] = z;
          out[3] = effectiveU0;
          out[4] = effectiveV0;
          out[5] = opacity;
          out[6] = rbx;
          out[7] = rby;
          out[8] = z;
          out[9] = effectiveU1;
          out[10] = effectiveV0;
          out[11] = opacity;
          out[12] = ltx;
          out[13] = lty;
          out[14] = z;
          out[15] = effectiveU0;
          out[16] = effectiveV1;
          out[17] = opacity;
          out[18] = rtx;
          out[19] = rty;
          out[20] = z;
          out[21] = effectiveU1;
          out[22] = effectiveV1;
          out[23] = opacity;
        }

        if (outTexIndices) {
          outTexIndices[outputIndex] = pageId;
        }
        if (entryDebug) {
          (*entryElementIndices)[static_cast<size_t>(outputIndex)] = index;
          (*entryBillboardSolveModes)[static_cast<size_t>(outputIndex)] =
              billboardSolveMode;
          (*entryBillboardScreenAngleDeg)[static_cast<size_t>(outputIndex)] =
              billboardScreenAngleDeg;
          (*entryRotateDeg)[static_cast<size_t>(outputIndex)] =
              element.rotateDegValues[index];
          (*entryFinalRotateDeg)[static_cast<size_t>(outputIndex)] =
              element.finalRotateDegValues[index];
          (*entryRotationFromDeg)[static_cast<size_t>(outputIndex)] =
              element.rotationFromValues[index];
          (*entryRotationToDeg)[static_cast<size_t>(outputIndex)] =
              element.rotationToValues[index];
          (*entryRotationDurationMs)[static_cast<size_t>(outputIndex)] =
              element.rotationDurationValues[index];
          (*entryFinalRotationFromDeg)[static_cast<size_t>(outputIndex)] =
              element.finalRotateFromValues[index];
          (*entryFinalRotationToDeg)[static_cast<size_t>(outputIndex)] =
              element.finalRotateToValues[index];
          (*entryFinalRotationDurationMs)[static_cast<size_t>(outputIndex)] =
              element.finalRotateDurationValues[index];
        }
      }
      outputIndex += 1;
    }
  }

  return outputIndex;
}

/**
 * @brief Maps `[0, 1]` onto a triangular 0-1-0 ramp used by repeating gradients.
 */
static constexpr inline scalar_t pingPongRatio(scalar_t t) {
  const scalar_t clamped = std::max(
      static_cast<scalar_t>(0.0f),
      std::min(static_cast<scalar_t>(1.0f), t));
  if (clamped <= static_cast<scalar_t>(0.5f)) {
    return clamped * static_cast<scalar_t>(2.0f);
  }
  return (static_cast<scalar_t>(1.0f) - clamped) * static_cast<scalar_t>(2.0f);
}

/**
 * @brief Writes one polyline vertex in the packed output layout.
 */
static constexpr inline void writePolylineVertex(
    float *output,
    int vertexIndex,
    scalar_t x,
    scalar_t y,
    scalar_t z,
    scalar_t r,
    scalar_t g,
    scalar_t b,
    scalar_t a) {
  float *out = output + static_cast<size_t>(vertexIndex) * POLYLINE_OUTPUT_STRIDE;
  out[0] = static_cast<float>(x);
  out[1] = static_cast<float>(y);
  out[2] = static_cast<float>(z);
  out[3] = static_cast<float>(r);
  out[4] = static_cast<float>(g);
  out[5] = static_cast<float>(b);
  out[6] = static_cast<float>(a);
}

/**
 * @brief Writes one 3D polyline segment quad using the supplied plane normal.
 */
static inline int writePolylineSegmentQuad3d(
    float *output,
    int vertexOffset,
    scalar_t startX,
    scalar_t startY,
    scalar_t startZ,
    scalar_t endX,
    scalar_t endY,
    scalar_t endZ,
    scalar_t planeNormalX,
    scalar_t planeNormalY,
    scalar_t planeNormalZ,
    scalar_t width,
    const std::array<scalar_t, 4> &colorStart,
    const std::array<scalar_t, 4> &colorEnd) {
  if (!output || !(width > static_cast<scalar_t>(0.0f))) {
    return vertexOffset;
  }
  const scalar_t dx = endX - startX;
  const scalar_t dy = endY - startY;
  const scalar_t dz = endZ - startZ;
  const scalar_t lenSq = dx * dx + dy * dy + dz * dz;
  if (!(lenSq > static_cast<scalar_t>(0.0f))) {
    return vertexOffset;
  }

  const scalar_t nxPlane = planeNormalY * dz - planeNormalZ * dy;
  const scalar_t nyPlane = planeNormalZ * dx - planeNormalX * dz;
  const scalar_t nzPlane = planeNormalX * dy - planeNormalY * dx;
  const scalar_t normalLenSq =
      nxPlane * nxPlane + nyPlane * nyPlane + nzPlane * nzPlane;
  if (!(normalLenSq > static_cast<scalar_t>(0.0f))) {
    return vertexOffset;
  }

  const scalar_t normalLen = std::sqrt(normalLenSq);
  const scalar_t invNormalLen = static_cast<scalar_t>(1.0f) / normalLen;
  const scalar_t halfWidth = width * static_cast<scalar_t>(0.5f);
  const scalar_t offsetX = nxPlane * invNormalLen * halfWidth;
  const scalar_t offsetY = nyPlane * invNormalLen * halfWidth;
  const scalar_t offsetZ = nzPlane * invNormalLen * halfWidth;

  const scalar_t v0x = startX + offsetX;
  const scalar_t v0y = startY + offsetY;
  const scalar_t v0z = startZ + offsetZ;
  const scalar_t v1x = startX - offsetX;
  const scalar_t v1y = startY - offsetY;
  const scalar_t v1z = startZ - offsetZ;
  const scalar_t v2x = endX + offsetX;
  const scalar_t v2y = endY + offsetY;
  const scalar_t v2z = endZ + offsetZ;
  const scalar_t v3x = endX - offsetX;
  const scalar_t v3y = endY - offsetY;
  const scalar_t v3z = endZ - offsetZ;

  writePolylineVertex(
      output,
      vertexOffset++,
      v0x,
      v0y,
      v0z,
      colorStart[0],
      colorStart[1],
      colorStart[2],
      colorStart[3]);
  writePolylineVertex(
      output,
      vertexOffset++,
      v1x,
      v1y,
      v1z,
      colorStart[0],
      colorStart[1],
      colorStart[2],
      colorStart[3]);
  writePolylineVertex(
      output,
      vertexOffset++,
      v2x,
      v2y,
      v2z,
      colorEnd[0],
      colorEnd[1],
      colorEnd[2],
      colorEnd[3]);
  writePolylineVertex(
      output,
      vertexOffset++,
      v2x,
      v2y,
      v2z,
      colorEnd[0],
      colorEnd[1],
      colorEnd[2],
      colorEnd[3]);
  writePolylineVertex(
      output,
      vertexOffset++,
      v1x,
      v1y,
      v1z,
      colorStart[0],
      colorStart[1],
      colorStart[2],
      colorStart[3]);
  writePolylineVertex(
      output,
      vertexOffset++,
      v3x,
      v3y,
      v3z,
      colorEnd[0],
      colorEnd[1],
      colorEnd[2],
      colorEnd[3]);
  return vertexOffset;
}

/**
 * @brief Writes one solid-color triangle into the polyline output buffer.
 */
static constexpr inline int writePolylineTriangle(
    float *output,
    int vertexOffset,
    scalar_t ax,
    scalar_t ay,
    scalar_t bx,
    scalar_t by,
    scalar_t cx,
    scalar_t cy,
    scalar_t r,
    scalar_t g,
    scalar_t b,
    scalar_t a) {
  writePolylineVertex(
      output,
      vertexOffset++,
      ax,
      ay,
      static_cast<scalar_t>(0.0f),
      r,
      g,
      b,
      a);
  writePolylineVertex(
      output,
      vertexOffset++,
      bx,
      by,
      static_cast<scalar_t>(0.0f),
      r,
      g,
      b,
      a);
  writePolylineVertex(
      output,
      vertexOffset++,
      cx,
      cy,
      static_cast<scalar_t>(0.0f),
      r,
      g,
      b,
      a);
  return vertexOffset;
}

/**
 * @brief Emits a triangle fan between two unit-radius directions around a node.
 */
static inline int writePolylineJoinFanVertices(
    float *output,
    int vertexOffset,
    scalar_t centerX,
    scalar_t centerY,
    scalar_t radius,
    scalar_t dir0X,
    scalar_t dir0Y,
    scalar_t dir1X,
    scalar_t dir1Y,
    int intermediatePointCount,
    scalar_t r,
    scalar_t g,
    scalar_t b,
    scalar_t a) {
  if (!(radius > static_cast<scalar_t>(0.0f)) ||
      intermediatePointCount < 0) {
    return vertexOffset;
  }

  scalar_t previousX = centerX + dir0X * radius;
  scalar_t previousY = centerY + dir0Y * radius;
  const scalar_t angle0 = std::atan2(dir0Y, dir0X);
  const scalar_t angle1 = std::atan2(dir1Y, dir1X);
  const scalar_t delta = wrapRadians(angle1 - angle0);

  for (int pointIndex = 0; pointIndex <= intermediatePointCount; ++pointIndex) {
    scalar_t nextX = centerX + dir1X * radius;
    scalar_t nextY = centerY + dir1Y * radius;
    if (pointIndex < intermediatePointCount) {
      const scalar_t t =
          static_cast<scalar_t>(pointIndex + 1) /
          static_cast<scalar_t>(intermediatePointCount + 1);
      const scalar_t angle = angle0 + delta * t;
      scalar_t s = static_cast<scalar_t>(0.0f);
      scalar_t c = static_cast<scalar_t>(1.0f);
      computeSinCos(angle, s, c);
      nextX = centerX + c * radius;
      nextY = centerY + s * radius;
    }
    vertexOffset = writePolylineTriangle(
        output,
        vertexOffset,
        centerX,
        centerY,
        previousX,
        previousY,
        nextX,
        nextY,
        r,
        g,
        b,
        a);
    previousX = nextX;
    previousY = nextY;
  }

  return vertexOffset;
}

/**
 * @brief Emits a semicircular cap triangle fan at one polyline end.
 */
static inline int writePolylineCapFanVertices(
    float *output,
    int vertexOffset,
    scalar_t centerX,
    scalar_t centerY,
    scalar_t radius,
    scalar_t ux,
    scalar_t uy,
    scalar_t nx,
    scalar_t ny,
    bool startCap,
    int pointCount,
    scalar_t r,
    scalar_t g,
    scalar_t b,
    scalar_t a) {
  if (!(radius > static_cast<scalar_t>(0.0f)) || pointCount < 1) {
    return vertexOffset;
  }

  const scalar_t tangentX = startCap ? -ux : ux;
  const scalar_t tangentY = startCap ? -uy : uy;
  scalar_t previousX = centerX + nx * radius;
  scalar_t previousY = centerY + ny * radius;

  for (int pointIndex = 0; pointIndex <= pointCount; ++pointIndex) {
    const scalar_t theta =
        kPi * static_cast<scalar_t>(pointIndex + 1) /
        static_cast<scalar_t>(pointCount + 1);
    scalar_t s = static_cast<scalar_t>(0.0f);
    scalar_t c = static_cast<scalar_t>(1.0f);
    computeSinCos(theta, s, c);
    const scalar_t nextX =
        centerX + (nx * c + tangentX * s) * radius;
    const scalar_t nextY =
        centerY + (ny * c + tangentY * s) * radius;
    vertexOffset = writePolylineTriangle(
        output,
        vertexOffset,
        centerX,
        centerY,
        previousX,
        previousY,
        nextX,
        nextY,
        r,
        g,
        b,
        a);
    previousX = nextX;
    previousY = nextY;
  }

  return vertexOffset;
}

/**
 * @brief Emits leaderline geometry for the currently visible elements.
 */
int writeLeaderlineVertices(
    const SpriteInputView &sprite,
    const ElementInputView &element,
    int spriteCount,
    int elementCount,
    const scalar_t *viewMatrix,
    const std::vector<scalar_t> &pivotXValues,
    const std::vector<scalar_t> &pivotYValues,
    const std::vector<scalar_t> &pivotZValues,
    const std::vector<scalar_t> &basisRightXValues,
    const std::vector<scalar_t> &basisRightYValues,
    const std::vector<scalar_t> &basisRightZValues,
    const std::vector<scalar_t> &basisUpXValues,
    const std::vector<scalar_t> &basisUpYValues,
    const std::vector<scalar_t> &basisUpZValues,
    const std::vector<scalar_t> &spriteDistanceScaleFactors,
    float *output,
    std::vector<LeaderlineEntry> *entries) {
  if (entries) {
    entries->clear();
    if (elementCount > 0 && entries->capacity() < static_cast<size_t>(elementCount)) {
      entries->reserve(static_cast<size_t>(elementCount));
    }
  }
  if (!output || elementCount <= 0) {
    return 0;
  }

  int vertexOffset = 0;
  for (int i = 0; i < elementCount; ++i) {
    const int ownerSlot = static_cast<int>(element.ownerSlotValues[i]);
    if (ownerSlot < 0 || ownerSlot >= spriteCount) {
      continue;
    }
    const scalar_t distanceScale =
        static_cast<size_t>(ownerSlot) < spriteDistanceScaleFactors.size()
            ? spriteDistanceScaleFactors[static_cast<size_t>(ownerSlot)]
            : static_cast<scalar_t>(1.0f);
    const scalar_t width = element.leaderlineWidthValues[i] * distanceScale;
    if (!(width > static_cast<scalar_t>(0.0f))) {
      continue;
    }

    const scalar_t selfOpacity =
        resolveElementRenderOpacity(sprite, element, spriteCount, i);
    if (!(selfOpacity > static_cast<scalar_t>(0.0f))) {
      continue;
    }

    scalar_t startX = sprite.xValues[ownerSlot];
    scalar_t startY = sprite.yValues[ownerSlot];
    scalar_t startZ = sprite.zValues[ownerSlot];
    scalar_t originLocationOpacity = selfOpacity;
    scalar_t basisRightX = static_cast<scalar_t>(1.0f);
    scalar_t basisRightY = static_cast<scalar_t>(0.0f);
    scalar_t basisRightZ = static_cast<scalar_t>(0.0f);
    scalar_t basisUpX = static_cast<scalar_t>(0.0f);
    scalar_t basisUpY = static_cast<scalar_t>(1.0f);
    scalar_t basisUpZ = static_cast<scalar_t>(0.0f);
    const int originLocationSlot = static_cast<int>(element.originLocationSlotValues[i]);
    const bool hasOriginLocation =
        originLocationSlot >= 0 && originLocationSlot < elementCount && originLocationSlot != i;
    if (hasOriginLocation) {
      const bool useResolvedAnchor =
          element.originLocationUseResolvedAnchorValues[i] != static_cast<scalar_t>(0.0f);
      const size_t originLocationIndex = static_cast<size_t>(originLocationSlot);
      const int originLocationOwnerSlot =
          static_cast<int>(element.ownerSlotValues[originLocationSlot]);
      startX = pivotXValues[originLocationIndex];
      startY = pivotYValues[originLocationIndex];
      startZ = pivotZValues[originLocationIndex];
      if (originLocationIndex < basisRightXValues.size()) {
        basisRightX = basisRightXValues[originLocationIndex];
        basisRightY = basisRightYValues[originLocationIndex];
        basisRightZ = basisRightZValues[originLocationIndex];
      }
      if (originLocationIndex < basisUpXValues.size()) {
        basisUpX = basisUpXValues[originLocationIndex];
        basisUpY = basisUpYValues[originLocationIndex];
        basisUpZ = basisUpZValues[originLocationIndex];
      }
      if (!useResolvedAnchor) {
        const scalar_t originLocationDistanceScale =
            originLocationOwnerSlot >= 0 &&
                    static_cast<size_t>(originLocationOwnerSlot) <
                        spriteDistanceScaleFactors.size()
                ? spriteDistanceScaleFactors[static_cast<size_t>(originLocationOwnerSlot)]
                : static_cast<scalar_t>(1.0f);
        const scalar_t parentScale = element.scaleValues[originLocationSlot];
        const scalar_t halfWidth =
            element.widthValues[originLocationSlot] * parentScale *
            originLocationDistanceScale * static_cast<scalar_t>(0.5f);
        const scalar_t halfHeight =
            element.heightValues[originLocationSlot] * parentScale *
            originLocationDistanceScale * static_cast<scalar_t>(0.5f);
        const scalar_t anchorOffsetX =
            element.anchorXValues[originLocationSlot] * halfWidth;
        const scalar_t anchorOffsetY =
            element.anchorYValues[originLocationSlot] * halfHeight;
        startX -= basisRightX * anchorOffsetX + basisUpX * anchorOffsetY;
        startY -= basisRightY * anchorOffsetX + basisUpY * anchorOffsetY;
        startZ -= basisRightZ * anchorOffsetX + basisUpZ * anchorOffsetY;
      }
      if (originLocationOwnerSlot >= 0 && originLocationOwnerSlot < spriteCount) {
        originLocationOpacity = resolveElementRenderOpacity(
            sprite,
            element,
            spriteCount,
            originLocationSlot);
      } else {
        originLocationOpacity = static_cast<scalar_t>(0.0f);
      }
    }

    const scalar_t opacity =
        std::min(selfOpacity, originLocationOpacity);
    if (!(opacity > static_cast<scalar_t>(0.0f))) {
      continue;
    }

    const size_t elementIndex = static_cast<size_t>(i);
    const scalar_t endX = pivotXValues[elementIndex];
    const scalar_t endY = pivotYValues[elementIndex];
    const scalar_t endZ = pivotZValues[elementIndex];
    const scalar_t dx = endX - startX;
    const scalar_t dy = endY - startY;
    const scalar_t dz = endZ - startZ;
    const scalar_t du = dx * basisRightX + dy * basisRightY + dz * basisRightZ;
    const scalar_t dv = dx * basisUpX + dy * basisUpY + dz * basisUpZ;
    const scalar_t lenSq = du * du + dv * dv;
    if (!(lenSq > static_cast<scalar_t>(0.0f))) {
      continue;
    }

    if (entries) {
      int layer = static_cast<int>(element.layerValues[i]);
      int order = static_cast<int>(element.orderValues[i]);
      if (hasOriginLocation) {
        const int originLocationLayer = static_cast<int>(element.layerValues[originLocationSlot]);
        const int originLocationOrder = static_cast<int>(element.orderValues[originLocationSlot]);
        layer = std::min(layer, originLocationLayer);
        order = std::min(order, originLocationOrder);
      }
      scalar_t spriteDepth = static_cast<scalar_t>(0.0f);
      if (viewMatrix) {
        const scalar_t sx = sprite.xValues[ownerSlot];
        const scalar_t sy = sprite.yValues[ownerSlot];
        const scalar_t sz = sprite.zValues[ownerSlot];
        spriteDepth =
            viewMatrix[2] * sx + viewMatrix[6] * sy + viewMatrix[10] * sz +
            viewMatrix[14];
      }
      entries->push_back(LeaderlineEntry{
          i,
          layer,
          order,
          spriteDepth,
          vertexOffset,
          6});
    }
    const scalar_t len = std::sqrt(lenSq);
    const scalar_t invLen = static_cast<scalar_t>(1.0f) / len;
    const scalar_t ux = du * invLen;
    const scalar_t uy = dv * invLen;
    const scalar_t nxPlane = -uy;
    const scalar_t nyPlane = ux;
    const scalar_t nx =
        basisRightX * nxPlane + basisUpX * nyPlane;
    const scalar_t ny =
        basisRightY * nxPlane + basisUpY * nyPlane;
    const scalar_t nz =
        basisRightZ * nxPlane + basisUpZ * nyPlane;

    const scalar_t repeatLength =
        element.leaderlineRepeatLengthValues[i];
    const scalar_t color0R =
        element.leaderlineColor0RValues[i];
    const scalar_t color0G =
        element.leaderlineColor0GValues[i];
    const scalar_t color0B =
        element.leaderlineColor0BValues[i];
    const scalar_t color0A =
        element.leaderlineColor0AValues[i];
    const scalar_t color1R =
        element.leaderlineColor1RValues[i];
    const scalar_t color1G =
        element.leaderlineColor1GValues[i];
    const scalar_t color1B =
        element.leaderlineColor1BValues[i];
    const scalar_t color1A =
        element.leaderlineColor1AValues[i];

    const auto resolveColor = [&](scalar_t length) {
      scalar_t t = static_cast<scalar_t>(0.0f);
      if (repeatLength > static_cast<scalar_t>(0.0f)) {
        const scalar_t mod =
            std::fmod(length, repeatLength);
        t = repeatLength > static_cast<scalar_t>(0.0f)
            ? pingPongRatio(mod / repeatLength)
            : static_cast<scalar_t>(0.0f);
      }
      const scalar_t r = color0R + (color1R - color0R) * t;
      const scalar_t g = color0G + (color1G - color0G) * t;
      const scalar_t b = color0B + (color1B - color0B) * t;
      const scalar_t a =
          (color0A + (color1A - color0A) * t) * opacity;
      return std::array<scalar_t, 4>{r, g, b, a};
    };

    const auto colorStart = resolveColor(static_cast<scalar_t>(0.0f));
    const auto colorEnd = resolveColor(len);

    const scalar_t half = width * static_cast<scalar_t>(0.5f);
    const scalar_t offsetX = nx * half;
    const scalar_t offsetY = ny * half;
    const scalar_t offsetZ = nz * half;
    const scalar_t v0x = startX + offsetX;
    const scalar_t v0y = startY + offsetY;
    const scalar_t v0z = startZ + offsetZ;
    const scalar_t v1x = startX - offsetX;
    const scalar_t v1y = startY - offsetY;
    const scalar_t v1z = startZ - offsetZ;
    const scalar_t v2x = endX + offsetX;
    const scalar_t v2y = endY + offsetY;
    const scalar_t v2z = endZ + offsetZ;
    const scalar_t v3x = endX - offsetX;
    const scalar_t v3y = endY - offsetY;
    const scalar_t v3z = endZ - offsetZ;

    writePolylineVertex(
        output,
        vertexOffset++,
        v0x,
        v0y,
        v0z,
        colorStart[0],
        colorStart[1],
        colorStart[2],
        colorStart[3]);
    writePolylineVertex(
        output,
        vertexOffset++,
        v1x,
        v1y,
        v1z,
        colorStart[0],
        colorStart[1],
        colorStart[2],
        colorStart[3]);
    writePolylineVertex(
        output,
        vertexOffset++,
        v2x,
        v2y,
        v2z,
        colorEnd[0],
        colorEnd[1],
        colorEnd[2],
        colorEnd[3]);
    writePolylineVertex(
        output,
        vertexOffset++,
        v2x,
        v2y,
        v2z,
        colorEnd[0],
        colorEnd[1],
        colorEnd[2],
        colorEnd[3]);
    writePolylineVertex(
        output,
        vertexOffset++,
        v1x,
        v1y,
        v1z,
        colorStart[0],
        colorStart[1],
        colorStart[2],
        colorStart[3]);
    writePolylineVertex(
        output,
        vertexOffset++,
        v3x,
        v3y,
        v3z,
        colorEnd[0],
        colorEnd[1],
        colorEnd[2],
        colorEnd[3]);
  }

  return vertexOffset;
}

int writeBorderVertices(
    const std::vector<SpriteEntry> &entries,
    const SpriteInputView &sprite,
    const ElementInputView &element,
    int spriteCount,
    const scalar_t *viewMatrix,
    const scalar_t *viewProjection,
    scalar_t aspectRatio,
    scalar_t cameraX,
    scalar_t cameraY,
    scalar_t cameraZ,
    const std::vector<scalar_t> &pivotXValues,
    const std::vector<scalar_t> &pivotYValues,
    const std::vector<scalar_t> &pivotZValues,
    const std::vector<scalar_t> &spriteDistanceScaleFactors,
    const std::vector<TextureInfo> &textures,
    float *output,
    int vertexOffsetStart,
    std::vector<int> &elementVertexStarts,
    std::vector<int> &elementVertexCounts) {
  const int elementCount =
      static_cast<int>(std::max(pivotXValues.size(), pivotYValues.size()));
  elementVertexStarts.assign(
      elementCount > 0 ? static_cast<size_t>(elementCount) : size_t{0},
      0);
  elementVertexCounts.assign(
      elementCount > 0 ? static_cast<size_t>(elementCount) : size_t{0},
      0);
  if (!output || entries.empty() || elementCount <= 0) {
    return vertexOffsetStart;
  }

  const scalar_t safeAspectRatio =
      std::isfinite(aspectRatio) && aspectRatio > static_cast<scalar_t>(0.0f)
          ? aspectRatio
          : static_cast<scalar_t>(1.0f);
  const scalar_t viewRightX = viewMatrix ? viewMatrix[0] : static_cast<scalar_t>(1.0f);
  const scalar_t viewRightY = viewMatrix ? viewMatrix[4] : static_cast<scalar_t>(0.0f);
  const scalar_t viewRightZ = viewMatrix ? viewMatrix[8] : static_cast<scalar_t>(0.0f);
  const scalar_t viewUpX = viewMatrix ? viewMatrix[1] : static_cast<scalar_t>(0.0f);
  const scalar_t viewUpY = viewMatrix ? viewMatrix[5] : static_cast<scalar_t>(1.0f);
  const scalar_t viewUpZ = viewMatrix ? viewMatrix[9] : static_cast<scalar_t>(0.0f);

  int vertexOffset = vertexOffsetStart;
  for (const auto &entry : entries) {
    const int index = entry.index;
    if (index < 0 || index >= elementCount) {
      continue;
    }

    const int ownerSlot = static_cast<int>(element.ownerSlotValues[index]);
    if (ownerSlot < 0 || ownerSlot >= spriteCount) {
      continue;
    }

    const int texIndex = entry.texIndex;
    if (texIndex < 0 || texIndex >= static_cast<int>(textures.size())) {
      continue;
    }
    const auto &texture = textures[static_cast<size_t>(texIndex)];
    if (texture.valid == 0) {
      continue;
    }

    const scalar_t distanceScale =
        ownerSlot >= 0 &&
                static_cast<size_t>(ownerSlot) < spriteDistanceScaleFactors.size()
            ? spriteDistanceScaleFactors[static_cast<size_t>(ownerSlot)]
            : static_cast<scalar_t>(1.0f);
    const scalar_t borderWidth =
        element.borderWidthValues[index] * distanceScale;
    if (!(borderWidth > static_cast<scalar_t>(0.0f))) {
      continue;
    }

    const scalar_t colorA =
        element.borderColorAValues[index] * entry.opacity;
    if (!(colorA > static_cast<scalar_t>(0.0f))) {
      continue;
    }

    const scalar_t pivotX = pivotXValues[static_cast<size_t>(index)];
    const scalar_t pivotY = pivotYValues[static_cast<size_t>(index)];
    const scalar_t pivotZ = pivotZValues[static_cast<size_t>(index)];
    const scalar_t width =
        texture.width * element.scaleValues[index] * distanceScale;
    const scalar_t height =
        texture.height * element.scaleValues[index] * distanceScale;
    const scalar_t halfWidth = width * static_cast<scalar_t>(0.5f);
    const scalar_t halfHeight = height * static_cast<scalar_t>(0.5f);
    const scalar_t anchorOffsetX =
        element.anchorXValues[index] * halfWidth;
    const scalar_t anchorOffsetY =
        element.anchorYValues[index] * halfHeight;
    const scalar_t localLeft = -halfWidth - anchorOffsetX;
    const scalar_t localTop = -halfHeight - anchorOffsetY;
    const scalar_t localRight = halfWidth - anchorOffsetX;
    const scalar_t localBottom = halfHeight - anchorOffsetY;
    const scalar_t rotateDeg = element.finalRotateDegValues[index];
    const int renderMode =
        static_cast<int>(element.renderModeValues[index]);

    scalar_t lbx = static_cast<scalar_t>(0.0f);
    scalar_t lby = static_cast<scalar_t>(0.0f);
    scalar_t lbz = static_cast<scalar_t>(0.0f);
    scalar_t rbx = static_cast<scalar_t>(0.0f);
    scalar_t rby = static_cast<scalar_t>(0.0f);
    scalar_t rbz = static_cast<scalar_t>(0.0f);
    scalar_t ltx = static_cast<scalar_t>(0.0f);
    scalar_t lty = static_cast<scalar_t>(0.0f);
    scalar_t ltz = static_cast<scalar_t>(0.0f);
    scalar_t rtx = static_cast<scalar_t>(0.0f);
    scalar_t rty = static_cast<scalar_t>(0.0f);
    scalar_t rtz = static_cast<scalar_t>(0.0f);

    if (renderMode == COMMON_RENDER_MODE_BILLBOARD_PERSPECTIVE ||
        renderMode == COMMON_RENDER_MODE_BILLBOARD) {
      if (!viewProjection || !viewMatrix) {
        continue;
      }
      std::array<float, WASM_OUTPUT_STRIDE> quad{};
      int billboardSolveMode = 0;
      scalar_t billboardScreenAngleDeg = static_cast<scalar_t>(0.0f);
      detail::writeBillboardVertices(
          viewProjection,
          safeAspectRatio,
          cameraX,
          cameraY,
          cameraZ,
          pivotX,
          pivotY,
          pivotZ,
          localLeft,
          localRight,
          localTop,
          localBottom,
          rotateDeg,
          static_cast<scalar_t>(0.0f),
          static_cast<scalar_t>(0.0f),
          static_cast<scalar_t>(1.0f),
          static_cast<scalar_t>(1.0f),
          renderMode,
          viewRightX,
          viewRightY,
          viewRightZ,
          viewUpX,
          viewUpY,
          viewUpZ,
          1.0f,
          quad.data(),
          billboardSolveMode,
          billboardScreenAngleDeg);
      lbx = quad[0];
      lby = quad[1];
      lbz = quad[2];
      rbx = quad[6];
      rby = quad[7];
      rbz = quad[8];
      ltx = quad[12];
      lty = quad[13];
      ltz = quad[14];
      rtx = quad[18];
      rty = quad[19];
      rtz = quad[20];
    } else if (rotateDeg == static_cast<scalar_t>(0.0f)) {
      lbx = pivotX + localLeft;
      lby = pivotY + localBottom;
      lbz = pivotZ;
      rbx = pivotX + localRight;
      rby = pivotY + localBottom;
      rbz = pivotZ;
      ltx = pivotX + localLeft;
      lty = pivotY + localTop;
      ltz = pivotZ;
      rtx = pivotX + localRight;
      rty = pivotY + localTop;
      rtz = pivotZ;
    } else {
      const scalar_t angle = -toRadians(rotateDeg);
      scalar_t s = static_cast<scalar_t>(0.0f);
      scalar_t c = static_cast<scalar_t>(1.0f);
      computeSinCos(angle, s, c);

      lbx = pivotX + localLeft * c - localBottom * s;
      lby = pivotY + localLeft * s + localBottom * c;
      lbz = pivotZ;
      rbx = pivotX + localRight * c - localBottom * s;
      rby = pivotY + localRight * s + localBottom * c;
      rbz = pivotZ;
      ltx = pivotX + localLeft * c - localTop * s;
      lty = pivotY + localLeft * s + localTop * c;
      ltz = pivotZ;
      rtx = pivotX + localRight * c - localTop * s;
      rty = pivotY + localRight * s + localTop * c;
      rtz = pivotZ;
    }

    const scalar_t edge1X = rbx - lbx;
    const scalar_t edge1Y = rby - lby;
    const scalar_t edge1Z = rbz - lbz;
    const scalar_t edge2X = ltx - lbx;
    const scalar_t edge2Y = lty - lby;
    const scalar_t edge2Z = ltz - lbz;
    const scalar_t planeNormalX = edge1Y * edge2Z - edge1Z * edge2Y;
    const scalar_t planeNormalY = edge1Z * edge2X - edge1X * edge2Z;
    const scalar_t planeNormalZ = edge1X * edge2Y - edge1Y * edge2X;
    const scalar_t planeNormalLenSq =
        planeNormalX * planeNormalX +
        planeNormalY * planeNormalY +
        planeNormalZ * planeNormalZ;
    if (!(planeNormalLenSq > static_cast<scalar_t>(0.0f))) {
      continue;
    }

    const std::array<scalar_t, 4> color = {
        element.borderColorRValues[index],
        element.borderColorGValues[index],
        element.borderColorBValues[index],
        colorA,
    };
    const int startVertex = vertexOffset;
    vertexOffset = writePolylineSegmentQuad3d(
        output,
        vertexOffset,
        lbx,
        lby,
        lbz,
        rbx,
        rby,
        rbz,
        planeNormalX,
        planeNormalY,
        planeNormalZ,
        borderWidth,
        color,
        color);
    vertexOffset = writePolylineSegmentQuad3d(
        output,
        vertexOffset,
        rbx,
        rby,
        rbz,
        rtx,
        rty,
        rtz,
        planeNormalX,
        planeNormalY,
        planeNormalZ,
        borderWidth,
        color,
        color);
    vertexOffset = writePolylineSegmentQuad3d(
        output,
        vertexOffset,
        rtx,
        rty,
        rtz,
        ltx,
        lty,
        ltz,
        planeNormalX,
        planeNormalY,
        planeNormalZ,
        borderWidth,
        color,
        color);
    vertexOffset = writePolylineSegmentQuad3d(
        output,
        vertexOffset,
        ltx,
        lty,
        ltz,
        lbx,
        lby,
        lbz,
        planeNormalX,
        planeNormalY,
        planeNormalZ,
        borderWidth,
        color,
        color);
    elementVertexStarts[static_cast<size_t>(index)] = startVertex;
    elementVertexCounts[static_cast<size_t>(index)] =
        vertexOffset - startVertex;
  }

  return vertexOffset;
}

int writePolylineVertices(
    const std::vector<PolylineEntry> &entries,
    const PolylineInputView &polyline,
    const PolylineNodeInputView &nodes,
    int polylineCount,
    const std::vector<scalar_t> &polylineNodeScaleFactors,
    float *output,
    int vertexOffsetStart,
    std::vector<scalar_t> &nodeLengths,
    std::vector<int> &entryVertexStarts,
    std::vector<int> &entryVertexCounts) {
  if (!output || polylineCount <= 0) {
    entryVertexStarts.assign(entries.size(), 0);
    entryVertexCounts.assign(entries.size(), 0);
    return vertexOffsetStart;
  }

  entryVertexStarts.assign(entries.size(), 0);
  entryVertexCounts.assign(entries.size(), 0);

  for (int i = 0; i < polylineCount; ++i) {
    const int nodeOffset = static_cast<int>(polyline.nodeOffsetValues[i]);
    const int nodeCount = static_cast<int>(polyline.nodeCountValues[i]);
    if (nodeOffset < 0 || nodeCount <= 0) {
      continue;
    }
    const int lastIndex = nodeOffset + nodeCount - 1;
    if (nodeOffset >= static_cast<int>(nodeLengths.size()) ||
        lastIndex >= static_cast<int>(nodeLengths.size())) {
      continue;
    }
    nodeLengths[static_cast<size_t>(nodeOffset)] = static_cast<scalar_t>(0.0f);
    for (int n = 1; n < nodeCount; ++n) {
      const int index = nodeOffset + n;
      const scalar_t dx =
          nodes.xValues[index] - nodes.xValues[index - 1];
      const scalar_t dy =
          nodes.yValues[index] - nodes.yValues[index - 1];
      const scalar_t len = std::sqrt(dx * dx + dy * dy);
      nodeLengths[static_cast<size_t>(index)] =
          nodeLengths[static_cast<size_t>(index - 1)] + len;
    }
  }

  int vertexOffset = vertexOffsetStart;
  for (size_t entryIndex = 0; entryIndex < entries.size(); ++entryIndex) {
    const auto &entry = entries[entryIndex];
    if (entry.polylineIndex < 0 || entry.polylineIndex >= polylineCount) {
      continue;
    }
    const int nodeOffset =
        static_cast<int>(polyline.nodeOffsetValues[entry.polylineIndex]);
    const int nodeCount =
        static_cast<int>(polyline.nodeCountValues[entry.polylineIndex]);
    if (nodeOffset < 0 || nodeCount < 2) {
      continue;
    }
    const int nodeIndex = nodeOffset + entry.segmentIndex;
    const int nextIndex = nodeIndex + 1;
    if (entry.segmentIndex < 0 || entry.segmentIndex >= nodeCount - 1) {
      continue;
    }
    if (nextIndex >= nodeOffset + nodeCount) {
      continue;
    }

    scalar_t x0 = nodes.xValues[nodeIndex];
    scalar_t y0 = nodes.yValues[nodeIndex];
    scalar_t x1 = nodes.xValues[nextIndex];
    scalar_t y1 = nodes.yValues[nextIndex];
    const scalar_t nodeScale0 =
        nodeIndex >= 0 && static_cast<size_t>(nodeIndex) < polylineNodeScaleFactors.size()
            ? polylineNodeScaleFactors[static_cast<size_t>(nodeIndex)]
            : static_cast<scalar_t>(1.0f);
    const scalar_t nodeScale1 =
        nextIndex >= 0 && static_cast<size_t>(nextIndex) < polylineNodeScaleFactors.size()
            ? polylineNodeScaleFactors[static_cast<size_t>(nextIndex)]
            : static_cast<scalar_t>(1.0f);
    scalar_t thickness0 = nodes.thicknessValues[nodeIndex] * nodeScale0;
    scalar_t thickness1 = nodes.thicknessValues[nextIndex] * nodeScale1;
    if (!(thickness0 > static_cast<scalar_t>(0.0f)) ||
        !(thickness1 > static_cast<scalar_t>(0.0f))) {
      continue;
    }

    const scalar_t dx = x1 - x0;
    const scalar_t dy = y1 - y0;
    const scalar_t lenSq = dx * dx + dy * dy;
    if (!(lenSq > static_cast<scalar_t>(0.0f))) {
      continue;
    }
    const scalar_t len = std::sqrt(lenSq);
    const scalar_t invLen = static_cast<scalar_t>(1.0f) / len;
    const scalar_t ux = dx * invLen;
    const scalar_t uy = dy * invLen;
    const scalar_t nx = -uy;
    const scalar_t ny = ux;

    const scalar_t opacity = std::max(
        static_cast<scalar_t>(0.0f),
        std::min(static_cast<scalar_t>(1.0f),
                 polyline.opacityValues[entry.polylineIndex]));
    const scalar_t repeatLength =
        polyline.repeatLengthValues[entry.polylineIndex];
    const scalar_t color0R =
        polyline.color0RValues[entry.polylineIndex];
    const scalar_t color0G =
        polyline.color0GValues[entry.polylineIndex];
    const scalar_t color0B =
        polyline.color0BValues[entry.polylineIndex];
    const scalar_t color0A =
        polyline.color0AValues[entry.polylineIndex];
    const scalar_t color1R =
        polyline.color1RValues[entry.polylineIndex];
    const scalar_t color1G =
        polyline.color1GValues[entry.polylineIndex];
    const scalar_t color1B =
        polyline.color1BValues[entry.polylineIndex];
    const scalar_t color1A =
        polyline.color1AValues[entry.polylineIndex];
    const int joinCorrectionMode =
        static_cast<int>(polyline.joinCorrectionModeValues[entry.polylineIndex]);
    const int joinCorrectionIntermediatePointCount =
        static_cast<int>(
            polyline.joinCorrectionIntermediatePointCountValues[entry.polylineIndex]);
    const int capCorrectionMode =
        static_cast<int>(polyline.capCorrectionModeValues[entry.polylineIndex]);
    const int capCorrectionPointCount =
        static_cast<int>(
            polyline.capCorrectionPointCountValues[entry.polylineIndex]);

    const auto resolveColor = [&](scalar_t length) {
      scalar_t t = static_cast<scalar_t>(0.0f);
      if (repeatLength > static_cast<scalar_t>(0.0f)) {
        const scalar_t mod =
            std::fmod(length, repeatLength);
        t = repeatLength > static_cast<scalar_t>(0.0f)
            ? pingPongRatio(mod / repeatLength)
            : static_cast<scalar_t>(0.0f);
      }
      const scalar_t r = color0R + (color1R - color0R) * t;
      const scalar_t g = color0G + (color1G - color0G) * t;
      const scalar_t b = color0B + (color1B - color0B) * t;
      const scalar_t a =
          (color0A + (color1A - color0A) * t) * opacity;
      return std::array<scalar_t, 4>{r, g, b, a};
    };

    const scalar_t length0 =
        nodeIndex >= 0 && nodeIndex < static_cast<int>(nodeLengths.size())
            ? nodeLengths[static_cast<size_t>(nodeIndex)]
            : static_cast<scalar_t>(0.0f);
    const scalar_t length1 =
        nextIndex >= 0 && nextIndex < static_cast<int>(nodeLengths.size())
            ? nodeLengths[static_cast<size_t>(nextIndex)]
            : length0 + len;
    const auto colorStart = resolveColor(length0);
    const auto colorEnd = resolveColor(length1);

    const scalar_t half0 = thickness0 * static_cast<scalar_t>(0.5f);
    const scalar_t half1 = thickness1 * static_cast<scalar_t>(0.5f);

    const scalar_t v0x = x0 + nx * half0;
    const scalar_t v0y = y0 + ny * half0;
    const scalar_t v1x = x0 - nx * half0;
    const scalar_t v1y = y0 - ny * half0;
    const scalar_t v2x = x1 + nx * half1;
    const scalar_t v2y = y1 + ny * half1;
    const scalar_t v3x = x1 - nx * half1;
    const scalar_t v3y = y1 - ny * half1;

    const int startVertex = vertexOffset;
    entryVertexStarts[entryIndex] = startVertex;
    int vertexCount = 0;

    if (entry.segmentIndex == 0 &&
        capCorrectionMode == POLYLINE_CORRECTION_MODE_FAN &&
        capCorrectionPointCount > 0) {
      const int previousVertexOffset = vertexOffset;
      vertexOffset = writePolylineCapFanVertices(
          output,
          vertexOffset,
          x0,
          y0,
          half0,
          ux,
          uy,
          nx,
          ny,
          true,
          capCorrectionPointCount,
          colorStart[0],
          colorStart[1],
          colorStart[2],
          colorStart[3]);
      vertexCount += vertexOffset - previousVertexOffset;
    }

    writePolylineVertex(
        output,
        vertexOffset++,
        v0x,
        v0y,
        static_cast<scalar_t>(0.0f),
        colorStart[0],
        colorStart[1],
        colorStart[2],
        colorStart[3]);
    writePolylineVertex(
        output,
        vertexOffset++,
        v1x,
        v1y,
        static_cast<scalar_t>(0.0f),
        colorStart[0],
        colorStart[1],
        colorStart[2],
        colorStart[3]);
    writePolylineVertex(
        output,
        vertexOffset++,
        v2x,
        v2y,
        static_cast<scalar_t>(0.0f),
        colorEnd[0],
        colorEnd[1],
        colorEnd[2],
        colorEnd[3]);
    writePolylineVertex(
        output,
        vertexOffset++,
        v2x,
        v2y,
        static_cast<scalar_t>(0.0f),
        colorEnd[0],
        colorEnd[1],
        colorEnd[2],
        colorEnd[3]);
    writePolylineVertex(
        output,
        vertexOffset++,
        v1x,
        v1y,
        static_cast<scalar_t>(0.0f),
        colorStart[0],
        colorStart[1],
        colorStart[2],
        colorStart[3]);
    writePolylineVertex(
        output,
        vertexOffset++,
        v3x,
        v3y,
        static_cast<scalar_t>(0.0f),
        colorEnd[0],
        colorEnd[1],
        colorEnd[2],
        colorEnd[3]);
    vertexCount += 6;

    if (joinCorrectionMode == POLYLINE_CORRECTION_MODE_FAN &&
        entry.segmentIndex > 0 &&
        entry.segmentIndex < nodeCount - 1) {
      const int prevIndex = nodeIndex - 1;
      const int nextNodeIndex = nodeIndex + 1;
      const scalar_t px = nodes.xValues[prevIndex];
      const scalar_t py = nodes.yValues[prevIndex];
      const scalar_t nx2 = nodes.xValues[nextNodeIndex];
      const scalar_t ny2 = nodes.yValues[nextNodeIndex];
      const scalar_t dx0 = x0 - px;
      const scalar_t dy0 = y0 - py;
      const scalar_t dx1 = nx2 - x0;
      const scalar_t dy1 = ny2 - y0;
      const scalar_t len0Sq = dx0 * dx0 + dy0 * dy0;
      const scalar_t len1Sq = dx1 * dx1 + dy1 * dy1;
      if (len0Sq > static_cast<scalar_t>(0.0f) &&
          len1Sq > static_cast<scalar_t>(0.0f)) {
        const scalar_t len0 = std::sqrt(len0Sq);
        const scalar_t len1 = std::sqrt(len1Sq);
        const scalar_t ux0 = dx0 / len0;
        const scalar_t uy0 = dy0 / len0;
        const scalar_t ux1 = dx1 / len1;
        const scalar_t uy1 = dy1 / len1;
        const scalar_t cross = ux0 * uy1 - uy0 * ux1;
        if (cross != static_cast<scalar_t>(0.0f)) {
          const scalar_t n0x = -uy0;
          const scalar_t n0y = ux0;
          const scalar_t n1x = -uy1;
          const scalar_t n1y = ux1;
          const scalar_t half = thickness0 * static_cast<scalar_t>(0.5f);
          scalar_t dir0x = n0x;
          scalar_t dir0y = n0y;
          scalar_t dir1x = n1x;
          scalar_t dir1y = n1y;
          if (cross > static_cast<scalar_t>(0.0f)) {
            dir0x = -n0x;
            dir0y = -n0y;
            dir1x = -n1x;
            dir1y = -n1y;
          }
          const auto colorJoin = resolveColor(length0);
          const int previousVertexOffset = vertexOffset;
          vertexOffset = writePolylineJoinFanVertices(
              output,
              vertexOffset,
              x0,
              y0,
              half,
              dir0x,
              dir0y,
              dir1x,
              dir1y,
              joinCorrectionIntermediatePointCount,
              colorJoin[0],
              colorJoin[1],
              colorJoin[2],
              colorJoin[3]);
          vertexCount += vertexOffset - previousVertexOffset;
        }
      }
    }

    if (entry.segmentIndex == nodeCount - 2 &&
        capCorrectionMode == POLYLINE_CORRECTION_MODE_FAN &&
        capCorrectionPointCount > 0) {
      const int previousVertexOffset = vertexOffset;
      vertexOffset = writePolylineCapFanVertices(
          output,
          vertexOffset,
          x1,
          y1,
          half1,
          ux,
          uy,
          nx,
          ny,
          false,
          capCorrectionPointCount,
          colorEnd[0],
          colorEnd[1],
          colorEnd[2],
          colorEnd[3]);
      vertexCount += vertexOffset - previousVertexOffset;
    }

    entryVertexCounts[entryIndex] = vertexCount;
  }

  return vertexOffset;
}

} // namespace msp_wasm
