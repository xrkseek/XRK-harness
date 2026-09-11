/**
 * First-party Desktop core package set (local tarballs + descriptor).
 * Seed layout names come from {@link DESKTOP_SEED_LAYOUT} (ADR-0008).
 */

import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import path from "node:path";
import { DESKTOP_SEED_LAYOUT } from "./seed-store-strategy.js";

/** Descriptor beside local core tarballs (`desktop-packages.json`). */
export const DESKTOP_PACKAGE_SET_FILE = DESKTOP_SEED_LAYOUT.packageSetFile;

/** Directory of immutable first-party `.tgz` files (`packages/`). */
export const DESKTOP_PACKAGES_DIR = DESKTOP_SEED_LAYOUT.packagesDir;

/** Private Host package installed into the Desktop profile. */
export const DESKTOP_HOST_PACKAGE = "@xrkseek/harness-desktop-host" as const;

/**
 * Optional second root for product CLI surface (versions need not match Host).
 * Closure still walks `@xrkseek/*` workspace deps when present in packed inputs.
 */
export const DESKTOP_CLI_PACKAGE = "@xrkseek/harness-cli" as const;

/** Host tarball paths (package-relative) required before profile boot. No Cordis overlay. */
export const DESKTOP_HOST_RUNTIME_FILES = ["dist/index.js"] as const;

/** One immutable npm tarball in the Desktop core package set. */
export interface DesktopCorePackageRecord {
  readonly name: string;
  readonly version: string;
  readonly file: string;
  readonly bytes: number;
  readonly integrity: string;
}

/** Union of first-party closures rooted at Desktop Host (and optional CLI). */
export interface DesktopCorePackageSet {
  readonly schemaVersion: 1;
  readonly packages: readonly DesktopCorePackageRecord[];
}

const PACKAGE_NAME_PATTERN =
  /^(?:@[a-z0-9][a-z0-9._~-]*\/[a-z0-9][a-z0-9._~-]*|[a-z0-9][a-z0-9._~-]*)$/u;
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/u;
const FILE_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.tgz$/u;
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** sha512 integrity string for npm-style records. */
export function desktopSha512Integrity(body: Uint8Array | Buffer): string {
  return `sha512-${createHash("sha512").update(body).digest("base64")}`;
}

/**
 * Validate package-set JSON. When `expectedHostVersion` is set, Host must match
 * (CLI may differ — public CLI line is not the Desktop release identity).
 */
export function parseDesktopCorePackageSet(
  value: unknown,
  expectedHostVersion?: string,
): DesktopCorePackageSet {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.packages)
  ) {
    throw new Error("xrk desktop package set: invalid descriptor");
  }
  const packages = value.packages.map((entry): DesktopCorePackageRecord => {
    if (
      !isRecord(entry) ||
      typeof entry.name !== "string" ||
      !PACKAGE_NAME_PATTERN.test(entry.name) ||
      typeof entry.version !== "string" ||
      !VERSION_PATTERN.test(entry.version) ||
      typeof entry.file !== "string" ||
      !FILE_PATTERN.test(entry.file) ||
      typeof entry.bytes !== "number" ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      typeof entry.integrity !== "string" ||
      !INTEGRITY_PATTERN.test(entry.integrity)
    ) {
      throw new Error("xrk desktop package set: invalid package record");
    }
    return {
      name: entry.name,
      version: entry.version,
      file: entry.file,
      bytes: entry.bytes,
      integrity: entry.integrity,
    };
  });
  const names = new Set(packages.map((entry) => entry.name));
  const files = new Set(packages.map((entry) => entry.file));
  if (names.size !== packages.length || files.size !== packages.length) {
    throw new Error("xrk desktop package set: duplicate package name or filename");
  }
  const sorted = [...packages].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  if (JSON.stringify(sorted) !== JSON.stringify(packages)) {
    throw new Error("xrk desktop package set: packages must be sorted by name");
  }
  const host = packages.find((entry) => entry.name === DESKTOP_HOST_PACKAGE);
  if (host === undefined) {
    throw new Error(`xrk desktop package set: missing ${DESKTOP_HOST_PACKAGE}`);
  }
  if (
    expectedHostVersion !== undefined &&
    host.version !== expectedHostVersion
  ) {
    throw new Error(
      `xrk desktop package set: ${DESKTOP_HOST_PACKAGE}@${host.version} does not match Desktop Host ${expectedHostVersion}`,
    );
  }
  return { schemaVersion: 1, packages };
}

/** Read and validate one package-set descriptor from a seed / profile root. */
export function readDesktopCorePackageSet(
  projectDir: string,
  expectedHostVersion?: string,
): DesktopCorePackageSet {
  const filePath = path.join(projectDir, DESKTOP_PACKAGE_SET_FILE);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(filePath, "utf8"));
  } catch (error) {
    throw new Error(
      `xrk desktop package set: failed to read ${filePath}: ${String(error)}`,
      { cause: error },
    );
  }
  return parseDesktopCorePackageSet(value, expectedHostVersion);
}

/** Project-relative `file:` spec for one local core tarball. */
export function desktopCorePackageSpec(
  record: DesktopCorePackageRecord,
): string {
  return `file:./${DESKTOP_PACKAGES_DIR}/${record.file}`;
}

/** pnpm overrides map keeping every core package off registries. */
export function desktopCorePackageOverrides(
  packageSet: DesktopCorePackageSet,
): Record<string, string> {
  return Object.fromEntries(
    packageSet.packages.map((record) => [
      record.name,
      desktopCorePackageSpec(record),
    ]),
  );
}

/** Verify every local tarball matches the descriptor; reject extras. */
export function verifyDesktopCorePackageSet(
  projectDir: string,
  expectedHostVersion: string,
): DesktopCorePackageSet {
  const packageSet = readDesktopCorePackageSet(projectDir, expectedHostVersion);
  const packageDir = path.join(projectDir, DESKTOP_PACKAGES_DIR);
  const expectedFiles = packageSet.packages.map((entry) => entry.file).sort();
  let actualFiles: string[];
  try {
    actualFiles = readdirSync(packageDir).sort();
  } catch (error) {
    throw new Error(
      `xrk desktop package set: failed to read ${packageDir}: ${String(error)}`,
      { cause: error },
    );
  }
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      "xrk desktop package set: package directory does not match its descriptor",
    );
  }
  for (const record of packageSet.packages) {
    const filePath = path.join(packageDir, record.file);
    if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
      throw new Error(
        `xrk desktop package set: ${record.file} is not a regular file`,
      );
    }
    const body = readFileSync(filePath);
    const integrity = desktopSha512Integrity(body);
    if (body.byteLength !== record.bytes || integrity !== record.integrity) {
      throw new Error(
        `xrk desktop package set: integrity check failed for ${record.file}`,
      );
    }
  }
  return packageSet;
}

/** Require Host runtime entry files inside a packed tarball file list. */
export function assertDesktopHostPackageFiles(
  files: readonly string[],
): void {
  const available = new Set(files);
  const missing = DESKTOP_HOST_RUNTIME_FILES.map(
    (file) => `package/${file}`,
  ).filter((file) => !available.has(file));
  if (missing.length > 0) {
    throw new Error(
      `xrk desktop package set: ${DESKTOP_HOST_PACKAGE} tarball omits required file(s): ${missing.join(", ")}`,
    );
  }
}
