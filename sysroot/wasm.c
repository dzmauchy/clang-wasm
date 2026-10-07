#include "wasm.h"
#include "tlsf/tlsf.h"
#include "browser_config.h"

static tlsf_t heap;
static int error_number;
int *wasm_errno_location(void) { return &error_number; }

static int initialize_heap(void) {
    if (heap) return 1;
    extern unsigned char __heap_base;
    const uintptr_t base = ((uintptr_t)&__heap_base + 15u) & ~(uintptr_t)15u;
    const uint64_t needed = (uint64_t)base + BROWSER_HEAP_SIZE;
    const uint64_t available = (uint64_t)__builtin_wasm_memory_size(0) * 65536;
    if (needed > UINTPTR_MAX || (needed > available &&
        __builtin_wasm_memory_grow(0, (size_t)((needed - available + 65535) / 65536)) == (size_t)-1)) {
        error_number = WASM_ENOMEM;
        return 0;
    }
    heap = tlsf_create_with_pool((void *)base, BROWSER_HEAP_SIZE);
    if (!heap) error_number = WASM_ENOMEM;
    return heap != NULL;
}

static void *allocate(size_t alignment, size_t size) {
    // TLSF's rounding and memalign arithmetic must not overflow.
    if (size > BROWSER_HEAP_SIZE || alignment > BROWSER_HEAP_SIZE || !initialize_heap()) {
        error_number = WASM_ENOMEM;
        return NULL;
    }
    void *ptr = tlsf_memalign(heap, alignment, size ? size : 1);
    if (!ptr) error_number = WASM_ENOMEM;
    return ptr;
}
void *malloc(size_t size) { return allocate(_Alignof(max_align_t), size); }
void free(void *ptr) { if (ptr) tlsf_free(heap, ptr); }
void *aligned_alloc(size_t alignment, size_t size) {
    if (!alignment || (alignment & (alignment - 1)) || size % alignment) {
        error_number = WASM_EINVAL;
        return NULL;
    }
    if (alignment < _Alignof(max_align_t)) alignment = _Alignof(max_align_t);
    return allocate(alignment, size);
}
void *calloc(size_t count, size_t size) {
    size_t bytes;
    if (__builtin_mul_overflow(count, size, &bytes)) {
        error_number = WASM_ENOMEM;
        return NULL;
    }
    void *ptr = malloc(bytes);
    if (ptr) memset(ptr, 0, bytes);
    return ptr;
}
void *realloc(void *ptr, size_t size) {
    if (!ptr) return malloc(size);
    if (!size) { free(ptr); return NULL; }
    const size_t old_size = tlsf_block_size(ptr);
    if (size <= old_size) return ptr;
    // Allocate through memalign to retain max_align_t alignment after moving.
    // Failure leaves the original allocation intact.
    void *replacement = malloc(size);
    if (!replacement) return NULL;
    memcpy(replacement, ptr, size < old_size ? size : old_size);
    free(ptr);
    return replacement;
}

// Compile freestanding with -fno-builtin to keep these implementations from
// being optimized into recursive calls to themselves.
void *memcpy(void *dest, const void *src, size_t size) {
    unsigned char *out = dest;
    const unsigned char *in = src;
    for (size_t i = 0; i < size; ++i) out[i] = in[i];
    return dest;
}
void *memmove(void *dest, const void *src, size_t size) {
    unsigned char *out = dest;
    const unsigned char *in = src;
    if ((uintptr_t)out < (uintptr_t)in) return memcpy(dest, src, size);
    while (size) { --size; out[size] = in[size]; }
    return dest;
}
void *memset(void *dest, int value, size_t size) {
    unsigned char *out = dest;
    for (size_t i = 0; i < size; ++i) out[i] = (unsigned char)value;
    return dest;
}
int memcmp(const void *left, const void *right, size_t size) {
    const unsigned char *a = left, *b = right;
    for (size_t i = 0; i < size; ++i) if (a[i] != b[i]) return a[i] - b[i];
    return 0;
}
size_t strlen(const char *text) { size_t size = 0; while (text[size]) ++size; return size; }
int strcmp(const char *a, const char *b) {
    while (*a && *a == *b) { ++a; ++b; }
    return (unsigned char)*a - (unsigned char)*b;
}
int strncmp(const char *a, const char *b, size_t size) {
    for (size_t i = 0; i < size; ++i) {
        if (a[i] != b[i] || !a[i]) return (unsigned char)a[i] - (unsigned char)b[i];
    }
    return 0;
}
char *strcpy(char *dest, const char *src) {
    char *out = dest;
    while ((*out++ = *src++)) {}
    return dest;
}
_Noreturn void abort(void) { __builtin_trap(); }
_Noreturn void exit(int status) { (void)status; abort(); }
