import fs from "node:fs";
import path from "node:path";
import { run } from "../utils/exec.js";

function findResourceDir(basePaths) {
  for (const base of basePaths) {
    if (fs.existsSync(base)) {
      const items = fs.readdirSync(base, { withFileTypes: true });
      const dir = items.find((entry) => entry.isDirectory());
      if (dir) return path.join(base, dir.name);
    }
  }
  return null;
}

export function assembleSysroot(config) {
  console.log("\n--- Assembling and Archiving Sysroot ---");

  const sysrootArchive = path.join(config.distDir, "sysroot.tgz");

  if (config.dryRun) {
    console.log(`[DRY RUN] Assembling sysroot to ${sysrootArchive}`);
    fs.writeFileSync(sysrootArchive, Buffer.from("mock-sysroot-tar-gz\n"));
    return;
  }

  if (!fs.existsSync(config.emscriptenSysroot)) {
    throw new Error(
      `Emscripten sysroot not found: ${config.emscriptenSysroot}`
    );
  }

  const clangResSrc = findResourceDir([
    path.join(config.llvmDir, "build-native/lib/clang"),
    path.join(config.llvmDir, "build-wasm/lib/clang"),
  ]);
  if (!clangResSrc) {
    throw new Error("Clang resource header directory not found!");
  }

  const stageLibTarget = path.join(config.stageDir, "lib/target");
  const stageLibClang = path.join(config.stageDir, "lib/clang");

  fs.rmSync(config.stageDir, { recursive: true, force: true });
  fs.mkdirSync(stageLibTarget, { recursive: true });
  fs.mkdirSync(stageLibClang, { recursive: true });

  fs.cpSync(
    path.join(config.emscriptenSysroot, "include"),
    path.join(config.stageDir, "include"),
    { recursive: true }
  );

  const sysLibDir = path.join(
    config.emscriptenSysroot,
    "lib/wasm32-emscripten"
  );
  if (fs.existsSync(sysLibDir)) {
    for (const file of fs.readdirSync(sysLibDir)) {
      if (
        (file.endsWith(".a") || file.endsWith(".o")) &&
        !config.libPrunePattern.test(file) &&
        !file.endsWith("-wasmexcept.a")
      ) {
        fs.copyFileSync(
          path.join(sysLibDir, file),
          path.join(stageLibTarget, file)
        );
      }
    }
  }

  const filesToStrip = fs
    .readdirSync(stageLibTarget)
    .values()
    .filter((file) => file.endsWith(".a") || file.endsWith(".o"))
    .map((file) => path.join(stageLibTarget, file))
    .toArray();

  if (filesToStrip.length > 0) {
    const fileArgs = filesToStrip.map((file) => `"${file}"`).join(" ");
    run(
      `"${config.llvmStripPath}" --strip-debug ${fileArgs}`,
      config.rootDir,
      {},
      config.dryRun
    );
  }

  const clangVer = path.basename(clangResSrc);
  fs.cpSync(clangResSrc, path.join(stageLibClang, clangVer), {
    recursive: true,
  });

  const clangHeadersPath = path.join(stageLibClang, clangVer, "include");
  if (fs.existsSync(clangHeadersPath)) {
    for (const file of fs.readdirSync(clangHeadersPath)) {
      if (config.clangHeaderPrunePattern.test(file)) {
        fs.rmSync(path.join(clangHeadersPath, file), {
          recursive: true,
          force: true,
        });
      }
    }
  }

  for (const file of fs.readdirSync(stageLibTarget)) {
    if (config.libPrunePattern.test(file) || file.endsWith("-wasmexcept.a")) {
      fs.unlinkSync(path.join(stageLibTarget, file));
    }
  }

  run(
    `
    tar
      --sort=name
      -I 'gzip -9'
      -cf "${sysrootArchive}"
      -C "${config.distDir}"
      sysroot
    `,
    config.rootDir,
    {},
    config.dryRun
  );

  fs.rmSync(config.stageDir, { recursive: true, force: true });
}
