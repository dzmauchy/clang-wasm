import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  isDirectoryWritable,
  resolvePreferredLlvmDir,
  resolvePreferredEmsdkDir,
  resolvePreferredHostLlvmDir,
  DEFAULT_SHARED_DIR,
} from "../src/utils/fs.ts";
import { ensureLlvmProject } from "../src/steps/ensure-llvm.ts";
import { ensureEmsdk } from "../src/steps/ensure-emsdk.ts";
import { ensureHostLlvm } from "../src/steps/ensure-host-llvm.ts";
import { resolveBuildConfig } from "../src/config.ts";

test("isDirectoryWritable accurately detects directory existence and writability", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "shared-test-writable-"));
  try {
    assert.equal(isDirectoryWritable(tmpDir), true);
    assert.equal(isDirectoryWritable(path.join(tmpDir, "non_existent")), false);

    // File, not a directory
    const testFile = path.join(tmpDir, "file.txt");
    fs.writeFileSync(testFile, "hello");
    assert.equal(isDirectoryWritable(testFile), false);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("prefers /opt/shared paths when shared directory exists and is writable", () => {
  const tmpShared = fs.mkdtempSync(path.join(os.tmpdir(), "shared-opt-"));
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-root-"));
  try {
    const llvmDir = resolvePreferredLlvmDir(tmpRoot, tmpShared);
    const emsdkDir = resolvePreferredEmsdkDir(tmpRoot, tmpShared);
    const hostLlvmDir = resolvePreferredHostLlvmDir(tmpRoot, tmpShared);

    assert.equal(llvmDir, path.join(tmpShared, "llvm-project"));
    assert.equal(emsdkDir, path.join(tmpShared, "emsdk"));
    assert.equal(hostLlvmDir, path.join(tmpShared, "llvm"));

    const ensuredLlvm = ensureLlvmProject(tmpRoot, {
      sharedDir: tmpShared,
      dryRun: true,
    });
    assert.equal(ensuredLlvm, path.join(tmpShared, "llvm-project"));

    const ensuredEmsdk = ensureEmsdk(tmpRoot, {
      sharedDir: tmpShared,
      dryRun: true,
    });
    assert.equal(ensuredEmsdk, path.join(tmpShared, "emsdk"));

    const ensuredHostLlvm = ensureHostLlvm(tmpRoot, {
      sharedDir: tmpShared,
      dryRun: true,
    });
    assert.equal(ensuredHostLlvm.hostLlvmDir, path.join(tmpShared, "llvm"));

    const config = resolveBuildConfig({
      rootDir: tmpRoot,
      sharedDir: tmpShared,
      dryRun: true,
    });
    assert.equal(config.llvmDir, path.join(tmpShared, "llvm-project"));
    assert.equal(config.emsdkDir, path.join(tmpShared, "emsdk"));
    assert.equal(config.hostLlvmDir, path.join(tmpShared, "llvm"));
  } finally {
    fs.rmSync(tmpShared, { recursive: true, force: true });
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("falls back to current/root directories when shared directory does not exist or is not writable", () => {
  const nonExistentShared = "/opt/non_existent_shared_dir_12345";
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "project-root-fallback-"));
  const origEmsdk = process.env.EMSDK;
  delete process.env.EMSDK;

  try {
    const llvmDir = resolvePreferredLlvmDir(tmpRoot, nonExistentShared);
    const emsdkDir = resolvePreferredEmsdkDir(tmpRoot, nonExistentShared);
    const hostLlvmDir = resolvePreferredHostLlvmDir(tmpRoot, nonExistentShared);

    assert.equal(llvmDir, path.join(tmpRoot, "llvm-project"));
    assert.equal(emsdkDir, path.join(tmpRoot, "emsdk"));
    assert.equal(hostLlvmDir, path.join(tmpRoot, "llvm"));

    const ensuredLlvm = ensureLlvmProject(tmpRoot, {
      sharedDir: nonExistentShared,
      dryRun: true,
    });
    assert.equal(ensuredLlvm, path.join(tmpRoot, "llvm-project"));

    const ensuredEmsdk = ensureEmsdk(tmpRoot, {
      sharedDir: nonExistentShared,
      dryRun: true,
    });
    assert.equal(ensuredEmsdk, path.join(tmpRoot, "emsdk"));

    const ensuredHostLlvm = ensureHostLlvm(tmpRoot, {
      sharedDir: nonExistentShared,
      dryRun: true,
    });
    assert.equal(ensuredHostLlvm.hostLlvmDir, path.join(tmpRoot, "llvm"));

    const config = resolveBuildConfig({
      rootDir: tmpRoot,
      sharedDir: nonExistentShared,
      dryRun: true,
    });
    assert.equal(config.llvmDir, path.join(tmpRoot, "llvm-project"));
    assert.equal(config.emsdkDir, path.join(tmpRoot, "emsdk"));
    assert.equal(config.hostLlvmDir, path.join(tmpRoot, "llvm"));
  } finally {
    if (origEmsdk !== undefined) {
      process.env.EMSDK = origEmsdk;
    }
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }
});

test("DEFAULT_SHARED_DIR is /opt/shared", () => {
  assert.equal(DEFAULT_SHARED_DIR, "/opt/shared");
});
