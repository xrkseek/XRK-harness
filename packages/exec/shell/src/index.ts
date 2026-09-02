import path from "node:path";
import type { ToolDefinition } from "@xrkseek/core-tools";
import type { SubprocessHandle, SubprocessService } from "@xrkseek/exec-subprocess";
import { fitWithSuffix } from "./bytes.js";
import { presentBashCall, presentBashResult } from "./present.js";
import {
  PWSH_ENCODING_PREAMBLE,
  resolvePwshPath,
} from "./resolve-pwsh.js";

export {
  candidatePwshPaths,
  PWSH_ENCODING_PREAMBLE,
  resolvePwshPath,
} from "./resolve-pwsh.js";

export type ShellBackend = "bash" | "cmd" | "pwsh";

/**
 * Lifecycle (CV DSH JobStatus): `running` → optional `stopping` → one terminal
 * (`exited` | `killed` | `failed`). Face maps `exited` → `completed`.
 */
export type ShellJobStatus =
  | "running"
  | "stopping"
  | "exited"
  | "killed"
  | "failed";

export interface ShellJobInfo {
  readonly id: string;
  /** Producer kind — `bash` for subprocess jobs; `pty-send` for terminal background sends. */
  readonly kind: string;
  readonly command: string;
  readonly status: ShellJobStatus;
  readonly startedAt: number;
  readonly pid?: number;
  readonly exitCode?: number | null;
  /** Set when the subprocess exits on a signal (POSIX timeout/abort kills). */
  readonly signal?: NodeJS.Signals | null;
  readonly stdout?: string;
  readonly stderr?: string;
  /** Managed-job producer detail (DSH JobOutcome.detail). */
  readonly detail?: string;
  /** Epoch ms when the job reached a terminal status; absent while live/stopping. */
  readonly finishedAt?: number;
  /**
   * Internal delivery bit (DSH `reported`) — omitted from Face wire JobView.
   * True after terminal read / successful wait / kill / teardown cancel.
   */
  readonly reported: boolean;
  /** Producer-owned UTF-8 cap for job_output / completion notices. */
  readonly outputLimitBytes?: number;
  /**
   * Exact session owner (CV DSH `ownerSession`). Absent = unowned / open.
   * Face wire omits this; Agent `jobs.list` filters by it.
   */
  readonly ownerSessionId?: string;
  /**
   * True while a foreground tool call is attached (waiting on this job).
   * UI offers "move to background" only for awaited jobs; dropped on settle.
   */
  readonly foreground?: boolean;
}

export interface ShellStartJobResult {
  readonly id: string;
  readonly pid?: number;
}

export type KillJobResult = "requested" | "already-finished";

/** Terminal result from a managed producer (CV DSH JobOutcome). */
export interface ManagedJobOutcome {
  readonly status: "completed" | "killed" | "failed";
  readonly detail?: string;
  /** Final output for jobs without `readOutput`. */
  readonly output?: string;
}

/** Hooks returned synchronously from `startManagedJob` run() (CV DSH JobHooks). */
export interface ManagedJobHooks {
  cancel(reason?: string): void;
  readonly done: Promise<ManagedJobOutcome>;
  /** Consuming cursor of output since the previous call. */
  readOutput?(): string;
}

export interface ManagedJobStart {
  readonly kind: string;
  readonly label: string;
  /** Positive safe integer — bounds job_output / Face completion notice. */
  readonly outputLimitBytes?: number;
  /** Exact Face / composition session id (CV DSH job owner). */
  readonly ownerSessionId?: string;
  run(): ManagedJobHooks;
}

