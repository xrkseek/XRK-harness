import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import {
  DEFAULT_MAX_RESULT_BYTES,
  MIN_MAX_RESULT_BYTES,
  boundTerminalText,
  presentOpenCall,
  presentSendCall,
  presentSendResult,
  renderList,
  renderRead,
  renderSend,
  renderSendRead,
  renderSpawn,
} from "./render.js";
import {
  isTerminalError,
  type TerminalSessionService,
  type TerminalSignal,
} from "./types.js";

export const PTY_TOOL_NAMES = [
  "terminal_open",
  "terminal_send",
  "terminal_read",
  "terminal_signal",
  "terminal_close",
  "terminal_list",
] as const;

export const TERMINAL_SIGNALS = [
  "SIGINT",
  "SIGTERM",
  "SIGKILL",
  "SIGTSTP",
  "SIGHUP",
] as const;

export function ptyUnavailableMessage(): string {
  return "Error: persistent PTY is not configured. Install optionalDependency node-pty@1.2.0-beta.15 (NAPI prebuilds; no VS C++ rebuild on Windows) and keep ptyTools enabled on the harness/server preset.";
}

export interface CreatePtyToolsOptions {
  readonly workspaceRoot: string;
  readonly service?: TerminalSessionService;
  readonly maxResultBytes?: number;
  /**
   * Composition job registry for `run_in_background` (CV DSH `ctx.jobs`).
   * Usually the harness `ShellService` (`startManagedJob`).
   */
  readonly jobs?: PtyBackgroundJobs;
  /** Expose `run_in_background` (default true; execute still needs `jobs`). */
  readonly enableRunInBackground?: boolean;
  /** Face session id forwarded as child `XRK_SESSION_ID`. */
  readonly ownerSessionId?: string;
}

/** Minimal jobs seam used by background terminal_send (no shell import). */
export interface PtyBackgroundJobs {
  startManagedJob(spec: {
    readonly kind: string;
    readonly label: string;
    readonly outputLimitBytes?: number;
    run(): {
      cancel(): void;
      readonly done: Promise<{
        readonly status: "completed" | "killed" | "failed";
        readonly detail?: string;
      }>;
      readOutput?(): string;
    };
  }): { readonly id: string };
}

function sendDetail(result: {
  readonly waitReason: string;
  readonly sessionStatus: { readonly kind: string; readonly exitCode?: number | null; readonly signal?: string | null };
}): string {
  return result.sessionStatus.kind === "running"
    ? `wait: ${result.waitReason}`
    : `session exited: ${
        "exitCode" in result.sessionStatus && result.sessionStatus.exitCode != null
          ? result.sessionStatus.exitCode
          : "signal" in result.sessionStatus && result.sessionStatus.signal
            ? result.sessionStatus.signal
            : "unknown"
      }`;
}

function fail(err: unknown): ToolResultContent {
  const message = isTerminalError(err)
    ? `Error: ${err.message}`
    : `Error: ${err instanceof Error ? err.message : String(err)}`;
  return { content: message, isError: true };
}

function requireSessionId(value: unknown): string {
  const sessionId = String(value ?? "").trim();
  if (!sessionId) throw new Error("sessionId must be a non-empty string");
  return sessionId;
}

function isSignal(value: string): value is TerminalSignal {
  return (TERMINAL_SIGNALS as readonly string[]).includes(value);
}

