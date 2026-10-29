/**
 * Bundled `extensions/xrk-sunflower-free` discovery for the Host boot chain.
 *
 * The plugin is a `kind: "llm"` contribution: its factory spawns a loopback
 * sidecar and returns one brand row. When the lane cannot be reached the
 * factory still returns a plugin object with an empty `llmBrands` array, so the
 * brand simply never reaches the registry and the provider stays out of the
 * catalog — no boot failure either way.
 *
 * Distribution note: this resolves against a source tree / packaged desktop
 * tree that ships `extensions/`. The npm CLI tarball does not include that
 * directory yet, so on a bare CLI install this is a no-op (returns false).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import type { PluginLoader } from "@xrkseek/server-loader";

export const SUNFLOWER_FREE_PLUGIN_ID = "xrk-sunflower-free";

const RELATIVE_ROOT = path.join("extensions", SUNFLOWER_FREE_PLUGIN_ID);

/** Walk up from `from` until a directory containing the plugin manifest shows up. */
function findPluginRoot(from: string): string | undefined {
  let dir = path.resolve(from);
  for (;;) {
    const candidate = path.join(dir, RELATIVE_ROOT);
    if (existsSync(path.join(candidate, "xrk.plugin.json"))) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Roots worth walking up from, most specific first:
 *   1. explicit `XRK_SUNFLOWER_FREE_ROOT`
 *   2. the running CLI entry (`…/node_modules/@xrkseek/harness-cli/dist/bin.js`)
 *      — a global npm install is never launched from its own package dir
 *   3. the process cwd (desktop Host is spawned with cwd = `resources/host`)
 */
function pluginRootCandidates(cwd: string): string[] {
  const out = [];
  const argv1 = process.argv[1]?.trim();
  if (argv1) out.push(path.dirname(path.resolve(argv1)));
  out.push(cwd);
  return out;
}

/**
 * Load the bundled sunflower-free provider plugin when its directory is
 * reachable from `cwd` (or an ancestor). Returns whether the plugin ended up
 * registered; a load error is swallowed because the lane is optional.
 */
export async function ensureSunflowerFreePlugin(
  loader: PluginLoader,
  options: { readonly cwd?: string } = {},
): Promise<boolean> {
  if (loader.list().some((p) => p.id === SUNFLOWER_FREE_PLUGIN_ID)) return true;

  const explicitRoot = process.env.XRK_SUNFLOWER_FREE_ROOT?.trim();
  let root: string | undefined = explicitRoot || undefined;
  if (!root) {
    for (const start of pluginRootCandidates(options.cwd ?? process.cwd())) {
      root = findPluginRoot(start);
      if (root) break;
    }
  }
  if (!root || !existsSync(path.join(root, "xrk.plugin.json"))) return false;

  let hits;
  try {
    hits = await loader.discover(root);
  } catch {
    return false;
  }
  const hit = hits.find((h) => h.manifest.id === SUNFLOWER_FREE_PLUGIN_ID);
  if (!hit) return false;

  try {
    await loader.load(hit);
    return true;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.warn(`[sunflower-free] plugin load skipped: ${detail}`);
    return false;
  }
}
