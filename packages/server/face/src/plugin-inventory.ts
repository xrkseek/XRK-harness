import type { ToolDefinition } from "@xrkseek/core-tools";
import { resolveCordisFiberState } from "./cordis-bridge.js";
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
  /** `kind: tools` contributions — Face `viewFor` standing lookup. */
  readonly tools?: readonly ToolDefinition[];
  /** `kind: channel` IM / notification descriptors (process plugin discover). */
  readonly channels?: readonly {
    readonly channelId: string;
    readonly displayName?: string;
  }[];
  /** MCP supervisor health (Host `mcp:*` plugins). */
  readonly mcpHealth?: "connected" | "reconnecting" | "gave-up";
}

/**
 * Host process plugins first, then product-shell boot entries.
 * Cordis uses dsh-compat host.mjs apply or staged `client.js` when available.
 */
export function listFacePluginInventory(
  runtime: Pick<FaceRuntime, "plugins" | "webPlugins" | "hostPublic">,
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
    const fiber = cordis
      ? resolveCordisFiberState(runtime, plugin.id)
      : { enabled: true, fiberPhase: "active" as const };
    push({
      entryId: plugin.id,
      moduleName: plugin.id,
      enabled: fiber.enabled,
      fiberPhase: fiber.fiberPhase,
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
