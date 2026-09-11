#!/usr/bin/env node
/**
 * Build Desktop private packages + assembled product Web (ADR-0008).
 *
 * Discipline: apps → sdk | server | presets (via workspace filter `...`),
 * then the same Web assemble path as `serve` (`web:build` · `client:bundle` · `web:assemble`).
 *
 *   pnpm build:desktop
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function pnpm(args) {
  run("pnpm", args);
}

// desktop-host pulls workspace deps (server / presets / desktop); tsc -b follows refs.
pnpm(["--filter", "@xrkseek/harness-desktop-host...", "run", "build"]);

// Product shell assets for xrk-app:// (same assemble path as CLI serve).
pnpm(["run", "web:build"]);
pnpm(["run", "client:bundle"]);
pnpm(["run", "web:assemble"]);

const required = [
  path.join(ROOT, "apps", "desktop", "dist", "main.js"),
  path.join(ROOT, "apps", "desktop-host", "dist", "index.js"),
  path.join(ROOT, "apps", "web", "dist", "index.html"),
];
for (const file of required) {
  if (!existsSync(file)) {
    process.stderr.write(`build-desktop: missing ${path.relative(ROOT, file)}\n`);
    process.exit(1);
  }
}

process.stdout.write("build-desktop: ok\n");
