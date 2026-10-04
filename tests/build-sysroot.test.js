import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSysroot } from "../src/steps/build-sysroot.js";
import { resolveBuildConfig } from "../src/config.js";

test("sysroot pipeline delegates configuration and packaging to CMake with literal paths", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sysroot '$literal`path-"));
  const previousPath = process.env.PATH;
  const previousLog = process.env.SYSROOT_TEST_LOG;
  try {
    const binDir = path.join(rootDir, "bin");
    fs.mkdirSync(binDir);
    const log = path.join(rootDir, "commands.jsonl");
    fs.writeFileSync(path.join(binDir, "cmake"), `#!/usr/bin/env node
import fs from 'node:fs';
fs.appendFileSync(process.env.SYSROOT_TEST_LOG, JSON.stringify(process.argv.slice(2)) + '\\n');
`, { mode: 0o755 });
    fs.writeFileSync(path.join(binDir, "package.json"), '{"type":"module"}');
    process.env.PATH = `${binDir}:${previousPath}`;
    process.env.SYSROOT_TEST_LOG = log;
    const config = resolveBuildConfig({ rootDir, llvmTag: "test-tag", dryRun: false });
    buildSysroot(config);
    const [configure, build] = fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
    assert.ok(configure.includes(rootDir));
    assert.ok(configure.includes(`-DSYSROOT_OUTPUT_DIR=${config.distDir}`));
    assert.ok(configure.includes(`-DLLVM_SOURCE_DIR=${config.llvmDir}`));
    assert.deepEqual(build, ["--build", config.buildSysrootDir, "--target", "sysroot", "--parallel", "4"]);
    assert.equal(fs.existsSync(config.stageDir), false, "JavaScript must leave staging to CMake");
  } finally {
    process.env.PATH = previousPath;
    if (previousLog === undefined) delete process.env.SYSROOT_TEST_LOG;
    else process.env.SYSROOT_TEST_LOG = previousLog;
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
