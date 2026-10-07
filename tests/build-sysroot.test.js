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
  const write = (file, contents = "fixture\n") => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
  };
  write(path.join(config.llvmDir, "llvm", "LICENSE.TXT"));
  write(path.join(config.buildSysrootDir, "browser_config.h"));
  write(path.join(rootDir, "sysroot", "browser.hpp"));
  write(path.join(rootDir, "sysroot", "browser.c"));
  write(path.join(config.hostLlvmDir, "lib", "clang", "23", "include", "__clang_cuda_math.h"));
  for (const template of ["cmake/wasm32-toolchain.cmake.in", "sysroot/browser_config.h.in"]) {
    write(path.join(rootDir, template), fs.readFileSync(path.join(projectRoot, template), "utf8"));
  }
  for (const file of ["wasm.h", "wasm.hpp", "wasm.c", "wasm.cpp", "wasm-init.c", "tlsf/tlsf.c", "tlsf/tlsf.h"]) {
    fs.mkdirSync(path.dirname(path.join(rootDir, "sysroot", file)), { recursive: true });
    write(path.join(rootDir, "sysroot", file), fs.readFileSync(path.join(projectRoot, "sysroot", file), "utf8"));
  }
  return config;
}

function mockTools(config, log) {
  const binDir = path.join(config.rootDir, "bin");
  const mock = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const tool = path.basename(process.argv[1]);
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify([tool, ...args]) + '\\n');
const stage = ${JSON.stringify(config.stageDir)};
const write = (file, contents = 'installed by LLVM') => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents);
};
if (args.includes('install-core-resource-headers') && args.includes('install-webassembly-resource-headers')) {
  for (const header of ['stddef.h', 'wasm_simd128.h', 'new-upstream-header.h']) {
    write(path.join(stage, 'lib/clang/23/include', header));
  }
}
if (args.includes('install-clang_rt.builtins-wasm32')) {
  write(path.join(stage, 'lib/clang/23/lib/wasi/libclang_rt.builtins-wasm32.a'));
}
if ((tool === 'clang' || tool === 'clang++') && args.includes('-o')) write(args[args.indexOf('-o') + 1], 'browser object');
if (tool === 'llvm-ar' && args[0] === 'rcs') write(args[1], 'browser archive');
`;
  for (const tool of [path.join(binDir, "cmake"), config.hostClangPath,
    config.hostClangXXPath, path.join(config.hostBinDir, "llvm-ar")]) {
    fs.mkdirSync(path.dirname(tool), { recursive: true });
    fs.writeFileSync(tool, mock, { mode: 0o755 });
  }
  return binDir;
}

function readCommands(log) {
  return fs.readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
}

test("LLVM installs directly into a clean sysroot without JavaScript file selection", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sysroot '$literal`path-"));
  const previousPath = process.env.PATH;
  try {
    const config = fixture(rootDir);
    const log = path.join(rootDir, "commands.jsonl");
    process.env.PATH = `${mockTools(config, log)}:${previousPath}`;
    config.sysrootHeapSize = 1048576;
    fs.mkdirSync(config.stageDir, { recursive: true });
    const sentinel = path.join(config.distDir, "clang.wasm");
    fs.writeFileSync(sentinel, "keep compiler");
    fs.writeFileSync(path.join(config.stageDir, "stale.h"), "old header");
    buildSysroot(config);
    const commands = readCommands(log);
    const configurations = commands.filter(args => args.includes("-S"));
    assert.equal(configurations.length, 2);
    for (const configuration of configurations) {
      assert.ok(configuration.includes(`-DCMAKE_INSTALL_PREFIX=${config.stageDir}`));
    }
    assert.ok(configurations[0].includes("-DLLVM_TARGETS_TO_BUILD=WebAssembly"));
    assert.ok(!commands.some(args => args.some(arg => /LIBCXX|LLVM_ENABLE_RUNTIMES|prepare-.*libc/.test(arg))));
    assert.ok(configurations[1].includes("-DCOMPILER_RT_INSTALL_LIBRARY_DIR:STRING=lib/clang/23/lib/wasi"));
    assert.ok(commands.some(args => args.includes("install-core-resource-headers") && args.includes("install-webassembly-resource-headers")));
    assert.ok(commands.some(args => args.includes("install-clang_rt.builtins-wasm32")));
    assert.ok(commands.some(args => args[0] === "llvm-ar" &&
      args[2] === path.join(config.stageDir, "lib/clang/23/lib/wasi/libclang_rt.builtins-wasm32.a") &&
      args.includes(path.join(config.buildSysrootDir, "tlsf.c.o")) &&
      args.includes(path.join(config.buildSysrootDir, "wasm.cpp.o")) &&
      args.includes(path.join(config.buildSysrootDir, "wasm-init.c.o"))));
    assert.ok(!commands.some(args => args.includes("install-clang-resource-headers") || args.includes("--strip-debug")));
    assert.deepEqual(commands.at(-1), ["cmake", "-E", "tar", "czf", path.join(config.distDir, "sysroot.tgz"), "--format=gnutar", "sysroot"]);
    assert.equal(fs.existsSync(path.join(config.stageDir, "stale.h")), false);
    assert.equal(fs.existsSync(path.join(config.stageDir, "lib/clang/23/include/__clang_cuda_math.h")), false);
    assert.equal(fs.existsSync(path.join(config.stageDir, "lib/libc.a")), false, "Do not package libc");
    assert.equal(fs.existsSync(path.join(config.stageDir, "lib/libclang_rt.builtins-wasm32.a")), false, "Do not duplicate LLVM's installed builtins");
    for (const file of ["include/c++", "include/llvm-libc-types", "lib/libc++.a", "lib/libc++abi.a", "lib/wasm32-unknown-unknown/libc.a"]) {
      assert.ok(!fs.existsSync(path.join(config.stageDir, file)), `Exclude ${file}`);
    }
    assert.equal(fs.readFileSync(sentinel, "utf8"), "keep compiler");
    for (const file of ["include/wasm.h", "include/wasm.hpp", "include/tlsf.h",
      "lib/libtlsf.a", "lib/libwasm.a", "lib/libbrowser.a", "share/licenses/TLSF-LICENSE.txt",
      "lib/clang/23/lib/wasi/libclang_rt.builtins-wasm32.a", "lib/clang/23/include/new-upstream-header.h",
      "share/licenses/LLVM-LICENSE.TXT"]) {
      assert.ok(fs.existsSync(path.join(config.stageDir, file)), `Missing installed ${file}`);
    }
    assert.match(fs.readFileSync(path.join(config.stageDir, "include", "browser_config.h"), "utf8"), /#define BROWSER_HEAP_SIZE 1048576/);
  } finally {
    process.env.PATH = previousPath;
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});

