import type { ToolDefinition, ToolRegistry } from "@xrkseek/core-tools";
import type { McpClient } from "./types.js";
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

/**
 * Register MCP tools on a ToolRegistry under `mcp__<server>__<raw>`.
 * Explicit registry names win (skip, do not replace).
 * Returns disposer that unregisters applied tools only.
 */
export async function registerMcpTools(
  registry: ToolRegistry,
  client: McpClient,
): Promise<RegisterMcpToolsResult & { dispose: () => void }> {
  const tools = await client.listTools();
  const applied: AppliedMcpTool[] = [];
  const skipped: SkippedMcpTool[] = [];

  for (const info of tools) {
    const name = publicToolName(client.serverName, info.name);
    if (registry.get(name)) {
      skipped.push({
        publicName: name,
        rawName: info.name,
        reason: "explicit_wins",
      });
      continue;
    }
    const def: ToolDefinition = {
      name,
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
    };
    registry.register(def);
    applied.push({ publicName: name, rawName: info.name });
  }

  return {
    applied,
    skipped,
    dispose() {
      for (const a of applied) {
        registry.unregister(a.publicName);
      }
    },
  };
}
