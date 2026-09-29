/**
 * Sidebar terminal WebSocket for xrkh-better-sidebar (dsh-compat).
 * Wire: text frames ↔ node-pty; JSON `{type:"resize"|"close"|"park"}` control.
 *
 * Contract notes (match plugin PtyManager expectations):
 * - Key UI tabs by `sessionId` + `tab`; bare socket drop starts a reconnect
 *   grace instead of killing the shell immediately (React remounts / panel
 *   toggles would otherwise spin 「终端连接断开，重连中…」).
 * - PTY process exit must NOT close the socket with code 1000 (client treats
 *   that as a transient drop and retries forever).
 *
 * Permissions (DSH user-terminal-permissions): these shells run as the Host
 * system user with **no Agent sandbox confine and no approval**. They must not
 * be reported into Face `hasPtyActivity` — Agent `/permission` sandbox changes
 * stay independent of open sidebar tabs.
 */
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { homedir } from "node:os";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket, type RawData } from "ws";
import type { AgentOpenRegistry } from "./sidebar-agent-opens.js";
import type { AgentPtyRegistry } from "./sidebar-agent-pty.js";

const PTY_DEPS_MISSING = "pty-deps-missing";
/** Reconnect grace after bare socket drop / park (ms). */
const RECONNECT_GRACE_MS = 30_000;
/** WebSocket.OPEN — also used by Desktop HTTP sinks. */
const PTY_CLIENT_OPEN = 1;

export interface SidebarPtyOptions {
  readonly defaultCwd: string;
  readonly checkAuth: (req: IncomingMessage) => boolean;
  /** Agent `terminal_create` registry — drives `/sidebar/ws/agent-terminals`. */
  readonly agentPty?: AgentPtyRegistry;
  /** `sidebar_open` registry — drives `/sidebar/ws/agent-opens`. */
  readonly agentOpens?: AgentOpenRegistry;
}

interface InteractivePty {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: () => void): { dispose(): void };
}

/** Output sink shared by WS clients and Desktop HTTP/SSE carriers. */
interface PtyClient {
  send(data: string): void;
  readonly readyState: number;
}

interface PtySlot {
  term: InteractivePty;
  /** Attached browser sockets / HTTP sinks (usually 0 or 1). */
  clients: Set<PtyClient>;
  graceTimer: ReturnType<typeof setTimeout> | undefined;
  exited: boolean;
  dataDisposable: { dispose(): void };
  exitDisposable: { dispose(): void };
}

function defaultShellArgv(): string[] {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec?.trim();
    return [comspec && comspec.length > 0 ? comspec : "cmd.exe"];
  }
  const shell = process.env.SHELL?.trim();
  return [shell && shell.length > 0 ? shell : "/bin/bash", "-l"];
}

function resolveQuery(req: IncomingMessage): {
  cwd: string | undefined;
  key: string | undefined;
  uuid: string | undefined;
  sessionId: string | undefined;
} {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const cwd = url.searchParams.get("cwd")?.trim() || undefined;
    const sessionId = url.searchParams.get("sessionId")?.trim() || undefined;
    const tab = url.searchParams.get("tab")?.trim();
    const uuid = url.searchParams.get("uuid")?.trim() || undefined;
    const key =
      sessionId && sessionId.length > 0 && tab && tab.length > 0
        ? `${sessionId}\0${tab}`
        : undefined;
    return { cwd, key, uuid, sessionId };
  } catch {
    return {
      cwd: undefined,
      key: undefined,
      uuid: undefined,
      sessionId: undefined,
    };
  }
}

async function spawnInteractivePty(
  cwd: string,
  cols: number,
  rows: number,
): Promise<InteractivePty> {
  let ptyMod: {
    spawn: (
      file: string,
      args: string[],
      opts: Record<string, unknown>,
    ) => InteractivePty;
  };
  try {
    ptyMod = await import("node-pty");
  } catch {
    throw new Error(PTY_DEPS_MISSING);
  }
  const argv = defaultShellArgv();
  const file = argv[0]!;
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === "string") env[k] = v;
  }
  if (!env.TERM) env.TERM = "xterm-256color";
  return ptyMod.spawn(file, argv.slice(1), {
    name: "xterm-256color",
    cols,
    rows,
    cwd,
    env,
    ...(process.platform === "win32"
      ? { useConpty: true, conptyInheritCursor: false }
      : {}),
  });
}

