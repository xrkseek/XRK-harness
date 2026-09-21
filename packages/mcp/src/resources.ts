/**
 * Shared model-facing MCP resource tools (DSH mcp-resources / Codex handlers).
 * Host registers these once; `server` arg selects a live {@link McpClient}.
 */

import type { ToolDefinition } from "@xrkseek/core-tools";
import type { McpClient } from "./types.js";

/** Plugin id for the shared resource tools (not `mcp:` — avoids server prefix clash). */
export const MCP_RESOURCES_PLUGIN_ID = "mcp-resources";

export const MCP_RESOURCE_TOOL_NAMES = [
  "list_mcp_resources",
  "list_mcp_resource_templates",
  "read_mcp_resource",
] as const;

/**
 * Render resource JSON while keeping raw binary out of model history
 * (DSH `renderResourceResult`).
 */
export function renderResourceResult(server: string, value: unknown): string {
  const rendered = JSON.stringify(value, (key, item: unknown) => {
    if (key === "blob" && typeof item === "string") {
      return `[binary resource: ${item.length} base64 characters; available to programmatic callers]`;
    }
    return item;
  });
  return `MCP server: ${server}\n${rendered}`;
}

function requireServerArg(args: unknown): {
  server: string;
  cursor?: string;
  uri?: string;
} {
  if (!args || typeof args !== "object" || Array.isArray(args)) {
    throw new Error("MCP resource tools require an object argument");
  }
  const o = args as Record<string, unknown>;
  const server = typeof o.server === "string" ? o.server.trim() : "";
  if (!server) throw new Error("server is required");
  const cursor =
    typeof o.cursor === "string" && o.cursor.length > 0 ? o.cursor : undefined;
  const uri = typeof o.uri === "string" ? o.uri.trim() : undefined;
  return {
    server,
    ...(cursor !== undefined ? { cursor } : {}),
    ...(uri !== undefined ? { uri } : {}),
  };
}

export interface CreateMcpResourceToolsOptions {
  /** Resolve a connected client by configured server name. */
  readonly resolveClient: (serverName: string) => McpClient | undefined;
}

/**
 * Three shared tools: list resources, list URI templates, read by URI.
 * Read-only → `isConcurrencySafe`.
 */
export function createMcpResourceTools(
  options: CreateMcpResourceToolsOptions,
): ToolDefinition[] {
  const resolve = (server: string): McpClient => {
    const client = options.resolveClient(server);
    if (!client) {
      throw new Error(
        `MCP resource server "${server}" is unavailable`,
      );
    }
    return client;
  };

  const listParameters = {
    type: "object",
    properties: {
      server: {
        type: "string",
        description: "Configured MCP server name.",
      },
      cursor: {
        type: "string",
        description: "Continuation cursor returned by this server.",
      },
    },
    required: ["server"],
  } as const;

  return [
    {
      name: "list_mcp_resources",
      description: "List resources available from an MCP server.",
      parameters: { ...listParameters },
      isConcurrencySafe: () => true,
      async execute(args) {
        const { server, cursor } = requireServerArg(args);
        const result = await resolve(server).listResources(
          cursor === undefined ? undefined : { cursor },
        );
        const payload =
          result.nextCursor !== undefined
            ? { resources: result.items, nextCursor: result.nextCursor }
            : { resources: result.items };
        return { content: renderResourceResult(server, payload) };
      },
    },
    {
      name: "list_mcp_resource_templates",
      description:
        "List parameterized resource URI templates from an MCP server.",
      parameters: { ...listParameters },
      isConcurrencySafe: () => true,
      async execute(args) {
        const { server, cursor } = requireServerArg(args);
        const result = await resolve(server).listResourceTemplates(
          cursor === undefined ? undefined : { cursor },
        );
        const payload =
          result.nextCursor !== undefined
            ? {
                resourceTemplates: result.items,
                nextCursor: result.nextCursor,
              }
            : { resourceTemplates: result.items };
        return { content: renderResourceResult(server, payload) };
      },
    },
    {
      name: "read_mcp_resource",
      description:
        "Read an MCP resource by URI from the named server. Use a listed URI or an expanded resource template.",
      parameters: {
        type: "object",
        properties: {
          server: {
            type: "string",
            description: "Configured MCP server name.",
          },
          uri: {
            type: "string",
            description: "Resource URI to read.",
          },
        },
        required: ["server", "uri"],
      },
      isConcurrencySafe: () => true,
      async execute(args, signal) {
        const { server, uri } = requireServerArg(args);
        if (!uri) throw new Error("uri is required");
        const result = await resolve(server).readResource(uri, signal);
        return { content: renderResourceResult(server, result) };
      },
    },
  ];
}
