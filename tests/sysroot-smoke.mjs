import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [compiler, stagedSysroot, outputDir, resourceVersion] = process.argv.slice(2);
fs.mkdirSync(outputDir, { recursive: true });
const archive = path.join(path.dirname(stagedSysroot), "sysroot.tgz");
const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
for (const entry of ["include/browser.hpp", "include/browser_config.h",
  "include/c++/v1/vector", "include/c++/v1/__config_site", "include/c++/v1/cxxabi.h",
  "include/stdio.h", "lib/wasm32-unknown-unknown/libc.a", "lib/wasm32-unknown-unknown/libm.a",
  "lib/libc++.a", "lib/libc++abi.a", "lib/libbrowser.a",
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
assert.ok(entries.includes("sysroot/include/llvm-libc-types/FILE.h"), "Archive must use LLVM libc headers");
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
  "-fno-exceptions", "-fno-rtti", "-stdlib=libc++", "-nostdlib",
  `--sysroot=${sysroot}`, `-resource-dir=${sysroot}/lib/clang/${resourceVersion}`,
];
const linkFlags = [
  `-L${sysroot}/lib`, `-L${sysroot}/lib/wasm32-unknown-unknown`,
  `-L${sysroot}/lib/clang/${resourceVersion}/lib/wasi`, "-lbrowser", "-lc++", "-lc++abi", "-lc", "-lm", "-lclang_rt.builtins-wasm32",
  "-Wl,--no-entry", "-Wl,--export=browser_run", "-Wl,--export-memory",
  `-Wl,--max-memory=${maximumMemory}`,
];
execFileSync(compiler, [...flags,
  path.join(import.meta.dirname, "sysroot-smoke.cpp"), wideSource,
  ...linkFlags, "-o", wasm], { stdio: "inherit" });
const module = await WebAssembly.compile(fs.readFileSync(wasm));
const imports = WebAssembly.Module.imports(module);
assert.deepEqual(imports.map(({ module, name }) => `${module}.${name}`).sort(), ["env.js_now", "env.js_print_char", "env.js_time"]);
let output = "";
let utcMilliseconds = 1234567890123;
const instance = await WebAssembly.instantiate(module, { env: {
  js_print_char: character => { output += String.fromCharCode(character); },
  js_now: () => 123.5,
  js_time: () => utcMilliseconds,
} });
const initialMemory = instance.exports.memory.buffer.byteLength;
assert.equal(instance.exports.browser_run(), 0, "C++20, constructors, math, formatting, and builtins must work");
assert.equal(output, "libc++=14 math=0.479\nbrowser import\n");
assert.equal(instance.exports.cpp_checks(), 0, "Containers, format, charconv, smart pointers, callbacks, aligned new, and PMR must work");
assert.equal(instance.exports.cpp_checks(), 0, "Single-threaded ABI guards must initialize static locals once");
assert.equal(instance.exports.utc_milliseconds(), utcMilliseconds, "system_clock must use Unix time");
utcMilliseconds = -500;
assert.equal(instance.exports.utc_milliseconds(), -500, "Dates before the epoch must normalize nanoseconds");
assert.equal(instance.exports.heap_checks(), 0, "LLVM allocation, exhaustion, realloc, calloc, and errno must work");
assert.ok(instance.exports.memory.buffer.byteLength > initialMemory);
assert.equal(instance.exports.browser_run(), 0, "Calling exports must not repeat static initialization");
const secondInstance = await WebAssembly.instantiate(module, { env: { js_print_char() {}, js_now: () => 123.5, js_time: () => 0 } });
assert.equal(secondInstance.exports.browser_run(), 0, "Each instance initializes its own static objects");
assert.throws(() => secondInstance.exports.cpp_allocation_failure(), WebAssembly.RuntimeError,
  "Ordinary operator new must trap on allocation failure when exceptions are disabled");

// A memory limit equal to the initial size prevents reserving the heap.
const limitedWasm = path.join(outputDir, "limited.wasm");
execFileSync(compiler, [...flags,
  path.join(import.meta.dirname, "sysroot-smoke.cpp"), wideSource,
  ...linkFlags.filter(flag => !flag.startsWith("-Wl,--max-memory=")),
  `-Wl,--max-memory=${initialMemory}`, "-o", limitedWasm], { stdio: "inherit" });
const limitedInstance = await WebAssembly.instantiate(fs.readFileSync(limitedWasm), {
  env: { js_print_char() {}, js_now: () => 123.5, js_time: () => 0 },
});
assert.equal(limitedInstance.instance.exports.browser_run(), 0);
assert.equal(limitedInstance.instance.exports.heap_failure_checks(), 0,
  "Failed memory growth must return null with ENOMEM");
assert.equal(limitedInstance.instance.exports.heap_failure_checks(), 0,
  "A failed reservation must leave the allocator ready to retry");
assert.equal(limitedInstance.instance.exports.memory.buffer.byteLength, initialMemory);

const argcSource = path.join(outputDir, "argc.cpp");
const argcWasm = path.join(outputDir, "argc.wasm");
fs.writeFileSync(argcSource, '#include <stdio.h>\nint main(int argc, char** argv) { puts("argc main"); return argc == 0 && argv && argv[argc] == nullptr ? 0 : 1; }\n');
execFileSync(compiler, [...flags, argcSource, ...linkFlags, "-o", argcWasm], { stdio: "inherit" });
let argcOutput = "";
const argcInstance = await WebAssembly.instantiate(fs.readFileSync(argcWasm), { env: {
  js_print_char: character => { argcOutput += String.fromCharCode(character); },
} });
assert.equal(argcInstance.instance.exports.browser_run(), 0, "main(argc, argv) must use the correct Wasm ABI");
assert.equal(argcOutput, "argc main\n");
console.log("Sysroot smoke test passed: LLVM libc, libc++, libc++abi, browser imports, builtins, constructors, and allocation failures.");
