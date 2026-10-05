#ifndef WAMR_HPP
#define WAMR_HPP
#include <wamr.h>
#include <cstddef>
namespace wamr {
inline void print(const char *text) {
    while (*text) wamr_print_char(static_cast<unsigned char>(*text++));
}
inline void write(const void *data, std::size_t size) {
    const auto *bytes = static_cast<const unsigned char *>(data);
    for (std::size_t i = 0; i < size; ++i) wamr_print_char(bytes[i]);
}
inline double now() { return wamr_now(); }
}
#endif
