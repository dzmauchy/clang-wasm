import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { assembleSysroot } from "../src/steps/assemble-sysroot.js";
import { resolveBuildConfig } from "../src/config.js";

test("assembleSysroot packages libraries into sysroot/lib/target and excludes *-wasmexcept.a", () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "assemble-sysroot-test-"));
  try {
    const emscriptenSysroot = path.join(tmpDir, "emsdk-sysroot");
    const emscriptenLibDir = path.join(emscriptenSysroot, "lib/wasm32-emscripten");
    const emscriptenIncDir = path.join(emscriptenSysroot, "include");
    fs.mkdirSync(emscriptenLibDir, { recursive: true });
    fs.mkdirSync(emscriptenIncDir, { recursive: true });

    // Populate mock Emscripten sysroot libraries
    fs.writeFileSync(path.join(emscriptenIncDir, "stdio.h"), "// mock header");
    fs.writeFileSync(path.join(emscriptenLibDir, "libc.a"), "!<arch>\nmock-libc");
    fs.writeFileSync(path.join(emscriptenLibDir, "libc++.a"), "!<arch>\nmock-libcxx");
    fs.writeFileSync(path.join(emscriptenLibDir, "crt1.o"), "mock-crt1");
    // Pruned libraries
    fs.writeFileSync(path.join(emscriptenLibDir, "libc-wasmexcept.a"), "!<arch>\nmock-wasmexcept");
    fs.writeFileSync(path.join(emscriptenLibDir, "libc++-wasmexcept.a"), "!<arch>\nmock-cxx-wasmexcept");
    fs.writeFileSync(path.join(emscriptenLibDir, "libc++abi-debug-mt-wasmexcept.a"), "!<arch>\nmock-debug-wasmexcept");
    fs.writeFileSync(path.join(emscriptenLibDir, "libunwind-wasmexcept.a"), "!<arch>\nmock-unwind-wasmexcept");
    fs.writeFileSync(path.join(emscriptenLibDir, "libGL.a"), "!<arch>\nmock-gl");

    // Mock LLVM resource dir
    const llvmDir = path.join(tmpDir, "llvm-project");
    const clangResDir = path.join(llvmDir, "build-native/lib/clang/20/include");
    fs.mkdirSync(clangResDir, { recursive: true });
    fs.writeFileSync(path.join(clangResDir, "stddef.h"), "// mock stddef");
    fs.writeFileSync(path.join(clangResDir, "arm_neon.h"), "// mock arm");

    const distDir = path.join(tmpDir, "dist");
    fs.mkdirSync(distDir, { recursive: true });

    const config = resolveBuildConfig({
      rootDir: tmpDir,
      llvmDir,
      distDir,
      emsdkDir: tmpDir,
      llvmTag: "test-tag",
      dryRun: false,
    });

    // Override emscriptenSysroot and llvmStripPath to avoid requiring external binaries
    config.emscriptenSysroot = emscriptenSysroot;
    config.llvmStripPath = "true";

    assembleSysroot(config);

    const archivePath = path.join(distDir, "sysroot.tgz");
    assert.ok(fs.existsSync(archivePath), "sysroot.tgz must be generated");

    // Inspect archive contents using tar -tf
    const tarOutput = execSync(`tar -tf "${archivePath}"`, { encoding: "utf8" });
    const archiveFiles = tarOutput
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    // Verify sysroot/lib/target exists
    const hasTargetDir = archiveFiles.some((f) => f.includes("sysroot/lib/target"));
    assert.ok(hasTargetDir, "Archive should contain sysroot/lib/target");

    // Verify sysroot/lib/wasm32-emscripten does NOT exist
    const hasWasm32Emscripten = archiveFiles.some((f) => f.includes("wasm32-emscripten"));
    assert.equal(hasWasm32Emscripten, false, "Archive must not contain wasm32-emscripten");

    // Verify libc.a and libc++.a are present in sysroot/lib/target
    const hasLibc = archiveFiles.some((f) => f === "sysroot/lib/target/libc.a" || f.endsWith("/lib/target/libc.a"));
    assert.ok(hasLibc, "Archive should contain sysroot/lib/target/libc.a");

    const hasLibCxx = archiveFiles.some((f) => f === "sysroot/lib/target/libc++.a" || f.endsWith("/lib/target/libc++.a"));
    assert.ok(hasLibCxx, "Archive should contain sysroot/lib/target/libc++.a");

    // Verify all *-wasmexcept.a files are excluded
    const wasmexceptFiles = archiveFiles.filter((f) => f.includes("-wasmexcept.a"));
    assert.deepEqual(wasmexceptFiles, [], "Archive must not contain any *-wasmexcept.a files");

    // Verify libGL.a was pruned
    const glFiles = archiveFiles.filter((f) => f.includes("libGL.a"));
    assert.deepEqual(glFiles, [], "Archive must not contain libGL.a");
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
