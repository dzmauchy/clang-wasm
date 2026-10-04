import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { main } from "../src/index.js";
import { verifyArtifacts, REQUIRED_ARTIFACTS } from "../src/steps/verify-artifacts.js";
import { resolveBuildConfig } from "../src/config.js";

test("verifyArtifacts detects missing artifacts", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clang-wasm-test-"));
  try {
    const config = resolveBuildConfig({
      distDir: tmpDir,
      llvmTag: "test-tag",
      dryRun: true,
    });

    assert.throws(
      () => verifyArtifacts(config),
      /Missing expected artifacts/
    );
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("main throws an error if LLVM_VERSION is not defined", async () => {
  const origVersion = process.env.LLVM_VERSION;
  delete process.env.LLVM_VERSION;
  try {
    await assert.rejects(
      () => main(["--dry-run"]),
      /LLVM_VERSION environment variable is not defined/
    );
  } finally {
    if (origVersion !== undefined) {
      process.env.LLVM_VERSION = origVersion;
    }
  }
});

test("full dry-run pipeline generates and verifies all required artifacts", async () => {
  const origVersion = process.env.LLVM_VERSION;
  process.env.LLVM_VERSION = "20.0.0";
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clang-wasm-pipeline-"));
  const previousCwd = process.cwd();
  process.chdir(tmpDir);
  try {
    await main(["--dry-run", "--dist-dir", tmpDir]);

    for (const artifact of REQUIRED_ARTIFACTS) {
      const artifactPath = path.join(tmpDir, artifact);
      assert.ok(
        fs.existsSync(artifactPath),
        `Expected ${artifact} to exist in ${tmpDir}`
      );
    }
  } finally {
    process.chdir(previousCwd);
    if (origVersion !== undefined) {
      process.env.LLVM_VERSION = origVersion;
    } else {
      delete process.env.LLVM_VERSION;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("main succeeds when --llvm-version CLI option is provided without LLVM_VERSION env", async () => {
  const origVersion = process.env.LLVM_VERSION;
  delete process.env.LLVM_VERSION;
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clang-wasm-cli-"));
  const previousCwd = process.cwd();
  process.chdir(tmpDir);
  try {
    await main(["--dry-run", "--dist-dir", tmpDir, "--llvm-version", "20.0.0"]);

    for (const artifact of REQUIRED_ARTIFACTS) {
      const artifactPath = path.join(tmpDir, artifact);
      assert.ok(
        fs.existsSync(artifactPath),
        `Expected ${artifact} to exist in ${tmpDir}`
      );
    }
  } finally {
    process.chdir(previousCwd);
    if (origVersion !== undefined) {
      process.env.LLVM_VERSION = origVersion;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
