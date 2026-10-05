#include <wamr.hpp>
#include <bit>
#include <chrono>
#include <expected>
#include <format>
#include <memory>
#include <memory_resource>
#include <new>
#include <string>
#include <vector>
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#if __cplusplus < 202302L || _LIBCPP_HAS_THREADS || _LIBCPP_HAS_EXCEPTIONS || _LIBCPP_HAS_RTTI
#error "Test requires C++23 and the single-threaded exception-free runtime"
#endif

static int constructors;
static std::string initialized_string(80, 's');
struct Initialize { Initialize() { ++constructors; } };
static Initialize initialize;

static int allocations() {
    free(nullptr);
    void *zero = malloc(0);
    if (!zero) return 1;
    free(zero);
    for (size_t size = 1; size < 257; ++size) {
        void *ptr = malloc(size);
        if (!ptr || uintptr_t(ptr) % alignof(std::max_align_t)) return 2;
        memset(ptr, 0x5a, size);
        free(ptr);
    }
    for (size_t alignment : {size_t(16), size_t(64), size_t(4096)}) {
        auto *ptr = static_cast<unsigned char *>(aligned_alloc(alignment, alignment));
        if (!ptr || uintptr_t(ptr) % alignment) return 3;
        memset(ptr, 0x4b, alignment);
        free(ptr);
    }
    errno = 0;
    volatile size_t invalid_alignment = 3;
    if (aligned_alloc(invalid_alignment, 12) || errno != EINVAL) return 4;
    errno = 0;
    if (aligned_alloc(64, 65) || errno != EINVAL) return 5;
    auto *ptr = static_cast<unsigned char *>(calloc(32, 8));
    if (!ptr) return 6;
    for (int i = 0; i < 256; ++i) if (ptr[i]) return 7;
    ptr[0] = 0x2a;
    ptr[255] = 0x5b;
    auto *resized = static_cast<unsigned char *>(realloc(ptr, 1024));
    if (!resized || uintptr_t(resized) % alignof(std::max_align_t)
        || resized[0] != 0x2a || resized[255] != 0x5b) return 8;
    ptr = resized;
    volatile size_t impossible = SIZE_MAX;
    errno = 0;
    if (realloc(ptr, impossible) || errno != ENOMEM || ptr[0] != 0x2a) return 9;
    resized = static_cast<unsigned char *>(realloc(ptr, 16));
    if (resized != ptr || resized[0] != 0x2a) return 10;
    if (realloc(resized, 0) != nullptr) return 11;
    ptr = static_cast<unsigned char *>(realloc(nullptr, 32));
    if (!ptr) return 12;
    free(ptr);
    errno = 0;
    void *volatile overflow = calloc(impossible, 2);
    if (overflow || errno != ENOMEM) return 13;

    // Exhaust the actual WAMR app heap, then verify reuse and failed realloc.
    void *blocks[128];
    size_t count = 0;
    while (count < 128 && (blocks[count] = malloc(1024))) ++count;
    if (count < 16 || count == 128 || errno != ENOMEM) return 14;
    memset(blocks[0], 0x39, 1024);
    errno = 0;
    if (realloc(blocks[0], 32768) || errno != ENOMEM
        || static_cast<unsigned char *>(blocks[0])[0] != 0x39) return 15;
    void *volatile exhausted_new = ::operator new(32768, std::nothrow);
    if (exhausted_new != nullptr) return 16;
    for (size_t i = 0; i < count; ++i) free(blocks[i]);
    ptr = static_cast<unsigned char *>(malloc(32768));
    if (!ptr) return 17;
    free(ptr);
    return 0;
}

static int cpp_checks() {
    if (constructors != 1 || initialized_string.size() != 80) return 1;
    static std::string local(80, 'l');
    if (local.size() != 80) return 2;
    std::expected<int, int> result = 42;
    if (result.value() != 42 || std::byteswap(uint32_t(0x12345678)) != 0x78563412) return 3;
    const auto text = std::format("value={}", *result);
    if (!text.contains("42")) return 4;
    struct alignas(4096) Aligned { int value = 42; };
    auto object = std::make_unique<Aligned>();
    if (uintptr_t(object.get()) % alignof(Aligned) || object->value != 42) return 5;
    auto shared = std::make_shared<Aligned>();
    if (uintptr_t(shared.get()) % alignof(Aligned) || shared->value != 42) return 6;
    std::pmr::vector<Aligned> defaults;
    defaults.resize(2);
    if (uintptr_t(defaults.data()) % alignof(Aligned)) return 7;
    std::pmr::unsynchronized_pool_resource pool;
    std::pmr::vector<int> pooled(&pool);
    pooled.assign(100, 7);
    if (pooled.back() != 7) return 8;
    std::pmr::monotonic_buffer_resource arena;
    std::pmr::string message(&arena);
    message.assign(256, 'a');
    if (message.size() != 256) return 9;
    auto *resource = std::pmr::new_delete_resource();
    void *overaligned = resource->allocate(17, 256);
    if (uintptr_t(overaligned) % 256) return 10;
    resource->deallocate(overaligned, 17, 256);
    const double utc = static_cast<double>(std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count());
    if (utc != 1234567890123.0 || wamr::now() != 123.5) return 11;
    return 0;
}

int main() {
    int result = cpp_checks();
    if (result) return 100 + result;
    result = allocations();
    if (result) return 200 + result;
    wamr::print("WAMR C++23/PMR OK\n");
    return 0;
}

extern "C" WAMR_EXPORT(allocation_failure) void allocation_failure() {
    volatile size_t impossible = SIZE_MAX;
    void *volatile ptr = ::operator new(impossible);
    ::operator delete(ptr);
}
