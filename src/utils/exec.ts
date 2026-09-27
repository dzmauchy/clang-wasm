import { execSync } from "node:child_process";

export function cleanFlags(str: string): string {
  return str.trim().split(/\s+/).join(" ");
}

export function formatBytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function run(
  command: string,
  cwd: string = process.cwd(),
  extraEnv: Record<string, string | undefined> = {},
  dryRun: boolean = false
): void {
  const normalized = command
    .trim()
    .split("\n")
    .map((line) => line.trim().replace(/\\$/, ""))
    .filter(Boolean)
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
