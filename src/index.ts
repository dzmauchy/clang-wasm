import path from "node:path";
import { parseArgs } from "node:util";
import { resolveBuildConfig } from "./config.ts";
import { ensureEmsdk } from "./steps/ensure-emsdk.ts";
import { ensureLlvmProject } from "./steps/ensure-llvm.ts";
import { pruneEmscriptenHeaders } from "./steps/prune-headers.ts";
import { buildEmscriptenSysroot } from "./steps/build-sysroot-libs.ts";
import { buildNativeTableGen } from "./steps/build-native-tools.ts";
import { buildWasmBinaries } from "./steps/build-wasm-tools.ts";
import { optimizeWasmBinaries } from "./steps/optimize-binaries.ts";
import { assembleSysroot } from "./steps/assemble-sysroot.ts";
import { verifyArtifacts } from "./steps/verify-artifacts.ts";

export async function main(args: string[] = process.argv.slice(2)): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      "llvm-dir": { type: "string" },
      "llvm-tag": { type: "string" },
      "dist-dir": { type: "string" },
      "emsdk-dir": { type: "string" },
      "emsdk-version": { type: "string" },
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
  node src/index.ts [options]

Options:
  --llvm-dir <path>         Path to the LLVM repository root (defaults to ./llvm-project or cwd)
  --llvm-tag <tag>          LLVM git tag to fetch if missing (defaults to llvmorg-23.1.2)
  --dist-dir <path>         Directory to output built artifacts (defaults to ./dist)
  --emsdk-dir <path>        Path to Emscripten SDK directory (defaults to process.env.EMSDK)
  --emsdk-version <ver>     Emscripten version to install if EMSDK not set (defaults to 6.0.9)
  -j, --jobs <n>            Number of parallel ninja build jobs (defaults to 4)
  --dry-run                 Simulate the build pipeline without running compilation commands
  -h, --help                Show this help message
`);
    return;
  }

  const rootDir = process.cwd();
  const isDryRun = Boolean(values["dry-run"]);

  console.log("=== LLVM WebAssembly Toolchain Builder ===");

  // 1. Ensure EMSDK: if not set, download emsdk 6.0.9 and use it
  const emsdkDir = ensureEmsdk(rootDir, {
    explicitEmsdkDir: values["emsdk-dir"],
    version: values["emsdk-version"],
    dryRun: isDryRun,
  });

  // 2. Ensure LLVM source: if llvm-project doesn't exist, fetch ONLY one tag llvmorg-23.1.2
  const llvmDir = ensureLlvmProject(rootDir, {
    explicitLlvmDir: values["llvm-dir"],
    tag: values["llvm-tag"] || "llvmorg-23.1.2",
    dryRun: isDryRun,
  });

  const ninjaJobs = values.jobs ? parseInt(values.jobs, 10) : undefined;
  const config = resolveBuildConfig({
    rootDir,
    llvmDir,
    distDir: values["dist-dir"],
    emsdkDir,
    ninjaJobs,
    dryRun: isDryRun,
    llvmTag: values["llvm-tag"],
    emsdkVersion: values["emsdk-version"],
  });

  console.log(`LLVM source dir:  ${config.llvmDir}`);
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
  main().catch((err: unknown) => {
    console.error(
      `\n\x1b[31m[ERROR] Toolchain build failed:\x1b[0m`,
      err instanceof Error ? err.message : err
    );
    process.exit(1);
  });
}