export interface ShellService {
  /** Start command without waiting; track via listJobs / killJob. Ids are `bash-N`. */
  startJob(
    command: string,
    cwd?: string,
    opts?: {
      signal?: AbortSignal;
      timeoutMs?: number;
      ownerSessionId?: string;
    },
  ): Promise<ShellStartJobResult>;
  /**
   * Register a non-subprocess producer (CV DSH `jobs.start`).
   * Ids are `<kind>-N` (e.g. `pty-send-1`).
   */
  startManagedJob(spec: ManagedJobStart): ShellStartJobResult;
  listJobs(): Promise<readonly ShellJobInfo[]>;
  /** Sync snapshot for Face `session/jobs` (DSH `jobs.list` is sync). */
  listJobsNow(): readonly ShellJobInfo[];
  /**
   * Request cancellation (CV DSH `jobs.kill`).
   * Live → `stopping` + `reported`, then producer settle; already terminal → `already-finished`.
   */
  killJob(id: string, reason?: string): Promise<KillJobResult>;
  /**
   * Read output for a background job. Managed jobs use the consuming
   * `readOutput` cursor; bash jobs return retained stdout/stderr when settled.
   * A terminal read marks the job `reported` (suppresses Face completion notice).
   */
  readJobOutput(id: string): string;
  /**
   * Block until the job reaches a terminal status or `timeoutMs` elapses (DSH `jobs.wait`).
   * Timeout resolves without error — caller may still see `running` / `stopping`.
   * Settlement while waiting marks `reported` before listeners (no duplicate notice).
   */
  waitJob(id: string, timeoutMs: number, signal?: AbortSignal): Promise<void>;
  /**
   * Attach the foreground wait of `id` (one per job): the returned signal
   * aborts when the wait is detached (UI "move to background"), letting the
   * caller stop waiting without killing the process.
   */
  attachForegroundWait(id: string): AbortSignal;
  /** Abort + drop the foreground wait of `id`. False when none was attached. */
  detachForegroundWait(id: string): boolean;
  /** Mark delivery reported without reading (tests / teardown). */
  markJobReported(id: string): void;
  /** DSH `onJobsChanged` — fires after register / stopping / settle / teardown clear. */
  onJobsChanged(listener: () => void): () => void;
  /**
   * Cancel live jobs, await settlement, clear the store (CV DSH jobs dispose).
   * Teardown cancel marks `reported` so Face completion notices stay quiet.
   */
  dispose(): Promise<void>;
}

export interface ShellLocalOptions {
  readonly subprocess: SubprocessService;
  readonly backend?: ShellBackend;
  /** Explicit pwsh/powershell path when backend is `pwsh`. */
  readonly pwshPath?: string;
  /**
   * Default spawn cwd when callers omit it (session workspace root).
   * Prevents `pwd` / relative tools from landing on the Host process cwd
   * (often a drive root when the Host was launched from Desktop).
   */
  readonly defaultCwd?: string;
  /** Max retained jobs (active + finished). Default 64. */
  readonly maxJobs?: number;
  /**
   * Max `running` + `stopping` jobs (CV DSH `maxConcurrentJobsPerOwner`).
   * Default 10.
   */
  readonly maxConcurrentJobs?: number;
}

interface InternalJob {
  info: ShellJobInfo;
  handle?: SubprocessHandle;
  managed?: ManagedJobHooks;
  /** Live waitJob callers — settlement marks reported when > 0. */
  waiters: number;
  /** Resolves once the first terminal snapshot is recorded. */
  settled: Promise<void>;
  markSettled: () => void;
  /** Final-output retention when producer has no `readOutput`. */
  finalOutput?: string;
}

function isActiveStatus(status: ShellJobStatus): boolean {
  return status === "running" || status === "stopping";
}

function isTerminalStatus(status: ShellJobStatus): boolean {
  return status === "exited" || status === "killed" || status === "failed";
}

function argvFor(
  backend: ShellBackend,
  command: string,
  pwshPath: string,
): string[] {
  switch (backend) {
    case "cmd":
      return ["cmd.exe", "/c", command];
    case "pwsh":
      return [
        pwshPath,
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `${PWSH_ENCODING_PREAMBLE}${command}`,
      ];
    case "bash":
    default:
      return ["bash", "-lc", command];
  }
}

/** Windows → PowerShell (DSH / Codex); POSIX → bash. */
function defaultBackend(): ShellBackend {
  return process.platform === "win32" ? "pwsh" : "bash";
}

function nextKindJobId(counts: Map<string, number>, kind: string): string {
  if (kind.length === 0) throw new Error("invalid job kind");
  const n = (counts.get(kind) ?? 0) + 1;
  counts.set(kind, n);
  return `${kind}-${n}`;
}

const DEFAULT_MAX_CONCURRENT_JOBS = 10;

function resolveSpawnCwd(
  cwd: string | undefined,
  defaultCwd: string | undefined,
): string | undefined {
  const trimmed = cwd?.trim();
  if (trimmed && trimmed.length > 0) {
    if (path.isAbsolute(trimmed)) return trimmed;
    if (defaultCwd && defaultCwd.trim().length > 0) {
      return path.resolve(defaultCwd.trim(), trimmed);
    }
    return path.resolve(trimmed);
  }
  const fallback = defaultCwd?.trim();
  return fallback && fallback.length > 0 ? fallback : undefined;
}

