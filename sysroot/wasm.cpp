#include "wasm.hpp"

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

// The freestanding runtime has no process teardown or exception machinery.
extern "C" int __cxa_atexit(void (*)(void *), void *, void *) { return 0; }
extern "C" { void *__dso_handle = nullptr; }
extern "C" [[noreturn]] void __cxa_pure_virtual() { abort(); }
