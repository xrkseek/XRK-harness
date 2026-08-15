import type { Context } from "./context.js";
import type { Plugin } from "./plugin.js";
import type { PluginId } from "./types.js";

export interface PluginRegistry {
  register(plugin: Plugin): Promise<void>;
  unregister(id: PluginId | string): Promise<void>;
  has(id: PluginId | string): boolean;
  list(): readonly PluginId[];
}

export function createPluginRegistry(ctx: Context): PluginRegistry {
  const plugins = new Map<string, Plugin>();

  return {
    async register(plugin: Plugin): Promise<void> {
      const key = String(plugin.id);
      if (plugins.has(key)) {
        throw new Error(`plugin already registered: ${key}`);
      }
      await plugin.setup(ctx);
      plugins.set(key, plugin);
      ctx.onDispose(async () => {
        if (plugins.has(key)) {
          await plugin.teardown?.(ctx);
          plugins.delete(key);
        }
      });
    },

    async unregister(id: PluginId | string): Promise<void> {
      const key = String(id);
      const plugin = plugins.get(key);
      if (!plugin) {
        throw new Error(`plugin not registered: ${key}`);
      }
      await plugin.teardown?.(ctx);
      plugins.delete(key);
    },

    has(id: PluginId | string): boolean {
      return plugins.has(String(id));
    },

    list(): readonly PluginId[] {
      return [...plugins.keys()] as PluginId[];
    },
  };
}
