import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { assertPolicyAllow } from "@xrkseek/policy";
import { assertServerName } from "./names.js";
import type {
  McpCallResult,
  McpClient,
  McpStdioOptions,
  McpToolInfo,
} from "./types.js";

const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000;

function contentToText(content: unknown): string {
  if (!Array.isArray(content)) {
    return typeof content === "string" ? content : JSON.stringify(content ?? "");
  }
  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      parts.push(b.text);
    } else {
      parts.push(JSON.stringify(b));
    }
  }
  return parts.join("\n");
}

/**
 * MCP client M0: stdio (or injected transport) → list/call tools.
 * `connect()` always runs `assertPolicyAllow({ kind: "mcp.connect" })` first.
 */
export function createMcpClient(options: McpStdioOptions): McpClient {
  assertServerName(options.serverName);
  if (!options.createTransport && !options.command) {
    throw new Error("createMcpClient: command or createTransport required");
  }

  const timeoutMs = options.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS;
  let client: Client | undefined;
  let transport: Transport | undefined;
  let connected = false;

  return {
    serverName: options.serverName,

    async connect() {
      if (connected) return;
      assertPolicyAllow(options.policy, {
        kind: "mcp.connect",
        serverId: options.serverName,
      });

      const next =
        options.createTransport !== undefined
          ? await options.createTransport()
          : new StdioClientTransport({
              command: options.command,
              args: [...(options.args ?? [])],
              ...(options.env ? { env: { ...options.env } } : {}),
              ...(options.cwd ? { cwd: options.cwd } : {}),
            });

      const c = new Client({
        name: "xrkseek-mcp",
        version: "0.0.0",
      });
      await c.connect(next);
      client = c;
      transport = next;
      connected = true;
    },

    async listTools() {
      if (!client || !connected) {
        throw new Error("MCP client not connected");
      }
      const result = await client.listTools();
      return result.tools.map(
        (t): McpToolInfo => ({
          name: t.name,
          description: t.description ?? "",
          inputSchema:
            t.inputSchema && typeof t.inputSchema === "object"
              ? (t.inputSchema as Record<string, unknown>)
              : { type: "object", properties: {} },
        }),
      );
    },

    async callTool(rawName, args, signal) {
      if (!client || !connected) {
        throw new Error("MCP client not connected");
      }
      const result = await client.callTool(
        { name: rawName, arguments: args },
        undefined,
        {
          timeout: timeoutMs,
          ...(signal ? { signal } : {}),
        },
      );
      const isError =
        typeof result === "object" &&
        result !== null &&
        "isError" in result &&
        Boolean((result as { isError?: boolean }).isError);
      const content =
        typeof result === "object" &&
        result !== null &&
        "content" in result
          ? contentToText((result as { content: unknown }).content)
          : JSON.stringify(result);
      return {
        content,
        ...(isError ? { isError: true } : {}),
      };
    },

    async dispose() {
      connected = false;
      const c = client;
      client = undefined;
      const t = transport;
      transport = undefined;
      try {
        await c?.close();
      } catch {
        /* ignore */
      }
      try {
        await t?.close();
      } catch {
        /* ignore */
      }
    },
  };
}
