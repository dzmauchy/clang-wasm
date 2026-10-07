import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { optimizeWasmBinaries } from "../src/steps/optimize-binaries.js";

test("packaging selects custom Clang and Wasm-only LLD despite stock artifacts", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lld packaging-"));
  try {
    const wasmBinDir = path.join(tempDir, "bin");
    const distDir = path.join(tempDir, "dist");
    fs.mkdirSync(path.join(wasmBinDir, "wasm-only"), { recursive: true });
    fs.mkdirSync(path.join(wasmBinDir, "custom-clang"));
    fs.writeFileSync(path.join(wasmBinDir, "clang.wasm"), "stock clang");
    fs.writeFileSync(path.join(wasmBinDir, "clang.js"), "stock clang wrapper");
    fs.writeFileSync(path.join(wasmBinDir, "custom-clang/clang.wasm"), "custom clang");
    const clangWrapper = 'const wasmFile = "clang.wasm";';
    fs.writeFileSync(path.join(wasmBinDir, "custom-clang/clang.js"), clangWrapper);
    fs.writeFileSync(path.join(wasmBinDir, "lld.wasm"), "stock linker");
    fs.writeFileSync(path.join(wasmBinDir, "lld.js"), "stock wrapper");
    fs.writeFileSync(path.join(wasmBinDir, "wasm-only/lld.wasm"), "wasm linker");
    const wrapper = 'const wasmFile = "lld.wasm";';
    fs.writeFileSync(path.join(wasmBinDir, "wasm-only/lld.js"), wrapper);

    // Stand in for Binaryen to exercise packaging with real file operations.
    const wasmOptPath = path.join(tempDir, "wasm-opt");
    fs.writeFileSync(wasmOptPath, `#!/usr/bin/env node
const fs = require("node:fs");
const [input, , output] = process.argv.slice(2);
fs.copyFileSync(input, output);
`, { mode: 0o755 });
    optimizeWasmBinaries({
      rootDir: tempDir,
      wasmBinDir,
      distDir,
      wasmOptPath,
      wasmOptFlags: [],
      dryRun: false,
    });

    assert.equal(fs.readFileSync(path.join(distDir, "lld.wasm"), "utf8"), "wasm linker");
    assert.equal(fs.readFileSync(path.join(distDir, "lld.js"), "utf8"), wrapper);
    assert.equal(fs.readFileSync(path.join(distDir, "clang.wasm"), "utf8"), "custom clang");
    assert.equal(fs.readFileSync(path.join(distDir, "clang.js"), "utf8"), clangWrapper);

    fs.rmSync(path.join(wasmBinDir, "wasm-only/lld.wasm"));
    assert.throws(() => optimizeWasmBinaries({
      rootDir: tempDir,
      wasmBinDir,
      distDir,
      wasmOptPath,
      wasmOptFlags: [],
      dryRun: false,
    }), /Expected output binary not found/);

    fs.rmSync(path.join(wasmBinDir, "custom-clang/clang.wasm"));
    assert.throws(() => optimizeWasmBinaries({
      rootDir: tempDir,
      wasmBinDir,
      distDir,
      wasmOptPath,
      wasmOptFlags: [],
      dryRun: false,
    }), /Expected output binary not found: .*custom-clang/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
