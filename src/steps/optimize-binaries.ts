import fs from "node:fs";
import path from "node:path";
import type { BuildConfig } from "../types.ts";
import { run } from "../utils/exec.ts";

export function optimizeWasmBinaries(config: BuildConfig): void {
  console.log("\n--- [5/5] Optimizing Wasm Binaries & Copying JavaScript Wrappers ---");

  fs.mkdirSync(config.distDir, { recursive: true });

  for (const tool of ["clang", "lld"] as const) {
    const srcWasm = path.join(config.wasmBinDir, `${tool}.wasm`);
    const srcJs = path.join(config.wasmBinDir, `${tool}.js`);
    const outWasm = path.join(config.distDir, `${tool}.wasm`);
    const outJs = path.join(config.distDir, `${tool}.js`);

    if (config.dryRun) {
      console.log(`[DRY RUN] Optimizing ${tool}.wasm and copying ${tool}.js`);
      fs.writeFileSync(outWasm, Buffer.from("mock-wasm-binary\n"));
      fs.writeFileSync(outJs, `// mock ${tool}.js\n`);
      continue;
    }

    if (!fs.existsSync(srcWasm) || !fs.existsSync(srcJs)) {
      throw new Error(`Expected output binary not found: ${srcWasm} or ${srcJs}`);
    }

    const wasmOptFlagsStr = config.wasmOptFlags.join(" ");

    run(
      `
      "${config.wasmOptPath}"
        ${wasmOptFlagsStr}
        "${srcWasm}"
        -o "${outWasm}"
      `,
      config.rootDir,
      {},
      config.dryRun
    );

    fs.copyFileSync(srcJs, outJs);
  }
}
