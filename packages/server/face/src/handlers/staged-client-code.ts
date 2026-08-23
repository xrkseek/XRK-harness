/**
 * Read staged community `client.js` from Host `pluginsDir` layout.
 * Mirrors dsh-compat `clientPluginRoot` — Face does not depend on server-http.
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export function clientPluginRoot(
  pluginsDir: string,
  packageName: string,
): string {
  return path.join(pluginsDir, "web", "plugins", ...packageName.split("/"));
}

export function readStagedClientCode(
  pluginsDir: string | undefined,
  packageId: string,
): { code: string; name: string } {
  const id = packageId.trim();
  if (!pluginsDir?.trim() || !id) {
    return { code: "", name: "" };
  }
  const root = clientPluginRoot(pluginsDir.trim(), id);
  for (const rel of ["client.js", "lib/client.js"]) {
    const abs = path.join(root, rel);
    if (existsSync(abs)) {
      return { code: readFileSync(abs, "utf8"), name: rel };
    }
  }
  return { code: "", name: "" };
}
