import fs from "node:fs";
import path from "node:path";
import { formatBytes } from "../utils/exec.js";

export const REQUIRED_ARTIFACTS = Object.freeze([
  "clang.wasm",
  "clang.js",
  "lld.wasm",
  "lld.js",
  "sysroot.tgz",
]);

export function verifyArtifacts(config) {
  console.log("\n\x1b[32mBuild finished successfully. Artifacts ready in dist/:\x1b[0m");

  const missing = [];
  const artifacts = [];

  for (const artifact of REQUIRED_ARTIFACTS) {
    const filePath = path.join(config.distDir, artifact);
    if (!fs.existsSync(filePath)) {
      missing.push(artifact);
      continue;
    }

    const stat = fs.statSync(filePath);
    const info = {
      name: artifact,
      path: filePath,
      sizeBytes: stat.size,
      sizeMB: formatBytes(stat.size),
    };
    artifacts.push(info);
    console.log(` - ${info.name} (${info.sizeMB})`);
  }

  if (missing.length > 0) {
    throw new Error(
      `Build incomplete. Missing expected artifacts in ${config.distDir}: ${missing.join(", ")}`
    );
  }

  return artifacts;
}
