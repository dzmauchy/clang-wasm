#ifndef WAMR_SYSROOT_HOST_H
#define WAMR_SYSROOT_HOST_H
#include <stdbool.h>
#include <stdint.h>
#ifdef __cplusplus
extern "C" {
#endif
// Call after WAMR initialization and before loading modules.
bool wamr_sysroot_register(void);
// Supply these platform hooks in the native embedding application.
void wamr_host_print_char(int32_t character);
double wamr_host_now(void);  // Monotonic milliseconds.
double wamr_host_time(void); // Unix-epoch milliseconds.
#ifdef __cplusplus
}
#endif
#endif
