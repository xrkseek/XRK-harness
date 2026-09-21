/**
 * Agent-owned sidebar PTY registry (`terminal_create` …). Parallel to user-tab
 * PTYs in `sidebar-pty.ts` — uuid-keyed, not counted in Face `hasPtyActivity`.
 */
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { BoundedTextBuffer } from "@xrkseek/exec-pty";

/** UTF-8 byte ceiling for agent terminal transcripts (same idea as PTY scrollback). */
const TRANSCRIPT_MAX_BYTES = 1 << 20;
export const ALLOWED_SIGNALS = [
  "SIGINT",
  "SIGTERM",
  "SIGKILL",
  "SIGHUP",
  "SIGTSTP",
] as const;
export type AgentTerminalSignal = (typeof ALLOWED_SIGNALS)[number];
export const DEFAULT_READ_COUNT = 500;
export const TERMINAL_DIM_MIN = 2;
export const TERMINAL_DIM_MAX = 1024;

export function clampDims(
  cols: number,
  rows: number,
): { cols: number; rows: number } {
  const clamp = (value: number): number =>
    Math.min(TERMINAL_DIM_MAX, Math.max(TERMINAL_DIM_MIN, Math.floor(value)));
  return { cols: clamp(cols), rows: clamp(rows) };
}

export interface AgentTerminalSnapshot {
  readonly uuid: string;
  readonly title: string;
  readonly command: string;
  readonly exited: boolean;
  readonly exitCode?: number | null;
  readonly exitSignal?: string | null;
}

interface InteractivePty {
  write(data: string): void;
  resize(cols: number, rows: number): void;
  kill(signal?: string): void;
  onData(cb: (data: string) => void): { dispose(): void };
  onExit(
    cb: (e: { exitCode: number; signal?: number }) => void,
  ): { dispose(): void };
}

export interface AgentTerminalHandle {
  readonly uuid: string;
  readonly sessionId: string;
  readonly title: string;
  readonly command: string;
  readonly cwd: string;
  readonly pty: InteractivePty;
  /** Bounded UTF-8 scrollback (avoids unbounded string growth + mid-surrogate cuts). */
  readonly transcript: BoundedTextBuffer;
  exited: boolean;
  exitCode?: number | null;
  exitSignal?: number | null;
  dataDisposable: { dispose(): void };
  exitDisposable: { dispose(): void };
}

export interface AgentTerminalReadResult {
  readonly text: string;
  readonly totalLines: number;
  readonly lineBegin: number;
  readonly lineEnd: number;
}

export type AgentTerminalWaitResult =
  | {
      kind: "found";
      needle: string;
      line: number;
      column: number;
      elapsedMs: number;
    }
  | {
      kind: "timeout";
      needle: string;
      timeoutMs: number;
      totalLines: number;
    }
  | {
      kind: "exited";
      needle: string;
      exitCode?: number | null;
      exitSignal?: string | null;
    };

const SIGNAL_NAMES: Record<number, string> = {
  1: "SIGHUP",
  2: "SIGINT",
  3: "SIGQUIT",
  9: "SIGKILL",
  15: "SIGTERM",
  20: "SIGTSTP",
};

function signalNameOf(signal: number | null | undefined): string | null {
  if (signal === null || signal === undefined) return null;
  return SIGNAL_NAMES[signal] ?? `signal ${signal}`;
}

function transcriptText(handle: AgentTerminalHandle): string {
  return handle.transcript.snapshot().text;
}

function locateNeedle(
  transcript: string,
  needle: string,
): { line: number; column: number } | undefined {
  if (needle === "") return undefined;
  const idx = transcript.indexOf(needle);
  if (idx === -1) return undefined;
  let line = 0;
  let lineStart = 0;
  for (let i = 0; i < idx; i += 1) {
    if (transcript.charCodeAt(i) === 0x0a) {
      line += 1;
      lineStart = i + 1;
    }
  }
  return { line, column: idx - lineStart };
}

export function snapshotOf(handle: AgentTerminalHandle): AgentTerminalSnapshot {
  const out: AgentTerminalSnapshot = {
    uuid: handle.uuid,
    title: handle.title,
    command: handle.command,
    exited: handle.exited,
  };
  if (handle.exited) {
    return {
      ...out,
      exitCode: handle.exitCode ?? null,
      exitSignal: signalNameOf(handle.exitSignal),
    };
  }
  return out;
}

