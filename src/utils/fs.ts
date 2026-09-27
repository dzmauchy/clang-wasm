import fs from "node:fs";
import path from "node:path";

export const DEFAULT_SHARED_DIR = "/opt/shared";

export function isDirectoryWritable(dirPath: string): boolean {
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
  rootDir: string,
  sharedDir: string = DEFAULT_SHARED_DIR
): string {
  if (isDirectoryWritable(sharedDir)) {
    return path.join(sharedDir, "llvm-project");
  }
  return path.join(rootDir, "llvm-project");
}

export function resolvePreferredEmsdkDir(
  rootDir: string,
  sharedDir: string = DEFAULT_SHARED_DIR
): string {
  if (isDirectoryWritable(sharedDir)) {
    return path.join(sharedDir, "emsdk");
  }
  return path.join(rootDir, "emsdk");
}
