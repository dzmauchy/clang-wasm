#include "clang/AST/ASTConsumer.h"
#include "clang/Basic/Diagnostic.h"
#include "clang/Basic/DiagnosticOptions.h"
#include "clang/Basic/SourceManager.h"
#include "clang/Basic/Version.h"
#include "clang/CodeGen/CodeGenAction.h"
#include "clang/Driver/Compilation.h"
#include "clang/Driver/Driver.h"
#include "clang/Driver/Job.h"
#include "clang/Driver/Tool.h"
#include "clang/Frontend/ASTConsumers.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/CompilerInvocation.h"
#include "clang/Frontend/FrontendActions.h"
#include "clang/Frontend/PCHContainerOperations.h"
#include "clang/Frontend/PrecompiledPreamble.h"
#include "clang/Frontend/TextDiagnosticPrinter.h"
#include "clang/Lex/PreprocessorOptions.h"
#include "clang/Serialization/ASTWriter.h"
#include "llvm/ADT/SmallString.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/MemoryBuffer.h"
#include "llvm/Support/Path.h"
#include "llvm/Support/TargetSelect.h"
#include "llvm/Support/VirtualFileSystem.h"
#include "llvm/Support/raw_ostream.h"

#include <memory>
#include <set>
#include <string>
#include <vector>

