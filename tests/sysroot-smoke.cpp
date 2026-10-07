#include <browser.hpp>
#define EXPORT BROWSER_EXPORT
#include <wasm.hpp>
#include <browser_config.h>

#if __STDC_HOSTED__ != 0
#error "Applications must compile freestanding"
#endif

extern "C" unsigned __int128 divide_wide(unsigned __int128, unsigned __int128);
static volatile int initialized;
static int local_initializations;
struct Initialize { Initialize() { initialized = initialized + 1; } };
static Initialize initialize;

extern "C" EXPORT(cpp_checks) int cpp_checks() {
    // Static local initialization must use single-threaded guards.
    struct Local { Local() { ++local_initializations; } };
    static Local local;
    if (local_initializations != 1 || initialized != 1) return 1;
    void *standard = std::malloc(17);
    if (!standard || uintptr_t(standard) % alignof(std::max_align_t)) return 6;
    std::free(standard);
    int *array = new int[8]{};
    array[7] = 42;
    if (array[0] || array[7] != 42) return 2;
    delete[] array;
    struct alignas(4096) Aligned { int value = 42; };
    auto *aligned = new Aligned;
    if (uintptr_t(aligned) % 4096 || aligned->value != 42) return 3;
    delete aligned;
    auto *optional = new (std::nothrow) Aligned;
    if (!optional || uintptr_t(optional) % 4096) return 4;
    delete optional;
    alignas(Aligned) unsigned char storage[sizeof(Aligned)];
    auto *placed = new (storage) Aligned;
    if (placed->value != 42) return 5;
    placed->~Aligned();
    return 0;
}

extern "C" EXPORT(heap_checks) int heap_checks() {
    free(nullptr);
    void *zero = malloc(0);
    if (!zero) return 1;
    free(zero);
    for (size_t size = 1; size < 257; ++size) {
        void *ptr = malloc(size);
        if (!ptr || uintptr_t(ptr) % alignof(max_align_t)) return 2;
        memset(ptr, 0x5a, size);
        free(ptr);
    }
    const size_t alignments[] = {16, 64, 4096};
    for (size_t alignment : alignments) {
        void *ptr = aligned_alloc(alignment, alignment);
        if (!ptr || uintptr_t(ptr) % alignment) return 3;
        free(ptr);
    }
    if (aligned_alloc(3, 12) || *wasm_errno_location() != WASM_EINVAL) return 4;
    if (aligned_alloc(64, 65) || *wasm_errno_location() != WASM_EINVAL) return 5;
    auto *ptr = static_cast<unsigned char *>(calloc(32, 8));
    if (!ptr) return 6;
    for (int i = 0; i < 256; ++i) if (ptr[i]) return 7;
    ptr[0] = 0x2a; ptr[255] = 0x5b;
    auto *resized = static_cast<unsigned char *>(realloc(ptr, 1024));
    if (!resized || uintptr_t(resized) % alignof(max_align_t) || resized[0] != 0x2a || resized[255] != 0x5b) return 8;
    ptr = resized;
    volatile size_t impossible = SIZE_MAX;
    if (realloc(ptr, impossible) || *wasm_errno_location() != WASM_ENOMEM || ptr[0] != 0x2a) return 9;
    resized = static_cast<unsigned char *>(realloc(ptr, 16));
    if (!resized || resized[0] != 0x2a) return 10;
    if (realloc(resized, 0)) return 11;
    ptr = static_cast<unsigned char *>(realloc(nullptr, 32));
    if (!ptr) return 12;
    free(ptr);
    if (calloc(impossible, 2) || *wasm_errno_location() != WASM_ENOMEM) return 13;
    // Exhaust the pool using large blocks, then verify reuse and live data.
    void *blocks[128];
    size_t count = 0;
    const size_t chunk = BROWSER_HEAP_SIZE / 32;
    while (count < 128 && (blocks[count] = malloc(chunk))) ++count;
    if (!count || count == 128 || *wasm_errno_location() != WASM_ENOMEM) return 14;
    memset(blocks[0], 0x39, chunk);
    if (realloc(blocks[0], BROWSER_HEAP_SIZE) || static_cast<unsigned char *>(blocks[0])[0] != 0x39) return 15;
    if (::operator new(BROWSER_HEAP_SIZE, std::nothrow)) return 16;
    for (size_t i = 0; i < count; ++i) free(blocks[i]);
    ptr = static_cast<unsigned char *>(malloc(chunk));
    if (!ptr) return 17;
    free(ptr);
    return 0;
}

extern "C" EXPORT(memory_checks) int memory_checks() {
    char text[32];
    strcpy(text, "abcdef");
    if (strlen(text) != 6 || strcmp(text, "abcdef") || strncmp(text, "abcxyz", 3)) return 1;
    memmove(text + 1, text, 7);
    if (strcmp(text, "aabcdef")) return 2;
    memmove(text, text + 1, 7);
    if (strcmp(text, "abcdef")) return 3;
    char copy[32];
    memcpy(copy, text, 7);
    if (memcmp(copy, text, 7)) return 4;
    return 0;
}
extern "C" EXPORT(cpp_allocation_failure) void cpp_allocation_failure() {
    volatile size_t impossible = SIZE_MAX;
    void *volatile allocation = ::operator new(impossible);
    ::operator delete(allocation);
}
extern "C" EXPORT(heap_failure_checks) int heap_failure_checks() {
    *wasm_errno_location() = 0;
    void *volatile allocation = malloc(8);
    return allocation != nullptr || *wasm_errno_location() != WASM_ENOMEM;
}
extern "C" EXPORT(constructor_count) int constructor_count() { return initialized; }

extern "C" EXPORT(runtime_checks) int runtime_checks() {
    if (initialized != 1) return 1;
    const unsigned __int128 wide = (static_cast<unsigned __int128>(1) << 100) + 42;
    if (divide_wide(wide, 3) * 3 + wide % 3 != wide) return 2;
    int result = memory_checks();
    if (result) return 200 + result;
    if (browser::now() != 123.5 || js_time() != 1234567890123.0) return 3;
    puts("TLSF runtime OK");
    return 0;
}
