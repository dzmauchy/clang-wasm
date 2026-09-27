import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveBuildConfig,
  CLANG_HEADER_PRUNE_PATTERN,
  LIB_PRUNE_PATTERN,
  EMSCRIPTEN_PRUNE_DIRS,
} from "../src/config.js";

test("resolveBuildConfig resolves emsdkDir to fallback when EMSDK is missing and sharedDir is not writable", () => {
  const origEmsdk = process.env.EMSDK;
  delete process.env.EMSDK;
  try {
    const config = resolveBuildConfig({
      rootDir: "/test-root",
      sharedDir: "/non_existent_dir_12345",
      dryRun: true,
    });
    assert.equal(config.emsdkDir, "/test-root/emsdk");
  } finally {
    if (origEmsdk !== undefined) {
      process.env.EMSDK = origEmsdk;
    }
  }
});

test("resolveBuildConfig succeeds in dry-run mode even without EMSDK", () => {
  const origEmsdk = process.env.EMSDK;
  delete process.env.EMSDK;
  try {
    const config = resolveBuildConfig({ dryRun: true });
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
    ninjaJobs: 8,
    dryRun: true,
  });

  assert.equal(config.llvmDir, "/custom/llvm");
  assert.equal(config.distDir, "/custom/dist");
  assert.equal(config.emsdkDir, "/custom/emsdk");
  assert.equal(config.ninjaJobs, 8);
  assert.equal(config.stageDir, "/custom/dist/sysroot");
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
