#include "wasm.hpp"
#include "tlsf/tlsf.hpp"

extern "C" unsigned char __heap_base;

static tlsf_t heap;
static uint64_t heap_end;
static int error_number;
int *wasm_errno_location(void) noexcept { return &error_number; }

enum { WASM_PAGE_SIZE = 65536 };

static uint64_t memory_bytes(void) {
    return (uint64_t)__builtin_wasm_memory_size(0) * WASM_PAGE_SIZE;
}

static int ensure_memory(uint64_t needed) {
    const uint64_t available = memory_bytes();
    if (needed > (uint64_t)UINTPTR_MAX + 1) return 0;
    if (needed <= available) return 1;
    const size_t pages = (size_t)((needed - available + WASM_PAGE_SIZE - 1) / WASM_PAGE_SIZE);
    return __builtin_wasm_memory_grow(0, pages) != (size_t)-1;
}

static int initialize_heap(void) {
    if (heap) return 1;
    const uint64_t alignment = tlsf_align_size();
    const uint64_t base = ((uint64_t)(uintptr_t)&__heap_base + alignment - 1) & ~(alignment - 1);
    const uint64_t end = base + tlsf_size();
    if (!ensure_memory(end)) return 0;
    heap = tlsf_create((void *)(uintptr_t)base);
    if (heap) heap_end = end;
    return heap != nullptr;
}

static size_t pool_bytes_for_request(size_t alignment, size_t size) {
    const uint64_t word = tlsf_align_size();
    uint64_t adjusted = ((uint64_t)size + word - 1) & ~(word - 1);
    if (adjusted < tlsf_block_size_min()) adjusted = tlsf_block_size_min();
    if (adjusted >= tlsf_block_size_max()) return 0;
    if (alignment > word) {
        const uint64_t header = tlsf_block_size_min() + tlsf_alloc_overhead();
        adjusted = (adjusted + alignment + header + alignment - 1) & ~((uint64_t)alignment - 1);
    }
    if (adjusted >= tlsf_block_size_max()) return 0;

    if (adjusted >= word * 32) {
        const unsigned log2 = 31u - (unsigned)__builtin_clz((unsigned)adjusted);
        const uint64_t bin = (uint64_t)1 << (log2 - 5);
        adjusted = (adjusted + bin - 1) & ~(bin - 1);
    }
    if (adjusted >= tlsf_block_size_max()) return 0;
    return (size_t)(adjusted + tlsf_pool_overhead());
}

static int grow_heap(size_t minimum) {
    if (!ensure_memory(heap_end + minimum)) return 0;
    uint64_t bytes = memory_bytes() - heap_end;
    const size_t maximum = tlsf_block_size_max() + tlsf_pool_overhead();
    if (bytes > maximum) bytes = maximum;
    if (!tlsf_add_pool(heap, (void *)(uintptr_t)heap_end, (size_t)bytes)) return 0;
    heap_end += bytes;
    return 1;
}

static void *allocate(size_t alignment, size_t size) {
    if (!size) size = 1;
    const size_t minimum = pool_bytes_for_request(alignment, size);
    if (!minimum || !initialize_heap()) {
        error_number = WASM_ENOMEM;
        return nullptr;
    }
    void *ptr = tlsf_memalign(heap, alignment, size);
    if (!ptr && grow_heap(minimum)) ptr = tlsf_memalign(heap, alignment, size);
    if (!ptr) error_number = WASM_ENOMEM;
    return ptr;
}
void *malloc(size_t size) noexcept { return allocate(alignof(max_align_t), size); }
void free(void *ptr) noexcept { if (ptr) tlsf_free(heap, ptr); }
void *aligned_alloc(size_t alignment, size_t size) noexcept {
    if (!alignment || (alignment & (alignment - 1)) || size % alignment) {
        error_number = WASM_EINVAL;
        return nullptr;
    }
    if (alignment < alignof(max_align_t)) alignment = alignof(max_align_t);
    return allocate(alignment, size);
}
void *calloc(size_t count, size_t size) noexcept {
    size_t bytes;
    if (__builtin_mul_overflow(count, size, &bytes)) {
        error_number = WASM_ENOMEM;
        return nullptr;
    }
    void *ptr = malloc(bytes);
    if (ptr) memset(ptr, 0, bytes);
    return ptr;
}
void *realloc(void *ptr, size_t size) noexcept {
    if (!ptr) return malloc(size);
    if (!size) { free(ptr); return nullptr; }
    const size_t old_size = tlsf_block_size(ptr);
    if (size <= old_size) return ptr;

    void *replacement = malloc(size);
    if (!replacement) return nullptr;
    memcpy(replacement, ptr, size < old_size ? size : old_size);
    free(ptr);
    return replacement;
}

