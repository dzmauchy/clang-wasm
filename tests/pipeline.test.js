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

test("full dry-run pipeline generates and verifies all required artifacts", async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clang-wasm-pipeline-"));
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
