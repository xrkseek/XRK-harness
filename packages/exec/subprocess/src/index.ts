import {
  spawn as nodeSpawn,
  type ChildProcessWithoutNullStreams,
} from "node:child_process";

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

function killTree(
  child: ChildProcessWithoutNullStreams,
  signal: NodeJS.Signals = "SIGTERM",
): void {
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
  });

  let stdout = "";
  let stderr = "";
  let settled = false;
  let killed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
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
    opts.signal?.removeEventListener("abort", onAbort);
    resolveResult(result);
  };

  const onAbort = () => {
    killed = true;
    killTree(child);
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
      killed = true;
      killTree(child);
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
      killed = true;
      killTree(child, signal);
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
