import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [compiler, stagedSysroot, outputDir, resourceVersion] = process.argv.slice(2);
fs.mkdirSync(outputDir, { recursive: true });
const archive = path.join(path.dirname(stagedSysroot), "sysroot.tgz");
const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
for (const entry of ["include/browser.hpp", "include/browser_config.h",
  "include/wasm.h", "include/wasm.hpp", "include/tlsf.h",
  "lib/libwasm.a", "lib/libtlsf.a", "lib/libbrowser.a", "share/licenses/TLSF-LICENSE.txt",
  `lib/clang/${resourceVersion}/lib/wasi/libclang_rt.builtins-wasm32.a`,
  `lib/clang/${resourceVersion}/include/stddef.h`,
  `lib/clang/${resourceVersion}/include/wasm_simd128.h`,
  "share/licenses/LLVM-LICENSE.TXT"]) {
  assert.ok(entries.includes(`sysroot/${entry}`), `Archive must include ${entry}`);
}
assert.ok(entries.every(entry => entry.startsWith("sysroot/")));
assert.ok(entries.every(entry => !entry.includes("wasm32-emscripten") && !entry.includes("/etl/") && !entry.includes("etl_profile.h") && !entry.includes("ETL-LICENSE")));
assert.ok(entries.every(entry => !entry.toLowerCase().includes("picolibc")));
const resourcePrefix = `sysroot/lib/clang/${resourceVersion}/include/`;
for (const header of ["cuda_wrappers/", "__clang_cuda_math.h", "__clang_hip_math.h", "opencl-c.h",
  "hlsl.h", "hlsl/", "openmp_wrappers/", "immintrin.h", "arm_neon.h", "riscv_vector.h"]) {
  assert.ok(!entries.some(entry => entry.startsWith(`${resourcePrefix}${header}`)),
    `Archive must exclude non-Wasm resource header ${header}`);
}
assert.ok(entries.every(entry => !/libc\+\+|libc\.a|libm\.a|llvm-libc|include\/c\+\+/.test(entry)), "Exclude libc and the C++ libraries");
const extracted = path.join(outputDir, "extracted");
fs.rmSync(extracted, { recursive: true, force: true });
fs.mkdirSync(extracted);
execFileSync("tar", ["-xzf", archive, "-C", extracted]);
const sysroot = path.join(extracted, "sysroot");
const heapSize = Number(fs.readFileSync(path.join(sysroot, "include/browser_config.h"), "utf8")
  .match(/#define BROWSER_HEAP_SIZE (\d+)/)[1]);
const maximumMemory = Math.ceil((heapSize + 2 * 1024 * 1024) / 65536) * 65536;
// A separate translation unit prevents optimizing away compiler-rt division.
const wideSource = path.join(outputDir, "wide.cpp");
fs.writeFileSync(wideSource, 'extern "C" unsigned __int128 divide_wide(unsigned __int128 a, unsigned __int128 b) { return a / b; }\n');
const wasm = path.join(outputDir, "smoke.wasm");
const flags = [
  "--target=wasm32-unknown-unknown", "-std=c++20", "-O2",
  "-fno-exceptions", "-fno-rtti", "-fno-threadsafe-statics", "-ffreestanding", "-nostdinc++", "-nostdlib",
  `--sysroot=${sysroot}`, `-resource-dir=${sysroot}/lib/clang/${resourceVersion}`,
];
const linkFlags = [
  `-L${sysroot}/lib`,
  `-L${sysroot}/lib/clang/${resourceVersion}/lib/wasi`, "-lbrowser", "-lclang_rt.builtins-wasm32",
  "-Wl,--no-entry", "-Wl,--export=wasm_initialize", "-Wl,--export-memory",
  `-Wl,--max-memory=${maximumMemory}`,
];
execFileSync(compiler, [...flags,
  path.join(import.meta.dirname, "sysroot-smoke.cpp"), wideSource,
  ...linkFlags, "-o", wasm], { stdio: "inherit" });
const module = await WebAssembly.compile(fs.readFileSync(wasm));
const imports = WebAssembly.Module.imports(module);
assert.deepEqual(imports.map(({ module, name }) => `${module}.${name}`).sort(), ["env.js_now", "env.js_print_char", "env.js_time"]);
let output = "";
const utcMilliseconds = 1234567890123;
const instance = await WebAssembly.instantiate(module, { env: {
  js_print_char: character => { output += String.fromCharCode(character); },
  js_now: () => 123.5,
  js_time: () => utcMilliseconds,
} });
const initialMemory = instance.exports.memory.buffer.byteLength;
assert.equal(instance.exports.constructor_count(), 0, "Constructors must wait for explicit initialization");
assert.equal(instance.exports.wasm_initialize(), undefined);
assert.equal(instance.exports.constructor_count(), 1);
assert.equal(output, "", "Initialization must not invoke application code");
assert.equal(instance.exports.runtime_checks(), 0, "Freestanding C++, console output, and builtins must work");
assert.equal(output, "TLSF runtime OK\n");
assert.equal(instance.exports.cpp_checks(), 0, "New/delete, aligned and placement new must work");
assert.equal(instance.exports.cpp_checks(), 0, "Single-threaded ABI guards must initialize static locals once");
assert.equal(instance.exports.heap_checks(), 0, "TLSF allocation, exhaustion, realloc, calloc, and errno must work");
assert.ok(instance.exports.memory.buffer.byteLength > initialMemory);
instance.exports.wasm_initialize();
assert.equal(instance.exports.constructor_count(), 1, "Repeated initialization must not rerun constructors");
assert.equal(instance.exports.runtime_checks(), 0, "Calling exports must preserve initialized state");
const secondInstance = await WebAssembly.instantiate(module, { env: { js_print_char() {}, js_now: () => 123.5, js_time: () => 1234567890123 } });
assert.equal(secondInstance.exports.constructor_count(), 0);
secondInstance.exports.wasm_initialize();
assert.equal(secondInstance.exports.runtime_checks(), 0, "Each instance initializes its own static objects");
assert.throws(() => secondInstance.exports.cpp_allocation_failure(), WebAssembly.RuntimeError,
  "Ordinary operator new must trap on allocation failure when exceptions are disabled");

// A memory limit equal to the initial size prevents reserving the heap.
const limitedWasm = path.join(outputDir, "limited.wasm");
execFileSync(compiler, [...flags,
  path.join(import.meta.dirname, "sysroot-smoke.cpp"), wideSource,
  ...linkFlags.filter(flag => !flag.startsWith("-Wl,--max-memory=")),
  `-Wl,--max-memory=${initialMemory}`, "-o", limitedWasm], { stdio: "inherit" });
const limitedInstance = await WebAssembly.instantiate(fs.readFileSync(limitedWasm), {
  env: { js_print_char() {}, js_now: () => 123.5, js_time: () => 1234567890123 },
});
limitedInstance.instance.exports.wasm_initialize();
assert.equal(limitedInstance.instance.exports.runtime_checks(), 0);
assert.equal(limitedInstance.instance.exports.heap_failure_checks(), 0,
  "Failed memory growth must return null with ENOMEM");
assert.equal(limitedInstance.instance.exports.heap_failure_checks(), 0,
  "A failed reservation must leave the allocator ready to retry");
assert.equal(limitedInstance.instance.exports.memory.buffer.byteLength, initialMemory);

// Initialization alone needs no application entry function or console imports.
const initSource = path.join(outputDir, "initialize.cpp");
const initWasm = path.join(outputDir, "initialize.wasm");
fs.writeFileSync(initSource, `
#include <wasm.hpp>
static volatile int count;
struct Initialize { Initialize() { count = count + 1; } };
static Initialize initialize;
extern "C" __attribute__((export_name("count"))) int constructor_count() { return count; }
`);
execFileSync(compiler, [...flags, initSource,
  ...linkFlags.filter(flag => flag !== "-lbrowser"), "-o", initWasm], { stdio: "inherit" });
const initModule = await WebAssembly.compile(fs.readFileSync(initWasm));
assert.deepEqual(WebAssembly.Module.imports(initModule), [], "Initializer must be host-independent");
assert.deepEqual(WebAssembly.Module.exports(initModule).map(({ name }) => name).sort(),
  ["count", "memory", "wasm_initialize"], "Runtime must export only its constructor initializer");
const initInstance = await WebAssembly.instantiate(initModule);
assert.equal(initInstance.exports.count(), 0);
assert.equal(initInstance.exports.wasm_initialize(), undefined);
assert.equal(initInstance.exports.count(), 1);
initInstance.exports.wasm_initialize();
assert.equal(initInstance.exports.count(), 1, "Constructors must run exactly once per instance");
console.log("Sysroot smoke test passed: TLSF, freestanding C++, browser imports, builtins, constructors, and allocation failures.");