void *memcpy(void *dest, const void *src, size_t size) noexcept {
    auto *out = static_cast<unsigned char *>(dest);
    const auto *in = static_cast<const unsigned char *>(src);
    for (size_t i = 0; i < size; ++i) out[i] = in[i];
    return dest;
}
void *memmove(void *dest, const void *src, size_t size) noexcept {
    auto *out = static_cast<unsigned char *>(dest);
    const auto *in = static_cast<const unsigned char *>(src);
    if ((uintptr_t)out < (uintptr_t)in) return memcpy(dest, src, size);
    while (size) { --size; out[size] = in[size]; }
    return dest;
}
void *memset(void *dest, int value, size_t size) noexcept {
    auto *out = static_cast<unsigned char *>(dest);
    for (size_t i = 0; i < size; ++i) out[i] = (unsigned char)value;
    return dest;
}
int memcmp(const void *left, const void *right, size_t size) noexcept {
    const auto *a = static_cast<const unsigned char *>(left);
    const auto *b = static_cast<const unsigned char *>(right);
    for (size_t i = 0; i < size; ++i) if (a[i] != b[i]) return a[i] - b[i];
    return 0;
}
size_t strlen(const char *text) noexcept { size_t size = 0; while (text[size]) ++size; return size; }
int strcmp(const char *a, const char *b) noexcept {
    while (*a && *a == *b) { ++a; ++b; }
    return (unsigned char)*a - (unsigned char)*b;
}
int strncmp(const char *a, const char *b, size_t size) noexcept {
    for (size_t i = 0; i < size; ++i) {
        if (a[i] != b[i] || !a[i]) return (unsigned char)a[i] - (unsigned char)b[i];
    }
    return 0;
}
char *strcpy(char *dest, const char *src) noexcept {
    char *out = dest;
    while ((*out++ = *src++)) {}
    return dest;
}
[[noreturn]] void abort(void) noexcept { __builtin_trap(); }
[[noreturn]] void exit(int status) noexcept { (void)status; abort(); }

static void *checked(void *ptr) { if (!ptr) abort(); return ptr; }
static void *aligned(size_t size, std::align_val_t alignment) {
    const size_t value = static_cast<size_t>(alignment);
    size_t rounded;
    if (!value || (value & (value - 1)) || __builtin_add_overflow(size ? size : 1, value - 1, &rounded))
        return nullptr;
    return aligned_alloc(value, rounded & ~(value - 1));
}
void *operator new(size_t size) { return checked(malloc(size)); }
void *operator new[](size_t size) { return checked(malloc(size)); }
void *operator new(size_t size, const std::nothrow_t &) noexcept { return malloc(size); }
void *operator new[](size_t size, const std::nothrow_t &) noexcept { return malloc(size); }
void *operator new(size_t size, std::align_val_t alignment) { return checked(aligned(size, alignment)); }
void *operator new[](size_t size, std::align_val_t alignment) { return checked(aligned(size, alignment)); }
void *operator new(size_t size, std::align_val_t alignment, const std::nothrow_t &) noexcept { return aligned(size, alignment); }
void *operator new[](size_t size, std::align_val_t alignment, const std::nothrow_t &) noexcept { return aligned(size, alignment); }
void operator delete(void *ptr) noexcept { free(ptr); }
void operator delete[](void *ptr) noexcept { free(ptr); }
void operator delete(void *ptr, size_t) noexcept { free(ptr); }
void operator delete[](void *ptr, size_t) noexcept { free(ptr); }
void operator delete(void *ptr, const std::nothrow_t &) noexcept { free(ptr); }
void operator delete[](void *ptr, const std::nothrow_t &) noexcept { free(ptr); }
void operator delete(void *ptr, std::align_val_t) noexcept { free(ptr); }
void operator delete[](void *ptr, std::align_val_t) noexcept { free(ptr); }
void operator delete(void *ptr, size_t, std::align_val_t) noexcept { free(ptr); }
void operator delete[](void *ptr, size_t, std::align_val_t) noexcept { free(ptr); }
void operator delete(void *ptr, std::align_val_t, const std::nothrow_t &) noexcept { free(ptr); }
void operator delete[](void *ptr, std::align_val_t, const std::nothrow_t &) noexcept { free(ptr); }

extern "C" int __cxa_atexit(void (*)(void *), void *, void *) { return 0; }
extern "C" { void *__dso_handle = nullptr; }
extern "C" [[noreturn]] void __cxa_pure_virtual() { abort(); }

extern "C" void __wasm_call_ctors(void);

__attribute__((export_name("wasm_initialize")))
void wasm_initialize(void) noexcept {
    static int initialized;
    if (!initialized) {
        initialized = 1;

        __wasm_call_ctors();
    }
}
