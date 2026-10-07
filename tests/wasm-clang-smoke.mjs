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
#include <wasm.hpp>
#include <work_header.hpp>
#include <first.hpp>
#include <second.hpp>
#if __STDC_HOSTED__ != 0
#error Expected freestanding compilation
#endif
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
  return helper() + work_value + first_value + second_value + __builtin_bswap32(0x01000000u);
}
extern int seed();
int static_value() { static int value = seed(); return value; }
`);
  write("/work/src/helper.cpp", "int helper() { if consteval { return 0; } else { return 30; } }\n");
  const sources = ["/work/src/answer.cpp", "/work/src/helper.cpp"];
  const includes = ["-I", "/headers first", "-I", "/headers second"];
  const result = succeeds([...includes, "-o", "/results/nested dump", ...sources]);
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
      for (const name of ["work_value", "first_value", "second_value"])
        assert.ok(!ast.inner?.some(node => node.name === name), `Omit included declaration ${name}`);
      assert.ok(FS.stat(`/results/nested dump/${stem}.json`).size < 100_000,
        "Including the runtime header must not grow the dump with header declaration trees");
    }
  }
  console.log("PASS: header paths, sysroot/resource headers, C++23 defaults, comments, JSON ASTs, and multiple objects");

  write("/work/macros.hpp", `
#define SOURCE_FUNCTION(name) int name() { return 9; }
inline int header_default(int value = 41) { return value; }
namespace Reopened { struct HeaderOnly {}; }
`);
  write("/work/namespace_header.hpp", "struct NamespaceHeaderOnly {};\n");
  write("/work/linkage_header.hpp", "int linkage_header_only();\n");
  write("/work/src/filtered.cpp", `
#include <macros.hpp>
SOURCE_FUNCTION(macro_function)
namespace Reopened {
  // Preserve source-owned namespaces and their comments.
  int source_function() { auto inferred = header_default(); return inferred; }
}
namespace SourceNamespace {
#include <namespace_header.hpp>
  struct SourceRecord { int member; };
}
extern "C" {
#include <linkage_header.hpp>
  int source_export() { return 42; }
}
#line 1 "pretend_header.hpp"
int remapped_source() { return 1; }
`);
  succeeds(["-o", "/results/filtered", "/work/src/filtered.cpp"]);
  checkObject("/results/filtered/filtered.o");
  const filtered = JSON.parse(FS.readFile("/results/filtered/filtered.json", { encoding: "utf8" }));
  const filteredNodes = descendants(filtered);
  for (const name of ["macro_function", "source_function", "SourceRecord", "member", "source_export", "remapped_source"])
    assert.ok(filteredNodes.some(node => node.name === name), `Retain source declaration ${name}`);
  for (const name of ["HeaderOnly", "header_default"])
    assert.ok(!filteredNodes.some(node => node.name === name), `Omit included declaration ${name}`);
  assert.ok(filteredNodes.some(node => node.kind === "CompoundStmt"), "Retain function bodies");
  assert.ok(filteredNodes.some(node => node.name === "inferred" && node.type?.qualType === "int"), "Retain inferred types");
  assert.ok(filteredNodes.some(node => node.kind === "CXXDefaultArgExpr"), "Retain default argument expressions");
  assert.ok(filteredNodes.some(node => node.kind === "TextComment" && node.text.includes("source-owned")), "Retain comments");
  // Headers included after source declarations are outside the preamble and
  // are dumped normally; no custom AST filtering is applied.
  for (const name of ["NamespaceHeaderOnly", "linkage_header_only"])
    assert.ok(filteredNodes.some(node => node.name === name), `Retain post-preamble header ${name}`);
  write("/work/src/empty.cpp", "#include <wasm.hpp>\n");
  succeeds(["-o", "/results/filtered", "/work/src/empty.cpp"]);
  const empty = JSON.parse(FS.readFile("/results/filtered/empty.json", { encoding: "utf8" }));
  assert.equal(empty.kind, "TranslationUnitDecl");
  assert.equal(empty.inner?.length || 0, 0, "A header-only input must emit a valid empty translation unit");
  console.log("PASS: PCH-based ASTs preserve bodies, types, comments, macros, #line, and namespace/linkage wrappers");

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

  write("/work/batch.hpp", `
#pragma once
inline int header_answer() { return BATCH_VALUE; }
`);
  write("/work/src/batch_first.cpp", `
