/**
 * Stage a process plugin into a discoverable directory under pluginsDir.
 * Copies the unpacked package tree (skips nested node_modules).
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import path from "node:path";
import type { ClassifiedPackage } from "./classify.js";
import { processInstallDir } from "./inventory.js";

function copyTree(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  for (const name of readdirSync(src)) {
    if (name === "node_modules" || name === ".git") continue;
    const from = path.join(src, name);
    const to = path.join(dest, name);
    const st = statSync(from);
    if (st.isDirectory()) {
      copyTree(from, to);
    } else {
      cpSync(from, to);
    }
  }
}

export function installProcessPlugin(
  pluginsDir: string,
  classified: ClassifiedPackage,
): void {
  const dest = processInstallDir(pluginsDir, classified.name);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(path.dirname(dest), { recursive: true });
  copyTree(classified.root, dest);
  if (!existsSync(path.join(dest, "package.json"))) {
    throw new Error(`${classified.name}: process install missing package.json`);
  }
}

export function removeProcessPlugin(pluginsDir: string, name: string): void {
  const dest = processInstallDir(pluginsDir, name);
  rmSync(dest, { recursive: true, force: true });
  if (name.startsWith("@")) {
    const scopeDir = path.dirname(dest);
    try {
      rmSync(scopeDir, { recursive: false });
    } catch {
      /* not empty */
    }
  }
}
