/**
 * Seed integrity inventory (`integrity.json`) for first-party package artifacts.
 * Full offline store calibrate stays deferred (`isDesktopOfflineSeedReady`).
 */

import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { DESKTOP_SEED_LAYOUT } from "./seed-store-strategy.js";
import { desktopSha512Integrity } from "./core-package-set.js";

export const DESKTOP_SEED_INTEGRITY_FILE = DESKTOP_SEED_LAYOUT.integrityFile;

export interface DesktopSeedIntegrityRecord {
  readonly path: string;
  readonly bytes: number;
  readonly integrity: string;
}

export interface DesktopSeedIntegrity {
  readonly schemaVersion: 1;
  readonly files: readonly DesktopSeedIntegrityRecord[];
}

const PATH_PATTERN = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/@+-]+$/u;
const INTEGRITY_PATTERN = /^sha512-[A-Za-z0-9+/]+={0,2}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function listFilesRecursive(root: string, relative = ""): string[] {
  const dir = relative === "" ? root : path.join(root, relative);
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = relative === "" ? entry.name : `${relative}/${entry.name}`;
    if (entry.isDirectory()) {
      out.push(...listFilesRecursive(root, rel));
      continue;
    }
    if (entry.isFile()) out.push(rel.split(path.sep).join("/"));
  }
  return out.sort((left, right) => left.localeCompare(right));
}

/** Validate integrity inventory JSON. */
export function parseDesktopSeedIntegrity(value: unknown): DesktopSeedIntegrity {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    !Array.isArray(value.files)
  ) {
    throw new Error("xrk desktop seed: invalid integrity inventory");
  }
  const files = value.files.map((entry): DesktopSeedIntegrityRecord => {
    if (
      !isRecord(entry) ||
      typeof entry.path !== "string" ||
      !PATH_PATTERN.test(entry.path) ||
      entry.path === DESKTOP_SEED_INTEGRITY_FILE ||
      typeof entry.bytes !== "number" ||
      !Number.isSafeInteger(entry.bytes) ||
      entry.bytes < 0 ||
      typeof entry.integrity !== "string" ||
      !INTEGRITY_PATTERN.test(entry.integrity)
    ) {
      throw new Error("xrk desktop seed: invalid integrity record");
    }
    return {
      path: entry.path,
      bytes: entry.bytes,
      integrity: entry.integrity,
    };
  });
  const paths = new Set(files.map((entry) => entry.path));
  if (paths.size !== files.length) {
    throw new Error("xrk desktop seed: duplicate integrity path");
  }
  const sorted = [...files].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
  if (JSON.stringify(sorted) !== JSON.stringify(files)) {
    throw new Error("xrk desktop seed: integrity files must be sorted by path");
  }
  return { schemaVersion: 1, files };
}

/**
 * Build integrity records for every file under `seedDir` except `integrity.json`.
 */
export function buildDesktopSeedIntegrity(
  seedDir: string,
): DesktopSeedIntegrity {
  const root = path.resolve(seedDir);
  const records: DesktopSeedIntegrityRecord[] = [];
  for (const relative of listFilesRecursive(root)) {
    if (relative === DESKTOP_SEED_INTEGRITY_FILE) continue;
    const body = readFileSync(path.join(root, ...relative.split("/")));
    records.push({
      path: relative,
      bytes: body.byteLength,
      integrity: desktopSha512Integrity(body),
    });
  }
  return parseDesktopSeedIntegrity({ schemaVersion: 1, files: records });
}

/** Write `integrity.json` for the current seed tree. */
export function writeDesktopSeedIntegrity(seedDir: string): DesktopSeedIntegrity {
  const inventory = buildDesktopSeedIntegrity(seedDir);
  writeFileSync(
    path.join(seedDir, DESKTOP_SEED_INTEGRITY_FILE),
    `${JSON.stringify(inventory, undefined, 2)}\n`,
    { mode: 0o600 },
  );
  return inventory;
}

/** Verify seed files against `integrity.json`. */
export function verifyDesktopSeedIntegrity(seedDir: string): DesktopSeedIntegrity {
  const integrityPath = path.join(seedDir, DESKTOP_SEED_INTEGRITY_FILE);
  let value: unknown;
  try {
    value = JSON.parse(readFileSync(integrityPath, "utf8"));
  } catch (error) {
    throw new Error(
      `xrk desktop seed: failed to read ${integrityPath}: ${String(error)}`,
      { cause: error },
    );
  }
  const inventory = parseDesktopSeedIntegrity(value);
  const expected = inventory.files.map((entry) => entry.path).sort();
  const actual = listFilesRecursive(path.resolve(seedDir)).filter(
    (file) => file !== DESKTOP_SEED_INTEGRITY_FILE,
  );
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("xrk desktop seed: integrity verification failed (file set)");
  }
  for (const record of inventory.files) {
    const filePath = path.join(seedDir, ...record.path.split("/"));
    if (!existsSync(filePath) || !lstatSync(filePath).isFile()) {
      throw new Error(
        `xrk desktop seed: integrity verification failed for ${record.path}`,
      );
    }
    const body = readFileSync(filePath);
    const integrity = desktopSha512Integrity(body);
    if (body.byteLength !== record.bytes || integrity !== record.integrity) {
      throw new Error(
        `xrk desktop seed: integrity verification failed for ${record.path}`,
      );
    }
  }
  return inventory;
}
