/**
 * One-shot and continuable external agent runtimes for the subagent tool.
 * In-process delegation stays the default; these kinds spawn a child process.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import type { SessionStore } from "@xrkseek/core-session";
import { tryWriteJsonSidecar } from "./json-sidecar.js";

export type ExternalAgentKind = "acp" | "app-server" | "claude-code";

export type ExternalSpawn = typeof spawn;

/** Face `external-agent` product (Settings → Plugins). */
export interface ExternalAgentProductConfig {
  readonly acpAgent?: string;
  readonly codexAppServer?: string;
  readonly claudeCode?: string;
}

export interface RunExternalAgentOptions {
  readonly kind: ExternalAgentKind;
  readonly cwd: string;
  readonly prompt: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly product?: ExternalAgentProductConfig;
  readonly signal?: AbortSignal;
  readonly spawnImpl?: ExternalSpawn;
}

export class ExternalAgentError extends Error {
  readonly code: string;

  constructor(message: string, code = "EXTERNAL_AGENT") {
    super(message);
    this.name = "ExternalAgentError";
    this.code = code;
  }
}

function splitCommand(raw: string): { command: string; args: string[] } {
  const parts = raw.trim().split(/\s+/).filter(Boolean);
  const command = parts[0];
  if (!command) {
    throw new ExternalAgentError(
      "empty external agent command",
      "EXTERNAL_AGENT_CONFIG",
    );
  }
  return { command, args: parts.slice(1) };
}

export function resolveExternalAgentLaunch(
  kind: ExternalAgentKind,
  env: NodeJS.ProcessEnv,
  prompt: string,
  product?: ExternalAgentProductConfig,
): { command: string; args: string[]; protocol: "acp" | "app-server" | "print" } {
  if (kind === "acp") {
    const envRaw = String(env.XRK_ACP_AGENT ?? "").trim();
    const raw =
      envRaw ||
      (typeof product?.acpAgent === "string" ? product.acpAgent.trim() : "");
    if (!raw) {
      throw new ExternalAgentError(
        "ACP runtime requires Settings external-agent.acpAgent or XRK_ACP_AGENT (e.g. xrkh acp)",
        "EXTERNAL_AGENT_CONFIG",
      );
    }
    const spec = splitCommand(raw);
    return { ...spec, protocol: "acp" };
  }
  if (kind === "app-server") {
    const envRaw = String(env.XRK_CODEX_APP_SERVER ?? "").trim();
    const productRaw =
      typeof product?.codexAppServer === "string"
        ? product.codexAppServer.trim()
        : "";
    const raw = envRaw || productRaw || "codex app-server";
    const spec = splitCommand(raw);
    return { ...spec, protocol: "app-server" };
  }
  const envRaw = String(env.XRK_CLAUDE_CODE ?? "").trim();
  const productRaw =
    typeof product?.claudeCode === "string" ? product.claudeCode.trim() : "";
  const raw = envRaw || productRaw || "claude";
  const spec = splitCommand(raw);
  return {
    command: spec.command,
    args: [...spec.args, "-p", prompt],
    protocol: "print",
  };
}

/** Normalize Face `external-agent` section into launch product fields. */
export function parseExternalAgentProduct(
  raw: unknown,
): ExternalAgentProductConfig | undefined {
  if (raw === null || raw === undefined) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const acpAgent = typeof o.acpAgent === "string" ? o.acpAgent.trim() : "";
  const codexAppServer =
    typeof o.codexAppServer === "string" ? o.codexAppServer.trim() : "";
  const claudeCode = typeof o.claudeCode === "string" ? o.claudeCode.trim() : "";
  if (!acpAgent && !codexAppServer && !claudeCode) return undefined;
  return {
    ...(acpAgent ? { acpAgent } : {}),
    ...(codexAppServer ? { codexAppServer } : {}),
    ...(claudeCode ? { claudeCode } : {}),
  };
}

interface RpcLine {
  id?: number | string | null;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message?: string };
}

