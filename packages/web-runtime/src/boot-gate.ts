/**
 * Boot settle gate (essence from DeepSeek AppWebEntry + AppRoot).
 * Framework-free: no Cordis.
 */

export type BootEntryState = "loading" | "active" | "failed" | "pending";

export type BootGatePhase = "booting" | "settled" | "failed";

export interface BootGateSnapshot {
  readonly phase: BootGatePhase;
  readonly status: Readonly<Record<string, BootEntryState>>;
  readonly report?: string;
}

export class BootGate {
  private readonly status = new Map<string, BootEntryState>();
  private phase: BootGatePhase = "booting";
  private report: string | undefined;
  private readonly listeners = new Set<() => void>();

  register(id: string, state: BootEntryState = "loading"): void {
    if (this.phase !== "booting") return;
    this.status.set(id, state);
    this.emit();
    this.trySettle();
  }

  mark(id: string, state: BootEntryState): void {
    if (this.phase !== "booting") return;
    this.status.set(id, state);
    this.emit();
    this.trySettle();
  }

  /** Explicit fail-loud (sweep report). */
  fail(report: string): void {
    this.phase = "failed";
    this.report = report;
    this.emit();
  }

  getSnapshot(): BootGateSnapshot {
    return {
      phase: this.phase,
      status: Object.fromEntries(this.status),
      ...(this.report !== undefined ? { report: this.report } : {}),
    };
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private trySettle(): void {
    if (this.phase !== "booting" || this.status.size === 0) return;
    for (const state of this.status.values()) {
      if (state === "failed") {
        this.phase = "failed";
        this.report =
          this.report ??
          `boot failed: ${[...this.status.entries()]
            .filter(([, s]) => s === "failed")
            .map(([id]) => id)
            .join(", ")}`;
        this.emit();
        return;
      }
      if (state !== "active") return;
    }
    this.phase = "settled";
    this.emit();
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
