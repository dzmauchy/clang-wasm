#include "wamr-allocator.h"
#include <errno.h>
#include <stdint.h>
#include <string.h>

// These imports exchange Wasm offsets, never native host pointers.
__attribute__((import_module("env"), import_name("wamr_heap_alloc")))
uint32_t wamr_heap_alloc(uint32_t size);
__attribute__((import_module("env"), import_name("wamr_heap_free")))
void wamr_heap_free(uint32_t offset);

typedef struct { uint32_t raw; size_t size; } allocation_header;

static void *allocate(size_t alignment, size_t size) {
    if (alignment < _Alignof(max_align_t)) alignment = _Alignof(max_align_t);
    if (size == 0) size = 1;
    size_t overhead, total;
    if (__builtin_add_overflow(sizeof(allocation_header), alignment - 1, &overhead)
        || __builtin_add_overflow(size, overhead, &total)) {
        errno = ENOMEM;
        return NULL;
    }
    const uint32_t raw = wamr_heap_alloc(total);
    if (!raw) {
        errno = ENOMEM;
        return NULL;
    }
    const uintptr_t aligned = (raw + sizeof(allocation_header) + alignment - 1)
        & ~(uintptr_t)(alignment - 1);
    allocation_header *header = (allocation_header *)(aligned - sizeof(*header));
    header->raw = raw;
    header->size = size;
    return (void *)aligned;
}

void *wamr_malloc(size_t size) { return allocate(_Alignof(max_align_t), size); }

void wamr_free(void *ptr) {
    if (!ptr) return;
    allocation_header *header = (allocation_header *)((unsigned char *)ptr - sizeof(*header));
    wamr_heap_free(header->raw);
}

void *wamr_aligned_alloc(size_t alignment, size_t size) {
    if (!alignment || (alignment & (alignment - 1)) || size % alignment) {
        errno = EINVAL;
        return NULL;
    }
    return allocate(alignment, size);
}

void *wamr_calloc(size_t count, size_t size) {
    size_t bytes;
    if (__builtin_mul_overflow(count, size, &bytes)) {
        errno = ENOMEM;
        return NULL;
    }
    void *ptr = wamr_malloc(bytes);
    if (ptr) memset(ptr, 0, bytes);
    return ptr;
}

void *wamr_realloc(void *ptr, size_t size) {
    if (!ptr) return wamr_malloc(size);
    if (!size) {
        wamr_free(ptr);
        return NULL;
    }
    allocation_header *header = (allocation_header *)((unsigned char *)ptr - sizeof(*header));
    if (size <= header->size) {
        header->size = size;
        return ptr;
    }
    void *replacement = wamr_malloc(size);
    if (!replacement) return NULL;
    memcpy(replacement, ptr, header->size);
    wamr_free(ptr);
    return replacement;
}
