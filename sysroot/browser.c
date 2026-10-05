#include <errno.h>
#include <stddef.h>
#include <stdint.h>
#include <stdbool.h>
#include <time.h>
#include <llvm-libc-types/ssize_t.h>
#if defined(WAMR_SYSROOT)
#include "wamr.h"
#define js_print_char wamr_print_char
#define js_time wamr_time
#define browser_run wamr_run
#else
#include "browser_config.h"

__attribute__((import_module("env"), import_name("js_print_char")))
void js_print_char(int character);

__attribute__((import_module("env"), import_name("js_time")))
double js_time(void);
#endif

// LLVM libc's timespec_get hook also backs libc++'s system_clock. The host
// supplies Unix-epoch milliseconds (Date.now), separately from performance.now.
bool __llvm_libc_timespec_get_utc(struct timespec* timestamp) {
    const double milliseconds = js_time();
    if (!__builtin_isfinite(milliseconds) || milliseconds < -8640000000000000.0 || milliseconds > 8640000000000000.0) {
        errno = EINVAL;
        return false;
    }
    const int64_t whole_milliseconds = (int64_t)milliseconds;
    timestamp->tv_sec = whole_milliseconds / 1000;
    timestamp->tv_nsec = (long)(whole_milliseconds % 1000) * 1000000;
    if (timestamp->tv_nsec < 0) {
        timestamp->tv_sec -= 1;
        timestamp->tv_nsec += 1000000000;
    }
    return true;
}

// LLVM libc supplies stdin/stdout/stderr and passes these opaque cookies to
// its bare-metal I/O hooks. Console input is an empty byte stream.
struct __llvm_libc_stdio_cookie { int descriptor; };
struct __llvm_libc_stdio_cookie __llvm_libc_stdin_cookie = { 0 };
struct __llvm_libc_stdio_cookie __llvm_libc_stdout_cookie = { 1 };
struct __llvm_libc_stdio_cookie __llvm_libc_stderr_cookie = { 2 };

ssize_t __llvm_libc_stdio_write(void* cookie, const char* bytes, size_t size) {
    (void)cookie;
    for (size_t i = 0; i < size; ++i) js_print_char((unsigned char)bytes[i]);
    return (ssize_t)size;
}

ssize_t __llvm_libc_stdio_read(void* cookie, char* bytes, size_t size) {
    (void)cookie;
    (void)bytes;
    (void)size;
    return 0;
}

int* __llvm_libc_errno(void) {
    static int error_number;
    return &error_number;
}

// LLVM's bare-metal allocator manages a bounded region. Reserve that region
// once on its first allocation, growing Wasm memory before touching its bytes.
#if !defined(WAMR_SYSROOT)
int __llvm_libc_heap_init(void) {
    extern unsigned char __heap_base;
    const uint64_t needed = (uint64_t)(uintptr_t)&__heap_base + BROWSER_HEAP_SIZE;
    const uint64_t page_size = 65536;
    const uint64_t available = (uint64_t)__builtin_wasm_memory_size(0) * page_size;
    if (needed > UINTPTR_MAX) {
        errno = ENOMEM;
        return 0;
    }
    if (needed > available) {
        const size_t pages = (size_t)((needed - available + page_size - 1) / page_size);
        if (__builtin_wasm_memory_grow(0, pages) == (size_t)-1) {
            errno = ENOMEM;
            return 0;
        }
    }
    return 1;
}
#endif

__attribute__((noreturn)) void __llvm_libc_exit(int status) {
    (void)status;
    __builtin_trap();
}

// Clang's Wasm ABI uses different symbols for the two standard main forms.
// A program's main(argc, argv) overrides this bridge to main(void).
extern int __main_void(void);
__attribute__((weak)) int __main_argc_argv(int argc, char** argv) {
    (void)argc;
    (void)argv;
    return __main_void();
}

extern void __wasm_call_ctors(void);
int browser_run(void) {
    static int initialized;
    if (!initialized) {
        initialized = 1;
        // Referencing this linker-generated function disables LLD's automatic
        // constructor wrappers, which otherwise rerun ctors on every export.
        __wasm_call_ctors();
    }
    // Keep argv[argc] == NULL even when the host supplies no arguments.
    char* argv[] = { NULL };
    return __main_argc_argv(0, argv);
}