namespace {
struct Options {
  std::vector<std::string> sources;
  std::vector<std::string> includeDirs;
  std::string outputDir = ".";
};

int error(const llvm::Twine &message) {
  llvm::errs() << "clang: error: " << message << '\n';
  return 1;
}

void printHelp() {
  llvm::outs()
      << "Usage: clang [options] source.cpp [source.cpp ...]\n"
         "  -I <dir>, -I<dir>       Add a header search directory "
         "(repeatable)\n"
         "  -o <dir>               Write <stem>.o and <stem>.json here "
         "(default: .)\n"
         "  --                     Treat remaining arguments as source paths\n"
         "  -h, --help             Show this help\n"
         "  --version              Show the Clang version\n"
         "C++23, -O2, -ffreestanding, wasm32-unknown-unknown, /sysroot, "
         "/work "
         "includes,\n"
         "and disabled exceptions, RTTI, and threadsafe statics are "
         "implicit.\n";
}

bool parseOptions(int argc, char **argv, Options &options) {
  bool sourcePathsOnly = false;
  for (int i = 1; i < argc; ++i) {
    llvm::StringRef arg(argv[i]);
    if (!sourcePathsOnly && arg == "--") {
      sourcePathsOnly = true;
    } else if (!sourcePathsOnly && (arg == "-I" || arg == "-o")) {
      if (i + 1 == argc || !argv[i + 1][0]) {
        error("missing value for " + arg);
        return false;
      }
      const std::string value(argv[++i]);
      if (arg == "-I")
        options.includeDirs.push_back(value);
      else
        options.outputDir = value;
    } else if (!sourcePathsOnly && arg.starts_with("-I") && arg.size() > 2) {
      options.includeDirs.push_back(arg.drop_front(2).str());
    } else if (!sourcePathsOnly && arg.starts_with("-")) {
      error("unsupported option: " + arg);
      return false;
    } else {
      options.sources.push_back(arg.str());
    }
  }
  if (options.sources.empty()) {
    error("no input files (use --help for usage)");
    return false;
  }
  return true;
}

std::string outputPath(const Options &options, llvm::StringRef source,
                       llvm::StringRef extension) {
  llvm::SmallString<256> path(options.outputDir);
  llvm::sys::path::append(path, llvm::sys::path::filename(source));
  llvm::sys::path::replace_extension(path, extension);
  return std::string(path);
}

// Only route the built-in dumper to a managed file. Clang's normal lazy PCH
// traversal omits declarations from the precompiled headers.
class JsonASTDumpAction : public clang::ASTFrontendAction {
  std::unique_ptr<clang::ASTConsumer>
  CreateASTConsumer(clang::CompilerInstance &compiler,
                    llvm::StringRef input) override {
    auto output = compiler.createDefaultOutputFile(false, input, "json");
    if (!output)
      return nullptr;
    return clang::CreateASTDumper(std::move(output), "", true, false, false,
                                  false, clang::ADOF_JSON);
  }
};

struct Source {
  std::string path;
  std::unique_ptr<llvm::MemoryBuffer> buffer;
  std::unique_ptr<llvm::MemoryBuffer> preambleBuffer;
  clang::PreambleBounds bounds{0, false};
  std::string pchPath;
  std::shared_ptr<clang::PCHBuffer> pch;
};

std::shared_ptr<clang::CompilerInvocation>
createInvocation(const Options &options) {
  std::vector<std::string> args = {
      "clang",
      "--target=wasm32-unknown-unknown",
      "--sysroot=/sysroot",
      "-ffreestanding",
      "-nostdinc++",
      "-fvisibility=default",
      "-resource-dir",
      "/sysroot/lib/clang/23",
      "-fno-exceptions",
      "-fno-rtti",
      "-fno-threadsafe-statics",
      "-std=c++23",
      "-O2",
      "-fno-color-diagnostics",
      "-fmessage-length=0",
      "-ferror-limit=0",
      "-fparse-all-comments",
      "-I/work",
      "-x",
      "c++",
  };
  for (const auto &dir : options.includeDirs) {
    args.push_back("-I");
    args.push_back(dir);
  }
  args.push_back("-c");
  args.push_back("--");
  // cc1 still interprets a leading dash after the driver's -- is consumed.
  const auto &firstPath = options.sources.front();
  args.push_back(llvm::StringRef(firstPath).starts_with("-")
                     ? "./" + firstPath
                     : firstPath);

  std::vector<const char *> argv;
  for (const auto &arg : args)
    argv.push_back(arg.c_str());

  clang::DiagnosticOptions diagnosticOptions;
  diagnosticOptions.setShowColors(clang::ShowColorsKind::Off);
  diagnosticOptions.MessageLength = 0;
  diagnosticOptions.ErrorLimit = 0;
  clang::TextDiagnosticPrinter printer(llvm::errs(), diagnosticOptions);
  auto diagnostics = llvm::makeIntrusiveRefCnt<clang::DiagnosticsEngine>(
      clang::DiagnosticIDs::create(), diagnosticOptions, &printer, false);
  clang::driver::Driver driver("clang", "wasm32-unknown-unknown", *diagnostics);
  std::unique_ptr<clang::driver::Compilation> compilation(
      driver.BuildCompilation(argv));
  if (!compilation || diagnostics->hasErrorOccurred())
    return nullptr;

  // Translate driver options (notably sysroot header discovery) to a
  // single cc1 job and execute it in-process; Wasm cannot spawn a compiler.
  const auto &jobs = compilation->getJobs();
  if (jobs.size() != 1 ||
      llvm::StringRef(jobs.begin()->getCreator().getName()) != "clang" ||
      jobs.begin()->getArguments().empty() ||
      llvm::StringRef(jobs.begin()->getArguments().front()) != "-cc1") {
    error("expected one Clang frontend job");
    return nullptr;
  }
  auto invocation = std::make_shared<clang::CompilerInvocation>();
  if (!clang::CompilerInvocation::CreateFromArgs(
          *invocation,
          llvm::ArrayRef(jobs.begin()->getArguments()).drop_front(),
          *diagnostics, "clang"))
    return nullptr;

  // The normal command-line driver assumes cc1 exits after one file. This
  // launcher must release each translation unit before running the next pass.
  invocation->getFrontendOpts().DisableFree = false;
  invocation->getCodeGenOpts().DisableFree = false;
  return invocation;
}

bool prepareSources(const Options &options, clang::CompilerInvocation &invocation,
                    std::vector<Source> &sources) {
  const auto kind = invocation.getFrontendOpts().Inputs.front().getKind();
  invocation.getFrontendOpts().Inputs.clear();
  sources.reserve(options.sources.size());
  for (const auto &path : options.sources) {
    Source source;
    source.path = llvm::StringRef(path).starts_with("-") ? "./" + path : path;
    auto buffer = llvm::MemoryBuffer::getFile(source.path);
    if (!buffer) {
      error("cannot read " + source.path + ": " + buffer.getError().message());
      return false;
    }
    source.buffer = std::move(*buffer);
    source.bounds = clang::ComputePreambleBounds(
        invocation.getLangOpts(), source.buffer->getMemBufferRef(), 0);
    source.preambleBuffer = llvm::MemoryBuffer::getMemBufferCopy(
        source.buffer->getBuffer().take_front(source.bounds.Size), source.path);
    source.pchPath = "/__clang_pch/" + std::to_string(sources.size()) + ".pch";
    source.pch = std::make_shared<clang::PCHBuffer>();
    invocation.getFrontendOpts().Inputs.emplace_back(source.path, kind);
    sources.push_back(std::move(source));
  }
  return true;
}

enum class Phase { PCH, JSON, Object };

// ExecuteAction owns the input loop. This callback selects the source-specific
// buffers, PCH, and output before Clang initializes each translation unit.
template <class Action> class BatchAction : public Action {
protected:
  const Options &options;
  const clang::CompilerInvocation &base;
  std::vector<Source> &sources;
  Phase phase;
  size_t nextInput = 0;

  bool BeginInvocation(clang::CompilerInstance &compiler) override {
    if (compiler.getDiagnostics().hasErrorOccurred())
      return false;
    Source &source = sources[nextInput++];
    compiler.getLangOpts() = base.getLangOpts();
    compiler.getCodeGenOpts() = base.getCodeGenOpts();
    auto &pp = compiler.getPreprocessorOpts();
    pp = base.getPreprocessorOpts();
    pp.RetainRemappedFileBuffers = true;
    auto &frontend = compiler.getFrontendOpts();
    if (phase == Phase::PCH) {
      compiler.getLangOpts().CompilingPCH = true;
      pp.GeneratePreamble = true;
      pp.addRemappedFile(source.path, source.preambleBuffer.get());
      frontend.OutputFile = source.pchPath;
    } else {
      pp.addRemappedFile(source.path, source.buffer.get());
      pp.ImplicitPCHInclude = source.pchPath;
      pp.PrecompiledPreambleBytes = {source.bounds.Size,
                                    source.bounds.PreambleEndsAtStartOfLine};
      pp.DisablePCHOrModuleValidation =
          clang::DisableValidationForModuleKind::PCH;
      pp.UsePredefines = false;
      frontend.OutputFile =
          outputPath(options, source.path, phase == Phase::JSON ? "json" : "o");
    }
    return Action::BeginInvocation(compiler);
  }

public:
  BatchAction(const Options &options, const clang::CompilerInvocation &base,
              std::vector<Source> &sources, Phase phase)
      : options(options), base(base), sources(sources), phase(phase) {}
};

class BatchPCHAction : public BatchAction<clang::GeneratePCHAction> {
  std::unique_ptr<clang::ASTConsumer>
  CreateASTConsumer(clang::CompilerInstance &compiler,
                    llvm::StringRef) override {
    // Keep raw PCHs in memory, as PrecompiledPreamble::Build does. Later
    // phases expose them through a VFS without creating temporary files.
    const auto &source = sources[nextInput - 1];
    return std::make_unique<clang::PCHGenerator>(
        compiler.getPreprocessor(), compiler.getModuleCache(), "", "",
        source.pch, compiler.getCodeGenOpts(),
        compiler.getFrontendOpts().ModuleFileExtensions);
  }

public:
  using BatchAction::BatchAction;
};

bool runFrontend(const Options &options, const clang::CompilerInvocation &base,
                 std::vector<Source> &sources, Phase phase) {
  auto invocation = std::make_shared<clang::CompilerInvocation>(base);
  invocation->getFrontendOpts().ProgramAction =
      phase == Phase::PCH ? clang::frontend::GeneratePCH
      : phase == Phase::JSON ? clang::frontend::ASTDump
                            : clang::frontend::EmitObj;
  auto vfs = llvm::vfs::getRealFileSystem();
  if (phase != Phase::PCH) {
    auto pchFS = llvm::makeIntrusiveRefCnt<llvm::vfs::InMemoryFileSystem>();
    for (const auto &source : sources) {
      if (!source.pch->IsComplete) {
        error("cannot precompile headers for " + source.path);
        return false;
      }
      pchFS->addFile(source.pchPath, 0, llvm::MemoryBuffer::getMemBuffer(
          llvm::StringRef(source.pch->Data.data(), source.pch->Data.size()),
          source.pchPath, false));
    }
    auto overlay = llvm::makeIntrusiveRefCnt<llvm::vfs::OverlayFileSystem>(vfs);
    overlay->pushOverlay(pchFS);
    vfs = std::move(overlay);
  }
  clang::CompilerInstance compiler(std::move(invocation));
  compiler.createVirtualFileSystem(vfs);
  compiler.createDiagnostics();
  if (phase == Phase::PCH) {
    BatchPCHAction action(options, base, sources, phase);
    return compiler.ExecuteAction(action);
  }
  if (phase == Phase::JSON) {
    BatchAction<JsonASTDumpAction> action(options, base, sources, phase);
    return compiler.ExecuteAction(action);
  }
  BatchAction<clang::EmitObjAction> action(options, base, sources, phase);
  return compiler.ExecuteAction(action);
}
} // namespace

