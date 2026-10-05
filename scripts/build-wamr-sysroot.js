#!/usr/bin/env node
import path from "node:path";
import { parseArgs } from "node:util";
import { resolveBuildConfig } from "../src/config.js";
import { ensureLlvmProject } from "../src/steps/ensure-llvm.js";
import { ensureHostLlvm } from "../src/steps/ensure-host-llvm.js";
import { buildSysroot } from "../src/steps/build-sysroot.js";
import { testWamrSysroot } from "../src/steps/test-wamr-sysroot.js";

try {
  const { values } = parseArgs({ options: {
    "llvm-version": { type: "string" },
    "llvm-tag": { type: "string" },
    "llvm-dir": { type: "string" },
    "host-llvm-dir": { type: "string" },
    "dist-dir": { type: "string" },
    "wamr-dir": { type: "string" },
    jobs: { type: "string", short: "j" },
    "dry-run": { type: "boolean" },
    test: { type: "boolean" },
    "test-only": { type: "boolean" },
    help: { type: "boolean", short: "h" },
  } });
  if (values.help) {
    console.log(`Usage: npm run build-wamr-sysroot -- [options]

  --llvm-version <ver>     LLVM release (defaults to LLVM_VERSION or 23.1.2)
  --llvm-tag <tag>         LLVM source tag (defaults to llvmorg-<version>)
  --llvm-dir <path>        LLVM source directory (defaults to out/llvm-project)
  --host-llvm-dir <path>   Host LLVM installation (defaults to out/llvm)
  --dist-dir <path>        Output directory (defaults to dist)
  -j, --jobs <n>          Parallel build jobs (defaults to NINJA_JOBS or 4)
  --test                  Compile C++23/PMR smoke tests and run under WAMR
  --test-only             Test an existing wamrsr.tgz without rebuilding
  --wamr-dir <path>        WAMR sources for tests (defaults to WAMR_DIR or out/wamr)
  --dry-run               Simulate building without compiling
  -h, --help              Show this help

Produces <dist-dir>/wamrsr.tgz and <dist-dir>/wamrsr/.
Heap capacity is chosen by the WAMR host at instantiation, not at sysroot build time.`);
  } else {
    const rootDir = path.resolve(import.meta.dirname, "..");
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
      hostClangPath: host.clangPath, hostClangXXPath: host.clangXXPath,
      distDir: values["dist-dir"],
      ninjaJobs: values.jobs ? Number(values.jobs) : undefined,
      // Only needed to compile dormant upstream support objects, not a WAMR limit.
      sysrootHeapSize: 65536,
    });
    config.sysrootRuntime = "wamr";
    config.sysrootArchive = "wamrsr.tgz";
    config.stageDir = path.join(config.distDir, "wamrsr");
    config.buildSysrootDir = path.join(rootDir, "out", "build-wamr-sysroot");
    config.wamrDir = path.resolve(values["wamr-dir"] || process.env.WAMR_DIR || path.join(rootDir, "out", "wamr"));
    if (!values["test-only"]) buildSysroot(config);
    if (values.test || values["test-only"]) testWamrSysroot(config);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