export function createLocalShell(options: ShellLocalOptions): ShellService {
  const backend = options.backend ?? defaultBackend();
  const pwshPath = resolvePwshPath(options.pwshPath);
  const defaultCwd = options.defaultCwd?.trim() || undefined;
  const maxJobs = options.maxJobs ?? 64;
  const maxConcurrent = options.maxConcurrentJobs ?? DEFAULT_MAX_CONCURRENT_JOBS;
  if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1) {
    throw new Error("maxConcurrentJobs must be a positive safe integer");
  }
  const jobs = new Map<string, InternalJob>();
  const foregroundWaits = new Map<string, AbortController>();
  const kindSeq = new Map<string, number>();
  const changed = new Set<() => void>();
  let disposed = false;

  function assertOpen(): void {
    if (disposed) throw new Error("shell jobs registry is disposed");
  }

  function notifyChanged(): void {
    for (const listener of [...changed]) {
      try {
        listener();
      } catch {
        /* DSH contains observer throws so a commit still lands. */
      }
    }
  }

  function listNow(): readonly ShellJobInfo[] {
    return [...jobs.values()].map((j) =>
      foregroundWaits.has(j.info.id)
        ? { ...j.info, foreground: true }
        : j.info,
    );
  }

  function activeCount(ownerSessionId: string | undefined): number {
    let n = 0;
    for (const j of jobs.values()) {
      if (!isActiveStatus(j.info.status)) continue;
      if (j.info.ownerSessionId === ownerSessionId) n += 1;
    }
    return n;
  }

  function assertAdmission(ownerSessionId: string | undefined): void {
    if (activeCount(ownerSessionId) >= maxConcurrent) {
      throw new Error(
        `background job limit reached (limit: ${maxConcurrent}); use job_kill to stop an unneeded job, wait for it to finish, then retry`,
      );
    }
  }

  function pruneIfNeeded(): void {
    if (jobs.size <= maxJobs) return;
    const finished = [...jobs.entries()].filter(
      ([, j]) => isTerminalStatus(j.info.status),
    );
    for (const [id] of finished) {
      if (jobs.size <= maxJobs) break;
      jobs.delete(id);
    }
  }

  function markReported(job: InternalJob): void {
    if (job.info.reported) return;
    job.info = { ...job.info, reported: true };
  }

  function makeSettled(): {
    settled: Promise<void>;
    markSettled: () => void;
  } {
    let markSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      markSettled = resolve;
    });
    return { settled, markSettled };
  }

  /** First-wins terminal commit; live waiters mark reported before listeners (DSH). */
  function settleAndNotify(job: InternalJob, next: ShellJobInfo): void {
    if (isTerminalStatus(job.info.status)) return;
    foregroundWaits.delete(job.info.id);
    const reported = job.waiters > 0 || next.reported;
    job.info = { ...next, reported };
    job.markSettled();
    notifyChanged();
  }

  function track(
    command: string,
    handle: SubprocessHandle,
    ownerSessionId: string | undefined,
  ): ShellStartJobResult {
    assertOpen();
    assertAdmission(ownerSessionId);
    const id = nextKindJobId(kindSeq, "bash");
    const { settled, markSettled } = makeSettled();
    const info: ShellJobInfo = {
      id,
      kind: "bash",
      command,
      status: "running",
      startedAt: Date.now(),
      reported: false,
      ...(handle.pid !== undefined ? { pid: handle.pid } : {}),
      ...(ownerSessionId !== undefined ? { ownerSessionId } : {}),
    };
    jobs.set(id, { info, handle, waiters: 0, settled, markSettled });
    pruneIfNeeded();
    notifyChanged();

    void handle
      .result()
      .then((r) => {
        const cur = jobs.get(id);
        if (!cur || isTerminalStatus(cur.info.status)) return;
        settleAndNotify(cur, {
          ...cur.info,
          status: r.killed ? "killed" : "exited",
          exitCode: r.exitCode,
          ...(r.signal !== null && r.signal !== undefined
            ? { signal: r.signal }
            : {}),
          stdout: r.stdout,
          stderr: r.stderr,
          finishedAt: Date.now(),
        });
      })
      .catch((err: unknown) => {
        const cur = jobs.get(id);
        if (!cur || isTerminalStatus(cur.info.status)) return;
        const message = err instanceof Error ? err.message : String(err);
        settleAndNotify(cur, {
          ...cur.info,
          status: "failed",
          stderr: message,
          finishedAt: Date.now(),
        });
      });

    return {
      id,
      ...(handle.pid !== undefined ? { pid: handle.pid } : {}),
    };
  }

  return {
    async startJob(command, cwd, opts) {
      assertOpen();
      const ownerSessionId = opts?.ownerSessionId?.trim() || undefined;
      assertAdmission(ownerSessionId);
      const argv = argvFor(backend, command, pwshPath);
      const spawnCwd = resolveSpawnCwd(cwd, defaultCwd);
      const handle = options.subprocess.start(argv, {
        ...(spawnCwd ? { cwd: spawnCwd } : {}),
        ...(opts?.signal ? { signal: opts.signal } : {}),
        ...(opts?.timeoutMs !== undefined
          ? { timeoutMs: opts.timeoutMs }
          : {}),
      });
      return track(command, handle, ownerSessionId);
    },

    startManagedJob(spec) {
      assertOpen();
      const ownerSessionId = spec.ownerSessionId?.trim() || undefined;
      assertAdmission(ownerSessionId);
      const kind = String(spec.kind ?? "").trim();
      const label = String(spec.label ?? "").trim();
      if (!kind) throw new Error("invalid job kind");
      if (!label) throw new Error("invalid job label");
      const limit = spec.outputLimitBytes;
      if (
        limit !== undefined &&
        (!Number.isSafeInteger(limit) || limit <= 0)
      ) {
        throw new Error("outputLimitBytes must be a positive safe integer");
      }
      const hooks = spec.run();
      const id = nextKindJobId(kindSeq, kind);
      const { settled, markSettled } = makeSettled();
      const info: ShellJobInfo = {
        id,
        kind,
        command: label,
        status: "running",
        startedAt: Date.now(),
        reported: false,
        ...(limit !== undefined ? { outputLimitBytes: limit } : {}),
        ...(ownerSessionId !== undefined ? { ownerSessionId } : {}),
      };
      jobs.set(id, { info, managed: hooks, waiters: 0, settled, markSettled });
      pruneIfNeeded();
      notifyChanged();

      void hooks.done
        .then((outcome) => {
          const cur = jobs.get(id);
          if (!cur || isTerminalStatus(cur.info.status)) return;
          const status: ShellJobStatus =
            outcome.status === "completed"
              ? "exited"
              : outcome.status === "killed"
                ? "killed"
                : "failed";
          if (outcome.output !== undefined) cur.finalOutput = outcome.output;
          settleAndNotify(cur, {
            ...cur.info,
            status,
            ...(outcome.detail !== undefined ? { detail: outcome.detail } : {}),
            finishedAt: Date.now(),
          });
        })
        .catch((err: unknown) => {
          const cur = jobs.get(id);
          if (!cur || isTerminalStatus(cur.info.status)) return;
          const message = err instanceof Error ? err.message : String(err);
          settleAndNotify(cur, {
            ...cur.info,
            status: "failed",
            detail: message,
            finishedAt: Date.now(),
          });
        });

      return { id };
    },

    async listJobs() {
      return listNow();
    },

    listJobsNow() {
      return listNow();
    },

    async killJob(id, reason) {
      const job = jobs.get(id);
      if (!job) {
        throw new Error(`shell job not found: ${id}`);
      }
      if (isTerminalStatus(job.info.status)) {
        markReported(job);
        return "already-finished";
      }
      if (job.info.status === "stopping") {
        return "requested";
      }
      // Cancel first so a throw leaves lifecycle unchanged (DSH).
      if (job.managed) {
        job.managed.cancel(reason);
      } else {
        job.handle?.kill();
      }
      job.info = {
        ...job.info,
        status: "stopping",
        reported: true,
      };
      notifyChanged();
      return "requested";
    },

    readJobOutput(id) {
      const job = jobs.get(id);
      if (!job) throw new Error(`shell job not found: ${id}`);
      if (isTerminalStatus(job.info.status)) markReported(job);
      if (job.managed?.readOutput) {
        return job.managed.readOutput();
      }
      if (job.managed) {
        return isTerminalStatus(job.info.status) ? (job.finalOutput ?? "") : "";
      }
      const out = job.info.stdout ?? "";
      const err = job.info.stderr ?? "";
      if (isActiveStatus(job.info.status)) {
        return out.length > 0 || err.length > 0 ? `${out}${err}` : "";
      }
      let body = out;
      if (err.length > 0) {
        if (body.length > 0 && !body.endsWith("\n")) body += "\n";
        body += `[stderr]\n${err}`;
      }
      if (body.length === 0) body = "(no output)";
      return body;
    },

    waitJob(id, timeoutMs, signal) {
      const job = jobs.get(id);
      if (!job) {
        return Promise.reject(new Error(`shell job not found: ${id}`));
      }
      if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        return Promise.reject(
          new Error(
            `invalid wait timeout: expected a positive number of milliseconds, got ${JSON.stringify(timeoutMs)}`,
          ),
        );
      }
      if (isTerminalStatus(job.info.status)) {
        markReported(job);
        return Promise.resolve();
      }
      const cap = Math.max(1, timeoutMs);
      job.waiters += 1;
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        const done = (err?: unknown) => {
          if (settled) return;
          settled = true;
          job.waiters = Math.max(0, job.waiters - 1);
          changed.delete(tick);
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
          if (err !== undefined) {
            reject(err instanceof Error ? err : new Error(String(err)));
          } else resolve();
        };
        const onAbort = () => {
          const reason = signal?.reason;
          done(
            reason instanceof Error
              ? reason
              : new DOMException("aborted", "AbortError"),
          );
        };
        const tick = () => {
          const cur = jobs.get(id);
          if (!cur || isTerminalStatus(cur.info.status)) done();
        };
        changed.add(tick);
        const timer = setTimeout(() => done(), cap);
        signal?.addEventListener("abort", onAbort, { once: true });
        if (signal?.aborted) onAbort();
        else tick();
      });
    },

    attachForegroundWait(id) {
      assertOpen();
      if (!jobs.has(id)) throw new Error(`shell job not found: ${id}`);
      const previous = foregroundWaits.get(id);
      if (previous) previous.abort();
      const controller = new AbortController();
      foregroundWaits.set(id, controller);
      notifyChanged();
      return controller.signal;
    },

    detachForegroundWait(id) {
      const controller = foregroundWaits.get(id);
      if (!controller) return false;
      foregroundWaits.delete(id);
      controller.abort();
      notifyChanged();
      return true;
    },

    markJobReported(id) {
      const job = jobs.get(id);
      if (!job) throw new Error(`shell job not found: ${id}`);
      markReported(job);
    },

    onJobsChanged(listener) {
      changed.add(listener);
      return () => {
        changed.delete(listener);
      };
    },

    async dispose() {
      if (disposed) return;
      disposed = true;
      const all = [...jobs.values()];
      for (const job of all) {
        if (isTerminalStatus(job.info.status)) continue;
        job.info = { ...job.info, reported: true };
        try {
          if (job.managed) {
            job.managed.cancel("shell disposed");
          } else {
            job.handle?.kill();
          }
          if (!isTerminalStatus(job.info.status)) {
            job.info = { ...job.info, status: "stopping", reported: true };
            notifyChanged();
          }
        } catch (err: unknown) {
          const detail = `cancel threw during teardown; work may be orphaned: ${String(err)}`;
          settleAndNotify(job, {
            ...job.info,
            status: "failed",
            detail,
            finishedAt: Date.now(),
            reported: true,
          });
        }
      }
      await Promise.all(all.map((j) => j.settled));
      jobs.clear();
      notifyChanged();
    },
  };
}

