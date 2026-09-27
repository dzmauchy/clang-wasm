import fs from "node:fs";
import path from "node:path";

export function cleanLlvmProject(rootDir = process.cwd()) {
  const target = path.join(rootDir, "out", "llvm-project");
  if (fs.existsSync(target) || fs.lstatSync(target, { throwIfNoEntry: false })) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`Deleted: ${target}`);
  } else {
    console.log(`Already clean: ${target}`);
  }
}

export function cleanLlvm(rootDir = process.cwd()) {
  const target = path.join(rootDir, "out", "llvm");
  if (fs.existsSync(target) || fs.lstatSync(target, { throwIfNoEntry: false })) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`Deleted: ${target}`);
  } else {
    console.log(`Already clean: ${target}`);
  }
}

export function cleanEmsdk(rootDir = process.cwd()) {
  const target = path.join(rootDir, "out", "emsdk");
  if (fs.existsSync(target) || fs.lstatSync(target, { throwIfNoEntry: false })) {
    fs.rmSync(target, { recursive: true, force: true });
    console.log(`Deleted: ${target}`);
  } else {
    console.log(`Already clean: ${target}`);
  }
}

export function cleanAll(rootDir = process.cwd()) {
  cleanLlvmProject(rootDir);
  cleanLlvm(rootDir);
  cleanEmsdk(rootDir);
}
