// Smoke test for the arm8 (thumbv8m.main-none-eabihf) browser toolchain:
// clang.js compiles a source to an ELF object, then lld.js links it.
//   node tests/arm8-smoke.mjs [distDir] [sysrootDir]
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

const EM_ARM = 40;
const BUILTINS = "lib/clang/23/lib/baremetal/libclang_rt.builtins-armv8m.main.a";

function mount(FS, sourceDir, destDir) {
  for (const entry of fs.readdirSync(sourceDir, { withFileTypes: true })) {
    const source = path.join(sourceDir, entry.name);
    const dest = path.posix.join(destDir, entry.name);
    if (entry.isDirectory()) mount(FS, source, dest);
    else {
      FS.mkdirTree(path.posix.dirname(dest));
      FS.writeFile(dest, fs.readFileSync(source));
    }
  }
}

if (!isMainThread) {
  // Browser-worker globals; instantiateWasm avoids network loading.
  globalThis.self = globalThis;
  globalThis.WorkerGlobalScope = class {};
  const { default: createModule } = await import(pathToFileURL(path.join(workerData.dist, `${workerData.tool}.js`)));
  const output = [];
  const module = await createModule({
    instantiateWasm(imports, receive) {
      const instance = new WebAssembly.Instance(
        new WebAssembly.Module(fs.readFileSync(path.join(workerData.dist, `${workerData.tool}.wasm`))), imports);
      receive(instance);
      return instance.exports;
    },
    noInitialRun: true,
    print: (line) => output.push(line),
    printErr: (line) => output.push(line),
  });
  const { FS } = module;
  for (const [from, to] of workerData.mounts) mount(FS, from, to);
  for (const [name, bytes] of workerData.files) {
    FS.mkdirTree(path.posix.dirname(name));
    FS.writeFile(name, bytes);
  }
  FS.mkdirTree("/work");
  FS.chdir("/work");
  const status = module.callMain(workerData.args);
  const result = workerData.result && FS.analyzePath(workerData.result).exists ? FS.readFile(workerData.result) : null;
  parentPort.postMessage({ status, output: output.join("\n"), result });
} else {
  const rootDir = path.resolve(import.meta.dirname, "..");
  const dist = path.resolve(process.argv[2] || path.join(rootDir, "dist", "arm8"));
  const sysroot = path.resolve(process.argv[3] || path.join(dist, "sysroot"));

  async function invoke(options) {
    const worker = new Worker(new URL(import.meta.url), { workerData: { dist, files: [], mounts: [], ...options } });
    try {
      return await new Promise((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", (status) => reject(new Error(`${options.tool} worker exited early (${status})`)));
      });
    } finally {
      await worker.terminate();
    }
  }

  const source = `
#include <stdint.h>
#if !defined(__thumb__) || !defined(__ARM_ARCH_8M_MAIN__) || !defined(__ARM_PCS_VFP)
#error Expected thumbv8m.main hard-float
#endif
extern "C" uint32_t add(uint32_t a, uint32_t b) { return a + b; }
extern "C" float scale(float v) { return v * 2.0f; }
extern "C" uint64_t divide(uint64_t a, uint64_t b) { return a / b; }
`;
  const compiled = await invoke({
    tool: "clang",
    args: ["-o", "/out", "/work/main.cpp"],
    mounts: [[path.join(sysroot, "lib/clang/23/include"), "/sysroot/lib/clang/23/include"]],
    files: [["/work/main.cpp", source]],
    result: "/out/main.o",
  });
  assert.equal(compiled.status, 0, compiled.output);
  const bytes = Buffer.from(compiled.result);
  assert.deepEqual([...bytes.subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46], "object must be ELF");
  assert.equal(bytes.readUInt16LE(18), EM_ARM, "object must target Arm");
  console.log("PASS: clang.js emits an Arm ELF object");

  const linked = await invoke({
    tool: "lld",
    args: ["-e", "divide", "--gc-sections", "/input.o", "-o", "/result.elf"],
    files: [["/input.o", bytes], [`/sysroot/${BUILTINS}`, fs.readFileSync(path.join(sysroot, BUILTINS))]],
    result: "/result.elf",
  });
  assert.equal(linked.status, 0, linked.output);
  const elf = Buffer.from(linked.result);
  assert.deepEqual([...elf.subarray(0, 4)], [0x7f, 0x45, 0x4c, 0x46], "output must be ELF");
  assert.equal(elf.readUInt16LE(18), EM_ARM, "output must target Arm");
  console.log("PASS: lld.js links Arm ELF with default compiler-rt builtins");
}
