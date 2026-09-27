import test from "node:test";
import assert from "node:assert/strict";
import { cleanFlags, formatBytes, run } from "../src/utils/exec.ts";

test("cleanFlags collapses multiple whitespaces and newlines", () => {
  const input = `
    -Oz
      -ffunction-sections
      -fdata-sections
  `;
  const result = cleanFlags(input);
  assert.equal(result, "-Oz -ffunction-sections -fdata-sections");
});

test("formatBytes formats bytes to MB string", () => {
  assert.equal(formatBytes(1048576), "1.00 MB");
  assert.equal(formatBytes(2621440), "2.50 MB");
});

test("run does not execute in dry-run mode", () => {
  // Should not throw even with non-existent command
  assert.doesNotThrow(() => {
    run("non_existent_command_12345", process.cwd(), {}, true);
  });
});
