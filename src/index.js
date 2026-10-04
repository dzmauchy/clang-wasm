#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "node:util";
import { resolveBuildConfig } from "./config.js";
import { ensureOutDir } from "./utils/fs.js";
import { ensureEmsdk, DEFAULT_EMSDK_VERSION } from "./steps/ensure-emsdk.js";
import { ensureLlvmProject } from "./steps/ensure-llvm.js";
import { ensureHostLlvm } from "./steps/ensure-host-llvm.js";
import { ensureLibicu } from "./steps/ensure-libicu.js";
import { buildSysroot } from "./steps/build-sysroot.js";
import { buildNativeTableGen } from "./steps/build-native-tools.js";
import { buildWasmBinaries } from "./steps/build-wasm-tools.js";
import { optimizeWasmBinaries } from "./steps/optimize-binaries.js";
import { verifyArtifacts } from "./steps/verify-artifacts.js";

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      "llvm-dir": { type: "string" },
      "llvm-tag": { type: "string" },
      "llvm-version": { type: "string" },
      "host-llvm-dir": { type: "string" },
      "dist-dir": { type: "string" },
      "emsdk-dir": { type: "string" },
      "emsdk-version": { type: "string" },
      jobs: { type: "string", short: "j" },
      "heap-size": { type: "string" },
      "resource-dir": { type: "string" },
      "dry-run": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
    allowPositionals: true,
  });

  if (values.help) {
    console.log(`
Clang & LLD WebAssembly Build Toolchain

Usage:
  npm run build [-- [options]]
  node src/index.js [options]

Options:
  --llvm-dir <path>         Path to the LLVM repository root (defaults to ./out/llvm-project)
  --llvm-tag <tag>          LLVM git tag to fetch if missing (defaults to llvmorg-<llvm-version>)
  --llvm-version <ver>      LLVM version for host binaries and source tag (defaults to LLVM_VERSION env)
  --host-llvm-dir <path>    Path to host LLVM binaries (defaults to ./out/llvm)
  --dist-dir <path>         Directory to output built artifacts (defaults to ./dist)
  --emsdk-dir <path>        Path to Emscripten SDK directory (defaults to ./out/emsdk)
  --emsdk-version <ver>     Emscripten version to install if EMSDK not set (defaults to ${DEFAULT_EMSDK_VERSION})
  -j, --jobs <n>            Number of parallel ninja build jobs (defaults to 4)
  --heap-size <bytes>       Browser sysroot heap size (defaults to 4194304)
  --resource-dir <path>     Clang resource directory to package
  --dry-run                 Simulate the build pipeline without running compilation commands
  -h, --help                Show this help message
`);
    return;
  }

  const rootDir = process.cwd();
  const isDryRun = Boolean(values["dry-run"]);
  const llvmVersion = values["llvm-version"] || process.env.LLVM_VERSION?.trim();
  if (!llvmVersion) {
    throw new Error("LLVM_VERSION environment variable is not defined");
  }
  process.env.LLVM_VERSION = llvmVersion;
  const llvmTag = values["llvm-tag"] || `llvmorg-${llvmVersion}`;

  // Ensure out directory exists (preserves symlinks/existing dirs)
  ensureOutDir(rootDir);

  console.log("=== LLVM WebAssembly Toolchain Builder ===");

  // 1. Ensure EMSDK for building the browser-hosted compiler and linker.
  const emsdkDir = ensureEmsdk(rootDir, {
    explicitEmsdkDir: values["emsdk-dir"],
    version: values["emsdk-version"],
    dryRun: isDryRun,
  });

  // 2. Ensure LLVM source: fetch single tag into out/llvm-project
  const llvmDir = ensureLlvmProject(rootDir, {
    explicitLlvmDir: values["llvm-dir"],
    tag: llvmTag,
    dryRun: isDryRun,
  });

  // 3. Ensure host LLVM binaries: download and unpack into out/llvm
  const hostLlvm = ensureHostLlvm(rootDir, {
    explicitHostLlvmDir: values["host-llvm-dir"],
    version: llvmVersion,
    dryRun: isDryRun,
  });

  // 4. Ensure libicu 70 in out/llvm/lib if system does not provide it
  ensureLibicu(hostLlvm.hostLlvmDir, {
    dryRun: isDryRun,
  });

  const ninjaJobs = values.jobs ? parseInt(values.jobs, 10) : undefined;
  const config = resolveBuildConfig({
    rootDir,
    llvmDir,
    distDir: values["dist-dir"],
    emsdkDir,
    hostLlvmDir: hostLlvm.hostLlvmDir,
    hostClangPath: hostLlvm.clangPath,
    hostClangXXPath: hostLlvm.clangXXPath,
    hostLldPath: hostLlvm.lldPath,
    ninjaJobs,
    sysrootHeapSize: values["heap-size"],
    clangResourceDir: values["resource-dir"],
    dryRun: isDryRun,
    llvmTag,
    emsdkVersion: values["emsdk-version"],
  });

  console.log(`LLVM source dir:  ${config.llvmDir}`);
  console.log(`Host LLVM dir:    ${config.hostLlvmDir}`);
  console.log(`Host clang++:     ${config.hostClangXXPath}`);
  console.log(`Host lld:         ${config.hostLldPath}`);
  console.log(`Output dist dir:  ${config.distDir}`);
  console.log(`EMSDK dir:        ${config.emsdkDir}`);
  console.log(`Ninja jobs:       ${config.ninjaJobs}`);
  if (config.dryRun) {
    console.log(`Mode:             DRY RUN`);
  }

  const startTime = Date.now();

  buildNativeTableGen(config);
  buildWasmBinaries(config);
  optimizeWasmBinaries(config);
  buildSysroot(config);
  verifyArtifacts(config);

  const totalTimeSeconds = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nToolchain build finished in ${totalTimeSeconds}s\n`);
}

const isDirectExecution = Boolean(
  process.argv[1] &&
    import.meta.filename &&
    path.resolve(process.argv[1]) === path.resolve(import.meta.filename)
);

if (isDirectExecution) {
  Promise.try(main).catch((err) => {
    console.error(
      `\n\x1b[31m[ERROR] Toolchain build failed:\x1b[0m`,
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  });
}
