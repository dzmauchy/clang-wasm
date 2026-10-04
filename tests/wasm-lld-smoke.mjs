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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "wasm-lld-smoke-"));

  async function link(args, files = []) {
    const worker = new Worker(new URL(import.meta.url), {
      workerData: {
        moduleUrl: pathToFileURL(path.join(moduleDir, "lld.js")).href,
        wasmPath: path.join(moduleDir, "lld.wasm"),
        args,
        files,
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
