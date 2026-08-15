/**
 * higher-seq-wins projection store (essence from DeepSeek ProjectionValueStore).
 * Host computes; client only stores finished values.
 */

export interface ProjectionRow<T = unknown> {
  readonly value: T;
  readonly seq: number;
}

export interface ProjectionsBaseline {
  readonly asOfSeq: number;
  readonly values: Readonly<Record<string, unknown>>;
}

export class ProjectionStore {
  private readonly rows = new Map<string, ProjectionRow>();
  private readonly listeners = new Set<() => void>();

  get(key: string): unknown {
    return this.rows.get(key)?.value;
  }

  getRow(key: string): ProjectionRow | undefined {
    return this.rows.get(key);
  }

  /** Apply one push. Lower-or-equal seq is dropped. */
  apply(key: string, value: unknown, seq: number): boolean {
    const row = this.rows.get(key);
    if (row !== undefined && seq <= row.seq) return false;
    this.rows.set(key, { value, seq });
    this.emit();
    return true;
  }

  /**
   * Seed from history tail baseline. Keys omitted in baseline clear rows
   * whose seq is not newer than asOfSeq.
   */
  seed(baseline: ProjectionsBaseline): void {
    for (const [key, value] of Object.entries(baseline.values)) {
      this.apply(key, value, baseline.asOfSeq);
    }
    for (const [key, row] of [...this.rows]) {
      if (Object.hasOwn(baseline.values, key)) continue;
      if (row.seq > baseline.asOfSeq) continue;
      this.rows.delete(key);
      this.emit();
    }
  }

  /** Drop every row (new session / hard reset). */
  clear(): void {
    if (this.rows.size === 0) return;
    this.rows.clear();
    this.emit();
  }

  /** Drop rows claiming knowledge beyond durable lastSeq (reconnect). */
  truncate(lastSeq: number): void {
    let changed = false;
    for (const [key, row] of [...this.rows]) {
      if (row.seq <= lastSeq) continue;
      this.rows.delete(key);
      changed = true;
    }
    if (changed) this.emit();
  }

  entries(): readonly [string, ProjectionRow][] {
    return [...this.rows.entries()];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    for (const l of this.listeners) l();
  }
}
