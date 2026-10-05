#ifndef WAMR_ALLOCATOR_H
#define WAMR_ALLOCATOR_H
#include <stddef.h>
#ifdef __cplusplus
// Upstream allocator sources obtain the entrypoint macro through their heap
// support header; the WAMR replacement must supply it explicitly as well.
#include "src/__support/common.h"
#endif
#ifdef __cplusplus
extern "C" {
#endif
void *wamr_malloc(size_t size);
void wamr_free(void *ptr);
void *wamr_calloc(size_t count, size_t size);
void *wamr_realloc(void *ptr, size_t size);
void *wamr_aligned_alloc(size_t alignment, size_t size);
#ifdef __cplusplus
}
#endif
#endif
