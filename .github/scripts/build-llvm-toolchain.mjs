import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function run(command, cwd = process.cwd(), extraEnv = {}) {
  const normalized = command
    .trim()
    .split("\n")
    .map((line) => line.trim().replace(/\\$/, ""))
    .filter(Boolean)
    .join(" ");

  console.log(`\n\x1b[36m>>> Running:\x1b[0m ${normalized} (in ${cwd})`);
  execSync(normalized, {
    cwd,
    stdio: "inherit",
    shell: "/bin/bash",
    env: { ...process.env, NINJA_STATUS: "[%f/%t %e] ", ...extraEnv },
  });
}

const cleanFlags = (str) => str.trim().split(/\s+/).join(" ");

const EMSDK = process.env.EMSDK;
if (!EMSDK) {
  throw new Error("EMSDK environment variable is not defined. Source emsdk_env.sh first.");
}

const ROOT_DIR = process.cwd();
const LLVM_DIR = ROOT_DIR;
const DIST_DIR = path.join(ROOT_DIR, "dist");
const STAGE_DIR = path.join(DIST_DIR, "sysroot");

console.log("\n--- [1/5] Pruning Emscripten Headers ---");
const sysInc = path.join(EMSDK, "upstream/emscripten/system/include");
const dirsToPrune = [
  "AL", "EGL", "GL", "GLES", "GLES2", "GLES3", "GLFW", "KHR",
  "SDL", "X11", "fakesdl", "sanitizer", "scsi", "webgl",
];

