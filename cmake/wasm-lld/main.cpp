#include "lld/Common/Driver.h"
#include "lld/Common/ErrorHandler.h"
#include "llvm/ADT/SmallVector.h"

LLD_HAS_DRIVER(wasm)

int main(int argc, char **argv) {
  llvm::SmallVector<const char *, 256> args(argv, argv + argc);
  // The browser invokes lld.js, whose name does not identify a linker flavor.
  args[0] = "wasm-ld";
  const lld::DriverDef drivers[] = {{lld::Wasm, &lld::wasm::link}};
  const auto result = lld::lldMain(args, llvm::outs(), llvm::errs(), drivers);
  if (!result.canRunAgain)
    lld::exitLld(result.retCode);
  return result.retCode;
}