function writeLine(
  child: ChildProcessWithoutNullStreams,
  frame: Record<string, unknown>,
): void {
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...frame })}\n`);
}

interface JsonRpcIo {
  readonly request: (method: string, params: unknown) => Promise<unknown>;
  readonly notify: (method: string, params?: unknown) => void;
  readonly onNotification: (fn: (msg: RpcLine) => void) => void;
  readonly close: () => void;
}

/** Keep stdin open for multi-turn ACP / app-server sessions. */
function openJsonRpcIo(child: ChildProcessWithoutNullStreams): JsonRpcIo {
  let nextId = 1;
  const pending = new Map<
    number | string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  const notes: Array<(msg: RpcLine) => void> = [];
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
  let closed = false;
  rl.on("line", (line) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    let msg: RpcLine;
    try {
      msg = JSON.parse(trimmed) as RpcLine;
    } catch {
      return;
    }
    if (msg.id !== undefined && msg.id !== null && msg.method) {
      writeLine(child, {
        id: msg.id,
        error: { code: -32601, message: `unsupported server request: ${msg.method}` },
      });
      return;
    }
    if (msg.id !== undefined && msg.id !== null && !msg.method) {
      const waiter = pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      if (msg.error) {
        waiter.reject(
          new ExternalAgentError(msg.error.message ?? "rpc error"),
        );
      } else {
        waiter.resolve(msg.result);
      }
      return;
    }
    for (const fn of notes) fn(msg);
  });

  return {
    request(method, params) {
      if (closed) {
        return Promise.reject(new ExternalAgentError("external rpc closed"));
      }
      const id = nextId++;
      const promise = new Promise<unknown>((resolve, reject) => {
        pending.set(id, { resolve, reject });
      });
      writeLine(child, { id, method, params });
      return promise;
    },
    notify(method, params) {
      if (closed) return;
      writeLine(child, { method, ...(params !== undefined ? { params } : {}) });
    },
    onNotification(fn) {
      notes.push(fn);
    },
    close() {
      if (closed) return;
      closed = true;
      rl.close();
      for (const waiter of pending.values()) {
        waiter.reject(new ExternalAgentError("external rpc closed"));
      }
      pending.clear();
      try {
        child.stdin.end();
      } catch {
        /* ignore */
      }
    },
  };
}

async function speakJsonRpc(
  child: ChildProcessWithoutNullStreams,
  run: (io: {
    request: (method: string, params: unknown) => Promise<unknown>;
    notify: (method: string, params?: unknown) => void;
    onNotification: (fn: (msg: RpcLine) => void) => void;
  }) => Promise<string>,
): Promise<string> {
  const io = openJsonRpcIo(child);
  try {
    return await run(io);
  } finally {
    io.close();
  }
}

async function runAcp(
  child: ChildProcessWithoutNullStreams,
  cwd: string,
  prompt: string,
): Promise<string> {
  const chunks: string[] = [];
  return speakJsonRpc(child, async ({ request, onNotification }) => {
    onNotification((msg) => {
      if (msg.method !== "session/update") return;
      const params = msg.params as {
        update?: { content?: { text?: string } };
      };
      const text = params?.update?.content?.text;
      if (text) chunks.push(text);
    });
    await request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "xrk-harness", version: "0.0.0" },
    });
    const created = (await request("session/new", { cwd })) as {
      sessionId?: string;
    };
    if (!created?.sessionId) {
      throw new ExternalAgentError("ACP session/new missing sessionId");
    }
    await request("session/prompt", {
      sessionId: created.sessionId,
      prompt: [{ type: "text", text: prompt }],
    });
    const text = chunks.join("").trim();
    if (!text) {
      throw new ExternalAgentError("ACP prompt returned no text");
    }
    return text;
  });
}

async function runAppServer(
  child: ChildProcessWithoutNullStreams,
  cwd: string,
  prompt: string,
): Promise<string> {
  const messages: string[] = [];
  return speakJsonRpc(child, async ({ request, notify, onNotification }) => {
    let resolveDone: (v: { status?: string }) => void = () => {};
    const done = new Promise<{ status?: string }>((resolve) => {
      resolveDone = resolve;
    });
    onNotification((msg) => {
      if (msg.method === "item/completed") {
        const params = msg.params as {
          item?: { type?: string; text?: string; phase?: string | null };
        };
        const item = params?.item;
        if (item?.type === "agentMessage" && typeof item.text === "string") {
          if (item.phase === "final_answer" || item.phase == null) {
            messages.push(item.text);
          }
        }
      }
      if (msg.method === "turn/completed") {
        const params = msg.params as {
          turn?: { status?: string };
        };
        const status = params?.turn?.status;
        resolveDone(status !== undefined ? { status } : {});
      }
    });
    await request("initialize", {
      clientInfo: { name: "xrk-harness", version: "0.0.0" },
      capabilities: { experimentalApi: false },
    });
    notify("initialized", {});
    const thread = (await request("thread/start", {
      cwd,
      ephemeral: true,
      approvalPolicy: "never",
      sandbox: "workspace-write",
    })) as { thread?: { id?: string } };
    const threadId = thread?.thread?.id;
    if (!threadId) {
      throw new ExternalAgentError("app-server thread/start missing thread.id");
    }
    await request("turn/start", {
      threadId,
      input: [{ type: "text", text: prompt, text_elements: [] }],
    });
    const terminal = await done;
    if (terminal.status && terminal.status !== "completed") {
      throw new ExternalAgentError(
        `app-server turn ended with status ${terminal.status}`,
      );
    }
    const text = messages.join("\n").trim();
    if (!text) {
      throw new ExternalAgentError("app-server turn completed without text");
    }
    return text;
  });
}

function collectPrint(child: ChildProcessWithoutNullStreams): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(
          new ExternalAgentError(
            `claude-code exit ${code ?? "null"}: ${stderr.trim() || stdout.trim()}`,
          ),
        );
        return;
      }
      const text = stdout.trim();
      if (!text) {
        reject(new ExternalAgentError("claude-code returned empty stdout"));
        return;
      }
      resolve(text);
    });
  });
}

/**
 * Hand one prompt to an external agent subprocess.
 * Does not create an in-process child session.
 */
export async function runExternalAgentTurn(
  options: RunExternalAgentOptions,
): Promise<{ readonly text: string; readonly kind: ExternalAgentKind }> {
  const env = options.env ?? process.env;
  const launch = resolveExternalAgentLaunch(
    options.kind,
    env,
    options.prompt,
    options.product,
  );
  const spawnImpl = options.spawnImpl ?? spawn;
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnImpl(launch.command, launch.args, {
      cwd: options.cwd,
      env: { ...env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (err) {
    throw new ExternalAgentError(
      err instanceof Error ? err.message : String(err),
      "EXTERNAL_AGENT_SPAWN",
    );
  }

  const onAbort = (): void => {
    child.kill();
  };
  options.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    child.on("error", () => {
      /* surfaced via close / collectPrint */
    });
    if (launch.protocol === "print") {
      child.stdin.end();
      const text = await collectPrint(child);
      return { text, kind: options.kind };
    }
    const text =
      launch.protocol === "acp"
        ? await runAcp(child, options.cwd, options.prompt)
        : await runAppServer(child, options.cwd, options.prompt);
    return { text, kind: options.kind };
  } finally {
    options.signal?.removeEventListener("abort", onAbort);
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  }
}

export function parseExternalAgentKind(
  raw: unknown,
): ExternalAgentKind | "in-process" | undefined {
  if (raw === undefined || raw === null || raw === "") return "in-process";
  const s = String(raw).trim().toLowerCase();
  if (s === "in-process" || s === "in_process" || s === "local") {
    return "in-process";
  }
  if (s === "acp" || s === "app-server" || s === "claude-code") {
    return s;
  }
  return undefined;
}

/** ACP / app-server keep a live process; claude-code print is one-shot only. */
export type ContinuableExternalKind = "acp" | "app-server";

export function supportsExternalContinuable(
  kind: ExternalAgentKind,
): kind is ContinuableExternalKind {
  return kind === "acp" || kind === "app-server";
}

export interface ExternalAgentLiveSession {
  readonly kind: ContinuableExternalKind;
  readonly remoteId: string;
  isBusy(): boolean;
  lastText(): string | undefined;
  prompt(text: string, signal?: AbortSignal): Promise<string>;
  interrupt(): Promise<void>;
  dispose(): void;
}

export interface OpenExternalLiveOptions {
  readonly kind: ContinuableExternalKind;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly product?: ExternalAgentProductConfig;
  readonly spawnImpl?: ExternalSpawn;
  /**
   * Cold-resume remote id (ACP sessionId / app-server thread id). When set,
   * prefer resume/load over a fresh session/thread.
   */
  readonly resumeRemoteId?: string;
}

export async function openExternalAgentLiveSession(
  options: OpenExternalLiveOptions,
): Promise<ExternalAgentLiveSession> {
  const env = options.env ?? process.env;
  const launch = resolveExternalAgentLaunch(
    options.kind,
    env,
    /* prompt unused for rpc protocols */ "",
    options.product,
  );
  if (launch.protocol === "print") {
    throw new ExternalAgentError(
      "claude-code print protocol cannot stay continuable",
      "EXTERNAL_AGENT_CONFIG",
    );
  }
  const spawnImpl = options.spawnImpl ?? spawn;
  let child: ChildProcessWithoutNullStreams;
  try {
    child = spawnImpl(launch.command, launch.args, {
      cwd: options.cwd,
      env: { ...env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (err) {
    throw new ExternalAgentError(
      err instanceof Error ? err.message : String(err),
      "EXTERNAL_AGENT_SPAWN",
    );
  }
  child.on("error", () => {
    /* surfaced on close / request fail */
  });

  const io = openJsonRpcIo(child);
  let disposed = false;
  let busy = false;
  let last = "";
  let currentTurnId: string | undefined;
  let interruptResolve: (() => void) | undefined;

  const killChild = (): void => {
    if (child.exitCode === null && !child.killed) {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
    }
  };

  const dispose = (): void => {
    if (disposed) return;
    disposed = true;
    interruptResolve?.();
    interruptResolve = undefined;
    io.close();
    killChild();
  };

  child.on("close", () => {
    disposed = true;
    interruptResolve?.();
    interruptResolve = undefined;
  });

  if (options.kind === "acp") {
    const chunks: string[] = [];
    io.onNotification((msg) => {
      if (msg.method !== "session/update") return;
      const params = msg.params as {
        update?: { content?: { text?: string } };
      };
      const text = params?.update?.content?.text;
      if (text) chunks.push(text);
    });
    await io.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "xrk-harness", version: "0.0.0" },
    });
    let remoteId = options.resumeRemoteId?.trim() || "";
    if (remoteId) {
      // Prefer session/load (ACP cold resume); fall back to session/new if absent.
      try {
        const loaded = (await io.request("session/load", {
          sessionId: remoteId,
          cwd: options.cwd,
        })) as { sessionId?: string };
        remoteId = loaded?.sessionId?.trim() || remoteId;
      } catch {
        const created = (await io.request("session/new", {
          cwd: options.cwd,
        })) as { sessionId?: string };
        if (!created?.sessionId) {
          dispose();
          throw new ExternalAgentError(
            "ACP cold resume failed (session/load) and session/new missing sessionId",
            "EXTERNAL_AGENT_COLD_RESUME",
          );
        }
        remoteId = created.sessionId;
      }
    } else {
      const created = (await io.request("session/new", {
        cwd: options.cwd,
      })) as { sessionId?: string };
      if (!created?.sessionId) {
        dispose();
        throw new ExternalAgentError("ACP session/new missing sessionId");
      }
      remoteId = created.sessionId;
    }
    return {
      kind: "acp",
      remoteId,
      isBusy: () => busy,
      lastText: () => (last ? last : undefined),
      async prompt(text, signal) {
        if (disposed) {
          throw new ExternalAgentError("ACP session disposed");
        }
        if (busy) {
          throw new ExternalAgentError("ACP session busy");
        }
        busy = true;
        chunks.length = 0;
        const onAbort = (): void => {
          killChild();
        };
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
          await io.request("session/prompt", {
            sessionId: remoteId,
            prompt: [{ type: "text", text }],
          });
          const out = chunks.join("").trim();
          if (!out) {
            throw new ExternalAgentError("ACP prompt returned no text");
          }
          last = out;
          return out;
        } finally {
          signal?.removeEventListener("abort", onAbort);
          busy = false;
        }
      },
      async interrupt() {
        // ACP has no portable cancel; tear down the process.
        dispose();
      },
      dispose,
    };
  }

  // app-server
  const messages: string[] = [];
  let resolveDone: ((v: { status?: string }) => void) | undefined;
  io.onNotification((msg) => {
    if (msg.method === "item/completed") {
      const params = msg.params as {
        item?: { type?: string; text?: string; phase?: string | null };
      };
      const item = params?.item;
      if (item?.type === "agentMessage" && typeof item.text === "string") {
        if (item.phase === "final_answer" || item.phase == null) {
          messages.push(item.text);
        }
      }
    }
    if (msg.method === "turn/completed") {
      const params = msg.params as { turn?: { status?: string; id?: string } };
      const status = params?.turn?.status;
      resolveDone?.(status !== undefined ? { status } : {});
      resolveDone = undefined;
      currentTurnId = undefined;
    }
  });
  await io.request("initialize", {
    clientInfo: { name: "xrk-harness", version: "0.0.0" },
    capabilities: { experimentalApi: false },
  });
  io.notify("initialized", {});
  let threadId = options.resumeRemoteId?.trim() || "";
  if (threadId) {
    try {
      const resumed = (await io.request("thread/resume", {
        threadId,
        cwd: options.cwd,
      })) as { thread?: { id?: string } };
      threadId = resumed?.thread?.id?.trim() || threadId;
    } catch (err) {
      dispose();
      throw new ExternalAgentError(
        `app-server thread/resume failed for ${threadId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
        "EXTERNAL_AGENT_COLD_RESUME",
      );
    }
  } else {
    const thread = (await io.request("thread/start", {
      cwd: options.cwd,
      ephemeral: false,
      approvalPolicy: "never",
      sandbox: "workspace-write",
    })) as { thread?: { id?: string } };
    threadId = thread?.thread?.id ?? "";
    if (!threadId) {
      dispose();
      throw new ExternalAgentError("app-server thread/start missing thread.id");
    }
  }
  return {
    kind: "app-server",
    remoteId: threadId,
    isBusy: () => busy,
    lastText: () => (last ? last : undefined),
    async prompt(text, signal) {
      if (disposed) {
        throw new ExternalAgentError("app-server session disposed");
      }
      if (busy) {
        throw new ExternalAgentError("app-server session busy");
      }
      busy = true;
      messages.length = 0;
      const done = new Promise<{ status?: string }>((resolve) => {
        resolveDone = resolve;
      });
      const onAbort = (): void => {
        void io
          .request("turn/interrupt", {
            threadId,
            ...(currentTurnId ? { turnId: currentTurnId } : {}),
          })
          .catch(() => killChild());
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      try {
        const started = (await io.request("turn/start", {
          threadId,
          input: [{ type: "text", text, text_elements: [] }],
        })) as { turn?: { id?: string } };
        currentTurnId = started?.turn?.id;
        const terminal = await done;
        if (terminal.status && terminal.status !== "completed") {
          throw new ExternalAgentError(
            `app-server turn ended with status ${terminal.status}`,
          );
        }
        const out = messages.join("\n").trim();
        if (!out) {
          throw new ExternalAgentError("app-server turn completed without text");
        }
        last = out;
        return out;
      } finally {
        signal?.removeEventListener("abort", onAbort);
        busy = false;
        currentTurnId = undefined;
        resolveDone = undefined;
      }
    },
    async interrupt() {
      if (!busy) return;
      try {
        await io.request("turn/interrupt", {
          threadId,
          ...(currentTurnId ? { turnId: currentTurnId } : {}),
        });
      } catch {
        killChild();
      }
    },
    dispose,
  };
}

