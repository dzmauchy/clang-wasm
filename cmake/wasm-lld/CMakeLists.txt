# Loaded through LLVM_EXTERNAL_PROJECTS after the unmodified LLD project.
set(LLVM_LINK_COMPONENTS Support)
add_llvm_executable(wasm-lld main.cpp)
target_include_directories(wasm-lld PRIVATE
  "${LLVM_EXTERNAL_LLD_SOURCE_DIR}/include")
target_link_libraries(wasm-lld PRIVATE lldWasm lldCommon)
if(EMSCRIPTEN)
  # This command-line tool does not need Emscripten's graphics/audio libraries.
  target_link_options(wasm-lld PRIVATE "-sAUTO_NATIVE_LIBRARIES=0")
endif()

# Keep the JS wrapper's reference to lld.wasm valid after packaging, without
# sharing outputs with LLVM's stock, multi-format lld target.
set_target_properties(wasm-lld PROPERTIES
  OUTPUT_NAME lld
  RUNTIME_OUTPUT_DIRECTORY "${LLVM_RUNTIME_OUTPUT_INTDIR}/wasm-only")
