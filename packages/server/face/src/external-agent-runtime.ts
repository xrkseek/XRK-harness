/**
 * One-shot external agent runtimes for the subagent tool.
 * In-process delegation stays the default; these kinds spawn a child process.
 */
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";

export type ExternalAgentKind = "acp" | "app-server" | "claude-code";

export type ExternalSpawn = typeof spawn;

export interface RunExternalAgentOptions {
  readonly kind: ExternalAgentKind;
  readonly cwd: string;
  readonly prompt: string;
  readonly env?: NodeJS.ProcessEnv;
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
): { command: string; args: string[]; protocol: "acp" | "app-server" | "print" } {
  if (kind === "acp") {
    const raw = String(env.XRK_ACP_AGENT ?? "").trim();
    if (!raw) {
      throw new ExternalAgentError(
        "ACP runtime requires XRK_ACP_AGENT (command to spawn, e.g. xrkh acp)",
        "EXTERNAL_AGENT_CONFIG",
      );
    }
    const spec = splitCommand(raw);
    return { ...spec, protocol: "acp" };
  }
  if (kind === "app-server") {
    const raw = String(env.XRK_CODEX_APP_SERVER ?? "codex app-server").trim();
    const spec = splitCommand(raw);
    return { ...spec, protocol: "app-server" };
  }
  const raw = String(env.XRK_CLAUDE_CODE ?? "claude").trim();
  const spec = splitCommand(raw);
  return {
    command: spec.command,
    args: [...spec.args, "-p", prompt],
    protocol: "print",
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

async function speakJsonRpc(
  child: ChildProcessWithoutNullStreams,
  run: (io: {
    request: (method: string, params: unknown) => Promise<unknown>;
    notify: (method: string, params?: unknown) => void;
    onNotification: (fn: (msg: RpcLine) => void) => void;
  }) => Promise<string>,
): Promise<string> {
  let nextId = 1;
  const pending = new Map<
    number | string,
    { resolve: (v: unknown) => void; reject: (e: Error) => void }
  >();
  const notes: Array<(msg: RpcLine) => void> = [];
  const rl = createInterface({ input: child.stdout, crlfDelay: Infinity });
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

  const request = (method: string, params: unknown): Promise<unknown> => {
    const id = nextId++;
    const promise = new Promise<unknown>((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    writeLine(child, { id, method, params });
    return promise;
  };
  const notify = (method: string, params?: unknown): void => {
    writeLine(child, { method, ...(params !== undefined ? { params } : {}) });
  };

  try {
    return await run({
      request,
      notify,
      onNotification: (fn) => {
        notes.push(fn);
      },
    });
  } finally {
    rl.close();
    try {
      child.stdin.end();
    } catch {
      /* ignore */
    }
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
