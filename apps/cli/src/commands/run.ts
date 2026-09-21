import {
  toJSONL,
  createMemorySessionStore,
  createPersistentSessionStore,
  readSessionEvents,
  sessionEventCount,
  type SessionStore,
} from "@xrkseek/core-session";
import { resolveLlmFromEnv } from "@xrkseek/llm-registry";
import { createHarnessComposition } from "@xrkseek/preset-harness";
import { createMinimalComposition } from "@xrkseek/preset-minimal";
import {
  createFaceRuntime,
  resolveAgentPresetProfile,
  resolveLlmForSession,
} from "@xrkseek/server-face";
import { defaultSessionsDir } from "@xrkseek/server-config";
import {
  createLocalShell,
} from "@xrkseek/exec-shell";
import {
  createSshExecutionWorld,
  resolveSshConfigFromEnv,
} from "@xrkseek/exec-ssh";
import type { ParsedArgs } from "../parse-args.js";
import { createJsonRunProjection, writeJsonError } from "../json-stream.js";

function noopDrain() {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
  };
}

function resolveWorkspaceLlm(workspaceRoot: string) {
  const store = createMemorySessionStore();
  const sessionId = store.create().id;
  const runtime = createFaceRuntime({
    store,
    workspaceRoot,
    drain: noopDrain(),
    resolveAgent: async () => {
      throw new Error("run: resolveAgent unused");
    },
  });
  return (
    resolveLlmForSession(runtime, sessionId)?.adapter ??
    resolveLlmFromEnv(process.env)?.adapter
  );
}

async function readStdinTask(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * Resolve the task text: explicit prompt, lone `-` / piped stdin, or default.
 * Piped stdin is sent verbatim (trailing newline kept). A blank pipe fails.
 */
async function resolvePrompt(args: ParsedArgs): Promise<string> {
  if (args.promptExplicit) return args.prompt;
  if (args.promptFromStdin || !process.stdin.isTTY) {
    const text = await readStdinTask();
    if (text.length === 0 || text.trim() === "") {
      throw new Error(
        'a task is required (empty stdin); for example: xrkh run "ping"',
      );
    }
    return text;
  }
  return args.prompt;
}

function openSessionStore(args: ParsedArgs): SessionStore {
  if (!args.persist) return createMemorySessionStore();
  const dir =
    typeof process.env.XRK_SESSIONS_DIR === "string" &&
    process.env.XRK_SESSIONS_DIR.trim().length > 0
      ? process.env.XRK_SESSIONS_DIR.trim()
      : defaultSessionsDir();
  return createPersistentSessionStore(dir);
}

export async function runCommand(args: ParsedArgs): Promise<number> {
  const json = args.json === true;
  const writeError = (message: string): void => {
    if (json) {
      writeJsonError(process.stdout, message);
    } else {
      process.stderr.write(`xrkh: ${message}\n`);
    }
  };

  let prompt: string;
  try {
    prompt = await resolvePrompt(args);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeError(message);
    return 1;
  }

  const store = openSessionStore(args);
  const requestedId = args.sessionId;
  if (requestedId !== undefined) {
    if (!store.has(requestedId)) {
      writeError(
        `unknown session id ${JSON.stringify(requestedId)} (no persisted log)`,
      );
      return 1;
    }
  }

  const llm = resolveWorkspaceLlm(args.workspace);
  const profile = resolveAgentPresetProfile(args.preset, "minimal");

  let sshWorld: ReturnType<typeof createSshExecutionWorld> | undefined;
  try {
    const sshConfig = resolveSshConfigFromEnv(process.env);
    if (sshConfig) {
      sshWorld = createSshExecutionWorld({ config: sshConfig });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeError(`SSH remote workspace: ${message}`);
    return 1;
  }

  const workspaceRoot = sshWorld?.workspaceRoot ?? args.workspace;
  const sshShell = sshWorld
    ? createLocalShell({
        subprocess: sshWorld.subprocess,
        defaultCwd: workspaceRoot,
      })
    : undefined;

  const composition =
    profile.composition === "minimal"
      ? createMinimalComposition({
          workspaceRoot,
          sessionStore: store,
          ...(requestedId !== undefined ? { sessionId: requestedId } : {}),
          ...(llm ? { llm } : {}),
          ...(sshWorld ? { fs: sshWorld.fs } : {}),
        })
      : createHarnessComposition({
          workspaceRoot,
          sessionStore: store,
          ...(requestedId !== undefined ? { sessionId: requestedId } : {}),
          presentation: args.presentation,
          subagentRouting: profile.subagentRouting,
          webTools: profile.tools.web,
          lspTools: profile.tools.lsp,
          ...(profile.tools.pty && !sshWorld ? {} : { ptyTools: false }),
          ...(llm ? { llm } : {}),
          ...(sshWorld
            ? {
                fs: sshWorld.fs,
                remoteExecution: true,
                codeRuntime: sshWorld.codeRuntime,
                ...(sshShell ? { shell: sshShell } : {}),
              }
            : {}),
        });

  const sessionId = composition.sessionId;
  const firstSeq = sessionEventCount(composition.store, sessionId);
  const projection = json
    ? createJsonRunProjection(process.stdout)
    : undefined;
  if (projection) {
    projection.write({
      type: "session",
      sessionId,
      cwd: workspaceRoot,
    });
  }

  let pollTimer: ReturnType<typeof setInterval> | undefined;
  if (projection) {
    pollTimer = setInterval(() => {
      const events = readSessionEvents(composition.store, sessionId);
      projection.poll(events, firstSeq);
    }, 50);
  }

  try {
    const agent = await composition.createAgent();
    const result = await agent.run({ text: prompt });
    if (projection) {
      const events = readSessionEvents(composition.store, sessionId);
      projection.poll(events, firstSeq);
      projection.finish(result.text);
    } else {
      process.stdout.write(`${result.text}\n`);
    }
    if (process.env.XRK_DUMP_SESSION === "1" && !json) {
      // `--json` already streams durable events on stdout; avoid a second
      // JSONL dump on stderr for the same turn.
      const events = readSessionEvents(
        composition.store,
        composition.sessionId,
      );
      process.stderr.write(toJSONL(events));
    }
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    writeError(message);
    return 1;
  } finally {
    if (pollTimer !== undefined) clearInterval(pollTimer);
    if (sshShell) {
      try {
        await sshShell.dispose();
      } catch {
        // ignore
      }
    }
    sshWorld?.dispose();
  }
}
