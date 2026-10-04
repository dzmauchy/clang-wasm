cmake_minimum_required(VERSION 3.24)
project(browser_sysroot LANGUAGES NONE)

include(ExternalProject)
set(SYSROOT_OUTPUT_DIR "${CMAKE_SOURCE_DIR}/dist" CACHE PATH "Directory for sysroot and sysroot.tgz")
set(SYSROOT_JOBS 4 CACHE STRING "Parallel jobs for dependency builds")
set(LLVM_VERSION "23.1.2" CACHE STRING "LLVM release used if sources must be downloaded")
set(LLVM_SOURCE_DIR "${CMAKE_SOURCE_DIR}/out/llvm-project" CACHE PATH "LLVM source tree")
set(SYSROOT_HEAP_SIZE 4194304 CACHE STRING "Bytes reserved for LLVM libc's browser heap")
if(NOT SYSROOT_HEAP_SIZE MATCHES "^[0-9]+$" OR SYSROOT_HEAP_SIZE LESS 65536 OR SYSROOT_HEAP_SIZE GREATER 1073741824)
  message(FATAL_ERROR "SYSROOT_HEAP_SIZE must be between 65536 and 1073741824 bytes")
endif()

find_program(SYSROOT_CLANG NAMES clang HINTS "${CMAKE_SOURCE_DIR}/out/llvm/bin" REQUIRED)
get_filename_component(llvm_bin "${SYSROOT_CLANG}" DIRECTORY)
find_program(SYSROOT_CLANGXX NAMES clang++ HINTS "${llvm_bin}" REQUIRED)
find_program(SYSROOT_AR NAMES llvm-ar HINTS "${llvm_bin}" REQUIRED)
find_program(SYSROOT_RANLIB NAMES llvm-ranlib HINTS "${llvm_bin}" REQUIRED)
find_program(SYSROOT_STRIP NAMES llvm-strip HINTS "${llvm_bin}" REQUIRED)
find_program(NINJA NAMES ninja REQUIRED)
execute_process(COMMAND "${SYSROOT_CLANG}" -print-resource-dir
  OUTPUT_VARIABLE host_resource_dir OUTPUT_STRIP_TRAILING_WHITESPACE
  COMMAND_ERROR_IS_FATAL ANY)
set(CLANG_RESOURCE_DIR "${host_resource_dir}" CACHE PATH "Resource headers matching the browser Clang version")
get_filename_component(CLANG_RESOURCE_VERSION "${CLANG_RESOURCE_DIR}" NAME)
if(NOT EXISTS "${CLANG_RESOURCE_DIR}/include/stddef.h")
  message(FATAL_ERROR "CLANG_RESOURCE_DIR must contain include/stddef.h")
endif()

# All target runtimes are built from the same LLVM source release.
set(llvm_dependency)
if(NOT EXISTS "${LLVM_SOURCE_DIR}/libc/CMakeLists.txt" OR NOT EXISTS "${LLVM_SOURCE_DIR}/libcxx/CMakeLists.txt"
    OR NOT EXISTS "${LLVM_SOURCE_DIR}/libcxxabi/CMakeLists.txt" OR NOT EXISTS "${LLVM_SOURCE_DIR}/compiler-rt/lib/builtins/CMakeLists.txt")
  set(LLVM_SOURCE_DIR "${CMAKE_BINARY_DIR}/llvm-source")
  ExternalProject_Add(llvm_source
    SOURCE_DIR "${LLVM_SOURCE_DIR}"
    GIT_REPOSITORY https://github.com/llvm/llvm-project.git
    GIT_TAG "llvmorg-${LLVM_VERSION}" GIT_SHALLOW TRUE UPDATE_COMMAND ""
    CONFIGURE_COMMAND "" BUILD_COMMAND "" INSTALL_COMMAND "")
  set(llvm_dependency llvm_source)
endif()

