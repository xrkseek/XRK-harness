/**
 * Prepare first-party Desktop package-set + seed integrity inventory (ADR-0008).
 * Does not run offline pnpm install or shard notarization.
 */

import { spawnSync } from "node:child_process";
import {
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveDesktopAppRoot,
  resolveDesktopTargetBuildPaths,
} from "./build-paths.js";
import {
  DESKTOP_CLI_PACKAGE,
  DESKTOP_HOST_PACKAGE,
  DESKTOP_PACKAGES_DIR,
  DESKTOP_PACKAGE_SET_FILE,
  assertDesktopHostPackageFiles,
  desktopSha512Integrity,
  parseDesktopCorePackageSet,
  type DesktopCorePackageRecord,
  type DesktopCorePackageSet,
  verifyDesktopCorePackageSet,
} from "./core-package-set.js";
import {
  writeDesktopSeedIntegrity,
  type DesktopSeedIntegrity,
} from "./seed-integrity.js";

const FIRST_PARTY_PREFIX = "@xrkseek/";
const REQUIRED_DEPENDENCY_SECTIONS = [
  "dependencies",
  "peerDependencies",
] as const;
const OPTIONAL_DEPENDENCY_SECTION = "optionalDependencies";

/** Packed package information needed to form the local Desktop closure. */
export interface PackedDesktopPackage {
  readonly tarball: string;
  readonly manifest: Readonly<Record<string, unknown>>;
}

export interface PrepareDesktopPackageSetOptions {
  readonly inputDirs: readonly string[];
  readonly outputDir: string;
  /** Optional Host version pin written into verification. */
  readonly expectedHostVersion?: string;
  /** List tarball member paths rooted at `package/` (tests inject). */
  readonly listTarballFiles?: (tarball: string) => readonly string[];
  /** Override reading `package/package.json` from a tarball (tests). */
  readonly readTarballManifest?: (
    tarball: string,
  ) => Record<string, unknown>;
}

export interface PrepareDesktopSeedPackageArtifactsOptions {
  readonly packageSetDir: string;
  readonly seedDir: string;
  readonly expectedHostVersion: string;
}

function dependencyNames(
  manifest: Readonly<Record<string, unknown>>,
  section: string,
): string[] {
  const value = manifest[section];
  if (value === undefined) return [];
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(
      `xrk desktop package set: ${String(manifest.name)} has invalid ${section}`,
    );
  }
  return Object.keys(value).sort();
}

/**
 * Select first-party dependency closures rooted at Desktop Host (+ CLI when packed).
 * Missing `@xrkseek/*` names throw (inputs must include the full local closure).
 */
export function selectDesktopPackageClosure(
  available: ReadonlyMap<string, PackedDesktopPackage>,
): PackedDesktopPackage[] {
  const selected = new Map<string, PackedDesktopPackage>();
  const visit = (name: string): void => {
    if (selected.has(name)) return;
    const packed = available.get(name);
    if (packed === undefined) {
      throw new Error(
        `xrk desktop package set: packed inputs omit required package ${name}`,
      );
    }
    selected.set(name, packed);
    for (const section of REQUIRED_DEPENDENCY_SECTIONS) {
      for (const dependency of dependencyNames(packed.manifest, section)) {
        if (available.has(dependency)) visit(dependency);
        else if (dependency.startsWith(FIRST_PARTY_PREFIX)) {
          throw new Error(
            `xrk desktop package set: ${name} requires unpacked first-party package ${dependency}`,
          );
        }
      }
    }
    for (const dependency of dependencyNames(
      packed.manifest,
      OPTIONAL_DEPENDENCY_SECTION,
    )) {
      if (available.has(dependency)) visit(dependency);
    }
  };
  if (!available.has(DESKTOP_HOST_PACKAGE)) {
    throw new Error(
      `xrk desktop package set: packed inputs omit ${DESKTOP_HOST_PACKAGE}`,
    );
  }
  visit(DESKTOP_HOST_PACKAGE);
  if (available.has(DESKTOP_CLI_PACKAGE)) visit(DESKTOP_CLI_PACKAGE);
  return [...selected.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([, packed]) => packed);
}

