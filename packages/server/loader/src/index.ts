import { loadDiscoveryHit } from "./load.js";
import { scanPluginDir, type DiscoveryHit } from "./manifest.js";
import type { RegisteredPlugin } from "./types.js";

export type {
  RegisteredPlugin,
  PluginPromptSection,
  PluginCommand,
  PluginCommandContext,
  PluginCommandResult,
  HostWireContext,
  HostPublicHandlerFn,
} from "./types.js";
export type { DiscoveryHit, PluginManifest } from "./manifest.js";
export { scanPluginDir } from "./manifest.js";
export { loadPluginModule, loadDiscoveryHit, stubFromManifest } from "./load.js";
export {
  PLUGIN_KINDS,
  RESERVED_PLUGIN_KINDS,
  isKnownPluginKind,
  type KnownPluginKind,
} from "./kinds.js";
export {
  applyToolsPlugins,
  isToolsPlugin,
  wireCompositionTools,
  type AppliedPluginTool,
  type ApplyToolsPluginsResult,
  type SkippedPluginTool,
} from "./tools.js";
export {
  applyPromptPlugins,
  isPromptPlugin,
  wireCompositionPrompts,
  type AppliedPluginPrompt,
  type ApplyPromptPluginsResult,
  type SkippedPluginPrompt,
} from "./prompt.js";
export {
  collectPluginCommands,
  isCommandsPlugin,
} from "./commands.js";
export {
  toPluginInventoryEntries,
  type PluginFiberPhase,
  type PluginInventoryEntry,
} from "./inventory.js";
export { isHostPlugin, listHostPlugins } from "./host.js";

export interface PluginLoader {
  register(plugin: RegisteredPlugin): void;
  unregister(id: string): Promise<void>;
  list(): readonly RegisteredPlugin[];
  /**
   * Scan `dir` for plugin manifests (`xrk.plugin.json` or
   * `package.json` plugin fields). Does not import modules.
   */
  discover(dir: string): Promise<readonly DiscoveryHit[]>;
  /** Import one discovery hit and register it (Cordis stubs skip import). */
  load(hit: DiscoveryHit): Promise<RegisteredPlugin>;
  /**
   * Discover + load + register every plugin under `dir`.
   * Skips ids already registered. Returns registered ids.
   */
  loadAll(dir: string): Promise<readonly string[]>;
}

export function createPluginLoader(): PluginLoader {
  const plugins = new Map<string, RegisteredPlugin>();
  return {
    register(plugin) {
      if (plugins.has(plugin.id)) {
        throw new Error(`plugin already registered: ${plugin.id}`);
      }
      plugins.set(plugin.id, plugin);
    },
    async unregister(id) {
      const p = plugins.get(id);
      if (!p) return;
      await p.dispose?.();
      plugins.delete(id);
    },
    list() {
      return [...plugins.values()];
    },
    async discover(dir) {
      return scanPluginDir(dir);
    },
    async load(hit) {
      const plugin = await loadDiscoveryHit(hit);
      if (plugins.has(plugin.id)) {
        throw new Error(`plugin already registered: ${plugin.id}`);
      }
      plugins.set(plugin.id, plugin);
      return plugin;
    },
    async loadAll(dir) {
      const hits = await scanPluginDir(dir);
      const ids: string[] = [];
      for (const hit of hits) {
        if (plugins.has(hit.manifest.id)) continue;
        const plugin = await loadDiscoveryHit(hit);
        plugins.set(plugin.id, plugin);
        ids.push(plugin.id);
      }
      return ids;
    },
  };
}
