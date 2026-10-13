# Shared by the cmake/wasm-clang and cmake/wasm-lld external projects. The
# per-target values come from src/targets/*.js via -DBROWSER_* cache variables.
set(BROWSER_TARGET_TRIPLE "wasm32-unknown-unknown" CACHE STRING
  "Target triple compiled by the in-browser Clang")
set(BROWSER_TARGET_ARGS "" CACHE STRING
  "Extra target-specific Clang driver arguments (semicolon-separated)")
set(BROWSER_LLD_FLAVOR "wasm" CACHE STRING
  "LLD driver embedded in the in-browser linker: wasm or elf")
set(BROWSER_LLD_ARGS "" CACHE STRING
  "Arguments appended to every in-browser LLD invocation (semicolon-separated)")

# Turns a CMake list into the body of a C++ braced initializer of string literals.
function(browser_cxx_string_list out)
  set(result "")
  foreach(item IN LISTS ARGN)
    string(REPLACE "\\" "\\\\" item "${item}")
    string(REPLACE "\"" "\\\"" item "${item}")
    string(APPEND result "\"${item}\", ")
  endforeach()
  set(${out} "${result}" PARENT_SCOPE)
endfunction()
