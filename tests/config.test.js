import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveBuildConfig } from "../src/config.js";

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
    assert.equal(config.buildSysrootDir, path.join(tmpRoot, "out", "build-sysroot"));
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
