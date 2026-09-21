import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { assertPolicyAllow } from "@xrkseek/policy";
import {
  drainToolsListPages,
  isResourcesUnsupported,
  isToolsListUnsupported,
  MAX_TOOLS_LIST_PAGES,
} from "./list-tools.js";
import { assertServerName } from "./names.js";
import { mergeAuthHeaders } from "./oauth-device.js";
import { mapMcpCallContent } from "./project-content.js";
import { resolveReconnectPolicy } from "./reconnect.js";
import type {
  McpClient,
  McpClientOptions,
  McpConnectionState,
  McpResourceContents,
  McpResourceInfo,
  McpResourceTemplateInfo,
  McpToolAnnotations,
  McpToolInfo,
} from "./types.js";

const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000;

/** Parse MCP tool.annotations; only known boolean hints are kept. */
export function parseMcpToolAnnotations(raw: unknown): McpToolAnnotations | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const out: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  } = {};
  if (typeof o.title === "string" && o.title.trim()) out.title = o.title.trim();
  if (typeof o.readOnlyHint === "boolean") out.readOnlyHint = o.readOnlyHint;
  if (typeof o.destructiveHint === "boolean") {
    out.destructiveHint = o.destructiveHint;
  }
  if (typeof o.idempotentHint === "boolean") {
    out.idempotentHint = o.idempotentHint;
  }
  if (typeof o.openWorldHint === "boolean") out.openWorldHint = o.openWorldHint;
  return Object.keys(out).length > 0 ? out : undefined;
}

// SDK stdio transport owns two 2s termination windows; one extra second for
// the process-close event. Timing out fails closed instead of overlapping children.
const GENERATION_CLOSE_TIMEOUT_MS = 5_000;

