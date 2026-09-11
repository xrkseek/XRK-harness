#!/usr/bin/env node
/**
 * Prepare bundled Node + pnpm into apps/desktop/.desktop-build/targets/<target>/runtime
 *
 *   pnpm --filter @xrkseek/harness-desktop prepare:runtime
 *   pnpm --filter @xrkseek/harness-desktop prepare:runtime -- win-x64
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST_ENTRY = path.join(APP_ROOT, "dist", "prepare-runtime.js");

const build = spawnSync("pnpm", ["exec", "tsc", "-b"], {
  cwd: APP_ROOT,
  stdio: "inherit",
  shell: true,
});
if (build.status !== 0) process.exit(build.status ?? 1);

if (!existsSync(DIST_ENTRY)) {
  process.stderr.write(
    "prepare-runtime: missing dist/prepare-runtime.js after tsc -b\n",
  );
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  [DIST_ENTRY, ...process.argv.slice(2)],
  { cwd: APP_ROOT, stdio: "inherit", env: process.env },
);
process.exit(result.status ?? 1);
