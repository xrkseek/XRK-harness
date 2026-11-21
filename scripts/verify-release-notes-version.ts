/**
 * Gate: sidebar RELEASE_NOTES[0] must match apps/cli package version.
 * Catches stale pins that `pnpm check` would miss (client specs are not in check).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readCliVersion(): string {
  const pkgPath = path.join(ROOT, "apps", "cli", "package.json");
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8")) as { version?: unknown };
  if (typeof pkg.version !== "string" || pkg.version.trim() === "") {
    throw new Error(`verify-release-notes: missing version in ${pkgPath}`);
  }
  return pkg.version.trim();
}

/** First `version: '…'` / `version: "…"` after `export const RELEASE_NOTES`. */
function readBundledLatest(): string {
  const notesPath = path.join(
    ROOT,
    "packages",
    "client",
    "ui-release-notes",
    "src",
    "client",
    "release-notes.ts",
  );
  const source = fs.readFileSync(notesPath, "utf8");
  const anchor = source.indexOf("export const RELEASE_NOTES");
  if (anchor < 0) {
    throw new Error(`verify-release-notes: RELEASE_NOTES export missing in ${notesPath}`);
  }
  const slice = source.slice(anchor);
  const match = /version:\s*['"]([^'"]+)['"]/.exec(slice);
  if (!match?.[1]) {
    throw new Error(`verify-release-notes: no version entry after RELEASE_NOTES in ${notesPath}`);
  }
  return match[1];
}

const cli = readCliVersion();
const bundled = readBundledLatest();
if (cli !== bundled) {
  console.error(
    `verify-release-notes: mismatch — apps/cli version=${cli} but RELEASE_NOTES[0]=${bundled}`,
  );
  process.exit(1);
}
process.stdout.write(`verify-release-notes: ${cli} ok\n`);