/** Durable handle for cold resume after Host restart / process dispose. */
export interface ExternalAgentHandleRecord {
  readonly faceSessionId: string;
  readonly kind: ContinuableExternalKind;
  readonly remoteId: string;
  readonly cwd: string;
  readonly updatedAt: number;
}

type HandlePersistShape = {
  readonly handles: ExternalAgentHandleRecord[];
};

export function externalAgentHandlesPath(
  subagentPersistPath?: string,
): string | undefined {
  if (!subagentPersistPath?.trim()) return undefined;
  return subagentPersistPath.replace(/[^/\\]+$/, "external-agent-handles.json");
}

/** Face child session id → live ACP / app-server handle (+ optional cold sidecar). */
export class ExternalAgentSessionRegistry {
  private readonly map = new Map<string, ExternalAgentLiveSession>();
  private readonly handles = new Map<string, ExternalAgentHandleRecord>();
  private readonly persistPath: string | undefined;

  constructor(persistPath?: string) {
    this.persistPath = persistPath;
    if (persistPath) this.loadHandles();
  }

  has(faceSessionId: string): boolean {
    return this.map.has(faceSessionId);
  }

  get(faceSessionId: string): ExternalAgentLiveSession | undefined {
    return this.map.get(faceSessionId);
  }

  isBusy(faceSessionId: string): boolean {
    return this.map.get(faceSessionId)?.isBusy() === true;
  }

