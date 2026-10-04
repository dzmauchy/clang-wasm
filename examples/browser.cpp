#include <browser.hpp>
#include <vector>
#include <stdio.h>

int main() {
    std::vector<int> readings;
    readings.push_back(21);
    readings.push_back(23);
    printf("libc++ readings: %d, %d\n", readings[0], readings[1]);
    printf("Browser time: %.2f ms\n", browser::now());
    browser::print("Hello from bare WebAssembly!\n");
    return 0;
}
