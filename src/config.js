import fs from "node:fs";
import path from "node:path";
import { cleanFlags } from "./utils/exec.js";
import {
  ensureOutDir,
  resolvePreferredLlvmDir,
  resolvePreferredEmsdkDir,
  resolvePreferredHostLlvmDir,
} from "./utils/fs.js";

export const EMSCRIPTEN_PRUNE_DIRS = Object.freeze([
  "AL",
  "EGL",
  "GL",
  "GLES",
  "GLES2",
  "GLES3",
  "GLFW",
  "KHR",
  "SDL",
  "X11",
  "fakesdl",
  "sanitizer",
  "scsi",
  "webgl",
]);

export const CLANG_HEADER_PRUNE_PATTERN =
  /(intrin|arm|riscv|altivec|cpuid|cuda|hip|spirv|hexagon|opencl)/iv;

export const LIB_PRUNE_PATTERN = new RegExp(
  `^(${[
    "lib(GL.*|al|html5|fetch.*|stb_image|sockets.*|jsmath|openmp|wasm_workers.*|embind.*|emmalloc.*|mimalloc.*|llvmlibc.*|wasmfs.*|standalonewasm-.*)\\.a",
    ".*-(mt|ww|debug|tracing|asan|ubsan.*|lsan.*|legacyexcept|legacysjlj|wasmsjlj).*\\.a",
    "libclang_rt\\.(asan.*|ubsan.*|lsan.*|sanitizer_common.*)\\.a",
  ].join("|")})$`,
  "v"
);

export const CXX_FLAGS = cleanFlags(`
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
`);

export const C_FLAGS = cleanFlags(`
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
`);

export const EXE_LINKER_FLAGS = cleanFlags(`
  -Oz
  -Wl,--gc-sections
  -Wl,--compress-relocations
  -mbulk-memory
  -mextended-const
  -mtail-call
  -mmultivalue
  -msign-ext
  -mnontrapping-fptoint
  -mreference-types
  -sEVAL_CTORS=2
  -sSTACK_OVERFLOW_CHECK=0
  -sAUTO_JS_LIBRARIES=0
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
  -sFILESYSTEM=1
  -sASSERTIONS=0
  -sSTACK_SIZE=16MB
  -sMALLOC=dlmalloc
`);

export const WASM_OPT_FLAGS = Object.freeze([
  "-Oz",
  "--converge",
  "--duplicate-function-elimination",
  "--dce",
  "--vacuum",
  "--strip-debug",
  "--strip-producers",
  "--strip-target-features",
  "--strip-dwarf",
  "--reorder-functions",
  "--enable-bulk-memory",
  "--enable-bulk-memory-opt",
  "--enable-call-indirect-overlong",
  "--enable-extended-const",
  "--enable-mutable-globals",
  "--enable-nontrapping-float-to-int",
  "--enable-multivalue",
  "--enable-sign-ext",
  "--enable-tail-call",
  "--disable-gc",
  "--disable-custom-descriptors",
  "--disable-strings",
  "--disable-memory64",
  "--disable-shared-everything",
  "--disable-exception-handling",
  "--merge-similar-functions",
  "--merge-locals",
  "--gufa-optimizing",
]);

export function resolveBuildConfig(options = {}) {
  const rootDir = path.resolve(options.rootDir || process.cwd());
  const dryRun = options.dryRun ?? (process.env.DRY_RUN === "1" || process.env.DRY_RUN === "true");

  ensureOutDir(rootDir);

  let emsdkDir;
  if (options.emsdkDir) {
    emsdkDir = path.resolve(options.emsdkDir);
  } else if (process.env.EMSDK) {
    emsdkDir = path.resolve(process.env.EMSDK);
  } else {
    emsdkDir = resolvePreferredEmsdkDir(rootDir);
  }

  // Resolve LLVM source root
  let llvmDir;
  if (options.llvmDir) {
    llvmDir = path.resolve(options.llvmDir);
  } else if (process.env.LLVM_DIR) {
    llvmDir = path.resolve(process.env.LLVM_DIR);
  } else {
    llvmDir = resolvePreferredLlvmDir(rootDir);
  }

  const distDir = path.resolve(
    options.distDir || process.env.DIST_DIR || path.join(rootDir, "dist")
  );
  const stageDir = path.join(distDir, "sysroot");
  const buildNativeDir = path.join(llvmDir, "build-native");
  const buildWasmDir = path.join(llvmDir, "build-wasm");
  const nativeBinDir = path.join(buildNativeDir, "bin");
  const wasmBinDir = path.join(buildWasmDir, "bin");
  const emscriptenSysroot = path.join(
    emsdkDir,
    "upstream/emscripten/cache/sysroot"
  );

  const hostLlvmDir = path.resolve(
    options.hostLlvmDir ||
      process.env.HOST_LLVM_DIR ||
      resolvePreferredHostLlvmDir(rootDir)
  );
  const hostBinDir = path.join(hostLlvmDir, "bin");
  const hostClangPath = options.hostClangPath || path.join(hostBinDir, "clang");
  const hostClangXXPath = options.hostClangXXPath || path.join(hostBinDir, "clang++");
  const hostLldPath =
    options.hostLldPath ||
    (fs.existsSync(path.join(hostBinDir, "ld.lld"))
      ? path.join(hostBinDir, "ld.lld")
      : path.join(hostBinDir, "lld"));

  const wasmOptCandidates = [
    path.join(emsdkDir, "upstream/bin/wasm-opt"),
    path.join(emsdkDir, "upstream/emscripten/bin/wasm-opt"),
  ];
  const wasmOptPath =
    wasmOptCandidates.find((candidate) => fs.existsSync(candidate)) || "wasm-opt";

  const llvmStripCandidates = [
    path.join(hostBinDir, "llvm-strip"),
    path.join(emsdkDir, "upstream/bin/llvm-strip"),
  ];
  const llvmStripPath =
    llvmStripCandidates.find((candidate) => fs.existsSync(candidate)) ||
    "llvm-strip";

  const ninjaJobs =
    options.ninjaJobs ??
    (process.env.NINJA_JOBS ? parseInt(process.env.NINJA_JOBS, 10) : 4);

  return {
    rootDir,
    llvmDir,
    distDir,
    stageDir,
    emsdkDir,
    emscriptenSysroot,
    buildNativeDir,
    buildWasmDir,
    nativeBinDir,
    wasmBinDir,
    ninjaJobs,
    wasmOptPath,
    llvmStripPath,
    dryRun,
    llvmTag: options.llvmTag || process.env.LLVM_TAG || "llvmorg-23.1.2",
    emsdkVersion: options.emsdkVersion || process.env.EMSDK_VERSION || "6.0.9",
    hostLlvmDir,
    hostClangPath,
    hostClangXXPath,
    hostLldPath,
    cFlags: C_FLAGS,
    cxxFlags: CXX_FLAGS,
    exeLinkerFlags: EXE_LINKER_FLAGS,
    wasmOptFlags: WASM_OPT_FLAGS,
    emscriptenPruneDirs: EMSCRIPTEN_PRUNE_DIRS,
    clangHeaderPrunePattern: CLANG_HEADER_PRUNE_PATTERN,
    libPrunePattern: LIB_PRUNE_PATTERN,
  };
}
