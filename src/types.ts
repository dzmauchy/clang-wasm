export interface BuildConfig {
  rootDir: string;
  llvmDir: string;
  distDir: string;
  stageDir: string;
  emsdkDir: string;
  emscriptenSysroot: string;
  buildNativeDir: string;
  buildWasmDir: string;
  nativeBinDir: string;
  wasmBinDir: string;
  ninjaJobs: number;
  wasmOptPath: string;
  llvmStripPath: string;
  dryRun: boolean;
  llvmTag: string;
  emsdkVersion: string;
  hostLlvmDir: string;
  hostClangPath: string;
  hostClangXXPath: string;
  hostLldPath: string;
  cFlags: string;
  cxxFlags: string;
  exeLinkerFlags: string;
  wasmOptFlags: readonly string[];
  emscriptenPruneDirs: readonly string[];
  clangHeaderPrunePattern: RegExp;
  libPrunePattern: RegExp;
}

export interface ConfigOptions {
  rootDir?: string;
  llvmDir?: string;
  distDir?: string;
  emsdkDir?: string;
  ninjaJobs?: number;
  dryRun?: boolean;
  llvmTag?: string;
  emsdkVersion?: string;
  sharedDir?: string;
  hostLlvmDir?: string;
  hostClangPath?: string;
  hostClangXXPath?: string;
  hostLldPath?: string;
}

export interface EnsureLlvmOptions {
  explicitLlvmDir?: string;
  tag?: string;
  repoUrl?: string;
  sharedDir?: string;
  dryRun?: boolean;
}

export interface EnsureEmsdkOptions {
  explicitEmsdkDir?: string;
  version?: string;
  repoUrl?: string;
  sharedDir?: string;
  dryRun?: boolean;
}

export interface EnsureHostLlvmOptions {
  explicitHostLlvmDir?: string;
  version?: string;
  sharedDir?: string;
  dryRun?: boolean;
}

export interface HostLlvmInfo {
  hostLlvmDir: string;
  clangPath: string;
  clangXXPath: string;
  lldPath: string;
  llvmStripPath: string;
}

export interface ArtifactInfo {
  name: string;
  path: string;
  sizeBytes: number;
  sizeMB: string;
}