#define BATCH_VALUE 20
#include <batch.hpp>
extern "C" int batch_first() { return header_answer(); }
#define SOURCE_ONLY_MACRO 1
`);
  write("/work/src/batch_second.cpp", `
#define BATCH_VALUE 22
#include <batch.hpp>
extern "C" int batch_second() { return header_answer(); }
#ifdef SOURCE_ONLY_MACRO
#error Macros must not leak between batch inputs
#endif
`);
  write("/work/src/batch_empty.cpp", `
extern "C" int batch_empty() { return 7; }
#if defined(BATCH_VALUE) || defined(SOURCE_ONLY_MACRO)
#error An empty preamble must not inherit another input's macros
#endif
`);
  const batchStems = ["batch_first", "batch_second", "batch_empty"];
  succeeds(["-o", "/results/batch", ...batchStems.map(stem => `/work/src/${stem}.cpp`)]);
  const batchDir = fs.mkdtempSync(path.join(os.tmpdir(), "wasm-clang-batch-"));
  try {
    const objects = batchStems.map(stem => {
      const ast = JSON.parse(FS.readFile(`/results/batch/${stem}.json`, { encoding: "utf8" }));
      assert.ok(descendants(ast).some(node => node.kind === "FunctionDecl" && node.name === stem));
      const object = path.join(batchDir, `${stem}.o`);
      fs.writeFileSync(object, checkObject(`/results/batch/${stem}.o`));
      return object;
    });
    const wasm = path.join(batchDir, "batch.wasm");
    execFileSync(path.join(workerData.hostBinDir, "wasm-ld"), [
      "--no-entry", ...batchStems.map(stem => `--export=${stem}`), ...objects, "-o", wasm,
    ]);
    const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasm));
    assert.equal(instance.exports.batch_first(), 20);
    assert.equal(instance.exports.batch_second(), 22);
    assert.equal(instance.exports.batch_empty(), 7);
    assert.ok(!exists("/__clang_pch"), "In-memory PCHs must not remain in the module filesystem");
    console.log("PASS: frontend batches preserve distinct PCHs and isolate macros for all JSON/object outputs");
  } finally {
    fs.rmSync(batchDir, { recursive: true, force: true });
  }

  write("/work/src/runtime.cpp", `
