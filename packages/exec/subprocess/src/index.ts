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

/** Non-blocking child — await `result()` to settle. */
export interface SubprocessHandle {
  readonly pid: number | undefined;
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
      try {
        spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          windowsHide: true,
        });
      } catch {
        // taskkill unavailable — the direct kill below still applies
      }
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
    windowsHide: true,
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
    get pid() {
      return child.pid;
    },
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
