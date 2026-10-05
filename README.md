# Browser Clang and bare Wasm sysroot

`npm run build -- --llvm-version 23.1.2` builds browser-hosted Clang and LLD
and produces `dist/clang.{js,wasm}`, `dist/lld.{js,wasm}`, and `dist/sysroot.tgz`.
Clang defaults to `wasm32-unknown-unknown` and `/sysroot`.
Emscripten builds the compiler tools; programs compiled with the packaged
sysroot use LLVM libc, libc++, and libc++abi with explicit browser imports.
Clang's default C++ standard library is libc++.

The browser linker contains only LLD's WebAssembly driver. A launcher in
`cmake/wasm-lld` is registered through `LLVM_EXTERNAL_PROJECTS` and links
`lldWasm` and `lldCommon`, without changing LLVM's sources. The pipeline builds
the `wasm-lld` target instead of LLVM's multi-format `lld` executable, leaving
the ELF, COFF, Mach-O, and MinGW driver libraries out of this build. Its outputs
in `build-wasm/bin/wasm-only` are packaged as `dist/lld.{js,wasm}`. Wasm is the
default flavor; `-flavor wasm` is also accepted.

The build host needs Node.js 24+, Git, CMake 3.24+, Ninja, Python 3 with PyYAML, and
Clang/LLVM tools with the WebAssembly backend. The pipeline downloads host
LLVM, LLVM sources, and Emscripten when needed. CMake builds LLVM libc,
libc++, libc++abi, and compiler-rt builtins from the same selected LLVM source
release. JavaScript coordinates those dependency builds, compiles the browser
runtime, and packages the complete sysroot.

## Build only the sysroot

For WAMR's host-managed app heap, use the separate build:

```sh
npm run build-wamr-sysroot -- --jobs 4
# Validate C++23 and PMR under a native WAMR interpreter:
npm run build-wamr-sysroot -- --test --wamr-dir /path/to/wasm-micro-runtime
```

This produces `dist/wamrsr.tgz` (extracts to `wamrsr/`) and keeps the installed
sysroot at `dist/wamrsr/`. It includes the WAMR host adapter and embedding
instructions in `share/wamr/`; the source instructions are in
[sysroot/wamr/README.md](sysroot/wamr/README.md). Link `-lwamr`, register the host
adapter, and instantiate with a nonzero app heap. C/C++ allocations, including
alignment and default PMR resources, use that heap. Heap capacity is a host
setting. Browser and WAMR sysroots use separate build and output directories.
The GitHub Actions release workflow builds both sysroots, validates the WAMR
archive with a pinned native WAMR interpreter, and publishes `wamrsr.tgz`
alongside `sysroot.tgz` and the compiler/linker binaries.

For the browser sysroot:

```sh
npm run build-sysroot -- --llvm-version 23.1.2 --jobs 4 --test
# Test an existing sysroot without rebuilding:
npm run test-sysroot
```

`--dist-dir` defaults to `dist`. Both `sysroot/` and `sysroot.tgz`
remain there after building. The archive extracts to a top-level `sysroot/`
directory, suitable for mounting at `/sysroot` in the compiler's filesystem.

Use `--host-llvm-dir` (or `HOST_LLVM_DIR`) to select host LLVM tools.
Clang resource headers come from the selected LLVM source release through
`install-core-resource-headers` and `install-webassembly-resource-headers`.
`--llvm-dir` (or `LLVM_DIR`) defaults to `out/llvm-project`;
when missing, JavaScript downloads the release selected by `--llvm-version`
or `LLVM_VERSION` (default 23.1.2 for the standalone sysroot command).
Dependency build files remain in `out/build-sysroot`. CMake is required for
LLVM's internal builds; this repository has no root `CMakeLists.txt`.
The source tree receives idempotent adaptations for LLVM libc's Wasm
configuration and libc++abi's no-RTTI source selection during the build.

The sysroot includes C headers, C++ headers in `include/c++/v1` (including
the generated `__config_site` and ABI headers), `browser.hpp`, `libc.a`,
`libm.a`, `libc++.a`, `libc++abi.a`, `libc++experimental.a`, `libbrowser.a`,
compiler-rt builtins, core and WebAssembly Clang resource headers, and the
LLVM license. LLVM libc's public headers
include the matching `llvm-libc-types` and `llvm-libc-macros` directories.
Each build starts with an empty sysroot and installs the selected LLVM components
straight into it. Packaging adds the browser runtime and license metadata, then
archives the whole directory without filename lists or copy filters.
LLVM's install layout is preserved: libc and libm live in
`lib/wasm32-unknown-unknown`, C++ libraries in `lib`, and compiler-rt builtins
in `lib/clang/<major>/lib/wasi`. The `cxx` component also installs its Wasm
`libc++experimental.a`. Default MinSizeRel builds emit no debug information;
packaging does not scan or strip the installed archives.
CUDA, HIP, OpenCL, HLSL, and other architectures' resource headers are excluded
using LLVM's install targets. The compiler-rt build installs only
`install-clang_rt.builtins-wasm32`; libc, libc++, and libc++abi are also built
for `wasm32-unknown-unknown`. Header selection requires no LLVM source patches
and runs before the Clang and LLD builds.

This Wasm port selects LLVM libc's portable bare-metal implementations,
single-threaded stdio, external `errno` storage, and no TLS. Floating-point
formatting and parsing are enabled. Wasm supports round-to-nearest and does
not expose hardware floating-point exception flags. `setjmp`/`longjmp` and
POSIX file operations are not provided; the generated C headers describe the
selected entrypoints.

