#include "browser.hpp"

int putchar(int character) noexcept { js_print_char((unsigned char)character); return (unsigned char)character; }
int puts(const char *text) noexcept { while (*text) putchar((unsigned char)*text++); putchar('\n'); return 0; }
