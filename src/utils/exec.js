import { execSync } from "node:child_process";

export function cleanFlags(str) {
  return str.trim().split(/\s+/v).join(" ");
}

export function formatBytes(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function run(
  command,
  cwd = process.cwd(),
  extraEnv = {},
  dryRun = false
) {
  const normalized = command
    .trim()
    .split("\n")
    .values()
    .map((line) => line.trim().replace(/\\$/, ""))
    .filter(Boolean)
    .toArray()
    .join(" ");

  console.log(`\n\x1b[36m>>> Running:\x1b[0m ${normalized} (in ${cwd})`);

  if (dryRun) {
    console.log(`\x1b[33m[DRY RUN] Skipping command execution\x1b[0m`);
    return;
  }

  execSync(normalized, {
    cwd,
    stdio: "inherit",
    shell: "/bin/bash",
    env: { ...process.env, NINJA_STATUS: "[%f/%t %e] ", ...extraEnv },
  });
}