/** Local Promise.withResolvers (tsconfig lib is ES2022). */
function withResolvers<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
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
    const authHeaders = options.auth ? await options.auth.headers() : undefined;
    const requestInit = mergeAuthHeaders(options.requestInit, authHeaders);
    return new StreamableHTTPClientTransport(new URL(url), {
      ...(requestInit ? { requestInit } : {}),
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
 *
 * After the first successful `connect()`, a generation supervisor owns
 * `Client.onclose`: recreate Client+transport with bounded backoff
 * (DSH `connection.ts`) for stdio **and** HTTP. HTTP also keeps SDK SSE
 * resume via `reconnectionOptions`. Pass `reconnect: { enabled: false }` to
 * opt out of process-level restart (lost connections emit `gave-up`).
 */
export function createMcpClient(options: McpClientOptions): McpClient {
  assertServerName(options.serverName);
  if (!options.createTransport && options.transport !== "http" && !options.command) {
    throw new Error(
      "createMcpClient: command, url (http), or createTransport required",
    );
  }

  const reconnect = resolveReconnectPolicy(options.reconnect, "reconnect");
  const timeoutMs = options.toolCallTimeoutMs ?? DEFAULT_TOOL_CALL_TIMEOUT_MS;
  const label = `mcp(${options.serverName})`;
  const listChangedHandlers = new Set<() => void | Promise<void>>();
  const stateHandlers = new Set<(state: McpConnectionState) => void>();
  /** Live generation (connected). */
  let client: Client | undefined;
  /** In-flight or live generation for `isCurrent` / onclose fencing. */
  let attempt: Client | undefined;
  let transport: Transport | undefined;
  let clientClosed: Promise<void> | undefined;
  let connected = false;
  let disposed = false;
  let inflight: Promise<void> | undefined;
  let notifyChain = Promise.resolve();
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let failedAttempts = 0;
  let connectedAt: number | undefined;

  const log = (level: "info" | "warn" | "error", message: string): void => {
    options.onLog?.(level, `${label}: ${message}`);
  };

  const isCurrent = (generation: Client): boolean =>
    !disposed && attempt === generation;

  function emitState(state: McpConnectionState): void {
    for (const handler of [...stateHandlers]) {
      try {
        handler(state);
      } catch {
        /* isolate subscribers */
      }
    }
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

  function waitForClose(closed: Promise<void>): Promise<boolean> {
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve(false);
      }, GENERATION_CLOSE_TIMEOUT_MS);
      timeout.unref?.();
      void closed.then(() => {
        clearTimeout(timeout);
        resolve(true);
      });
    });
  }

  /** Drain paginated resources/list or templates/list (reuse tools page cap). */
  async function drainResourcePages<T>(
    serverName: string,
    label: string,
    keyOf: (item: T) => string,
    fetchPage: (
      cursor?: string,
    ) => Promise<{ items: readonly T[]; nextCursor?: string | null }>,
  ): Promise<T[]> {
    const seenCursors = new Set<string>();
    const out: T[] = [];
    const seenKeys = new Set<string>();
    let cursor: string | undefined;
    let pages = 0;
    do {
      pages += 1;
      if (pages > MAX_TOOLS_LIST_PAGES) {
        throw new Error(
          `mcp-client(${serverName}): ${label} exceeded ${MAX_TOOLS_LIST_PAGES} pages — invalid resource list`,
        );
      }
      const page = await fetchPage(cursor);
      for (const item of page.items) {
        const key = keyOf(item);
        if (seenKeys.has(key)) {
          throw new Error(
            `mcp-client(${serverName}): server listed ${label} entry "${key}" more than once — invalid resource list`,
          );
        }
        seenKeys.add(key);
        out.push(item);
      }
      const next =
        typeof page.nextCursor === "string" && page.nextCursor.length > 0
          ? page.nextCursor
          : undefined;
      if (next !== undefined) {
        if (seenCursors.has(next)) {
          throw new Error(
            `mcp-client(${serverName}): server repeated a ${label} continuation cursor — invalid resource list`,
          );
        }
        seenCursors.add(next);
      }
      cursor = next;
    } while (cursor !== undefined);
    return out;
  }

  function scheduleReconnect(): void {
    const lostEstablished = connectedAt !== undefined;
    connected = false;
    if (!reconnect.enabled) {
      connectedAt = undefined;
      log(
        "error",
        lostEstablished
          ? "connection lost and reconnect is disabled"
          : "connection failed and reconnect is disabled",
      );
      // Terminal for Host overlay / tool unload — same as failure-cap give-up.
      if (lostEstablished) {
        emitState({ status: "gave-up" });
      }
      return;
    }
    if (connectedAt !== undefined && Date.now() - connectedAt >= reconnect.maxDelayMs) {
      failedAttempts = 0;
    }
    connectedAt = undefined;
    failedAttempts += 1;
    if (failedAttempts > reconnect.maxAttempts) {
      log(
        "error",
        `giving up after ${reconnect.maxAttempts} consecutive failed reconnect attempts`,
      );
      emitState({
        status: "gave-up",
        attempt: reconnect.maxAttempts,
        maxAttempts: reconnect.maxAttempts,
      });
      return;
    }
    const delayMs = Math.min(
      reconnect.maxDelayMs,
      reconnect.initialDelayMs * 2 ** (failedAttempts - 1),
    );
    const action = lostEstablished
      ? "connection lost; reconnecting"
      : "connection failed; retrying";
    log(
      "warn",
      `${action} in ${delayMs}ms (attempt ${failedAttempts}/${reconnect.maxAttempts})`,
    );
    emitState({
      status: "reconnecting",
      attempt: failedAttempts,
      maxAttempts: reconnect.maxAttempts,
    });
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined;
      // Non-startup must never reject (dispose races return quietly).
      void connectGeneration(false);
    }, delayMs);
    reconnectTimer.unref?.();
  }

  function generationDown(generation: Client): void {
    if (!isCurrent(generation)) return;
    attempt = undefined;
    client = undefined;
    transport = undefined;
    clientClosed = undefined;
    scheduleReconnect();
  }

  /**
   * One generation: fresh Client + transport. First `connect()` throws on
   * failure (Host spawn fail-closed). Later attempts never reject; they
   * schedule backoff or give up.
   */
  async function connectGeneration(startup: boolean): Promise<void> {
    if (disposed) {
      if (startup) throw new Error("MCP client disposed");
      return;
    }
    assertPolicyAllow(options.policy, {
      kind: "mcp.connect",
      serverId: options.serverName,
    });

    const generation = new Client(
      {
        name: "xrkseek-mcp",
        version: "0.0.0",
      },
      // Advertise empty client capabilities; SDK connect() negotiates protocol
      // version (SUPPORTED_PROTOCOL_VERSIONS) and stores server capabilities.
      { capabilities: {} },
    );
    const closed = withResolvers<void>();
    let attemptSettled = false;
    let closeObserved = false;
    attempt = generation;
    clientClosed = closed.promise;
    generation.onclose = () => {
      closeObserved = true;
      closed.resolve();
      if (attemptSettled) generationDown(generation);
    };
    generation.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      if (!isCurrent(generation) || disposed) return;
      notifyChain = notifyChain.then(fanOutListChanged, fanOutListChanged);
    });

    let next: Transport | undefined;
    try {
      next = await openTransport(options);
      if (disposed) {
        await closeQuietly(next);
        await closeQuietly(generation);
        if (attempt === generation) {
          attempt = undefined;
          clientClosed = undefined;
        }
        if (startup) throw new Error("MCP client disposed");
        return;
      }
      await generation.connect(next);
      if (closeObserved) {
        attemptSettled = true;
        await closeQuietly(next);
        generationDown(generation);
        if (startup) throw new Error("MCP client closed during connect");
        return;
      }
    } catch (err) {
      await closeQuietly(generation);
      await closeQuietly(next);
      attemptSettled = true;
      if (startup) {
        attempt = undefined;
        clientClosed = undefined;
        throw err;
      }
      if (!isCurrent(generation)) return;
      const quiesced = closeObserved || (await waitForClose(closed.promise));
      if (!quiesced) {
        attempt = undefined;
        clientClosed = undefined;
        log(
          "error",
          `failed generation did not close within ${GENERATION_CLOSE_TIMEOUT_MS}ms — reconnect stopped`,
        );
        emitState({
          status: "gave-up",
          attempt: failedAttempts,
          maxAttempts: reconnect.maxAttempts,
        });
        return;
      }
      generationDown(generation);
      return;
    }

    attemptSettled = true;
    if (closeObserved) {
      generationDown(generation);
      if (startup) throw new Error("MCP client closed during connect");
      return;
    }
    if (!isCurrent(generation)) return;

    client = generation;
    transport = next;
    connected = true;
    connectedAt = Date.now();
    emitState({ status: "connected" });
    if (!startup) {
      log("info", `reconnected (attempt ${failedAttempts}/${reconnect.maxAttempts})`);
      notifyChain = notifyChain.then(fanOutListChanged, fanOutListChanged);
    }
  }

  function requireLive(): Client {
    if (disposed) throw new Error("MCP client disposed");
    if (!client || !connected) {
      throw new Error("MCP client not connected");
    }
    return client;
  }

  return {
    serverName: options.serverName,

    async connect() {
      if (disposed) throw new Error("MCP client disposed");
      if (connected) return;
      // Cancel pending backoff so a manual connect does not race a timer generation.
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      if (inflight) return inflight;
      inflight = connectGeneration(true);
      try {
        await inflight;
      } finally {
        inflight = undefined;
      }
    },

    async listTools() {
      const live = requireLive();
      // Servers that omit the tools capability (prompts/resources-only) must
      // not receive tools/list — return an empty generation (DSH mcp-client).
      if (live.getServerCapabilities()?.tools === undefined) {
        return [];
      }
      try {
        return await drainToolsListPages(options.serverName, async (cursor) => {
          const result = await live.listTools(
            cursor === undefined ? undefined : { cursor },
          );
          return {
            tools: result.tools.map((t): McpToolInfo => {
              const annotations = parseMcpToolAnnotations(
                (t as { annotations?: unknown }).annotations,
              );
              return {
                name: t.name,
                description: t.description ?? "",
                inputSchema:
                  t.inputSchema && typeof t.inputSchema === "object"
                    ? t.inputSchema
                    : { type: "object", properties: {} },
                ...(annotations ? { annotations } : {}),
              };
            }),
            ...("nextCursor" in result
              ? {
                  nextCursor: (result as { nextCursor?: string | null }).nextCursor,
                }
              : {}),
          };
        });
      } catch (err) {
        // Some servers reject tools/list with MethodNotFound despite a weak
        // capability advertisement — treat as no tools, not a hard failure.
        if (isToolsListUnsupported(err)) return [];
        throw err;
      }
    },

    async listResources(listOpts) {
      assertPolicyAllow(options.policy, {
        kind: "mcp.resource",
        serverId: options.serverName,
        action: "list",
      });
      const live = requireLive();
      if (live.getServerCapabilities()?.resources === undefined) {
        return { items: [] };
      }
      try {
        if (listOpts?.cursor !== undefined) {
          const page = await live.listResources({ cursor: listOpts.cursor });
          const next =
            typeof page.nextCursor === "string" && page.nextCursor.length > 0
              ? page.nextCursor
              : undefined;
          return {
            items: page.resources.map((r): McpResourceInfo => ({
              uri: r.uri,
              name: r.name,
              ...(r.description !== undefined ? { description: r.description } : {}),
              ...(r.mimeType !== undefined ? { mimeType: r.mimeType } : {}),
            })),
            ...(next !== undefined ? { nextCursor: next } : {}),
          };
        }
        const items = await drainResourcePages<McpResourceInfo>(
          options.serverName,
          "resources/list",
          (r) => r.uri,
          async (cursor) => {
            const page = await live.listResources(
              cursor === undefined ? undefined : { cursor },
            );
            const mapped: McpResourceInfo[] = page.resources.map((r) => ({
              uri: r.uri,
              name: r.name,
              ...(r.description !== undefined ? { description: r.description } : {}),
              ...(r.mimeType !== undefined ? { mimeType: r.mimeType } : {}),
            }));
            return {
              items: mapped,
              ...("nextCursor" in page
                ? {
                    nextCursor: (page as { nextCursor?: string | null }).nextCursor,
                  }
                : {}),
            };
          },
        );
        return { items };
      } catch (err) {
        if (isResourcesUnsupported(err)) return { items: [] };
        throw err;
      }
    },

    async listResourceTemplates(listOpts) {
      assertPolicyAllow(options.policy, {
        kind: "mcp.resource",
        serverId: options.serverName,
        action: "templates",
      });
      const live = requireLive();
      if (live.getServerCapabilities()?.resources === undefined) {
        return { items: [] };
      }
      try {
        if (listOpts?.cursor !== undefined) {
          const page = await live.listResourceTemplates({
            cursor: listOpts.cursor,
          });
          const next =
            typeof page.nextCursor === "string" && page.nextCursor.length > 0
              ? page.nextCursor
              : undefined;
          return {
            items: page.resourceTemplates.map((t): McpResourceTemplateInfo => ({
              uriTemplate: t.uriTemplate,
              name: t.name,
              ...(t.description !== undefined ? { description: t.description } : {}),
              ...(t.mimeType !== undefined ? { mimeType: t.mimeType } : {}),
            })),
            ...(next !== undefined ? { nextCursor: next } : {}),
          };
        }
        const items = await drainResourcePages<McpResourceTemplateInfo>(
          options.serverName,
          "resources/templates/list",
          (t) => t.uriTemplate,
          async (cursor) => {
            const page = await live.listResourceTemplates(
              cursor === undefined ? undefined : { cursor },
            );
            const mapped: McpResourceTemplateInfo[] = page.resourceTemplates.map(
              (t) => ({
                uriTemplate: t.uriTemplate,
                name: t.name,
                ...(t.description !== undefined ? { description: t.description } : {}),
                ...(t.mimeType !== undefined ? { mimeType: t.mimeType } : {}),
              }),
            );
            return {
              items: mapped,
              ...("nextCursor" in page
                ? {
                    nextCursor: (page as { nextCursor?: string | null }).nextCursor,
                  }
                : {}),
            };
          },
        );
        return { items };
      } catch (err) {
        if (isResourcesUnsupported(err)) return { items: [] };
        throw err;
      }
    },

    async readResource(uri, signal) {
      const trimmed = uri.trim();
      if (!trimmed) throw new Error("readResource: uri required");
      assertPolicyAllow(options.policy, {
        kind: "mcp.resource",
        serverId: options.serverName,
        action: "read",
        uri: trimmed,
      });
      const live = requireLive();
      if (live.getServerCapabilities()?.resources === undefined) {
        throw new Error(
          `mcp-client(${options.serverName}): server does not support resources`,
        );
      }
      const result = await live.readResource(
        { uri: trimmed },
        {
          timeout: timeoutMs,
          ...(signal ? { signal } : {}),
        },
      );
      return {
        contents: result.contents.map((c): McpResourceContents["contents"][number] => {
          if ("blob" in c && typeof c.blob === "string") {
            return {
              uri: c.uri,
              blob: c.blob,
              ...(c.mimeType !== undefined ? { mimeType: c.mimeType } : {}),
            };
          }
          return {
            uri: c.uri,
            text: "text" in c && typeof c.text === "string" ? c.text : "",
            ...(c.mimeType !== undefined ? { mimeType: c.mimeType } : {}),
          };
        }),
      };
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
      return mapMcpCallContent(result, rawName, options.imageAdmission);
    },

    onToolsListChanged(handler) {
      listChangedHandlers.add(handler);
      return () => {
        listChangedHandlers.delete(handler);
      };
    },

    onConnectionState(handler) {
      stateHandlers.add(handler);
      return () => {
        stateHandlers.delete(handler);
      };
    },

    async dispose() {
      disposed = true;
      connected = false;
      if (reconnectTimer !== undefined) {
        clearTimeout(reconnectTimer);
        reconnectTimer = undefined;
      }
      listChangedHandlers.clear();
      stateHandlers.clear();
      // Abandon any in-flight attempt: connectGeneration checks `disposed`
      // after openTransport and cleans up. Closing a never-connected Client
      // here can hang the SDK close path.
      const live = client;
      const liveClosed = clientClosed;
      const liveTransport = transport;
      const established = connectedAt !== undefined;
      attempt = undefined;
      client = undefined;
      transport = undefined;
      clientClosed = undefined;
      connectedAt = undefined;
      try {
        live?.removeNotificationHandler("notifications/tools/list_changed");
      } catch {
        /* ignore */
      }
      await closeQuietly(live);
      await closeQuietly(liveTransport);
      if (
        established &&
        liveClosed !== undefined &&
        !(await waitForClose(liveClosed))
      ) {
        log(
          "error",
          `generation did not close within ${GENERATION_CLOSE_TIMEOUT_MS}ms during disposal`,
        );
      }
    },
  };
}
