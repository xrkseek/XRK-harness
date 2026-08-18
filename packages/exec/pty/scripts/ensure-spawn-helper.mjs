/** Restore the executable bit stripped from node-pty's prebuilt helper (CV DSH). */

import { chmodSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

let entry;
try {
  entry = fileURLToPath(import.meta.resolve("node-pty"));
} catch {
  // optionalDependency missing — nothing to fix.
  process.exit(0);
}

const packageRoot = dirname(dirname(entry));
const candidates = [
  join(packageRoot, "prebuilds", `${process.platform}-${process.arch}`, "spawn-helper"),
  join(packageRoot, "build", "Release", "spawn-helper"),
];

for (const helper of candidates) {
  if (existsSync(helper)) chmodSync(helper, 0o755);
}
