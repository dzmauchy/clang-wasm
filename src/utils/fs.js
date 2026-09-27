import fs from "node:fs";
import path from "node:path";

/**
 * Ensures the project's 'out' directory exists.
 * If 'out' doesn't exist, creates it.
 * If 'out' or a symlink to another directory already exists, NEVER deletes it.
 * If 'out' is a symlink to a non-existent target, creates the target directory.
 */
export function ensureOutDir(rootDir = process.cwd()) {
  const outDir = path.join(rootDir, "out");
  try {
    const lstat = fs.lstatSync(outDir);
    if (lstat.isSymbolicLink()) {
      const linkTarget = fs.readlinkSync(outDir);
      const resolvedTarget = path.resolve(path.dirname(outDir), linkTarget);
      if (!fs.existsSync(resolvedTarget)) {
        fs.mkdirSync(resolvedTarget, { recursive: true });
      }
    }
    return outDir;
  } catch (err) {
    if (err.code === "ENOENT") {
      fs.mkdirSync(outDir, { recursive: true });
      return outDir;
    }
    throw err;
  }
}

export function getOutDir(rootDir = process.cwd()) {
  return path.join(rootDir, "out");
}

export function resolvePreferredLlvmDir(rootDir = process.cwd()) {
  return path.join(rootDir, "out", "llvm-project");
}

export function resolvePreferredEmsdkDir(rootDir = process.cwd()) {
  return path.join(rootDir, "out", "emsdk");
}

export function resolvePreferredHostLlvmDir(rootDir = process.cwd()) {
  return path.join(rootDir, "out", "llvm");
}