/**
 * Session-scoped view over a shared jobs registry (CV DSH owner fence without Cordis).
 * Stamps `ownerSessionId`, filters list, and rejects foreign kill/read/wait.
 * `dispose()` is a no-op — only the root registry owns teardown.
 */
export function createSessionScopedShell(
  shell: ShellService,
  ownerSessionId: string,
): ShellService {
  const sid = ownerSessionId.trim();
  if (!sid) throw new Error("ownerSessionId must be a non-empty string");

  const visible = (job: ShellJobInfo): boolean =>
    job.ownerSessionId === undefined || job.ownerSessionId === sid;

  const expectVisible = (id: string): void => {
    const job = shell.listJobsNow().find((j) => j.id === id);
    if (!job) throw new Error(`shell job not found: ${id}`);
    if (!visible(job)) {
      throw new Error(`job ${id} belongs to another session`);
    }
  };

  /** Visible-set fingerprint — skip notifies that only move another owner's jobs. */
  const fingerprint = (): string =>
    shell
      .listJobsNow()
      .filter(visible)
      .map(
        (j) =>
          `${j.id}:${j.status}:${j.reported ? 1 : 0}:${j.finishedAt ?? 0}:${j.foreground ? 1 : 0}`,
      )
      .join("|");

  return {
    startJob: (command, cwd, opts) =>
      shell.startJob(command, cwd, {
        ...opts,
        ownerSessionId: sid,
      }),
    startManagedJob: (spec) =>
      shell.startManagedJob({
        ...spec,
        ownerSessionId: sid,
      }),
    listJobs: async () => shell.listJobsNow().filter(visible),
    listJobsNow: () => shell.listJobsNow().filter(visible),
    killJob: async (id, reason) => {
      expectVisible(id);
      return shell.killJob(id, reason);
    },
    readJobOutput: (id) => {
      expectVisible(id);
      return shell.readJobOutput(id);
    },
    waitJob: (id, timeoutMs, signal) => {
      expectVisible(id);
      return shell.waitJob(id, timeoutMs, signal);
    },
    attachForegroundWait: (id) => {
      expectVisible(id);
      return shell.attachForegroundWait(id);
    },
    detachForegroundWait: (id) => {
      expectVisible(id);
      return shell.detachForegroundWait(id);
    },
    markJobReported: (id) => {
      expectVisible(id);
      shell.markJobReported(id);
    },
    onJobsChanged: (listener) => {
      let prev = fingerprint();
      return shell.onJobsChanged(() => {
        const next = fingerprint();
        if (next === prev) return;
        prev = next;
        listener();
      });
    },
    dispose: async () => {
      /* session scope does not own the registry */
    },
  };
}

