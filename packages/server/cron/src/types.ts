/**
 * Host cron jobs — Hermes-inspired schedule + script/agent runs + delivery.
 */

export type CronSchedule =
  | { readonly kind: "every"; readonly everySeconds: number }
  | { readonly kind: "at"; readonly at: string }
  | { readonly kind: "cron"; readonly expr: string };

export type CronRun =
  | { readonly kind: "agent"; readonly prompt: string }
  | { readonly kind: "script"; readonly command: string; readonly cwd?: string };

export type CronDelivery =
  | { readonly kind: "none" }
  | { readonly kind: "webhook"; readonly url: string; readonly secretEnv?: string }
  | { readonly kind: "file"; readonly path: string };

export interface CronJob {
  readonly id: string;
  readonly name?: string;
  readonly enabled: boolean;
  readonly schedule: CronSchedule;
  readonly run: CronRun;
  readonly delivery: CronDelivery;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** ISO next fire time (UTC). */
  readonly nextRunAt: string | null;
  readonly lastRunAt?: string;
  readonly lastStatus?: "ok" | "error" | "skipped";
  readonly lastError?: string;
  readonly lastOutputChars?: number;
}

export interface CronJobCreateInput {
  readonly name?: string;
  readonly schedule: CronSchedule;
  readonly run: CronRun;
  readonly delivery?: CronDelivery;
  readonly enabled?: boolean;
}

export interface CronRunResult {
  readonly ok: boolean;
  readonly output: string;
  readonly sessionId?: string;
  readonly error?: string;
}

export interface CronAgentRunner {
  (job: CronJob, signal?: AbortSignal): Promise<CronRunResult>;
}

export interface CronScriptRunner {
  (job: CronJob, signal?: AbortSignal): Promise<CronRunResult>;
}

export interface CronDeliverer {
  (
    job: CronJob,
    result: CronRunResult,
    signal?: AbortSignal,
  ): Promise<void>;
}

export class CronError extends Error {
  readonly code: string;

  constructor(message: string, code = "CRON") {
    super(message);
    this.name = "CronError";
    this.code = code;
  }
}

export function isCronError(err: unknown): err is CronError {
  return err instanceof CronError;
}

export const MIN_EVERY_SECONDS = 60;
export const DEFAULT_TICK_MS = 30_000;
