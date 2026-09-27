import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ensureHostLlvm,
  getHostArchTag,
  DEFAULT_HOST_LLVM_VERSION,
} from "../src/steps/ensure-host-llvm.ts";

test("DEFAULT_HOST_LLVM_VERSION is 23.1.2", () => {
  assert.equal(DEFAULT_HOST_LLVM_VERSION, "23.1.2");
});

test("getHostArchTag returns valid architecture tag", () => {
  const archTag = getHostArchTag();
  assert.ok(archTag === "ARM64" || archTag === "X64");
});

test("ensureHostLlvm detects existing populated host LLVM directory", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "host-llvm-test-exist-"));
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

    assert.equal(info.hostLlvmDir, tmpDir);
    assert.equal(info.clangXXPath, path.join(binDir, "clang++"));
    assert.equal(info.clangPath, path.join(binDir, "clang"));
    assert.equal(info.lldPath, path.join(binDir, "lld"));
    assert.equal(process.env.CC, path.join(binDir, "clang"));
    assert.equal(process.env.CXX, path.join(binDir, "clang++"));
    assert.equal(process.env.LD, path.join(binDir, "lld"));
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ensureHostLlvm sets mock binaries and paths in dry-run mode when directory is missing", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "host-llvm-test-dry-"));
  try {
    const targetFolder = path.join(tmpDir, "llvm");

    const info = ensureHostLlvm(tmpDir, {
      explicitHostLlvmDir: targetFolder,
      version: "23.1.2",
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
