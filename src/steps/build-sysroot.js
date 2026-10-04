import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { run, shellQuote } from "../utils/exec.js";

// Keep all target runtimes on the same LLVM source release and bare-metal ABI.
const RUNTIME_OPTIONS = [
  "-DCMAKE_BUILD_TYPE=MinSizeRel",
  "-DCMAKE_POSITION_INDEPENDENT_CODE=OFF",
  "-DLLVM_ENABLE_RUNTIMES=libc;libcxxabi;libcxx",
  "-DLLVM_DEFAULT_TARGET_TRIPLE=wasm32-unknown-unknown",
  "-DLIBC_TARGET_TRIPLE=wasm32-unknown-unknown",
  "-DLLVM_LIBC_FULL_BUILD=ON",
  "-DLLVM_INCLUDE_TESTS=OFF",
  "-DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=OFF",
  "-DRUNTIMES_USE_LIBC=llvm-libc",
  "-DLIBC_CONF_ERRNO_MODE=LIBC_ERRNO_MODE_EXTERNAL",
  "-DLIBC_CONF_THREAD_MODE=LIBC_THREAD_MODE_SINGLE",
  "-DLIBC_CONF_PRINTF_DISABLE_FLOAT=OFF",
  "-DLIBC_CONF_SCANF_DISABLE_FLOAT=OFF",
  "-DLIBC_CONF_MATH_OPTIMIZATIONS=LIBC_MATH_NO_EXCEPT",
  "-DLIBCXX_ENABLE_SHARED=OFF",
  "-DLIBCXX_ENABLE_STATIC=ON",
  "-DLIBCXX_CXX_ABI=libcxxabi",
  "-DLIBCXX_STATICALLY_LINK_ABI_IN_STATIC_LIBRARY=OFF",
  "-DLIBCXX_USE_COMPILER_RT=ON",
  "-DLIBCXX_HAS_PTHREAD_LIB=OFF",
  "-DLIBCXX_HAS_RT_LIB=OFF",
  "-DLIBCXX_HAS_ATOMIC_LIB=OFF",
  "-DLIBCXXABI_HAS_PTHREAD_LIB=OFF",
  "-DLIBCXXABI_HAS_GCC_S_LIB=OFF",
  "-DLIBCXX_ENABLE_THREADS=OFF",
  "-DLIBCXX_ENABLE_RTTI=OFF",
  "-DLIBCXX_ENABLE_EXCEPTIONS=OFF",
  "-DLIBCXX_ENABLE_FILESYSTEM=OFF",
  "-DLIBCXX_ENABLE_LOCALIZATION=OFF",
  "-DLIBCXX_ENABLE_WIDE_CHARACTERS=OFF",
  "-DLIBCXX_ENABLE_RANDOM_DEVICE=OFF",
  "-DLIBCXX_ENABLE_MONOTONIC_CLOCK=OFF",
  "-DLIBCXX_ENABLE_TIME_ZONE_DATABASE=OFF",
  "-DLIBCXX_INCLUDE_BENCHMARKS=OFF",
  "-DLIBCXX_INSTALL_MODULES=OFF",
  "-DLIBCXXABI_ENABLE_SHARED=OFF",
  "-DLIBCXXABI_ENABLE_STATIC=ON",
  "-DLIBCXXABI_ENABLE_THREADS=OFF",
  "-DLIBCXXABI_ENABLE_RTTI=OFF",
  "-DLIBCXXABI_ENABLE_EXCEPTIONS=OFF",
  "-DLIBCXXABI_USE_LLVM_UNWINDER=OFF",
  "-DLIBCXXABI_USE_COMPILER_RT=ON",
  "-DLIBCXXABI_BAREMETAL=ON",
  "-DCMAKE_DISABLE_FIND_PACKAGE_LLVM=ON",
];

function command(config, args, cwd = config.rootDir) {
  run(args.map(shellQuote).join(" "), cwd, {}, config.dryRun);
}

function writeIfChanged(file, contents) {
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== contents) {
    fs.writeFileSync(file, contents);
  }
}

