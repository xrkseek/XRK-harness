import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import type { McpClient, McpToolInfo } from "./types.js";
import { publicToolName } from "./names.js";

export interface AppliedMcpTool {
  readonly publicName: string;
  readonly rawName: string;
}

export interface SkippedMcpTool extends AppliedMcpTool {
  readonly reason: "explicit_wins";
}

export interface RegisterMcpToolsResult {
  readonly applied: readonly AppliedMcpTool[];
  readonly skipped: readonly SkippedMcpTool[];
}

export interface RegisterMcpToolsOptions {
  /**
   * Re-sync ToolRegistry on `notifications/tools/list_changed` (default true).
   * Fetch failures keep the previous applied generation.
   */
  readonly watch?: boolean;
}

/** Shared by `registerMcpTools` and Host `loadMcpToolPlugins`. */
export function mcpToolDefinition(
  client: McpClient,
  info: McpToolInfo,
): ToolDefinition {
  const readOnly = info.annotations?.readOnlyHint === true;
  return {
    name: publicToolName(client.serverName, info.name),
    description: info.description || `MCP tool ${info.name}`,
    parameters: info.inputSchema,
    async execute(args, signal) {
      const result = await client.callTool(
        info.name,
        (args ?? {}) as Record<string, unknown>,
        signal,
      );
      return {
        content: result.content,
        ...(result.isError ? { isError: true } : {}),
      };
    },
    // Fail-closed: only exact MCP readOnlyHint permits parallel settle.
    ...(readOnly ? { isConcurrencySafe: () => true } : {}),
  };
}

/**
 * Register MCP tools on a ToolRegistry under `mcp__<server>__<raw>`.
 * Explicit registry names win (skip, do not replace).
 * By default watches `tools/list_changed` and re-syncs (fetch fail → keep last).
 * Returns disposer that unregisters the current applied generation only.
 */
export async function registerMcpTools(
  registry: ToolRegistry,
  client: McpClient,
  options: RegisterMcpToolsOptions = {},
): Promise<RegisterMcpToolsResult & { dispose: () => void }> {
  const watch = options.watch !== false;
  let applied: AppliedMcpTool[] = [];
  let skipped: SkippedMcpTool[] = [];
  let disposed = false;
  let gaveUp = false;
  let syncChain: Promise<void> = Promise.resolve();

  async function sync(): Promise<void> {
    if (disposed || gaveUp) return;
    const tools = await client.listTools();
    if (disposed || gaveUp) return;

    const owned = new Set(applied.map((a) => a.publicName));
    const nextApplied: AppliedMcpTool[] = [];
    const nextSkipped: SkippedMcpTool[] = [];
    const keep = new Set<string>();

    for (const info of tools) {
      const name = publicToolName(client.serverName, info.name);
      const existing = registry.get(name);
      if (existing && !owned.has(name)) {
        nextSkipped.push({
          publicName: name,
          rawName: info.name,
          reason: "explicit_wins",
        });
        continue;
      }
      const def = mcpToolDefinition(client, info);
      if (existing && owned.has(name)) {
        registry.replace(def);
      } else {
        registry.register(def);
      }
      nextApplied.push({ publicName: name, rawName: info.name });
      keep.add(name);
    }

    if (disposed || gaveUp) {
      for (const row of nextApplied) {
        if (!owned.has(row.publicName)) registry.unregister(row.publicName);
      }
      return;
    }

    for (const prev of applied) {
      if (!keep.has(prev.publicName)) {
        registry.unregister(prev.publicName);
      }
    }

    applied = nextApplied;
    skipped = nextSkipped;
  }

  await sync();

  const unsub = watch
    ? client.onToolsListChanged(() => {
        syncChain = syncChain.then(async () => {
          try {
            await sync();
          } catch {
            /* keep previous generation */
          }
        });
        return syncChain;
      })
    : () => {};

  const unsubState = client.onConnectionState((state) => {
    if (state.status !== "gave-up" || disposed) return;
    gaveUp = true;
    syncChain = syncChain.then(() => {
      for (const a of applied) {
        registry.unregister(a.publicName);
      }
      applied = [];
      skipped = [];
    });
  });

  return {
    get applied() {
      return applied;
    },
    get skipped() {
      return skipped;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsub();
      unsubState();
      for (const a of applied) {
        registry.unregister(a.publicName);
      }
      applied = [];
      skipped = [];
    },
  };
}
