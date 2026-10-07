import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

if (!isMainThread) {
  // Supply browser-worker globals while loading the worker-only Emscripten
  // wrapper in Node. instantiateWasm avoids browser network loading.
  globalThis.self = globalThis;
  globalThis.WorkerGlobalScope = class {};
  const { default: createModule } = await import(workerData.moduleUrl);
  const output = [];
  const module = await createModule({
    instantiateWasm(imports, receiveInstance) {
      const wasm = new WebAssembly.Module(fs.readFileSync(workerData.wasmPath));
      const instance = new WebAssembly.Instance(wasm, imports);
      receiveInstance(instance);
      return instance.exports;
    },
    noInitialRun: true,
    print: (line) => output.push(line),
    printErr: (line) => output.push(line),
  });
  for (const [name, bytes] of workerData.files) {
    module.FS.mkdirTree(path.posix.dirname(name));
    module.FS.writeFile(name, bytes);
  }
  const status = module.callMain(workerData.args);
  const wasm = status === 0 && module.FS.analyzePath("/result.wasm").exists
    ? module.FS.readFile("/result.wasm")
    : null;
  parentPort.postMessage({ status, output: output.join("\n"), wasm });
} else {
  const rootDir = fileURLToPath(new URL("../", import.meta.url));
  const moduleDir = path.resolve(process.argv[2] || path.join(rootDir, "dist"));
  const hostBinDir = path.join(process.env.HOST_LLVM_DIR || path.join(rootDir, "out/llvm"), "bin");
  const sysrootDir = path.resolve(process.argv[3] || path.join(rootDir, "dist/sysroot"));
  const builtinsPath = "lib/clang/23/lib/wasi/libclang_rt.builtins-wasm32.a";
  const builtins = fs.readFileSync(path.join(sysrootDir, builtinsPath));
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wasm-lld-smoke-"));

  async function link(args, files = []) {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: {
        moduleUrl: pathToFileURL(path.join(moduleDir, "lld.js")).href,
        wasmPath: path.join(moduleDir, "lld.wasm"),
        args,
        files: [[`/sysroot/${builtinsPath}`, builtins], ...files],
      },
    });
    try {
      return await new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", (status) => reject(new Error(`LLD worker exited before reporting a result (${status})`)));
      });
    } finally {
      await worker.terminate();
    }
  }

  try {
    const source = path.join(tempDir, "answer.c");
    fs.writeFileSync(source, "int answer(void) { return 42; }\n");
    const objects = [];
    for (const [name, target, flags] of [
      ["wasm", "wasm32-unknown-unknown", []],
      ["bitcode", "wasm32-unknown-unknown", ["-flto"]],
      ["elf", "x86_64-unknown-linux-gnu", []],
      ["coff", "x86_64-pc-windows-msvc", []],
      ["macho", "x86_64-apple-darwin", []],
    ]) {
      const object = path.join(tempDir, `${name}.o`);
      execFileSync(path.join(hostBinDir, "clang"), [
        `--target=${target}`, "-c", "-O2", ...flags, source, "-o", object,
      ]);
      objects.push([name, fs.readFileSync(object)]);
    }

    for (const name of ["wasm", "bitcode"]) {
      const bytes = objects.find(([kind]) => kind === name)[1];
      const result = await link([
        "--no-entry", "--export=answer", "/input.o", "-o", "/result.wasm",
      ], [["/input.o", bytes]]);
      assert.equal(result.status, 0, result.output);
      const { instance } = await WebAssembly.instantiate(result.wasm);
      assert.equal(instance.exports.answer(), 42);
      console.log(`PASS: links ${name} input and executes its export`);
    }

    const runtimeSource = path.join(tempDir, "runtime.cpp");
    const runtimeObject = path.join(tempDir, "runtime.o");
    fs.writeFileSync(runtimeSource, `
#include <wasm.hpp>
static volatile int initialized;
struct Initialize { Initialize() { initialized = initialized + 1; } };
static Initialize initialize;
extern "C" int constructor_count() { return initialized; }
extern "C" int runtime_check() {
  volatile int *values = new int[2]{20, 22};
  int result = values[0] + values[1];
  delete[] values;
  return result;
}
__attribute__((noinline)) static unsigned __int128 divide_wide(unsigned __int128 a, unsigned __int128 b) { return a / b; }
extern "C" unsigned long long divide_check(unsigned long long low, unsigned long long high, unsigned long long divisor) {
  return (unsigned long long)divide_wide(((unsigned __int128)high << 64) | low, divisor);
}
`);
    execFileSync(path.join(hostBinDir, "clang++"), [
      "--target=wasm32-unknown-unknown", "-std=c++23", "-O2", "-ffreestanding",
      "-nostdinc++", "-fno-exceptions", "-fno-rtti", "-fno-threadsafe-statics",
      `--sysroot=${sysrootDir}`, `-resource-dir=${sysrootDir}/lib/clang/23`,
      "-c", runtimeSource, "-o", runtimeObject,
    ]);
    const runtimeArgs = [
      "--no-entry", "--export=wasm_initialize", "--export=constructor_count",
      "--export=runtime_check", "--export=divide_check", "/runtime.o", "-o", "/result.wasm",
    ];
    const runtime = await link(runtimeArgs, [["/runtime.o", fs.readFileSync(runtimeObject)]]);
    assert.equal(runtime.status, 0, runtime.output);
    const runtimeModule = await WebAssembly.compile(runtime.wasm);
    assert.deepEqual(WebAssembly.Module.imports(runtimeModule), []);
    const runtimeInstance = await WebAssembly.instantiate(runtimeModule);
    assert.equal(runtimeInstance.exports.constructor_count(), 0);
    runtimeInstance.exports.wasm_initialize();
    assert.equal(runtimeInstance.exports.constructor_count(), 1);
    assert.equal(runtimeInstance.exports.runtime_check(), 42);
    runtimeInstance.exports.wasm_initialize();
    assert.equal(runtimeInstance.exports.constructor_count(), 1);
    assert.equal(runtimeInstance.exports.divide_check(100n, 1n, 3n), ((1n << 64n) + 100n) / 3n);
    console.log("PASS: default builtins supply arithmetic, TLSF, new/delete, and explicit constructors without host imports");

    const override = await link(["-L/alternate", ...runtimeArgs], [
      ["/runtime.o", fs.readFileSync(runtimeObject)],
      ["/alternate/libclang_rt.builtins-wasm32.a", builtins],
      [`/sysroot/${builtinsPath}`, new Uint8Array()],
    ]);
    assert.equal(override.status, 0, override.output);
    const overrideInstance = await WebAssembly.instantiate(override.wasm);
    overrideInstance.instance.exports.wasm_initialize();
    assert.equal(overrideInstance.instance.exports.runtime_check(), 42);
    console.log("PASS: user library paths take precedence over the default sysroot path");

    const version = await link(["-flavor", "wasm", "--version"]);
    assert.equal(version.status, 0, version.output);
    assert.match(version.output, /LLD/);
    console.log("PASS: accepts explicit Wasm flavor");

    for (const [name, args] of [
      ["ELF", ["-flavor", "gnu"]],
      ["Mach-O", ["-flavor", "darwin"]],
      ["COFF", ["-flavor", "link"]],
      ["MinGW", ["-flavor", "gnu", "-m", "i386pe"]],
    ]) {
      const result = await link([...args, "--version"]);
      assert.notEqual(result.status, 0, `Unexpected ${name} driver`);
      console.log(`PASS: excludes ${name} driver`);
    }

    for (const name of ["elf", "coff", "macho"]) {
      const bytes = objects.find(([kind]) => kind === name)[1];
      const result = await link([
        "--no-entry", "/input.o", "-o", "/result.wasm",
      ], [["/input.o", bytes]]);
      assert.notEqual(result.status, 0, `Unexpected support for ${name} input`);
      assert.match(result.output, /unknown file type/);
      console.log(`PASS: rejects ${name} object files`);
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}
