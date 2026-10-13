#include "browser_lld.h"
#include "lld/Common/Driver.h"
#include "lld/Common/ErrorHandler.h"
#include "llvm/ADT/SmallVector.h"

// The extra level of indirection expands the flavor macro before token pasting.
#define BROWSER_HAS_DRIVER(name) LLD_HAS_DRIVER(name)
BROWSER_HAS_DRIVER(BROWSER_LLD_NAMESPACE)

int main(int argc, char **argv) {
  llvm::SmallVector<const char *, 256> args(argv, argv + argc);
  // The browser invokes lld.js, whose name does not identify a linker flavor.
  args[0] = BROWSER_LLD_PROGRAM;
  // Match the custom compiler's resource directory. User-provided -L paths
  // take precedence; archive members are loaded only when needed.
  static const char *const defaultArgs[] = {BROWSER_LLD_ARGS_INIT nullptr};
  for (const char *const *arg = defaultArgs; *arg; ++arg)
    args.push_back(*arg);
  const lld::DriverDef drivers[] = {
      {lld::BROWSER_LLD_DRIVER_FLAVOR, &lld::BROWSER_LLD_NAMESPACE::link}};
  const auto result = lld::lldMain(args, llvm::outs(), llvm::errs(), drivers);
  if (!result.canRunAgain)
    lld::exitLld(result.retCode);
  return result.retCode;
}
