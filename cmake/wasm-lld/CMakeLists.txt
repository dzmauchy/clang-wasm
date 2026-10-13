# Loaded through LLVM_EXTERNAL_PROJECTS after the unmodified LLD project.
include("${CMAKE_CURRENT_LIST_DIR}/../browser-target.cmake")
if(BROWSER_LLD_FLAVOR STREQUAL "wasm")
  set(BROWSER_LLD_NAMESPACE wasm)
  set(BROWSER_LLD_DRIVER_FLAVOR Wasm)
  set(BROWSER_LLD_PROGRAM wasm-ld)
  set(BROWSER_LLD_LIBRARY lldWasm)
elseif(BROWSER_LLD_FLAVOR STREQUAL "elf")
  set(BROWSER_LLD_NAMESPACE elf)
  set(BROWSER_LLD_DRIVER_FLAVOR Gnu)
  set(BROWSER_LLD_PROGRAM ld.lld)
  set(BROWSER_LLD_LIBRARY lldELF)
else()
  message(FATAL_ERROR "Unsupported BROWSER_LLD_FLAVOR '${BROWSER_LLD_FLAVOR}' (expected wasm or elf)")
endif()
browser_cxx_string_list(BROWSER_LLD_ARGS_INIT ${BROWSER_LLD_ARGS})
file(CONFIGURE OUTPUT "${CMAKE_CURRENT_BINARY_DIR}/browser_lld.h" @ONLY CONTENT [[
#pragma once
#define BROWSER_LLD_NAMESPACE @BROWSER_LLD_NAMESPACE@
#define BROWSER_LLD_DRIVER_FLAVOR @BROWSER_LLD_DRIVER_FLAVOR@
#define BROWSER_LLD_PROGRAM "@BROWSER_LLD_PROGRAM@"
#define BROWSER_LLD_ARGS_INIT @BROWSER_LLD_ARGS_INIT@
]])

set(LLVM_LINK_COMPONENTS Support)
add_llvm_executable(wasm-lld main.cpp)
target_include_directories(wasm-lld PRIVATE
  "${LLVM_EXTERNAL_LLD_SOURCE_DIR}/include"
  "${CMAKE_CURRENT_BINARY_DIR}")
target_link_libraries(wasm-lld PRIVATE ${BROWSER_LLD_LIBRARY} lldCommon)
if(EMSCRIPTEN)
  # This command-line tool does not need Emscripten's graphics/audio libraries.
  target_link_options(wasm-lld PRIVATE "-sAUTO_NATIVE_LIBRARIES=0")
endif()

# Keep the JS wrapper's reference to lld.wasm valid after packaging, without
# sharing outputs with LLVM's stock, multi-format lld target.
set_target_properties(wasm-lld PROPERTIES
  OUTPUT_NAME lld
  RUNTIME_OUTPUT_DIRECTORY "${LLVM_RUNTIME_OUTPUT_INTDIR}/wasm-only")
