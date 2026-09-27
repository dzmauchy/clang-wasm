import fs from "node:fs";
import path from "node:path";
import { run } from "../utils/exec.js";
import { ensureOutDir, resolvePreferredLlvmDir } from "../utils/fs.js";

export const DEFAULT_LLVM_REPO = "https://github.com/llvm/llvm-project.git";

export function ensureLlvmProject(rootDir, options = {}) {
  ensureOutDir(rootDir);
  const defaultDir = resolvePreferredLlvmDir(rootDir);
  const llvmDir = path.resolve(
    options.explicitLlvmDir ||
      process.env.LLVM_DIR ||
      defaultDir
  );
  const tag =
    options.tag ||
    process.env.LLVM_TAG ||
    (process.env.LLVM_VERSION
      ? `llvmorg-${process.env.LLVM_VERSION.trim()}`
      : undefined);
  if (!tag) {
    throw new Error("LLVM_VERSION environment variable is not defined");
  }
  const repoUrl = options.repoUrl || DEFAULT_LLVM_REPO;
  const dryRun = options.dryRun ?? false;

  const exists = fs.existsSync(llvmDir);
  const hasContent = exists && fs.readdirSync(llvmDir).length > 0;

  if (hasContent) {
    console.log(`Using existing LLVM source directory: ${llvmDir}`);
    return llvmDir;
  }

  console.log(
    `\n--- LLVM source directory not found. Fetching single tag '${tag}' into ${llvmDir} ---`
  );

  if (dryRun) {
    console.log(
      `[DRY RUN] Would run: git clone --depth 1 --branch ${tag} --single-branch ${repoUrl} "${llvmDir}"`
    );
    fs.mkdirSync(path.join(llvmDir, "llvm"), { recursive: true });
    return llvmDir;
  }

  // If directory exists but is empty, remove it so git clone can create it cleanly
  if (exists && !hasContent) {
    fs.rmdirSync(llvmDir);
  }

  run(
    `git clone --depth 1 --branch ${tag} --single-branch ${repoUrl} "${llvmDir}"`,
    rootDir,
    {},
    false
  );

  return llvmDir;
}
