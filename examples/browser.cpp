#include <browser.hpp>
#include <wasm.hpp>

extern "C" BROWSER_EXPORT(run_demo) int run_demo() {
    auto *readings = new int[2]{21, 23};
    if (readings[0] + readings[1] != 44) return 1;
    delete[] readings;
    browser::print("Hello from bare WebAssembly!\n");
    return 0;
}
