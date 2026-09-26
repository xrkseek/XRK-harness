#!/usr/bin/env node
/**
 * Remove mutable Desktop packaging outputs under apps/desktop/.desktop-build
 * (artifacts · unsigned-artifacts · upload mirror/records · per-target plans).
 * Keeps shared downloads/ by default so Node archives are not re-fetched.
 *
 *   pnpm clean:desktop
 *   pnpm clean:desktop -- --all   # also wipe downloads + runtime
 */
import { existsSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "apps", "desktop", ".desktop-build");

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    all: { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  strict: true,
});

if (values.help) {
  process.stdout.write(
    "clean-desktop-build: remove packaging outputs under apps/desktop/.desktop-build\n" +
      "  --all   also remove downloads/ and targets/*/runtime\n",
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
  const { readdirSync } = await import("node:fs");
  for (const name of readdirSync(targetsRoot)) {
    const root = path.join(targetsRoot, name);
    removable.push(
      path.join(root, "artifacts"),
      path.join(root, "unsigned-artifacts"),
      path.join(root, "package-plan.json"),
      path.join(root, "upload-plan.json"),
      path.join(root, "package-set"),
      path.join(root, "seed"),
      path.join(root, "node-extract"),
    );
    if (values.all) removable.push(path.join(root, "runtime"));
  }
}
if (values.all) removable.push(path.join(BUILD, "downloads"));

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
