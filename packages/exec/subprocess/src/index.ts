import {
  spawn as nodeSpawn,
  spawnSync,
  type ChildProcess,
} from "node:child_process";
import os from "node:os";
import {
  prepareSpillBinding,
  StreamTailCollector,
  SUBPROCESS_CAPTURE_MAX_BYTES,
  type SpillOptions,
} from "./capture.js";

export {
  appendUtf8TailCap,
  prepareSpillBinding,
  privateSpillDir,
  StreamTailCollector,
  SUBPROCESS_CAPTURE_MAX_BYTES,
  SUBPROCESS_SPILL_MAX_BYTES,
} from "./capture.js";
export type {
  CollectedOutput,
  SpillFailureReporter,
  SpillOptions,
} from "./capture.js";

/**
 * After a stop request (abort / timeout / kill), `close` can be delayed forever
 * when an orphaned grandchild still holds the stdout pipe. The stop request
 * must still settle the call, so force-settle once this grace elapses.
 */
export const KILL_SETTLE_GRACE_MS = 5_000;

/**
 * After a natural `exit`, `close` can also be delayed forever by an orphaned
 * grandchild that still holds the stdout pipe (e.g. `cmd /c "start /b ..."`,
 * `node server &`, a dev server forked from the command). The child process is
 * already gone — its `exitCode`/`signal` are final and no new output can be
 * produced by it — so waiting for `close` would leave background jobs
 * "running" forever. Force-settle once this grace elapses.
 */
export const EXIT_SETTLE_GRACE_MS = 2_000;

export interface SpawnOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
  /** Live stdout chunks (UTF-8); used by shell jobs to surface mid-run output. */
  readonly onStdout?: (chunk: string) => void;
  /** Live stderr chunks (UTF-8). */
  readonly onStderr?: (chunk: string) => void;
  /**
   * Spill overflow beyond the in-memory tail to a private file (DSH
   * OutputCollector). **Default off** — sync `writeSync` on the Host event
   * loop would otherwise stall LLM/mux during every flood (including
   * `rg --files`). Pass `true` / {@link prepareSpillBinding} for shell jobs
   * that need full-stream recovery under `{XRK_HOME}/spill`.
   */
  readonly spill?: boolean | SpillOptions;
}

function resolveSpillOptions(
  spill: SpawnOptions["spill"],
): SpillOptions | undefined {
  if (spill === undefined || spill === false) return undefined;
  if (spill === true) return prepareSpillBinding();
  return spill;
}

export interface SubprocessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly killed: boolean;
  /** True when stdout exceeded {@link SUBPROCESS_CAPTURE_MAX_BYTES}. */
  readonly stdoutTruncated?: boolean;
  /** True when stderr exceeded {@link SUBPROCESS_CAPTURE_MAX_BYTES}. */
  readonly stderrTruncated?: boolean;
  /** Complete stdout spill path when overflow was retained on disk. */
  readonly stdoutSpillPath?: string;
  /** Complete stderr spill path when overflow was retained on disk. */
  readonly stderrSpillPath?: string;
}

/**
 * Non-blocking ordinary child — await `result()` to settle.
 * Does not expose `pid` (ordinary piped spawn); terminal handles keep `pid`
 * on `@xrkseek/exec-pty` `SubprocessTerminalHandle`.
 */
export interface SubprocessHandle {
  kill(signal?: NodeJS.Signals): void;
  result(): Promise<SubprocessResult>;
}

export interface SubprocessService {
  /** Block until the process exits (or abort/timeout). */
  spawn(
    argv: readonly string[],
    opts?: SpawnOptions,
  ): Promise<SubprocessResult>;
  /** Start without waiting; use for background jobs. */
  start(argv: readonly string[], opts?: SpawnOptions): SubprocessHandle;
}

/**
 * Terminate one Windows process tree with `taskkill /T /F`.
 * Contained like POSIX group signalling — absent trees, nonzero status, and a
 * missing taskkill binary must not break idempotent teardown.
 * `stdio: 'ignore'` + `windowsHide` keep the helper from flashing a console.
 * @param pid - root process id, when the spawn published one.
 * @param run - injectable `spawnSync` (tests).
 */
