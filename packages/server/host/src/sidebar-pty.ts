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
 */
import type { IncomingMessage, Server } from "node:http";
import { homedir } from "node:os";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket, type RawData } from "ws";

const PTY_DEPS_MISSING = "pty-deps-missing";
/** Reconnect grace after bare socket drop / park (ms). */
const RECONNECT_GRACE_MS = 30_000;

export interface SidebarPtyOptions {
  readonly defaultCwd: string;
  readonly checkAuth: (req: IncomingMessage) => boolean;
}

interface InteractivePty {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(cb: () => void): { dispose(): void };
}

interface PtySlot {
  term: InteractivePty;
  /** Attached browser sockets (usually 0 or 1). */
  clients: Set<WebSocket>;
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
} {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const cwd = url.searchParams.get("cwd")?.trim() || undefined;
    const sessionId = url.searchParams.get("sessionId")?.trim();
    const tab = url.searchParams.get("tab")?.trim();
    const key =
      sessionId && sessionId.length > 0 && tab && tab.length > 0
        ? `${sessionId}\0${tab}`
        : undefined;
    return { cwd, key };
  } catch {
    return { cwd: undefined, key: undefined };
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

/**
 * Attach `/sidebar/ws/terminal`, `/sidebar/ws/agent-terminals`, `/sidebar/ws/agent-opens`.
 */
export function attachSidebarPtyUpgrades(
  server: Server,
  options: SidebarPtyOptions,
): { close(): void } {
  const terminalWss = new WebSocketServer({ noServer: true });
  const agentWss = new WebSocketServer({ noServer: true });
  const agentOpensWss = new WebSocketServer({ noServer: true });
  const slots = new Map<string, PtySlot>();
  let closed = false;

  const releaseSlot = (key: string | undefined, slot: PtySlot): void => {
    destroySlot(slot);
    if (key) slots.delete(key);
  };

  const bindTerminalSocket = (ws: WebSocket, req: IncomingMessage): void => {
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
              if (client.readyState === client.OPEN) {
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
              if (client.readyState === client.OPEN) {
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

  agentWss.on("connection", (ws: WebSocket) => {
    const push = () => {
      if (ws.readyState === ws.OPEN) ws.send("[]");
    };
    push();
    const timer = setInterval(push, 15_000);
    ws.on("close", () => clearInterval(timer));
  });

  agentOpensWss.on("connection", (ws: WebSocket) => {
    ws.on("error", () => {
      /* ignore */
    });
  });

  return {
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
}
