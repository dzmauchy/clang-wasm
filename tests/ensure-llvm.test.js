import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureLlvmProject, DEFAULT_LLVM_TAG } from "../src/steps/ensure-llvm.js";

test("ensureLlvmProject detects existing populated llvm directory", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llvm-test-exist-"));
  try {
    const llvmFolder = path.join(tmpDir, "llvm-project");
    fs.mkdirSync(path.join(llvmFolder, "llvm"), { recursive: true });
    fs.writeFileSync(path.join(llvmFolder, "llvm", "CMakeLists.txt"), "# test");

    const result = ensureLlvmProject(tmpDir, {
      explicitLlvmDir: llvmFolder,
      dryRun: false,
    });

    assert.equal(result, llvmFolder);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ensureLlvmProject creates mock directory in dry-run mode if missing", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llvm-test-dry-"));
  try {
    const targetFolder = path.join(tmpDir, "llvm-project");

    const result = ensureLlvmProject(tmpDir, {
      explicitLlvmDir: targetFolder,
      tag: "llvmorg-23.1.2",
      dryRun: true,
    });

    assert.equal(result, targetFolder);
    assert.ok(fs.existsSync(path.join(targetFolder, "llvm")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ensureLlvmProject defaults to out/llvm-project and ensures out directory", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llvm-test-default-"));
  try {
    const result = ensureLlvmProject(tmpDir, {
      dryRun: true,
    });

    assert.equal(result, path.join(tmpDir, "out", "llvm-project"));
    assert.ok(fs.existsSync(path.join(tmpDir, "out")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("DEFAULT_LLVM_TAG is llvmorg-23.1.2", () => {
  assert.equal(DEFAULT_LLVM_TAG, "llvmorg-23.1.2");
});
