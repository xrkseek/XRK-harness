/**
 * Stage a client plugin: copy client.js (+ optional LICENSE) under web/plugins.
 */
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import type { ClassifiedPackage } from "./classify.js";
import { clientInstallDir } from "./inventory.js";

export function installClientBundle(
  pluginsDir: string,
  classified: ClassifiedPackage,
): void {
  if (!classified.clientJs) {
    throw new Error(`${classified.name}: missing client.js`);
  }
  const destDir = clientInstallDir(pluginsDir, classified.name);
  rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  copyFileSync(classified.clientJs, path.join(destDir, "client.js"));
  const license = path.join(classified.root, "LICENSE");
  if (existsSync(license)) {
    copyFileSync(license, path.join(destDir, "LICENSE"));
  }
}

export function removeClientBundle(pluginsDir: string, name: string): void {
  const destDir = clientInstallDir(pluginsDir, name);
  rmSync(destDir, { recursive: true, force: true });
  // Prune empty @scope parent
  if (name.startsWith("@")) {
    const scopeDir = path.dirname(destDir);
    try {
      rmSync(scopeDir, { recursive: false });
    } catch {
      /* not empty */
    }
  }
}
