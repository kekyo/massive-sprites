// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <vector>
#include <wasm_simd128.h>

#include "generated/wasm-layout.generated.hpp"

///////////////////////////////////////////////////////////////////////////////////////////////

#if MSP_INPUT_F64
#define msp_wasm msp_wasm_f64
#define __export_msp(name) name##_f64
#define scalar_t double
constexpr int kSimdLanes = 2;
#else
#define msp_wasm msp_wasm_f32
#define __export_msp(name) name##_f32
#define scalar_t float
constexpr int kSimdLanes = 4;
#endif

///////////////////////////////////////////////////////////////////////////////////////////////

namespace msp_wasm {

constexpr scalar_t kPi = 3.14159265358979323846;
constexpr scalar_t kTwoPi = 6.28318530717958647692;
constexpr scalar_t kDegToRad = kPi / 180.0;

/**
 * @brief Creates a SIMD register filled with the same scalar value.
 * @param value Scalar value to broadcast.
 * @return SIMD register containing the broadcast value in every lane.
 * @remarks The helper hides the lane width difference between f32 and f64
 * builds so higher-level math code can stay precision-agnostic.
 */
static constexpr inline v128_t simdSplat(scalar_t value) {
#if MSP_INPUT_F64
  return wasm_f64x2_splat(value);
#else
  return wasm_f32x4_splat(value);
#endif
}

// Precision-agnostic SIMD wrappers used by the easing and animation kernels.

static constexpr inline v128_t simdAdd(v128_t lhs, v128_t rhs) {
#if MSP_INPUT_F64
  return wasm_f64x2_add(lhs, rhs);
#else
  return wasm_f32x4_add(lhs, rhs);
#endif
}

static constexpr inline v128_t simdSub(v128_t lhs, v128_t rhs) {
#if MSP_INPUT_F64
  return wasm_f64x2_sub(lhs, rhs);
#else
  return wasm_f32x4_sub(lhs, rhs);
#endif
}

static constexpr inline v128_t simdMul(v128_t lhs, v128_t rhs) {
#if MSP_INPUT_F64
  return wasm_f64x2_mul(lhs, rhs);
#else
  return wasm_f32x4_mul(lhs, rhs);
#endif
}

static constexpr inline v128_t simdDiv(v128_t lhs, v128_t rhs) {
#if MSP_INPUT_F64
  return wasm_f64x2_div(lhs, rhs);
#else
  return wasm_f32x4_div(lhs, rhs);
#endif
}

static constexpr inline v128_t simdFloor(v128_t value) {
#if MSP_INPUT_F64
  return wasm_f64x2_floor(value);
#else
  return wasm_f32x4_floor(value);
#endif
}

static constexpr inline v128_t simdMax(v128_t lhs, v128_t rhs) {
#if MSP_INPUT_F64
  return wasm_f64x2_max(lhs, rhs);
#else
  return wasm_f32x4_max(lhs, rhs);
#endif
}

static constexpr inline v128_t simdMin(v128_t lhs, v128_t rhs) {
#if MSP_INPUT_F64
  return wasm_f64x2_min(lhs, rhs);
#else
  return wasm_f32x4_min(lhs, rhs);
#endif
}

static constexpr inline v128_t simdGt(v128_t lhs, v128_t rhs) {
#if MSP_INPUT_F64
  return wasm_f64x2_gt(lhs, rhs);
#else
  return wasm_f32x4_gt(lhs, rhs);
#endif
}

static constexpr inline v128_t simdGe(v128_t lhs, v128_t rhs) {
#if MSP_INPUT_F64
  return wasm_f64x2_ge(lhs, rhs);
#else
  return wasm_f32x4_ge(lhs, rhs);
#endif
}

static constexpr inline v128_t simdLe(v128_t lhs, v128_t rhs) {
#if MSP_INPUT_F64
  return wasm_f64x2_le(lhs, rhs);
#else
  return wasm_f32x4_le(lhs, rhs);
#endif
}

static constexpr inline v128_t simdEq(v128_t lhs, v128_t rhs) {
#if MSP_INPUT_F64
  return wasm_f64x2_eq(lhs, rhs);
#else
  return wasm_f32x4_eq(lhs, rhs);
#endif
}

static constexpr inline int simdBitmask(v128_t value) {
#if MSP_INPUT_F64
  return wasm_i64x2_bitmask(value);
#else
  return wasm_i32x4_bitmask(value);
#endif
}

} // namespace

