# Browser Clang and bare Wasm sysroot

`npm run build -- --llvm-version 23.1.2` builds browser-hosted Clang and LLD
and produces `dist/clang.{js,wasm}`, `dist/lld.{js,wasm}`, and `dist/sysroot.tgz`.
Emscripten builds the tools. Compiled applications use TLSF, compiler-rt Wasm
builtins, and the small C++23 runtime exposed by `wasm.hpp`. The sysroot does not
include libc, libc++, libc++abi, or their standard-library headers.

The custom compiler in `cmake/wasm-clang` links Clang's driver, frontend, and
code generator through `LLVM_EXTERNAL_PROJECTS`. The linker in `cmake/wasm-lld`
includes only LLD's WebAssembly driver. Neither requires LLVM source patches.
Their build outputs live in `build-wasm/bin/custom-clang` and
`build-wasm/bin/wasm-only` respectively, and are packaged into `dist`.

The build host needs Node.js 24+, Git, CMake 3.24+, Ninja, Python 3 with PyYAML,
and Clang/LLVM tools with the WebAssembly backend. The pipeline downloads host
LLVM, LLVM sources, and Emscripten when needed. TLSF is vendored at a pinned
revision in `sysroot/tlsf`; its BSD license is packaged with each sysroot.

## Browser compiler

Mount the sysroot at `/sysroot` and sources at `/work` in the Emscripten
filesystem, then call:

```js
compiler.callMain([
  "-I", "/work/include",
  "-I", "/dependencies/include",
  "-o", "/work/build",
  "/work/main.cpp", "/work/helpers.cpp",
]);
```

`-I<dir>` and `-I <dir>` add
header search paths in the specified order. `-o <dir>` creates an output
directory, defaulting to the current working directory. Each input always
produces `<stem>.json` and `<stem>.o`. `-dump` and `--output-dir` are removed.

Compilation has three phases, completing each for every input before starting
the next. Each phase calls Clang's frontend once with the full input list;
Clang processes the inputs sequentially:

1. Precompile each source's initial header preamble into an in-memory PCH.
2. Emit JSON using that PCH and Clang's built-in JSON AST dumper.
3. Compile Wasm objects using the same PCH.

Per-input frontend callbacks select each source's PCH and output path. PCHs
remain in memory, and macros and declarations are isolated between source
files. No per-source compiler execution loop is used by the launcher.

Clang's preamble scanner preserves initial includes, macros, conditional
preprocessing, and header search relative to the original source path.
Source declarations are not compiled in the first phase. No custom AST
filtering is applied: the normal dumper avoids eagerly deserializing PCH
headers. Declarations loaded on demand can appear, and includes after the first
source declaration are parsed and dumped normally. Put headers at the beginning
of the source to benefit from precompilation. Bodies, types, comments, macros,
and default arguments follow Clang's normal JSON semantics.

Read outputs with `compiler.FS.readFile`. Diagnostics go to stderr. Failure
returns a nonzero status and removes partial outputs for the failing pass;
completed earlier outputs remain. Output-stem collisions and overwriting input
files are rejected before writing outputs. The launcher also accepts `--help`,
`--version`, and `--` before source paths starting with a dash.

All inputs compile as C++ with these defaults; linking is separate:

```text
--target=wasm32-unknown-unknown --sysroot=/sysroot
-ffreestanding -nostdinc++ -fvisibility=default
-resource-dir /sysroot/lib/clang/23
-fno-exceptions -fno-rtti -fno-threadsafe-statics -std=c++23 -O2
-fno-color-diagnostics -fmessage-length=0 -ferror-limit=0
-fparse-all-comments -I/work
```

The resource path is fixed to Clang 23; use matching LLVM sources and sysroot.

## Sysroot and runtime

```sh
npm run build-sysroot -- --llvm-version 23.1.2 --jobs 4 --test
npm run test-sysroot
```

The archive extracts to `sysroot/`; the installed directory also remains in
`dist/sysroot`. Use `--host-llvm-dir` or `HOST_LLVM_DIR` to choose host LLVM,
and `--llvm-dir` or `LLVM_DIR` to choose sources. Dependency builds remain
in `out/build-sysroot`.

Each build starts with an empty stage, installs Clang's core and WebAssembly
resource headers and compiler-rt builtins, then adds the project runtime.
Non-Wasm resource headers are excluded using LLVM's install targets.
The libraries are:

| Library | Purpose |
| --- | --- |
| `lib/libwasm.a` | Allocation wrappers, memory/string functions, C++ new/delete, minimal ABI hooks, constructor initialization |
| `lib/libtlsf.a` | TLSF pool allocator |
| `lib/libbrowser.a` | Console output |
| `lib/clang/<major>/lib/wasi/libclang_rt.builtins-wasm32.a` | Compiler arithmetic plus the integrated TLSF/allocation/memory/C++ runtime |

The builtins archive includes the objects from `libwasm.a` and `libtlsf.a`,
so linking the default compiler-rt runtime supplies both arithmetic and
allocation support. The split archives remain available for explicit links.
`wasm.hpp` is the runtime's single public header and requires C++23. It provides
ordinary, array, sized, aligned,
nothrow, and placement new/delete, plus `std::size_t`, `std::ptrdiff_t`,
`std::nullptr_t`, `std::nothrow`, and `std::align_val_t`.
It also exposes `malloc`, `free`, `calloc`, `realloc`, `aligned_alloc`,
`memcpy`, `memmove`, `memset`, `memcmp`, `strlen`, `strcmp`, `strncmp`,
`strcpy`, `putchar`, `puts`, `abort`, and `exit`. This is a small freestanding
API; containers, formatting, math functions, and the full C++ standard library are
not supplied. Include `wasm.hpp` instead of `<new>` or libc headers.