function extractFailDetail(result: {
  error?: Error;
  stderr?: string | null;
  status: number | null;
}): string {
  const fromProcess = result.error?.message ?? (result.stderr ?? "").trim();
  return fromProcess === "" || fromProcess === undefined
    ? `exit ${String(result.status)}`
    : fromProcess;
}

function packedManifestFromTar(tarball: string): Record<string, unknown> {
  const result = spawnSync(
    "tar",
    ["-xOzf", tarball, "package/package.json"],
    { encoding: "utf8" },
  );
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `xrk desktop package set: failed to read manifest from ${tarball}: ${extractFailDetail(result)}`,
    );
  }
  const value: unknown = JSON.parse(result.stdout);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`xrk desktop package set: ${tarball} has no package manifest`);
  }
  return value as Record<string, unknown>;
}

function defaultListTarballFiles(tarball: string): readonly string[] {
  const result = spawnSync("tar", ["-tzf", tarball], { encoding: "utf8" });
  if (result.error !== undefined || result.status !== 0) {
    throw new Error(
      `xrk desktop package set: failed to list ${tarball}: ${extractFailDetail(result)}`,
    );
  }
  return result.stdout
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function packedPackages(
  inputs: readonly string[],
  readManifest: (tarball: string) => Record<string, unknown>,
): Map<string, PackedDesktopPackage> {
  const available = new Map<string, PackedDesktopPackage>();
  for (const input of inputs) {
    const tarballs = readdirSync(input)
      .filter((file) => file.endsWith(".tgz"))
      .sort();
    if (tarballs.length === 0) {
      throw new Error(`xrk desktop package set: ${input} contains no tarballs`);
    }
    for (const file of tarballs) {
      const tarball = path.join(input, file);
      const manifest = readManifest(tarball);
      const name = manifest.name;
      if (typeof name !== "string" || name === "") {
        throw new Error(`xrk desktop package set: ${tarball} has no package name`);
      }
      if (available.has(name)) {
        throw new Error(
          `xrk desktop package set: duplicate packed package ${name}`,
        );
      }
      available.set(name, { tarball, manifest });
    }
  }
  return available;
}

/** Prepare a package set from directories of `.tgz` inputs. */
export function prepareDesktopPackageSet(
  options: PrepareDesktopPackageSetOptions,
): DesktopCorePackageSet {
  const listFiles = options.listTarballFiles ?? defaultListTarballFiles;
  const readManifest = options.readTarballManifest ?? packedManifestFromTar;
  const selected = selectDesktopPackageClosure(
    packedPackages(options.inputDirs, readManifest),
  );
  const host = selected.find(
    (packed) => packed.manifest.name === DESKTOP_HOST_PACKAGE,
  );
  if (host === undefined) {
    throw new Error(
      `xrk desktop package set: selected closure omits ${DESKTOP_HOST_PACKAGE}`,
    );
  }
  assertDesktopHostPackageFiles(listFiles(host.tarball));

  rmSync(options.outputDir, { recursive: true, force: true });
  const packageDir = path.join(options.outputDir, DESKTOP_PACKAGES_DIR);
  mkdirSync(packageDir, { recursive: true });
  const records: DesktopCorePackageRecord[] = selected.map((packed) => {
    const name = packed.manifest.name;
    const version = packed.manifest.version;
    if (typeof name !== "string" || typeof version !== "string") {
      throw new Error(
        `xrk desktop package set: ${packed.tarball} has no package identity`,
      );
    }
    const file = path.basename(packed.tarball);
    const destination = path.join(packageDir, file);
    copyFileSync(packed.tarball, destination, constants.COPYFILE_EXCL);
    const body = readFileSync(destination);
    return {
      name,
      version,
      file,
      bytes: statSync(destination).size,
      integrity: desktopSha512Integrity(body),
    };
  });
  const packageSet = parseDesktopCorePackageSet(
    { schemaVersion: 1, packages: records },
    options.expectedHostVersion,
  );
  writeFileSync(
    path.join(options.outputDir, DESKTOP_PACKAGE_SET_FILE),
    `${JSON.stringify(packageSet, undefined, 2)}\n`,
    { mode: 0o600 },
  );
  return packageSet;
}

/**
 * Copy a prepared package-set into the seed toolkit root and write `integrity.json`.
 * Does not materialize pnpm store (offline-seed still not product-ready).
 */
export function prepareDesktopSeedPackageArtifacts(
  options: PrepareDesktopSeedPackageArtifactsOptions,
): {
  readonly packageSet: DesktopCorePackageSet;
  readonly integrity: DesktopSeedIntegrity;
} {
  const packageSet = verifyDesktopCorePackageSet(
    options.packageSetDir,
    options.expectedHostVersion,
  );
  rmSync(options.seedDir, { recursive: true, force: true });
  mkdirSync(options.seedDir, { recursive: true });
  cpSync(
    path.join(options.packageSetDir, DESKTOP_PACKAGES_DIR),
    path.join(options.seedDir, DESKTOP_PACKAGES_DIR),
    { recursive: true },
  );
  copyFileSync(
    path.join(options.packageSetDir, DESKTOP_PACKAGE_SET_FILE),
    path.join(options.seedDir, DESKTOP_PACKAGE_SET_FILE),
  );
  const integrity = writeDesktopSeedIntegrity(options.seedDir);
  return { packageSet, integrity };
}

function readPackageManifest(packageDir: string): {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
} {
  const manifest = JSON.parse(
    readFileSync(path.join(packageDir, "package.json"), "utf8"),
  ) as Record<string, unknown>;
  if (typeof manifest.name !== "string" || typeof manifest.version !== "string") {
    throw new Error(
      `xrk desktop package set: ${packageDir} package.json missing name/version`,
    );
  }
  return manifest as {
    name: string;
    version: string;
    dependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
  };
}

/** Index `@xrkseek/*` workspace package directories under the monorepo. */
export function indexDesktopWorkspacePackages(
  repositoryRoot: string,
): Map<string, string> {
  const root = path.resolve(repositoryRoot);
  const index = new Map<string, string>();
  const roots = [
    path.join(root, "apps"),
    path.join(root, "packages"),
    path.join(root, "presets"),
  ];
  const visitDir = (dir: string, depth: number): void => {
    if (depth > 3 || !existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (
        entry.name === "node_modules" ||
        entry.name === "dist" ||
        entry.name.startsWith(".")
      ) {
        continue;
      }
      const child = path.join(dir, entry.name);
      const manifestPath = path.join(child, "package.json");
      if (existsSync(manifestPath)) {
        const manifest = readPackageManifest(child);
        if (manifest.name.startsWith(FIRST_PARTY_PREFIX)) {
          index.set(manifest.name, child);
        }
      }
      visitDir(child, depth + 1);
    }
  };
  for (const base of roots) visitDir(base, 0);
  return index;
}

/** Workspace dirs for Host (+ optional CLI) and their `@xrkseek/*` deps. */
export function collectDesktopFirstPartyPackageDirs(
  repositoryRoot: string,
  options: { includeCli?: boolean } = {},
): string[] {
  const byName = indexDesktopWorkspacePackages(repositoryRoot);
  const selected = new Set<string>();
  const visit = (name: string): void => {
    if (selected.has(name)) return;
    const dir = byName.get(name);
    if (dir === undefined) {
      throw new Error(
        `xrk desktop package set: workspace is missing first-party package ${name}`,
      );
    }
    selected.add(name);
    const manifest = readPackageManifest(dir);
    for (const section of [
      ...REQUIRED_DEPENDENCY_SECTIONS,
      OPTIONAL_DEPENDENCY_SECTION,
    ] as const) {
      const deps = manifest[section];
      if (deps === undefined) continue;
      for (const dependency of Object.keys(deps)) {
        if (dependency.startsWith(FIRST_PARTY_PREFIX)) visit(dependency);
      }
    }
  };
  visit(DESKTOP_HOST_PACKAGE);
  if (options.includeCli === true) visit(DESKTOP_CLI_PACKAGE);
  return [...selected]
    .sort((left, right) => left.localeCompare(right))
    .map((name) => byName.get(name)!);
}

/**
 * Pack Host workspace closure into a staging dir via `pnpm pack`.
 * Callers pass the staging dir to {@link prepareDesktopPackageSet}.
 */
export function packDesktopFirstPartyPackages(options: {
  readonly repositoryRoot: string;
  readonly destinationDir: string;
  readonly includeCli?: boolean;
  readonly pack?: (packageDir: string, destDir: string) => string;
}): readonly string[] {
  const pack =
    options.pack ??
    ((packageDir: string, destDir: string): string => {
      const result = spawnSync(
        "pnpm",
        ["pack", `--pack-destination=${destDir}`],
        { cwd: packageDir, encoding: "utf8", shell: true },
      );
      if (result.error !== undefined || result.status !== 0) {
        throw new Error(
          `xrk desktop package set: pnpm pack failed in ${packageDir}: ${extractFailDetail(result)}`,
        );
      }
      const lines = (result.stdout ?? "")
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line.endsWith(".tgz"));
      const last = lines.at(-1);
      if (last === undefined || !existsSync(last)) {
        throw new Error(
          `xrk desktop package set: pnpm pack produced no tarball in ${packageDir}`,
        );
      }
      return last;
    });

  mkdirSync(options.destinationDir, { recursive: true });
  const packageDirs = collectDesktopFirstPartyPackageDirs(
    options.repositoryRoot,
    { includeCli: options.includeCli === true },
  );
  const tarballs: string[] = [];
  for (const packageDir of packageDirs) {
    tarballs.push(pack(packageDir, options.destinationDir));
  }
  return tarballs;
}

