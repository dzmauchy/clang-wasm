import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  checkSystemLibicu,
  extractArMember,
  ensureLibicu,
} from "../src/steps/ensure-libicu.js";

test("checkSystemLibicu returns object with isVersion70 and detectedVersion", () => {
  const result = checkSystemLibicu();
  assert.equal(typeof result, "object");
  assert.equal(typeof result.isVersion70, "boolean");
  if (process.platform === "linux") {
    assert.ok("detectedVersion" in result);
  }
});

test("extractArMember extracts member from valid ar archive", () => {
  // Construct a minimal ar archive buffer
  const memberName = "test.txt";
  const memberContent = Buffer.from("hello ar archive");
  const size = memberContent.length;

  const header = Buffer.alloc(60, " ");
  header.write(memberName, 0, memberName.length, "ascii");
  header.write("0", 16, 1, "ascii"); // timestamp
  header.write("0", 28, 1, "ascii"); // owner
  header.write("0", 34, 1, "ascii"); // group
  header.write("100644", 40, 6, "ascii"); // mode
  header.write(size.toString(10), 48, size.toString(10).length, "ascii"); // size
  header.write("\x60\n", 58, 2, "binary");

  const arArchive = Buffer.concat([
    Buffer.from("!<arch>\n", "ascii"),
    header,
    memberContent,
  ]);

  const extracted = extractArMember(arArchive, "test.txt");
  assert.ok(extracted);
  assert.equal(extracted.toString("utf8"), "hello ar archive");

  const notFound = extractArMember(arArchive, "nonexistent");
  assert.equal(notFound, null);
});

test("extractArMember throws on invalid ar signature", () => {
  assert.throws(
    () => extractArMember(Buffer.from("not-an-ar-archive"), "file"),
    /Invalid ar\/deb archive/
  );
});

test("ensureLibicu in dryRun mode creates mock libicu files when version != 70", () => {
  const tmpHostLlvm = fs.mkdtempSync(path.join(os.tmpdir(), "icu-host-llvm-dry-"));
  try {
    const result = ensureLibicu(tmpHostLlvm, {
      dryRun: true,
      systemCheck: { isVersion70: false, detectedVersion: "78" },
    });

    if (process.platform === "linux") {
      assert.equal(result.patched, true);
      assert.equal(result.dryRun, true);
      const libDir = path.join(tmpHostLlvm, "lib");
      assert.ok(fs.existsSync(path.join(libDir, "libicuuc.so.70")));
      assert.ok(fs.existsSync(path.join(libDir, "libicui18n.so.70")));
      assert.ok(fs.existsSync(path.join(libDir, "libicudata.so.70")));
    }
  } finally {
    fs.rmSync(tmpHostLlvm, { recursive: true, force: true });
  }
});

test("ensureLibicu skips when system already has libicu 70", () => {
  const tmpHostLlvm = fs.mkdtempSync(path.join(os.tmpdir(), "icu-host-llvm-has-70-"));
  try {
    const result = ensureLibicu(tmpHostLlvm, {
      dryRun: true,
      systemCheck: { isVersion70: true, detectedVersion: "70" },
    });

    assert.equal(result.patched, false);
    assert.equal(result.reason, "system_has_70");
    const libDir = path.join(tmpHostLlvm, "lib");
    assert.equal(fs.existsSync(path.join(libDir, "libicuuc.so.70")), false);
  } finally {
    fs.rmSync(tmpHostLlvm, { recursive: true, force: true });
  }
});

test("ensureLibicu skips when out/llvm/lib already contains libicu 70", () => {
  const tmpHostLlvm = fs.mkdtempSync(path.join(os.tmpdir(), "icu-host-llvm-exists-"));
  try {
    const libDir = path.join(tmpHostLlvm, "lib");
    fs.mkdirSync(libDir, { recursive: true });
    fs.writeFileSync(path.join(libDir, "libicuuc.so.70"), "existing-lib");

    const result = ensureLibicu(tmpHostLlvm, {
      dryRun: false,
      systemCheck: { isVersion70: false, detectedVersion: "78" },
    });

    assert.equal(result.patched, false);
    assert.equal(result.reason, "already_present");
  } finally {
    fs.rmSync(tmpHostLlvm, { recursive: true, force: true });
  }
});
