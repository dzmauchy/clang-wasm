#ifndef BROWSER_HPP
#define BROWSER_HPP

#if !defined(__wasm32__)
#error "browser.hpp requires a wasm32 target"
#endif

#include <stddef.h>
#include <stdint.h>
#include <browser_config.h>

// Implement these named imports in the WebAssembly.Instance import object.
extern "C" {
__attribute__((import_module("env"), import_name("js_print_char")))
void js_print_char(int character);

__attribute__((import_module("env"), import_name("js_now")))
double js_now(void);

// Unix-epoch milliseconds, used by LLVM libc and std::chrono::system_clock.
__attribute__((import_module("env"), import_name("js_time")))
double js_time(void);

// Link -lbrowser and export browser_run. It initializes C++ static objects
// once; call it before other program exports. Use a new instance for a fresh run.
int browser_run(void);
}

#define BROWSER_EXPORT(name) __attribute__((export_name(#name)))

namespace browser {
inline void print(const char* text) {
    while (*text) js_print_char(static_cast<unsigned char>(*text++));
}

inline void write(const void* data, size_t size) {
    const auto* bytes = static_cast<const unsigned char*>(data);
    for (size_t i = 0; i < size; ++i) js_print_char(bytes[i]);
}

// Milliseconds, supplied by the host (usually performance.now()).
inline double now() { return js_now(); }
}

#endif