libc++ and libc++abi are static Wasm libraries compiled without threads,
RTTI, exceptions, or an unwinder. Containers, algorithms, strings, smart
pointers, `std::function`, `std::format`, `charconv`, and PMR use LLVM libc's
allocator. Single-threaded guards support dynamically initialized static
locals. Filesystem access, localization (including iostreams and regex),
wide characters, `std::random_device`, time-zone databases, and
`std::chrono::steady_clock` are disabled. Use `printf` or the browser helpers
for output and `browser::now()` for monotonic timestamps.

`--heap-size` (or `SYSROOT_HEAP_SIZE`) sets the bounded LLVM allocator region in bytes (default
4194304, or 4 MiB). On the first allocation, the runtime grows linear memory
as needed to reserve this region. Exhaustion returns null; freeing blocks
makes them reusable. Set a smaller heap for applications with lower memory
limits. Host memory limits must allow the heap plus the stack and static data.
LLVM libc's allocator does not use `sbrk`, and this sysroot does not provide it.

## Compile and run a program

For a native Clang invocation against the extracted sysroot:

```sh
clang++ --target=wasm32-unknown-unknown -std=c++20 -O2 \
  -fno-exceptions -fno-rtti -stdlib=libc++ -nostdlib \
  --sysroot=dist/sysroot \
  examples/browser.cpp -Ldist/sysroot/lib \
  -Ldist/sysroot/lib/wasm32-unknown-unknown \
  -Ldist/sysroot/lib/clang/23/lib/wasi \
  -lbrowser -lc++ -lc++abi -lc -lm -lclang_rt.builtins-wasm32 \
  -Wl,--no-entry -Wl,--export=browser_run -Wl,--export-memory \
  -o examples/program.wasm
```

Replace `23` in the resource-library path with the selected LLVM major version.
The same compile flags work in browser-hosted Clang. Compile to an object
with `-c`, then pass the object to browser-hosted LLD with:

```text
--no-entry --export=browser_run --export-memory program.o
-L/sysroot/lib -L/sysroot/lib/wasm32-unknown-unknown
-L/sysroot/lib/clang/23/lib/wasi
-lbrowser -lc++ -lc++abi -lc -lm -lclang_rt.builtins-wasm32 -o program.wasm
```

Serve `examples/` over HTTP and open `browser.html`. The page provides
`env.js_print_char`, `env.js_now`, and `env.js_time`, instantiates the module, and calls
`browser_run()`, which returns `main`'s result. Both `main()` and
`main(int, char**)` are supported; the latter receives zero arguments and
a null-terminated empty argument array. `browser_run()` initializes C++ static
objects once before calling `main`; call it before other program exports.
Create a new instance for each fresh execution;
returning from `main` does not invoke process teardown or static destructors.
Calling `exit` or failing an assertion traps the module.

`browser::print` and `browser::write` send bytes to `js_print_char`.
`printf`, `puts`, and standard output use the same import. Standard input
returns EOF. `browser::now()` calls `js_now`, normally backed by
`performance.now()`. Unused imports are omitted by the linker.
`BROWSER_EXPORT(name)` exports additional C-linkage functions.
`std::chrono::system_clock::now()` uses `env.js_time`, backed by `Date.now()`
and expressed in Unix-epoch milliseconds. This is separate from the
monotonic browser timer.

Compile application code with `-fno-exceptions -fno-rtti` to match the runtime.
`-stdlib=libc++` selects the packaged C++ headers automatically; do not use
`-nostdinc++` unless you also supply `-isystem /sysroot/include/c++/v1`.
`-nostdlib` leaves linking explicit for this bare Wasm reactor, so both C++
archives must be included as shown above.

No permissive undefined-symbol linker flag is needed: missing dependencies
fail at link time. Heap reservation uses `memory.grow`; failed reservation sets `errno` to
`ENOMEM`. Allocation failure within the bounded LLVM heap returns null; the
bare-metal allocator does not guarantee an `errno` update for exhaustion.
Ordinary `new` and C++ operations that would throw terminate by trapping;
`new (std::nothrow)` returns null on allocation failure.

## Validation

`npm test` checks the build pipeline. `npm run test-sysroot` compiles a C++20
program and instantiates it using Node's WebAssembly engine, exercising
containers, strings, formatting, smart pointers, aligned allocation, PMR,
ABI guards, UTC clocks, stdio, floating-point math, compiler builtins, static
constructors, and heap reservation, exhaustion, `calloc`, and `realloc`.
It also checks trapping `new` and non-throwing allocation. A restricted-memory instance
checks that failed heap reservation returns null with `ENOMEM`. Tests compile
against the extracted archive and check the explicit browser imports.

`npm run test-lld` tests the packaged browser linker using Node workers and
the host Clang in `out/llvm` (or `HOST_LLVM_DIR`). It links Wasm objects and
LLVM bitcode, executes the resulting export, and checks that other linker
flavors and ELF, COFF, and Mach-O inputs are rejected. To test an unpackaged
build, pass its output directory, for example:
`npm run test-lld -- out/llvm-project/build-wasm/bin/wasm-only`.

The Wasm adaptation uses LLVM libc's [full-build configuration](https://libc.llvm.org/build_concepts.html)
and its [bare-metal I/O hooks](https://github.com/llvm/llvm-project/blob/main/libc/src/__support/OSUtil/baremetal/io.h).
The C++ runtime follows LLVM's [vendor configuration](https://libcxx.llvm.org/VendorDocumentation.html)
with the bare-metal options selected in `src/steps/build-sysroot.js`.
