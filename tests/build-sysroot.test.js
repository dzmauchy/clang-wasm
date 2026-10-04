import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildSysroot, packageSysroot } from "../src/steps/build-sysroot.js";
import { resolveBuildConfig } from "../src/config.js";

const projectRoot = path.resolve(import.meta.dirname, "..");

function fixture(rootDir) {
  const config = resolveBuildConfig({ rootDir, llvmTag: "test-tag", dryRun: false });
  const installDir = path.join(config.buildSysrootDir, "llvm-runtimes-install");
  const builtinsBuildDir = path.join(config.buildSysrootDir, "compiler_rt-prefix", "src", "compiler_rt-build");
  const resourceDir = path.join(config.hostLlvmDir, "lib", "clang", "23");
  const write = (file, contents = "fixture\n") => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  };
  for (const name of ["stdio.h", "c++/v1/vector", "c++/v1/__config_site", "c++/v1/cxxabi.h",
    "llvm-libc-types/FILE.h", "llvm-libc-macros/errno-macros.h"]) {
    write(path.join(installDir, "include", name));
  }
  for (const name of ["libc.a", "libm.a"]) write(path.join(installDir, "lib", "wasm32-unknown-unknown", name));
  for (const name of ["libc++.a", "libc++abi.a"]) write(path.join(installDir, "lib", name));
  write(path.join(builtinsBuildDir, "lib", "libclang_rt.builtins-wasm32.a"));
  write(path.join(resourceDir, "include", "stddef.h"));
  write(path.join(config.llvmDir, "llvm", "LICENSE.TXT"));
  write(path.join(config.buildSysrootDir, "libbrowser.a"));
  write(path.join(config.buildSysrootDir, "browser_config.h"));
  write(path.join(rootDir, "sysroot", "browser.hpp"));
  write(path.join(rootDir, "sysroot", "browser.c"));
  for (const template of ["cmake/wasm32-toolchain.cmake.in", "sysroot/browser_config.h.in"]) {
    write(path.join(rootDir, template), fs.readFileSync(path.join(projectRoot, template), "utf8"));
  }
  return { config, installDir, builtinsBuildDir, resourceDir };
}