test("sysroot rejects invalid heap sizes before running commands", () => {
  for (const sysrootHeapSize of [0, 65535, 1073741825, "NaN", "65536.5", "123abc"]) {
    assert.throws(() => buildSysroot({ sysrootHeapSize }), /SYSROOT_HEAP_SIZE must be between/);
  }
});

test("packaging preserves upstream installed files without inspecting their names", () => {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "sysroot-whole-install-"));
  const previousPath = process.env.PATH;
  try {
    const config = fixture(rootDir);
    const log = path.join(rootDir, "commands.jsonl");
    process.env.PATH = `${mockTools(config, log)}:${previousPath}`;
    fs.mkdirSync(config.stageDir, { recursive: true });
    const upstreamFile = path.join(config.stageDir, "future-upstream-component");
    fs.writeFileSync(upstreamFile, "keep exactly as installed");
    packageSysroot(config);
    assert.equal(fs.readFileSync(upstreamFile, "utf8"), "keep exactly as installed");
    assert.deepEqual(readCommands(log), [["cmake", "-E", "tar", "czf", path.join(config.distDir, "sysroot.tgz"), "--format=gnutar", "sysroot"]]);
  } finally {
    process.env.PATH = previousPath;
    fs.rmSync(rootDir, { recursive: true, force: true });
  }
});
