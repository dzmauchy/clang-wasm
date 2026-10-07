#ifndef WASM_H
#define WASM_H
#include <stddef.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#define WASM_NOEXCEPT noexcept
#define WASM_NORETURN [[noreturn]]
#else
#define WASM_NOEXCEPT
#define WASM_NORETURN _Noreturn
#endif

// Initialize C++ static constructors once before calling application exports.
void wasm_initialize(void) WASM_NOEXCEPT;

// Single-threaded, bounded TLSF heap. Allocation failure returns NULL.
void *malloc(size_t size) WASM_NOEXCEPT;
void free(void *ptr) WASM_NOEXCEPT;
void *calloc(size_t count, size_t size) WASM_NOEXCEPT;
void *realloc(void *ptr, size_t size) WASM_NOEXCEPT;
void *aligned_alloc(size_t alignment, size_t size) WASM_NOEXCEPT;
void *memcpy(void *restrict_dest, const void *restrict_src, size_t size) WASM_NOEXCEPT;
void *memmove(void *dest, const void *src, size_t size) WASM_NOEXCEPT;
void *memset(void *dest, int value, size_t size) WASM_NOEXCEPT;
int memcmp(const void *left, const void *right, size_t size) WASM_NOEXCEPT;
size_t strlen(const char *text) WASM_NOEXCEPT;
int strcmp(const char *left, const char *right) WASM_NOEXCEPT;
int strncmp(const char *left, const char *right, size_t size) WASM_NOEXCEPT;
char *strcpy(char *dest, const char *src) WASM_NOEXCEPT;
int putchar(int character) WASM_NOEXCEPT;
int puts(const char *text) WASM_NOEXCEPT;
WASM_NORETURN void abort(void) WASM_NOEXCEPT;
WASM_NORETURN void exit(int status) WASM_NOEXCEPT;

// Error numbers for allocation APIs; no dependency on libc's errno storage.
#define WASM_ENOMEM 12
#define WASM_EINVAL 22
int *wasm_errno_location(void) WASM_NOEXCEPT;
#ifdef __cplusplus
}
#endif
#undef WASM_NOEXCEPT
#undef WASM_NORETURN
#endif
