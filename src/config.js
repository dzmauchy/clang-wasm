import fs from "node:fs";
import path from "node:path";
import { cleanFlags } from "./utils/exec.js";
import { DEFAULT_EMSDK_VERSION } from "./steps/ensure-emsdk.js";
import {
  ensureOutDir,
  resolvePreferredLlvmDir,
  resolvePreferredEmsdkDir,
  resolvePreferredHostLlvmDir,
} from "./utils/fs.js";

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
  -sEXPORTED_RUNTIME_METHODS=FS,PROXYFS,callMain
  -sEXPORT_NAME=createModule
  -sMODULARIZE=1
  -sEXPORT_ES6=1
  -sENVIRONMENT=worker
  -sPOLYFILL=0
  -sFILESYSTEM=1
  -lproxyfs.js
  -sASSERTIONS=0
  -sSTACK_SIZE=16MB
  -sMALLOC=emmalloc
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
  const buildSysrootDir = path.join(rootDir, "out", "build-sysroot");

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

  const llvmTag =
    options.llvmTag ||
    process.env.LLVM_TAG ||
    (process.env.LLVM_VERSION
      ? `llvmorg-${process.env.LLVM_VERSION.trim()}`
      : undefined);
  if (!llvmTag) {
    throw new Error("LLVM_VERSION environment variable is not defined");
  }

  return {
    rootDir,
    llvmDir,
    distDir,
    stageDir,
    emsdkDir,
    buildSysrootDir,
    hostBinDir,
    buildNativeDir,
    buildWasmDir,
    nativeBinDir,
    wasmBinDir,
    ninjaJobs,
    wasmOptPath,
    llvmStripPath,
    dryRun,
    llvmTag,
    emsdkVersion: options.emsdkVersion || process.env.EMSDK_VERSION || DEFAULT_EMSDK_VERSION,
    hostLlvmDir,
    hostClangPath,
    hostClangXXPath,
    hostLldPath,
    sysrootHeapSize: options.sysrootHeapSize ?? process.env.SYSROOT_HEAP_SIZE ?? 4194304,
    cFlags: C_FLAGS,
    cxxFlags: CXX_FLAGS,
    exeLinkerFlags: EXE_LINKER_FLAGS,
    wasmOptFlags: WASM_OPT_FLAGS,
  };
}
