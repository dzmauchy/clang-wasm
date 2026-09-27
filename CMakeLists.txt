cmake_minimum_required(VERSION 3.24)
project(custom_sysroot C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

include(FetchContent)

# -----------------------------------------------------------------------------
# Configuration & Options
# -----------------------------------------------------------------------------
# Prevent CMake from attempting to link test executables before libc exists
set(CMAKE_TRY_COMPILE_TARGET_TYPE STATIC_LIBRARY)

# Path to local llvm-project/libc (defaults to out/llvm-project/libc)
set(LLVM_LIBC_DIR "${CMAKE_CURRENT_SOURCE_DIR}/out/llvm-project/libc" CACHE PATH "Path to llvm-project/libc source directory")

if(NOT EXISTS "${LLVM_LIBC_DIR}")
  message(FATAL_ERROR "LLVM libc directory not found at '${LLVM_LIBC_DIR}'. Please specify a valid path using -DLLVM_LIBC_DIR=/path/to/llvm-project/libc")
endif()

# Sysroot layout defaults to Emscripten/Wasm conventions
set(SYSROOT_LIB_SUBDIR "lib/wasm32-emscripten" CACHE STRING "Subdirectory under install prefix for libraries")

# -----------------------------------------------------------------------------
# External Dependencies (ETL & dlmalloc)
# -----------------------------------------------------------------------------
# 1. ETL (Embedded Template Library) - Header-only
FetchContent_Declare(
  etl
  GIT_REPOSITORY https://github.com/ETLCPP/etl.git
  GIT_TAG        master
  GIT_SHALLOW    TRUE
)

# 2. dlmalloc (Doug Lea's Malloc)
FetchContent_Declare(
  dlmalloc
  GIT_REPOSITORY https://github.com/ennorehling/dlmalloc.git
  GIT_TAG        master
  GIT_SHALLOW    TRUE
)

FetchContent_MakeAvailable(etl dlmalloc)

# -----------------------------------------------------------------------------
# Dynamic WebAssembly Memory Growth Provider (sbrk)
# -----------------------------------------------------------------------------
# Connects dlmalloc to WebAssembly linear memory growth in the browser.
# Uses `__heap_base` (synthesized by wasm-ld) as the base heap offset,
# and calls `__builtin_wasm_memory_grow` in 64 KB page increments on demand.
set(SBRK_GLUE_FILE "${CMAKE_CURRENT_BINARY_DIR}/sbrk_wasm.c")
file(WRITE "${SBRK_GLUE_FILE}" "
#include <stddef.h>
#include <stdint.h>

extern char __heap_base __attribute__((weak));

void *sbrk(intptr_t increment) {
    static uintptr_t current_brk = 0;

    if (current_brk == 0) {
        current_brk = (&__heap_base != (char *)0)
            ? (uintptr_t)&__heap_base
            : (uintptr_t)((uintptr_t)__builtin_wasm_memory_size(0) * 65536);
    }

    if (increment == 0) {
        return (void *)current_brk;
    }

    uintptr_t prev_brk = current_brk;
    uintptr_t new_brk = current_brk + increment;

    uintptr_t current_bytes = (uintptr_t)__builtin_wasm_memory_size(0) * 65536;

    if (new_brk > current_bytes) {
        uintptr_t needed_bytes = new_brk - current_bytes;
        uintptr_t pages = (needed_bytes + 65535) / 65536;
        if (__builtin_wasm_memory_grow(0, pages) == -1) {
            return (void *)-1;
        }
    }

    current_brk = new_brk;
    return (void *)prev_brk;
}
")

# -----------------------------------------------------------------------------
# Collect All CPP Files from llvm-project/libc
# -----------------------------------------------------------------------------
file(GLOB_RECURSE LLVM_LIBC_SOURCES
  CONFIGURE_DEPENDS
  "${LLVM_LIBC_DIR}/src/*.cpp"
)

# 1. Strip target OS specific syscall layers
list(FILTER LLVM_LIBC_SOURCES EXCLUDE REGEX "/(linux|fuchsia|windows|darwin|gpu)/")

# 2. Strip target CPU specific assembly optimizations (use generic portable C++)
list(FILTER LLVM_LIBC_SOURCES EXCLUDE REGEX "/(x86_64|x86|aarch64|arm|riscv|nvptx|amdgpu)/")

# 3. Strip tests, benchmarks, docs, and fuzzing harnesses
list(FILTER LLVM_LIBC_SOURCES EXCLUDE REGEX "/(test|tests|benchmark|benchmarks|docs|fuzzing)/")

# 4. Strip LLVM libc's native allocators to prevent collisions with dlmalloc
list(FILTER LLVM_LIBC_SOURCES EXCLUDE REGEX "/src/stdlib/(malloc|free|calloc|realloc|aligned_alloc)\\.cpp")

# -----------------------------------------------------------------------------
# Target: libc.a
# -----------------------------------------------------------------------------
add_library(c STATIC
  ${dlmalloc_SOURCE_DIR}/dlmalloc.c
  ${SBRK_GLUE_FILE}${LLVM_LIBC_SOURCES}
)

target_include_directories(c PRIVATE
  "${dlmalloc_SOURCE_DIR}"
  "${LLVM_LIBC_DIR}"
  "${LLVM_LIBC_DIR}/include"
  "${LLVM_LIBC_DIR}/src"
)

# Optimizations specifically tuned for WebAssembly in browser environments
target_compile_definitions(c PRIVATE
  # dlmalloc browser configuration
  USE_LOCKS=0              # Single-threaded browser execution: eliminates mutexes & pthread overhead
  HAVE_MMAP=0              # Wasm runtimes do not expose OS mmap
  HAVE_MREMAP=0            # Wasm runtimes do not expose OS mremap
  MALLOC_ALIGNMENT=16      # 16-byte alignment required for WebAssembly SIMD (v128) support
  DEFAULT_GRANULARITY=65536 # Align memory expansion requests to 64 KB Wasm page boundaries
  MORECORE_CONTIGUOUS=1    # Linear memory supplied via sbrk is strictly contiguous
  NO_MALLINFO=1            # Strip unused diagnostic functions for smaller binary size
  MALLOC_DEBUG=0           # Strip internal assertions
  FOOTERS=0                # Reduce per-chunk overhead by omitting redundant trailing footers
  INSECURE=1               # Strip internal validation loops for faster runtime performance
  LACKS_UNISTD_H=1         # Eliminate POSIX header requirements in freestanding builds
  LACKS_SYS_PARAM_H=1
  LACKS_SYS_TYPES_H=1
  LACKS_TIME_H=1
  LACKS_ERRNO_H=1
  LACKS_SCHED_H=1
  # LLVM libc packaging flags
  LIBC_COPT_PUBLIC_PACKAGING=1
  _LIBC
)

target_compile_options(c PRIVATE
  -Os                      # Optimize aggressively for binary size to speed up browser download times
  -ffreestanding
  -fno-builtin
  -fno-exceptions
  -fno-rtti
)

set_target_properties(c PROPERTIES
  OUTPUT_NAME "c"
  PREFIX "lib"
)

# -----------------------------------------------------------------------------
# Installation Rules (Sysroot Layout)
# -----------------------------------------------------------------------------
# 1. Install libc.a into lib/wasm32-emscripten/
install(TARGETS c
  ARCHIVE DESTINATION "${SYSROOT_LIB_SUBDIR}"
)

# 2. Install ETL headers into include/etl
install(DIRECTORY "${etl_SOURCE_DIR}/include/etl"
  DESTINATION include
)

# 3. Install dlmalloc header into include/
install(FILES "${dlmalloc_SOURCE_DIR}/dlmalloc.h"
  DESTINATION include
)

# 4. Install public headers from llvm-project/libc into include/
if(EXISTS "${LLVM_LIBC_DIR}/include")
  install(DIRECTORY "${LLVM_LIBC_DIR}/include/"
    DESTINATION include
    FILES_MATCHING
    PATTERN "*.h"
    PATTERN "*.def"
  )
endif()