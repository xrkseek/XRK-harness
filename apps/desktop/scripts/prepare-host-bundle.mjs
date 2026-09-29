#!/usr/bin/env node
/**
 * Deploy `@xrkseek/harness-desktop-host` (+ prod deps) for Desktop packaging.
 *
 * Uses `node-linker=hoisted` so `node_modules` are real directories (no SYMLINKD).
 * electron-builder's default FileSet excludes `node_modules`; the builder
 * config re-includes them, and hoisted trees copy reliably on Windows.
 *
 *   node apps/desktop/scripts/prepare-host-bundle.mjs [win-x64|mac-arm64|mac-x64]
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const APP_ROOT = path.join(ROOT, "apps", "desktop");
const target =
  process.argv[2]?.trim() ||
  process.env.XRK_DESKTOP_TARGET?.trim() ||
  "win-x64";
const out = path.join(APP_ROOT, ".desktop-build", "targets", target, "host-bundle");

/** Shell-only optional deps pulled via `@xrkseek/harness-desktop`; not needed at Host runtime. */
const PRUNE_PACKAGES = [
  "electron",
  "electron-builder",
  "electron-updater",
  "app-builder-bin",
  "app-builder-lib",
  "builder-util",
  "builder-util-runtime",
  "dmg-builder",
  "electron-publish",
];

function removeLongPath(targetPath) {
  const long = targetPath.startsWith("\\\\?\\")
    ? targetPath
    : `\\\\?\\${targetPath}`;
  rmSync(long, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

mkdirSync(path.dirname(out), { recursive: true });
if (existsSync(out)) removeLongPath(out);

const result = spawnSync(
  "pnpm",
  [
    "--filter",
    "@xrkseek/harness-desktop-host",
    "deploy",
    "--prod",
    "--legacy",
    "--config.node-linker=hoisted",
    out,
  ],
  {
    cwd: ROOT,
    stdio: "inherit",
    shell: true,
    env: { ...process.env, CI: "true" },
  },
);
if ((result.status ?? 1) !== 0) process.exit(result.status ?? 1);

const entry = path.join(out, "dist", "index.js");
if (!existsSync(entry)) {
  process.stderr.write(`prepare-host-bundle: missing ${entry}\n`);
  process.exit(1);
}

const modulesRoot = path.join(out, "node_modules");
for (const name of PRUNE_PACKAGES) {
  const dir = path.join(modulesRoot, name);
  if (existsSync(dir)) {
    removeLongPath(dir);
    process.stdout.write(`prepare-host-bundle: pruned ${name}\n`);
  }
}

const serverHost = path.join(modulesRoot, "@xrkseek", "server-host", "package.json");
if (!existsSync(serverHost)) {
  process.stderr.write(
    `prepare-host-bundle: missing ${path.relative(ROOT, serverHost)}\n`,
  );
  process.exit(1);
}

// Settings plugin add/remove/update spawn this via XRK_HARNESS_BIN (host-runtime).
const harnessCliBin = path.join(
  modulesRoot,
  "@xrkseek",
  "harness-cli",
  "dist",
  "bin.js",
);
if (!existsSync(harnessCliBin)) {
  process.stderr.write(
    `prepare-host-bundle: missing ${path.relative(ROOT, harnessCliBin)} ` +
      `(desktop-host must depend on @xrkseek/harness-cli)\n`,
  );
  process.exit(1);
}

process.stdout.write(`prepare-host-bundle: ${path.relative(ROOT, out)}\n`);