  kind(faceSessionId: string): ContinuableExternalKind | undefined {
    return (
      this.map.get(faceSessionId)?.kind ??
      this.handles.get(faceSessionId.trim())?.kind
    );
  }

  /** Sidecar handle when process is gone but remote id is still known. */
  getHandle(faceSessionId: string): ExternalAgentHandleRecord | undefined {
    return this.handles.get(faceSessionId.trim());
  }

  /**
   * Status badge: `live` while process attached; `cold` when only the sidecar
   * remains (Host restart / dispose) so UI / follow-up can attempt reopen.
   */
  resumeState(
    faceSessionId: string,
  ): "live" | "cold" | undefined {
    const id = faceSessionId.trim();
    if (this.map.has(id)) return "live";
    if (this.handles.has(id)) return "cold";
    return undefined;
  }

  attach(
    faceSessionId: string,
    session: ExternalAgentLiveSession,
    meta?: { readonly cwd?: string },
  ): void {
    const id = faceSessionId.trim();
    const prev = this.map.get(id);
    if (prev && prev !== session) prev.dispose();
    this.map.set(id, session);
    const cwd =
      meta?.cwd?.trim() ||
      this.handles.get(id)?.cwd ||
      process.cwd();
    this.handles.set(id, {
      faceSessionId: id,
      kind: session.kind,
      remoteId: session.remoteId,
      cwd,
      updatedAt: Date.now(),
    });
    this.saveHandles();
  }