async function spawnWithCwdFallback(
  cwd: string,
  fallback: string,
  cols: number,
  rows: number,
): Promise<InteractivePty> {
  try {
    return await spawnInteractivePty(cwd, cols, rows);
  } catch (first) {
    if (first instanceof Error && first.message === PTY_DEPS_MISSING) throw first;
    const home = homedir();
    for (const next of [fallback, home]) {
      if (!next || next === cwd) continue;
      try {
        return await spawnInteractivePty(next, cols, rows);
      } catch {
        /* try next */
      }
    }
    throw first;
  }
}

function rawToText(raw: RawData): string {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return Buffer.from(raw).toString("utf8");
}

function destroySlot(slot: PtySlot): void {
  if (slot.graceTimer !== undefined) {
    clearTimeout(slot.graceTimer);
    slot.graceTimer = undefined;
  }
  try {
    slot.dataDisposable.dispose();
  } catch {
    /* ignore */
  }
  try {
    slot.exitDisposable.dispose();
  } catch {
    /* ignore */
  }
  try {
    slot.term.kill();
  } catch {
    /* ignore */
  }
  slot.clients.clear();
}

/** Host-side handle: WS upgrades + Desktop HTTP/SSE (no TCP listen). */
export interface SidebarPtyHandle {
  close(): void;
  /**
   * Desktop `xrk-app://` cannot upgrade WebSockets. Same PTY slots over
   * `/sidebar/api/pty/*` (SSE stream + POST input/control).
   */
  tryHandleHttp(req: IncomingMessage, res: ServerResponse): boolean;
}

/**
 * Attach `/sidebar/ws/terminal`, `/sidebar/ws/agent-terminals`, `/sidebar/ws/agent-opens`.
 */
