#!/usr/bin/env node
/**
 * Optional local staging of Bun next to sunflower-free (gitignored ~110 MB).
 * Product Desktop/CLI packages do **not** run this — users install Bun themselves.
 * Keep for maintainer probing without a system Bun on PATH.
 *
 *   pnpm vendor:bun
 *   pnpm vendor:bun -- --force
 *   XRK_SUNFLOWER_BUN=<path>
 *
 * Output: extensions/xrk-sunflower-free/vendor/{bun.exe|bun}
 */
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PLUGIN = path.join(ROOT, "extensions", "xrk-sunflower-free");
const VENDOR = path.join(PLUGIN, "vendor");

const force = process.argv.includes("--force");
const exeName = process.platform === "win32" ? "bun.exe" : "bun";
const target = path.join(VENDOR, exeName);

/** Candidate source binaries, most explicit first. */
function candidates() {
  const out = [];
  const explicit = process.env.XRK_SUNFLOWER_BUN?.trim();
  if (explicit) out.push(explicit);

  // npm global install of the `bun` package (Windows ships a real bun.exe).
  const appData = process.env.APPDATA?.trim();
  if (process.platform === "win32" && appData) {
    out.push(path.join(appData, "npm", "node_modules", "bun", "bin", "bun.exe"));
  }
  // Local / hoisted installs relative to this repo and to the Node runtime.
  for (const base of [ROOT, path.dirname(process.execPath)]) {
    out.push(path.join(base, "node_modules", "bun", "bin", exeName));
    out.push(path.join(base, "..", "node_modules", "bun", "bin", exeName));
  }
  // Whatever `bun` resolves to on PATH (may be a shim — verified below).
  const probe = spawnSync(process.platform === "win32" ? "where" : "which", ["bun"], {
    encoding: "utf8",
  });
  if (probe.status === 0) {
    for (const line of probe.stdout.split(/\r?\n/u)) {
      const hit = line.trim();
      if (hit) out.push(hit);
    }
  }
  return out;
}

/** A shim/copy is only useful if it actually runs. */
function versionOf(binary) {
  const run = spawnSync(binary, ["--version"], {
    encoding: "utf8",
    timeout: 20_000,
    windowsHide: true,
  });
  if (run.status !== 0 || run.error) return undefined;
  const version = run.stdout.trim().split(/\r?\n/u)[0]?.trim();
  return version || undefined;
}

function main() {
  mkdirSync(VENDOR, { recursive: true });

  if (!force && existsSync(target)) {
    const version = versionOf(target);
    if (version) {
      process.stdout.write(
        `vendor:bun: already staged (${version}, ${Math.round(statSync(target).size / 1e6)} MB) — use --force to refresh\n`,
      );
      return 0;
    }
    process.stdout.write("vendor:bun: staged copy does not run — re-staging\n");
  }

  const tried = [];
  for (const candidate of candidates()) {
    if (!candidate || !existsSync(candidate)) continue;
    const version = versionOf(candidate);
    tried.push(`${candidate}${version ? ` (${version})` : " (does not run)"}`);
    if (!version) continue;

    // Copy to a temp name first so a killed run cannot leave a half binary.
    const tmp = `${target}.${process.pid}.tmp`;
    copyFileSync(candidate, tmp);
    try {
      unlinkSync(target);
    } catch {
      /* first run — nothing to replace */
    }
    renameSync(tmp, target);
    const staged = versionOf(target);
    if (!staged) {
      throw new Error(`vendor:bun: staged copy at ${target} does not run`);
    }
    process.stdout.write(
      `vendor:bun: ${staged} → ${path.relative(ROOT, target)} (${Math.round(statSync(target).size / 1e6)} MB)\n` +
        `vendor:bun: source ${candidate}\n`,
    );
    return 0;
  }

  process.stderr.write(
    "vendor:bun: no usable Bun executable found.\n" +
      "  Install it once with `npm i -g bun`, or point XRK_SUNFLOWER_BUN at a binary.\n" +
      (tried.length > 0 ? `  Tried:\n    ${tried.join("\n    ")}\n` : ""),
  );
  return 1;
}

process.exit(main());
