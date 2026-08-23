import type { RegisteredPlugin } from "./types.js";
import { PLUGIN_KINDS } from "./kinds.js";

/** Process plugin that contributes same-origin HTTP routes (DSH `webServer.register` analogue). */
export function isHostPlugin(plugin: RegisteredPlugin): boolean {
  return (
    plugin.kind === PLUGIN_KINDS.host &&
    typeof plugin.createPublicHandler === "function"
  );
}

/** Host plugins in registration order (stable discover order). */
export function listHostPlugins(
  plugins: readonly RegisteredPlugin[],
): readonly RegisteredPlugin[] {
  return plugins.filter(isHostPlugin);
}
