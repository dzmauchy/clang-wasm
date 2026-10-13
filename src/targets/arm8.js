/**
 * thumbv8m.main-none-eabihf (ARMv8-M Mainline, hard-float). Built by the
 * `clang-<version>-arm8` release workflow. Bare metal: the sysroot carries only
 * Clang's resource headers and compiler-rt builtins.
 */
export default Object.freeze({
  id: "arm8",
  description: "ARMv8-M Mainline (thumbv8m.main-none-eabihf), bare metal",
  tagSuffix: "-arm8",

  triple: "thumbv8m.main-none-eabihf",
  cmakeSystemProcessor: "arm",
  llvmTarget: "ARM",

  clangArgs: [],
  lldFlavor: "elf",
  lldArgs: ["-L/sysroot/lib/clang/23/lib/baremetal", "-lclang_rt.builtins-armv8m.main"],

  sysroot: {
    resourceHeaderTargets: [
      "install-core-resource-headers",
      "install-arm-common-resource-headers",
      "install-arm-resource-headers",
    ],
    requiredResourceHeaders: ["stddef.h", "arm_acle.h"],
    cFlags: ["-ffreestanding", "-ffunction-sections", "-fdata-sections"],
    builtins: {
      libraryDir: "lib/baremetal",
      archive: "libclang_rt.builtins-armv8m.main.a",
      installTarget: "install-clang_rt.builtins-armv8m.main",
      cmakeArgs: ["-DCOMPILER_RT_DEFAULT_TARGET_ONLY=ON", "-DCOMPILER_RT_BAREMETAL_BUILD=ON"],
    },
    runtime: null,
  },
});