#include <browser.hpp>
#include <wasm.hpp>
static volatile int initialized;
struct Initialize { Initialize() { initialized = initialized + 1; } };
static Initialize initialize;
extern "C" BROWSER_EXPORT(runtime_check) int runtime_check() {
  if (initialized != 1) return 2;
  auto *values = new int[2]{20, 22};
  int result = values[0] + values[1];
  delete[] values;
  browser::print("custom compiler TLSF\\n");
  return result == 42 ? 0 : 1;
}
`);
  succeeds(["-o", "/results/runtime", "/work/src/runtime.cpp"]);
  const runtimeDir = fs.mkdtempSync(path.join(os.tmpdir(), "wasm-clang-runtime-"));
  try {
    const object = path.join(runtimeDir, "runtime.o");
    const wasm = path.join(runtimeDir, "runtime.wasm");
    fs.writeFileSync(object, checkObject("/results/runtime/runtime.o"));
    execFileSync(path.join(workerData.hostBinDir, "wasm-ld"), [
      "--no-entry", "--export=wasm_initialize", "--export-memory", object,
      `-L${workerData.sysrootDir}/lib`,
      `-L${workerData.sysrootDir}/lib/clang/23/lib/wasi`,
      "-lbrowser", "-lclang_rt.builtins-wasm32", "-o", wasm,
    ]);
    let output = "";
    const { instance } = await WebAssembly.instantiate(fs.readFileSync(wasm), {
      env: { js_print_char: character => { output += String.fromCharCode(character); } },
    });
    assert.equal(instance.exports.wasm_initialize(), undefined);
    assert.equal(output, "", "Initialization must not call application exports");
    assert.equal(instance.exports.runtime_check(), 0);
    assert.equal(output, "custom compiler TLSF\n");
    instance.exports.wasm_initialize();
    assert.equal(instance.exports.runtime_check(), 0, "Repeated initialization must preserve application state");
    console.log("PASS: PCH code generation links and executes with TLSF and the freestanding runtime");
  } finally {
    fs.rmSync(runtimeDir, { recursive: true, force: true });
  }

  succeeds(["-I/headers first", "-I/headers second", "-o", "/results/objects", ...sources]);
  for (const stem of ["answer", "helper"]) {
    checkObject(`/results/objects/${stem}.o`);
    assert.ok(exists(`/results/objects/${stem}.json`), "Always emit JSON files");
  }
  succeeds(["-o", "/results/alias", "/work/src/helper.cpp"]);
  checkObject("/results/alias/helper.o");
  succeeds(["/work/src/helper.cpp"]);
  checkObject("/work/helper.o");
  write("/work/-dash.cpp", "int dash() { return 1; }\n");
  succeeds(["--", "-dash.cpp"]);
  checkObject("/work/-dash.o");
  console.log("PASS: include/output option forms, implicit object compilation, default output directory, and --");

  write("/work/src/bad-header.cpp", '#include <missing_header.hpp>\nint bad_header();\n');
  fails(["-o", "/results/failed-pch", "/work/src/helper.cpp", "/work/src/bad-header.cpp"], /file not found/);
  assert.ok(!exists("/results/failed-pch/helper.json"), "All PCHs must finish before JSON emission");
  assert.ok(!exists("/results/failed-pch/helper.o"));
  write("/work/src/broken.cpp", "int broken( {\n");
  fails(["-o", "/results/failed", "/work/src/helper.cpp", "/work/src/broken.cpp"], /error:/);
  assert.ok(exists("/results/failed/helper.json"), "First AST must have finished");
  assert.ok(!exists("/results/failed/helper.o"), "Do not start object generation before all ASTs succeed");
  assert.ok(!exists("/results/failed/broken.o"));
  assert.ok(!exists("/results/failed/broken.json"), "Remove incomplete AST on parse errors");
  fails(["-o", "/results/stopped-batch", "/work/src/helper.cpp", "/work/src/broken.cpp", "/work/src/batch_empty.cpp"], /error:/);
  assert.ok(exists("/results/stopped-batch/helper.json"));
  assert.ok(!exists("/results/stopped-batch/batch_empty.json"), "Stop the frontend batch after a failed input");
  assert.ok(!exists("/results/stopped-batch/helper.o"), "A failed JSON batch must not start object compilation");
  fails(["-o", "/results/failed-object", "/work/src/broken.cpp"], /error:/);
  assert.ok(!exists("/results/failed-object/broken.o"), "Remove incomplete object on parse errors");
  fails(["/missing.cpp"], /no such file/);
  fails(["/work/src/answer.cpp"], /'first.hpp' file not found/);
  console.log("PASS: all ASTs precede objects; parse errors and missing headers/files fail cleanly");

  write("/work/other/helper.cpp", "int other() { return 2; }\n");
  fails(["-o", "/results/collision", "/work/src/helper.cpp", "/work/other/helper.cpp"], /same output/);
  assert.ok(!exists("/results/collision"), "Reject colliding output names before writing");
  write("/work/source.json", "int source() { return 1; }\n");
  fails(["/work/source.json"], /overwrite input/);
  assert.equal(FS.readFile("/work/source.json", { encoding: "utf8" }), "int source() { return 1; }\n");
  for (const args of [["-I"], ["-o"]])
    fails(args, /missing value/);
  fails(["--include-dir", "/headers first", "/work/src/helper.cpp"], /unsupported option/);
  fails(["--include-dir=/headers first", "/work/src/helper.cpp"], /unsupported option/);
  fails([], /no input files/);
  fails(["-dump", "/work/src/helper.cpp"], /unsupported option/);
  fails(["--output-dir", "/results", "/work/src/helper.cpp"], /unsupported option/);
  fails(["--output-dir=/results", "/work/src/helper.cpp"], /unsupported option/);
  fails(["-O0", "/work/src/helper.cpp"], /unsupported option/);
  write("/results/regular-file", "not a directory");
  fails(["-o", "/results/regular-file", "/work/src/helper.cpp"], /cannot create output directory|Not a directory/);
  assert.equal(FS.readFile("/results/regular-file", { encoding: "utf8" }), "not a directory");
  const help = succeeds(["--help"]).stdout;
  assert.match(help, /-o <dir>/);
  assert.match(help, /-ffreestanding/);
  assert.doesNotMatch(help, /-dump|--output-dir|--include-dir/);
  assert.match(succeeds(["--version"]).stdout, /Custom browser Clang/);
  console.log("PASS: output collisions, invalid options, output errors, help, version, and repeated invocations");
  parentPort.postMessage({ status: 0 });
}