The TLSF heap starts after `__heap_base` and uses available linear memory.
When no existing block fits, the runtime calls `memory.grow` for enough
64 KiB pages to add another TLSF pool, including alignment and allocator
metadata. Memory limits come from the module's linker settings (such as
`-Wl,--max-memory=<bytes>`) and the host. There is no fixed heap configuration.
Freeing blocks allows reuse; linear memory does not shrink, and blocks from
different pools do not coalesce. Individual allocation sizes are also subject
to TLSF's block limit (approximately 1 GiB on wasm32). The allocator and runtime
are single-threaded. The allocator owns the memory after `__heap_base`, including
pages subsequently grown by the host.

Allocation failure returns null and sets `*wasm_errno_location()` to
`WASM_ENOMEM`; invalid `aligned_alloc` arguments set `WASM_EINVAL`.
`calloc` checks multiplication overflow. Failed `realloc` preserves the old
block; `realloc(ptr, 0)` frees it. Allocations have `max_align_t` alignment.
Ordinary `new` traps on failure; nothrow `new` returns null. `abort` and `exit`
trap. Returning from application exports does not run process teardown or static destructors.

## Compile and run

```sh
clang++ --target=wasm32-unknown-unknown -std=c++23 -O2 \
  -ffreestanding -nostdinc++ -fno-exceptions -fno-rtti -fno-threadsafe-statics \
  -nostdlib --sysroot=dist/sysroot \
  -resource-dir=dist/sysroot/lib/clang/23 \
  examples/browser.cpp -Ldist/sysroot/lib \
  -Ldist/sysroot/lib/clang/23/lib/wasi \
  -lbrowser -lclang_rt.builtins-wasm32 \
  -Wl,--no-entry -Wl,--export=wasm_initialize -Wl,--export-memory \
  -o examples/program.wasm
```

For browser-hosted LLD, pass the custom compiler's objects with:

```text
--no-entry --export=wasm_initialize --export-memory browser.o
-L/sysroot/lib -lbrowser -o program.wasm
```

The custom LLD links `libclang_rt.builtins-wasm32.a` by default, searching
`/sysroot/lib/clang/23/lib/wasi` after user-provided `-L` paths. Mount the
sysroot in the linker's filesystem as well as the compiler's. This supplies
compiler builtins, TLSF, new/delete, and constructor initialization; console
support still uses `-lbrowser` explicitly.

Replace `23` with the LLVM major used for a native build. Compile applications
with the exception, RTTI, and static-guard flags above. Native Clang's
`-nostdlib` disables implicit libraries and startup files; the command above
links compiler-rt explicitly. The custom compiler emits objects only, and the
custom LLD adds compiler-rt without adding libc or libc++, so no extra library
suppression flags are needed. `-ffreestanding`
is the custom compiler default: `__STDC_HOSTED__` is `0`, builtin assumptions
and unwind tables are disabled by default, and `main` is an ordinary function.
Export application functions for the host to call:

```cpp
#include <wasm.hpp>

extern "C" __attribute__((export_name("compute"))) int compute(int value) {
    return value * 2;
}
```

The runtime exports `void wasm_initialize()`, declared by `wasm.hpp`.
It initializes C++ static constructors once per module
instance. It has no application entry function and does not call application
exports. Link with `--no-entry --export=wasm_initialize` to include the initializer
from the runtime archive. No browser imports are needed for initialization.

The host initializes the instance, then calls whichever application exports it
needs:

```js
instance.exports.wasm_initialize();
const result = instance.exports.compute(21);
```

Repeated calls to `wasm_initialize()` do nothing after the first call. Create
a new instance for a fresh initialization. Serialize calls into each instance;
the runtime is single-threaded.

Serve `examples/` over HTTP and open `browser.html`. The page supplies
`env.js_print_char`, `env.js_now`, and `env.js_time`, initializes constructors,
and calls the example's `run_demo()` export.

`browser.hpp` includes `wasm.hpp`. `browser::print` and `browser::write` send
bytes to `js_print_char`, as do `puts` and `putchar`. `browser::now()` uses
`js_now` for monotonic milliseconds; `js_time()` uses Unix-epoch milliseconds.
Unused imports are omitted by the linker. `BROWSER_EXPORT(name)` exposes other
C-linkage functions.

## Validation

`npm test` checks the build pipeline and packaging. `npm run test-sysroot`
compiles against the extracted archive and runs with Node's WebAssembly engine.
It checks compiler-rt arithmetic, constructors, new/delete variants, memory and
string functions, alignment, dynamic growth beyond 4 MiB, pool exhaustion/reuse,
overflow, failed realloc, trapping new, failed memory growth with retry,
host-grown memory, allocation without browser imports, and the freestanding
application exports with explicit, one-time constructor initialization.

`npm run test-clang` tests header search, C++23/Wasm defaults, PCH-based JSON,
comments, macros, multi-source compilation, phase ordering, output collisions,
and invalid options. To test an unpackaged build:

```sh
npm run test-clang -- out/llvm-project/build-wasm/bin/custom-clang dist/sysroot
npm run test-lld -- out/llvm-project/build-wasm/bin/wasm-only
```

TLSF upstream: [mattconte/tlsf](https://github.com/mattconte/tlsf).
