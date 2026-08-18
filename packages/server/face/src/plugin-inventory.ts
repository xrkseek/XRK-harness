import type { FaceRuntime } from "./context.js";

/** DSH `pluginInventory/list` fiber phase. */
export type FacePluginFiberPhase =
  | "pending"
  | "loading"
  | "active"
  | "failed"
  | "unloading"
  | null;

export interface FacePluginInventoryEntry {
  readonly entryId: string;
  readonly moduleName: string;
  readonly enabled: boolean;
  readonly fiberPhase: FacePluginFiberPhase;
}

export interface FaceWebPlugin {
  readonly id: string;
  readonly moduleName?: string;
}

export interface FacePluginCommandResult {
  readonly kind: "success" | "error";
  readonly text?: string;
}

export interface FacePluginCommand {
  readonly name: string;
  readonly description: string;
  readonly input?: { readonly hint: string };
  readonly handler: (ctx: {
    sessionId: string;
    rawInput: string;
    commandId: string;
  }) => FacePluginCommandResult | Promise<FacePluginCommandResult>;
}

/** Process plugin snapshot Face reads for inventory + slash. */
export interface FaceProcessPlugin {
  readonly id: string;
  readonly kind: string;
  readonly commands?: readonly FacePluginCommand[];
}

/**
 * Host process plugins first, then product-shell boot entries.
 * Cordis stubs stay disabled / failed.
 */
export function listFacePluginInventory(
  runtime: Pick<FaceRuntime, "plugins" | "webPlugins">,
): FacePluginInventoryEntry[] {
  const seen = new Set<string>();
  const entries: FacePluginInventoryEntry[] = [];
  const push = (entry: FacePluginInventoryEntry) => {
    if (seen.has(entry.entryId)) return;
    seen.add(entry.entryId);
    entries.push(entry);
  };

  for (const plugin of runtime.plugins ?? []) {
    const cordis = plugin.kind === "cordis";
    push({
      entryId: plugin.id,
      moduleName: plugin.id,
      enabled: !cordis,
      fiberPhase: cordis ? "failed" : "active",
    });
  }
  for (const web of runtime.webPlugins ?? []) {
    push({
      entryId: web.id,
      moduleName: web.moduleName ?? web.id,
      enabled: true,
      fiberPhase: "active",
    });
  }
  return entries;
}

export function collectFacePluginCommands(
  plugins: readonly FaceProcessPlugin[] | undefined,
): readonly FacePluginCommand[] {
  const seen = new Set<string>();
  const out: FacePluginCommand[] = [];
  for (const plugin of plugins ?? []) {
    if (plugin.kind !== "commands") continue;
    for (const command of plugin.commands ?? []) {
      if (seen.has(command.name)) continue;
      seen.add(command.name);
      out.push(command);
    }
  }
  return out;
}
