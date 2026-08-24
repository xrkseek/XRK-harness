/**
 * Sync `{pluginsDir}/web/plugins` with `.xrk-plugins.json` client rows.
 * Inventory is the source of truth; orphan staged dirs break boot overlay.
 */
import { existsSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { clientInstallDir, readInventory } from "./inventory.js";
import { pruneEmptyParents } from "./install-client.js";

function expectedClientNames(pluginsDir: string): Set<string> {
  const inv = readInventory(pluginsDir);
  const names = new Set<string>();
  for (const entry of Object.values(inv.packages)) {
    if (entry.kind === "client" || entry.kind === "both") {
      names.add(entry.name);
    }
  }
  return names;
}

/** Discover staged client halves by `client.js` under `web/plugins`. */
export function listStagedClientPluginIds(pluginsDir: string): readonly string[] {
  const pluginsRoot = path.join(pluginsDir, "web", "plugins");
  if (!existsSync(pluginsRoot)) return [];
  const found: string[] = [];
  for (const entry of readdirSync(pluginsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith("@")) {
      const scopePath = path.join(pluginsRoot, entry.name);
      for (const pkg of readdirSync(scopePath, { withFileTypes: true })) {
        if (!pkg.isDirectory()) continue;
        const clientJs = path.join(scopePath, pkg.name, "client.js");
        if (existsSync(clientJs)) {
          found.push(`${entry.name}/${pkg.name}`);
        }
      }
      continue;
    }
    const clientJs = path.join(pluginsRoot, entry.name, "client.js");
    if (existsSync(clientJs)) {
      found.push(entry.name);
    }
  }
  return found.sort((a, b) => a.localeCompare(b));
}

/**
 * Remove staged client dirs not listed in inventory (client / both kinds).
 * @returns package names removed from disk.
 */
export function reconcileClientStaging(pluginsDir: string): readonly string[] {
  const expected = expectedClientNames(pluginsDir);
  const pluginsRoot = path.join(pluginsDir, "web", "plugins");
  const removed: string[] = [];
  for (const id of listStagedClientPluginIds(pluginsDir)) {
    if (expected.has(id)) continue;
    const destDir = clientInstallDir(pluginsDir, id);
    if (existsSync(destDir)) {
      rmSync(destDir, { recursive: true, force: true });
      pruneEmptyParents(path.dirname(destDir), pluginsRoot);
      removed.push(id);
    }
  }
  return removed;
}
