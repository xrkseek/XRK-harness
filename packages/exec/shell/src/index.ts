import type { ToolDefinition } from "@xrkseek/core-tools";
import type { SubprocessHandle, SubprocessService } from "@xrkseek/exec-subprocess";

export type ShellBackend = "bash" | "cmd" | "pwsh";

export interface ShellRunResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
}

export type ShellJobStatus = "running" | "exited" | "killed" | "failed";

export interface ShellJobInfo {
  readonly id: string;
  readonly command: string;
  readonly status: ShellJobStatus;
  readonly startedAt: number;
  readonly pid?: number;
  readonly exitCode?: number | null;
  readonly stdout?: string;
  readonly stderr?: string;
}

export interface ShellStartJobResult {
  readonly id: string;
  readonly pid?: number;
}

export interface ShellService {
  run(
    command: string,
    cwd?: string,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<ShellRunResult>;
  /** Start command without waiting; track via listJobs / killJob. */
  startJob(
    command: string,
    cwd?: string,
    opts?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<ShellStartJobResult>;
  listJobs(): Promise<readonly ShellJobInfo[]>;
  killJob(id: string): Promise<void>;
}

export interface ShellLocalOptions {
  readonly subprocess: SubprocessService;
  readonly backend?: ShellBackend;
  /** Max retained jobs (running + finished). Default 64. */
  readonly maxJobs?: number;
}

interface InternalJob {
  info: ShellJobInfo;
  handle: SubprocessHandle;
}

function argvFor(backend: ShellBackend, command: string): string[] {
  switch (backend) {
    case "cmd":
      return ["cmd.exe", "/c", command];
    case "pwsh":
      return [
        "pwsh",
        "-NoLogo",
        "-NoProfile",
        "-Command",
        command,
      ];
    case "bash":
    default:
      return ["bash", "-lc", command];
  }
}

function defaultBackend(): ShellBackend {
  return process.platform === "win32" ? "cmd" : "bash";
}

function nextJobId(seq: { n: number }): string {
  seq.n += 1;
  return `job_${seq.n}`;
}

export function createLocalShell(options: ShellLocalOptions): ShellService {
  const backend = options.backend ?? defaultBackend();
  const maxJobs = options.maxJobs ?? 64;
  const jobs = new Map<string, InternalJob>();
  const seq = { n: 0 };

  function pruneIfNeeded(): void {
    if (jobs.size <= maxJobs) return;
    const finished = [...jobs.entries()].filter(
      ([, j]) => j.info.status !== "running",
    );
    for (const [id] of finished) {
      if (jobs.size <= maxJobs) break;
      jobs.delete(id);
    }
  }

  function track(
    command: string,
    handle: SubprocessHandle,
  ): ShellStartJobResult {
    const id = nextJobId(seq);
    const info: ShellJobInfo = {
      id,
      command,
      status: "running",
      startedAt: Date.now(),
      ...(handle.pid !== undefined ? { pid: handle.pid } : {}),
    };
    jobs.set(id, { info, handle });
    pruneIfNeeded();

    void handle
      .result()
      .then((r) => {
        const cur = jobs.get(id);
        if (!cur) return;
        cur.info = {
          ...cur.info,
          status: r.killed ? "killed" : "exited",
          exitCode: r.exitCode,
          stdout: r.stdout,
          stderr: r.stderr,
        };
      })
      .catch((err: unknown) => {
        const cur = jobs.get(id);
        if (!cur) return;
        const message = err instanceof Error ? err.message : String(err);
        cur.info = {
          ...cur.info,
          status: "failed",
          stderr: message,
        };
      });

    return {
      id,
      ...(handle.pid !== undefined ? { pid: handle.pid } : {}),
    };
  }

  return {
    async run(command, cwd, opts) {
      const argv = argvFor(backend, command);
      const result = await options.subprocess.spawn(argv, {
        ...(cwd ? { cwd } : {}),
        ...(opts?.signal ? { signal: opts.signal } : {}),
        ...(opts?.timeoutMs !== undefined
          ? { timeoutMs: opts.timeoutMs }
          : {}),
      });
      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    },

    async startJob(command, cwd, opts) {
      const argv = argvFor(backend, command);
      const handle = options.subprocess.start(argv, {
        ...(cwd ? { cwd } : {}),
        ...(opts?.signal ? { signal: opts.signal } : {}),
        ...(opts?.timeoutMs !== undefined
          ? { timeoutMs: opts.timeoutMs }
          : {}),
      });
      return track(command, handle);
    },

    async listJobs() {
      return [...jobs.values()].map((j) => j.info);
    },

    async killJob(id) {
      const job = jobs.get(id);
      if (!job) {
        throw new Error(`shell job not found: ${id}`);
      }
      if (job.info.status !== "running") {
        return;
      }
      job.handle.kill();
      job.info = { ...job.info, status: "killed" };
    },
  };
}

function formatRun(out: ShellRunResult): string {
  return [
    out.stdout,
    out.stderr ? `stderr:\n${out.stderr}` : "",
    `exit=${out.exitCode ?? "?"}`,
  ]
    .filter(Boolean)
    .join("\n");
}

export function createBashTools(shell: ShellService): ToolDefinition[] {
  return [
    {
      name: "bash",
      description:
        "Run a shell command. Set background=true to start a job and return its id.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          background: { type: "boolean" },
        },
        required: ["command"],
      },
      async execute(args, signal) {
        const a = args as { command?: string; background?: boolean };
        const command = String(a.command ?? "");
        try {
          if (a.background) {
            const started = await shell.startJob(command, undefined, {
              ...(signal ? { signal } : {}),
            });
            return {
              content: `started ${started.id}${
                started.pid !== undefined ? ` pid=${started.pid}` : ""
              }`,
            };
          }
          const out = await shell.run(command, undefined, {
            ...(signal ? { signal } : {}),
          });
          return {
            content: formatRun(out),
            ...(out.exitCode !== 0 && out.exitCode !== null
              ? { isError: true as const }
              : {}),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: message, isError: true };
        }
      },
    },
    {
      name: "bash_jobs",
      description: "List background shell jobs (id, status, command).",
      parameters: { type: "object", properties: {} },
      async execute() {
        const list = await shell.listJobs();
        if (!list.length) return { content: "(no jobs)" };
        return {
          content: list
            .map(
              (j) =>
                `${j.id}\t${j.status}\t${j.command}${
                  j.exitCode !== undefined && j.exitCode !== null
                    ? `\texit=${j.exitCode}`
                    : ""
                }`,
            )
            .join("\n"),
        };
      },
    },
    {
      name: "bash_kill",
      description: "Kill a background shell job by id from bash_jobs.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
        },
        required: ["id"],
      },
      async execute(args) {
        const id = String((args as { id?: string }).id ?? "");
        try {
          await shell.killJob(id);
          return { content: `killed ${id}` };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: message, isError: true };
        }
      },
    },
  ];
}
