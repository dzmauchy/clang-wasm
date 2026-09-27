import fs from "node:fs";
import path from "node:path";

export function pruneEmscriptenHeaders(config) {
  console.log("\n--- [1/5] Pruning Emscripten Headers ---");

  const sysInc = path.join(
    config.emsdkDir,
    "upstream/emscripten/system/include"
  );

  for (const dir of config.emscriptenPruneDirs) {
    const target = path.join(sysInc, dir);
    if (fs.existsSync(target)) {
      if (config.dryRun) {
        console.log(`[DRY RUN] Would remove directory: ${target}`);
      } else {
        fs.rmSync(target, { recursive: true, force: true });
      }
    }
  }
}
