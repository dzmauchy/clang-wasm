import type { BuildConfig } from "../types.ts";
import { run } from "../utils/exec.ts";

export function buildEmscriptenSysroot(config: BuildConfig): void {
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
