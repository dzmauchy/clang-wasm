#include <browser.hpp>
#include <algorithm>
#include <array>
#include <charconv>
#include <chrono>
#include <format>
#include <functional>
#include <memory>
#include <memory_resource>
#include <new>
#include <numeric>
#include <string>
#include <unordered_map>
#include <vector>
#include <errno.h>
#include <math.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

extern "C" unsigned __int128 divide_wide(unsigned __int128, unsigned __int128);

#if _LIBCPP_HAS_THREADS || _LIBCPP_HAS_EXCEPTIONS || _LIBCPP_HAS_RTTI
#error "libc++ must be built without threads, exceptions, and RTTI"
#endif
#if defined(__cpp_exceptions) || defined(__cpp_rtti)
#error "Programs must use the same exception and RTTI settings as the runtime"
#endif

static volatile int initialized;
struct Initialize {
    Initialize() { initialized = initialized + 1; }
};
static Initialize initialize;
static int local_initializations;

static int twice(int value) { return value * 2; }

int main() {
    if (initialized != 1) return 1;
    const std::array numbers = {3, 4};
    char text[64];
    volatile double argument = 0.5;
    snprintf(text, sizeof(text), "libc++=%d math=%.3f", twice(std::accumulate(numbers.begin(), numbers.end(), 0)), sin(argument));
    if (strcmp(text, "libc++=14 math=0.479") != 0) return 2;
    printf("%s\n", text);
    browser::print("browser import\n");
    if (browser::now() != 123.5) return 3;
    const unsigned __int128 wide = (static_cast<unsigned __int128>(1) << 100) + 42;
    if (divide_wide(wide, 3) * 3 + wide % 3 != wide) return 4;
    return 0;
}

extern "C" BROWSER_EXPORT(cpp_checks) int cpp_checks() {
    struct Local {
        std::string text = std::string(80, 's');
        Local() { ++local_initializations; }
    };
    static Local local;
    if (local_initializations != 1 || local.text.size() != 80) return 8;
    std::vector<int> values = {4, 1, 3, 2};
    std::sort(values.begin(), values.end());
    if (values.front() != 1 || std::accumulate(values.begin(), values.end(), 0) != 10) return 1;
    std::unordered_map<std::string, int> counts;
    const std::string key(80, 'k');
    counts[key] = 14;
    if (counts.at(key) != 14) return 2;
    const auto formatted = std::format("value={} fraction={:.2f}", counts.at(key), 0.5);
    if (formatted != "value=14 fraction=0.50") return 3;
    double parsed = 0;
    const std::string fraction = "0.125";
    const auto result = std::from_chars(fraction.data(), fraction.data() + fraction.size(), parsed);
    if (result.ec != std::errc{} || parsed != 0.125) return 4;
    auto shared = std::make_shared<std::string>(key);
    auto owned = std::make_unique<int>(7);
    std::function<int()> callback = [shared, number = *owned, padding = std::array<int, 64>{}] {
        return number + int(shared->size()) + padding[0];
    };
    if (callback() != 87) return 5;
    struct alignas(64) Aligned { int value = 42; };
    auto aligned = std::make_unique<Aligned>();
    if (reinterpret_cast<uintptr_t>(aligned.get()) % alignof(Aligned) != 0 || aligned->value != 42) return 6;
    std::pmr::unsynchronized_pool_resource pool;
    std::pmr::vector<int> pooled(&pool);
    pooled.push_back(9);
    if (pooled.front() != 9) return 7;
    return 0;
}

extern "C" BROWSER_EXPORT(utc_milliseconds) double utc_milliseconds() {
    return static_cast<double>(std::chrono::duration_cast<std::chrono::milliseconds>(
        std::chrono::system_clock::now().time_since_epoch()).count());
}

extern "C" BROWSER_EXPORT(cpp_allocation_failure) void cpp_allocation_failure() {
    volatile size_t impossible = BROWSER_HEAP_SIZE;
    void* volatile allocation = ::operator new(impossible);
    ::operator delete(allocation);
}

extern "C" BROWSER_EXPORT(heap_checks) int heap_checks() {
    if (initialized != 1) return 7;
    constexpr size_t allocation_size = BROWSER_HEAP_SIZE < 800000 ? BROWSER_HEAP_SIZE / 4 : 200000;
    auto* memory = static_cast<unsigned char*>(malloc(allocation_size));
    if (!memory) return 1;
    memset(memory, 0x5a, allocation_size);
    volatile unsigned char* touched = memory;
    if (touched[0] != 0x5a || touched[allocation_size - 1] != 0x5a) return 2;
    free(memory);
    memory = static_cast<unsigned char*>(malloc(allocation_size));
    if (!memory) return 3;
    touched = memory;
    touched[0] = 0x4b;
    // The LLVM bare-metal allocator is bounded and must keep live blocks
    // intact when another allocation exceeds its configured region.
    volatile size_t impossible = BROWSER_HEAP_SIZE;
    void* volatile exhausted = malloc(impossible);
    if (exhausted != nullptr) return 4;
    void* volatile nothrow_allocation = ::operator new(impossible, std::nothrow);
    if (nothrow_allocation != nullptr) return 10;
    if (touched[0] != 0x4b) return 5;
    free(memory);
    auto* cleared = static_cast<unsigned char*>(calloc(32, 8));
    if (!cleared) return 6;
    volatile unsigned char* cleared_bytes = cleared;
    if (cleared_bytes[0] != 0 || cleared_bytes[255] != 0) return 6;
    cleared[0] = 0x2a;
    auto* resized = static_cast<unsigned char*>(realloc(cleared, 1024));
    if (!resized || resized[0] != 0x2a) return 8;
    free(resized);
    errno = EDOM;
    if (*__llvm_libc_errno() != EDOM) return 9;
    return 0;
}

extern "C" BROWSER_EXPORT(heap_failure_checks) int heap_failure_checks() {
    errno = 0;
    void* volatile allocation = malloc(8);
    if (allocation != nullptr || errno != ENOMEM) return 1;
    return 0;
}