/** DSH tool-jobs status trailer: `[status: completed, wait: stdin_read]`. */
export function statusLine(opts: {
  readonly status: string;
  readonly detail?: string;
}): string {
  return opts.detail !== undefined && opts.detail.length > 0
    ? `[status: ${opts.status}, ${opts.detail}]`
    : `[status: ${opts.status}]`;
}

const JOB_OUTPUT_WAIT_DEFAULT_MS = 30_000;
const JOB_OUTPUT_WAIT_CAP_MS = 600_000;

function positiveMs(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : undefined;
}

function requireJobId(args: unknown): string {
  const a = args as { job_id?: string; id?: string };
  const id = String(a.job_id ?? a.id ?? "").trim();
  if (!id) throw new Error("job_id must be a non-empty string");
  return id;
}

function faceJobStatus(status: ShellJobStatus): string {
  return status === "exited" ? "completed" : status;
}

/** Legacy foreground markers for UI exit pills (DSH `[exit code: N]` / `[killed by signal: X]`). */
function appendLegacyExitMarker(
  content: string,
  snapshot: Pick<ShellJobInfo, "status" | "exitCode" | "signal">,
): string {
  if (snapshot.status === "killed") {
    if (
      snapshot.exitCode !== null &&
      snapshot.exitCode !== undefined &&
      snapshot.exitCode !== 0
    ) {
      return `${content}\n[exit code: ${snapshot.exitCode}]`;
    }
    const sig = snapshot.signal ?? "SIGTERM";
    return `${content}\n[killed by signal: ${sig}]`;
  }
  if (
    snapshot.exitCode !== null &&
    snapshot.exitCode !== undefined &&
    snapshot.exitCode !== 0
  ) {
    return `${content}\n[exit code: ${snapshot.exitCode}]`;
  }
  return content;
}

