/**
 * Schedule Desktop Host bring-up without blocking first paint (VS Code / Chrome).
 * Main keeps the product on `xrk-app://` (one React splash); IPC `ready`
 * (loopback `origin`) wires Host Fetch into the custom protocol — no
 * `loadURL` remount onto loopback (seamless Host → plugin boot).
 *
 * Also owns the main-process ready flag that preload `whenHostReady` awaits so
 * Face connect does not burn into retry:backoff before the origin is live.
 *
 * Host attach phases (`starting` → `attaching` → `ready`) drive splash hints
 * so "Starting Host…" is not one sticky label for the whole spawn+wire wait.
 */

import {
  formatDesktopHostDeathMessage,
  type DesktopHostProcess,
} from "./host-process.js";

/** Splash / Face gate stages for Desktop Host bring-up (IPC wire contract). */
export type DesktopHostPhase = "starting" | "attaching" | "ready";

/**
 * Start Host in the background; call `attach` once the child reports ready.
 * Does not await — callers return so Electron can create/show the window.
 *
 * Phase order for splash: `starting` at schedule → `attaching` on child spawn
 * (via `hooks.onSpawned`) → `ready` when main wires Host Fetch + marks ready.
 *
 * When {@link ScheduleDesktopHostFetchAttachOptions.restartMaxAttempts} > 0,
 * an unexpected Host exit clears the ready gate (`detach`) and reschedules
 * bring-up (opening PTY must not leave the shell on a dead carrier).
 */
export interface ScheduleDesktopHostFetchAttachOptions {
  readonly start: (hooks: {
    readonly onSpawned: () => void;
    /** 0 = cold first attempt; ≥1 = auto-restart / rebring attempt. */
    readonly attempt: number;
  }) => Promise<DesktopHostProcess | undefined>;
  readonly attach: (host: DesktopHostProcess) => void;
  /** Clear UI gate / host handle before a restart attempt. */
  readonly detach?: () => void;
  /** Optional phase push: `starting` at schedule, `attaching` when child is up. */
  readonly onPhase?: (phase: Exclude<DesktopHostPhase, "ready">) => void;
  /** Host give-up (budget exhausted or non-restartable) — notify splash / dialogs. */
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

/** Handle so main can manually rebring after budget exhaustion. */
export interface DesktopHostBringUpHandle {
  /** Clear sticky failure + crash budget and start a fresh bring-up. */
  rebring(): void;
}

export function scheduleDesktopHostFetchAttach(
  options: ScheduleDesktopHostFetchAttachOptions,
): DesktopHostBringUpHandle {
  const maxAttempts = options.restartMaxAttempts ?? 0;
  const delayMs = options.restartDelayMs ?? 750;
  let crashAttempts = 0;
  /** Counts start() invocations so cold vs restart timeouts can differ. */
  let startGeneration = 0;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;
  let restartTimer: ReturnType<typeof setTimeout> | undefined;
  let currentHost: DesktopHostProcess | undefined;
  let generation = 0;

  const clearTimers = (): void => {
    if (stableTimer !== undefined) {
      clearTimeout(stableTimer);
      stableTimer = undefined;
    }
    if (restartTimer !== undefined) {
      clearTimeout(restartTimer);
      restartTimer = undefined;
    }
  };

  const failOut = (error: Error): void => {
    clearTimers();
    options.onFailed?.(error);
  };

  const queueRestart = (error?: Error): void => {
    if (options.shouldAbortRestart?.()) return;
    if (maxAttempts <= 0) {
      failOut(error ?? new Error("Desktop Host failed to start"));
      return;
    }
    crashAttempts += 1;
    if (crashAttempts > maxAttempts) {
      failOut(
        error ??
          new Error(
            `Desktop Host exited repeatedly after ${String(maxAttempts)} restart attempts`,
          ),
      );
      return;
    }
    if (error !== undefined) {
      console.error(error);
    }
    restartTimer = setTimeout(() => {
      restartTimer = undefined;
      run();
    }, delayMs);
  };

  const watchExit = (host: DesktopHostProcess, gen: number): void => {
    if (maxAttempts <= 0) return;
    if (stableTimer !== undefined) clearTimeout(stableTimer);
    stableTimer = setTimeout(() => {
      crashAttempts = 0;
    }, 30_000);
    void host.waitForExit().then(() => {
      if (gen !== generation) return;
      if (stableTimer !== undefined) {
        clearTimeout(stableTimer);
        stableTimer = undefined;
      }
      if (host.stopWasRequested) return;
      if (options.shouldAbortRestart?.()) return;
      options.detach?.();
      resetDesktopHostFetchReady();
      currentHost = undefined;
      const death = host.lastDeath;
      const detail =
        death !== undefined
          ? formatDesktopHostDeathMessage(death)
          : "Desktop Host exited";
      queueRestart(new Error(detail));
    });
  };

  const run = (): void => {
    const gen = ++generation;
    clearLastHostFailure();
    options.onPhase?.("starting");
    const attempt = startGeneration;
    startGeneration += 1;
    void options
      .start({
        attempt,
        onSpawned: () => {
          if (gen !== generation) return;
          options.onPhase?.("attaching");
        },
      })
      .then((host) => {
        if (gen !== generation) {
          if (host !== undefined && !host.stopWasRequested) {
            void host.stop().catch(() => undefined);
          }
          return;
        }
        if (host === undefined) {
          queueRestart(new Error("Desktop Host failed to start"));
          return;
        }
        currentHost = host;
        options.attach(host);
        if (host.faceOrigin === undefined) {
          void host.stop().catch(() => undefined);
          options.detach?.();
          resetDesktopHostFetchReady();
          currentHost = undefined;
          queueRestart(
            new Error("Desktop Host ready without loopback origin"),
          );
          return;
        }
        watchExit(host, gen);
      })
      .catch((error: unknown) => {
        if (gen !== generation) return;
        currentHost = undefined;
        queueRestart(
          error instanceof Error ? error : new Error(String(error)),
        );
      });
  };

  run();

  return {
    rebring(): void {
      if (options.shouldAbortRestart?.()) return;
      // Healthy Host + no sticky failure: Face reconnect must not tear Host down.
      if (hostFetchReady && lastHostFailure === undefined) return;
      generation += 1;
      clearTimers();
      crashAttempts = 0;
      startGeneration = 1;
      clearLastHostFailure();
      const previous = currentHost;
      currentHost = undefined;
      options.detach?.();
      resetDesktopHostFetchReady();
      if (previous !== undefined && !previous.stopWasRequested) {
        void previous.stop().catch(() => undefined);
      }
      run();
    },
  };
}

// ---- Renderer gate (preload whenHostReady) ----

export type DesktopHostReadyBroadcaster = {
  send(channel: string, ...args: unknown[]): void;
};

let hostFetchReady = false;
/** Sticky failure for `hostFailedGet` after a one-shot `hostFailed` push. */
let lastHostFailure: string | undefined;
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

/** Clear sticky Host failure (new starting / mark ready / rebring). */
export function clearLastHostFailure(): void {
  lastHostFailure = undefined;
}

/** Sticky failure message for preload `hostFailedGet` (or undefined). */
export function getLastHostFailure(): string | undefined {
  return lastHostFailure;
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
  lastHostFailure = undefined;
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
 * Stores sticky text so later `whenHostReady` calls still reject.
 */
export function publishDesktopHostFailed(
  channel: string,
  windows: readonly DesktopHostReadyBroadcaster[],
  message: string,
): void {
  lastHostFailure = message;
  for (const win of windows) {
    try {
      win.send(channel, message);
    } catch {
      /* destroyed window */
    }
  }
}
