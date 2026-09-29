/**
 * Schedule Desktop Host bring-up without blocking first paint (VS Code / Chrome).
 * Main paints splash on `xrk-app://`; IPC `ready` (with loopback `origin`) then
 * lets main `loadURL` the Host Face (DSH posture — no Face framed pipes).
 *
 * Also owns the main-process ready flag that preload `whenHostReady` awaits so
 * Face connect does not burn into retry:backoff before the origin is live.
 *
 * Host attach phases (`starting` → `attaching` → `ready`) drive splash hints
 * so "Starting Host…" is not one sticky label for the whole spawn+wire wait.
 */

import type { DesktopHostProcess } from "./host-process.js";

/** Splash / Face gate stages for Desktop Host bring-up (IPC wire contract). */
export type DesktopHostPhase = "starting" | "attaching" | "ready";

/**
 * Start Host in the background; call `attach` once the child reports ready.
 * Does not await — callers return so Electron can create/show the window.
 *
 * Phase order for splash: `starting` at schedule → `attaching` on child spawn
 * (via `hooks.onSpawned`) → `ready` when main `loadURL`s the loopback origin.
 *
 * When {@link ScheduleDesktopHostFetchAttachOptions.restartMaxAttempts} > 0,
 * an unexpected Host exit clears the ready gate (`detach`) and reschedules
 * bring-up (opening PTY must not leave the shell on a dead carrier).
 */
export interface ScheduleDesktopHostFetchAttachOptions {
  readonly start: (hooks: {
    readonly onSpawned: () => void;
  }) => Promise<DesktopHostProcess | undefined>;
  readonly attach: (host: DesktopHostProcess) => void;
  /** Clear UI gate / host handle before a restart attempt. */
  readonly detach?: () => void;
  /** Optional phase push: `starting` at schedule, `attaching` when child is up. */
  readonly onPhase?: (phase: Exclude<DesktopHostPhase, "ready">) => void;
  /** Host start returned undefined or threw — notify splash / dialogs. */
  readonly onFailed?: (error: Error) => void;
  /**
   * Unexpected Host exit retries. `0` (default) = no auto-restart.
   * Intentional {@link DesktopHostProcess.stop} never restarts.
   */
  readonly restartMaxAttempts?: number;
  readonly restartDelayMs?: number;
  /** Skip restart while the app is quitting. */
  readonly shouldAbortRestart?: () => boolean;
}

export function scheduleDesktopHostFetchAttach(
  options: ScheduleDesktopHostFetchAttachOptions,
): void {
  const maxAttempts = options.restartMaxAttempts ?? 0;
  const delayMs = options.restartDelayMs ?? 750;
  let crashAttempts = 0;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;

  const run = (): void => {
    options.onPhase?.("starting");
    void options
      .start({
        onSpawned: () => {
          options.onPhase?.("attaching");
        },
      })
      .then((host) => {
        if (host === undefined) {
          options.onFailed?.(new Error("Desktop Host failed to start"));
          return;
        }
        options.attach(host);
        if (maxAttempts <= 0) return;
        if (stableTimer !== undefined) clearTimeout(stableTimer);
        // A Host that stays up briefly resets the crash budget.
        stableTimer = setTimeout(() => {
          crashAttempts = 0;
        }, 30_000);
        void host.waitForExit().then(() => {
          if (stableTimer !== undefined) {
            clearTimeout(stableTimer);
            stableTimer = undefined;
          }
          if (host.stopWasRequested) return;
          if (options.shouldAbortRestart?.()) return;
          options.detach?.();
          resetDesktopHostFetchReady();
          crashAttempts += 1;
          if (crashAttempts > maxAttempts) {
            options.onFailed?.(
              new Error(
                `Desktop Host exited repeatedly after ${String(maxAttempts)} restart attempts`,
              ),
            );
            return;
          }
          setTimeout(run, delayMs);
        });
      })
      .catch((error: unknown) => {
        options.onFailed?.(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  };

  run();
}

// ---- Renderer gate (preload whenHostReady) ----

export type DesktopHostReadyBroadcaster = {
  send(channel: string, ...args: unknown[]): void;
};

let hostFetchReady = false;
/** `idle` lets the next `starting` re-broadcast after a crash restart. */
type DesktopHostPhaseState = DesktopHostPhase | "idle";
let hostPhase: DesktopHostPhaseState = "idle";

const PHASE_ORDER: Record<DesktopHostPhaseState, number> = {
  idle: -1,
  starting: 0,
  attaching: 1,
  ready: 2,
};

/** Reset between tests (or before a new main session / will-quit / restart). */
export function resetDesktopHostFetchReady(): void {
  hostFetchReady = false;
  hostPhase = "idle";
}

/** True after Host loopback origin is live and renderers may connect Face. */
export function isDesktopHostFetchReady(): boolean {
  return hostFetchReady;
}

/** Current Host bring-up phase (splash hints). */
export function getDesktopHostPhase(): DesktopHostPhase {
  return hostPhase === "idle" ? "starting" : hostPhase;
}

/**
 * Advance Host phase and notify renderers (forward-only).
 * Idempotent for equal phase; ignores regressions.
 */
export function publishDesktopHostPhase(
  phase: DesktopHostPhase,
  channel: string,
  windows: readonly DesktopHostReadyBroadcaster[],
): void {
  if (PHASE_ORDER[phase] < PHASE_ORDER[hostPhase]) return;
  if (hostPhase === phase) return;
  hostPhase = phase;
  for (const win of windows) {
    try {
      win.send(channel, phase);
    } catch {
      /* destroyed window */
    }
  }
}

/**
 * Mark Host origin ready and notify every renderer (preload may be waiting).
 * Always advances phase to `ready` on `phaseChannel`, then pulses `readyChannel`.
 * Idempotent: second call does not re-broadcast.
 */
export function markDesktopHostFetchReady(
  readyChannel: string,
  phaseChannel: string,
  windows: readonly DesktopHostReadyBroadcaster[],
): void {
  if (hostFetchReady) return;
  hostFetchReady = true;
  publishDesktopHostPhase("ready", phaseChannel, windows);
  for (const win of windows) {
    try {
      win.send(readyChannel);
    } catch {
      /* destroyed window */
    }
  }
}

/**
 * Notify renderers that Host bring-up failed so splash can fail loud
 * instead of sticking on "Starting Host…".
 */
export function publishDesktopHostFailed(
  channel: string,
  windows: readonly DesktopHostReadyBroadcaster[],
  message: string,
): void {
  for (const win of windows) {
    try {
      win.send(channel, message);
    } catch {
      /* destroyed window */
    }
  }
}
