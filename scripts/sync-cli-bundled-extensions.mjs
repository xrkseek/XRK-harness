/**
 * Copy product-bundled process plugins into apps/cli/extensions/ so:
 * - `files` in apps/cli/package.json can ship them
 * - global `xrkh` discovers sunflower-free next to the package root
 *
 * Never vendors Bun (OpenCode sidecar); users install Bun themselves.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEST_ROOT = path.join(ROOT, "apps", "cli", "extensions");
const SUNFLOWER_ID = "xrk-sunflower-free";
const SUNFLOWER_SRC = path.join(ROOT, "extensions", SUNFLOWER_ID);

function copyPlugin(src, dest) {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  rmSync(path.join(dest, "vendor"), { recursive: true, force: true });
}

if (!existsSync(path.join(SUNFLOWER_SRC, "xrk.plugin.json"))) {
  console.error(`sync-cli-bundled-extensions: missing ${SUNFLOWER_SRC}`);
  process.exit(1);
}

copyPlugin(SUNFLOWER_SRC, path.join(DEST_ROOT, SUNFLOWER_ID));
writeFileSync(
  path.join(DEST_ROOT, "README.md"),
  [
    "# Bundled CLI extensions",
    "",
    "Populated by `node scripts/sync-cli-bundled-extensions.mjs` (also from stage-cli-release).",
    "Do not hand-edit; source of truth is repo `extensions/<id>/`.",
    "",
  ].join("\n"),
  "utf8",
);
console.log(`sync-cli-bundled-extensions: ${SUNFLOWER_ID} → apps/cli/extensions/`);
