import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SHARED_DIR = "/opt/shared";

export function isDirectoryWritable(dirPath) {
  try {
    if (!fs.existsSync(dirPath)) {
      return false;
    }
    const stat = fs.statSync(dirPath);
    if (!stat.isDirectory()) {
      return false;
    }
    fs.accessSync(dirPath, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolvePreferredLlvmDir(
  rootDir,
  sharedDir = DEFAULT_SHARED_DIR
) {
  if (isDirectoryWritable(sharedDir)) {
    return path.join(sharedDir, "llvm-project");
  }
  return path.join(rootDir, "llvm-project");
}

export function resolvePreferredEmsdkDir(
  rootDir,
  sharedDir = DEFAULT_SHARED_DIR
) {
  if (isDirectoryWritable(sharedDir)) {
    return path.join(sharedDir, "emsdk");
  }
  return path.join(rootDir, "emsdk");
}

export function resolvePreferredHostLlvmDir(
  rootDir,
  sharedDir = DEFAULT_SHARED_DIR
) {
  if (isDirectoryWritable(sharedDir)) {
    return path.join(sharedDir, "llvm");
  }
  return path.join(rootDir, "llvm");
}
