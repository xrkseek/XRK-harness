/**
 * Prepare bundled upstream Node.js + pinned pnpm for Desktop packaging (ADR-0008).
 * Downloads official Node archives (SHA-256 verified) and copies the pinned pnpm package.
 */

import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { chmod } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import {
  resolveDesktopPackageTarget,
  type DesktopPackageTarget,
  type DesktopPackageTargetName,
} from "./package-targets.js";
import {
  resolveDesktopAppRoot,
  resolveDesktopBuildTarget,
  desktopTargetBuildPaths,
  type DesktopTargetBuildPaths,
} from "./build-paths.js";

/** Bundled Host Node (must satisfy workspace engines.node >=26). */
export const DESKTOP_BUNDLED_NODE_VERSION = "26.8.1" as const;

/** Pinned pnpm (matches root packageManager). */
export const DESKTOP_BUNDLED_PNPM_VERSION = "11.22.0" as const;

/** Written to `<runtime>/versions.json` after a successful prepare. */
export interface DesktopRuntimeVersions {
  readonly schemaVersion: 1;
  readonly node: string;
  readonly pnpm: string;
  readonly target: DesktopPackageTargetName;
}

type NodeArchivePlatform = "darwin" | "win";

export interface PrepareDesktopRuntimeOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly appRoot?: string;
  readonly targetName?: string;
  readonly nodeVersion?: string;
  readonly pnpmVersion?: string;
  /** Override download (tests). */
  readonly download?: (url: string, destPath: string) => Promise<void>;
  /** Override archive extract (tests). */
  readonly extractArchive?: (
    archivePath: string,
    destDir: string,
  ) => Promise<void>;
  /** Override pnpm package discovery (tests). */
  readonly resolvePnpmPackage?: () => {
    readonly directory: string;
    readonly version: string;
  };
  /** Skip spawning the prepared node binary (cross-compile / tests). */
  readonly skipExecutableVerify?: boolean;
}

function nodeArchivePlatform(target: DesktopPackageTarget): NodeArchivePlatform {
  if (target.platform === "win32") return "win";
  if (target.platform === "darwin") return "darwin";
  throw new Error(
    `xrk desktop runtime: unsupported Node archive platform ${target.platform}`,
  );
}

/** Official Node.js archive folder / file stem for a target. */
export function desktopNodeArchiveStem(
  nodeVersion: string,
  target: DesktopPackageTarget,
): string {
  const platform = nodeArchivePlatform(target);
  return `node-v${nodeVersion}-${platform}-${target.arch}`;
}

export function desktopNodeArchiveName(
  nodeVersion: string,
  target: DesktopPackageTarget,
): string {
  const stem = desktopNodeArchiveStem(nodeVersion, target);
  return target.platform === "win32" ? `${stem}.zip` : `${stem}.tar.gz`;
}

export function parseNodeSha256Line(
  sumsText: string,
  archiveName: string,
): string {
  const line = sumsText
    .split(/\r?\n/u)
    .find((candidate) => candidate.endsWith(`  ${archiveName}`));
  if (line === undefined) {
    throw new Error(
      `xrk desktop runtime: ${archiveName} is absent from Node.js SHASUMS256.txt`,
    );
  }
  const expected = line.split(/\s+/u)[0];
  if (!expected) {
    throw new Error(
      `xrk desktop runtime: invalid SHASUMS256 line for ${archiveName}`,
    );
  }
  return expected;
}

async function defaultDownload(url: string, destPath: string): Promise<void> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `xrk desktop runtime: ${url} returned HTTP ${String(response.status)}`,
    );
  }
  writeFileSync(destPath, new Uint8Array(await response.arrayBuffer()), {
    mode: 0o600,
  });
}

async function defaultExtractArchive(
  archivePath: string,
  destDir: string,
): Promise<void> {
  mkdirSync(destDir, { recursive: true });
  const result = spawnSync(
    "tar",
    ["-xf", archivePath, "-C", destDir],
    { encoding: "utf8" },
  );
  if (result.error !== undefined || result.status !== 0) {
    const fromProcess =
      result.error?.message ?? (result.stderr ?? "").trim();
    const detail =
      fromProcess === "" || fromProcess === undefined
        ? `exit ${String(result.status)}`
        : fromProcess;
    throw new Error(`xrk desktop runtime: tar extract failed: ${detail}`);
  }
}

