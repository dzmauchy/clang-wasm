import path from "node:path";
import { parseArgs } from "node:util";
import { resolveBuildConfig } from "./config.js";
import { ensureEmsdk } from "./steps/ensure-emsdk.js";
import { ensureLlvmProject } from "./steps/ensure-llvm.js";
import { ensureHostLlvm } from "./steps/ensure-host-llvm.js";
import { pruneEmscriptenHeaders } from "./steps/prune-headers.js";
import { buildEmscriptenSysroot } from "./steps/build-sysroot-libs.js";
import { buildNativeTableGen } from "./steps/build-native-tools.js";
import { buildWasmBinaries } from "./steps/build-wasm-tools.js";
import { optimizeWasmBinaries } from "./steps/optimize-binaries.js";
import { assembleSysroot } from "./steps/assemble-sysroot.js";
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
      "shared-dir": { type: "string" },
      jobs: { type: "string", short: "j" },
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
  --llvm-dir <path>         Path to the LLVM repository root (defaults to /opt/shared/llvm-project or ./llvm-project)
  --llvm-tag <tag>          LLVM git tag to fetch if missing (defaults to llvmorg-23.1.2)
  --llvm-version <ver>      LLVM version for host binaries and source tag (defaults to 23.1.2)
  --host-llvm-dir <path>    Path to host LLVM binaries (defaults to /opt/shared/llvm or ./llvm)
  --dist-dir <path>         Directory to output built artifacts (defaults to ./dist)
  --emsdk-dir <path>        Path to Emscripten SDK directory (defaults to /opt/shared/emsdk or ./emsdk)
  --emsdk-version <ver>     Emscripten version to install if EMSDK not set (defaults to 6.0.9)
  --shared-dir <path>       Shared tools directory to prefer if writable (defaults to /opt/shared)
  -j, --jobs <n>            Number of parallel ninja build jobs (defaults to 4)
  --dry-run                 Simulate the build pipeline without running compilation commands
  -h, --help                Show this help message
`);
    return;
  }

  const rootDir = process.cwd();
  const isDryRun = Boolean(values["dry-run"]);
  const sharedDir = values["shared-dir"];
  const llvmVersion = values["llvm-version"] || "23.1.2";
  const llvmTag = values["llvm-tag"] || `llvmorg-${llvmVersion}`;

  console.log("=== LLVM WebAssembly Toolchain Builder ===");

  // 1. Ensure EMSDK: if not set, download emsdk 6.0.9 and use it (prefer /opt/shared/emsdk)
  const emsdkDir = ensureEmsdk(rootDir, {
    explicitEmsdkDir: values["emsdk-dir"],
    version: values["emsdk-version"],
    sharedDir,
    dryRun: isDryRun,
  });

  // 2. Ensure LLVM source: if llvm-project doesn't exist, fetch ONLY one tag (prefer /opt/shared/llvm-project)
  const llvmDir = ensureLlvmProject(rootDir, {
    explicitLlvmDir: values["llvm-dir"],
    tag: llvmTag,
    sharedDir,
    dryRun: isDryRun,
  });

  // 3. Ensure host LLVM 23 binaries (clang 23 and lld 23): download and unpack if missing (prefer /opt/shared/llvm)
  const hostLlvm = ensureHostLlvm(rootDir, {
    explicitHostLlvmDir: values["host-llvm-dir"],
    version: llvmVersion,
    sharedDir,
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
    dryRun: isDryRun,
    llvmTag,
    emsdkVersion: values["emsdk-version"],
    sharedDir,
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

  pruneEmscriptenHeaders(config);
  buildEmscriptenSysroot(config);
  buildNativeTableGen(config);
  buildWasmBinaries(config);
  optimizeWasmBinaries(config);
  assembleSysroot(config);
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
