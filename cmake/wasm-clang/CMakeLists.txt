# Loaded through LLVM_EXTERNAL_PROJECTS after the unmodified Clang project.
include("${CMAKE_CURRENT_LIST_DIR}/../browser-target.cmake")
browser_cxx_string_list(BROWSER_TARGET_ARGS_INIT ${BROWSER_TARGET_ARGS})
file(CONFIGURE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/browser_target.h" @ONLY CONTENT [[
#pragma once
#define BROWSER_TARGET_TRIPLE "@BROWSER_TARGET_TRIPLE@"
#define BROWSER_TARGET_ARGS_INIT @BROWSER_TARGET_ARGS_INIT@
]])
set(LLVM_LINK_COMPONENTS
  ${LLVM_TARGETS_TO_BUILD}
  Option
  Support
  TargetParser)
add_llvm_executable(wasm-clang main.cpp)
target_include_directories(wasm-clang PRIVATE "${CMAKE_CURRENT_BINARY_DIR}")
target_include_directories(wasm-clang PRIVATE
  "${LLVM_EXTERNAL_CLANG_SOURCE_DIR}/include"
  "${LLVM_BINARY_DIR}/tools/clang/include")
target_link_libraries(wasm-clang PRIVATE
  clangBasic
  clangCodeGen
  clangDriver
  clangFrontend)
if(EMSCRIPTEN)
  target_link_options(wasm-clang PRIVATE "-sAUTO_NATIVE_LIBRARIES=0")
endif()

# Keep clang.js's reference to clang.wasm valid after packaging. Stock Clang
# artifacts in bin/ must never be mistaken for this custom launcher.
set_target_properties(wasm-clang PROPERTIES
  OUTPUT_NAME clang
  RUNTIME_OUTPUT_DIRECTORY "${LLVM_RUNTIME_OUTPUT_INTDIR}/custom-clang")
