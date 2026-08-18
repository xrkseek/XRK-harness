import type { RegisteredPlugin } from "./types.js";

/** DSH `pluginInventory/list` fiber phase. */
export type PluginFiberPhase =
  | "pending"
  | "loading"
  | "active"
  | "failed"
  | "unloading"
  | null;

/** DSH `PluginInventoryEntry` (Host Cordis loader projection). */
export interface PluginInventoryEntry {
  readonly entryId: string;
  readonly moduleName: string;
  readonly enabled: boolean;
  readonly fiberPhase: PluginFiberPhase;
}

/**
 * Process plugins → inventory rows.
 * Cordis stubs stay disabled / failed so the settings pane never implies they ran.
 */
export function toPluginInventoryEntries(
  plugins: readonly RegisteredPlugin[],
): PluginInventoryEntry[] {
  return plugins.map((plugin) => {
    const cordis = plugin.kind === "cordis";
    return {
      entryId: plugin.id,
      moduleName: plugin.id,
      enabled: !cordis,
      fiberPhase: cordis ? "failed" : "active",
    };
  });
}