test("sysroot builds LLVM dependencies directly and packages them with literal paths", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sysroot '$literal`path-"));
  const previousPath = process.env.PATH;
  const previousLog = process.env.SYSROOT_TEST_LOG;
  try {
    const data = fixture(rootDir);
    const { config, resourceDir } = data;
    const binDir = path.join(rootDir, "bin");
    fs.mkdirSync(binDir);
    const log = path.join(rootDir, "commands.jsonl");
    const mock = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.SYSROOT_TEST_LOG, JSON.stringify([path.basename(process.argv[1]), ...args]) + '\\n');
if (args.includes('-print-resource-dir')) console.log(${JSON.stringify(resourceDir)});
`;
    for (const tool of ["cmake", config.hostClangPath, config.hostClangXXPath,
      path.join(config.hostBinDir, "llvm-ar"), path.join(config.hostBinDir, "llvm-strip")]) {
      const file = path.isAbsolute(tool) ? tool : path.join(binDir, tool);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, mock, { mode: 0o755 });
    }
    config.llvmStripPath = path.join(config.hostBinDir, "llvm-strip");
    config.sysrootHeapSize = 1048576;
    const sentinel = path.join(config.distDir, "clang.wasm");
    fs.mkdirSync(config.stageDir, { recursive: true });
    fs.writeFileSync(sentinel, "keep compiler");
    fs.writeFileSync(path.join(config.stageDir, "stale.h"), "old header");
    process.env.PATH = `${binDir}:${previousPath}`;
    process.env.SYSROOT_TEST_LOG = log;
    buildSysroot(config);
    const commands = fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
    const configurations = commands.filter(args => args.includes("-S"));
    assert.equal(configurations.length, 2);
    assert.equal(configurations[0][configurations[0].indexOf("-S") + 1], path.join(config.llvmDir, "runtimes"));
    assert.equal(configurations[1][configurations[1].indexOf("-S") + 1], path.join(config.llvmDir, "compiler-rt", "lib", "builtins"));
    assert.ok(configurations[0].includes("-DLLVM_ENABLE_RUNTIMES=libc;libcxxabi;libcxx"));
    assert.ok(configurations[0].includes("-DLIBCXX_ENABLE_EXCEPTIONS=OFF"));
    assert.ok(configurations[0].includes("-DLIBCXXABI_ENABLE_RTTI=OFF"));
    assert.ok(configurations[0].includes("-DCMAKE_CXX_FLAGS=-DBROWSER_HEAP_SIZE=1048576 -ffunction-sections -fdata-sections -fno-exceptions -fno-rtti"));
    assert.ok(commands.some(args => args.includes("install-libc") && args.includes("install-cxxabi")));
    assert.ok(commands.some(args => args.includes(path.join(rootDir, "sysroot", "browser.c"))));
    assert.ok(commands.some(args => args.includes("--strip-debug") && args.includes(path.join(config.stageDir, "lib", "libc++.a"))));
    assert.deepEqual(commands.at(-1), ["cmake", "-E", "tar", "czf", path.join(config.distDir, "sysroot.tgz"), "--format=gnutar", "sysroot"]);
    assert.equal(fs.existsSync(path.join(config.stageDir, "stale.h")), false);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "keep compiler");
    for (const file of ["include/c++/v1/vector", "include/c++/v1/cxxabi.h", "include/llvm-libc-types/FILE.h",
      "lib/libc.a", "lib/libm.a", "lib/libc++.a", "lib/libc++abi.a", "lib/libbrowser.a",
      "lib/libclang_rt.builtins-wasm32.a", "lib/clang/23/lib/wasi/libclang_rt.builtins-wasm32.a",
      "lib/clang/23/include/stddef.h", "share/licenses/LLVM-LICENSE.TXT"]) {
      assert.ok(fs.existsSync(path.join(config.stageDir, file)), `Missing packaged ${file}`);
    }
    assert.match(fs.readFileSync(path.join(config.stageDir, "include", "browser_config.h"), "utf8"), /#define BROWSER_HEAP_SIZE 1048576/);
    assert.ok(fs.readFileSync(path.join(config.buildSysrootDir, "wasm32-toolchain.cmake"), "utf8")
      .includes(config.hostClangPath.replaceAll("$", "\\$")));
  } finally {
    process.env.PATH = previousPath;
    if (previousLog === undefined) delete process.env.SYSROOT_TEST_LOG;
    else process.env.SYSROOT_TEST_LOG = previousLog;
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sysroot rejects invalid heap sizes before running commands", () => {
  for (const sysrootHeapSize of [0, 65535, 1073741825, "NaN", "65536.5", "123abc"]) {
    assert.throws(() => buildSysroot({ sysrootHeapSize }), /SYSROOT_HEAP_SIZE must be between/);
  }
});

test("packaging rejects missing or ambiguous builtins before replacing the sysroot", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sysroot-builtins-"));
  try {
    const data = fixture(rootDir);
    fs.mkdirSync(data.config.stageDir, { recursive: true });
    const sentinel = path.join(data.config.stageDir, "preserve-until-validated");
    fs.writeFileSync(sentinel, "keep");
    const original = path.join(data.builtinsBuildDir, "lib", "libclang_rt.builtins-wasm32.a");
    fs.rmSync(original);
    assert.throws(() => packageSysroot(data.config, data), /Expected one Wasm compiler-rt archive/);
    fs.writeFileSync(original, "builtins");
    fs.writeFileSync(path.join(data.builtinsBuildDir, "libclang_rt.builtins-wasm32.a"), "duplicate");
    assert.throws(() => packageSysroot(data.config, data), /Expected one Wasm compiler-rt archive/);
    assert.equal(fs.readFileSync(sentinel, "utf8"), "keep");
  } finally {
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
