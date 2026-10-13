/**
 * wasm32-unknown-unknown: the original target. Ships a sysroot with the
 * project's own freestanding runtime (TLSF + wasm.hpp + browser.hpp).
 */
export default Object.freeze({
  id: "wasm32",
  description: "WebAssembly (wasm32-unknown-unknown) with the freestanding runtime",
  // Release tag suffix: clang-<version><tagSuffix>
  tagSuffix: "",

  triple: "wasm32-unknown-unknown",
  cmakeSystemProcessor: "wasm32",
  llvmTarget: "WebAssembly",

  // Target-specific driver flags of the in-browser compiler (cmake/wasm-clang).
  clangArgs: ["-fvisibility=default"],
  // Flags added to every in-browser LLD (cmake/wasm-lld) invocation.
  lldFlavor: "wasm",
  lldArgs: ["-L/sysroot/lib/clang/23/lib/wasi", "-lclang_rt.builtins-wasm32"],

  sysroot: {
    resourceHeaderTargets: ["install-core-resource-headers", "install-webassembly-resource-headers"],
    requiredResourceHeaders: ["stddef.h", "wasm_simd128.h"],
    // Flags for compiling compiler-rt builtins and the project runtime.
    cFlags: ["-ffreestanding", "-ffunction-sections", "-fdata-sections"],
    builtins: {
      // Directory (relative to the resource dir) that receives the archive.
      libraryDir: "lib/wasi",
      archive: "libclang_rt.builtins-wasm32.a",
      installTarget: "install-clang_rt.builtins-wasm32",
      cmakeArgs: ["-DCOMPILER_RT_DEFAULT_TARGET_ONLY=ON", "-DCOMPILER_RT_BAREMETAL_BUILD=ON"],
    },
    // Project-owned C++ runtime compiled into the sysroot; null when absent.
    runtime: {
      compileFlags: ["-Oz", "-ffreestanding", "-fno-builtin", "-std=c++23", "-nostdinc++",
        "-fno-exceptions", "-fno-rtti", "-fno-threadsafe-statics",
        "-ffunction-sections", "-fdata-sections"],
    },
  },
});