configure_file(cmake/wasm32-toolchain.cmake.in wasm32-toolchain.cmake @ONLY)
configure_file(sysroot/browser_config.h.in browser_config.h @ONLY)
set(libc_install "${CMAKE_BINARY_DIR}/llvm-runtimes-install")
ExternalProject_Add(llvm_runtimes
  SOURCE_DIR "${LLVM_SOURCE_DIR}/runtimes"
  DOWNLOAD_COMMAND "" DEPENDS ${llvm_dependency}
  PATCH_COMMAND "${CMAKE_COMMAND}" "-DLLVM_SOURCE_DIR=${LLVM_SOURCE_DIR}"
    -P "${CMAKE_SOURCE_DIR}/cmake/prepare-llvm-libc.cmake"
    COMMAND "${CMAKE_COMMAND}" "-DLLVM_SOURCE_DIR=${LLVM_SOURCE_DIR}"
      -P "${CMAKE_SOURCE_DIR}/cmake/prepare-libcxx.cmake"
  CMAKE_GENERATOR Ninja
  LIST_SEPARATOR |
  CMAKE_ARGS
    "-DCMAKE_TOOLCHAIN_FILE=${CMAKE_BINARY_DIR}/wasm32-toolchain.cmake"
    -DCMAKE_BUILD_TYPE=MinSizeRel
    "-DCMAKE_INSTALL_PREFIX=${libc_install}"
    "-DCMAKE_CXX_FLAGS=-DBROWSER_HEAP_SIZE=${SYSROOT_HEAP_SIZE} -ffunction-sections -fdata-sections -fno-exceptions -fno-rtti"
    -DCMAKE_POSITION_INDEPENDENT_CODE=OFF
    -DLLVM_ENABLE_RUNTIMES=libc|libcxxabi|libcxx
    -DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-unknown-unknown
    -DLIBC_TARGET_TRIPLE=wasm32-unknown-unknown
    -DLLVM_LIBC_FULL_BUILD=ON
    -DLLVM_INCLUDE_TESTS=OFF
    -DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=OFF
    -DRUNTIMES_USE_LIBC=llvm-libc
    -DLIBC_CONF_ERRNO_MODE=LIBC_ERRNO_MODE_EXTERNAL
    -DLIBC_CONF_THREAD_MODE=LIBC_THREAD_MODE_SINGLE
    -DLIBC_CONF_PRINTF_DISABLE_FLOAT=OFF
    -DLIBC_CONF_SCANF_DISABLE_FLOAT=OFF
    -DLIBC_CONF_MATH_OPTIMIZATIONS=LIBC_MATH_NO_EXCEPT
    -DLIBCXX_ENABLE_SHARED=OFF
    -DLIBCXX_ENABLE_STATIC=ON
    -DLIBCXX_CXX_ABI=libcxxabi
    -DLIBCXX_STATICALLY_LINK_ABI_IN_STATIC_LIBRARY=OFF
    -DLIBCXX_USE_COMPILER_RT=ON
    # Symbol probes cannot link under CMAKE_TRY_COMPILE_TARGET_TYPE=STATIC_LIBRARY.
    # Explicitly exclude OS libraries instead of accepting false positives.
    -DLIBCXX_HAS_PTHREAD_LIB=OFF
    -DLIBCXX_HAS_RT_LIB=OFF
    -DLIBCXX_HAS_ATOMIC_LIB=OFF
    -DLIBCXXABI_HAS_PTHREAD_LIB=OFF
    -DLIBCXXABI_HAS_GCC_S_LIB=OFF
    -DLIBCXX_ENABLE_THREADS=OFF
    -DLIBCXX_ENABLE_RTTI=OFF
    -DLIBCXX_ENABLE_EXCEPTIONS=OFF
    -DLIBCXX_ENABLE_FILESYSTEM=OFF
    -DLIBCXX_ENABLE_LOCALIZATION=OFF
    -DLIBCXX_ENABLE_WIDE_CHARACTERS=OFF
    -DLIBCXX_ENABLE_RANDOM_DEVICE=OFF
    -DLIBCXX_ENABLE_MONOTONIC_CLOCK=OFF
    -DLIBCXX_ENABLE_TIME_ZONE_DATABASE=OFF
    -DLIBCXX_INCLUDE_BENCHMARKS=OFF
    -DLIBCXX_INSTALL_MODULES=OFF
    -DLIBCXXABI_ENABLE_SHARED=OFF
    -DLIBCXXABI_ENABLE_STATIC=ON
    -DLIBCXXABI_ENABLE_THREADS=OFF
    -DLIBCXXABI_ENABLE_RTTI=OFF
    -DLIBCXXABI_ENABLE_EXCEPTIONS=OFF
    -DLIBCXXABI_USE_LLVM_UNWINDER=OFF
    -DLIBCXXABI_USE_COMPILER_RT=ON
    -DLIBCXXABI_BAREMETAL=ON
    -DCMAKE_DISABLE_FIND_PACKAGE_LLVM=ON
  BUILD_COMMAND "${CMAKE_COMMAND}" --build <BINARY_DIR> --target libc libm cxx cxxabi --parallel "${SYSROOT_JOBS}"
  INSTALL_COMMAND "${CMAKE_COMMAND}" --build <BINARY_DIR> --target install-libc install-cxx install-cxxabi --parallel "${SYSROOT_JOBS}"
  BUILD_BYPRODUCTS "${libc_install}/lib/wasm32-unknown-unknown/libc.a" "${libc_install}/lib/wasm32-unknown-unknown/libm.a"
    "${libc_install}/lib/libc++.a" "${libc_install}/lib/libc++abi.a")