function defaultResolvePnpmPackage(expectedVersion: string): {
  directory: string;
  version: string;
} {
  const require = createRequire(
    path.join(resolveDesktopAppRoot(), "package.json"),
  );
  let manifestPath: string;
  try {
    manifestPath = require.resolve("pnpm/package.json");
  } catch {
    throw new Error(
      `xrk desktop runtime: pnpm@${expectedVersion} is not installed under @xrkseek/harness-desktop (add as devDependency)`,
    );
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    version?: unknown;
  };
  if (typeof manifest.version !== "string") {
    throw new Error("xrk desktop runtime: pnpm manifest has no version");
  }
  if (manifest.version !== expectedVersion) {
    throw new Error(
      `xrk desktop runtime: expected pnpm@${expectedVersion}, found ${manifest.version}`,
    );
  }
  return { directory: path.dirname(manifestPath), version: manifest.version };
}

function hostCanExecuteTarget(
  target: DesktopPackageTarget,
  hostPlatform: NodeJS.Platform,
  hostArch: string,
): boolean {
  if (target.platform !== hostPlatform) return false;
  if (target.arch === hostArch) return true;
  return (
    target.platform === "darwin" &&
    target.arch === "x64" &&
    hostArch === "arm64"
  );
}

async function prepareNode(options: {
  readonly target: DesktopPackageTarget;
  readonly paths: DesktopTargetBuildPaths;
  readonly nodeVersion: string;
  readonly download: (url: string, destPath: string) => Promise<void>;
  readonly extractArchive: (
    archivePath: string,
    destDir: string,
  ) => Promise<void>;
  readonly skipExecutableVerify: boolean;
  readonly hostPlatform: NodeJS.Platform;
  readonly hostArch: string;
}): Promise<void> {
  const archiveName = desktopNodeArchiveName(options.nodeVersion, options.target);
  const folder = desktopNodeArchiveStem(options.nodeVersion, options.target);
  const releaseRoot = `https://nodejs.org/download/release/v${options.nodeVersion}`;
  const archive = path.join(options.paths.downloads, archiveName);
  const sums = path.join(
    options.paths.downloads,
    `node-v${options.nodeVersion}-SHASUMS256.txt`,
  );
  mkdirSync(options.paths.downloads, { recursive: true });
  if (!existsSync(archive)) {
    await options.download(`${releaseRoot}/${archiveName}`, archive);
  }
  if (!existsSync(sums)) {
    await options.download(`${releaseRoot}/SHASUMS256.txt`, sums);
  }
  const expected = parseNodeSha256Line(readFileSync(sums, "utf8"), archiveName);
  const actual = createHash("sha256")
    .update(readFileSync(archive))
    .digest("hex");
  if (actual !== expected) {
    throw new Error(
      `xrk desktop runtime: checksum mismatch for ${archiveName}`,
    );
  }

  const extraction = options.paths.nodeExtract;
  rmSync(extraction, { recursive: true, force: true });
  mkdirSync(extraction, { recursive: true });
  await options.extractArchive(archive, extraction);

  const source = path.join(
    extraction,
    folder,
    options.target.platform === "win32" ? "node.exe" : path.join("bin", "node"),
  );
  if (!existsSync(source)) {
    throw new Error(
      `xrk desktop runtime: extracted Node binary missing at ${source}`,
    );
  }
  const destinationRoot = path.join(options.paths.runtime, "node");
  const destination = path.join(
    destinationRoot,
    options.target.platform === "win32" ? "node.exe" : "node",
  );
  rmSync(destinationRoot, { recursive: true, force: true });
  mkdirSync(destinationRoot, { recursive: true });
  await pipeline(
    createReadStream(source),
    createWriteStream(destination, { flags: "wx" }),
  );
  if (options.target.platform !== "win32") {
    await chmod(destination, 0o755);
  }

  if (
    !options.skipExecutableVerify &&
    hostCanExecuteTarget(options.target, options.hostPlatform, options.hostArch)
  ) {
    const result = spawnSync(destination, ["--version"], { encoding: "utf8" });
    const stdout = (result.stdout ?? "").trim();
    if (
      result.error !== undefined ||
      result.status !== 0 ||
      stdout !== `v${options.nodeVersion}`
    ) {
      const detail =
        result.error?.message ??
        result.signal ??
        (result.stderr ?? "").trim();
      const outcome =
        detail === "" ? `exit ${String(result.status)}` : String(detail);
      throw new Error(
        `xrk desktop runtime: prepared Node.js ${options.nodeVersion} failed executable verification: ${outcome}`,
      );
    }
  }
  rmSync(extraction, { recursive: true, force: true });
}

