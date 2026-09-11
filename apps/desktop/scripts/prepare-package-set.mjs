#!/usr/bin/env node
/**
 * Prepare first-party package-set + seed integrity inventory.
 *
 *   pnpm --filter @xrkseek/harness-desktop prepare:package-set
 *   pnpm --filter @xrkseek/harness-desktop prepare:package-set -- win-x64
 *
 * Packs the Desktop Host `@xrkseek/*` workspace closure (`pnpm pack`), writes
 * `desktop-packages.json` + `packages/*.tgz`, then copies into seed with `integrity.json`.
 * Does not run offline store install (see ADR-0008 / status).
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = path.join(APP_ROOT, "dist", "prepare-package-set.js");

const build = spawnSync("pnpm", ["exec", "tsc", "-b"], {
  cwd: APP_ROOT,
  stdio: "inherit",
  shell: true,
});
if (build.status !== 0) process.exit(build.status ?? 1);

if (!existsSync(DIST_ENTRY)) {
  process.stderr.write(
    "prepare-package-set: missing dist/prepare-package-set.js after tsc -b\n",
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [DIST_ENTRY, ...process.argv.slice(2)],
  { cwd: APP_ROOT, stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
