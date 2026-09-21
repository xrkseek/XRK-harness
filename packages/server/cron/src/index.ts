export {
  CronError,
  isCronError,
  MIN_EVERY_SECONDS,
  DEFAULT_TICK_MS,
  type CronSchedule,
  type CronRun,
  type CronDelivery,
  type CronJob,
  type CronJobCreateInput,
  type CronRunResult,
  type CronAgentRunner,
  type CronScriptRunner,
  type CronDeliverer,
} from "./types.js";
export {
  assertSchedule,
  nextRunAt,
  isDue,
} from "./schedule.js";
export {
  createCronJobStore,
  defaultCronJobsPath,
  type CronJobStore,
} from "./store.js";
export { createCronDeliverer, type CreateCronDelivererOptions } from "./deliver.js";
export {
  createDefaultScriptRunner,
  formatCronOutput,
  type CreateScriptRunnerOptions,
} from "./runner.js";
export {
  createCronScheduler,
  type CronScheduler,
  type CreateCronSchedulerOptions,
} from "./scheduler.js";
export {
  createCronTools,
  CRON_PROMPT_TEXT,
} from "./tools.js";

import path from "node:path";
import { createCronDeliverer } from "./deliver.js";
import { createDefaultScriptRunner } from "./runner.js";
import { createCronScheduler, type CronScheduler } from "./scheduler.js";
import { createCronJobStore, defaultCronJobsPath } from "./store.js";
import type { CronAgentRunner } from "./types.js";
import { DEFAULT_TICK_MS } from "./types.js";

export interface CreateHostCronOptions {
  readonly productHome: string;
  readonly workspaceRoot?: string;
  readonly runAgent?: CronAgentRunner;
  readonly env?: NodeJS.ProcessEnv;
  readonly tickMs?: number;
  readonly fetchImpl?: typeof fetch;
  readonly onError?: (err: unknown) => void;
}

/**
 * Host convenience: jobs under `{productHome}/cron/jobs.json`, script runner,
 * webhook/file delivery, optional agent runner for unattended turns.
 * Disabled when `XRK_CRON=0`.
 */
export function createHostCron(
  options: CreateHostCronOptions,
): CronScheduler | undefined {
  const env = options.env ?? process.env;
  if (String(env.XRK_CRON ?? "1").trim() === "0") {
    return undefined;
  }
  const store = createCronJobStore({
    filePath: defaultCronJobsPath(options.productHome),
  });
  return createCronScheduler({
    store,
    runScript: createDefaultScriptRunner({
      defaultCwd: options.workspaceRoot ?? options.productHome,
    }),
    ...(options.runAgent ? { runAgent: options.runAgent } : {}),
    deliver: createCronDeliverer({
      env,
      ...(options.workspaceRoot
        ? { workspaceRoot: options.workspaceRoot }
        : {}),
      ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
    }),
    tickMs: options.tickMs ?? DEFAULT_TICK_MS,
    ...(options.onError ? { onError: options.onError } : {}),
  });
}

/** Resolve cron dir for diagnostics. */
export function cronDir(productHome: string): string {
  return path.join(productHome, "cron");
}
