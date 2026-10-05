#include "wamr-host.h"
#include "wasm_export.h"
#include <stddef.h>

static uint32_t heap_alloc(wasm_exec_env_t exec_env, uint32_t size) {
    return (uint32_t)wasm_runtime_module_malloc(
        wasm_runtime_get_module_inst(exec_env), size, NULL);
}

static void heap_free(wasm_exec_env_t exec_env, uint32_t offset) {
    wasm_runtime_module_free(wasm_runtime_get_module_inst(exec_env), offset);
}

static void print_char(wasm_exec_env_t exec_env, int32_t character) {
    (void)exec_env;
    wamr_host_print_char(character);
}
static double now(wasm_exec_env_t exec_env) {
    (void)exec_env;
    return wamr_host_now();
}
static double utc_time(wasm_exec_env_t exec_env) {
    (void)exec_env;
    return wamr_host_time();
}

bool wamr_sysroot_register(void) {
    static NativeSymbol symbols[] = {
        { "wamr_heap_alloc", (void *)heap_alloc, "(i)i", NULL },
        { "wamr_heap_free", (void *)heap_free, "(i)", NULL },
        { "wamr_print_char", (void *)print_char, "(i)", NULL },
        { "wamr_now", (void *)now, "()F", NULL },
        { "wamr_time", (void *)utc_time, "()F", NULL },
    };
    return wasm_runtime_register_natives("env", symbols, sizeof(symbols) / sizeof(symbols[0]));
}
