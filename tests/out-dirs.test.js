import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureOutDir,
  getOutDir,
  resolvePreferredLlvmDir,
  resolvePreferredHostLlvmDir,
  resolvePreferredEmsdkDir,
} from "../src/utils/fs.js";
import {
  cleanLlvmProject,
  cleanLlvm,
  cleanEmsdk,
  cleanAll,
} from "../src/utils/clean.js";

test("resolvePreferred functions point to out/xxx directories", () => {
  const root = "/my/project";
  assert.equal(getOutDir(root), "/my/project/out");
  assert.equal(resolvePreferredLlvmDir(root), "/my/project/out/llvm-project");
  assert.equal(resolvePreferredHostLlvmDir(root), "/my/project/out/llvm");
  assert.equal(resolvePreferredEmsdkDir(root), "/my/project/out/emsdk");
});

test("ensureOutDir creates 'out' if it does not exist", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "out-test-create-"));
  try {
    const outDir = path.join(tmpDir, "out");
    assert.equal(fs.existsSync(outDir), false);

    const result = ensureOutDir(tmpDir);
    assert.equal(result, outDir);
    assert.equal(fs.existsSync(outDir), true);
    assert.equal(fs.statSync(outDir).isDirectory(), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ensureOutDir preserves existing 'out' directory and never deletes it", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "out-test-preserve-"));
  try {
    const outDir = path.join(tmpDir, "out");
    fs.mkdirSync(outDir);
    const sentinelFile = path.join(outDir, "sentinel.txt");
    fs.writeFileSync(sentinelFile, "keep-me");

    const result = ensureOutDir(tmpDir);
    assert.equal(result, outDir);
    assert.equal(fs.existsSync(sentinelFile), true);
    assert.equal(fs.readFileSync(sentinelFile, "utf8"), "keep-me");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ensureOutDir preserves existing 'out' symlink and never deletes it", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "out-test-symlink-"));
  const tmpTarget = fs.mkdtempSync(path.join(os.tmpdir(), "out-target-"));
  try {
    const outDir = path.join(tmpDir, "out");
    fs.symlinkSync(tmpTarget, outDir);

    assert.equal(fs.lstatSync(outDir).isSymbolicLink(), true);

    const result = ensureOutDir(tmpDir);
    assert.equal(result, outDir);
    assert.equal(fs.lstatSync(outDir).isSymbolicLink(), true);
    assert.equal(fs.realpathSync(outDir), fs.realpathSync(tmpTarget));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpTarget, { recursive: true, force: true });
  }
});

test("ensureOutDir creates target directory if 'out' is a symlink to non-existent dir", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "out-test-target-create-"));
  const tmpTarget = path.join(tmpDir, "external-target");
  try {
    const outDir = path.join(tmpDir, "out");
    fs.symlinkSync(tmpTarget, outDir);

    assert.equal(fs.existsSync(tmpTarget), false);
    assert.equal(fs.lstatSync(outDir).isSymbolicLink(), true);

    const result = ensureOutDir(tmpDir);
    assert.equal(result, outDir);
    assert.equal(fs.existsSync(tmpTarget), true);
    assert.equal(fs.lstatSync(outDir).isSymbolicLink(), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("clean-llvm-project deletes out/llvm-project but NEVER out directory or symlink", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clean-llvm-proj-"));
  try {
    const outDir = path.join(tmpDir, "out");
    const llvmProjDir = path.join(outDir, "llvm-project");
    fs.mkdirSync(llvmProjDir, { recursive: true });
    fs.writeFileSync(path.join(llvmProjDir, "file.txt"), "content");

    assert.equal(fs.existsSync(llvmProjDir), true);
    cleanLlvmProject(tmpDir);

    assert.equal(fs.existsSync(llvmProjDir), false);
    assert.equal(fs.existsSync(outDir), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("clean-llvm deletes out/llvm but NEVER out directory or symlink", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clean-llvm-"));
  try {
    const outDir = path.join(tmpDir, "out");
    const llvmDir = path.join(outDir, "llvm");
    fs.mkdirSync(llvmDir, { recursive: true });
    fs.writeFileSync(path.join(llvmDir, "clang"), "content");

    assert.equal(fs.existsSync(llvmDir), true);
    cleanLlvm(tmpDir);

    assert.equal(fs.existsSync(llvmDir), false);
    assert.equal(fs.existsSync(outDir), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("clean-emsdk deletes out/emsdk but NEVER out directory or symlink", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clean-emsdk-"));
  try {
    const outDir = path.join(tmpDir, "out");
    const emsdkDir = path.join(outDir, "emsdk");
    fs.mkdirSync(emsdkDir, { recursive: true });
    fs.writeFileSync(path.join(emsdkDir, "emsdk"), "content");

    assert.equal(fs.existsSync(emsdkDir), true);
    cleanEmsdk(tmpDir);

    assert.equal(fs.existsSync(emsdkDir), false);
    assert.equal(fs.existsSync(outDir), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("clean-all executes 3 clean actions and preserves out symlink", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clean-all-"));
  const tmpTarget = fs.mkdtempSync(path.join(os.tmpdir(), "clean-target-"));
  try {
    const outDir = path.join(tmpDir, "out");
    fs.symlinkSync(tmpTarget, outDir);

    const projDir = path.join(outDir, "llvm-project");
    const llvmDir = path.join(outDir, "llvm");
    const emsdkDir = path.join(outDir, "emsdk");

    fs.mkdirSync(projDir, { recursive: true });
    fs.mkdirSync(llvmDir, { recursive: true });
    fs.mkdirSync(emsdkDir, { recursive: true });

    assert.equal(fs.existsSync(projDir), true);
    assert.equal(fs.existsSync(llvmDir), true);
    assert.equal(fs.existsSync(emsdkDir), true);

    cleanAll(tmpDir);

    assert.equal(fs.existsSync(projDir), false);
    assert.equal(fs.existsSync(llvmDir), false);
    assert.equal(fs.existsSync(emsdkDir), false);

    // out symlink must still exist!
    assert.equal(fs.lstatSync(outDir).isSymbolicLink(), true);
    assert.equal(fs.existsSync(outDir), true);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
    fs.rmSync(tmpTarget, { recursive: true, force: true });
  }
});
