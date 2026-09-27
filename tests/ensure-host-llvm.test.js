import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureHostLlvm,
  getHostArchTag,
} from "../src/steps/ensure-host-llvm.js";

test("ensureHostLlvm throws when LLVM_VERSION is not defined", () => {
  const origVersion = process.env.LLVM_VERSION;
  delete process.env.LLVM_VERSION;
  try {
    assert.throws(
      () => ensureHostLlvm("/tmp", { dryRun: true }),
      /LLVM_VERSION environment variable is not defined/
    );
  } finally {
    if (origVersion !== undefined) {
      process.env.LLVM_VERSION = origVersion;
    }
  }
});

test("getHostArchTag returns valid architecture tag", () => {
  const archTag = getHostArchTag();
  assert.ok(archTag === "ARM64" || archTag === "X64");
});

test("ensureHostLlvm detects existing populated host LLVM directory and prefers ld.lld", () => {
  const origVersion = process.env.LLVM_VERSION;
  process.env.LLVM_VERSION = "20.0.0";
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "host-llvm-test-exist-"));
  try {
    const binDir = path.join(tmpDir, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "clang++"), "#!/bin/sh\nexit 0\n");
    fs.writeFileSync(path.join(binDir, "clang"), "#!/bin/sh\nexit 0\n");
    fs.writeFileSync(path.join(binDir, "lld"), "#!/bin/sh\nexit 0\n");
    fs.writeFileSync(path.join(binDir, "ld.lld"), "#!/bin/sh\nexit 0\n");

    const info = ensureHostLlvm("/tmp", {
      explicitHostLlvmDir: tmpDir,
      dryRun: false,
    });

    assert.equal(info.hostLlvmDir, tmpDir);
    assert.equal(info.clangXXPath, path.join(binDir, "clang++"));
    assert.equal(info.clangPath, path.join(binDir, "clang"));
    assert.equal(info.lldPath, path.join(binDir, "ld.lld"));
    assert.equal(process.env.CC, path.join(binDir, "clang"));
    assert.equal(process.env.CXX, path.join(binDir, "clang++"));
    assert.equal(process.env.LD, path.join(binDir, "ld.lld"));
  } finally {
    if (origVersion !== undefined) {
      process.env.LLVM_VERSION = origVersion;
    } else {
      delete process.env.LLVM_VERSION;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ensureHostLlvm falls back to lld when ld.lld does not exist", () => {
  const origVersion = process.env.LLVM_VERSION;
  process.env.LLVM_VERSION = "20.0.0";
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "host-llvm-test-exist-lld-only-"));
  try {
    const binDir = path.join(tmpDir, "bin");
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(path.join(binDir, "clang++"), "#!/bin/sh\nexit 0\n");
    fs.writeFileSync(path.join(binDir, "clang"), "#!/bin/sh\nexit 0\n");
    fs.writeFileSync(path.join(binDir, "lld"), "#!/bin/sh\nexit 0\n");

    const info = ensureHostLlvm("/tmp", {
      explicitHostLlvmDir: tmpDir,
      dryRun: false,
    });

    assert.equal(info.lldPath, path.join(binDir, "lld"));
    assert.equal(process.env.LD, path.join(binDir, "lld"));
  } finally {
    if (origVersion !== undefined) {
      process.env.LLVM_VERSION = origVersion;
    } else {
      delete process.env.LLVM_VERSION;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ensureHostLlvm sets mock binaries and paths in dry-run mode when directory is missing", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "host-llvm-test-dry-"));
  try {
    const targetFolder = path.join(tmpDir, "llvm");

    const info = ensureHostLlvm(tmpDir, {
      explicitHostLlvmDir: targetFolder,
      version: "20.0.0",
      dryRun: true,
    });

    assert.equal(info.hostLlvmDir, targetFolder);
    assert.ok(fs.existsSync(info.clangXXPath));
    assert.ok(fs.existsSync(info.clangPath));
    assert.ok(fs.existsSync(info.lldPath));
    assert.equal(process.env.CC, info.clangPath);
    assert.equal(process.env.CXX, info.clangXXPath);
    assert.equal(process.env.LD, info.lldPath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ensureHostLlvm defaults to out/llvm and ensures out directory", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "host-llvm-test-default-"));
  try {
    const info = ensureHostLlvm(tmpDir, {
      version: "20.0.0",
      dryRun: true,
    });

    assert.equal(info.hostLlvmDir, path.join(tmpDir, "out", "llvm"));
    assert.ok(fs.existsSync(path.join(tmpDir, "out")));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ensureHostLlvm uses LLVM_VERSION when options.version is not specified", () => {
  const origVersion = process.env.LLVM_VERSION;
  process.env.LLVM_VERSION = "24.0.0";
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "host-llvm-test-env-"));
  try {
    const info = ensureHostLlvm(tmpDir, {
      dryRun: true,
    });

    assert.equal(info.hostLlvmDir, path.join(tmpDir, "out", "llvm"));
    assert.ok(fs.existsSync(info.clangXXPath));
  } finally {
    if (origVersion !== undefined) {
      process.env.LLVM_VERSION = origVersion;
    } else {
      delete process.env.LLVM_VERSION;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
