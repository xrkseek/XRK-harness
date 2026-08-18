import type { PluginCommand, RegisteredPlugin } from "./types.js";
import { PLUGIN_KINDS } from "./kinds.js";

export function isCommandsPlugin(
  plugin: RegisteredPlugin,
): plugin is RegisteredPlugin & { readonly kind: "commands" } {
  return plugin.kind === PLUGIN_KINDS.commands;
}

/**
 * Collect `kind: "commands"` slash contributions.
 * **First name wins** across plugins (later duplicates skipped).
 */
export function collectPluginCommands(
  plugins: readonly RegisteredPlugin[],
): readonly PluginCommand[] {
  const seen = new Set<string>();
  const out: PluginCommand[] = [];
  for (const plugin of plugins) {
    if (!isCommandsPlugin(plugin)) continue;
    for (const command of plugin.commands ?? []) {
      if (seen.has(command.name)) continue;
      seen.add(command.name);
      out.push(command);
    }
  }
  return out;
}
