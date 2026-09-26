/**
 * Ordinary Desktop update feed polling (ADR-0008).
 * Pattern from dsh `update-schedule.ts` — backoff + jitter; coordinator owns network work.
 */

import type { DesktopUpdateCoordinator } from "./update-coordinator.js";
import type { DesktopUpdateState } from "./ipc.js";

/** Validated polling delays; maxBackoffMs caps the final randomized delay. */
export interface DesktopUpdateScheduleConfig {
  readonly intervalMs: number;
  readonly maxBackoffMs: number;
  readonly jitter: number;
}

/**
 * Resolve ordinary-update polling settings.
 * Defaults: 10 min interval · 1 h max backoff · 20% jitter.
 */
export function resolveDesktopUpdateScheduleConfig(
  env: NodeJS.ProcessEnv = process.env,
): DesktopUpdateScheduleConfig {
  function duration(name: string, fallback: number): number {
    const value = Number(env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1_000 || value > 2_147_483_647) {
      throw new Error(
        `xrk desktop update: ${name} must be an integer from 1000 through 2147483647`,
      );
    }
    return value;
  }
  const intervalMs = duration(
    "XRK_DESKTOP_UPDATE_CHECK_INTERVAL_MS",
    600_000,
  );
  const maxBackoffMs = duration(
    "XRK_DESKTOP_UPDATE_CHECK_MAX_BACKOFF_MS",
    Math.max(intervalMs, 3_600_000),
  );
  const jitter = Number(env.XRK_DESKTOP_UPDATE_CHECK_JITTER ?? 0.2);
  if (
    !Number.isFinite(jitter) ||
    jitter < 0 ||
    jitter > 1 ||
    maxBackoffMs < intervalMs
  ) {
    throw new Error(
      "xrk desktop update: check jitter must be in [0, 1] and max backoff must cover the check interval",
    );
  }
  return { intervalMs, maxBackoffMs, jitter };
}

/** One completion-based deadline shared by periodic and explicit checks. */
export class DesktopUpdateSchedule {
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pending: Promise<DesktopUpdateState> | undefined;
  private activeChecks = 0;
  private disposed = false;
  private nextCheck = -Infinity;
  private delay: number;

  constructor(
    private readonly updates: Pick<DesktopUpdateCoordinator, "check" | "state">,
    private readonly config: DesktopUpdateScheduleConfig,
    private readonly random: () => number = Math.random,
    private readonly now: () => number = () => performance.now(),
  ) {
    this.delay = config.intervalMs;
  }

  /**
   * Start immediately when due; explicit requests bypass the deadline and share in-flight work.
   * @param manual - Whether a failure should stay visible (passed through to coordinator).
   * @param force - Bypass the automatic deadline (menu / resume).
   */
  async check(
    manual = false,
    force = manual,
  ): Promise<DesktopUpdateState> {
    if (this.disposed) {
      throw new Error("xrk desktop update: polling is disposed");
    }
    if (this.pending !== undefined && !manual) return this.pending;
    if (!force && this.now() < this.nextCheck) return this.updates.state;
    clearTimeout(this.timer);
    this.timer = undefined;
    this.activeChecks += 1;
    this.pending = Promise.resolve()
      .then(() => {
        if (this.disposed) {
          throw new Error("xrk desktop update: polling is disposed");
        }
        return this.updates.check(manual);
      })
      .then(
        (state) => {
          this.complete(state.phase === "error");
          return state;
        },
        (error: unknown) => {
          this.complete(true);
          throw error;
        },
      );
    return this.pending;
  }

  /** Stop timers; coordinator owns pending network teardown. */
  dispose(): void {
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = undefined;
  }

  private complete(failed: boolean): void {
    if (--this.activeChecks !== 0) return;
    this.pending = undefined;
    this.schedule(failed);
  }

  private schedule(failed: boolean): void {
    if (this.disposed) return;
    const { intervalMs, maxBackoffMs, jitter } = this.config;
    this.delay = failed
      ? Math.min(maxBackoffMs, this.delay * 2)
      : intervalMs;
    const lower = Math.max(1_000, this.delay * (1 - jitter));
    const upper = Math.min(maxBackoffMs, this.delay * (1 + jitter));
    const delay = Math.round(lower + (upper - lower) * this.random());
    this.nextCheck = this.now() + delay;
    this.timer = setTimeout(() => {
      void this.check(false, true).catch((error: unknown) => {
        console.error(error);
      });
    }, delay);
  }
}
