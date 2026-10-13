import wasm32 from "./wasm32.js";
import arm8 from "./arm8.js";

/**
 * Registry of supported targets. To add one, create a descriptor module next
 * to wasm32.js/arm8.js, register it here, and add a release workflow that
 * calls .github/workflows/build-target.yml with the new id.
 */
export const DEFAULT_TARGET_ID = "wasm32";

export const TARGETS = Object.freeze(
  Object.fromEntries([wasm32, arm8].map((target) => [target.id, target]))
);

export function resolveTarget(id = process.env.TARGET || DEFAULT_TARGET_ID) {
  const target = TARGETS[id];
  if (!target) {
    throw new Error(`Unknown target "${id}". Available targets: ${Object.keys(TARGETS).join(", ")}`);
  }
  return target;
}

export function releaseTag(target, llvmVersion) {
  return `clang-${llvmVersion}${target.tagSuffix}`;
}

/** Suffix for per-target directories; the default target keeps legacy names. */
export function targetDirSuffix(target) {
  return target.id === DEFAULT_TARGET_ID ? "" : `-${target.id}`;
}