///////////////////////////////////////////////////////////////////////////////////////////////

namespace msp_wasm {

/**
 * @brief Converts degrees to radians.
 * @param degrees Angle in degrees.
 * @return Angle in radians.
 */
static constexpr inline scalar_t toRadians(scalar_t degrees) { return degrees * (kPi / 180.0f); }

/**
 * @brief Wraps an angle delta into the `[-180, 180)` range.
 * @param delta Angle delta in degrees.
 * @return Wrapped angle delta in degrees.
 */
static constexpr inline scalar_t wrapAngleDelta(scalar_t delta) {
  const scalar_t wrapped =
      delta - 360.0f * std::floor((delta + 180.0f) / 360.0f);
  if (wrapped <= -180.0f) {
    return wrapped + 360.0f;
  }
  return wrapped;
}

static constexpr inline v128_t wrapAngleDeltaSimd(v128_t delta) {
  const v128_t v180 = simdSplat(180.0f);
  const v128_t v360 = simdSplat(360.0f);
  const v128_t adjusted = simdAdd(delta, v180);
  const v128_t quotient = simdDiv(adjusted, v360);
  const v128_t floored = simdFloor(quotient);
  v128_t wrapped = simdSub(delta, simdMul(v360, floored));
  const v128_t neg180 = simdSub(simdSplat(0.0f), v180);
  const v128_t leNeg180 = simdLe(wrapped, neg180);
  const v128_t wrappedAdjusted = simdAdd(wrapped, v360);
  wrapped = wasm_v128_bitselect(wrappedAdjusted, wrapped, leNeg180);
  return wrapped;
}

static constexpr inline scalar_t wrapRadians(scalar_t radians) {
  return radians - kTwoPi * std::floor((radians + kPi) / kTwoPi);
}

// Trigonometric helpers normalize angles first so both scalar and SIMD
// approximations operate in the range where their polynomial error stays small.

static constexpr inline v128_t wrapRadiansSimd(v128_t radians) {
  const v128_t pi = simdSplat(kPi);
  const v128_t twoPi = simdSplat(kTwoPi);
  const v128_t adjusted = simdAdd(radians, pi);
  const v128_t quotient = simdDiv(adjusted, twoPi);
  const v128_t floored = simdFloor(quotient);
  return simdSub(radians, simdMul(twoPi, floored));
}

/**
 * @brief Computes sine and cosine in a single call when the toolchain allows it.
 * @param angleRadians Input angle in radians.
 * @param outSin Receives the sine of @p angleRadians.
 * @param outCos Receives the cosine of @p angleRadians.
 */
static inline void computeSinCos(
    scalar_t angleRadians,
    scalar_t &outSin,
    scalar_t &outCos) {
#if defined(__GNUC__) || defined(__clang__)
#if MSP_INPUT_F64
  __builtin_sincos(angleRadians, &outSin, &outCos);
#else
  __builtin_sincosf(angleRadians, &outSin, &outCos);
#endif
#else
  outSin = std::sin(angleRadians);
  outCos = std::cos(angleRadians);
#endif
}

static constexpr inline scalar_t sinApprox(scalar_t radians) {
  const scalar_t x = wrapRadians(radians);
  const scalar_t x2 = x * x;
  const scalar_t x4 = x2 * x2;
  const scalar_t x6 = x4 * x2;
  const scalar_t poly = 1.0f - x2 * (1.0f / 6.0f) + x4 * (1.0f / 120.0f) -
                     x6 * (1.0f / 5040.0f);
  return x * poly;
}

static constexpr inline scalar_t cosApprox(scalar_t radians) {
  const scalar_t x = wrapRadians(radians);
  const scalar_t x2 = x * x;
  const scalar_t x4 = x2 * x2;
  const scalar_t x6 = x4 * x2;
  return 1.0f - x2 * 0.5f + x4 * (1.0f / 24.0f) - x6 * (1.0f / 720.0f);
}

static constexpr inline v128_t sinApproxSimd(v128_t radians) {
  const v128_t x = wrapRadiansSimd(radians);
  const v128_t x2 = simdMul(x, x);
  const v128_t x4 = simdMul(x2, x2);
  const v128_t x6 = simdMul(x4, x2);
  const v128_t one = simdSplat(1.0f);
  const v128_t c2 = simdSplat(-1.0f / 6.0f);
  const v128_t c4 = simdSplat(1.0f / 120.0f);
  const v128_t c6 = simdSplat(-1.0f / 5040.0f);
  v128_t poly = one;
  poly = simdAdd(poly, simdMul(x2, c2));
  poly = simdAdd(poly, simdMul(x4, c4));
  poly = simdAdd(poly, simdMul(x6, c6));
  return simdMul(x, poly);
}

static constexpr inline v128_t cosApproxSimd(v128_t radians) {
  const v128_t x = wrapRadiansSimd(radians);
  const v128_t x2 = simdMul(x, x);
  const v128_t x4 = simdMul(x2, x2);
  const v128_t x6 = simdMul(x4, x2);
  const v128_t one = simdSplat(1.0f);
  const v128_t c2 = simdSplat(-0.5f);
  const v128_t c4 = simdSplat(1.0f / 24.0f);
  const v128_t c6 = simdSplat(-1.0f / 720.0f);
  v128_t poly = one;
  poly = simdAdd(poly, simdMul(x2, c2));
  poly = simdAdd(poly, simdMul(x4, c4));
  poly = simdAdd(poly, simdMul(x6, c6));
  return poly;
}

/**
 * @brief Approximates `exp(value)` with the precision expected by the current build.
 * @param value Exponent input.
 * @return Approximate exponential value.
 * @remarks The f32 build uses a fast bit-manipulation approximation, while the
 * f64 build falls back to `std::exp` because the approximation targets 32-bit
 * float lanes.
 */
static inline scalar_t expApprox(scalar_t value) {
  const scalar_t clamp = static_cast<scalar_t>(COMMON_EXP_APPROX_CLAMP);
  const scalar_t clamped = std::max(-clamp, std::min(clamp, value));
#if MSP_INPUT_F64
  return std::exp(clamped);
#else
  const int32_t bits =
      static_cast<int32_t>(clamped * static_cast<scalar_t>(COMMON_EXP_APPROX_SCALE) +
                           static_cast<scalar_t>(COMMON_EXP_APPROX_BIAS));
  scalar_t result = 0.0f;
  std::memcpy(&result, &bits, sizeof(result));
  return result;
#endif
}

static inline v128_t expApproxSimd(v128_t value) {
#if MSP_INPUT_F64
  alignas(16) scalar_t values[kSimdLanes];
  alignas(16) scalar_t outputs[kSimdLanes];
  wasm_v128_store(values, value);
  for (int lane = 0; lane < kSimdLanes; lane += 1) {
    outputs[lane] = expApprox(values[lane]);
  }
  return wasm_v128_load(outputs);
#else
  const v128_t minValue =
      wasm_f32x4_splat(-static_cast<scalar_t>(COMMON_EXP_APPROX_CLAMP));
  const v128_t maxValue =
      wasm_f32x4_splat(static_cast<scalar_t>(COMMON_EXP_APPROX_CLAMP));
  const v128_t scale =
      wasm_f32x4_splat(static_cast<scalar_t>(COMMON_EXP_APPROX_SCALE));
  const v128_t bias =
      wasm_f32x4_splat(static_cast<scalar_t>(COMMON_EXP_APPROX_BIAS));

  const v128_t clamped = wasm_f32x4_max(minValue, wasm_f32x4_min(maxValue, value));
  const v128_t scaled = wasm_f32x4_add(wasm_f32x4_mul(clamped, scale), bias);
  // v128 is untyped, so returning integer lanes is a raw bit reinterpret.
  return wasm_i32x4_trunc_sat_f32x4(scaled);
#endif
}

static constexpr inline v128_t sigmoidSimd(
    v128_t t, v128_t k, v128_t mid, v128_t s0, v128_t invSpan) {
  const v128_t neg = simdSub(mid, t);
  const v128_t exponent = simdMul(k, neg);
  const v128_t expValue = expApproxSimd(exponent);
  const v128_t denom = simdAdd(simdSplat(1.0f), expValue);
  const v128_t raw = simdDiv(simdSplat(1.0f), denom);
  return simdMul(simdSub(raw, s0), invSpan);
}

/**
 * @brief Evaluates the scalar sigmoid easing primitive shared by interpolation code.
 * @param t Normalized progress.
 * @param k Logistic steepness.
 * @param mid Logistic midpoint.
 * @param s0 Precomputed sigmoid value at progress `0`.
 * @param invSpan Reciprocal normalization span.
 * @return Sigmoid easing value in normalized space.
 */
static constexpr inline scalar_t sigmoidScalar(scalar_t t, scalar_t k, scalar_t mid, scalar_t s0,
                           scalar_t invSpan) {
  const scalar_t raw = 1.0f / (1.0f + expApprox(-k * (t - mid)));
  return (raw - s0) * invSpan;
}

// Matrix helpers operate on column-major 4x4 matrices so they can be consumed
// directly by the wasm buffers and the WebGL side without transposition.

static constexpr inline void createTranslationMatrix(scalar_t x, scalar_t y, scalar_t z, scalar_t *out) {
  out[0] = 1.0f;
  out[1] = 0.0f;
  out[2] = 0.0f;
  out[3] = 0.0f;
  out[4] = 0.0f;
  out[5] = 1.0f;
  out[6] = 0.0f;
  out[7] = 0.0f;
  out[8] = 0.0f;
  out[9] = 0.0f;
  out[10] = 1.0f;
  out[11] = 0.0f;
  out[12] = x;
  out[13] = y;
  out[14] = z;
  out[15] = 1.0f;
}

static constexpr inline void transposeMatrix(const scalar_t *matrix, scalar_t *out) {
  out[0] = matrix[0];
  out[1] = matrix[4];
  out[2] = matrix[8];
  out[3] = matrix[12];
  out[4] = matrix[1];
  out[5] = matrix[5];
  out[6] = matrix[9];
  out[7] = matrix[13];
  out[8] = matrix[2];
  out[9] = matrix[6];
  out[10] = matrix[10];
  out[11] = matrix[14];
  out[12] = matrix[3];
  out[13] = matrix[7];
  out[14] = matrix[11];
  out[15] = matrix[15];
}

static constexpr inline void multiplyMatrices(const scalar_t *a, const scalar_t *b, scalar_t *out) {
  const scalar_t a0 = a[0];
  const scalar_t a1 = a[1];
  const scalar_t a2 = a[2];
  const scalar_t a3 = a[3];
  const scalar_t a4 = a[4];
  const scalar_t a5 = a[5];
  const scalar_t a6 = a[6];
  const scalar_t a7 = a[7];
  const scalar_t a8 = a[8];
  const scalar_t a9 = a[9];
  const scalar_t a10 = a[10];
  const scalar_t a11 = a[11];
  const scalar_t a12 = a[12];
  const scalar_t a13 = a[13];
  const scalar_t a14 = a[14];
  const scalar_t a15 = a[15];

  for (int column = 0; column < 4; ++column) {
    const int base = column * 4;
    const scalar_t b0 = b[base];
    const scalar_t b1 = b[base + 1];
    const scalar_t b2 = b[base + 2];
    const scalar_t b3 = b[base + 3];

    out[base] = a0 * b0 + a4 * b1 + a8 * b2 + a12 * b3;
    out[base + 1] = a1 * b0 + a5 * b1 + a9 * b2 + a13 * b3;
    out[base + 2] = a2 * b0 + a6 * b1 + a10 * b2 + a14 * b3;
    out[base + 3] = a3 * b0 + a7 * b1 + a11 * b2 + a15 * b3;
  }
}

static constexpr inline void createRotationZMatrix(scalar_t angle, scalar_t *out) {
  const scalar_t c = std::cos(angle);
  const scalar_t s = std::sin(angle);
  out[0] = c;
  out[1] = s;
  out[2] = 0.0f;
  out[3] = 0.0f;
  out[4] = -s;
  out[5] = c;
  out[6] = 0.0f;
  out[7] = 0.0f;
  out[8] = 0.0f;
  out[9] = 0.0f;
  out[10] = 1.0f;
  out[11] = 0.0f;
  out[12] = 0.0f;
  out[13] = 0.0f;
  out[14] = 0.0f;
  out[15] = 1.0f;
}

static constexpr inline void createRotationXMatrix(scalar_t angle, scalar_t *out) {
  const scalar_t c = std::cos(angle);
  const scalar_t s = std::sin(angle);
  out[0] = 1.0f;
  out[1] = 0.0f;
  out[2] = 0.0f;
  out[3] = 0.0f;
  out[4] = 0.0f;
  out[5] = c;
  out[6] = s;
  out[7] = 0.0f;
  out[8] = 0.0f;
  out[9] = -s;
  out[10] = c;
  out[11] = 0.0f;
  out[12] = 0.0f;
  out[13] = 0.0f;
  out[14] = 0.0f;
  out[15] = 1.0f;
}

static constexpr inline void createRotationYMatrix(scalar_t angle, scalar_t *out) {
  const scalar_t c = std::cos(angle);
  const scalar_t s = std::sin(angle);
  out[0] = c;
  out[1] = 0.0f;
  out[2] = -s;
  out[3] = 0.0f;
  out[4] = 0.0f;
  out[5] = 1.0f;
  out[6] = 0.0f;
  out[7] = 0.0f;
  out[8] = s;
  out[9] = 0.0f;
  out[10] = c;
  out[11] = 0.0f;
  out[12] = 0.0f;
  out[13] = 0.0f;
  out[14] = 0.0f;
  out[15] = 1.0f;
}

/**
 * @brief Builds a rotation matrix in the renderer's Z-X-Y rotation order.
 * @param yaw Rotation around Z in radians.
 * @param pitch Rotation around X in radians.
 * @param roll Rotation around Y in radians.
 * @param out Receives the resulting 4x4 matrix.
 * @param temp Temporary 4x4 matrix buffer used during multiplication.
 */
static constexpr inline void createRotationZXYMatrix(scalar_t yaw, scalar_t pitch, scalar_t roll,
                                    scalar_t *out, scalar_t *temp) {
  createRotationZMatrix(yaw, out);
  createRotationXMatrix(pitch, temp);
  multiplyMatrices(out, temp, out);
  createRotationYMatrix(roll, temp);
  multiplyMatrices(out, temp, out);
}

/**
 * @brief Builds a perspective projection matrix.
 * @param fovY Vertical field of view in radians.
 * @param aspectRatio Viewport aspect ratio.
 * @param near Near clipping plane distance.
 * @param far Far clipping plane distance.
 * @param out Receives the resulting 4x4 matrix.
 */
static constexpr inline void createPerspectiveMatrix(scalar_t fovY, scalar_t aspectRatio, scalar_t near,
                                    scalar_t far, scalar_t *out) {
  const scalar_t f = 1.0f / std::tan(fovY / 2.0f);
  const scalar_t nf = 1.0f / (near - far);

  out[0] = f / aspectRatio;
  out[1] = 0.0f;
  out[2] = 0.0f;
  out[3] = 0.0f;
  out[4] = 0.0f;
  out[5] = f;
  out[6] = 0.0f;
  out[7] = 0.0f;
  out[8] = 0.0f;
  out[9] = 0.0f;
  out[10] = (far + near) * nf;
  out[11] = -1.0f;
  out[12] = 0.0f;
  out[13] = 0.0f;
  out[14] = 2.0f * far * near * nf;
  out[15] = 0.0f;
}

} // namespace