export function taskkillProcessTree(
  pid: number | undefined,
  run: typeof spawnSync = spawnSync,
): void {
  if (pid === undefined || pid <= 0) return;
  run("taskkill", ["/PID", String(pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  });
}

/**
 * Best-effort process-tree kill. `child.kill` only reaches the direct child:
 * on Windows the shell's own children (node.exe, git.exe, …) survive it and can
 * hold the stdout pipe open, delaying `close`. `taskkill /T` walks the tree.
 */
function killTree(
  child: ChildProcess,
  signal: NodeJS.Signals = "SIGTERM",
): void {
  if (child.pid !== undefined) {
    if (process.platform === "win32") {
      taskkillProcessTree(child.pid);
    } else {
      // POSIX: a negative pid reaches the whole process group when the child
      // leads one; ESRCH/EPERM otherwise is expected and ignored.
      try {
        process.kill(-child.pid, signal);
      } catch {
        // not a group leader — the direct kill below still applies
      }
    }
  }
  try {
    child.kill(signal);
  } catch {
    // ignore
  }
}

function startLocal(
  argv: readonly string[],
  opts: SpawnOptions = {},
): SubprocessHandle {
  if (!argv.length) {
    throw new Error("spawn argv must be non-empty");
  }
  const [cmd, ...args] = argv;
  const child = nodeSpawn(cmd!, args, {
    cwd: opts.cwd,
    env: opts.env,
    // Non-terminal children: hide the console window on Windows so background
    // bash/cmd/pwsh jobs do not steal focus (terminals stay on the PTY path).
    windowsHide: true,
    // Explicit: do not detach on win32 (tree kill is taskkill-by-root-pid).
    detached: false,
    // One-shot shells have no input channel: an open-but-never-ended stdin
    // pipe would make any stdin-reading command block forever without EOF.
    stdio: ["ignore", "pipe", "pipe"],
  });
  // Best-effort: keep Host LLM/mux turns ahead of CPU-bound grandchildren
  // (OCR batches, compilers). Children typically inherit this class.
  if (child.pid !== undefined && child.pid > 0) {
    try {
      const below = os.constants.priority?.PRIORITY_BELOW_NORMAL;
      if (typeof below === "number") os.setPriority(child.pid, below);
    } catch {
      // ignore: missing rights / pid already gone
    }
  }

  const spillOpts = resolveSpillOptions(opts.spill);
  const stdoutCol = new StreamTailCollector(
    SUBPROCESS_CAPTURE_MAX_BYTES,
    "stdout",
    spillOpts,
  );
  const stderrCol = new StreamTailCollector(
    SUBPROCESS_CAPTURE_MAX_BYTES,
    "stderr",
    spillOpts,
  );
  let settled = false;
  let killed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let exitTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveResult!: (r: SubprocessResult) => void;
  let rejectResult!: (err: Error) => void;
  const resultPromise = new Promise<SubprocessResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  /** Finalize collectors at most once — exit-grace and `close` can both fire. */
  const settleWith = (
    exitCode: number | null,
    signal: NodeJS.Signals | null,
    wasKilled: boolean,
  ): void => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (graceTimer) clearTimeout(graceTimer);
    if (exitTimer) clearTimeout(exitTimer);
    opts.signal?.removeEventListener("abort", onAbort);
    const out = stdoutCol.finalize();
    const err = stderrCol.finalize();
    resolveResult({
      stdout: out.text,
      stderr: err.text,
      exitCode,
      signal,
      killed: wasKilled,
      ...(out.truncated ? { stdoutTruncated: true } : {}),
      ...(err.truncated ? { stderrTruncated: true } : {}),
      ...(out.spillPath !== undefined ? { stdoutSpillPath: out.spillPath } : {}),
      ...(err.spillPath !== undefined ? { stderrSpillPath: err.spillPath } : {}),
    });
  };

  // Orphaned grandchildren can keep the stdout pipe open forever, so a stop
  // request force-settles once the grace elapses instead of awaiting `close`.
  const armSettleGrace = () => {
    if (settled || graceTimer !== undefined) return;
    graceTimer = setTimeout(() => {
      settleWith(null, null, true);
    }, KILL_SETTLE_GRACE_MS);
  };

  /**
   * Natural-exit settlement (not a stop request). `child.on("close")` requires
   * every stdio stream to EOF; an orphaned grandchild that inherited the stdout
   * pipe keeps it open forever even though the child itself already exited.
   * Normal descendants drain their pipe within the grace, so this arm path
   * almost never fires; when it does, the child's `exitCode`/`signal` are final
   * and we are dropping only trailing bytes from a detached orphan.
   */
  const armExitSettleGrace = (code: number | null, signal: NodeJS.Signals | null) => {
    if (settled || exitTimer !== undefined) return;
    exitTimer = setTimeout(() => {
      settleWith(code, signal, killed);
    }, EXIT_SETTLE_GRACE_MS);
  };

  const stopChild = (signal: NodeJS.Signals = "SIGTERM") => {
    killed = true;
    killTree(child, signal);
    armSettleGrace();
  };

  const onAbort = () => {
    stopChild();
  };

  if (opts.signal) {
    if (opts.signal.aborted) {
      onAbort();
    } else {
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
    timer = setTimeout(() => {
      stopChild();
    }, opts.timeoutMs);
  }

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  // Pause after each data event so a flood cannot occupy a whole I/O phase
  // (other sessions' LLM streams / WS Ping share this event loop).
  const yieldPipe = (stream: NodeJS.ReadableStream): void => {
    stream.pause();
    setImmediate(() => {
      if (!settled) stream.resume();
    });
  };
  child.stdout.on("data", (chunk: string) => {
    stdoutCol.push(chunk);
    opts.onStdout?.(chunk);
    yieldPipe(child.stdout);
  });
  child.stderr.on("data", (chunk: string) => {
    stderrCol.push(chunk);
    opts.onStderr?.(chunk);
    yieldPipe(child.stderr);
  });
  child.on("error", (err) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (graceTimer) clearTimeout(graceTimer);
    if (exitTimer) clearTimeout(exitTimer);
    opts.signal?.removeEventListener("abort", onAbort);
    stdoutCol.seal();
    stderrCol.seal();
    rejectResult(err);
  });
  child.on("exit", (code, signal) => {
    // `close` normally fires right after — but an orphaned grandchild still
    // holding the stdout pipe delays it forever. The child is gone; settle on
    // the final exit code once the drain grace elapses.
    armExitSettleGrace(code, signal);
  });
  child.on("close", (code, signal) => {
    if (exitTimer) clearTimeout(exitTimer);
    settleWith(code, signal, killed);
  });

  return {
    kill(signal = "SIGTERM") {
      stopChild(signal);
    },
    result() {
      return resultPromise;
    },
  };
}

export function createLocalSubprocess(): SubprocessService {
  return {
    start(argv, opts) {
      return startLocal(argv, opts);
    },
    async spawn(argv, opts) {
      return startLocal(argv, opts).result();
    },
  };
}
