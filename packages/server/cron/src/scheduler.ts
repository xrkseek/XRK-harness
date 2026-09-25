import { randomUUID } from "node:crypto";
import { isDue, nextRunAt } from "./schedule.js";
import { formatCronOutput } from "./runner.js";
import {
  DEFAULT_TICK_MS,
  type CronAgentRunner,
  type CronDeliverer,
  type CronJob,
  type CronRunResult,
  type CronScriptRunner,
} from "./types.js";
import type { CronJobStore } from "./store.js";

export interface CronScheduler {
  readonly store: CronJobStore;
  /** Hermes-style run history when a ledger was wired. */
  readonly executions?: import("./executions.js").CronExecutionLedger;
  start(): void;
  stop(): void;
  /** Run one tick (due jobs). Returns number of jobs started. */
  tick(): Promise<number>;
  /** Fire one job now (does not require due). */
  runNow(id: string, signal?: AbortSignal): Promise<CronRunResult>;
}

export interface CreateCronSchedulerOptions {
  readonly store: CronJobStore;
  readonly runScript: CronScriptRunner;
  readonly runAgent?: CronAgentRunner;
  readonly deliver?: CronDeliverer;
  readonly tickMs?: number;
  readonly now?: () => Date;
  readonly maxParallel?: number;
  readonly onError?: (err: unknown, job?: CronJob) => void;
  /** Optional Hermes-style run history ledger. */
  readonly executions?: import("./executions.js").CronExecutionLedger;
}

/**
 * In-process Host cron ticker (Hermes-style). Dispatches agent turns and scripts,
 * then delivers results via webhook/file.
 */
export function createCronScheduler(
  options: CreateCronSchedulerOptions,
): CronScheduler {
  const tickMs = options.tickMs ?? DEFAULT_TICK_MS;
  const maxParallel = options.maxParallel ?? 2;
  const now = options.now ?? (() => new Date());
  let timer: ReturnType<typeof setInterval> | undefined;
  let ticking = false;
  const running = new Set<string>();

  const execute = async (
    job: CronJob,
    signal?: AbortSignal,
  ): Promise<CronRunResult> => {
    if (job.run.kind === "script") {
      return options.runScript(job, signal);
    }
    if (!options.runAgent) {
      return {
        ok: false,
        output: "",
        error:
          "agent cron runner is not configured on this Host (script jobs still work)",
      };
    }
    return options.runAgent(job, signal);
  };

  const finish = async (
    job: CronJob,
    result: CronRunResult,
    signal?: AbortSignal,
    startedAt?: string,
  ): Promise<void> => {
    const stamp = now().toISOString();
    const scheduleNext =
      job.schedule.kind === "at"
        ? null
        : nextRunAt(job.schedule, now());
    options.store.update(job.id, {
      lastRunAt: stamp,
      lastStatus: result.ok ? "ok" : "error",
      ...(result.error ? { lastError: result.error } : { lastError: "" }),
      lastOutputChars: result.output.length,
      nextRunAt: scheduleNext,
      ...(job.schedule.kind === "at" ? { enabled: false } : {}),
    });
    try {
      options.executions?.append({
        id: `exec_${randomUUID().replace(/-/g, "").slice(0, 12)}`,
        jobId: job.id,
        ...(job.name ? { jobName: job.name } : {}),
        startedAt: startedAt ?? stamp,
        finishedAt: stamp,
        status: result.ok ? "ok" : "error",
        ...(result.error ? { error: result.error } : {}),
        outputChars: result.output.length,
        ...(result.sessionId ? { sessionId: result.sessionId } : {}),
      });
    } catch (err) {
      options.onError?.(err, job);
    }
    if (options.deliver && job.delivery.kind !== "none") {
      try {
        await options.deliver(job, result, signal);
      } catch (err) {
        options.onError?.(err, job);
      }
    }
  };

  const runNow = async (
    id: string,
    signal?: AbortSignal,
  ): Promise<CronRunResult> => {
    const job = options.store.get(id);
    if (!job) {
      return { ok: false, output: "", error: `cron job not found: ${id}` };
    }
    if (running.has(id)) {
      return { ok: false, output: "", error: "job already running" };
    }
    running.add(id);
    try {
      const startedAt = now().toISOString();
      const result = await execute(job, signal);
      await finish(job, result, signal, startedAt);
      return result;
    } finally {
      running.delete(id);
    }
  };

  const tick = async (): Promise<number> => {
    if (ticking) return 0;
    ticking = true;
    try {
      options.store.reload();
      const due = options.store
        .list()
        .filter(
          (j) =>
            j.enabled &&
            !running.has(j.id) &&
            isDue(j.nextRunAt, now()),
        )
        .slice(0, Math.max(1, maxParallel - running.size));
      await Promise.all(
        due.map(async (job) => {
          running.add(job.id);
          try {
            // Claim: advance next_run before execute (Hermes tick order).
            if (job.schedule.kind !== "at") {
              options.store.update(job.id, {
                nextRunAt: nextRunAt(job.schedule, now()),
              });
            } else {
              options.store.update(job.id, { nextRunAt: null, enabled: false });
            }
            const startedAt = now().toISOString();
            const result = await execute(job);
            await finish(job, result, undefined, startedAt);
          } catch (err) {
            options.onError?.(err, job);
            try {
              await finish(
                job,
                {
                  ok: false,
                  output: "",
                  error: err instanceof Error ? err.message : String(err),
                },
                undefined,
                now().toISOString(),
              );
            } catch {
              /* already reported */
            }
          } finally {
            running.delete(job.id);
          }
        }),
      );
      return due.length;
    } finally {
      ticking = false;
    }
  };

  return {
    store: options.store,
    ...(options.executions ? { executions: options.executions } : {}),
    start() {
      if (timer) return;
      timer = setInterval(() => {
        void tick().catch((err) => options.onError?.(err));
      }, tickMs);
      if (typeof timer === "object" && "unref" in timer) {
        timer.unref();
      }
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = undefined;
      }
    },
    tick,
    runNow,
  };
}

export { formatCronOutput };
