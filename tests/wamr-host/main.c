#include "wasm_export.h"
#include "wamr-host.h"
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static char output[256];
static size_t output_size;
void wamr_host_print_char(int32_t character) {
    if (output_size + 1 < sizeof(output)) output[output_size++] = (char)character;
}
double wamr_host_now(void) { return 123.5; }
double wamr_host_time(void) { return 1234567890123.0; }

int main(int argc, char **argv) {
    const bool feature_probe = argc == 3 && !strcmp(argv[2], "--feature-probe");
    if (argc != 2 && !feature_probe) return 1;
    FILE *file = fopen(argv[1], "rb");
    if (!file || fseek(file, 0, SEEK_END)) return 2;
    long length = ftell(file);
    if (length <= 0 || length > UINT32_MAX || fseek(file, 0, SEEK_SET)) return 3;
    unsigned char *bytes = malloc((size_t)length);
    if (!bytes || fread(bytes, 1, (size_t)length, file) != (size_t)length) return 4;
    fclose(file);
    if (!wasm_runtime_init() || !wamr_sysroot_register()) return 5;
    char error[256];
    wasm_module_t module = wasm_runtime_load(bytes, (uint32_t)length, error, sizeof(error));
    if (!module) { fprintf(stderr, "%s\n", error); return 6; }
    wasm_module_inst_t instance = wasm_runtime_instantiate(module, 32768, 65536, error, sizeof(error));
    if (!instance) { fprintf(stderr, "%s\n", error); return 7; }
    wasm_exec_env_t env = wasm_runtime_create_exec_env(instance, 32768);
    wasm_function_inst_t run = wasm_runtime_lookup_function(instance, "wamr_run");
    if (!env || !run) return 8;
    for (int i = 0; i < (feature_probe ? 1 : 2); ++i) {
        uint32_t result = 0;
        if (!wasm_runtime_call_wasm(env, run, 0, &result)) {
            fprintf(stderr, "wamr_run trapped: %s\n", wasm_runtime_get_exception(instance));
            return 9;
        }
        if (result) { fprintf(stderr, "Guest check failed: %u\n", result); return 10; }
    }
    if (!feature_probe) {
        if (strcmp(output, "WAMR C++23/PMR OK\nWAMR C++23/PMR OK\n")) return 11;
        wasm_function_inst_t failure = wasm_runtime_lookup_function(instance, "allocation_failure");
        uint32_t result = 0;
        if (!failure || wasm_runtime_call_wasm(env, failure, 0, &result)
            || !wasm_runtime_get_exception(instance)) return 12;
    }
    wasm_runtime_destroy_exec_env(env);
    wasm_runtime_deinstantiate(instance);
    wasm_runtime_unload(module);
    wasm_runtime_destroy();
    free(bytes);
    puts(feature_probe ? "WAMR extended call_indirect feature probe passed."
        : "WAMR sysroot smoke test passed: C++23, PMR, constructors, alignment, exhaustion, realloc, and failure policy.");
    return 0;
}
