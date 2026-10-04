import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { optimizeWasmBinaries } from "../src/steps/optimize-binaries.js";

test("packaging selects the Wasm-only linker even when stock LLD artifacts remain", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "lld packaging-"));
  try {
    const wasmBinDir = path.join(tempDir, "bin");
    const distDir = path.join(tempDir, "dist");
    fs.mkdirSync(path.join(wasmBinDir, "wasm-only"), { recursive: true });
    fs.writeFileSync(path.join(wasmBinDir, "clang.wasm"), "clang");
    fs.writeFileSync(path.join(wasmBinDir, "clang.js"), "clang wrapper");
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
    assert.equal(fs.readFileSync(path.join(distDir, "clang.wasm"), "utf8"), "clang");
    assert.equal(fs.readFileSync(path.join(distDir, "clang.js"), "utf8"), "clang wrapper");

    fs.rmSync(path.join(wasmBinDir, "wasm-only/lld.wasm"));
    assert.throws(() => optimizeWasmBinaries({
      rootDir: tempDir,
      wasmBinDir,
      distDir,
      wasmOptPath,
      wasmOptFlags: [],
      dryRun: false,
    }), /Expected output binary not found/);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
