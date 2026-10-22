/**
 * Exclusive critical-path attribution for one turn interval (Codex-style).
 * Six WorkKind durations sum to the closed interval length; parallel branches
 * join on the releaser; depth overflow folds to Unknown without recursion.
 */

export type WorkKind =
  | "inference"
  | "auto_review"
  | "user_wait"
  | "tools"
  | "overhead"
  | "unknown";

export type PathDurations = Readonly<Record<WorkKind, number>>;

const KINDS: readonly WorkKind[] = [
  "inference",
  "auto_review",
  "user_wait",
  "tools",
  "overhead",
  "unknown",
] as const;

export const MAX_PATH_DEPTH = 16_384;

type Node = {
  readonly id: number;
  readonly kind: WorkKind;
  readonly startMs: number;
  readonly endMs: number;
  readonly prev: number | null;
  readonly depth: number;
};

let nextId = 1;

function emptyDurations(): Record<WorkKind, number> {
  return {
    inference: 0,
    auto_review: 0,
    user_wait: 0,
    tools: 0,
    overhead: 0,
    unknown: 0,
  };
}

/**
 * Immutable critical path tip. `work` appends an exclusive segment after the
 * previous tip (overlaps are clipped). `join` keeps the later tip while
 * retaining shared causal prefix via tip identity.
 */
export class CriticalPath {
  private readonly nodes = new Map<number, Node>();
  private tip: number | null = null;

  work(kind: WorkKind, startMs: number, endMs: number): void {
    if (!(endMs > startMs)) return;
    let start = startMs;
    let depth = 0;
    let prev: number | null = null;
    if (this.tip !== null) {
      const prior = this.nodes.get(this.tip)!;
      start = Math.max(start, prior.endMs);
      if (!(endMs > start)) return;
      prev = this.tip;
      depth = prior.depth + 1;
    }
    if (depth >= MAX_PATH_DEPTH) {
      kind = "unknown";
    }
    const id = nextId++;
    this.nodes.set(id, { id, kind, startMs: start, endMs, prev, depth });
    this.tip = id;
  }

  /** Keep the tip that finishes later (the one that released the waiter). */
  join(other: CriticalPath): void {
    const a = this.tip === null ? null : this.nodes.get(this.tip)!;
    const b = other.tip === null ? null : other.nodes.get(other.tip)!;
    if (b === null) return;
    if (a === null || b.endMs >= a.endMs) {
      for (const [id, node] of other.nodes) this.nodes.set(id, node);
      this.tip = other.tip;
    }
  }

  durations(intervalStartMs: number, intervalEndMs: number): PathDurations {
    const out = emptyDurations();
    if (!(intervalEndMs > intervalStartMs)) return out;
    const covered: Array<{ start: number; end: number; kind: WorkKind }> = [];
    let cursor = this.tip;
    while (cursor !== null) {
      const node = this.nodes.get(cursor);
      if (node === undefined) break;
      const start = Math.max(node.startMs, intervalStartMs);
      const end = Math.min(node.endMs, intervalEndMs);
      if (end > start) covered.push({ start, end, kind: node.kind });
      cursor = node.prev;
    }
    covered.sort((x, y) => x.start - y.start);
    let t = intervalStartMs;
    for (const seg of covered) {
      if (seg.start > t) out.overhead += seg.start - t;
      if (seg.end > t) {
        const from = Math.max(seg.start, t);
        out[seg.kind] += seg.end - from;
        t = Math.max(t, seg.end);
      }
    }
    if (intervalEndMs > t) out.overhead += intervalEndMs - t;
    return out;
  }
}

export function sumDurations(d: PathDurations): number {
  let total = 0;
  for (const kind of KINDS) total += d[kind];
  return total;
}
