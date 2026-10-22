/**
 * Shared monotonic work-slice budget for Host-side list assembly
 * (DSH session-list host fairness): yield only after elapsed work exceeds the
 * slice, never once per row, and never return a partial list on cancel.
 */

export const DEFAULT_LIST_WORK_SLICE_MS = 16;

export type ListWorkSlice = {
  /** Deadline (performance.now / Date.now ms) for the current slice. */
  deadline: number;
  readonly sliceMs: number;
  readonly now: () => number;
  readonly yieldFn: () => Promise<void>;
  readonly signal?: AbortSignal;
};

export function createListWorkSlice(input?: {
  readonly sliceMs?: number;
  readonly signal?: AbortSignal;
  readonly now?: () => number;
  readonly yieldFn?: () => Promise<void>;
}): ListWorkSlice {
  const sliceMs = Math.max(
    1,
    Math.floor(input?.sliceMs ?? DEFAULT_LIST_WORK_SLICE_MS),
  );
  const now = input?.now ?? (() => Date.now());
  const yieldFn =
    input?.yieldFn ??
    (() => new Promise<void>((resolve) => setImmediate(resolve)));
  return {
    deadline: now() + sliceMs,
    sliceMs,
    now,
    yieldFn,
    ...(input?.signal ? { signal: input.signal } : {}),
  };
}

export function throwIfListCancelled(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    const err = new Error("session.list cancelled");
    err.name = "AbortError";
    throw err;
  }
}

/**
 * After finishing one row: if the slice is exhausted, yield and rebuild the
 * deadline. Small lists that never exceed the slice do not yield.
 */
export async function maybeYieldListWork(slice: ListWorkSlice): Promise<void> {
  throwIfListCancelled(slice.signal);
  if (slice.now() < slice.deadline) return;
  await slice.yieldFn();
  throwIfListCancelled(slice.signal);
  slice.deadline = slice.now() + slice.sliceMs;
}
