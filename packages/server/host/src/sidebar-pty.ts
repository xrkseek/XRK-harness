/**
 * Sidebar terminal WebSocket (`/sidebar/ws/terminal`) for dsh-better-sidebar.
 * Wire: text frames ↔ node-pty; JSON `{type:"resize"|"close"}` control.
 */
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket, type RawData } from "ws";

const PTY_DEPS_MISSING = "pty-deps-missing";

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

function defaultShellArgv(): string[] {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec?.trim();
    return [comspec && comspec.length > 0 ? comspec : "cmd.exe"];
  }
  const shell = process.env.SHELL?.trim();
  return [shell && shell.length > 0 ? shell : "/bin/bash", "-l"];
}

function resolveCwd(req: IncomingMessage, fallback: string): string {
  try {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const cwd = url.searchParams.get("cwd")?.trim();
    return cwd && cwd.length > 0 ? cwd : fallback;
  } catch {
    return fallback;
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
    ptyMod = (await import("node-pty"));
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

function rawToText(raw: RawData): string {
  if (typeof raw === "string") return raw;
  if (Buffer.isBuffer(raw)) return raw.toString("utf8");
  if (Array.isArray(raw)) return Buffer.concat(raw).toString("utf8");
  return Buffer.from(raw).toString("utf8");
}

function bindTerminalSocket(
  ws: WebSocket,
  req: IncomingMessage,
  options: SidebarPtyOptions,
): void {
  let closed = false;
  let cols = 80;
  let rows = 24;
  let term: InteractivePty | undefined;
  const cwd = resolveCwd(req, options.defaultCwd);

  const shutdown = (code = 1000, reason = "") => {
    if (closed) return;
    closed = true;
    try {
      term?.kill();
    } catch {
      /* ignore */
    }
    term = undefined;
    if (ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING) {
      try {
        ws.close(code, reason.slice(0, 123));
      } catch {
        /* ignore */
      }
    }
  };

  void (async () => {
    try {
      term = await spawnInteractivePty(cwd, cols, rows);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      shutdown(1011, msg === PTY_DEPS_MISSING ? PTY_DEPS_MISSING : msg);
      return;
    }
    term.onData((data) => {
      if (ws.readyState === ws.OPEN) ws.send(data);
    });
    term.onExit(() => {
      shutdown(1000, "");
    });
  })();

  ws.on("message", (raw) => {
    if (closed || !term) return;
    const text = rawToText(raw);
    if (text.startsWith("{")) {
      try {
        const msg = JSON.parse(text) as {
          type?: string;
          cols?: number;
          rows?: number;
        };
        if (msg.type === "close") {
          shutdown(1000, "");
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
            term.resize(cols, rows);
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
      term.write(text);
    } catch {
      /* ignore */
    }
  });

  ws.on("close", () => shutdown(1000, ""));
  ws.on("error", () => shutdown(1011, "socket-error"));
}

/**
 * Attach `/sidebar/ws/terminal` + `/sidebar/ws/agent-terminals`.
 * Face upgrades ignore non-Face paths, so this listener coexists safely.
 */
export function attachSidebarPtyUpgrades(
  server: Server,
  options: SidebarPtyOptions,
): { close(): void } {
  const terminalWss = new WebSocketServer({ noServer: true });
  const agentWss = new WebSocketServer({ noServer: true });
  let closed = false;

  const onUpgrade = (
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): void => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    if (
      url.pathname !== "/sidebar/ws/terminal" &&
      url.pathname !== "/sidebar/ws/agent-terminals"
    ) {
      return;
    }
    if (!options.checkAuth(req)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    const wss =
      url.pathname === "/sidebar/ws/agent-terminals" ? agentWss : terminalWss;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  };

  server.on("upgrade", onUpgrade);

  terminalWss.on("connection", (ws: WebSocket, req: IncomingMessage) => {
    bindTerminalSocket(ws, req, options);
  });

  agentWss.on("connection", (ws: WebSocket) => {
    const push = () => {
      if (ws.readyState === ws.OPEN) ws.send("[]");
    };
    push();
    const timer = setInterval(push, 15_000);
    ws.on("close", () => clearInterval(timer));
  });

  return {
    close() {
      if (closed) return;
      closed = true;
      server.off("upgrade", onUpgrade);
      for (const client of terminalWss.clients) {
        try {
          client.terminate();
        } catch {
          /* ignore */
        }
      }
      for (const client of agentWss.clients) {
        try {
          client.terminate();
        } catch {
          /* ignore */
        }
      }
      terminalWss.close();
      agentWss.close();
    },
  };
}