  detach(faceSessionId: string): void {
    const id = faceSessionId.trim();
    const hit = this.map.get(id);
    if (!hit) return;
    this.map.delete(id);
    hit.dispose();
    // Keep sidecar for cold resume unless explicitly cleared.
    this.saveHandles();
  }

  /** Drop live + cold handle (interrupt dispose path that should not resume). */
  clearHandle(faceSessionId: string): void {
    const id = faceSessionId.trim();
    const hit = this.map.get(id);
    if (hit) {
      this.map.delete(id);
      hit.dispose();
    }
    if (this.handles.delete(id)) this.saveHandles();
  }

  disposeAll(): void {
    for (const id of [...this.map.keys()]) {
      const hit = this.map.get(id);
      this.map.delete(id);
      hit?.dispose();
    }
  }

  private loadHandles(): void {
    const file = this.persistPath;
    if (!file) return;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as HandlePersistShape;
      if (!Array.isArray(raw.handles)) return;
      for (const row of raw.handles) {
        if (!row || typeof row !== "object") continue;
        const faceSessionId = String(row.faceSessionId ?? "").trim();
        const remoteId = String(row.remoteId ?? "").trim();
        const cwd = String(row.cwd ?? "").trim() || process.cwd();
        const kind =
          row.kind === "acp" || row.kind === "app-server"
            ? row.kind
            : undefined;
        if (!faceSessionId || !remoteId || !kind) continue;
        this.handles.set(faceSessionId, {
          faceSessionId,
          kind,
          remoteId,
          cwd,
          updatedAt:
            typeof row.updatedAt === "number" && Number.isFinite(row.updatedAt)
              ? row.updatedAt
              : Date.now(),
        });
      }
    } catch {
      /* missing / corrupt → empty */
    }
  }

  private saveHandles(): void {
    const file = this.persistPath;
    if (!file) return;
    tryWriteJsonSidecar(file, { handles: [...this.handles.values()] });
  }
}