export function attachSidebarPtyUpgrades(
  server: Server,
  options: SidebarPtyOptions,
): SidebarPtyHandle {
  const terminalWss = new WebSocketServer({ noServer: true });
  const agentWss = new WebSocketServer({ noServer: true });
  const agentOpensWss = new WebSocketServer({ noServer: true });
  const slots = new Map<string, PtySlot>();
  let closed = false;

  const releaseSlot = (key: string | undefined, slot: PtySlot): void => {
    destroySlot(slot);
    if (key) slots.delete(key);
  };

  const bindAgentTerminalSocket = (ws: WebSocket, req: IncomingMessage): void => {
    const { uuid } = resolveQuery(req);
    const registry = options.agentPty;
    if (!uuid || !registry) {
      try {
        ws.close(1008, "uuid is required");
      } catch {
        /* ignore */
      }
      return;
    }
    const handle = registry.get(uuid);
    if (!handle) {
      try {
        ws.close(1008, "agent terminal not found");
      } catch {
        /* ignore */
      }
      return;
    }
    let socketClosed = false;
    const closeSocket = (code = 1000, reason = ""): void => {
      if (socketClosed) return;
      socketClosed = true;
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        try {
          ws.close(code, reason.slice(0, 123));
        } catch {
          /* ignore */
        }
      }
    };
    // Replay retained transcript, then pump live output.
    const replay = handle.transcript.snapshot().text;
    if (replay.length > 0 && ws.readyState === ws.OPEN) {
      try {
        ws.send(replay);
      } catch {
        /* ignore */
      }
    }
    const pump = handle.pty.onData((data) => {
      if (socketClosed || ws.readyState !== ws.OPEN) return;
      try {
        ws.send(data);
      } catch {
        /* ignore */
      }
    });
    ws.on("message", (raw) => {
      if (socketClosed || handle.exited) return;
      const text = rawToText(raw);
      if (text.startsWith("{")) {
        try {
          const msg = JSON.parse(text) as {
            type?: string;
            cols?: number;
            rows?: number;
          };
          if (msg.type === "close") {
            registry.close(uuid);
            closeSocket();
            return;
          }
          if (msg.type === "resize") {
            const cols =
              typeof msg.cols === "number" && msg.cols > 0 ? msg.cols : 80;
            const rows =
              typeof msg.rows === "number" && msg.rows > 0 ? msg.rows : 24;
            try {
              registry.resize(uuid, cols, rows);
            } catch {
              /* ignore */
            }
            return;
          }
        } catch {
          /* fall through */
        }
      }
      try {
        registry.send(uuid, text);
      } catch {
        /* ignore */
      }
    });
    ws.on("close", () => {
      socketClosed = true;
      try {
        pump.dispose();
      } catch {
        /* ignore */
      }
    });
    ws.on("error", () => {
      closeSocket();
    });
  };

  const bindTerminalSocket = (ws: WebSocket, req: IncomingMessage): void => {
    const { uuid } = resolveQuery(req);
    if (uuid) {
      bindAgentTerminalSocket(ws, req);
      return;
    }
    let socketClosed = false;
    let cols = 80;
    let rows = 24;
    const { cwd: queryCwd, key } = resolveQuery(req);
    const cwd = queryCwd && queryCwd.length > 0 ? queryCwd : options.defaultCwd;
    let slot: PtySlot | undefined;
    let anonymous = false;

    const closeSocket = (code = 1000, reason = ""): void => {
      if (socketClosed) return;
      socketClosed = true;
      if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
        try {
          ws.close(code, reason.slice(0, 123));
        } catch {
          /* ignore */
        }
      }
    };

    const detachClient = (opts: { kill: boolean; park: boolean }): void => {
      if (!slot) {
        closeSocket();
        return;
      }
      slot.clients.delete(ws);
      if (opts.kill || anonymous || !key) {
        releaseSlot(key, slot);
        slot = undefined;
        closeSocket();
        return;
      }
      // Park / bare drop: keep PTY for reconnect grace.
      if (slot.clients.size === 0 && !slot.exited) {
        if (slot.graceTimer !== undefined) clearTimeout(slot.graceTimer);
        const graceMs = opts.park ? RECONNECT_GRACE_MS * 10 : RECONNECT_GRACE_MS;
        slot.graceTimer = setTimeout(() => {
          const current = key ? slots.get(key) : undefined;
          if (current !== undefined && current === slot && current.clients.size === 0) {
            releaseSlot(key, current);
          }
        }, graceMs);
      }
      closeSocket();
    };

    void (async () => {
      try {
        if (key) {
          const existing = slots.get(key);
          if (existing && !existing.exited) {
            slot = existing;
            if (slot.graceTimer !== undefined) {
              clearTimeout(slot.graceTimer);
              slot.graceTimer = undefined;
            }
            slot.clients.add(ws);
            return;
          }
        }

        const term = await spawnWithCwdFallback(
          cwd,
          options.defaultCwd,
          cols,
          rows,
        );
        if (socketClosed) {
          try {
            term.kill();
          } catch {
            /* ignore */
          }
          return;
        }

        const next: PtySlot = {
          term,
          clients: new Set([ws]),
          graceTimer: undefined,
          exited: false,
          dataDisposable: term.onData((data) => {
            for (const client of next.clients) {
              if (client.readyState === PTY_CLIENT_OPEN) {
                try {
                  client.send(data);
                } catch {
                  /* ignore */
                }
              }
            }
          }),
          exitDisposable: term.onExit(() => {
            next.exited = true;
            for (const client of [...next.clients]) {
              if (client.readyState === PTY_CLIENT_OPEN) {
                try {
                  client.send("\r\n[process exited]\r\n");
                } catch {
                  /* ignore */
                }
              }
            }
            if (key) slots.delete(key);
            // Do not close client sockets with 1000 — that triggers soft-reconnect forever.
          }),
        };
        slot = next;
        if (key) slots.set(key, next);
        else anonymous = true;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        closeSocket(1011, msg === PTY_DEPS_MISSING ? PTY_DEPS_MISSING : msg);
      }
    })();

    ws.on("message", (raw) => {
      if (socketClosed || !slot || slot.exited) return;
      const text = rawToText(raw);
      if (text.startsWith("{")) {
        try {
          const msg = JSON.parse(text) as {
            type?: string;
            cols?: number;
            rows?: number;
          };
          if (msg.type === "close") {
            detachClient({ kill: true, park: false });
            return;
          }
          if (msg.type === "park") {
            detachClient({ kill: false, park: true });
            return;
          }
          if (msg.type === "resize") {
            const nextCols =
              typeof msg.cols === "number" && msg.cols > 0 ? msg.cols : cols;
            const nextRows =
              typeof msg.rows === "number" && msg.rows > 0 ? msg.rows : rows;
            cols = nextCols;
            rows = nextRows;
            try {
              slot.term.resize(cols, rows);
            } catch {
              /* ignore */
            }
            return;
          }
        } catch {
          /* fall through as raw input */
        }
      }
      try {
        slot.term.write(text);
      } catch {
        /* ignore */
      }
    });

    ws.on("close", () => {
      if (socketClosed) return;
      socketClosed = true;
      if (!slot) return;
      slot.clients.delete(ws);
      if (anonymous || !key) {
        releaseSlot(key, slot);
        return;
      }
      if (slot.clients.size === 0 && !slot.exited) {
        if (slot.graceTimer !== undefined) clearTimeout(slot.graceTimer);
        slot.graceTimer = setTimeout(() => {
          const current = slots.get(key);
          if (current !== undefined && current === slot && current.clients.size === 0) {
            releaseSlot(key, current);
          }
        }, RECONNECT_GRACE_MS);
      }
    });

    ws.on("error", () => {
      if (socketClosed) return;
      detachClient({ kill: false, park: false });
    });
  };

  const onUpgrade = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (
      url.pathname !== "/sidebar/ws/terminal" &&
      url.pathname !== "/sidebar/ws/agent-terminals" &&
      url.pathname !== "/sidebar/ws/agent-opens"
    ) {
      return;
    }
    if (!options.checkAuth(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const wss =
      url.pathname === "/sidebar/ws/agent-terminals"
        ? agentWss
        : url.pathname === "/sidebar/ws/agent-opens"
          ? agentOpensWss
          : terminalWss;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  };

  server.on("upgrade", onUpgrade);

  terminalWss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    bindTerminalSocket(ws, req);
  });

  agentWss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const { sessionId } = resolveQuery(req);
    if (!sessionId) {
      try {
        ws.close(1008, "sessionId is required");
      } catch {
        /* ignore */
      }
      return;
    }
    const registry = options.agentPty;
    const send = (): void => {
      if (ws.readyState !== ws.OPEN) return;
      try {
        ws.send(JSON.stringify(registry?.list(sessionId) ?? []));
      } catch {
        /* ignore */
      }
    };
    send();
    const unsubscribe = registry?.subscribe(send);
    // Keepalive empty push only when no registry (degraded Host) — avoids reconnect storms.
    const timer =
      registry === undefined
        ? setInterval(send, 15_000)
        : undefined;
    const cleanup = (): void => {
      unsubscribe?.();
      if (timer !== undefined) clearInterval(timer);
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });

  agentOpensWss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    const { sessionId } = resolveQuery(req);
    if (!sessionId) {
      try {
        ws.close(1008, "sessionId is required");
      } catch {
        /* ignore */
      }
      return;
    }
    const registry = options.agentOpens;
    if (!registry) {
      ws.on("error", () => {
        /* idle stub without registry */
      });
      return;
    }
    const send = (request: {
      id: string;
      sessionId: string;
      kind: string;
      target: string;
      title: string;
    }): void => {
      if (ws.readyState !== ws.OPEN) return;
      try {
        ws.send(JSON.stringify(request));
      } catch {
        /* ignore */
      }
    };
    const unsubscribe = registry.attach(sessionId, send);
    ws.on("close", () => {
      unsubscribe();
    });
    ws.on("error", () => {
      unsubscribe();
    });
  });

  return {
    tryHandleHttp(req: IncomingMessage, res: ServerResponse): boolean {
      if (closed) return false;
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const path = url.pathname;
      if (
        path !== "/sidebar/api/pty/stream" &&
        path !== "/sidebar/api/pty/input" &&
        path !== "/sidebar/api/pty/control"
      ) {
        return false;
      }
      if (!options.checkAuth(req)) {
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "unauthorized" }));
        return true;
      }

      if (path === "/sidebar/api/pty/stream" && (req.method === "GET" || req.method === "HEAD")) {
        if (req.method === "HEAD") {
          res.writeHead(200, {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          res.end();
          return true;
        }
        void attachHttpStream(req, res, url);
        return true;
      }

      if (path === "/sidebar/api/pty/input" && req.method === "POST") {
        void (async () => {
          try {
            const body = JSON.parse(await readHttpBody(req)) as {
              sessionId?: string;
              tab?: string;
              uuid?: string;
              data?: string;
            };
            const key = ptyKeyFromBody(body);
            if (typeof body.data !== "string") {
              res.writeHead(400).end();
              return;
            }
            if (body.uuid) {
              const registry = options.agentPty;
              if (!registry) {
                res.writeHead(404).end();
                return;
              }
              registry.send(body.uuid, body.data);
              res.writeHead(204).end();
              return;
            }
            if (!key) {
              res.writeHead(400).end();
              return;
            }
            const slot = slots.get(key);
            if (!slot || slot.exited) {
              res.writeHead(404).end();
              return;
            }
            slot.term.write(body.data);
            res.writeHead(204).end();
          } catch {
            res.writeHead(400).end();
          }
        })();
        return true;
      }

      if (path === "/sidebar/api/pty/control" && req.method === "POST") {
        void (async () => {
          try {
            const body = JSON.parse(await readHttpBody(req)) as {
              sessionId?: string;
              tab?: string;
              uuid?: string;
              type?: string;
              cols?: number;
              rows?: number;
            };
            const key = ptyKeyFromBody(body);
            if (body.uuid && body.type === "resize") {
              const cols =
                typeof body.cols === "number" && body.cols > 0 ? body.cols : 80;
              const rows =
                typeof body.rows === "number" && body.rows > 0 ? body.rows : 24;
              options.agentPty?.resize(body.uuid, cols, rows);
              res.writeHead(204).end();
              return;
            }
            if (body.uuid && body.type === "close") {
              options.agentPty?.close(body.uuid);
              res.writeHead(204).end();
              return;
            }
            if (!key) {
              res.writeHead(400).end();
              return;
            }
            const slot = slots.get(key);
            if (!slot) {
              res.writeHead(404).end();
              return;
            }
            if (body.type === "close") {
              releaseSlot(key, slot);
              res.writeHead(204).end();
              return;
            }
            if (body.type === "park") {
              if (slot.clients.size === 0 && !slot.exited) {
                if (slot.graceTimer !== undefined) clearTimeout(slot.graceTimer);
                slot.graceTimer = setTimeout(() => {
                  const current = slots.get(key);
                  if (
                    current !== undefined &&
                    current === slot &&
                    current.clients.size === 0
                  ) {
                    releaseSlot(key, current);
                  }
                }, RECONNECT_GRACE_MS * 10);
              }
              res.writeHead(204).end();
              return;
            }
            if (body.type === "resize") {
              const cols =
                typeof body.cols === "number" && body.cols > 0 ? body.cols : 80;
              const rows =
                typeof body.rows === "number" && body.rows > 0 ? body.rows : 24;
              try {
                slot.term.resize(cols, rows);
              } catch {
                /* ignore */
              }
              res.writeHead(204).end();
              return;
            }
            res.writeHead(400).end();
          } catch {
            res.writeHead(400).end();
          }
        })();
        return true;
      }

      res.writeHead(405).end();
      return true;
    },
    close() {
      if (closed) return;
      closed = true;
      server.off("upgrade", onUpgrade);
      for (const [key, slot] of slots) {
        releaseSlot(key, slot);
      }
      for (const wss of [terminalWss, agentWss, agentOpensWss]) {
        for (const client of wss.clients) {
          try {
            client.terminate();
          } catch {
            /* ignore */
          }
        }
        wss.close();
      }
    },
  };

  function ptyKeyFromBody(body: {
    sessionId?: string;
    tab?: string;
  }): string | undefined {
    const sessionId = body.sessionId?.trim();
    const tab = body.tab?.trim();
    if (sessionId && sessionId.length > 0 && tab && tab.length > 0) {
      return `${sessionId}\0${tab}`;
    }
    return undefined;
  }

  async function attachHttpStream(
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): Promise<void> {
    const writeEvent = (payload: unknown): void => {
      if (res.writableEnded || res.destroyed) return;
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    let sinkAlive = true;
    const sink: PtyClient = {
      readyState: PTY_CLIENT_OPEN,
      send(data: string) {
        writeEvent({ type: "data", data });
      },
    };

    const endStream = (payload?: unknown): void => {
      if (!sinkAlive) return;
      sinkAlive = false;
      if (payload !== undefined) writeEvent(payload);
      try {
        res.end();
      } catch {
        /* ignore */
      }
    };

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(": connected\n\n");

    const keepalive = setInterval(() => {
      if (res.writableEnded || res.destroyed) return;
      res.write(": keepalive\n\n");
    }, 15_000);

    const uuid = url.searchParams.get("uuid")?.trim() || undefined;
    if (uuid) {
      const registry = options.agentPty;
      if (!registry) {
        clearInterval(keepalive);
        endStream({ type: "error", code: 1011, reason: "agent pty unavailable" });
        return;
      }
      const handle = registry.get(uuid);
      if (!handle) {
        clearInterval(keepalive);
        endStream({ type: "error", code: 1011, reason: "agent terminal not found" });
        return;
      }
      const replay = handle.transcript.snapshot().text;
      if (replay.length > 0) writeEvent({ type: "data", data: replay });
      const pump = handle.pty.onData((data) => {
        if (sinkAlive) sink.send(data);
      });
      const onReqClose = (): void => {
        clearInterval(keepalive);
        sinkAlive = false;
        try {
          pump.dispose();
        } catch {
          /* ignore */
        }
      };
      req.on("close", onReqClose);
      res.on("close", onReqClose);
      return;
    }

    const sessionId = url.searchParams.get("sessionId")?.trim() || undefined;
    const tab = url.searchParams.get("tab")?.trim() || undefined;
    const queryCwd = url.searchParams.get("cwd")?.trim() || undefined;
    const key =
      sessionId && sessionId.length > 0 && tab && tab.length > 0
        ? `${sessionId}\0${tab}`
        : undefined;
    const cwd =
      queryCwd && queryCwd.length > 0 ? queryCwd : options.defaultCwd;
    const cols = 80;
    const rows = 24;
    let slot: PtySlot | undefined;
    let anonymous = false;

    const detachHttp = (opts: { kill: boolean; park: boolean }): void => {
      clearInterval(keepalive);
      if (!slot) {
        endStream();
        return;
      }
      slot.clients.delete(sink);
      if (opts.kill || anonymous || !key) {
        releaseSlot(key, slot);
        slot = undefined;
        endStream(opts.kill ? { type: "exit" } : undefined);
        return;
      }
      if (slot.clients.size === 0 && !slot.exited) {
        if (slot.graceTimer !== undefined) clearTimeout(slot.graceTimer);
        const graceMs = opts.park ? RECONNECT_GRACE_MS * 10 : RECONNECT_GRACE_MS;
        slot.graceTimer = setTimeout(() => {
          const current = key ? slots.get(key) : undefined;
          if (
            current !== undefined &&
            current === slot &&
            current.clients.size === 0
          ) {
            releaseSlot(key, current);
          }
        }, graceMs);
      }
      endStream();
    };

    try {
      if (key) {
        const existing = slots.get(key);
        if (existing && !existing.exited) {
          slot = existing;
          if (slot.graceTimer !== undefined) {
            clearTimeout(slot.graceTimer);
            slot.graceTimer = undefined;
          }
          slot.clients.add(sink);
        }
      }
      if (!slot) {
        const term = await spawnWithCwdFallback(
          cwd,
          options.defaultCwd,
          cols,
          rows,
        );
        if (!sinkAlive) {
          try {
            term.kill();
          } catch {
            /* ignore */
          }
          clearInterval(keepalive);
          return;
        }
        const next: PtySlot = {
          term,
          clients: new Set([sink]),
          graceTimer: undefined,
          exited: false,
          dataDisposable: term.onData((data) => {
            for (const client of next.clients) {
              if (client.readyState === PTY_CLIENT_OPEN) {
                try {
                  client.send(data);
                } catch {
                  /* ignore */
                }
              }
            }
          }),
          exitDisposable: term.onExit(() => {
            next.exited = true;
            for (const client of [...next.clients]) {
              if (client.readyState === PTY_CLIENT_OPEN) {
                try {
                  client.send("\r\n[process exited]\r\n");
                } catch {
                  /* ignore */
                }
              }
            }
            if (key) slots.delete(key);
            clearInterval(keepalive);
            endStream({ type: "exit" });
          }),
        };
        slot = next;
        if (key) slots.set(key, next);
        else anonymous = true;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      clearInterval(keepalive);
      endStream({
        type: "error",
        code: 1011,
        reason: msg === PTY_DEPS_MISSING ? PTY_DEPS_MISSING : msg,
      });
      return;
    }

    const onDrop = (): void => {
      if (!sinkAlive) return;
      detachHttp({ kill: false, park: false });
    };
    req.on("close", onDrop);
    res.on("close", onDrop);

    // Keep TypeScript happy — cols/rows reserved for future stream-query size hints.
    void cols;
    void rows;
  }
}

function readHttpBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
