import fs from "node:fs";
import path from "node:path";
import { run, shellQuote } from "../utils/exec.js";

export function testWamrSysroot(config) {
  if (!config.dryRun && !fs.existsSync(path.join(config.wamrDir, "build-scripts", "runtime_lib.cmake"))) {
    throw new Error("WAMR sources are required for --test: pass --wamr-dir <wasm-micro-runtime checkout>");
  }
  run([process.execPath, path.join(config.rootDir, "tests", "wamr-sysroot-smoke.mjs"),
    config.hostClangXXPath, config.distDir, config.buildSysrootDir, config.wamrDir,
    String(config.ninjaJobs)].map(shellQuote).join(" "), config.rootDir, {}, config.dryRun);
}
