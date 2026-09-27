import fs from "node:fs";
import path from "node:path";
import { run } from "../utils/exec.js";
import {
  DEFAULT_SHARED_DIR,
  resolvePreferredHostLlvmDir,
} from "../utils/fs.js";

export const DEFAULT_HOST_LLVM_VERSION = "23.1.2";

export function getHostArchTag() {
  return process.arch === "arm64" ? "ARM64" : "X64";
}

export function applyHostLlvmEnvironment(hostLlvmDir, dryRun) {
  const binDir = path.join(hostLlvmDir, "bin");
  process.env.CC = path.join(binDir, "clang");
  process.env.CXX = path.join(binDir, "clang++");
  process.env.LD = path.join(binDir, "lld");

  if (dryRun) {
    return;
  }

  const currentPath = process.env.PATH || "";
  const existingParts = new Set(currentPath.split(path.delimiter));
  if (!existingParts.has(binDir)) {
    process.env.PATH = `${binDir}${path.delimiter}${currentPath}`;
  }
}

export function ensureHostLlvm(rootDir, options = {}) {
  const version =
    options.version || process.env.LLVM_VERSION || DEFAULT_HOST_LLVM_VERSION;
  const archTag = getHostArchTag();
  const dryRun = options.dryRun ?? false;
  const sharedDir = options.sharedDir || DEFAULT_SHARED_DIR;

  const targetDir = path.resolve(
    options.explicitHostLlvmDir ||
      process.env.HOST_LLVM_DIR ||
      resolvePreferredHostLlvmDir(rootDir, sharedDir)
  );

  const binDir = path.join(targetDir, "bin");
  const clangPath = path.join(binDir, "clang");
  const clangXXPath = path.join(binDir, "clang++");
  const lldPath = path.join(binDir, "lld");
  const ldLldPath = path.join(binDir, "ld.lld");
  const llvmStripPath = path.join(binDir, "llvm-strip");

  const effectiveLldPath = fs.existsSync(lldPath) ? lldPath : ldLldPath;

  const isPopulated =
    fs.existsSync(clangXXPath) &&
    (fs.existsSync(lldPath) || fs.existsSync(ldLldPath));

  if (isPopulated) {
    console.log(
      `Using existing host LLVM ${version} binaries at: ${targetDir}`
    );
    applyHostLlvmEnvironment(targetDir, dryRun);
    return {
      hostLlvmDir: targetDir,
      clangPath,
      clangXXPath,
      lldPath: effectiveLldPath,
      llvmStripPath,
    };
  }

  const archiveName = `LLVM-${version}-Linux-${archTag}.tar.xz`;
  const url = `https://github.com/llvm/llvm-project/releases/download/llvmorg-${version}/${archiveName}`;

  console.log(
    `\n--- Host LLVM ${version} binaries not found. Downloading and unpacking ${archiveName} into ${targetDir} ---`
  );

  if (dryRun) {
    console.log(`[DRY RUN] Would download ${url}`);
    console.log(`[DRY RUN] Would unpack ${archiveName} into ${targetDir}`);
    fs.mkdirSync(binDir, { recursive: true });
    fs.writeFileSync(clangPath, "#!/bin/sh\nexit 0\n");
    fs.writeFileSync(clangXXPath, "#!/bin/sh\nexit 0\n");
    fs.writeFileSync(lldPath, "#!/bin/sh\nexit 0\n");
    fs.writeFileSync(llvmStripPath, "#!/bin/sh\nexit 0\n");
    fs.chmodSync(clangPath, 0o755);
    fs.chmodSync(clangXXPath, 0o755);
    fs.chmodSync(lldPath, 0o755);
    fs.chmodSync(llvmStripPath, 0o755);
    applyHostLlvmEnvironment(targetDir, true);
    return {
      hostLlvmDir: targetDir,
      clangPath,
      clangXXPath,
      lldPath,
      llvmStripPath,
    };
  }

  fs.mkdirSync(targetDir, { recursive: true });

  run(
    `curl -fL "${url}" | tar -xJf - --strip-components=1 -C "${targetDir}"`,
    rootDir,
    {},
    false
  );

  applyHostLlvmEnvironment(targetDir, false);

  const finalLldPath = fs.existsSync(lldPath) ? lldPath : ldLldPath;
  console.log(`Successfully installed host LLVM ${version} to: ${targetDir}`);

  return {
    hostLlvmDir: targetDir,
    clangPath,
    clangXXPath,
    lldPath: finalLldPath,
    llvmStripPath,
  };
}
