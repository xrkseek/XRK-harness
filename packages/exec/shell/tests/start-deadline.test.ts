import { describe, expect, it, vi } from "vitest";
import type {
  SubprocessHandle,
  SubprocessResult,
  SubprocessService,
} from "@xrkseek/exec-subprocess";
import { createLocalShell, shellStartDeadline } from "../src/index.js";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (err: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function stubSubprocess(onStart: (signal?: AbortSignal) => void): SubprocessService {
  return {
    async spawn() {
      throw new Error("unused");
    },
    start(_argv, opts): SubprocessHandle {
      onStart(opts?.signal);
      const result: SubprocessResult = {
        stdout: "",
        stderr: "",
        exitCode: 0,
        signal: null,
        killed: false,
      };
      return {
        kill() {},
        result: async () => result,
      };
    },
  };
}

describe("shell start deadline (prep counts toward timeout)", () => {
  it("shellStartDeadline merges upstream and timeout", () => {
    const upstream = new AbortController();
    const merged = shellStartDeadline(upstream.signal, 50);
    expect(merged).toBeDefined();
    expect(merged!.aborted).toBe(false);
    upstream.abort();
    expect(merged!.aborted).toBe(true);
  });

  it("times out unresolved prepareArgv and never spawns", async () => {
    vi.useFakeTimers();
    const prepared = deferred<readonly string[]>();
    let spawnCalls = 0;
    const shell = createLocalShell({
      subprocess: stubSubprocess(() => {
        spawnCalls += 1;
      }),
      backend: "bash",
      prepareArgv: (_argv, _cwd, signal) => {
        signal?.addEventListener(
          "abort",
          () => {
            prepared.reject(
              signal.reason instanceof Error
                ? signal.reason
                : new DOMException("aborted", "AbortError"),
            );
          },
          { once: true },
        );
        return prepared.promise;
      },
    });

    const pending = shell.startJob("echo hi", undefined, { timeoutMs: 10 });
    let settled = false;
    let error: unknown;
    void pending.then(
      () => {
        settled = true;
      },
      (err: unknown) => {
        settled = true;
        error = err;
      },
    );

    await vi.advanceTimersByTimeAsync(10);
    expect(settled).toBe(true);
    expect(spawnCalls).toBe(0);
    expect(error).toBeInstanceOf(DOMException);

    prepared.resolve(["echo", "late"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(spawnCalls).toBe(0);
    vi.useRealTimers();
  });

  it("passes the same deadline signal to spawn after prep", async () => {
    vi.useFakeTimers();
    let spawnSignal: AbortSignal | undefined;
    const shell = createLocalShell({
      subprocess: stubSubprocess((signal) => {
        spawnSignal = signal;
      }),
      backend: "bash",
      prepareArgv: async (argv, _cwd, signal) => {
        expect(signal?.aborted).toBe(false);
        await vi.advanceTimersByTimeAsync(40);
        signal?.throwIfAborted();
        return argv;
      },
    });

    const started = shell.startJob("true", undefined, { timeoutMs: 100 });
    await vi.advanceTimersByTimeAsync(40);
    await started;
    expect(spawnSignal).toBeDefined();
    expect(spawnSignal!.aborted).toBe(false);

    await vi.advanceTimersByTimeAsync(60);
    expect(spawnSignal!.aborted).toBe(true);
    vi.useRealTimers();
  });

  it("preserves upstream cancel during prepare without spawning", async () => {
    const prepared = deferred<readonly string[]>();
    let spawnCalls = 0;
    const shell = createLocalShell({
      subprocess: stubSubprocess(() => {
        spawnCalls += 1;
      }),
      backend: "bash",
      prepareArgv: (_argv, _cwd, signal) => {
        signal?.addEventListener(
          "abort",
          () => {
            prepared.reject(
              signal.reason instanceof Error
                ? signal.reason
                : new Error(String(signal.reason)),
            );
          },
          { once: true },
        );
        return prepared.promise;
      },
    });

    const controller = new AbortController();
    const reason = new Error("caller stopped preparation");
    const pending = shell.startJob("echo hi", undefined, {
      signal: controller.signal,
      timeoutMs: 5_000,
    });
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    expect(spawnCalls).toBe(0);
  });
});
