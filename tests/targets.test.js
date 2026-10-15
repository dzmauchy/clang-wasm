import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { TARGETS, DEFAULT_TARGET_ID, resolveTarget, releaseTag } from "../src/targets/index.js";
import { resolveBuildConfig } from "../src/config.js";
import { buildSysroot } from "../src/steps/build-sysroot.js";
import { buildWasmBinaries } from "../src/steps/build-wasm-tools.js";
import { main } from "../src/index.js";

const projectRoot = path.resolve(import.meta.dirname, "..");

test("registry exposes wasm32 (default) and arm8 with consistent ids", () => {
  assert.equal(DEFAULT_TARGET_ID, "wasm32");
  assert.deepEqual(Object.keys(TARGETS).sort(), ["arm8", "wasm32"]);
  for (const [id, target] of Object.entries(TARGETS)) {
    assert.equal(target.id, id);
    for (const key of ["triple", "llvmTarget", "lldFlavor", "clangArgs", "lldArgs", "sysroot", "cmakeSystemProcessor"]) {
      assert.ok(target[key] !== undefined, `${id} missing ${key}`);
    }
  }
  assert.throws(() => resolveTarget("nope"), /Unknown target "nope"/);
});

test("arm8 targets thumbv8m.main-none-eabihf with ELF LLD", () => {
  const arm = TARGETS.arm8;
  assert.equal(arm.triple, "thumbv8m.main-none-eabihf");
  assert.equal(arm.llvmTarget, "ARM");
  assert.equal(arm.lldFlavor, "elf");
  assert.equal(arm.sysroot.runtime, null);
});

test("non-default targets use separate build and dist directories", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "target-dirs-"));
  try {
    const wasm = resolveBuildConfig({ rootDir: root, llvmTag: "t", dryRun: true });
    const arm = resolveBuildConfig({ rootDir: root, llvmTag: "t", dryRun: true, target: "arm8" });
    assert.equal(wasm.buildWasmDir, path.join(root, "out", "llvm-project", "build-wasm"));
    assert.equal(arm.buildWasmDir, path.join(root, "out", "llvm-project", "build-wasm-arm8"));
    assert.equal(arm.buildNativeDir, path.join(root, "out", "llvm-project", "build-native-arm8"));
    assert.equal(wasm.distDir, path.join(root, "dist"));
    assert.equal(arm.distDir, path.join(root, "dist", "arm8"));
    assert.equal(arm.target.id, "arm8");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

function captureLog(fn) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(" "));
  try {
    fn();
  } finally {
    console.log = original;
  }
  return lines.join("\n");
}

test("wasm tool build passes target settings to CMake", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "target-wasm-"));
  try {
    const arm = resolveBuildConfig({ rootDir: root, llvmTag: "t", dryRun: true, target: "arm8" });
    const log = captureLog(() => buildWasmBinaries(arm));
    assert.match(log, /-DLLVM_TARGETS_TO_BUILD="ARM"/);
    assert.match(log, /-DLLVM_DEFAULT_TARGET_TRIPLE="thumbv8m\.main-none-eabihf"/);
    assert.match(log, /-DBROWSER_TARGET_TRIPLE="thumbv8m\.main-none-eabihf"/);
    assert.match(log, /-DBROWSER_LLD_FLAVOR="elf"/);
    assert.match(log, /build-wasm-arm8/);

    const wasm = resolveBuildConfig({ rootDir: root, llvmTag: "t", dryRun: true });
    const wasmLog = captureLog(() => buildWasmBinaries(wasm));
    assert.match(wasmLog, /-DLLVM_TARGETS_TO_BUILD="WebAssembly"/);
    assert.match(wasmLog, /-DBROWSER_LLD_FLAVOR="wasm"/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("arm8 sysroot dry-run installs only headers and builtins", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "target-sysroot-"));
  try {
    const config = resolveBuildConfig({ rootDir: root, llvmTag: "t", dryRun: true, target: "arm8" });
    const log = captureLog(() => buildSysroot(config));
    assert.match(log, /install-arm-resource-headers/);
    assert.match(log, /-DLLVM_TARGETS_TO_BUILD=ARM/);
    assert.match(log, /install-clang_rt\.builtins-armv8m\.main/);
    assert.doesNotMatch(log, /tlsf|wasm\.cpp|browser\.cpp/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("main --target arm8 dry-run produces all artifacts under the target dist dir", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "target-main-"));
  const previousCwd = process.cwd();
  process.chdir(root);
  try {
    await main(["--dry-run", "--target", "arm8", "--llvm-version", "20.0.0"]);
    for (const artifact of ["clang.js", "clang.wasm", "lld.js", "lld.wasm", "sysroot.tgz"]) {
      assert.ok(fs.existsSync(path.join(root, "dist", "arm8", artifact)), artifact);
    }
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("launcher sources contain no hard-coded target", () => {
  const clang = fs.readFileSync(path.join(projectRoot, "cmake/wasm-clang/main.cpp"), "utf8");
  const lld = fs.readFileSync(path.join(projectRoot, "cmake/wasm-lld/main.cpp"), "utf8");
  assert.doesNotMatch(clang, /wasm32-unknown-unknown/);
  assert.doesNotMatch(lld, /wasm-ld|clang_rt\.builtins/);
});