for (const dir of dirsToPrune) {
  const target = path.join(sysInc, dir);
  if (fs.existsSync(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
}

console.log("\n--- [2/5] Building Emscripten System Libraries ---");
run(`
  embuilder build
    sysroot
    libc
    libc++
    libc++abi
    libdlmalloc
`);

console.log("\n--- [3/5] Building Native TableGen Tools ---");
run(`
  cmake -G Ninja -B build-native -S llvm
    -DCMAKE_BUILD_TYPE=Release
    -DLLVM_ENABLE_PROJECTS="clang"
    -DLLVM_TARGETS_TO_BUILD="WebAssembly"
    -DCMAKE_C_COMPILER=clang
    -DCMAKE_CXX_COMPILER=clang++
    -DLLVM_USE_LINKER=lld
    -DLLVM_ENABLE_LIBXML2=OFF
    -DLLVM_ENABLE_ZLIB=OFF
    -DLLVM_ENABLE_ZSTD=OFF
    -DLLVM_ENABLE_PLUGINS=OFF
    -DLLVM_ENABLE_BINDINGS=OFF
    -DLLVM_INCLUDE_TESTS=OFF
    -DLLVM_INCLUDE_EXAMPLES=OFF
    -DLLVM_INCLUDE_BENCHMARKS=OFF
    -DLLVM_INCLUDE_DOCS=OFF
    -DLLVM_INCLUDE_UTILS=OFF
    -DLLVM_BUILD_TOOLS=OFF
    -DLLVM_BUILD_UTILS=OFF
`, LLVM_DIR);

run(`
  ninja -C build-native -j 4
    llvm-tblgen
    clang-tblgen
    llvm-min-tblgen
`, LLVM_DIR);

console.log("\n--- [4/5] Cross-Compiling Clang & LLD to Wasm ---");
const nativeBin = path.join(LLVM_DIR, "build-native", "bin");

const cxxFlags = cleanFlags(`
  -Oz
  -ffunction-sections
  -fdata-sections
  -fno-exceptions
  -fno-unwind-tables
  -fno-asynchronous-unwind-tables
  -fno-rtti
  -mbulk-memory
  -mextended-const
  -mtail-call
  -mmultivalue
  -msign-ext
  -mnontrapping-fptoint
  -mreference-types
  -msimd128
`);

const cFlags = cleanFlags(`
  -Oz
  -ffunction-sections
  -fdata-sections
  -fno-unwind-tables
  -fno-asynchronous-unwind-tables
  -mbulk-memory
  -mextended-const
  -mtail-call
  -mmultivalue
  -msign-ext
  -mnontrapping-fptoint
  -mreference-types
  -msimd128
`);

const exeLinkerFlags = cleanFlags(`
  -Oz
  -Wl,--gc-sections
  -Wl,-O3
  -Wl,--compress-relocations
  -mbulk-memory
  -mextended-const
  -mtail-call
  -mmultivalue
  -msign-ext
  -mnontrapping-fptoint
  -mreference-types
  -msimd128
  -sEVAL_CTORS=1
  -sALLOW_MEMORY_GROWTH=1
  -sINITIAL_MEMORY=256MB
  -sMAXIMUM_MEMORY=2GB
  -sDISABLE_EXCEPTION_CATCHING=1
  -sTEXTDECODER=2
  -sEXPORTED_RUNTIME_METHODS=FS,callMain
  -sEXPORT_NAME=createModule
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sENVIRONMENT=web,worker
  -sPOLYFILL=0
  -sGROWABLE_ARRAYBUFFERS=1
  -sFILESYSTEM=1
  -sASSERTIONS=1
  -sSTACK_SIZE=16MB
`);

run(`
  emcmake cmake -G Ninja -B build-wasm -S llvm
    -DCMAKE_BUILD_TYPE=MinSizeRel
    -DLLVM_ENABLE_ASSERTIONS=OFF
    -DLLVM_ENABLE_PROJECTS="clang;lld"
    -DLLVM_TARGETS_TO_BUILD="WebAssembly"
    -DLLVM_DEFAULT_TARGET_TRIPLE="wasm32-unknown-emscripten"
    -DLLVM_NATIVE_TOOL_DIR="${nativeBin}"
    -DLLVM_ENABLE_THREADS=OFF
    -DLLVM_ENABLE_BACKTRACES=OFF
    -DLLVM_ENABLE_CRASH_OVERRIDES=OFF
    -DLLVM_ENABLE_LIBXML2=OFF
    -DLLVM_ENABLE_ZLIB=OFF
    -DLLVM_ENABLE_ZSTD=OFF
    -DLLVM_ENABLE_LIBPFM=OFF
    -DLLVM_ENABLE_PIC=OFF
    -DLLVM_ENABLE_UNWIND_TABLES=OFF
    -DLLVM_INSTALL_UTILS=OFF
    -DLLVM_ENABLE_PLUGINS=OFF
    -DLLVM_ENABLE_BINDINGS=OFF
    -DLLVM_ENABLE_TELEMETRY=OFF
    -DLLVM_INCLUDE_TESTS=OFF
    -DLLVM_INCLUDE_EXAMPLES=OFF
    -DLLVM_INCLUDE_BENCHMARKS=OFF
    -DLLVM_INCLUDE_DOCS=OFF
    -DLLVM_INCLUDE_UTILS=OFF
    -DLLVM_INCLUDE_RUNTIMES=OFF
    -DLLVM_BUILD_TOOLS=OFF
    -DLLVM_BUILD_UTILS=OFF
    -DLLVM_TOOL_LLVM_LTO_BUILD=OFF
    -DLLVM_TOOL_LLVM_LTO2_BUILD=OFF
    -DCLANG_ENABLE_STATIC_ANALYZER=OFF
    -DCLANG_ENABLE_OBJC_REWRITER=OFF
    -DCLANG_ENABLE_HLSL=OFF
    -DCLANG_ENABLE_LIBXML2=OFF
    -DCLANG_PLUGIN_SUPPORT=OFF
    -DCLANG_INCLUDE_TESTS=OFF
    -DCLANG_BUILD_TOOLS=OFF
    -DCLANG_TOOL_APINOTES_TEST_BUILD=OFF
    -DCLANG_TOOL_C_INDEX_TEST_BUILD=OFF
    -DCLANG_TOOL_CIR_LSP_SERVER_BUILD=OFF
    -DCLANG_TOOL_CIR_OPT_BUILD=OFF
    -DCLANG_TOOL_CIR_TRANSLATE_BUILD=OFF
    -DCLANG_TOOL_CLANG_CHECK_BUILD=OFF
    -DCLANG_TOOL_CLANG_DIFF_BUILD=OFF
    -DCLANG_TOOL_CLANG_EXTDEF_MAPPING_BUILD=OFF
    -DCLANG_TOOL_CLANG_FORMAT_BUILD=OFF
    -DCLANG_TOOL_CLANG_FUZZER_BUILD=OFF
    -DCLANG_TOOL_CLANG_IMPORT_TEST_BUILD=OFF
    -DCLANG_TOOL_CLANG_INSTALLAPI_BUILD=OFF
    -DCLANG_TOOL_CLANG_LINKER_WRAPPER_BUILD=OFF
    -DCLANG_TOOL_CLANG_NVLINK_WRAPPER_BUILD=OFF
    -DCLANG_TOOL_CLANG_OFFLOAD_BUNDLER_BUILD=OFF
    -DCLANG_TOOL_CLANG_REFACTOR_BUILD=OFF
    -DCLANG_TOOL_CLANG_REPL_BUILD=OFF
    -DCLANG_TOOL_CLANG_SCAN_DEPS_BUILD=OFF
    -DCLANG_TOOL_CLANG_SHLIB_BUILD=OFF
    -DCLANG_TOOL_CLANG_SSAF_ANALYZER_BUILD=OFF
    -DCLANG_TOOL_CLANG_SSAF_FORMAT_BUILD=OFF
    -DCLANG_TOOL_CLANG_SSAF_LINKER_BUILD=OFF
    -DCLANG_TOOL_CLANG_SYCL_LINKER_BUILD=OFF
    -DCLANG_TOOL_DIAGTOOL_BUILD=OFF
    -DCLANG_TOOL_LIBCLANG_BUILD=OFF
    -DCLANG_TOOL_OFFLOAD_ARCH_BUILD=OFF
    -DCLANG_TOOL_SCAN_BUILD_BUILD=OFF
    -DCLANG_TOOL_SCAN_BUILD_PY_BUILD=OFF
    -DCLANG_TOOL_SCAN_VIEW_BUILD=OFF
    -DDEFAULT_SYSROOT="/sysroot"
    -DCLANG_DEFAULT_CXX_STDLIB="libc++"
    -DCLANG_DEFAULT_RTLIB="compiler-rt"
    -DCLANG_DEFAULT_LINKER="lld"
    -DCMAKE_CXX_FLAGS="${cxxFlags}"
    -DCMAKE_C_FLAGS="${cFlags}"
    -DCMAKE_EXE_LINKER_FLAGS="${exeLinkerFlags}"
`, LLVM_DIR);

run(`
  ninja -C build-wasm -j 4
    clang
    lld
`, LLVM_DIR);

console.log("\n--- [5/5] Optimizing and Assembling Distribution ---");
fs.mkdirSync(DIST_DIR, { recursive: true });
const wasmBinDir = path.join(LLVM_DIR, "build-wasm", "bin");

const wasmOptCandidates = [
  path.join(EMSDK, "upstream/bin/wasm-opt"),
  path.join(EMSDK, "upstream/emscripten/bin/wasm-opt"),
];
const wasmOpt = wasmOptCandidates.find((candidate) => fs.existsSync(candidate)) || "wasm-opt";

const llvmStripCandidates = [path.join(EMSDK, "upstream/bin/llvm-strip")];
const llvmStrip = llvmStripCandidates.find((candidate) => fs.existsSync(candidate)) || "llvm-strip";

for (const tool of ["clang", "lld"]) {
  const srcWasm = path.join(wasmBinDir, `${tool}.wasm`);
  const srcJs = path.join(wasmBinDir, `${tool}.js`);
  const outWasm = path.join(DIST_DIR, `${tool}.wasm`);

  if (!fs.existsSync(srcWasm) || !fs.existsSync(srcJs)) {
    throw new Error(`Expected output binary not found: ${srcWasm} or ${srcJs}`);
  }

  run(`
    ${wasmOpt}
      -Oz
      --converge
      --duplicate-function-elimination
      --dce
      --vacuum
      --strip-debug
      --strip-producers
      --strip-target-features
      --strip-dwarf
      --reorder-functions
      --enable-bulk-memory
      --enable-bulk-memory-opt
      --enable-call-indirect-overlong
      --enable-extended-const
      --enable-multivalue
      --enable-mutable-globals
      --enable-nontrapping-float-to-int
      --enable-reference-types
      --enable-sign-ext
      --enable-tail-call
      --enable-simd
      --disable-gc
      --disable-custom-descriptors
      --disable-compact-imports
      --disable-strings
      --disable-memory64
      --disable-shared-everything
      --disable-exception-handling
      --merge-similar-functions
      --merge-locals
      --gufa-optimizing
      "${srcWasm}"
      -o "${outWasm}"
  `);
  fs.copyFileSync(srcJs, path.join(DIST_DIR, `${tool}.js`));
}

const emscriptenSysroot = path.join(EMSDK, "upstream/emscripten/cache/sysroot");
if (!fs.existsSync(emscriptenSysroot)) {
  throw new Error(`Emscripten sysroot not found: ${emscriptenSysroot}`);
}

const findResourceDir = (basePaths) => {
  for (const base of basePaths) {
    if (fs.existsSync(base)) {
      const items = fs.readdirSync(base, { withFileTypes: true });
      const dir = items.find((entry) => entry.isDirectory());
      if (dir) return path.join(base, dir.name);
    }
  }
  return null;
};

const clangResSrc = findResourceDir([
  path.join(LLVM_DIR, "build-native/lib/clang"),
  path.join(LLVM_DIR, "build-wasm/lib/clang"),
]);
if (!clangResSrc) {
  throw new Error("Clang resource header directory not found!");
}

const stageLibWasm = path.join(STAGE_DIR, "lib/wasm32-emscripten");
const stageLibClang = path.join(STAGE_DIR, "lib/clang");

fs.rmSync(STAGE_DIR, { recursive: true, force: true });
fs.mkdirSync(stageLibWasm, { recursive: true });
fs.mkdirSync(stageLibClang, { recursive: true });

fs.cpSync(path.join(emscriptenSysroot, "include"), path.join(STAGE_DIR, "include"), { recursive: true });

const sysLibDir = path.join(emscriptenSysroot, "lib/wasm32-emscripten");
for (const file of fs.readdirSync(sysLibDir)) {
  if (file.endsWith(".a") || file.endsWith(".o")) {
    fs.copyFileSync(path.join(sysLibDir, file), path.join(stageLibWasm, file));
  }
}

const filesToStrip = fs.readdirSync(stageLibWasm)
  .filter((file) => file.endsWith(".a") || file.endsWith(".o"))
  .map((file) => path.join(stageLibWasm, file));
if (filesToStrip.length > 0) {
  run(`${llvmStrip} --strip-debug ${filesToStrip.map((file) => `"${file}"`).join(" ")}`);
}

const clangVer = path.basename(clangResSrc);
fs.cpSync(clangResSrc, path.join(stageLibClang, clangVer), { recursive: true });

const clangHeadersPath = path.join(stageLibClang, clangVer, "include");
if (fs.existsSync(clangHeadersPath)) {
  const prunePatterns = /(intrin|arm|riscv|altivec|cpuid|cuda|hip|spirv|hexagon|opencl)/i;
  for (const file of fs.readdirSync(clangHeadersPath)) {
    if (prunePatterns.test(file)) {
      fs.rmSync(path.join(clangHeadersPath, file), { recursive: true, force: true });
    }
  }
}

const libPruneRegex = new RegExp(`^(${[
  "lib(GL.*|al|html5|fetch.*|stb_image|sockets.*|jsmath|openmp|wasm_workers.*|embind.*|emmalloc.*|mimalloc.*|llvmlibc.*|wasmfs.*|standalonewasm-.*)\\.a",
  ".*-(mt|ww|debug|tracing|asan|ubsan.*|lsan.*|legacyexcept|legacysjlj|wasmsjlj).*\\.a",
  "libclang_rt\\.(asan.*|ubsan.*|lsan.*|sanitizer_common.*)\\.a",
].join("|")})$`);

for (const file of fs.readdirSync(stageLibWasm)) {
  if (libPruneRegex.test(file)) {
    fs.unlinkSync(path.join(stageLibWasm, file));
  }
}

const sysrootArchive = path.join(DIST_DIR, "sysroot.tgz");
run(`
  tar
    --sort=name
    -I 'gzip -9'
    -cf "${sysrootArchive}"
    -C "${DIST_DIR}"
    sysroot
`);
fs.rmSync(STAGE_DIR, { recursive: true, force: true });

console.log("\n\x1b[32mBuild finished successfully. Artifacts ready in dist/:\x1b[0m");
for (const item of fs.readdirSync(DIST_DIR)) {
  const stat = fs.statSync(path.join(DIST_DIR, item));
  console.log(` - ${item} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);
}
