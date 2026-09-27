import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const UBUNTU_LIBICU_URLS = Object.freeze({
  x64: [
    "https://archive.ubuntu.com/ubuntu/pool/main/i/icu/libicu70_70.1-2_amd64.deb",
    "https://security.ubuntu.com/ubuntu/pool/main/i/icu/libicu70_70.1-2_amd64.deb",
    "http://archive.ubuntu.com/ubuntu/pool/main/i/icu/libicu70_70.1-2_amd64.deb",
    "http://security.ubuntu.com/ubuntu/pool/main/i/icu/libicu70_70.1-2_amd64.deb",
  ],
  arm64: [
    "https://ports.ubuntu.com/pool/main/i/icu/libicu70_70.1-2_arm64.deb",
    "http://ports.ubuntu.com/pool/main/i/icu/libicu70_70.1-2_arm64.deb",
  ],
});

/**
 * Checks the libicu version installed in the host system.
 * Returns { isVersion70: boolean, detectedVersion: string | null }
 */
export function checkSystemLibicu() {
  if (process.platform !== "linux") {
    return { isVersion70: true, detectedVersion: null };
  }

  // 1. Check standard system library directories for libicu 70 files
  const searchDirs = [
    "/usr/lib",
    "/usr/lib64",
    "/usr/lib/x86_64-linux-gnu",
    "/usr/lib/aarch64-linux-gnu",
    "/lib",
    "/lib64",
    "/usr/local/lib",
    "/usr/local/lib64",
  ];

  for (const dir of searchDirs) {
    if (
      fs.existsSync(path.join(dir, "libicuuc.so.70")) ||
      fs.existsSync(path.join(dir, "libicui18n.so.70"))
    ) {
      return { isVersion70: true, detectedVersion: "70" };
    }
  }

  // 2. Check ldconfig cache for libicu 70
  try {
    const ldconfigOutput = execSync("ldconfig -p", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });

    if (
      /libicuuc\.so\.70\b/v.test(ldconfigOutput) ||
      /libicui18n\.so\.70\b/v.test(ldconfigOutput)
    ) {
      return { isVersion70: true, detectedVersion: "70" };
    }

    const match = /libicuuc\.so\.(?<major>\d+)/v.exec(ldconfigOutput);
    if (match?.groups?.major) {
      return {
        isVersion70: match.groups.major === "70",
        detectedVersion: match.groups.major,
      };
    }
  } catch {
    // ldconfig might fail or not exist in some minimal environments
  }

  // 3. Check pkg-config
  try {
    const pkgVersion = execSync("pkg-config --modversion icu-uc", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (pkgVersion) {
      const major = pkgVersion.split(".")[0];
      return { isVersion70: major === "70", detectedVersion: major };
    }
  } catch {
    // pkg-config not available
  }

  // 4. Check icu-config
  try {
    const icuConfigVersion = execSync("icu-config --version", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    if (icuConfigVersion) {
      const major = icuConfigVersion.split(".")[0];
      return { isVersion70: major === "70", detectedVersion: major };
    }
  } catch {
    // icu-config not available
  }

  // 5. Inspect searchDirs to identify what version is installed
  for (const dir of searchDirs) {
    if (fs.existsSync(dir)) {
      try {
        const files = fs.readdirSync(dir);
        for (const f of files) {
          const m = /^libicuuc\.so\.(?<major>\d+)/v.exec(f);
          if (m?.groups?.major) {
            return {
              isVersion70: m.groups.major === "70",
              detectedVersion: m.groups.major,
            };
          }
        }
      } catch {
        // ignore read error
      }
    }
  }

  return { isVersion70: false, detectedVersion: null };
}

/**
 * Extracts a named member from a deb/ar archive buffer.
 */
export function extractArMember(buffer, memberPrefix) {
  if (buffer.subarray(0, 8).toString("ascii") !== "!<arch>\n") {
    throw new Error("Invalid ar/deb archive: missing !<arch> signature");
  }
  let offset = 8;
  while (offset < buffer.length) {
    const name = buffer.subarray(offset, offset + 16).toString("ascii").trim();
    const sizeStr = buffer
      .subarray(offset + 48, offset + 58)
      .toString("ascii")
      .trim();
    const size = parseInt(sizeStr, 10);
    offset += 60;
    if (name.startsWith(memberPrefix)) {
      return buffer.subarray(offset, offset + size);
    }
    offset += size + (size % 2); // 2-byte alignment
  }
  return null;
}

/**
 * Downloads binary buffer synchronously trying multiple URLs.
 */
function downloadDebBufferSync(urls) {
  for (const url of urls) {
    try {
      const curlRes = spawnSync("curl", ["-sSfL", url], {
        maxBuffer: 60 * 1024 * 1024,
      });
      if (curlRes.status === 0 && curlRes.stdout.length > 0) {
        return curlRes.stdout;
      }
    } catch {
      // try next url
    }
  }
  throw new Error(`Failed to download libicu 70 from: ${urls.join(", ")}`);
}

/**
 * Decompresses data.tar.* into targetDir.
 */
function extractDataTar(dataTarBuffer, targetDir) {
  // Try tar with --zstd
  let res = spawnSync("tar", ["--zstd", "-xf", "-", "-C", targetDir], {
    input: dataTarBuffer,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (res.status === 0) {
    return;
  }

  // Try tar with -I zstd
  res = spawnSync("tar", ["-I", "zstd", "-xf", "-", "-C", targetDir], {
    input: dataTarBuffer,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (res.status === 0) {
    return;
  }

  // Try piping zstd -dc to tar
  const zstdRes = spawnSync("zstd", ["-d", "-c"], {
    input: dataTarBuffer,
    stdio: ["pipe", "pipe", "pipe"],
  });

  if (zstdRes.status === 0 && zstdRes.stdout.length > 0) {
    res = spawnSync("tar", ["-xf", "-", "-C", targetDir], {
      input: zstdRes.stdout,
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (res.status === 0) {
      return;
    }
  }

  throw new Error(
    `Failed to extract data.tar.zst: ${res.stderr?.toString() || "tar failed"}`
  );
}

/**
 * Recursively find directory containing libicu*.so files.
 */
function findLibicuDir(rootDir) {
  const queue = [rootDir];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!fs.existsSync(current)) continue;
    const entries = fs.readdirSync(current, { withFileTypes: true });
    let hasIcu = false;
    for (const entry of entries) {
      if (entry.isFile() || entry.isSymbolicLink()) {
        if (entry.name.startsWith("libicu")) {
          hasIcu = true;
          break;
        }
      } else if (entry.isDirectory()) {
        queue.push(path.join(current, entry.name));
      }
    }
    if (hasIcu) {
      return current;
    }
  }
  return null;
}

/**
 * Ensures libicu 70 is available in out/llvm/lib when running on Linux.
 * If system libicu version is not 70, downloads libicu 70 deb package
 * for the host architecture and installs the .so libraries into out/llvm/lib.
 */
export function ensureLibicu(hostLlvmDir, options = {}) {
  const dryRun = options.dryRun ?? false;
  const destLibDir = path.join(hostLlvmDir, "lib");

  if (process.platform !== "linux") {
    return { patched: false, reason: "not_linux" };
  }

  // If libicu 70 already exists in out/llvm/lib, nothing to do
  if (
    fs.existsSync(path.join(destLibDir, "libicuuc.so.70")) ||
    fs.existsSync(path.join(destLibDir, "libicui18n.so.70"))
  ) {
    console.log(`Using existing libicu 70 libraries in ${destLibDir}`);
    return { patched: false, reason: "already_present" };
  }

  // Check system libicu version
  const systemCheck = options.systemCheck || checkSystemLibicu();
  if (systemCheck.isVersion70) {
    console.log(
      "System libicu version is 70; no extra library download required."
    );
    return { patched: false, reason: "system_has_70" };
  }

  const detected = systemCheck.detectedVersion || "unknown";
  console.log(
    `\n--- System libicu version is ${detected} (not 70). Patching libicu 70 for lld into ${destLibDir} ---`
  );

  const archKey = process.arch === "arm64" ? "arm64" : "x64";
  const urls = UBUNTU_LIBICU_URLS[archKey];
  if (!urls) {
    throw new Error(
      `Unsupported architecture for libicu 70 download: ${process.arch}`
    );
  }

  if (dryRun) {
    console.log(
      `[DRY RUN] Would download libicu 70 for ${process.arch} and extract to ${destLibDir}`
    );
    fs.mkdirSync(destLibDir, { recursive: true });
    fs.writeFileSync(path.join(destLibDir, "libicuuc.so.70"), "");
    fs.writeFileSync(path.join(destLibDir, "libicui18n.so.70"), "");
    fs.writeFileSync(path.join(destLibDir, "libicudata.so.70"), "");
    return { patched: true, dryRun: true };
  }

  fs.mkdirSync(destLibDir, { recursive: true });

  console.log(`Downloading libicu 70 for ${process.arch}...`);
  const debBuffer = downloadDebBufferSync(urls);

  const dataTarBuffer = extractArMember(debBuffer, "data.tar");
  if (!dataTarBuffer) {
    throw new Error("data.tar not found in downloaded libicu deb package");
  }

  const tmpExtractDir = fs.mkdtempSync(
    path.join(os.tmpdir(), "libicu-extract-")
  );

  try {
    extractDataTar(dataTarBuffer, tmpExtractDir);

    const icuSrcDir = findLibicuDir(tmpExtractDir);
    if (!icuSrcDir) {
      throw new Error("libicu libraries not found inside extracted package");
    }

    const files = fs.readdirSync(icuSrcDir);
    for (const file of files) {
      if (file.startsWith("libicu")) {
        const srcPath = path.join(icuSrcDir, file);
        const dstPath = path.join(destLibDir, file);
        const lstat = fs.lstatSync(srcPath);

        // Remove existing file/symlink at destination if present
        if (fs.existsSync(dstPath) || fs.lstatSync(dstPath, { throwIfNoEntry: false })) {
          fs.rmSync(dstPath, { force: true });
        }

        if (lstat.isSymbolicLink()) {
          const linkTarget = fs.readlinkSync(srcPath);
          fs.symlinkSync(linkTarget, dstPath);
        } else {
          fs.copyFileSync(srcPath, dstPath);
        }
      }
    }

    console.log(`Successfully installed libicu 70 libraries to: ${destLibDir}`);
    return { patched: true, destLibDir };
  } finally {
    fs.rmSync(tmpExtractDir, { recursive: true, force: true });
  }
}