export function createPtyTools(options: CreatePtyToolsOptions): ToolDefinition[] {
  const maxResultBytes = options.maxResultBytes ?? DEFAULT_MAX_RESULT_BYTES;
  if (
    !Number.isSafeInteger(maxResultBytes) ||
    maxResultBytes < MIN_MAX_RESULT_BYTES
  ) {
    throw new Error(
      `pty: maxResultBytes must be a safe integer of at least ${MIN_MAX_RESULT_BYTES}`,
    );
  }
  const missing = ptyUnavailableMessage();
  const bound = (text: string): string => boundTerminalText(text, maxResultBytes);
  const enableBg = options.enableRunInBackground ?? true;

  const requireService = (): TerminalSessionService => {
    if (!options.service) throw new Error(missing.replace(/^Error: /, ""));
    return options.service;
  };

  return [
    {
      name: "terminal_open",
      description:
        "Create a persistent terminal session from a registered backend type. Use this for shell or REPL state that must survive across tool calls.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            description: 'Registered terminal backend type, usually "shell".',
          },
          name: {
            type: "string",
            description: 'Optional display name such as "main" or "gdb".',
          },
          cwd: {
            type: "string",
            description:
              "Initial working directory inside the workspace. Defaults to the workspace root.",
          },
        },
        required: ["type"],
      },
      async execute(args, signal) {
        try {
          const type = String((args as { type?: string }).type ?? "").trim();
          if (!type) throw new Error("type must be a non-empty string");
          const name = (args as { name?: string }).name;
          const cwd = (args as { cwd?: string }).cwd;
          const result = await requireService().spawn(
            {
              type,
              ...(name !== undefined ? { name } : {}),
              ...(cwd !== undefined ? { cwd } : {}),
              ...(options.ownerSessionId !== undefined
                ? { ownerSessionId: options.ownerSessionId }
                : {}),
            },
            signal,
          );
          return {
            content: bound(renderSpawn(result, maxResultBytes)),
            meta: {
              sessionId: result.sessionId,
              type: result.type,
              ...(result.name !== undefined ? { name: result.name } : {}),
              ...(result.pid !== undefined ? { pid: result.pid } : {}),
              status: result.status,
              motd: result.motd,
            },
          };
        } catch (err) {
          return fail(err);
        }
      },
      presentCall: (args) => presentOpenCall(args as { type?: string; name?: string }),
    },
    {
      name: "terminal_send",
      description:
        "Send text to a persistent terminal. By default Enter is submitted and the call waits for a prompt, stdin wait, output silence, timeout, or session exit." +
        (enableBg
          ? " Background mode returns a job id for job_output / job_kill."
          : ""),
      parameters: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description: "Terminal session id returned by terminal_open or terminal_list.",
          },
          text: {
            type: "string",
            description: "UTF-8 text to write to the terminal.",
          },
          submit: {
            type: "boolean",
            description:
              "Submit Enter after text (default true). Set false for control characters or incomplete REPL input.",
          },
          ...(enableBg
            ? {
                run_in_background: {
                  type: "boolean",
                  description:
                    "Return a job id immediately; collect with job_output or stop with job_kill.",
                },
              }
            : {}),
        },
        required: ["sessionId", "text"],
      },
      async execute(args, signal) {
        try {
          const sessionId = requireSessionId((args as { sessionId?: string }).sessionId);
          const text = String((args as { text?: string }).text ?? "");
          const submit = (args as { submit?: boolean }).submit ?? true;
          const runInBackground =
            enableBg && (args as { run_in_background?: boolean }).run_in_background === true;
          if (runInBackground) {
            const jobs = options.jobs;
            if (!jobs) {
              throw new Error(
                "background terminal sends require a composition jobs registry (harness shell startManagedJob)",
              );
            }
            let cancelRequested = false;
            const started = jobs.startManagedJob({
              kind: "pty-send",
              label: `${sessionId}: ${text || "(input)"}`,
              outputLimitBytes: maxResultBytes,
              run: () => {
                const operation = requireService().startSend(sessionId, {
                  text,
                  submit,
                });
                return {
                  cancel: () => {
                    cancelRequested = true;
                    operation.cancel();
                  },
                  done: operation.done.then(
                    (result) => ({
                      status: (cancelRequested ? "killed" : "completed"),
                      detail: sendDetail(result),
                    }),
                    (error: unknown) => ({
                      status: "failed" as const,
                      detail: String(error),
                    }),
                  ),
                  readOutput: () => renderSendRead(operation.readOutput()),
                };
              },
            });
            return {
              content: `started background job ${started.id}`,
              meta: { kind: "background", jobId: started.id },
            };
          }
          const operation = requireService().startSend(sessionId, {
            text,
            submit,
            ...(signal ? { signal } : {}),
          });
          const result = await operation.done;
          if (signal?.aborted) throw new Error("terminal send aborted");
          return {
            content: bound(renderSend(result, maxResultBytes)),
            meta: {
              viewport: result.viewport,
              waitReason: result.waitReason,
              sessionStatus: result.sessionStatus,
              truncated: result.truncated,
            },
          };
        } catch (err) {
          return fail(err);
        }
      },
      presentCall: (args) =>
        presentSendCall(
          args as {
            sessionId?: string;
            text?: string;
            run_in_background?: boolean;
          },
        ),
      presentResult: (args, result) => {
        if (
          (args as { run_in_background?: boolean } | undefined)
            ?.run_in_background === true
        ) {
          return undefined;
        }
        return presentSendResult(args, result);
      },
    },
    {
      name: "terminal_read",
      description:
        "Read a bounded page of retained output from a persistent terminal without sending input.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Terminal session id." },
          offset: {
            type: "number",
            description: "Newest-relative line offset (default 0).",
          },
          count: {
            type: "number",
            description: "Requested line count (default 500; backend caps apply).",
          },
        },
        required: ["sessionId"],
      },
      async execute(args) {
        try {
          const sessionId = requireSessionId((args as { sessionId?: string }).sessionId);
          const offset = (args as { offset?: number }).offset;
          const count = (args as { count?: number }).count;
          const result = requireService().read(sessionId, {
            ...(offset !== undefined ? { offset } : {}),
            ...(count !== undefined ? { count } : {}),
          });
          return {
            content: bound(renderRead(result, maxResultBytes)),
            meta: {
              text: result.text,
              totalLines: result.totalLines,
              lineBegin: result.lineBegin,
              lineEnd: result.lineEnd,
              truncated: result.truncated,
            },
          };
        } catch (err) {
          return fail(err);
        }
      },
      presentCall: (args) => ({
        card: "generic",
        title: `Read terminal ${(args as { sessionId?: string }).sessionId ?? ""}`,
        kind: "read",
        rawInput: args,
      }),
      isConcurrencySafe: () => true,
    },
    {
      name: "terminal_signal",
      description:
        "Send an allowed signal to the current foreground process group of a persistent terminal. Shell-targeted SIGKILL is rejected; use terminal_close.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Terminal session id." },
          signal: {
            type: "string",
            enum: [...TERMINAL_SIGNALS],
            description: "Signal to deliver.",
          },
        },
        required: ["sessionId", "signal"],
      },
      async execute(args) {
        try {
          const sessionId = requireSessionId((args as { sessionId?: string }).sessionId);
          const signal = String((args as { signal?: string }).signal ?? "");
          if (!isSignal(signal)) {
            throw new Error(`signal must be one of ${TERMINAL_SIGNALS.join(", ")}`);
          }
          const result = await requireService().signal(sessionId, signal);
          return {
            content: bound(
              `delivered ${signal} to foreground process group ${result.targetPgid}`,
            ),
            meta: { targetPgid: result.targetPgid, signal },
          };
        } catch (err) {
          return fail(err);
        }
      },
      presentCall: (args) => ({
        card: "generic",
        title: `Signal terminal ${(args as { sessionId?: string }).sessionId ?? ""}`,
        kind: "execute",
        rawInput: args,
      }),
    },
    {
      name: "terminal_close",
      description:
        "Close one persistent terminal and wait until its process tree is gone.",
      parameters: {
        type: "object",
        properties: {
          sessionId: { type: "string", description: "Terminal session id." },
        },
        required: ["sessionId"],
      },
      async execute(args) {
        try {
          const sessionId = requireSessionId((args as { sessionId?: string }).sessionId);
          const closed = await requireService().kill(sessionId);
          return {
            content: bound(
              closed
                ? `closed terminal session ${sessionId}`
                : `terminal session ${sessionId} was already closing`,
            ),
          };
        } catch (err) {
          return fail(err);
        }
      },
      presentCall: (args) => ({
        card: "generic",
        title: `Close terminal ${(args as { sessionId?: string }).sessionId ?? ""}`,
        kind: "delete",
      }),
    },
    {
      name: "terminal_list",
      description: "List persistent terminal sessions in this composition.",
      parameters: { type: "object", properties: {} },
      async execute() {
        try {
          const sessions = requireService().list();
          return {
            content: bound(renderList(sessions, maxResultBytes)),
            meta: {
              sessions: sessions.map((s) => ({
                sessionId: s.sessionId,
                type: s.type,
                ...(s.name !== undefined ? { name: s.name } : {}),
                ...(s.pid !== undefined ? { pid: s.pid } : {}),
                status: s.status,
              })),
            },
          };
        } catch (err) {
          return fail(err);
        }
      },
      presentCall: () => ({
        card: "generic",
        title: "List terminal sessions",
        kind: "read",
      }),
      isConcurrencySafe: () => true,
    },
  ];
}
