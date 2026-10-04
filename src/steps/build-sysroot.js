import fs from "node:fs";
import path from "node:path";
import { run, shellQuote } from "../utils/exec.js";

export function buildSysroot(config) {
  console.log("\n--- Building and Archiving LLVM libc + libc++ + libc++abi Sysroot with CMake ---");
  const options = [
    ["SYSROOT_OUTPUT_DIR", config.distDir],
    ["SYSROOT_JOBS", config.ninjaJobs],
    ["LLVM_SOURCE_DIR", config.llvmDir],
    ["SYSROOT_CLANG", config.hostClangPath],
    ["SYSROOT_CLANGXX", config.hostClangXXPath],
    ["SYSROOT_AR", path.join(config.hostBinDir, "llvm-ar")],
    ["SYSROOT_RANLIB", path.join(config.hostBinDir, "llvm-ranlib")],
    ["SYSROOT_STRIP", config.llvmStripPath],
  ].map(([name, value]) => shellQuote(`-D${name}=${value}`));

  run(
    `cmake -G Ninja -S ${shellQuote(config.rootDir)} -B ${shellQuote(config.buildSysrootDir)} ${options.join(" ")}`,
    config.rootDir, {}, config.dryRun
  );
  run(
    `cmake --build ${shellQuote(config.buildSysrootDir)} --target sysroot --parallel ${config.ninjaJobs}`,
    config.rootDir, {}, config.dryRun
  );

  // Preserve the pipeline's simulated artifacts without preparing a sysroot.
  if (config.dryRun) {
    fs.mkdirSync(config.distDir, { recursive: true });
    fs.writeFileSync(path.join(config.distDir, "sysroot.tgz"), "mock-sysroot-tar-gz\n");
  }
}
