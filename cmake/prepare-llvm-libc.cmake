# LLVM libc's portable implementations support Wasm, but its full-build
# configuration still needs a machine profile and a few bare-metal hooks.
set(libc "${LLVM_SOURCE_DIR}/libc")
function(adapt relative original replacement)
  set(path "${libc}/${relative}")
  file(READ "${path}" contents)
  string(FIND "${contents}" "${replacement}" already_adapted)
  if(NOT already_adapted EQUAL -1)
    return()
  endif()
  string(FIND "${contents}" "${original}" location)
  if(location EQUAL -1)
    message(FATAL_ERROR "Unsupported LLVM libc source layout in ${relative}")
  endif()
  string(REPLACE "${original}" "${replacement}" contents "${contents}")
  file(WRITE "${path}" "${contents}")
endfunction()

adapt(cmake/modules/LLVMLibCArchitectures.cmake
  "elseif(target_arch MATCHES \"^spirv\")"
  "elseif(target_arch MATCHES \"^wasm32$\")\n    set(target_arch \"wasm32\")\n  elseif(target_arch MATCHES \"^spirv\")")
adapt(cmake/modules/LLVMLibCArchitectures.cmake
  "elseif(LIBC_TARGET_ARCHITECTURE STREQUAL \"spirv\")"
  "elseif(LIBC_TARGET_ARCHITECTURE STREQUAL \"wasm32\")\n  set(LIBC_TARGET_ARCHITECTURE_IS_WASM TRUE)\nelseif(LIBC_TARGET_ARCHITECTURE STREQUAL \"spirv\")")
adapt(include/llvm-libc-types/fenv_t.h
  "#elif defined(__riscv)"
  "#elif defined(__wasm__)\ntypedef unsigned int fenv_t;\n#elif defined(__riscv)")
adapt(src/__support/OSUtil/io.h
  "#elif defined(__ELF__)"
  "#elif defined(__ELF__) || defined(__wasm__)")
adapt(src/stdlib/abort_utils.h
  "#elif defined(__ELF__)"
  "#elif defined(__ELF__) || defined(__wasm__)")

# Use LLVM's FreeListHeap on a bounded linear-memory region, allocated lazily
# by the browser runtime. No allocator implementation is copied into JS.
adapt(src/__support/freelist_heap.h
  "  constexpr FreeListHeap() : begin(&_end), end(&__llvm_libc_heap_limit) {}"
  "#if defined(__wasm__)\n  constexpr FreeListHeap() : begin(__heap_base), end(__heap_base + BROWSER_HEAP_SIZE) {}\n#else\n  constexpr FreeListHeap() : begin(&_end), end(&__llvm_libc_heap_limit) {}\n#endif")
adapt(src/__support/freelist_heap.h
  "extern \"C\" cpp::byte _end;"
  "#if defined(__wasm__)\nextern \"C\" cpp::byte __heap_base[BROWSER_HEAP_SIZE];\nextern \"C\" int __llvm_libc_heap_init(void);\n#endif\nextern \"C\" cpp::byte _end;")
adapt(src/__support/freelist_heap.h
  "  if (!is_initialized)\n    init();"
  "  if (!is_initialized) {\n#if defined(__wasm__)\n    if (!__llvm_libc_heap_init()) return nullptr;\n#endif\n    init();\n  }")

# Reuse the upstream portable bare-metal API selection. Architecture-specific
# setjmp and ELF startup functions are not appropriate for this reactor.
set(profile "${libc}/config/baremetal/wasm32")
file(MAKE_DIRECTORY "${profile}")
file(READ "${libc}/config/baremetal/arm/headers.txt" headers)
string(REGEX REPLACE "[ \t]*libc.include.(setjmp|elf)\n" "" headers "${headers}")
file(WRITE "${profile}/headers.txt" "${headers}")
file(READ "${libc}/config/baremetal/arm/entrypoints.txt" entrypoints)
string(REGEX REPLACE "[ \t]*libc.(src.setjmp.[a-z_]+|startup.baremetal.[a-z_]+)\n" "" entrypoints "${entrypoints}")
file(WRITE "${profile}/entrypoints.txt" "${entrypoints}")
