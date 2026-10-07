#ifndef WASM_HPP
#define WASM_HPP
#include <wasm.h>

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

// Ordinary new traps on exhaustion; nothrow new returns nullptr.
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
