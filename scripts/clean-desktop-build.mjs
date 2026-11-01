#!/usr/bin/env node
/**
 * Remove mutable Desktop packaging outputs under apps/desktop/.desktop-build
 * (current artifacts · host-bundle · upload mirror/records · plans).
 * Keeps shared downloads/ by default. Versioned snapshots
 * (`unsigned-artifacts-<ver>` · `upload-stage-<ver>`) are pruned by
 * `pnpm prune:local` (retain ≤5), not wiped here unless `--snapshots`.
 *
 *   pnpm clean:desktop
 *   pnpm clean:desktop -- --all         # also wipe downloads + runtime
 *   pnpm clean:desktop -- --snapshots   # also wipe versioned artifact dirs
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "apps", "desktop", ".desktop-build");

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    all: { type: "boolean", default: false },
    snapshots: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (values.help) {
  process.stdout.write(
    "clean-desktop-build: remove packaging outputs under apps/desktop/.desktop-build\n" +
      "  --all         also remove downloads/ and targets/*/runtime\n" +
      "  --snapshots   also remove unsigned-artifacts-* / upload-stage-*\n",
  );
  process.exit(0);
}

if (!existsSync(BUILD)) {
  process.stdout.write("clean-desktop-build: nothing to remove\n");
  process.exit(0);
}

const removable = [
  path.join(BUILD, "upload-mirror"),
  path.join(BUILD, "upload-records"),
];

const targetsRoot = path.join(BUILD, "targets");
if (existsSync(targetsRoot)) {
  for (const name of readdirSync(targetsRoot)) {
    const root = path.join(targetsRoot, name);
    if (!statSync(root).isDirectory()) continue;
    removable.push(
      path.join(root, "artifacts"),
      path.join(root, "unsigned-artifacts"),
      path.join(root, "host-bundle"),
      path.join(root, "package-plan.json"),
      path.join(root, "upload-plan.json"),
      path.join(root, "package-set"),
      path.join(root, "seed"),
      path.join(root, "node-extract"),
      path.join(root, "packed-first-party"),
      path.join(root, "smoke-host-home"),
    );
    if (values.all) removable.push(path.join(root, "runtime"));
    if (values.snapshots) {
      for (const child of readdirSync(root)) {
        if (
          child.startsWith("unsigned-artifacts-") ||
          child.startsWith("upload-stage-")
        ) {
          removable.push(path.join(root, child));
        }
      }
    }
  }
}
if (values.all) removable.push(path.join(BUILD, "downloads"));
if (values.snapshots) {
  for (const name of readdirSync(BUILD)) {
    if (name.startsWith("upload-stage-")) {
      removable.push(path.join(BUILD, name));
    }
  }
}

let removed = 0;
for (const entry of removable) {
  if (!existsSync(entry)) continue;
  rmSync(entry, { recursive: true, force: true });
  removed += 1;
  process.stdout.write(
    `clean-desktop-build: removed ${path.relative(ROOT, entry)}\n`,
  );
}
process.stdout.write(
  removed === 0
    ? "clean-desktop-build: nothing matched\n"
    : `clean-desktop-build: done (${removed} paths)\n`,
);
