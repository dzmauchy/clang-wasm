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

function resourceDirectory(installDir, dryRun, target) {
  const parent = path.join(installDir, "lib", "clang");
  if (dryRun) return path.join(parent, "dry-run");
  const directories = fs.readdirSync(parent);
  if (directories.length !== 1) {
    throw new Error(`Expected one installed Clang resource directory in ${parent}`);
  }
  const directory = path.join(parent, directories[0]);
  for (const header of target.sysroot.requiredResourceHeaders) {
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
  if (config.target.sysroot.runtime) {
    copy(path.join(config.rootDir, "sysroot", "wasm.hpp"), "include/wasm.hpp");
    copy(path.join(config.rootDir, "sysroot", "tlsf", "tlsf.hpp"), "include/tlsf.hpp");
    copy(path.join(config.rootDir, "sysroot", "tlsf", "tlsf.hpp"), "share/licenses/TLSF-LICENSE.txt");
    copy(path.join(config.rootDir, "sysroot", "browser.hpp"), "include/browser.hpp");
  }
  copy(path.join(config.llvmDir, "llvm", "LICENSE.TXT"), "share/licenses/LLVM-LICENSE.TXT");
  // Use CMake's bundled archiver so packaging adds no build-host dependency.
  command(config, ["cmake", "-E", "tar", "czf", path.join(config.distDir, "sysroot.tgz"),
    "--format=gnutar", path.basename(stageDir)], config.distDir);
}

/**
 * Compiles the project-owned C++ runtime into libtlsf/libwasm/libbrowser and
 * folds the allocator/runtime objects into the compiler-rt builtins archive.
 * Only targets whose descriptor declares `sysroot.runtime` use this.
 */
function buildProjectRuntime(config, { installDir, resourceDir, builtinsArchive, tools }) {
  const { target } = config;
  const flags = [`--target=${target.triple}`, ...target.sysroot.runtime.compileFlags,
    `--sysroot=${installDir}`, `-I${config.rootDir}/sysroot`];
  const compile = (source) => {
    const object = path.join(config.buildSysrootDir, `${path.basename(source)}.o`);
    command(config, [config.hostClangXXPath, ...flags,
      "-c", path.join(config.rootDir, "sysroot", source), "-o", object]);
    return object;
  };
  const tlsfObject = compile("tlsf/tlsf.cpp");
  const runtimeObjects = [compile("wasm.cpp")];
  const hostObject = compile("browser.cpp");
  for (const [library, objects] of [
    ["libtlsf.a", [tlsfObject]], ["libwasm.a", runtimeObjects],
    ["libbrowser.a", [hostObject]],
  ]) {
    command(config, [tools.SYSROOT_AR, "rcs", path.join(installDir, "lib", library), ...objects]);
  }

  // The default compiler-rt library also supplies the freestanding allocation
  // and memory runtime. Keep the split archives available for explicit links.
  command(config, [tools.SYSROOT_AR, "rcs", builtinsArchive, ...runtimeObjects, tlsfObject]);
}

export function buildSysroot(config) {
  if (!Number.isInteger(config.ninjaJobs) || config.ninjaJobs < 1) {
    throw new Error("Sysroot build jobs must be a positive integer");
  }
  const { target } = config;
  const { sysroot } = target;
  console.log(`\n--- Building and Archiving Sysroot (${target.id}) ---`);
  const toolchainFile = path.join(config.buildSysrootDir, `${target.id}-toolchain.cmake`);
  const installDir = config.stageDir;
  const headersBuildDir = path.join(config.buildSysrootDir, "clang-headers-build");
  const builtinsBuildDir = path.join(config.buildSysrootDir, "compiler_rt-prefix", "src", "compiler_rt-build");
  const tools = {
    SYSROOT_CLANG: config.hostClangPath,
    SYSROOT_CLANGXX: config.hostClangXXPath,
    SYSROOT_AR: path.join(config.hostBinDir, "llvm-ar"),
    SYSROOT_RANLIB: path.join(config.hostBinDir, "llvm-ranlib"),
    SYSTEM_PROCESSOR: target.cmakeSystemProcessor,
    TARGET_TRIPLE: target.triple,
  };
  if (!config.dryRun) {
    fs.mkdirSync(config.buildSysrootDir, { recursive: true });
    const template = fs.readFileSync(path.join(config.rootDir, "cmake", "toolchain.cmake.in"), "utf8");
    const toolchain = template.replace(/@(\w+)@/g, (_, name) =>
      String(tools[name]).replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$"));
    writeIfChanged(toolchainFile, toolchain);
    fs.rmSync(installDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(installDir, "lib"), { recursive: true });
  }

  // These install targets use source headers; only targets that need generated
  // headers pull in TableGen.
  configureNativeLlvm(config, { buildDir: headersBuildDir, installDir });
  command(config, ["cmake", "--build", headersBuildDir, "--target",
    ...sysroot.resourceHeaderTargets, "--parallel", config.ninjaJobs]);
  const resourceDir = resourceDirectory(installDir, config.dryRun, target);

  const { builtins } = sysroot;
  const builtinsLibraryDir = path.join(resourceDir, builtins.libraryDir);
  command(config, ["cmake", "-G", "Ninja", "-S", path.join(config.llvmDir, "compiler-rt", "lib", "builtins"),
    "-B", builtinsBuildDir, `-DCMAKE_TOOLCHAIN_FILE=${toolchainFile}`, "-DCMAKE_BUILD_TYPE=MinSizeRel",
    `-DCMAKE_INSTALL_PREFIX=${installDir}`,
    // Clang's driver searches its resource directory here. Let compiler-rt
    // install directly there.
    `-DCOMPILER_RT_INSTALL_LIBRARY_DIR:STRING=lib/clang/${path.basename(resourceDir)}/${builtins.libraryDir}`,
    `-DCMAKE_C_FLAGS=--sysroot=${installDir} ${sysroot.cFlags.join(" ")}`,
    ...builtins.cmakeArgs,
    "-DCOMPILER_RT_BUILTINS_ENABLE_PIC=OFF", "-DCOMPILER_RT_INCLUDE_TESTS=OFF",
    "-DLLVM_ENABLE_PER_TARGET_RUNTIME_DIR=OFF",
    "-DCMAKE_DISABLE_FIND_PACKAGE_LLVM=ON"]);
  command(config, ["cmake", "--build", builtinsBuildDir, "--target", builtins.installTarget,
    "--parallel", config.ninjaJobs]);

  if (sysroot.runtime) {
    buildProjectRuntime(config, {
      installDir, resourceDir, tools,
      builtinsArchive: path.join(builtinsLibraryDir, builtins.archive),
    });
  }

  if (config.dryRun) {
    fs.mkdirSync(config.distDir, { recursive: true });
    fs.writeFileSync(path.join(config.distDir, "sysroot.tgz"), "mock-sysroot-tar-gz\n");
    return;
  }
  packageSysroot(config);
}

export function testSysroot(config) {
  const { target } = config;
  const resourceDir = resourceDirectory(config.stageDir, config.dryRun, target);
  if (!target.sysroot.runtime) {
    // No project runtime to execute: check that the compiler-rt archive was installed.
    const archive = path.join(resourceDir, target.sysroot.builtins.libraryDir, target.sysroot.builtins.archive);
    if (!config.dryRun && !fs.existsSync(archive)) {
      throw new Error(`Missing compiler-rt builtins: ${archive}`);
    }
    console.log(`Sysroot for ${target.id} contains ${path.basename(archive)}.`);
    return;
  }
  command(config, [process.execPath, path.join(config.rootDir, "tests", "sysroot-smoke.mjs"),
    config.hostClangXXPath, config.stageDir, path.join(config.buildSysrootDir, "smoke"), path.basename(resourceDir)]);
}
