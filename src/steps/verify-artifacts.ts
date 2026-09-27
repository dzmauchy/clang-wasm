import fs from "node:fs";
import path from "node:path";
import type { ArtifactInfo, BuildConfig } from "../types.ts";
import { formatBytes } from "../utils/exec.ts";

export const REQUIRED_ARTIFACTS = [
  "clang.wasm",
  "clang.js",
  "lld.wasm",
  "lld.js",
  "sysroot.tgz",
] as const;

export function verifyArtifacts(config: BuildConfig): ArtifactInfo[] {
  console.log("\n\x1b[32mBuild finished successfully. Artifacts ready in dist/:\x1b[0m");

  const missing: string[] = [];
  const artifacts: ArtifactInfo[] = [];

  for (const artifact of REQUIRED_ARTIFACTS) {
    const filePath = path.join(config.distDir, artifact);
    if (!fs.existsSync(filePath)) {
      missing.push(artifact);
      continue;
    }

    const stat = fs.statSync(filePath);
    const info: ArtifactInfo = {
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
