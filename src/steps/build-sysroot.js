import fs from "node:fs";
import path from "node:path";
import { run, shellQuote } from "../utils/exec.js";
import { configureNativeLlvm } from "./build-native-tools.js";

function command(config, args, cwd = config.rootDir) {
  run(args.map(shellQuote).join(" "), cwd, {}, config.dryRun);
}

function writeIfChanged(file, contents) {
  if (!fs.existsSync(file) || fs.readFileSync(file, "utf8") !== contents) {
    fs.writeFileSync(file, contents);
  }
}

function resourceDirectory(installDir, dryRun) {
  const parent = path.join(installDir, "lib", "clang");
  if (dryRun) return path.join(parent, "dry-run");
  const directories = fs.readdirSync(parent);
  if (directories.length !== 1) {
    throw new Error(`Expected one installed Clang resource directory in ${parent}`);
  }
  const directory = path.join(parent, directories[0]);
  for (const header of ["stddef.h", "wasm_simd128.h"]) {
    if (!fs.existsSync(path.join(directory, "include", header))) {
      throw new Error(`Installed Clang resource directory must contain include/${header}`);
    }
  }
  return directory;
}

export function packageSysroot(config) {
  const stageDir = config.stageDir;
  // LLVM installs its selected components here; only project-owned additions
  // and license metadata need copying before archiving the entire directory.
  const copy = (source, destination) => {
    const target = path.join(stageDir, destination);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.cpSync(source, target, { recursive: true });
  };
  for (const header of ["wasm.h", "wasm.hpp"]) {
    copy(path.join(config.rootDir, "sysroot", header), `include/${header}`);
  }
  copy(path.join(config.buildSysrootDir, "browser_config.h"), "include/browser_config.h");
  copy(path.join(config.rootDir, "sysroot", "tlsf", "tlsf.h"), "include/tlsf.h");
  copy(path.join(config.rootDir, "sysroot", "tlsf", "tlsf.h"), "share/licenses/TLSF-LICENSE.txt");
  copy(path.join(config.rootDir, "sysroot", "browser.hpp"), "include/browser.hpp");
  copy(path.join(config.llvmDir, "llvm", "LICENSE.TXT"), "share/licenses/LLVM-LICENSE.TXT");
  // Use CMake's bundled archiver so packaging adds no build-host dependency.
  command(config, ["cmake", "-E", "tar", "czf", path.join(config.distDir, "sysroot.tgz"),
    "--format=gnutar", path.basename(stageDir)], config.distDir);
}

export function buildSysroot(config) {
  console.log("\n--- Building and Archiving TLSF + compiler-rt Sysroot ---");
  const heapSize = String(config.sysrootHeapSize ?? 4194304);
  if (!/^\d+$/.test(heapSize) || Number(heapSize) < 65536 || Number(heapSize) > 1073741824) {
    throw new Error("SYSROOT_HEAP_SIZE must be between 65536 and 1073741824 bytes");
  }
  if (!Number.isInteger(config.ninjaJobs) || config.ninjaJobs < 1) {
    throw new Error("Sysroot build jobs must be a positive integer");
  }
  const toolchainFile = path.join(config.buildSysrootDir, "wasm32-toolchain.cmake");
  const installDir = config.stageDir;
  const headersBuildDir = path.join(config.buildSysrootDir, "clang-headers-build");
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
    fs.rmSync(installDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(installDir, "lib"), { recursive: true });
  }

  // These install targets use source headers and do not compile Clang or TableGen.
  configureNativeLlvm(config, { buildDir: headersBuildDir, installDir });
  command(config, ["cmake", "--build", headersBuildDir, "--target",
    "install-core-resource-headers", "install-webassembly-resource-headers", "--parallel", config.ninjaJobs]);
  const resourceDir = resourceDirectory(installDir, config.dryRun);

  command(config, ["cmake", "-G", "Ninja", "-S", path.join(config.llvmDir, "compiler-rt", "lib", "builtins"),
    "-B", builtinsBuildDir, `-DCMAKE_TOOLCHAIN_FILE=${toolchainFile}`, "-DCMAKE_BUILD_TYPE=MinSizeRel",
    `-DCMAKE_INSTALL_PREFIX=${installDir}`,
    // Clang's Wasm driver searches its resource directory here, including
    // for wasm32-unknown-unknown. Let compiler-rt install directly there.
    `-DCOMPILER_RT_INSTALL_LIBRARY_DIR:STRING=lib/clang/${path.basename(resourceDir)}/lib/wasi`,
    `-DCMAKE_C_FLAGS=--sysroot=${installDir} -ffreestanding -ffunction-sections -fdata-sections`,
    "-DCOMPILER_RT_DEFAULT_TARGET_ONLY=ON", "-DCOMPILER_RT_BAREMETAL_BUILD=ON",
    "-DCOMPILER_RT_BUILTINS_ENABLE_PIC=OFF", "-DCOMPILER_RT_INCLUDE_TESTS=OFF",
    "-DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=OFF", "-DCMAKE_DISABLE_FIND_PACKAGE_LLVM=ON"]);
  command(config, ["cmake", "--build", builtinsBuildDir, "--target", "install-clang_rt.builtins-wasm32",
    "--parallel", config.ninjaJobs]);
  const flags = ["--target=wasm32-unknown-unknown", "-Oz", "-ffreestanding", "-fno-builtin",
    `--sysroot=${installDir}`, `-I${config.rootDir}/sysroot`, `-I${config.buildSysrootDir}`,
    "-ffunction-sections", "-fdata-sections"];
  const compile = (source, cxx = false) => {
    const object = path.join(config.buildSysrootDir, `${path.basename(source)}.o`);
    command(config, [cxx ? config.hostClangXXPath : config.hostClangPath, ...flags,
      ...(cxx ? ["-std=c++23", "-nostdinc++", "-fno-exceptions", "-fno-rtti", "-fno-threadsafe-statics"] : ["-std=c11"]),
      "-c", path.join(config.rootDir, "sysroot", source), "-o", object]);
    return object;
  };
  const tlsfObject = compile("tlsf/tlsf.c");
  const runtimeObjects = [compile("wasm.c"), compile("wasm.cpp", true), compile("wasm-init.c")];
  const hostObject = compile("browser.c");
  for (const [library, objects] of [
    ["libtlsf.a", [tlsfObject]], ["libwasm.a", runtimeObjects],
    ["libbrowser.a", [hostObject]],
  ]) {
    command(config, [tools.SYSROOT_AR, "rcs", path.join(installDir, "lib", library), ...objects]);
  }

  // The default compiler-rt library also supplies the freestanding allocation
  // and memory runtime. Keep the split archives available for explicit links.
  command(config, [tools.SYSROOT_AR, "rcs",
    path.join(resourceDir, "lib", "wasi", "libclang_rt.builtins-wasm32.a"),
    ...runtimeObjects, tlsfObject]);

  if (config.dryRun) {
    fs.mkdirSync(config.distDir, { recursive: true });
    fs.writeFileSync(path.join(config.distDir, "sysroot.tgz"), "mock-sysroot-tar-gz\n");
    return;
  }
  packageSysroot(config);
}

export function testSysroot(config) {
  const resourceDir = resourceDirectory(config.stageDir, config.dryRun);
  command(config, [process.execPath, path.join(config.rootDir, "tests", "sysroot-smoke.mjs"),
    config.hostClangXXPath, config.stageDir, path.join(config.buildSysrootDir, "smoke"), path.basename(resourceDir)]);
}
