import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { EnsureEmsdkOptions } from "../types.ts";
import { run } from "../utils/exec.ts";
import { isDirectoryWritable, DEFAULT_SHARED_DIR } from "../utils/fs.ts";

export const DEFAULT_EMSDK_VERSION = "6.0.9";
export const DEFAULT_EMSDK_REPO = "https://github.com/emscripten-core/emsdk.git";

export function applyEmsdkEnvironment(emsdkDir: string, dryRun: boolean): void {
  process.env.EMSDK = emsdkDir;

  if (dryRun) {
    return;
  }

  const emsdkBin = path.join(emsdkDir, "emsdk");
  if (fs.existsSync(emsdkBin)) {
    try {
      const output = execSync(`EMSDK_BASH=1 "${emsdkBin}" construct_env`, {
        encoding: "utf8",
        env: { ...process.env, EMSDK_QUIET: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const exportRegex =
        /export\s+([A-Za-z_][A-Za-z0-9_]*)=["']?(.*?)["']?;?$/gm;
      let match: RegExpExecArray | null;
      while ((match = exportRegex.exec(output)) !== null) {
        const [, key, val] = match;
        if (key && val !== undefined) {
          process.env[key] = val;
        }
      }
    } catch {
      // Fallback to manual PATH setup below
    }
  }

  const emscriptenBin = path.join(emsdkDir, "upstream/emscripten");
  const upstreamBin = path.join(emsdkDir, "upstream/bin");

  const currentPath = process.env.PATH || "";
  const existingParts = currentPath.split(path.delimiter);
  const pathsToAdd = [emscriptenBin, upstreamBin, emsdkDir].filter(
    (p) => fs.existsSync(p) && !existingParts.includes(p)
  );

  if (pathsToAdd.length > 0) {
    process.env.PATH = `${pathsToAdd.join(path.delimiter)}${path.delimiter}${currentPath}`;
  }
}

export function ensureEmsdk(
  rootDir: string,
  options: EnsureEmsdkOptions = {}
): string {
  const version = options.version || process.env.EMSDK_VERSION || DEFAULT_EMSDK_VERSION;
  const repoUrl = options.repoUrl || DEFAULT_EMSDK_REPO;
  const dryRun = options.dryRun ?? false;
  const sharedDir = options.sharedDir || DEFAULT_SHARED_DIR;

  // 1. If explicitEmsdkDir was provided
  if (options.explicitEmsdkDir) {
    const resolved = path.resolve(options.explicitEmsdkDir);
    if (fs.existsSync(resolved) || dryRun) {
      console.log(`Using explicitly provided EMSDK directory: ${resolved}`);
      applyEmsdkEnvironment(resolved, dryRun);
      return resolved;
    }
  }

  // 2. Determine target directory: prefer /opt/shared/emsdk if /opt/shared exists and is writable
  const sharedWritable = isDirectoryWritable(sharedDir);
  let targetDir: string;

  if (sharedWritable) {
    targetDir = path.join(sharedDir, "emsdk");
  } else if (process.env.EMSDK) {
    targetDir = path.resolve(process.env.EMSDK);
  } else {
    targetDir = path.resolve(rootDir, "emsdk");
  }

  // Check if target directory already exists and has emsdk installed
  if (fs.existsSync(targetDir)) {
    console.log(`Using existing EMSDK directory: ${targetDir}`);
    const emsdkBin = path.join(targetDir, "emsdk");
    const emscriptenDir = path.join(targetDir, "upstream/emscripten");

    if (!fs.existsSync(emscriptenDir) && fs.existsSync(emsdkBin) && !dryRun) {
      console.log(`\n\x1b[36m>>> Installing emsdk ${version}...\x1b[0m`);
      run(`"${emsdkBin}" install ${version}`, targetDir, {}, false);
      console.log(`\n\x1b[36m>>> Activating emsdk ${version}...\x1b[0m`);
      run(`"${emsdkBin}" activate ${version}`, targetDir, {}, false);
    }

    applyEmsdkEnvironment(targetDir, dryRun);
    return targetDir;
  }

  // 3. Target directory does not exist: download and activate emsdk
  console.log(
    `\n--- EMSDK not found. Downloading and setting up emsdk ${version} into ${targetDir} ---`
  );

  if (dryRun) {
    console.log(
      `[DRY RUN] Would clone emsdk from ${repoUrl} into ${targetDir}`
    );
    console.log(`[DRY RUN] Would run: ./emsdk install ${version}`);
    console.log(`[DRY RUN] Would run: ./emsdk activate ${version}`);
    applyEmsdkEnvironment(targetDir, true);
    return targetDir;
  }

  run(`git clone --depth 1 ${repoUrl} "${targetDir}"`, rootDir, {}, false);

  const emsdkBin = path.join(targetDir, "emsdk");
  const emscriptenDir = path.join(targetDir, "upstream/emscripten");

  if (!fs.existsSync(emscriptenDir)) {
    console.log(`\n\x1b[36m>>> Installing emsdk ${version}...\x1b[0m`);
    run(`"${emsdkBin}" install ${version}`, targetDir, {}, false);
  }

  console.log(`\n\x1b[36m>>> Activating emsdk ${version}...\x1b[0m`);
  run(`"${emsdkBin}" activate ${version}`, targetDir, {}, false);

  applyEmsdkEnvironment(targetDir, false);

  console.log(`Activated and using EMSDK at: ${targetDir}`);
  return targetDir;
}
