#ifndef WAMR_SYSROOT_H
#define WAMR_SYSROOT_H
#if !defined(__wasm32__)
#error "wamr.h requires a wasm32 target"
#endif
#ifdef __cplusplus
extern "C" {
#endif
__attribute__((import_module("env"), import_name("wamr_print_char")))
void wamr_print_char(int character);
__attribute__((import_module("env"), import_name("wamr_now")))
double wamr_now(void);
__attribute__((import_module("env"), import_name("wamr_time")))
double wamr_time(void);
// Initializes static constructors once, then calls main with empty arguments.
int wamr_run(void);
#ifdef __cplusplus
}
#endif
#define WAMR_EXPORT(name) __attribute__((export_name(#name)))
#endif