function formatJobOutput(
  text: string,
  snapshot: Pick<ShellJobInfo, "status" | "detail" | "outputLimitBytes">,
): string {
  const body = text.length > 0 ? text : "(no new output)";
  const content = body.endsWith("\n") ? body.slice(0, -1) : body;
  const trailer = `\n${statusLine({
    status: faceJobStatus(snapshot.status),
    ...(snapshot.detail !== undefined ? { detail: snapshot.detail } : {}),
  })}`;
  const limit = snapshot.outputLimitBytes;
  if (limit === undefined) return `${content}${trailer}`;
  return fitWithSuffix(content, trailer, limit);
}

/**
 * Foreground wait cap (codex-style yield): when it elapses, the call returns
 * with the job still running instead of blocking the turn forever. The yield
 * kills nothing — waiting again (job_output wait) extends, job_kill stops.
 * Codex clamps interactive yields to 250–30_000 ms (see unified_exec/mod.rs).
 */
export const MIN_FOREGROUND_YIELD_MS = 250;
export const MAX_FOREGROUND_YIELD_MS = 30_000;
export const DEFAULT_FOREGROUND_YIELD_MS = 30_000;

/** Clamp a settings or tool override to the Codex-style yield window. */
export function clampForegroundYieldMs(ms: number): number {
  return Math.min(
    MAX_FOREGROUND_YIELD_MS,
    Math.max(MIN_FOREGROUND_YIELD_MS, Math.floor(ms)),
  );
}

