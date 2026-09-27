import { run } from "../utils/exec.js";

export function buildNativeTableGen(config) {
  console.log("\n--- [3/5] Building Native TableGen Tools ---");

  run(
    `
    cmake -G Ninja -B build-native -S llvm
      -DCMAKE_BUILD_TYPE=Release
      -DLLVM_ENABLE_PROJECTS="clang"
      -DLLVM_TARGETS_TO_BUILD="WebAssembly"
      -DCMAKE_C_COMPILER="${config.hostClangPath}"
      -DCMAKE_CXX_COMPILER="${config.hostClangXXPath}"
      -DLLVM_USE_LINKER="${config.hostLldPath}"
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
    `,
    config.llvmDir,
    {
      CC: config.hostClangPath,
      CXX: config.hostClangXXPath,
      LD: config.hostLldPath,
    },
    config.dryRun
  );

  run(
    `
    ninja -C build-native -j ${config.ninjaJobs}
      llvm-tblgen
      clang-tblgen
      llvm-min-tblgen
    `,
    config.llvmDir,
    {
      CC: config.hostClangPath,
      CXX: config.hostClangXXPath,
      LD: config.hostLldPath,
    },
    config.dryRun
  );
}
