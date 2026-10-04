import { run, shellQuote } from "../utils/exec.js";

export function configureNativeLlvm(config, { buildDir = config.buildNativeDir, installDir } = {}) {
  const args = [
    "cmake", "-G", "Ninja", "-B", buildDir, "-S", `${config.llvmDir}/llvm`,
    "-DCMAKE_BUILD_TYPE=Release",
    "-DLLVM_ENABLE_PROJECTS=clang",
    "-DLLVM_TARGETS_TO_BUILD=WebAssembly",
    `-DCMAKE_C_COMPILER=${config.hostClangPath}`,
    `-DCMAKE_CXX_COMPILER=${config.hostClangXXPath}`,
    `-DLLVM_USE_LINKER=${config.hostLldPath}`,
    "-DLLVM_ENABLE_LIBXML2=OFF",
    "-DLLVM_ENABLE_ZLIB=OFF",
    "-DLLVM_ENABLE_ZSTD=OFF",
    "-DLLVM_ENABLE_PLUGINS=OFF",
    "-DLLVM_ENABLE_BINDINGS=OFF",
    "-DLLVM_INCLUDE_TESTS=OFF",
    "-DLLVM_INCLUDE_EXAMPLES=OFF",
    "-DLLVM_INCLUDE_BENCHMARKS=OFF",
    "-DLLVM_INCLUDE_DOCS=OFF",
    "-DLLVM_INCLUDE_UTILS=OFF",
    "-DLLVM_BUILD_TOOLS=OFF",
    "-DLLVM_BUILD_UTILS=OFF",
    "-DCLANG_INCLUDE_TESTS=OFF",
    "-DCLANG_ENABLE_HLSL=OFF",
  ];
  if (installDir) {
    args.push(`-DCMAKE_INSTALL_PREFIX=${installDir}`, "-DLLVM_ENABLE_IDE=OFF",
      "-DLLVM_LIBDIR_SUFFIX=", "-DCLANG_RESOURCE_DIR=");
  }
  run(args.map(shellQuote).join(" "), config.llvmDir, {
    CC: config.hostClangPath,
    CXX: config.hostClangXXPath,
    LD: config.hostLldPath,
  }, config.dryRun);
}

export function buildNativeTableGen(config) {
  console.log("\n--- Building Native TableGen Tools ---");
  configureNativeLlvm(config);
  const args = ["cmake", "--build", config.buildNativeDir, "--parallel", config.ninjaJobs,
    "--target", "llvm-tblgen", "clang-tblgen", "llvm-min-tblgen"];
  run(args.map(shellQuote).join(" "), config.llvmDir, {
    CC: config.hostClangPath,
    CXX: config.hostClangXXPath,
    LD: config.hostLldPath,
  }, config.dryRun);
}
