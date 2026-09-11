import {
  spawn as nodeSpawn,
  spawnSync,
  type ChildProcess,
} from "node:child_process";

/**
 * After a stop request (abort / timeout / kill), `close` can be delayed forever
 * when an orphaned grandchild still holds the stdout pipe. The stop request
 * must still settle the call, so force-settle once this grace elapses.
 */
export const KILL_SETTLE_GRACE_MS = 5_000;

export interface SpawnOptions {
  readonly cwd?: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly signal?: AbortSignal;
  readonly timeoutMs?: number;
}

export interface SubprocessResult {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly killed: boolean;
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

  let stdout = "";
  let stderr = "";
  let settled = false;
  let killed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let graceTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveResult!: (r: SubprocessResult) => void;
  let rejectResult!: (err: Error) => void;
  const resultPromise = new Promise<SubprocessResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const finish = (result: SubprocessResult) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (graceTimer) clearTimeout(graceTimer);
    opts.signal?.removeEventListener("abort", onAbort);
    resolveResult(result);
  };

  // Orphaned grandchildren can keep the stdout pipe open forever, so a stop
  // request force-settles once the grace elapses instead of awaiting `close`.
  const armSettleGrace = () => {
    if (settled || graceTimer !== undefined) return;
    graceTimer = setTimeout(() => {
      finish({ stdout, stderr, exitCode: null, signal: null, killed: true });
    }, KILL_SETTLE_GRACE_MS);
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
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.on("error", (err) => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (graceTimer) clearTimeout(graceTimer);
    opts.signal?.removeEventListener("abort", onAbort);
    rejectResult(err);
  });
  child.on("close", (code, signal) => {
    finish({
      stdout,
      stderr,
      exitCode: code,
      signal,
      killed,
    });
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
