# Both modes can use the same LLVM checkout: WAMR allocation is selected by
# a compile definition, so a subsequent browser build keeps its original heap.
include("${CMAKE_CURRENT_LIST_DIR}/prepare-llvm-libc.cmake")
configure_file("${CMAKE_CURRENT_LIST_DIR}/../sysroot/wamr-allocator.h"
  "${libc}/src/stdlib/baremetal/wamr-allocator.h" COPYONLY)

foreach(name malloc free calloc realloc aligned_alloc)
  adapt("src/stdlib/baremetal/${name}.cpp"
    "#include \"src/__support/freelist_heap.h\""
    "#if defined(WAMR_SYSROOT)\n#include \"wamr-allocator.h\"\n#else\n#include \"src/__support/freelist_heap.h\"\n#endif")
endforeach()

adapt(src/stdlib/baremetal/malloc.cpp
  "return freelist_heap->allocate(size);"
  "\n#if defined(WAMR_SYSROOT)\n  return ::wamr_malloc(size);\n#else\n  return freelist_heap->allocate(size);\n#endif\n")
adapt(src/stdlib/baremetal/free.cpp
  "return freelist_heap->free(ptr);"
  "\n#if defined(WAMR_SYSROOT)\n  return ::wamr_free(ptr);\n#else\n  return freelist_heap->free(ptr);\n#endif\n")
adapt(src/stdlib/baremetal/calloc.cpp
  "return freelist_heap->calloc(num, size);"
  "\n#if defined(WAMR_SYSROOT)\n  return ::wamr_calloc(num, size);\n#else\n  return freelist_heap->calloc(num, size);\n#endif\n")
adapt(src/stdlib/baremetal/realloc.cpp
  "return freelist_heap->realloc(ptr, size);"
  "\n#if defined(WAMR_SYSROOT)\n  return ::wamr_realloc(ptr, size);\n#else\n  return freelist_heap->realloc(ptr, size);\n#endif\n")
adapt(src/stdlib/baremetal/aligned_alloc.cpp
  "return freelist_heap->aligned_allocate(alignment, size);"
  "\n#if defined(WAMR_SYSROOT)\n  return ::wamr_aligned_alloc(alignment, size);\n#else\n  return freelist_heap->aligned_allocate(alignment, size);\n#endif\n")
