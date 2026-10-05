import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const [compiler, distDir, buildDir, wamrDir, jobs] = process.argv.slice(2);
const projectRoot = path.resolve(import.meta.dirname, "..");
const outputDir = path.join(buildDir, "smoke");
fs.mkdirSync(outputDir, { recursive: true });
const archive = path.join(distDir, "wamrsr.tgz");
const entries = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).trim().split("\n");
assert.ok(entries.every(entry => entry.startsWith("wamrsr/")));
for (const file of ["include/wamr.h", "include/wamr.hpp", "include/c++/v1/memory_resource",
  "lib/libwamr.a", "lib/libc++.a", "lib/libc++abi.a", "lib/wasm32-unknown-unknown/libc.a",
  "share/wamr/wamr-host.c", "share/wamr/wamr-host.h", "share/wamr/README.md"]) {
  assert.ok(entries.includes(`wamrsr/${file}`), `Missing packaged ${file}`);
}
assert.ok(!entries.includes("wamrsr/lib/libbrowser.a"));
const extracted = path.join(outputDir, "extracted");
fs.rmSync(extracted, { recursive: true, force: true });
fs.mkdirSync(extracted);
execFileSync("tar", ["-xzf", archive, "-C", extracted]);
const sysroot = path.join(extracted, "wamrsr");
const resources = fs.readdirSync(path.join(sysroot, "lib", "clang"));
assert.equal(resources.length, 1);
const resourceDir = path.join(sysroot, "lib", "clang", resources[0]);
const wasm = path.join(outputDir, "smoke.wasm");
execFileSync(compiler, ["--target=wasm32-unknown-unknown", "-std=c++23", "-O2",
  "-fno-exceptions", "-fno-rtti", "-stdlib=libc++", "-nostdlib", `--sysroot=${sysroot}`,
  `-resource-dir=${resourceDir}`, path.join(projectRoot, "tests", "wamr-sysroot-smoke.cpp"),
  `-L${sysroot}/lib`, `-L${sysroot}/lib/wasm32-unknown-unknown`, `-L${resourceDir}/lib/wasi`,
  "-lwamr", "-lc++", "-lc++abi", "-lc", "-lm", "-lclang_rt.builtins-wasm32",
  "-Wl,--no-entry", "-Wl,--export=wamr_run", "-Wl,--export-memory",
  "-Wl,--export=__heap_base", "-Wl,--export=__data_end", "-Wl,-z,stack-size=16384", "-o", wasm], { stdio: "inherit" });
const module = await WebAssembly.compile(fs.readFileSync(wasm));
assert.deepEqual(WebAssembly.Module.imports(module).map(({ module, name }) => `${module}.${name}`).sort(),
  ["env.wamr_heap_alloc", "env.wamr_heap_free", "env.wamr_now", "env.wamr_print_char", "env.wamr_time"]);
assert.ok(WebAssembly.Module.exports(module).every(({ name }) => name !== "malloc" && name !== "free"));
const nativeBuild = path.join(outputDir, "host");
// WAMR is native host code: don't inherit the cross compiler from the sysroot.
const env = { ...process.env };
for (const key of ["CC", "CXX", "LD"]) delete env[key];
execFileSync("cmake", ["-G", "Ninja", "-S", path.join(projectRoot, "tests", "wamr-host"),
  "-B", nativeBuild, `-DWAMR_ROOT_DIR=${wamrDir}`,
  `-DWAMR_ADAPTER_DIR=${sysroot}/share/wamr`, "-DCMAKE_BUILD_TYPE=Release"], { stdio: "inherit", env });
execFileSync("cmake", ["--build", nativeBuild, "--parallel", jobs], { stdio: "inherit", env });
execFileSync(path.join(nativeBuild, "wamr-sysroot-smoke"), [wasm], { stdio: "inherit" });