/** Default CLI: pack Host closure, build package-set + seed integrity. */
export async function main(argv: readonly string[] = process.argv): Promise<void> {
  const positional = argv.slice(2).find((arg) => !arg.startsWith("-"));
  const appRoot = resolveDesktopAppRoot();
  const repoRoot = path.resolve(appRoot, "..", "..");
  const paths = positional
    ? resolveDesktopTargetBuildPaths(
        { XRK_DESKTOP_TARGET: positional },
        appRoot,
      )
    : resolveDesktopTargetBuildPaths(process.env, appRoot);

  const hostManifest = readPackageManifest(
    path.join(repoRoot, "apps", "desktop-host"),
  );

  const packedDir = path.join(paths.root, "packed-first-party");
  rmSync(packedDir, { recursive: true, force: true });
  packDesktopFirstPartyPackages({
    repositoryRoot: repoRoot,
    destinationDir: packedDir,
    includeCli: false,
  });

  const packageSet = prepareDesktopPackageSet({
    inputDirs: [packedDir],
    outputDir: paths.packageSet,
    expectedHostVersion: hostManifest.version,
  });

  const { integrity } = prepareDesktopSeedPackageArtifacts({
    packageSetDir: paths.packageSet,
    seedDir: paths.seed,
    expectedHostVersion: hostManifest.version,
  });

  process.stdout.write(
    `xrk desktop package set: ${packageSet.packages.length} package(s) → ${paths.packageSet}\n` +
      `xrk desktop seed integrity: ${integrity.files.length} file(s) → ${paths.seed}\n`,
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
