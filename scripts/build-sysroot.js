#!/usr/bin/env node
import { parseArgs } from "node:util";
import { resolveBuildConfig } from "../src/config.js";
import { ensureLlvmProject } from "../src/steps/ensure-llvm.js";
import { ensureHostLlvm } from "../src/steps/ensure-host-llvm.js";
import { buildSysroot, testSysroot } from "../src/steps/build-sysroot.js";

try {
  const { values } = parseArgs({
    options: {
      "llvm-version": { type: "string" },
      "llvm-tag": { type: "string" },
      "llvm-dir": { type: "string" },
      "host-llvm-dir": { type: "string" },
      "dist-dir": { type: "string" },
      "heap-size": { type: "string" },
      "resource-dir": { type: "string" },
      jobs: { type: "string", short: "j" },
      "dry-run": { type: "boolean" },
      test: { type: "boolean" },
      "test-only": { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  if (values.help) {
    console.log(`Usage: npm run build-sysroot -- [options]

  --llvm-version <ver>     LLVM release (defaults to LLVM_VERSION or 23.1.2)
  --llvm-tag <tag>         LLVM source tag (defaults to llvmorg-<version>)
  --llvm-dir <path>        LLVM source directory (defaults to out/llvm-project)
  --host-llvm-dir <path>   Host LLVM installation (defaults to out/llvm)
  --dist-dir <path>        Output directory (defaults to dist)
  -j, --jobs <n>          Parallel build jobs (defaults to NINJA_JOBS or 4)
  --heap-size <bytes>      Browser heap (defaults to SYSROOT_HEAP_SIZE or 4194304)
  --resource-dir <path>    Resource headers (defaults to CLANG_RESOURCE_DIR or host Clang's)
  --test                  Run the sysroot smoke test after building
  --test-only             Test the existing sysroot without rebuilding
  --dry-run               Simulate building without compiling
  -h, --help              Show this help`);
  } else {
    const rootDir = process.cwd();
    const dryRun = Boolean(values["dry-run"]);
    const version = values["llvm-version"] || process.env.LLVM_VERSION?.trim() || "23.1.2";
    const llvmTag = values["llvm-tag"] || process.env.LLVM_TAG || `llvmorg-${version}`;
    const llvmDir = values["test-only"] ? values["llvm-dir"] : ensureLlvmProject(rootDir, {
      explicitLlvmDir: values["llvm-dir"], tag: llvmTag, dryRun,
    });
    const host = values["test-only"] ? {} : ensureHostLlvm(rootDir, {
      explicitHostLlvmDir: values["host-llvm-dir"], version, dryRun,
    });
    const config = resolveBuildConfig({
      rootDir, llvmDir, llvmTag, dryRun,
      hostLlvmDir: host.hostLlvmDir || values["host-llvm-dir"],
      hostClangPath: host.clangPath,
      hostClangXXPath: host.clangXXPath,
      distDir: values["dist-dir"],
      ninjaJobs: values.jobs ? Number(values.jobs) : undefined,
      sysrootHeapSize: values["heap-size"],
      clangResourceDir: values["resource-dir"],
    });
    if (!values["test-only"]) buildSysroot(config);
    if (values.test || values["test-only"]) testSysroot(config);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
