import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ensureEmsdk, DEFAULT_EMSDK_VERSION } from "../src/steps/ensure-emsdk.js";

test("DEFAULT_EMSDK_VERSION is 6.0.10", () => {
  assert.equal(DEFAULT_EMSDK_VERSION, "6.0.10");
});

test("ensureEmsdk uses existing EMSDK environment variable", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "emsdk-test-env-"));
  const origEmsdk = process.env.EMSDK;
  try {
    process.env.EMSDK = tmpDir;
    const result = ensureEmsdk(tmpDir, {
      dryRun: true,
    });
    assert.equal(result, tmpDir);
  } finally {
    if (origEmsdk !== undefined) {
      process.env.EMSDK = origEmsdk;
    } else {
      delete process.env.EMSDK;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ensureEmsdk uses explicitEmsdkDir if provided", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "emsdk-test-explicit-"));
  try {
    const result = ensureEmsdk("/tmp", {
      explicitEmsdkDir: tmpDir,
      dryRun: true,
    });
    assert.equal(result, tmpDir);
    assert.equal(process.env.EMSDK, tmpDir);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test("ensureEmsdk sets target path in dry-run mode to out/emsdk when EMSDK is unset", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "emsdk-test-unset-"));
  const origEmsdk = process.env.EMSDK;
  delete process.env.EMSDK;
  try {
    const result = ensureEmsdk(tmpDir, {
      dryRun: true,
    });
    assert.equal(result, path.join(tmpDir, "out", "emsdk"));
    assert.equal(process.env.EMSDK, path.join(tmpDir, "out", "emsdk"));
  } finally {
    if (origEmsdk !== undefined) {
      process.env.EMSDK = origEmsdk;
    } else {
      delete process.env.EMSDK;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