/** Narrow host surface for external continuable (avoids FaceRuntime import cycle). */
export interface ExternalAgentHost {
  readonly store: SessionStore;
  readonly drain: { isActive(sessionId: string): boolean };
  readonly externalAgents: ExternalAgentSessionRegistry;
  onSessionDrainStatus(sessionId: string, running: boolean): void;
  suppressOwnedSubagentCompletion(childSessionId: string): void;
}

/** True when Face drain or an external live session is mid-turn. */
export function isChildSessionActive(
  runtime: ExternalAgentHost,
  sessionId: string,
): boolean {
  return (
    runtime.drain.isActive(sessionId) ||
    runtime.externalAgents.isBusy(sessionId)
  );
}

function recordExternalTurn(
  store: SessionStore,
  sessionId: string,
  userText: string,
  assistantText: string,
): void {
  const ts = Date.now();
  const turnId = `ext-${ts}`;
  store.append(sessionId, { type: "turn/start", ts, turnId });
  store.append(sessionId, {
    type: "user/message",
    ts: ts + 1,
    turnId,
    content: userText,
  });
  store.append(sessionId, {
    type: "assistant/message",
    ts: ts + 2,
    turnId,
    stepId: "1",
    content: assistantText,
  });
  store.append(sessionId, {
    type: "turn/end",
    ts: ts + 3,
    turnId,
    reason: { kind: "completed" },
  });
}

