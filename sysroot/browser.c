#include "wasm.h"
__attribute__((import_module("env"), import_name("js_print_char")))
void js_print_char(int character);

int putchar(int character) { js_print_char((unsigned char)character); return (unsigned char)character; }
int puts(const char *text) { while (*text) putchar((unsigned char)*text++); putchar('\n'); return 0; }