function defaultShellArgv(): { file: string; args: string[] } {
  if (process.platform === "win32") {
    const comspec = process.env.ComSpec?.trim();
    return {
      file: comspec && comspec.length > 0 ? comspec : "cmd.exe",
      args: [],
    };
  }
  const shell = process.env.SHELL?.trim();
  return {
    file: shell && shell.length > 0 ? shell : "/bin/bash",
    args: ["-l"],
  };
}

async function loadNodePty(): Promise<{
  spawn: (
    file: string,
    args: string[],
    opts: Record<string, unknown>,
  ) => InteractivePty;
}> {
  try {
    return await import("node-pty");
  } catch {
    throw new Error("pty-deps-missing");
  }
}

export class AgentPtyRegistry {
  private readonly sessions = new Map<string, AgentTerminalHandle>();
  private readonly changeListeners = new Set<() => void>();

  constructor(
    private readonly defaultShell?: string,
    private readonly defaultShellArgs: string[] = [],
  ) {}

  async create(
    sessionId: string,
    title: string,
    command: string,
    cwd: string,
    cols = 80,
    rows = 24,
    shell?: string,
    shellArgs?: string[],
  ): Promise<string> {
    const uuid = randomUUID();
    const dims = clampDims(cols, rows);
    const nodePty = await loadNodePty();
    const fallback = defaultShellArgv();
    const file = shell?.trim() || this.defaultShell || fallback.file;
    const args =
      shellArgs ??
      (this.defaultShellArgs.length > 0
        ? this.defaultShellArgs
        : shell
          ? []
          : fallback.args);
    const env: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (typeof v === "string") env[k] = v;
    }
    if (!env.TERM) env.TERM = "xterm-256color";

    let pty: InteractivePty;
    try {
      pty = nodePty.spawn(file, args, {
        name: "xterm-256color",
        cols: dims.cols,
        rows: dims.rows,
        cwd,
        env,
        ...(process.platform === "win32"
          ? { useConpty: true, conptyInheritCursor: false }
          : {}),
      });
    } catch (first) {
      const home = homedir();
      if (!home || home === cwd) throw first;
      pty = nodePty.spawn(file, args, {
        name: "xterm-256color",
        cols: dims.cols,
        rows: dims.rows,
        cwd: home,
        env,
        ...(process.platform === "win32"
          ? { useConpty: true, conptyInheritCursor: false }
          : {}),
      });
    }

