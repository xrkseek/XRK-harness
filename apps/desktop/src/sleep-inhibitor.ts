/**
 * Prevent idle system sleep while an agent turn is running (Codex
 * `prevent_idle_sleep` / `PowerRequestSystemRequired` semantics).
 *
 * Electron `powerSaveBlocker` type `prevent-app-suspension` keeps the machine
 * awake without forcing the display to stay on — the screen may still blank.
 */

export type PowerSaveBlockerApi = {
  start(type: "prevent-app-suspension" | "prevent-display-sleep"): number;
  stop(id: number): boolean;
  isStarted(id: number): boolean;
};

export interface SleepInhibitorState {
  readonly enabled: boolean;
  readonly turnRunning: boolean;
  readonly blocking: boolean;
}

/**
 * Combines a Settings toggle with live "any session running" from the
 * renderer. Acquires / releases the OS power assertion as needed.
 */
export class DesktopSleepInhibitor {
  private enabled = false;
  private turnRunning = false;
  private blockerId: number | undefined;

  constructor(private readonly powerSaveBlocker: PowerSaveBlockerApi) {}

  /** Product default matches Codex: off until the user opts in. */
  setEnabled(enabled: boolean): SleepInhibitorState {
    this.enabled = enabled;
    this.sync();
    return this.snapshot();
  }

  setTurnRunning(turnRunning: boolean): SleepInhibitorState {
    this.turnRunning = turnRunning;
    this.sync();
    return this.snapshot();
  }

  snapshot(): SleepInhibitorState {
    return {
      enabled: this.enabled,
      turnRunning: this.turnRunning,
      blocking: this.blockerId !== undefined,
    };
  }

  /** Drop the assertion on quit so the OS can sleep again. */
  dispose(): void {
    this.turnRunning = false;
    this.release();
  }

  private sync(): void {
    if (this.enabled && this.turnRunning) this.acquire();
    else this.release();
  }

  private acquire(): void {
    if (this.blockerId !== undefined) {
      if (this.powerSaveBlocker.isStarted(this.blockerId)) return;
      this.blockerId = undefined;
    }
    try {
      this.blockerId = this.powerSaveBlocker.start("prevent-app-suspension");
    } catch (error) {
      console.error("[desktop] sleep inhibitor acquire failed", error);
      this.blockerId = undefined;
    }
  }

  private release(): void {
    if (this.blockerId === undefined) return;
    const id = this.blockerId;
    this.blockerId = undefined;
    try {
      if (this.powerSaveBlocker.isStarted(id)) {
        this.powerSaveBlocker.stop(id);
      }
    } catch (error) {
      console.error("[desktop] sleep inhibitor release failed", error);
    }
  }
}
