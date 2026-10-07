#include "wasm.h"

extern void __wasm_call_ctors(void);

__attribute__((export_name("wasm_initialize")))
void wasm_initialize(void) {
    static int initialized;
    if (!initialized) {
        initialized = 1;
        // Referencing this linker-generated function disables LLD's automatic
        // constructor wrappers. The host controls initialization explicitly.
        __wasm_call_ctors();
    }
}