function resourceDirectory(config) {
  const directory = config.clangResourceDir || (config.dryRun
    ? path.join(config.hostLlvmDir, "lib", "clang", "dry-run")
    : execFileSync(config.hostClangPath, ["-print-resource-dir"], { encoding: "utf8" }).trim());
  const resolved = path.resolve(directory);
  if (!config.dryRun && !fs.existsSync(path.join(resolved, "include", "stddef.h"))) {
    throw new Error("Clang resource directory must contain include/stddef.h");
  }
  return resolved;
}

function filesUnder(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? filesUnder(file) : [file];
  });
}

export function packageSysroot(config, { installDir, builtinsBuildDir, resourceDir }) {
  const builtins = filesUnder(builtinsBuildDir)
    .filter(file => path.basename(file) === "libclang_rt.builtins-wasm32.a");
  if (builtins.length !== 1) {
    throw new Error(`Expected one Wasm compiler-rt archive, found: ${builtins.join(", ")}`);
  }

  const stageDir = config.stageDir;
  fs.rmSync(stageDir, { recursive: true, force: true });
  const copy = (source, destination) => {
    const target = path.join(stageDir, destination);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });
  };
  copy(path.join(installDir, "include"), "include");
  for (const name of ["libc.a", "libm.a"]) {
    copy(path.join(installDir, "lib", "wasm32-unknown-unknown", name), `lib/${name}`);
  }
  for (const name of ["libc++.a", "libc++abi.a"]) {
    copy(path.join(installDir, "lib", name), `lib/${name}`);
  }
  copy(path.join(config.rootDir, "sysroot", "browser.hpp"), "include/browser.hpp");
  copy(path.join(config.buildSysrootDir, "browser_config.h"), "include/browser_config.h");
  copy(path.join(config.buildSysrootDir, "libbrowser.a"), "lib/libbrowser.a");
  const resourceVersion = path.basename(resourceDir);
  copy(path.join(resourceDir, "include"), `lib/clang/${resourceVersion}/include`);
  copy(builtins[0], "lib/libclang_rt.builtins-wasm32.a");
  // Clang's Wasm driver searches here even for wasm32-unknown-unknown.
  copy(builtins[0], `lib/clang/${resourceVersion}/lib/wasi/libclang_rt.builtins-wasm32.a`);
  copy(path.join(config.llvmDir, "llvm", "LICENSE.TXT"), "share/licenses/LLVM-LICENSE.TXT");
  const archives = filesUnder(stageDir).filter(file => file.endsWith(".a")).sort();
  command(config, [config.llvmStripPath, "--strip-debug", ...archives]);
  // Use CMake's bundled archiver so packaging adds no build-host dependency.
  command(config, ["cmake", "-E", "tar", "czf", path.join(config.distDir, "sysroot.tgz"),
    "--format=gnutar", "sysroot"], config.distDir);
}