ExternalProject_Add_StepDependencies(llvm_runtimes patch "${CMAKE_SOURCE_DIR}/cmake/prepare-llvm-libc.cmake")
ExternalProject_Add_StepDependencies(llvm_runtimes patch "${CMAKE_SOURCE_DIR}/cmake/prepare-libcxx.cmake")
ExternalProject_Add_StepDependencies(llvm_runtimes configure "${CMAKE_BINARY_DIR}/wasm32-toolchain.cmake")

ExternalProject_Add(compiler_rt
  SOURCE_DIR "${LLVM_SOURCE_DIR}/compiler-rt/lib/builtins"
  DOWNLOAD_COMMAND "" DEPENDS llvm_runtimes ${llvm_dependency}
  CMAKE_GENERATOR Ninja
  CMAKE_ARGS
    "-DCMAKE_TOOLCHAIN_FILE=${CMAKE_BINARY_DIR}/wasm32-toolchain.cmake"
    -DCMAKE_BUILD_TYPE=MinSizeRel
    "-DCMAKE_C_FLAGS=--sysroot=${libc_install} -ffunction-sections -fdata-sections"
    -DCOMPILER_RT_DEFAULT_TARGET_ONLY=ON
    -DCOMPILER_RT_BAREMETAL_BUILD=ON
    -DCOMPILER_RT_BUILTINS_ENABLE_PIC=OFF
    -DCOMPILER_RT_INCLUDE_TESTS=OFF
    -DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=OFF
    -DCMAKE_DISABLE_FIND_PACKAGE_LLVM=ON
  BUILD_COMMAND "${CMAKE_COMMAND}" --build <BINARY_DIR> --parallel "${SYSROOT_JOBS}"
  INSTALL_COMMAND "")
ExternalProject_Get_Property(compiler_rt BINARY_DIR)
set(compiler_rt_build "${BINARY_DIR}")
ExternalProject_Add_StepDependencies(compiler_rt configure "${CMAKE_BINARY_DIR}/wasm32-toolchain.cmake")

add_custom_command(OUTPUT "${CMAKE_BINARY_DIR}/libbrowser.a"
  COMMAND "${SYSROOT_CLANG}" --target=wasm32-unknown-unknown -std=c11 -Oz
    "--sysroot=${libc_install}" "-I${CMAKE_BINARY_DIR}" -ffunction-sections -fdata-sections
    -c "${CMAKE_SOURCE_DIR}/sysroot/browser.c" -o "${CMAKE_BINARY_DIR}/browser.o"
  COMMAND "${SYSROOT_AR}" rcs "${CMAKE_BINARY_DIR}/libbrowser.a" "${CMAKE_BINARY_DIR}/browser.o"
  DEPENDS llvm_runtimes "${libc_install}/lib/wasm32-unknown-unknown/libc.a" "${CMAKE_BINARY_DIR}/browser_config.h" sysroot/browser.c VERBATIM)
add_custom_target(browser_runtime DEPENDS "${CMAKE_BINARY_DIR}/libbrowser.a")

configure_file(cmake/package-sysroot.cmake.in package-sysroot.cmake @ONLY)
file(MAKE_DIRECTORY "${SYSROOT_OUTPUT_DIR}")
add_custom_target(sysroot ALL
  COMMAND "${CMAKE_COMMAND}" -P "${CMAKE_BINARY_DIR}/package-sysroot.cmake"
  DEPENDS llvm_runtimes compiler_rt browser_runtime
  BYPRODUCTS "${SYSROOT_OUTPUT_DIR}/sysroot.tgz"
  WORKING_DIRECTORY "${SYSROOT_OUTPUT_DIR}"
  COMMENT "Assembling LLVM libc + libc++ + libc++abi browser sysroot and sysroot.tgz"
  VERBATIM)

include(CTest)
if(BUILD_TESTING)
  find_program(NODE NAMES node)
  if(NODE)
    add_test(NAME browser_sysroot
      COMMAND "${NODE}" "${CMAKE_SOURCE_DIR}/tests/sysroot-smoke.mjs"
        "${SYSROOT_CLANGXX}" "${SYSROOT_OUTPUT_DIR}/sysroot"
        "${CMAKE_BINARY_DIR}/smoke" "${CLANG_RESOURCE_VERSION}")
  endif()
endif()