function preparePnpm(options: {
  readonly paths: DesktopTargetBuildPaths;
  readonly pnpmVersion: string;
  readonly resolvePnpmPackage: () => {
    readonly directory: string;
    readonly version: string;
  };
}): string {
  const resolved = options.resolvePnpmPackage();
  if (resolved.version !== options.pnpmVersion) {
    throw new Error(
      `xrk desktop runtime: expected pnpm@${options.pnpmVersion}, found ${resolved.version}`,
    );
  }
  const destination = path.join(options.paths.runtime, "pnpm");
  rmSync(destination, { recursive: true, force: true });
  cpSync(resolved.directory, destination, { recursive: true });
  return resolved.version;
}

/**
 * Download/verify Node for the selected first-wave target and copy pinned pnpm.
 * Writes `runtime/versions.json`. Does not mark Desktop product-ready.
 */
export async function prepareDesktopRuntime(
  options: PrepareDesktopRuntimeOptions = {},
): Promise<DesktopRuntimeVersions> {
  const env = options.env ?? process.env;
  const appRoot = options.appRoot ?? resolveDesktopAppRoot();
  const targetName =
    options.targetName ?? resolveDesktopBuildTarget(env);
  const paths = desktopTargetBuildPaths(targetName, appRoot);
  const target = resolveDesktopPackageTarget(paths.target);
  const nodeVersion = options.nodeVersion ?? DESKTOP_BUNDLED_NODE_VERSION;
  const pnpmVersion = options.pnpmVersion ?? DESKTOP_BUNDLED_PNPM_VERSION;
  const download = options.download ?? defaultDownload;
  const extractArchive = options.extractArchive ?? defaultExtractArchive;
  const resolvePnpm =
    options.resolvePnpmPackage ??
    (() => defaultResolvePnpmPackage(pnpmVersion));

  mkdirSync(paths.runtime, { recursive: true });
  await prepareNode({
    target,
    paths,
    nodeVersion,
    download,
    extractArchive,
    skipExecutableVerify: options.skipExecutableVerify === true,
    hostPlatform: process.platform,
    hostArch: process.arch,
  });
  const pnpm = preparePnpm({
    paths,
    pnpmVersion,
    resolvePnpmPackage: resolvePnpm,
  });
  const versions: DesktopRuntimeVersions = {
    schemaVersion: 1,
    node: nodeVersion,
    pnpm,
    target: target.name,
  };
  writeFileSync(
    path.join(paths.runtime, "versions.json"),
    `${JSON.stringify(versions, undefined, 2)}\n`,
  );
  return versions;
}

/** CLI entry when run as `node dist/prepare-runtime.js` after `tsc -b`. */
export async function main(argv: readonly string[] = process.argv): Promise<void> {
  const positional = argv.slice(2).find((arg) => !arg.startsWith("-"));
  const versions = await prepareDesktopRuntime(
    positional === undefined ? {} : { targetName: positional },
  );
  process.stdout.write(
    `xrk desktop runtime: prepared node@${versions.node} pnpm@${versions.pnpm} for ${versions.target}\n`,
  );
}

const isDirectRun =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) ===
    path.resolve(fileURLToPath(import.meta.url));

if (isDirectRun) {
  main().catch((error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
