import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";
import { assertPolicyAllow } from "@xrkseek/policy";
import { assertServerName } from "./names.js";
import { mapMcpCallContent } from "./project-content.js";
import { resolveReconnectPolicy } from "./reconnect.js";
import type {
  McpClient,
  McpClientOptions,
  McpConnectionState,
  McpToolInfo,
} from "./types.js";

const DEFAULT_TOOL_CALL_TIMEOUT_MS = 60_000;

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
 *
 * After the first successful `connect()`, a generation supervisor owns
 * `Client.onclose`: recreate Client+transport with bounded backoff
 * (DSH `connection.ts`) for stdio **and** HTTP. HTTP also keeps SDK SSE
 * resume via `reconnectionOptions`. Pass `reconnect: { enabled: false }` to
 * opt out of process-level restart (lost connections emit `gave-up`).
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

  const isCurrent = (generation: Client): boolean => !disposed && attempt === generation;

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
    log("warn", `${action} in ${delayMs}ms (attempt ${failedAttempts}/${reconnect.maxAttempts})`);
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

    const generation = new Client({
      name: "xrkseek-mcp",
      version: "0.0.0",
    });
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
      const quiesced = closeObserved || await waitForClose(closed.promise);
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
      if (established && liveClosed !== undefined && !await waitForClose(liveClosed)) {
        log(
          "error",
          `generation did not close within ${GENERATION_CLOSE_TIMEOUT_MS}ms during disposal`,
        );
      }
    },
  };
}