export interface StartExternalContinuableOptions {
  readonly runtime: ExternalAgentHost;
  readonly faceSessionId: string;
  readonly kind: ContinuableExternalKind;
  readonly cwd: string;
  readonly prompt: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly product?: ExternalAgentProductConfig;
  readonly spawnImpl?: ExternalSpawn;
  readonly signal?: AbortSignal;
  /** When true, return after spawn + first turn kickoff (do not await answer). */
  readonly background: boolean;
}

/**
 * Open ACP / app-server live session, attach to Face child id, run first prompt.
 * Background: kicks the turn and returns; completion steers parent via drain hooks.
 */
export async function startExternalContinuable(
  options: StartExternalContinuableOptions,
): Promise<{ readonly text?: string; readonly kind: ContinuableExternalKind }> {
  if (!supportsExternalContinuable(options.kind)) {
    throw new ExternalAgentError(
      `runtime ${options.kind} does not support continuable sessions`,
      "EXTERNAL_AGENT_CONFIG",
    );
  }
  const live = await openExternalAgentLiveSession({
    kind: options.kind,
    cwd: options.cwd,
    ...(options.env ? { env: options.env } : {}),
    ...(options.product ? { product: options.product } : {}),
    ...(options.spawnImpl ? { spawnImpl: options.spawnImpl } : {}),
  });
  options.runtime.externalAgents.attach(options.faceSessionId, live, {
    cwd: options.cwd,
  });

  const runTurn = async (): Promise<string> => {
    options.runtime.onSessionDrainStatus(options.faceSessionId, true);
    try {
      const text = await live.prompt(options.prompt, options.signal);
      recordExternalTurn(
        options.runtime.store,
        options.faceSessionId,
        options.prompt,
        text,
      );
      return text;
    } finally {
      options.runtime.onSessionDrainStatus(options.faceSessionId, false);
    }
  };

  if (options.background) {
    void runTurn().catch(() => {
      /* parent sees failure via empty history / wait_agent; process may still live */
    });
    return { kind: options.kind };
  }
  const text = await runTurn();
  return { text, kind: options.kind };
}