export function buildSysroot(config) {
  console.log("\n--- Building and Archiving LLVM libc + libc++ + libc++abi Sysroot ---");
  const heapSize = String(config.sysrootHeapSize ?? 4194304);
  if (!/^\d+$/.test(heapSize) || Number(heapSize) < 65536 || Number(heapSize) > 1073741824) {
    throw new Error("SYSROOT_HEAP_SIZE must be between 65536 and 1073741824 bytes");
  }
  if (!Number.isInteger(config.ninjaJobs) || config.ninjaJobs < 1) {
    throw new Error("Sysroot build jobs must be a positive integer");
  }
  const resourceDir = resourceDirectory(config);
  const toolchainFile = path.join(config.buildSysrootDir, "wasm32-toolchain.cmake");
  const installDir = path.join(config.buildSysrootDir, "llvm-runtimes-install");
  // Reuse dependency build directories created by the previous CMake wrapper.
  const runtimesBuildDir = path.join(config.buildSysrootDir, "llvm_runtimes-prefix", "src", "llvm_runtimes-build");
  const builtinsBuildDir = path.join(config.buildSysrootDir, "compiler_rt-prefix", "src", "compiler_rt-build");
  const tools = {
    SYSROOT_CLANG: config.hostClangPath,
    SYSROOT_CLANGXX: config.hostClangXXPath,
    SYSROOT_AR: path.join(config.hostBinDir, "llvm-ar"),
    SYSROOT_RANLIB: path.join(config.hostBinDir, "llvm-ranlib"),
  };
  if (!config.dryRun) {
    fs.mkdirSync(config.buildSysrootDir, { recursive: true });
    const template = fs.readFileSync(path.join(config.rootDir, "cmake", "wasm32-toolchain.cmake.in"), "utf8");
    const toolchain = template.replace(/@(\w+)@/g, (_, name) =>
      String(tools[name]).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$"));
    writeIfChanged(toolchainFile, toolchain);
    const header = fs.readFileSync(path.join(config.rootDir, "sysroot", "browser_config.h.in"), "utf8")
      .replaceAll("@SYSROOT_HEAP_SIZE@", heapSize);
    writeIfChanged(path.join(config.buildSysrootDir, "browser_config.h"), header);
  }

  for (const script of ["prepare-llvm-libc.cmake", "prepare-libcxx.cmake"]) {
    command(config, ["cmake", `-DLLVM_SOURCE_DIR=${config.llvmDir}`, "-P", path.join(config.rootDir, "cmake", script)]);
  }
  command(config, ["cmake", "-G", "Ninja", "-S", path.join(config.llvmDir, "runtimes"), "-B", runtimesBuildDir,
    `-DCMAKE_TOOLCHAIN_FILE=${toolchainFile}`, `-DCMAKE_INSTALL_PREFIX=${installDir}`,
    `-DCMAKE_CXX_FLAGS=-DBROWSER_HEAP_SIZE=${heapSize} -ffunction-sections -fdata-sections -fno-exceptions -fno-rtti`,
    ...RUNTIME_OPTIONS]);
  command(config, ["cmake", "--build", runtimesBuildDir, "--target", "libc", "libm", "cxx", "cxxabi",
    "--parallel", config.ninjaJobs]);
  command(config, ["cmake", "--build", runtimesBuildDir, "--target", "install-libc", "install-cxx", "install-cxxabi",
    "--parallel", config.ninjaJobs]);

  command(config, ["cmake", "-G", "Ninja", "-S", path.join(config.llvmDir, "compiler-rt", "lib", "builtins"),
    "-B", builtinsBuildDir, `-DCMAKE_TOOLCHAIN_FILE=${toolchainFile}`, "-DCMAKE_BUILD_TYPE=MinSizeRel",
    `-DCMAKE_C_FLAGS=--sysroot=${installDir} -ffunction-sections -fdata-sections`,
    "-DCOMPILER_RT_DEFAULT_TARGET_ONLY=ON", "-DCOMPILER_RT_BAREMETAL_BUILD=ON",
    "-DCOMPILER_RT_BUILTINS_ENABLE_PIC=OFF", "-DCOMPILER_RT_INCLUDE_TESTS=OFF",
    "-DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=OFF", "-DCMAKE_DISABLE_FIND_PACKAGE_LLVM=ON"]);
  command(config, ["cmake", "--build", builtinsBuildDir, "--parallel", config.ninjaJobs]);
  command(config, [config.hostClangPath, "--target=wasm32-unknown-unknown", "-std=c11", "-Oz",
    `--sysroot=${installDir}`, `-I${config.buildSysrootDir}`, "-ffunction-sections", "-fdata-sections",
    "-c", path.join(config.rootDir, "sysroot", "browser.c"), "-o", path.join(config.buildSysrootDir, "browser.o")]);
  command(config, [tools.SYSROOT_AR, "rcs", path.join(config.buildSysrootDir, "libbrowser.a"),
    path.join(config.buildSysrootDir, "browser.o")]);

  if (config.dryRun) {
    fs.mkdirSync(config.distDir, { recursive: true });
    fs.writeFileSync(path.join(config.distDir, "sysroot.tgz"), "mock-sysroot-tar-gz\n");
    return;
  }
  packageSysroot(config, { installDir, builtinsBuildDir, resourceDir });
}

export function testSysroot(config) {
  const resourceDir = resourceDirectory(config);
  command(config, [process.execPath, path.join(config.rootDir, "tests", "sysroot-smoke.mjs"),
    config.hostClangXXPath, config.stageDir, path.join(config.buildSysrootDir, "smoke"), path.basename(resourceDir)]);
}
