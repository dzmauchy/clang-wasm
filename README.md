# Browser Clang and bare Wasm sysroot

`npm run build -- --llvm-version 23.1.2` builds browser-hosted Clang and LLD
and produces `dist/clang.{js,wasm}`, `dist/lld.{js,wasm}`, and `dist/sysroot.tgz`.
Clang defaults to `wasm32-unknown-unknown` and `/sysroot`.
Emscripten builds the compiler tools; programs compiled with the packaged
sysroot use LLVM libc, libc++, and libc++abi with explicit browser imports.
Clang's default C++ standard library is libc++.

The build host needs Node.js 24+, Git, CMake 3.24+, Ninja, Python 3 with PyYAML, and
Clang/LLVM tools with the WebAssembly backend. The pipeline downloads host
LLVM, LLVM sources, and Emscripten when needed. CMake builds LLVM libc,
libc++, libc++abi, and compiler-rt builtins from the same selected LLVM source
release and packages the complete sysroot. JavaScript only invokes CMake.

## Build only the sysroot

```sh
cmake -S . -B out/build-sysroot -G Ninja -DSYSROOT_JOBS=4
cmake --build out/build-sysroot --target sysroot --parallel 4
ctest --test-dir out/build-sysroot --output-on-failure
```

`SYSROOT_OUTPUT_DIR` defaults to `dist`. Both `sysroot/` and `sysroot.tgz`
remain there after building. The archive extracts to a top-level `sysroot/`
directory, suitable for mounting at `/sysroot` in the compiler's filesystem.

Set `SYSROOT_CLANG`, `SYSROOT_CLANGXX`, `SYSROOT_AR`, `SYSROOT_RANLIB`, and
`SYSROOT_STRIP` to select host tools. `CLANG_RESOURCE_DIR` defaults to the
chosen Clang's resource directory; it should match the version of Clang that
will consume the sysroot. `LLVM_SOURCE_DIR` defaults to `out/llvm-project`;
when missing, CMake downloads the release selected by `LLVM_VERSION`.
The source tree receives idempotent adaptations for LLVM libc's Wasm
configuration and libc++abi's no-RTTI source selection during the build.

The sysroot includes C headers, C++ headers in `include/c++/v1` (including
the generated `__config_site` and ABI headers), `browser.hpp`, `libc.a`,
`libm.a`, `libc++.a`, `libc++abi.a`, `libbrowser.a`, compiler-rt builtins,
Clang resource headers, and the LLVM license. LLVM libc's public headers
include the matching `llvm-libc-types` and `llvm-libc-macros` directories.
Packaging recreates the staging directory, removing old headers and libraries.

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

`SYSROOT_HEAP_SIZE` sets the bounded LLVM allocator region in bytes (default
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
  -lbrowser -lc++ -lc++abi -lc -lm -lclang_rt.builtins-wasm32 \
  -Wl,--no-entry -Wl,--export=browser_run -Wl,--export-memory \
  -o examples/program.wasm
```

The same compile flags work in browser-hosted Clang. Compile to an object
with `-c`, then pass the object to browser-hosted LLD with:

```text
--no-entry --export=browser_run --export-memory program.o
-L/sysroot/lib -lbrowser -lc++ -lc++abi -lc -lm -lclang_rt.builtins-wasm32 -o program.wasm
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

`npm test` checks the build pipeline. The CTest smoke test compiles a C++20
program and instantiates it using Node's WebAssembly engine, exercising
containers, strings, formatting, smart pointers, aligned allocation, PMR,
ABI guards, UTC clocks, stdio, floating-point math, compiler builtins, static
constructors, and heap reservation, exhaustion, `calloc`, and `realloc`.
It also checks trapping `new` and non-throwing allocation. A restricted-memory instance
checks that failed heap reservation returns null with `ENOMEM`. Tests compile
against the extracted archive and check the explicit browser imports.

The Wasm adaptation uses LLVM libc's [full-build configuration](https://libc.llvm.org/build_concepts.html)
and its [bare-metal I/O hooks](https://github.com/llvm/llvm-project/blob/main/libc/src/__support/OSUtil/baremetal/io.h).
The C++ runtime follows LLVM's [vendor configuration](https://libcxx.llvm.org/VendorDocumentation.html)
with the bare-metal options selected in `CMakeLists.txt`.
