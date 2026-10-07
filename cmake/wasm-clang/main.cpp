#include "clang/AST/ASTConsumer.h"
#include "clang/AST/JSONNodeDumper.h"
#include "clang/Basic/Diagnostic.h"
#include "clang/Basic/DiagnosticOptions.h"
#include "clang/Basic/SourceManager.h"
#include "clang/Basic/Version.h"
#include "clang/CodeGen/CodeGenAction.h"
#include "clang/Driver/Compilation.h"
#include "clang/Driver/Driver.h"
#include "clang/Driver/Job.h"
#include "clang/Driver/Tool.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/CompilerInvocation.h"
#include "clang/Frontend/FrontendActions.h"
#include "clang/Frontend/TextDiagnosticPrinter.h"
#include "llvm/ADT/SmallString.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/Path.h"
#include "llvm/Support/TargetSelect.h"
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
  bool dump = false;
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
         "  --include-dir <dir>     Same as -I\n"
         "  -dump                  Write JSON ASTs before compiling any "
         "objects\n"
         "  --output-dir <dir>      Write <stem>.o and <stem>.json here "
         "(default: .)\n"
         "  -o <dir>               Same as --output-dir\n"
         "  --                     Treat remaining arguments as source paths\n"
         "  -h, --help             Show this help\n"
         "  --version              Show the Clang version\n"
         "C++23, -O2, wasm32-unknown-unknown, /sysroot, libc++, /work "
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
    } else if (!sourcePathsOnly && arg == "-dump") {
      options.dump = true;
    } else if (!sourcePathsOnly && (arg == "-I" || arg == "--include-dir" ||
                                    arg == "--output-dir" || arg == "-o")) {
      if (i + 1 == argc || !argv[i + 1][0]) {
        error("missing value for " + arg);
        return false;
      }
      const std::string value(argv[++i]);
      if (arg == "-I" || arg == "--include-dir")
        options.includeDirs.push_back(value);
      else
        options.outputDir = value;
    } else if (!sourcePathsOnly && arg.starts_with("-I") && arg.size() > 2) {
      options.includeDirs.push_back(arg.drop_front(2).str());
    } else if (!sourcePathsOnly && arg.starts_with("--include-dir=")) {
      const auto value = arg.drop_front(sizeof("--include-dir=") - 1);
      if (value.empty()) {
        error("missing value for --include-dir");
        return false;
      }
      options.includeDirs.push_back(value.str());
    } else if (!sourcePathsOnly && arg.starts_with("--output-dir=")) {
      const auto value = arg.drop_front(sizeof("--output-dir=") - 1);
      if (value.empty()) {
        error("missing value for --output-dir");
        return false;
      }
      options.outputDir = value.str();
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

// Retain the normal JSON shape and complete bodies of source declarations,
// without traversing the much larger declaration trees of included headers.
class MainFileASTConsumer : public clang::ASTConsumer {
  std::unique_ptr<llvm::raw_pwrite_stream> output;

  static void dumpDeclaration(clang::JSONDumper &dumper,
                              const clang::Decl *decl,
                              const clang::SourceManager &sourceManager) {
    const auto location = sourceManager.getExpansionLoc(decl->getLocation());
    if (location.isInvalid() ||
        !sourceManager.isWrittenInMainFile(location))
      return;

    // An include can appear inside a source-owned namespace, extern "C", or
    // export block. Filter their children too, preserving the wrapper itself.
    if (llvm::isa<clang::NamespaceDecl, clang::LinkageSpecDecl,
                  clang::ExportDecl>(decl)) {
      auto &nodeDumper = dumper.doGetNodeDelegate();
      nodeDumper.AddChild([&, decl] {
        nodeDumper.Visit(decl);
        for (const auto *child : llvm::cast<clang::DeclContext>(decl)->decls())
          dumpDeclaration(dumper, child, sourceManager);
        for (const auto *attribute : decl->attrs())
          dumper.Visit(attribute);
        if (const auto *comment =
                decl->getASTContext().getLocalCommentForDeclUncached(decl))
          dumper.Visit(comment, comment);
      });
    } else {
      // Keep expression trees, type information, default arguments, and
      // comments, including references to declarations supplied by headers.
      dumper.Visit(decl);
    }
  }

public:
  explicit MainFileASTConsumer(
      std::unique_ptr<llvm::raw_pwrite_stream> output)
      : output(std::move(output)) {}

  void HandleTranslationUnit(clang::ASTContext &context) override {
    const auto &sourceManager = context.getSourceManager();
    clang::JSONDumper dumper(*output, sourceManager, context,
                            context.getPrintingPolicy(),
                            &context.getCommentCommandTraits());
    const auto *unit = context.getTranslationUnitDecl();
    auto &nodeDumper = dumper.doGetNodeDelegate();
    nodeDumper.AddChild([&] {
      nodeDumper.Visit(unit);
      for (const auto *decl : unit->decls())
        dumpDeclaration(dumper, decl, sourceManager);
    });
    *output << '\n';
  }
};

// A managed output stream lets Clang remove partial dumps on parse errors.
class JsonASTDumpAction : public clang::ASTFrontendAction {
  std::unique_ptr<clang::ASTConsumer>
  CreateASTConsumer(clang::CompilerInstance &compiler,
                    llvm::StringRef input) override {
    auto output = compiler.createDefaultOutputFile(false, input, "json");
    if (!output)
      return nullptr;
    return std::make_unique<MainFileASTConsumer>(std::move(output));
  }
};

bool runFrontend(const Options &options, llvm::StringRef source, bool dump) {
  std::vector<std::string> args = {
      "clang",
      "--target=wasm32-unknown-unknown",
      "--sysroot=/sysroot",
      "-stdlib=libc++",
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
  if (dump) {
    args.insert(args.end(), {"-fsyntax-only", "-Xclang", "-ast-dump=json"});
  } else {
    args.push_back("-c");
  }
  args.push_back("-o");
  args.push_back(outputPath(options, source, dump ? "json" : "o"));
  args.push_back("--");
  // cc1 still interprets a leading dash after the driver's -- is consumed.
  args.push_back(source.starts_with("-") ? ("./" + source).str() : source.str());

  std::vector<const char *> argv;
  for (const auto &arg : args)
    argv.push_back(arg.c_str());

  clang::DiagnosticOptions diagnosticOptions;
  diagnosticOptions.setShowColors(clang::ShowColorsKind::Off);
  diagnosticOptions.MessageLength = 0;
  diagnosticOptions.ErrorLimit = 0;
  clang::TextDiagnosticPrinter printer(llvm::errs(), diagnosticOptions);
  clang::DiagnosticsEngine diagnostics(clang::DiagnosticIDs::create(),
                                       diagnosticOptions, &printer, false);
  clang::driver::Driver driver("clang", "wasm32-unknown-unknown", diagnostics);
  std::unique_ptr<clang::driver::Compilation> compilation(
      driver.BuildCompilation(argv));
  if (!compilation || diagnostics.hasErrorOccurred())
    return false;

  // Translate driver options (notably sysroot/libc++ header discovery) to a
  // single cc1 job and execute it in-process; Wasm cannot spawn a compiler.
  const auto &jobs = compilation->getJobs();
  if (jobs.size() != 1 ||
      llvm::StringRef(jobs.begin()->getCreator().getName()) != "clang" ||
      jobs.begin()->getArguments().empty() ||
      llvm::StringRef(jobs.begin()->getArguments().front()) != "-cc1") {
    error("expected one Clang frontend job for " + source);
    return false;
  }
  auto invocation = std::make_shared<clang::CompilerInvocation>();
  if (!clang::CompilerInvocation::CreateFromArgs(
          *invocation,
          llvm::ArrayRef(jobs.begin()->getArguments()).drop_front(),
          diagnostics, "clang"))
    return false;

  // The normal command-line driver assumes cc1 exits after one file. This
  // launcher must release each translation unit before running the next pass.
  invocation->getFrontendOpts().DisableFree = false;
  invocation->getCodeGenOpts().DisableFree = false;
  // The driver omits -o from syntax-only cc1 jobs; our AST action writes a
  // file.
  invocation->getFrontendOpts().OutputFile =
      outputPath(options, source, dump ? "json" : "o");
  clang::CompilerInstance compiler(std::move(invocation));
  compiler.createVirtualFileSystem();
  compiler.createDiagnostics();
  if (dump) {
    JsonASTDumpAction action;
    return compiler.ExecuteAction(action);
  }
  clang::EmitObjAction action;
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
          (options.dump && llvm::sys::fs::equivalent(
                               input, outputPath(options, source, "json"))))
        return error("output would overwrite input file: " + input);
  }
  if (const auto ec = llvm::sys::fs::create_directories(options.outputDir))
    return error("cannot create output directory '" + options.outputDir +
                 "': " + ec.message());

  llvm::InitializeAllTargets();
  llvm::InitializeAllTargetMCs();
  llvm::InitializeAllAsmPrinters();
  llvm::InitializeAllAsmParsers();

  // Complete the AST phase for every source before generating any .o files.
  if (options.dump)
    for (const auto &source : options.sources)
      if (!runFrontend(options, source, true))
        return 1;
  for (const auto &source : options.sources)
    if (!runFrontend(options, source, false))
      return 1;
  return 0;
}
