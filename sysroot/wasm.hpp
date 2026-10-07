#ifndef WASM_HPP
#define WASM_HPP
#if __cplusplus < 202302L
#error "wasm.hpp requires C++23"
#endif

#include <stddef.h>
#include <stdint.h>

extern "C" {
void wasm_initialize(void) noexcept;
void *malloc(size_t size) noexcept;
void free(void *ptr) noexcept;
void *calloc(size_t count, size_t size) noexcept;
void *realloc(void *ptr, size_t size) noexcept;
void *aligned_alloc(size_t alignment, size_t size) noexcept;
void *memcpy(void *restrict_dest, const void *restrict_src, size_t size) noexcept;
void *memmove(void *dest, const void *src, size_t size) noexcept;
void *memset(void *dest, int value, size_t size) noexcept;
int memcmp(const void *left, const void *right, size_t size) noexcept;
size_t strlen(const char *text) noexcept;
int strcmp(const char *left, const char *right) noexcept;
int strncmp(const char *left, const char *right, size_t size) noexcept;
char *strcpy(char *dest, const char *src) noexcept;
int putchar(int character) noexcept;
int puts(const char *text) noexcept;
[[noreturn]] void abort(void) noexcept;
[[noreturn]] void exit(int status) noexcept;
int *wasm_errno_location(void) noexcept;
}

inline constexpr int WASM_ENOMEM = 12;
inline constexpr int WASM_EINVAL = 22;

namespace std {
using size_t = ::size_t;
using ptrdiff_t = ::ptrdiff_t;
using nullptr_t = decltype(nullptr);
using max_align_t = ::max_align_t;
using ::malloc;
using ::free;
using ::calloc;
using ::realloc;
using ::aligned_alloc;
using ::memcpy;
using ::memmove;
using ::memset;
using ::memcmp;
using ::strlen;
using ::strcmp;
using ::strncmp;
using ::strcpy;
using ::putchar;
using ::puts;
using ::abort;
using ::exit;
struct nothrow_t { explicit constexpr nothrow_t() = default; };
inline constexpr nothrow_t nothrow{};
enum class align_val_t : size_t {};
}

void *operator new(size_t size);
void *operator new[](size_t size);
void *operator new(size_t size, const std::nothrow_t &) noexcept;
void *operator new[](size_t size, const std::nothrow_t &) noexcept;
void *operator new(size_t size, std::align_val_t alignment);
void *operator new[](size_t size, std::align_val_t alignment);
void *operator new(size_t size, std::align_val_t alignment, const std::nothrow_t &) noexcept;
void *operator new[](size_t size, std::align_val_t alignment, const std::nothrow_t &) noexcept;
void operator delete(void *ptr) noexcept;
void operator delete[](void *ptr) noexcept;
void operator delete(void *ptr, size_t size) noexcept;
void operator delete[](void *ptr, size_t size) noexcept;
void operator delete(void *ptr, const std::nothrow_t &) noexcept;
void operator delete[](void *ptr, const std::nothrow_t &) noexcept;
void operator delete(void *ptr, std::align_val_t alignment) noexcept;
void operator delete[](void *ptr, std::align_val_t alignment) noexcept;
void operator delete(void *ptr, size_t size, std::align_val_t alignment) noexcept;
void operator delete[](void *ptr, size_t size, std::align_val_t alignment) noexcept;
void operator delete(void *ptr, std::align_val_t alignment, const std::nothrow_t &) noexcept;
void operator delete[](void *ptr, std::align_val_t alignment, const std::nothrow_t &) noexcept;
inline void *operator new(size_t, void *ptr) noexcept { return ptr; }
inline void *operator new[](size_t, void *ptr) noexcept { return ptr; }
inline void operator delete(void *, void *) noexcept {}
inline void operator delete[](void *, void *) noexcept {}
#endif