export function createBashTools(
  shell: ShellService,
  options: {
    readonly timeoutMs?: number;
    readonly maxOutputBytes?: number;
    /** Default process cwd for bash/pwsh (session workspace root). */
    readonly defaultCwd?: string;
    /** Foreground yield cap; defaults to DEFAULT_FOREGROUND_YIELD_MS. */
    readonly foregroundYieldMs?: number;
  } = {},
): ToolDefinition[] {
  const timeoutMs =
    typeof options.timeoutMs === "number" &&
    Number.isFinite(options.timeoutMs) &&
    options.timeoutMs > 0
      ? Math.floor(options.timeoutMs)
      : undefined;
  const maxOutputBytes =
    typeof options.maxOutputBytes === "number" &&
    Number.isFinite(options.maxOutputBytes) &&
    options.maxOutputBytes > 0
      ? Math.floor(options.maxOutputBytes)
      : undefined;
  const defaultCwd =
    typeof options.defaultCwd === "string" && options.defaultCwd.trim().length > 0
      ? options.defaultCwd.trim()
      : undefined;
  const yieldMs = clampForegroundYieldMs(
    typeof options.foregroundYieldMs === "number" &&
      Number.isFinite(options.foregroundYieldMs) &&
      options.foregroundYieldMs > 0
      ? options.foregroundYieldMs
      : DEFAULT_FOREGROUND_YIELD_MS,
  );
  const dialect =
    process.platform === "win32"
      ? "PowerShell (pwsh). Prefer PowerShell syntax (`Get-ChildItem`, `$env:NAME`, `Set-Location`). Use workdir instead of cd when possible."
      : "bash. Use POSIX shell syntax.";
  return [
    {
      name: "bash",
      description:
        `Run a shell command via ${dialect} ` +
        "Default cwd is the session workspace root (not the Host process cwd) — " +
        "`pwd` / `Get-Location` should show the workspace. Prefer relative paths; " +
        "set workdir only when another directory is required. " +
        `Foreground waits up to ${Math.round(yieldMs / 1000)}s (yield): if the command is still running then, the call returns its job id and the process keeps running — ` +
        "call job_output(wait:true) to keep waiting (each wait extends the deadline, so long tasks never die on a timeout), job_kill to stop, or leave it in background. " +
        "Set background=true to start a job and return its id immediately. " +
        "timeout_ms sets a hard kill deadline for this call.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string" },
          background: { type: "boolean" },
          workdir: {
            type: "string",
            description:
              "Working directory for this command. Relative paths resolve against the session workspace. Defaults to the session workspace root.",
          },
          timeout_ms: {
            type: "number",
            description:
              "Optional hard kill deadline in ms for this call: the process is killed when it elapses. Omit to rely on the foreground yield (returns early, process keeps running).",
          },
        },
        required: ["command"],
      },
      async execute(args, signal) {
        const a = args as {
          command?: string;
          background?: boolean;
          workdir?: string;
        };
        const command = String(a.command ?? "");
        const workdirRaw = String(a.workdir ?? "").trim();
        const cwd =
          workdirRaw.length > 0
            ? workdirRaw
            : defaultCwd;
        try {
          if (a.background) {
            const started = await shell.startJob(command, cwd, {
              ...(signal ? { signal } : {}),
              ...(timeoutMs !== undefined ? { timeoutMs } : {}),
            });
            return {
              content: `started ${started.id}${
                started.pid !== undefined ? ` pid=${started.pid}` : ""
              }`,
            };
          }
          const hardTimeoutMs =
            positiveMs((args as { timeout_ms?: unknown }).timeout_ms) ??
            timeoutMs;
          const started = await shell.startJob(command, cwd, {
            ...(signal ? { signal } : {}),
            ...(hardTimeoutMs !== undefined
              ? { timeoutMs: hardTimeoutMs }
              : {}),
          });
          // Yield semantics: the wait is bounded, the process is not. A detach
          // (UI "move to background") aborts only the wait; the turn signal
          // kills the process via startJob above.
          const detachSignal = shell.attachForegroundWait(started.id);
          const waitMerge = new AbortController();
          const onTurnAbort = () => waitMerge.abort(signal?.reason);
          const onDetach = () => waitMerge.abort(detachSignal.reason);
          if (signal?.aborted === true) waitMerge.abort(signal.reason);
          else signal?.addEventListener("abort", onTurnAbort, { once: true });
          if (detachSignal.aborted) waitMerge.abort(detachSignal.reason);
          else detachSignal.addEventListener("abort", onDetach, { once: true });
          let turnAborted = false;
          try {
            await shell.waitJob(started.id, yieldMs, waitMerge.signal);
          } catch {
            turnAborted = signal?.aborted === true;
          } finally {
            signal?.removeEventListener("abort", onTurnAbort);
            detachSignal.removeEventListener("abort", onDetach);
            shell.detachForegroundWait(started.id);
          }
          const snapshot = shell
            .listJobsNow()
            .find((j) => j.id === started.id);
          if (!snapshot) throw new Error(`shell job not found: ${started.id}`);
          const body = shell.readJobOutput(started.id);
          let content: string;
          if (turnAborted) {
            content = formatJobOutput(body, snapshot);
          } else if (isActiveStatus(snapshot.status)) {
            content =
              formatJobOutput(body, snapshot) +
              `\n[still running after ${yieldMs} ms — job ${started.id} keeps running: ` +
              "job_output(wait:true) to keep waiting (each wait extends), " +
              "job_kill to stop, or leave it in background]";
          } else {
            // Settled: keep the legacy foreground shape (`[stderr]` section +
            // trailing exit marker) so the UI exit pill still parses.
            content = appendLegacyExitMarker(body, snapshot);
          }
          if (maxOutputBytes !== undefined) {
            content = fitWithSuffix(content, "\n[truncated]", maxOutputBytes);
          }
          return { content };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: message, isError: true };
        }
      },
      presentCall: presentBashCall,
      presentResult: presentBashResult,
    },
    {
      name: "job_list",
      description:
        "List your background jobs (running and finished) with their ids, kinds, and statuses.",
      parameters: { type: "object", properties: {} },
      async execute() {
        const list = await shell.listJobs();
        if (!list.length) return { content: "(no background jobs)" };
        return {
          content: list
            .map((j) => {
              const status = faceJobStatus(j.status);
              return `${j.id} [${j.kind}] ${status} — ${j.command}`;
            })
            .join("\n"),
        };
      },
      presentCall: () => ({
        card: "generic",
        title: "List background jobs",
        kind: "read",
      }),
      isConcurrencySafe: () => true,
    },
    {
      name: "job_output",
      description:
        "Read a background job. Stream jobs return only output since the previous read. Every response ends with `[status: ...]`. Reads are non-blocking unless `wait: true`.",
      parameters: {
        type: "object",
        properties: {
          job_id: {
            type: "string",
            description: "Job id returned by the tool that started the background work.",
          },
          id: {
            type: "string",
            description: "Alias of job_id.",
          },
          wait: {
            type: "boolean",
            description:
              "Block until the job reaches a terminal status or the timeout expires. A timed-out wait returns [status: running] and leaves the job alive.",
          },
          timeout_ms: {
            type: "number",
            description:
              "Max wait in milliseconds (only with wait: true). Default 30s; capped at 10min.",
          },
        },
        required: ["job_id"],
      },
      async execute(args, signal) {
        try {
          const id = requireJobId(args);
          const wait = (args as { wait?: boolean }).wait === true;
          if (wait) {
            const raw = (args as { timeout_ms?: number }).timeout_ms;
            const timeout = Math.min(
              typeof raw === "number" && Number.isFinite(raw) && raw > 0
                ? raw
                : JOB_OUTPUT_WAIT_DEFAULT_MS,
              JOB_OUTPUT_WAIT_CAP_MS,
            );
            await shell.waitJob(id, timeout, signal);
          }
          const snapshot = shell.listJobsNow().find((j) => j.id === id);
          if (!snapshot) throw new Error(`shell job not found: ${id}`);
          return {
            content: formatJobOutput(shell.readJobOutput(id), snapshot),
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: message, isError: true };
        }
      },
      presentCall: (args) => ({
        card: "generic",
        title: `Read output from background job ${requireJobIdSafe(args)}`,
        kind: "read",
      }),
      // Non-blocking reads may overlap; wait:true is exclusive.
      isConcurrencySafe: (args) =>
        (args as { wait?: boolean }).wait !== true,
    },
    {
      name: "job_kill",
      description:
        "Request cancellation of a running background job by job id. Returns immediately; the job settles as killed once its work actually stops.",
      parameters: {
        type: "object",
        properties: {
          job_id: {
            type: "string",
            description: "Job id returned by the tool that started the background work.",
          },
          id: { type: "string", description: "Alias of job_id." },
        },
        required: ["job_id"],
      },
      async execute(args) {
        try {
          const id = requireJobId(args);
          const before = shell.listJobsNow().find((j) => j.id === id);
          if (!before) throw new Error(`shell job not found: ${id}`);
          if (
            before.status === "exited" ||
            before.status === "killed" ||
            before.status === "failed"
          ) {
            return {
              content: `job ${id} had already finished ${statusLine({
                status: faceJobStatus(before.status),
                ...(before.detail !== undefined
                  ? { detail: before.detail }
                  : {}),
              })}`,
            };
          }
          await shell.killJob(id);
          return { content: `requested cancellation of job ${id}` };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { content: message, isError: true };
        }
      },
      presentCall: (args) => ({
        card: "generic",
        title: `Kill background job ${requireJobIdSafe(args)}`,
        kind: "execute",
      }),
    },
  ];
}

function requireJobIdSafe(args: unknown): string {
  try {
    return requireJobId(args);
  } catch {
    return "";
  }
}

export { presentBashCall, presentBashResult } from "./present.js";
export {
  toJobView,
  type ShellJobView,
  type ShellJobViewInput,
} from "./job-view.js";

/** DSH tool-jobs system prompt (order 106). */
export const JOBS_PROMPT_TEXT =
  "Track every background job id you start (`bash` with background=true, or terminal background sends). You are notified in-session when a job finishes — do not busy-poll or sleep on one; keep working on independent steps and do not duplicate a running job's work. Before giving a final answer, collect every still-relevant job with job_output (set wait: true only when you are genuinely blocked on it), and job_kill jobs that stopped mattering. Use job_list / job_output / job_kill.";
