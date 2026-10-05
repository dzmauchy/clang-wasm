# WAMR sysroot

`wamrsr.tgz` extracts to `wamrsr/`. It contains LLVM libc, libc++, libc++abi,
compiler-rt builtins, and `libwamr.a`. Applications target
`wasm32-unknown-unknown`; WASI and JavaScript are not required.

## Compile C++23 applications

```sh
clang++ --target=wasm32-unknown-unknown -std=c++23 -O2 \
  -fno-exceptions -fno-rtti -stdlib=libc++ -nostdlib \
  --sysroot=wamrsr example.cpp \
  -Lwamrsr/lib -Lwamrsr/lib/wasm32-unknown-unknown \
  -Lwamrsr/lib/clang/23/lib/wasi \
  -lwamr -lc++ -lc++abi -lc -lm -lclang_rt.builtins-wasm32 \
  -Wl,--no-entry -Wl,--export=wamr_run -Wl,--export-memory \
  -Wl,--export=__heap_base -Wl,--export=__data_end \
  -Wl,-z,stack-size=8192 -o example.wasm
```

Replace `23` with the LLVM major used for the build. Include `<wamr.hpp>` for
`wamr::print`, `wamr::write`, `wamr::now`, and `WAMR_EXPORT(name)`.
Call `wamr_run` before other exports: it initializes static constructors once
and calls `main` with zero arguments and a null-terminated empty `argv`.
Create a new instance for a fresh execution. No process teardown runs when
`main` returns; `exit` and assertion failures trap.

## Native WAMR integration

Compile `wamr-host.c` into your native embedding application, with WAMR's
`core/iwasm/include` on the include path. Implement the three platform hooks
declared in `wamr-host.h`: console character output, monotonic milliseconds,
and Unix-epoch milliseconds. Register these imports after runtime initialization
and before loading the module:

```c
if (!wasm_runtime_init() || !wamr_sysroot_register()) { /* handle error */ }
/* Load the module, then create its fixed app heap, for example 64 KiB. */
wasm_module_inst_t instance = wasm_runtime_instantiate(
    module, 8192, 65536, error_buf, sizeof(error_buf));
```

Custom native imports suffice; WAMR's libc-builtin and libc-wasi libraries are
optional. Build WAMR with `-DWAMR_BUILD_REF_TYPES=1`: Clang's default Wasm output
can use the extended `call_indirect` encoding that requires this support.
This adapter uses `wasm_runtime_module_malloc/free`, never the native
runtime heap. **Do not export `malloc` or `free`, including via `--export-all`.**
WAMR detects those exports as a guest allocator, which defeats this app-heap
configuration and can recurse into the allocation callbacks.

All C and C++ allocations, including ordinary and over-aligned `new`,
`new(std::nothrow)`, default PMR allocations, and PMR upstream resources, use
this heap. The guest adapter stores an 8-byte header plus alignment padding
inside each raw WAMR allocation. It guarantees `max_align_t` alignment and
supports larger power-of-two alignments. Use `free`/`delete` for guest pointers;
the native host must not pass these adjusted pointers directly to
`wasm_runtime_module_free`. Host-created raw buffers likewise must not be
passed to guest `free`—use matching allocation and deallocation APIs.

The app heap is fixed at instantiation. The sysroot does not call `memory.grow`
to reserve a second heap. Allocation failure returns null with `ENOMEM`;
failed `realloc` preserves the original block. Ordinary `new` and PMR allocation
failure terminate with this exception-free runtime; nothrow `new` returns null.
No constant-time guarantee is made for copying, clearing, or the WAMR allocator.

The runtime is single-threaded, without RTTI, exceptions, an unwinder, or
filesystem/localization support. Serialize entry into each module instance.
Budget the Wasm auxiliary stack, WAMR operand/native stacks, and runtime
metadata separately from app-heap capacity. C++23 is the application language
mode; library availability still follows the selected LLVM release and these
runtime options. Standard input returns EOF. `system_clock` uses the UTC hook;
use `wamr::now()` for monotonic timestamps.

## Validation

From the source repository:

```sh
npm run build-wamr-sysroot -- --test --wamr-dir /path/to/wasm-micro-runtime
npm run test-wamr-sysroot -- --wamr-dir /path/to/wasm-micro-runtime
```

Tests build a native WAMR interpreter harness on Linux and compile a C++23
module against the extracted archive. They cover static allocation, C++23
library features, PMR, alignment, allocation exhaustion, and failed realloc.