    const handle: AgentTerminalHandle = {
      uuid,
      sessionId,
      title,
      command,
      cwd,
      pty,
      transcript: new BoundedTextBuffer(TRANSCRIPT_MAX_BYTES),
      exited: false,
      dataDisposable: { dispose() {} },
      exitDisposable: { dispose() {} },
    };
    handle.dataDisposable = pty.onData((data) => {
      handle.transcript.append(data);
    });
    handle.exitDisposable = pty.onExit(({ exitCode, signal }) => {
      handle.exited = true;
      handle.exitCode = exitCode;
      handle.exitSignal = signal ?? null;
      this.notify();
    });
    if (command !== "") {
      try {
        pty.write(`${command}\r`);
      } catch {
        /* spawn race — onExit will mark exited */
      }
    }
    this.sessions.set(uuid, handle);
    this.notify();
    return uuid;
  }

  list(sessionId: string): AgentTerminalSnapshot[] {
    const out: AgentTerminalSnapshot[] = [];
    for (const handle of this.sessions.values()) {
      if (handle.sessionId === sessionId) out.push(snapshotOf(handle));
    }
    return out;
  }

  private expect(uuid: string): AgentTerminalHandle {
    const handle = this.sessions.get(uuid);
    if (handle === undefined) {
      throw new Error(`agent terminal "${uuid}" not found`);
    }
    return handle;
  }

  assertOwned(uuid: string, sessionId: string): AgentTerminalHandle {
    const handle = this.expect(uuid);
    if (handle.sessionId !== sessionId) {
      throw new Error(`agent terminal "${uuid}" not found`);
    }
    return handle;
  }

  send(uuid: string, text: string): void {
    const handle = this.expect(uuid);
    if (handle.exited) {
      throw new Error(`agent terminal "${uuid}" has exited`);
    }
    handle.pty.write(text);
  }

  read(uuid: string, offset?: number, count?: number): AgentTerminalReadResult {
    const handle = this.expect(uuid);
    const lines = transcriptText(handle).split("\n");
    const totalLines = lines.length;
    const pageSize = Math.max(
      1,
      Math.min(count ?? DEFAULT_READ_COUNT, DEFAULT_READ_COUNT),
    );
    let start: number;
    if (offset === undefined || offset === 0) start = 0;
    else if (offset < 0) start = Math.max(0, totalLines + offset);
    else start = Math.min(offset, totalLines);
    const end = Math.min(start + pageSize, totalLines);
    return {
      text: lines.slice(start, end).join("\n"),
      totalLines,
      lineBegin: start,
      lineEnd: end,
    };
  }

  resize(
    uuid: string,
    cols: number,
    rows: number,
  ): { cols: number; rows: number } {
    const handle = this.expect(uuid);
    const dims = clampDims(cols, rows);
    if (!handle.exited) handle.pty.resize(dims.cols, dims.rows);
    return dims;
  }

  async waitFor(
    uuid: string,
    needle: string,
    timeoutMs = 10_000,
    signal?: AbortSignal,
  ): Promise<AgentTerminalWaitResult> {
    if (needle === "") throw new Error("needle must be a non-empty string");
    const handle = this.expect(uuid);
    const timeout = Math.max(100, Math.floor(timeoutMs));
    const start = Date.now();
    const deadline = start + timeout;
    if (handle.exited) {
      return {
        kind: "exited",
        needle,
        exitCode: handle.exitCode ?? null,
        exitSignal: signalNameOf(handle.exitSignal),
      };
    }
    const firstHit = locateNeedle(transcriptText(handle), needle);
    if (firstHit !== undefined) {
      return {
        kind: "found",
        needle,
        line: firstHit.line,
        column: firstHit.column,
        elapsedMs: Date.now() - start,
      };
    }
    while (true) {
      if (signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      if (handle.exited) {
        return {
          kind: "exited",
          needle,
          exitCode: handle.exitCode ?? null,
          exitSignal: signalNameOf(handle.exitSignal),
        };
      }
      const hit = locateNeedle(transcriptText(handle), needle);
      if (hit !== undefined) {
        return {
          kind: "found",
          needle,
          line: hit.line,
          column: hit.column,
          elapsedMs: Date.now() - start,
        };
      }
      if (Date.now() >= deadline) {
        return {
          kind: "timeout",
          needle,
          timeoutMs: timeout,
          totalLines: transcriptText(handle).split("\n").length,
        };
      }
      await new Promise((r) => {
        const t = setTimeout(r, 50);
        if (typeof t === "object" && "unref" in t) {
          (t as { unref: () => void }).unref();
        }
      });
    }
  }

  signal(uuid: string, sig: AgentTerminalSignal): void {
    const handle = this.expect(uuid);
    if (handle.exited) return;
    if (sig === "SIGINT" || sig === "SIGTSTP") {
      try {
        handle.pty.write(sig === "SIGINT" ? "\x03" : "\x1a");
      } catch {
        /* tearing down */
      }
      return;
    }
    try {
      handle.pty.kill(sig);
    } catch {
      try {
        handle.pty.kill();
      } catch {
        /* gone */
      }
    }
  }

  close(uuid: string): boolean {
    const handle = this.sessions.get(uuid);
    if (handle === undefined) return false;
    this.sessions.delete(uuid);
    try {
      handle.dataDisposable.dispose();
    } catch {
      /* ignore */
    }
    try {
      handle.exitDisposable.dispose();
    } catch {
      /* ignore */
    }
    try {
      handle.pty.kill();
    } catch {
      /* ignore */
    }
    this.notify();
    return true;
  }

  get(uuid: string): AgentTerminalHandle | undefined {
    return this.sessions.get(uuid);
  }

  subscribe(listener: () => void): () => void {
    this.changeListeners.add(listener);
    return () => {
      this.changeListeners.delete(listener);
    };
  }

  disposeAll(): void {
    for (const uuid of [...this.sessions.keys()]) this.close(uuid);
  }

  private notify(): void {
    for (const listener of [...this.changeListeners]) {
      try {
        listener();
      } catch {
        /* ignore subscriber errors */
      }
    }
  }
}
