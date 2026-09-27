import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  resolveBuildConfig,
  CLANG_HEADER_PRUNE_PATTERN,
  LIB_PRUNE_PATTERN,
  EMSCRIPTEN_PRUNE_DIRS,
} from "../src/config.js";

test("resolveBuildConfig resolves directories to out/xxx when options and env are missing", () => {
  const origEmsdk = process.env.EMSDK;
  delete process.env.EMSDK;
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-test-"));
  try {
    const config = resolveBuildConfig({
      rootDir: tmpRoot,
      llvmTag: "test-tag",
      dryRun: true,
    });
    assert.equal(config.emsdkDir, path.join(tmpRoot, "out", "emsdk"));
    assert.equal(config.llvmDir, path.join(tmpRoot, "out", "llvm-project"));
    assert.equal(config.hostLlvmDir, path.join(tmpRoot, "out", "llvm"));
  } finally {
    if (origEmsdk !== undefined) {
      process.env.EMSDK = origEmsdk;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("resolveBuildConfig succeeds in dry-run mode even without EMSDK", () => {
  const origEmsdk = process.env.EMSDK;
  delete process.env.EMSDK;
  try {
    const config = resolveBuildConfig({ llvmTag: "test-tag", dryRun: true });
    assert.equal(config.dryRun, true);
    assert.equal(config.ninjaJobs, 4);
    assert.ok(config.distDir.endsWith("dist"));
  } finally {
    if (origEmsdk !== undefined) {
      process.env.EMSDK = origEmsdk;
    }
  }
});

test("resolveBuildConfig respects custom options", () => {
  const config = resolveBuildConfig({
    llvmDir: "/custom/llvm",
    distDir: "/custom/dist",
    emsdkDir: "/custom/emsdk",
    llvmTag: "custom-tag",
    ninjaJobs: 8,
    dryRun: true,
  });

  assert.equal(config.llvmDir, "/custom/llvm");
  assert.equal(config.distDir, "/custom/dist");
  assert.equal(config.emsdkDir, "/custom/emsdk");
  assert.equal(config.ninjaJobs, 8);
  assert.equal(config.stageDir, "/custom/dist/sysroot");
});

test("resolveBuildConfig throws when LLVM_VERSION and llvmTag are not defined", () => {
  const origVersion = process.env.LLVM_VERSION;
  const origTag = process.env.LLVM_TAG;
  delete process.env.LLVM_VERSION;
  delete process.env.LLVM_TAG;
  try {
    assert.throws(
      () => resolveBuildConfig({ dryRun: true }),
      /LLVM_VERSION environment variable is not defined/
    );
  } finally {
    if (origVersion !== undefined) {
      process.env.LLVM_VERSION = origVersion;
    }
    if (origTag !== undefined) {
      process.env.LLVM_TAG = origTag;
    }
  }
});

test("resolveBuildConfig uses LLVM_VERSION for llvmTag when options.llvmTag and LLVM_TAG are not set", () => {
  const origVersion = process.env.LLVM_VERSION;
  const origTag = process.env.LLVM_TAG;
  delete process.env.LLVM_TAG;
  process.env.LLVM_VERSION = "24.0.0";
  try {
    const config = resolveBuildConfig({ dryRun: true });
    assert.equal(config.llvmTag, "llvmorg-24.0.0");
  } finally {
    if (origVersion !== undefined) {
      process.env.LLVM_VERSION = origVersion;
    } else {
      delete process.env.LLVM_VERSION;
    }
    if (origTag !== undefined) {
      process.env.LLVM_TAG = origTag;
    }
  }
});

test("pruning patterns match expected filenames", () => {
  // Clang header pruning patterns
  assert.equal(CLANG_HEADER_PRUNE_PATTERN.test("arm_neon.h"), true);
  assert.equal(CLANG_HEADER_PRUNE_PATTERN.test("riscv_vector.h"), true);
  assert.equal(CLANG_HEADER_PRUNE_PATTERN.test("cpuid.h"), true);
  assert.equal(CLANG_HEADER_PRUNE_PATTERN.test("cuda.h"), true);
  assert.equal(CLANG_HEADER_PRUNE_PATTERN.test("stddef.h"), false);
  assert.equal(CLANG_HEADER_PRUNE_PATTERN.test("stdint.h"), false);

  // Lib pruning patterns
  assert.equal(LIB_PRUNE_PATTERN.test("libGL.a"), true);
  assert.equal(LIB_PRUNE_PATTERN.test("libal.a"), true);
  assert.equal(LIB_PRUNE_PATTERN.test("libhtml5.a"), true);
  assert.equal(LIB_PRUNE_PATTERN.test("libc-mt.a"), true);
  assert.equal(LIB_PRUNE_PATTERN.test("libc.a"), false);
  assert.equal(LIB_PRUNE_PATTERN.test("libc++.a"), false);

  // Emscripten prune dirs
  assert.ok(EMSCRIPTEN_PRUNE_DIRS.includes("GL"));
  assert.ok(EMSCRIPTEN_PRUNE_DIRS.includes("SDL"));
  assert.ok(EMSCRIPTEN_PRUNE_DIRS.includes("webgl"));
});