/**
 * Follow-up prompt on an attached external live session (send_message / followup_task).
 * When the live process is gone but a cold sidecar handle remains, reopen via
 * ACP session/load or app-server thread/resume before prompting.
 */
export async function promptExternalContinuable(
  runtime: ExternalAgentHost,
  faceSessionId: string,
  message: string,
  opts?: {
    readonly signal?: AbortSignal;
    readonly steer?: boolean;
    readonly env?: NodeJS.ProcessEnv;
    readonly product?: ExternalAgentProductConfig;
    readonly spawnImpl?: ExternalSpawn;
  },
): Promise<string> {
  let live = runtime.externalAgents.get(faceSessionId);
  if (!live) {
    const handle = runtime.externalAgents.getHandle(faceSessionId);
    if (!handle) {
      throw new ExternalAgentError(
        `no external live session for ${faceSessionId}`,
        "EXTERNAL_AGENT_MISSING",
      );
    }
    live = await openExternalAgentLiveSession({
      kind: handle.kind,
      cwd: handle.cwd,
      resumeRemoteId: handle.remoteId,
      ...(opts?.env ? { env: opts.env } : {}),
      ...(opts?.product ? { product: opts.product } : {}),
      ...(opts?.spawnImpl ? { spawnImpl: opts.spawnImpl } : {}),
    });
    runtime.externalAgents.attach(faceSessionId, live, { cwd: handle.cwd });
  }
  if (live.isBusy()) {
    if (!opts?.steer) {
      throw new ExternalAgentError(
        `${faceSessionId} is busy; use wait_agent or delivery=steer`,
        "EXTERNAL_AGENT_BUSY",
      );
    }
    // Soft-steer: wait for the in-flight turn (ACP has no portable cancel).
    // Hard cancel remains interrupt_agent → dispose.
    const deadline = Date.now() + 5 * 60 * 1000;
    while (live.isBusy() && Date.now() < deadline) {
      if (opts.signal?.aborted) {
        throw new DOMException("aborted", "AbortError");
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    if (live.isBusy()) {
      throw new ExternalAgentError(
        `${faceSessionId} still busy after steer wait`,
        "EXTERNAL_AGENT_BUSY",
      );
    }
  }
  runtime.onSessionDrainStatus(faceSessionId, true);
  try {
    const text = await live.prompt(message, opts?.signal);
    recordExternalTurn(runtime.store, faceSessionId, message, text);
    return text;
  } finally {
    runtime.onSessionDrainStatus(faceSessionId, false);
  }
}

export async function interruptExternalContinuable(
  runtime: ExternalAgentHost,
  faceSessionId: string,
  opts?: { readonly dispose?: boolean },
): Promise<void> {
  const live = runtime.externalAgents.get(faceSessionId);
  if (!live) return;
  runtime.suppressOwnedSubagentCompletion(faceSessionId);
  try {
    await live.interrupt();
  } catch {
    /* process may already be gone */
  }
  if (opts?.dispose !== false) {
    // Drop live process; keep sidecar so Status shows cold + follow-up can resume.
    runtime.externalAgents.detach(faceSessionId);
  }
}

export function contentPartsToText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as { type?: string; text?: unknown };
    if (p.type === "text" && typeof p.text === "string") parts.push(p.text);
  }
  return parts.join("\n").trim();
}
