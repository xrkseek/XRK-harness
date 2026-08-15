import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import type { RegisteredPlugin } from "./types.js";

export interface AppliedPluginTool {
  readonly pluginId: string;
  readonly toolName: string;
}

export interface SkippedPluginTool extends AppliedPluginTool {
  readonly reason: "explicit_wins";
}

export interface ApplyToolsPluginsResult {
  readonly applied: readonly AppliedPluginTool[];
  readonly skipped: readonly SkippedPluginTool[];
}

export function isToolsPlugin(
  plugin: RegisteredPlugin,
): plugin is RegisteredPlugin & { readonly kind: "tools" } {
  return plugin.kind === "tools";
}

/**
 * Register `kind: "tools"` contributions.
 * **Explicit wins:** if `registry.get(name)` already exists, skip (do not replace).
 */
export function applyToolsPlugins(
  registry: ToolRegistry,
  plugins: readonly RegisteredPlugin[],
): ApplyToolsPluginsResult {
  const applied: AppliedPluginTool[] = [];
  const skipped: SkippedPluginTool[] = [];

  for (const plugin of plugins) {
    if (!isToolsPlugin(plugin)) continue;
    const tools = plugin.tools ?? [];
    for (const tool of tools) {
      if (registry.get(tool.name)) {
        skipped.push({
          pluginId: plugin.id,
          toolName: tool.name,
          reason: "explicit_wins",
        });
        continue;
      }
      registry.register(tool);
      applied.push({ pluginId: plugin.id, toolName: tool.name });
    }
  }

  return { applied, skipped };
}

/**
 * `extraTools` first (clash with builtin throws), then plugin tools (clash skipped).
 */
export function wireCompositionTools(
  registry: ToolRegistry,
  options: {
    readonly extraTools?: readonly ToolDefinition[];
    readonly plugins?: readonly RegisteredPlugin[];
  } = {},
): ApplyToolsPluginsResult {
  for (const tool of options.extraTools ?? []) {
    registry.register(tool);
  }
  return applyToolsPlugins(registry, options.plugins ?? []);
}