int main(int argc, char **argv) {
  if (argc == 2) {
    const llvm::StringRef arg(argv[1]);
    if (arg == "--help" || arg == "-h") {
      printHelp();
      return 0;
    }
    if (arg == "--version") {
      llvm::outs() << "Custom browser Clang " << CLANG_VERSION_STRING << '\n';
      return 0;
    }
  }
  Options options;
  if (!parseOptions(argc, argv, options))
    return 1;

  // Reject colliding basenames before writing anything to the output directory.
  std::set<std::string> outputs;
  for (const auto &source : options.sources) {
    const auto object = outputPath(options, source, "o");
    if (!outputs.insert(object).second)
      return error("input files map to the same output: " + object);
    for (const auto &input : options.sources)
      if (llvm::sys::fs::equivalent(input, object) ||
          llvm::sys::fs::equivalent(input, outputPath(options, source, "json")))
        return error("output would overwrite input file: " + input);
  }
  if (const auto ec = llvm::sys::fs::create_directories(options.outputDir))
    return error("cannot create output directory '" + options.outputDir +
                 "': " + ec.message());

  llvm::InitializeAllTargets();
  llvm::InitializeAllTargetMCs();
  llvm::InitializeAllAsmPrinters();
  llvm::InitializeAllAsmParsers();

  // Give Clang the full input list once per phase.
  auto invocation = createInvocation(options);
  if (!invocation)
    return 1;
  std::vector<Source> sources;
  if (!prepareSources(options, *invocation, sources))
    return 1;
  if (!runFrontend(options, *invocation, sources, Phase::PCH))
    return 1;
  if (!runFrontend(options, *invocation, sources, Phase::JSON))
    return 1;
  if (!runFrontend(options, *invocation, sources, Phase::Object))
    return 1;
  return 0;
}
