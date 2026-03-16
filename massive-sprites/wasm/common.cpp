// massive-sprites - Plots and moves a lot of sprite images and polylines onto WebGL 2.5D surface.
// Copyright (c) Kouji Matsui. (@kekyo@mi.kekyo.net)
// Under MIT.
// https://github.com/kekyo/massive-sprites

#include <cstdlib>
#include <cstring>

extern "C" {

/**
 * @brief Allocates zero-initialized heap storage for the wasm module.
 * @param count Number of elements to allocate.
 * @param size Size in bytes for each element.
 * @return Allocated pointer, or nullptr when allocation fails.
 */
void *mem_alloc(size_t count, size_t size) {
  return std::calloc(count, size);
}

/**
 * @brief Releases heap storage returned by the wasm allocation helpers.
 * @param ptr Target pointer. Null is accepted.
 */
void mem_free(void *ptr) {
  std::free(ptr);
}

/**
 * @brief Reallocates heap memory while preserving a logical insertion point.
 * @param ptr Target allocated heap pointer.
 * @param oldSize Current allocation size in bytes.
 * @param newSize Requested allocation size in bytes.
 * @param wedgeIndex Insertion or removal point used when the buffer changes size.
 * @param initValue Byte value used to initialize newly exposed bytes, or `-1`
 * to leave them untouched.
 * @return Reallocated heap pointer, or nullptr when allocation fails.
 * @remarks When the buffer grows, bytes after @p wedgeIndex are shifted toward
 * the tail so SoA gaps can expand without rebuilding the whole buffer.
 */
void *mem_realloc(void *ptr, size_t oldSize, size_t newSize, int wedgeIndex, int initValue) {
  const size_t resolvedWedgeIndex = wedgeIndex <= 0 ?
    0 :
    static_cast<size_t>(wedgeIndex) >= oldSize ?
      oldSize :
      static_cast<size_t>(wedgeIndex);

  if (newSize == oldSize) {
    return ptr;
  } else if (newSize < oldSize) {
    if (resolvedWedgeIndex < newSize) {
      const size_t removedSize = oldSize - newSize;
      const size_t sourceIndex = resolvedWedgeIndex + removedSize;
      if (sourceIndex < oldSize) {
        const size_t moveSize = oldSize - sourceIndex;
        std::memmove(
          static_cast<unsigned char *>(ptr) + resolvedWedgeIndex,
          static_cast<unsigned char *>(ptr) + sourceIndex,
          moveSize);
      }
    }
    return std::realloc(ptr, newSize);
  } else {
    void *newPtr = std::realloc(ptr, newSize);
    if (resolvedWedgeIndex < oldSize) {
      const size_t moveSize = oldSize - resolvedWedgeIndex;
      std::memmove(
        static_cast<unsigned char *>(newPtr) + newSize - resolvedWedgeIndex,
        static_cast<unsigned char *>(newPtr) + resolvedWedgeIndex,
        moveSize);
    }
    if (initValue != -1) {
      const size_t initSize = newSize - oldSize;
      if (initSize >= 1) {
        std::memset(
            static_cast<unsigned char *>(newPtr) + oldSize,
            initValue,
            initSize);
      }
    }
    return newPtr;
  }
}

} // extern "C"
