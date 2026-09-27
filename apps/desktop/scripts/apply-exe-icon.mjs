#!/usr/bin/env node
/**
 * Embed brand icon.ico into a Windows .exe via resedit (shortcut / Explorer icon).
 *
 *   node apps/desktop/scripts/apply-exe-icon.mjs <exe> [icon.ico]
 */
import { createRequire } from "node:module";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(APP_ROOT, "..", "..");
const exePath = process.argv[2];
const iconPath =
  process.argv[3]?.trim() || path.join(APP_ROOT, "build", "icon.ico");

if (!exePath) {
  process.stderr.write(
    "usage: node apps/desktop/scripts/apply-exe-icon.mjs <exe> [icon.ico]\n",
  );
  process.exit(2);
}

/**
 * @returns {typeof import("resedit")}
 */
function loadResedit() {
  const attempts = [
    path.join(APP_ROOT, "package.json"),
    path.join(REPO_ROOT, "package.json"),
  ];
  for (const pkg of attempts) {
    try {
      return createRequire(pkg)("resedit");
    } catch {
      // try next
    }
  }
  const pnpm = path.join(REPO_ROOT, "node_modules", ".pnpm");
  if (existsSync(pnpm)) {
    for (const entry of readdirSync(pnpm)) {
      if (!entry.startsWith("resedit@")) continue;
      const mod = path.join(pnpm, entry, "node_modules", "resedit");
      if (existsSync(path.join(mod, "package.json"))) {
        return createRequire(path.join(mod, "package.json"))(mod);
      }
    }
  }
  throw new Error(
    "xrk desktop: resedit not found (install electron-builder / resedit in the workspace)",
  );
}

const resedit = loadResedit();
const { NtExecutable, NtExecutableResource, Data, Resource } = resedit;
const executable = NtExecutable.from(readFileSync(exePath), {
  ignoreCert: true,
});
const resources = NtExecutableResource.from(executable);
const iconFile = Data.IconFile.from(readFileSync(iconPath));
Resource.IconGroupEntry.replaceIconsForResource(
  resources.entries,
  1,
  1033,
  iconFile.icons.map((icon) => icon.data),
);
resources.outputResource(executable);
writeFileSync(exePath, Buffer.from(executable.generate()));
process.stdout.write(
  `apply-exe-icon: ${path.basename(exePath)} ← ${path.basename(iconPath)} (${String(statSync(exePath).size)} bytes)\n`,
);
