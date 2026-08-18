import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { assertPolicyAllow } from "@xrkseek/policy";
import { assertServerName } from "./names.js";
import type {
  McpCallResult,
  McpClient,
  McpClientOptions,
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

function toCallResult(result: unknown): McpCallResult {
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
}

async function closeQuietly(
  target: { close(): Promise<unknown> | unknown } | undefined,
): Promise<void> {
  try {
    await target?.close();
  } catch {
    /* ignore */
  }
}

const DEFAULT_HTTP_RECONNECT = {
  initialReconnectionDelay: 1000,
  maxReconnectionDelay: 30_000,
  reconnectionDelayGrowFactor: 1.5,
  maxRetries: 2,
} as const;

async function openTransport(options: McpClientOptions): Promise<Transport> {
  if (options.createTransport !== undefined) {
    return options.createTransport();
  }
  if (options.transport === "http") {
    const url = options.url?.trim();
    if (!url) {
      throw new Error("createMcpClient: url required for transport http");
    }
    const reconnectionOptions = {
      ...DEFAULT_HTTP_RECONNECT,
      ...options.reconnectionOptions,
    };
    return new StreamableHTTPClientTransport(new URL(url), {
      ...(options.requestInit ? { requestInit: options.requestInit } : {}),
      reconnectionOptions,
    }) as unknown as Transport;
  }
  const command = options.command?.trim();
  if (!command) {
    throw new Error("createMcpClient: command or createTransport required");
  }
  return new StdioClientTransport({
    command,
    args: [...(options.args ?? [])],
    ...(options.env ? { env: { ...options.env } } : {}),
    ...(options.cwd ? { cwd: options.cwd } : {}),
  });
}

/**
 * MCP client: stdio / streamable-http (or injected transport) → list/call tools.
 * `connect()` always runs `assertPolicyAllow({ kind: "mcp.connect" })` first.
 * Reconnect: HTTP transport forwards SDK `reconnectionOptions` (SSE resume).
 * `onToolsListChanged` forwards `notifications/tools/list_changed` (tool catalog
 * hot-sync). Process-level supervisor / Face MCP settings UI are not included.
 */
export function createMcpClient(options: McpClientOptions): McpClient {
  assertServerName(options.serverName);
  if (
    !options.createTransport &&
    options.transport !== "http" &&
    !options.command
  ) {
    throw new Error("createMcpClient: command, url (http), or createTransport required");
  }

  const timeoutMs = options.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS;
  const listChangedHandlers = new Set<() => void | Promise<void>>();
  let client: Client | undefined;
  let transport: Transport | undefined;
  let connected = false;
  let closed = false;
  let inflight: Promise<void> | undefined;
  let notifyChain = Promise.resolve();

  function requireLive(): Client {
    if (!client || !connected) {
      throw new Error("MCP client not connected");
    }
    return client;
  }

  async function fanOutListChanged(): Promise<void> {
    for (const handler of [...listChangedHandlers]) {
      try {
        await handler();
      } catch {
        /* isolate subscribers */
      }
    }
  }

  async function openAndConnect(): Promise<void> {
    if (closed) throw new Error("MCP client disposed");
    assertPolicyAllow(options.policy, {
      kind: "mcp.connect",
      serverId: options.serverName,
    });

    const next = await openTransport(options);
    if (closed) {
      await closeQuietly(next);
      throw new Error("MCP client disposed");
    }
    const c = new Client({
      name: "xrkseek-mcp",
      version: "0.0.0",
    });
    // Register before connect so a list_changed during handshake is not dropped.
    c.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      if (closed) return;
      notifyChain = notifyChain.then(fanOutListChanged, fanOutListChanged);
    });
    try {
      await c.connect(next);
    } catch (err) {
      await closeQuietly(c);
      await closeQuietly(next);
      throw err;
    }
    if (closed) {
      await closeQuietly(c);
      await closeQuietly(next);
      throw new Error("MCP client disposed");
    }
    client = c;
    transport = next;
    connected = true;
  }

  return {
    serverName: options.serverName,

    async connect() {
      if (closed) throw new Error("MCP client disposed");
      if (connected) return;
      if (inflight) return inflight;
      inflight = openAndConnect();
      try {
        await inflight;
      } finally {
        inflight = undefined;
      }
    },

    async listTools() {
      const result = await requireLive().listTools();
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
      const result = await requireLive().callTool(
        { name: rawName, arguments: args },
        undefined,
        {
          timeout: timeoutMs,
          ...(signal ? { signal } : {}),
        },
      );
      return toCallResult(result);
    },

    onToolsListChanged(handler) {
      listChangedHandlers.add(handler);
      return () => {
        listChangedHandlers.delete(handler);
      };
    },

    async dispose() {
      closed = true;
      connected = false;
      listChangedHandlers.clear();
      const c = client;
      client = undefined;
      const t = transport;
      transport = undefined;
      try {
        c?.removeNotificationHandler("notifications/tools/list_changed");
      } catch {
        /* ignore */
      }
      await closeQuietly(c);
      await closeQuietly(t);
    },
  };
}
