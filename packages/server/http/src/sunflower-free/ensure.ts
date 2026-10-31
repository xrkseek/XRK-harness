/**
 * Bundled `extensions/xrk-sunflower-free` discovery for the Host boot chain.
 *
 * The plugin is a `kind: "llm"` contribution: its factory spawns a loopback
 * sidecar and returns one brand row. When the lane cannot be reached the
 * factory still returns a plugin object with an empty `llmBrands` array, so the
 * brand simply never reaches the registry and the provider stays out of the
 * catalog — no boot failure either way.
 *
 * Distribution: CLI release stage copies the plugin to
 * `@xrkseek/harness-cli/extensions/xrk-sunflower-free`. Desktop afterPack
 * places the same tree under `resources/host/extensions/`. Discovery walks
 * from the CLI entry, this module, and cwd until that layout appears.
 *
 * Live remount (Settings save): apply egress env → drop probe cache → unload
 * plugin (dispose sidecar) → load again → caller rewires LLM brands. Probe
 * cache is egress-keyed; clearing it forces a real re-probe for the saved lane
 * even when the URL string did not change (user intent on Save).
 */
import { existsSync, unlinkSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { PluginLoader } from "@xrkseek/server-loader";

export const SUNFLOWER_FREE_PLUGIN_ID = "xrk-sunflower-free";

/** Registry brand id contributed by the plugin (must match plugin.mjs). */
export const SUNFLOWER_FREE_BRAND_ID = "sunflower-free";

/** Face settings namespace for OpenCode / Kilo egress. */
export const SUNFLOWER_FREE_SETTINGS_NS = "sunflower-free";

/** Minimal settings read surface — avoids depending on the Face package. */
export interface SunflowerFreeSettingsSource {
  readonly settingsNamespaces: {
    view(ns: string): { readonly value: unknown };
  };
}

/** Settings key → env var the plugin/sidecar reads at boot / remount. */
const EGRESS_ENV: readonly (readonly [setting: string, env: string])[] = [
  ["openCodeProxy", "XRK_SUNFLOWER_PROXY"],
  ["kiloProxy", "XRK_SUNFLOWER_KILO_PROXY"],
];

/**
 * Bridge `sunflower-free` egress settings onto `process.env`.
 *
 * The loader invokes `createPlugin()` with no arguments, so a process plugin
 * cannot read Settings itself. The Host runs this before loading the plugin,
 * and the two lanes stay separate. `openCodeProxy` is the **cascade
 * candidate** (direct first, then this proxy / auto-discover) — it is not
 * applied as sticky egress until probe decides. Kilo uses `kiloProxy` alone.
 */
export function applySunflowerFreeEgressSettings(
  source: SunflowerFreeSettingsSource,
): void {
  let names: Record<string, unknown> = {};
  try {
    const raw = source.settingsNamespaces.view(SUNFLOWER_FREE_SETTINGS_NS).value;
    if (raw && typeof raw === "object" && !Array.isArray(raw)) {
      names = raw as Record<string, unknown>;
    }
  } catch {
    /* namespace not registered yet — leave the environment alone */
  }
  for (const [setting, env] of EGRESS_ENV) {
    const raw = names[setting];
    const value = typeof raw === "string" ? raw.trim() : "";
    if (value) process.env[env] = value;
    else delete process.env[env];
  }
}

/**
 * Drop the on-disk OpenCode probe cache so the next `createPlugin` must
 * re-probe. Path mirrors `extensions/xrk-sunflower-free/probe-cache.mjs`
 * (Host must not import the extension module graph).
 */
export function clearSunflowerFreeProbeCache(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const home = env.XRK_HOME?.trim() || path.join(homedir(), ".xrk");
  const file = path.join(home, "sunflower-free-probe.json");
  try {
    unlinkSync(file);
  } catch {
    /* missing / unwritable — next probe just runs cold */
  }
}

const RELATIVE_ROOT = path.join("extensions", SUNFLOWER_FREE_PLUGIN_ID);

/** Walk up from `from` until a directory containing the plugin manifest shows up. */
export function findSunflowerFreePluginRoot(from: string): string | undefined {
  let dir = path.resolve(from);
  for (;;) {
    const candidate = path.join(dir, RELATIVE_ROOT);
    if (existsSync(path.join(candidate, "xrk.plugin.json"))) return candidate;
    // Packaged CLI: extensions next to package root while we started in dist/.
    const nested = path.join(dir, "..", RELATIVE_ROOT);
    if (existsSync(path.join(nested, "xrk.plugin.json"))) {
      return path.resolve(nested);
    }
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

/**
 * Roots worth walking up from, most specific first:
 *   1. explicit `XRK_SUNFLOWER_FREE_ROOT`
 *   2. the running CLI entry (`…/node_modules/@xrkseek/harness-cli/dist/bin.js`)
 *   3. this module (nested under harness-cli or monorepo packages/server/http)
 *   4. process cwd (desktop Host is spawned with cwd = `resources/host`)
 */
function pluginRootCandidates(cwd: string): string[] {
  const out: string[] = [];
  const argv1 = process.argv[1]?.trim();
  if (argv1) out.push(path.dirname(path.resolve(argv1)));
  try {
    out.push(path.dirname(fileURLToPath(import.meta.url)));
  } catch {
    /* non-ESM host */
  }
  out.push(cwd);
  return out;
}

export function resolveSunflowerFreePluginRoot(
  cwd: string = process.cwd(),
): string | undefined {
  const explicitRoot = process.env.XRK_SUNFLOWER_FREE_ROOT?.trim();
  if (explicitRoot) {
    return existsSync(path.join(explicitRoot, "xrk.plugin.json"))
      ? explicitRoot
      : undefined;
  }
  for (const start of pluginRootCandidates(cwd)) {
    const root = findSunflowerFreePluginRoot(start);
    if (root) return root;
  }
  return undefined;
}

/**
 * Load the bundled sunflower-free provider plugin when its directory is
 * reachable. Returns whether the plugin ended up registered; a load error is
 * swallowed because the lane is optional.
 */
export async function ensureSunflowerFreePlugin(
  loader: PluginLoader,
  options: { readonly cwd?: string } = {},
): Promise<boolean> {
  if (loader.list().some((p) => p.id === SUNFLOWER_FREE_PLUGIN_ID)) return true;

  const root = resolveSunflowerFreePluginRoot(options.cwd ?? process.cwd());
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

export interface RemountSunflowerFreeResult {
  /** Plugin is registered after remount (may still contribute empty brands). */
  readonly loaded: boolean;
  /** Previous registration was disposed before reload. */
  readonly unloaded: boolean;
}

/**
 * Apply egress settings, invalidate probe cache, dispose the live plugin
 * (sidecar stop), then load again so OpenCode availability is re-probed.
 *
 * Callers must drop / rewire the `sunflower-free` registry brand around this
 * (see Host `syncSunflowerFree`): `wireCompositionLlm` skips existing brand ids.
 */
export async function remountSunflowerFreePlugin(
  loader: PluginLoader,
  source: SunflowerFreeSettingsSource,
  options: { readonly cwd?: string } = {},
): Promise<RemountSunflowerFreeResult> {
  applySunflowerFreeEgressSettings(source);
  clearSunflowerFreeProbeCache();

  let unloaded = false;
  if (loader.list().some((p) => p.id === SUNFLOWER_FREE_PLUGIN_ID)) {
    await loader.unregister(SUNFLOWER_FREE_PLUGIN_ID);
    unloaded = true;
  }

  // Settings save / explicit remount: await direct→proxy cascade (not background).
  const prevAwait = process.env.XRK_SUNFLOWER_AWAIT_PROBE;
  process.env.XRK_SUNFLOWER_AWAIT_PROBE = "1";
  try {
    const loaded = await ensureSunflowerFreePlugin(loader, options);
    return { loaded, unloaded };
  } finally {
    if (prevAwait === undefined) delete process.env.XRK_SUNFLOWER_AWAIT_PROBE;
    else process.env.XRK_SUNFLOWER_AWAIT_PROBE = prevAwait;
  }
}
