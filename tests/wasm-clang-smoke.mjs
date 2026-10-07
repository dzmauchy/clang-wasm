import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

if (isMainThread) {
  const rootDir = path.resolve(import.meta.dirname, "..");
  const worker = new Worker(new URL(import.meta.url), {
    workerData: {
      moduleDir: path.resolve(process.argv[2] || path.join(rootDir, "dist")),
      sysrootDir: path.resolve(process.argv[3] || path.join(rootDir, "dist/sysroot")),
      hostBinDir: path.join(process.env.HOST_LLVM_DIR || path.join(rootDir, "out/llvm"), "bin"),
    },
  });
  try {
    await new Promise((resolve, reject) => {
      worker.once("message", resolve);
      worker.once("error", reject);
      worker.once("exit", (status) => reject(new Error(`Clang worker exited before reporting a result (${status})`)));
    });
  } finally {
    await worker.terminate();
  }
  console.log("Custom Clang Wasm smoke test passed.");
} else {
  // Load the browser-worker Emscripten module under Node, without network I/O.
  globalThis.self = globalThis;
  globalThis.WorkerGlobalScope = class {};
  const { default: createModule } = await import(pathToFileURL(path.join(workerData.moduleDir, "clang.js")));
  const stdout = [];
  const stderr = [];
  const compiler = await createModule({
    instantiateWasm(imports, receiveInstance) {
      const wasm = new WebAssembly.Module(fs.readFileSync(path.join(workerData.moduleDir, "clang.wasm")));
      const instance = new WebAssembly.Instance(wasm, imports);
      receiveInstance(instance);
      return instance.exports;
    },
    noInitialRun: true,
    print: (line) => stdout.push(line),
    printErr: (line) => stderr.push(line),
  });
  const { FS } = compiler;
  function write(name, contents) {
    FS.mkdirTree(path.posix.dirname(name));
    FS.writeFile(name, contents);
  }
  function mountDirectory(sourceDir, destDir) {
    for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
      const source = path.join(sourceDir, entry.name);
      const dest = path.posix.join(destDir, entry.name);
      if (entry.isDirectory()) mountDirectory(source, dest);
      else write(dest, fs.readFileSync(source));
    }
  }
  // Only compiler headers are needed; linking objects below uses the host LLD.
  mountDirectory(path.join(workerData.sysrootDir, "include"), "/sysroot/include");
  mountDirectory(path.join(workerData.sysrootDir, "lib/clang/23/include"), "/sysroot/lib/clang/23/include");
  FS.mkdirTree("/work/src");
  FS.chdir("/work");

  function invoke(args) {
    stdout.length = 0;
    stderr.length = 0;
    const status = compiler.callMain(args);
    return { status, stdout: stdout.join("\n"), stderr: stderr.join("\n") };
  }
  const exists = (name) => FS.analyzePath(name).exists;
  function succeeds(args) {
    const result = invoke(args);
    assert.equal(result.status, 0, result.stderr);
    return result;
  }
  function fails(args, message) {
    const result = invoke(args);
    assert.notEqual(result.status, 0, `Unexpected success: ${args.join(" ")}`);
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stderr, /\x1b\[/, "Diagnostics must not contain color escapes");
    return result;
  }
  function descendants(node) {
    return [node, ...(node.inner || []).flatMap(descendants)];
  }
  function checkObject(name) {
    const bytes = FS.readFile(name);
    assert.deepEqual([...bytes.slice(0, 8)], [0, 97, 115, 109, 1, 0, 0, 0], `${name} must be a Wasm object`);
    return bytes;
  }

  write("/work/work_header.hpp", "constexpr int work_value = 2;\n");
  write("/headers first/first.hpp", "constexpr int first_value = 4;\n");
  write("/headers second/second.hpp", "constexpr int second_value = 5;\n");
  write("/work/src/answer.cpp", `
#include <cstddef>
#include <bit>
#include <work_header.hpp>
#include <first.hpp>
#include <second.hpp>
#if __cplusplus < 202302L || !defined(__wasm32__) || !defined(__OPTIMIZE__)
#error Expected C++23, Wasm32, and optimization
#endif
#if defined(__EXCEPTIONS) || defined(__GXX_RTTI)
#error Expected exceptions and RTTI to be disabled
#endif
static_assert(sizeof(void*) == 4);
extern int helper();
// Ordinary comments must be included in the JSON AST.
extern "C" int answer() {
  return helper() + work_value + first_value + second_value + std::byteswap(0x01000000u);
}
extern int seed();
int static_value() { static int value = seed(); return value; }
`);
  write("/work/src/helper.cpp", "int helper() { if consteval { return 0; } else { return 30; } }\n");
  const sources = ["/work/src/answer.cpp", "/work/src/helper.cpp"];
  const includes = ["-I", "/headers first", "--include-dir", "/headers second"];
  const result = succeeds([...includes, "-dump", "--output-dir", "/results/nested dump", ...sources]);
  assert.equal(result.stdout, "", "JSON belongs in files, not stdout");
  for (const stem of ["answer", "helper"]) {
    checkObject(`/results/nested dump/${stem}.o`);
    const ast = JSON.parse(FS.readFile(`/results/nested dump/${stem}.json`, { encoding: "utf8" }));
    assert.equal(ast.kind, "TranslationUnitDecl");
    const nodes = descendants(ast);
    assert.ok(nodes.some(node => node.kind === "FunctionDecl" && node.name === stem));
    if (stem === "answer") {
      assert.ok(nodes.some(node => node.kind === "FullComment"), "-fparse-all-comments must preserve ordinary comments");
      assert.ok(nodes.some(node => node.kind === "TextComment" && node.text.includes("Ordinary comments")));
    }
  }
  console.log("PASS: header paths, sysroot/resource headers, C++23 defaults, comments, JSON ASTs, and multiple objects");

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wasm-clang-smoke-"));
  try {
    for (const stem of ["answer", "helper"])
      fs.writeFileSync(path.join(tempDir, `${stem}.o`), FS.readFile(`/results/nested dump/${stem}.o`));
    const symbols = execFileSync(path.join(workerData.hostBinDir, "llvm-nm"), ["--undefined-only", path.join(tempDir, "answer.o")], { encoding: "utf8" });
    assert.doesNotMatch(symbols, /__cxa_guard_/, "-fno-threadsafe-statics must remove ABI guard calls");
    const linked = path.join(tempDir, "answer.wasm");
    execFileSync(path.join(workerData.hostBinDir, "wasm-ld"), [
      "--no-entry", "--export=answer", path.join(tempDir, "answer.o"), path.join(tempDir, "helper.o"), "-o", linked,
    ]);
    const { instance } = await WebAssembly.instantiate(fs.readFileSync(linked));
    assert.equal(instance.exports.answer(), 42);
    console.log("PASS: generated objects link and execute; static initialization does not use threadsafe guards");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  succeeds(["-I/headers first", "--include-dir=/headers second", "--output-dir=/results/objects", ...sources]);
  for (const stem of ["answer", "helper"]) {
    checkObject(`/results/objects/${stem}.o`);
    assert.ok(!exists(`/results/objects/${stem}.json`), "Omit AST files without -dump");
  }
  succeeds(["-o", "/results/alias", "/work/src/helper.cpp"]);
  checkObject("/results/alias/helper.o");
  succeeds(["/work/src/helper.cpp"]);
  checkObject("/work/helper.o");
  write("/work/-dash.cpp", "int dash() { return 1; }\n");
  succeeds(["--", "-dash.cpp"]);
  checkObject("/work/-dash.o");
  console.log("PASS: include/output option forms, implicit object compilation, default output directory, and --");

  write("/work/src/broken.cpp", "int broken( {\n");
  fails(["-dump", "--output-dir", "/results/failed", "/work/src/helper.cpp", "/work/src/broken.cpp"], /error:/);
  assert.ok(exists("/results/failed/helper.json"), "First AST must have finished");
  assert.ok(!exists("/results/failed/helper.o"), "Do not start object generation before all ASTs succeed");
  assert.ok(!exists("/results/failed/broken.o"));
  assert.ok(!exists("/results/failed/broken.json"), "Remove incomplete AST on parse errors");
  fails(["--output-dir", "/results/failed-object", "/work/src/broken.cpp"], /error:/);
  assert.ok(!exists("/results/failed-object/broken.o"), "Remove incomplete object on parse errors");
  fails(["/missing.cpp"], /no such file/);
  fails(["/work/src/answer.cpp"], /'first.hpp' file not found/);
  console.log("PASS: all ASTs precede objects; parse errors and missing headers/files fail cleanly");

  write("/work/other/helper.cpp", "int other() { return 2; }\n");
  fails(["-dump", "--output-dir", "/results/collision", "/work/src/helper.cpp", "/work/other/helper.cpp"], /same output/);
  assert.ok(!exists("/results/collision"), "Reject colliding output names before writing");
  write("/work/source.json", "int source() { return 1; }\n");
  fails(["-dump", "/work/source.json"], /overwrite input/);
  assert.equal(FS.readFile("/work/source.json", { encoding: "utf8" }), "int source() { return 1; }\n");
  for (const args of [["-I"], ["--include-dir"], ["--include-dir="], ["-o"], ["--output-dir"], ["--output-dir="]])
    fails(args, /missing value/);
  fails([], /no input files/);
  fails(["-dump"], /no input files/);
  fails(["-O0", "/work/src/helper.cpp"], /unsupported option/);
  write("/results/regular-file", "not a directory");
  fails(["--output-dir", "/results/regular-file", "/work/src/helper.cpp"], /cannot create output directory|Not a directory/);
  assert.equal(FS.readFile("/results/regular-file", { encoding: "utf8" }), "not a directory");
  assert.match(succeeds(["--help"]).stdout, /-dump/);
  assert.match(succeeds(["--version"]).stdout, /Custom browser Clang/);
  console.log("PASS: output collisions, invalid options, output errors, help, version, and repeated invocations");
  parentPort.postMessage({ status: 0 });
}
