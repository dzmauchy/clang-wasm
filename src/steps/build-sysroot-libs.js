import { run } from "../utils/exec.js";

export function buildEmscriptenSysroot(config) {
  console.log("\n--- [2/5] Building Emscripten System Libraries ---");

  run(
    `
    embuilder build
      sysroot
      libc
      libc++
      libc++abi
      libdlmalloc
    `,
    config.rootDir,
    {},
    config.dryRun
  );
}
