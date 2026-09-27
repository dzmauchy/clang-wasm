import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureLlvmProject } from "../src/steps/ensure-llvm.js";

test("ensureLlvmProject detects existing populated llvm directory", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llvm-test-exist-"));
  try {
    const llvmFolder = path.join(tmpDir, "llvm-project");
    fs.mkdirSync(path.join(llvmFolder, "llvm"), { recursive: true });
    fs.writeFileSync(path.join(llvmFolder, "llvm", "CMakeLists.txt"), "# test");

    const result = ensureLlvmProject(tmpDir, {
      explicitLlvmDir: llvmFolder,
      tag: "test-tag",
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
      tag: "test-tag",
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
      tag: "test-tag",
      dryRun: true,
    });

    assert.equal(result, path.join(tmpDir, "out", "llvm-project"));
    assert.ok(fs.existsSync(path.join(tmpDir, "out")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ensureLlvmProject throws when LLVM_VERSION and tag are not defined", () => {
  const origVersion = process.env.LLVM_VERSION;
  const origTag = process.env.LLVM_TAG;
  delete process.env.LLVM_VERSION;
  delete process.env.LLVM_TAG;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llvm-test-throw-"));
  try {
    assert.throws(
      () => ensureLlvmProject(tmpDir, { dryRun: true }),
      /LLVM_VERSION environment variable is not defined/
    );
  } finally {
    if (origVersion !== undefined) {
      process.env.LLVM_VERSION = origVersion;
    }
    if (origTag !== undefined) {
      process.env.LLVM_TAG = origTag;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ensureLlvmProject uses LLVM_VERSION when tag is not specified", () => {
  const origVersion = process.env.LLVM_VERSION;
  const origTag = process.env.LLVM_TAG;
  delete process.env.LLVM_TAG;
  process.env.LLVM_VERSION = "24.0.0";
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "llvm-test-ver-"));
  try {
    const targetFolder = path.join(tmpDir, "llvm-project");
    const result = ensureLlvmProject(tmpDir, {
      explicitLlvmDir: targetFolder,
      dryRun: true,
    });
    assert.equal(result, targetFolder);
    assert.ok(fs.existsSync(path.join(targetFolder, "llvm")));
  } finally {
    if (origVersion !== undefined) {
      process.env.LLVM_VERSION = origVersion;
    } else {
      delete process.env.LLVM_VERSION;
    }
    if (origTag !== undefined) {
      process.env.LLVM_TAG = origTag;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
