/**
 * Per-event stream idle watchdog (Codex `process_sse_with_treatment`).
 *
 * A provider body that goes quiet is the one failure that raises nothing: the
 * socket stays open, no event arrives, and neither `timeoutMs` — which the
 * registry path never wires — nor the retry loop ever gets to see it, so the
 * turn simply waits. Codex bounds the gap between *events* rather than the
 * whole request, and each delivered event restarts the clock, so a slow but
 * alive model is never killed. We do the same, per event, with an internal
 * default so an adapter that never passes `idleTimeoutMs` still fails instead
 * of waiting forever.
 *
 * Reference:
 * - `codex-rs/model-provider-info/src/lib.rs:63` — `DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000`
 * - `codex-rs/model-provider-info/src/lib.rs:505-509` — per-provider `stream_idle_timeout_ms` override
 * - `codex-rs/codex-api/src/sse/responses.rs:532-568` — `biased` select: a closed consumer wins over the timeout arm
 */
import { LlmError } from "./failure.js";

/**
 * Default per-event idle budget for a provider stream: 5 minutes. Long enough
 * that a slow-but-streaming model never trips it, short enough that a dead
 * turn ends in minutes instead of never.
 */
export const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 300_000;

/**
 * Codex `stream_idle_timeout_ms().unwrap_or(DEFAULT_STREAM_IDLE_TIMEOUT_MS)`
 * — the default is internal, so a missing option means "5 minutes", never
 * "no watchdog". A non-positive or infinite value takes the same branch.
 */
export function resolveStreamIdleTimeoutMs(idleTimeoutMs?: number): number {
  return idleTimeoutMs !== undefined &&
    Number.isFinite(idleTimeoutMs) &&
    idleTimeoutMs > 0
    ? idleTimeoutMs
    : DEFAULT_STREAM_IDLE_TIMEOUT_MS;
}

export interface StreamIdleWatchdogOptions {
  /** Per-event idle budget; omit for {@link DEFAULT_STREAM_IDLE_TIMEOUT_MS}. */
  readonly idleTimeoutMs?: number;
  /** Adapter id — becomes the error message prefix. */
  readonly label: string;
  /**
   * Caller abort. Ends the stream normally — a cancel is control flow, never
   * a timeout, so it must not surface as `TIMEOUT`.
   */
  readonly signal?: AbortSignal;
  /**
   * Called once, just before the `TIMEOUT` is raised. Adapters pass a
   * controller that aborts the in-flight request: the body read the watchdog
   * just gave up on is still parked on that socket, and nothing else will ever
   * close it.
   */
  readonly onIdleTimeout?: () => void;
}

type NextOutcome<T> =
  | { readonly kind: "event"; readonly result: IteratorResult<T> }
  | { readonly kind: "error"; readonly err: unknown }
  | { readonly kind: "timeout" }
  | { readonly kind: "aborted" };

/**
 * Wrap a provider stream so a silence longer than the idle budget throws
 * `TIMEOUT` (retryable — it is not in the non-retryable blacklist) instead of
 * hanging the turn forever. Abort and completion both end the generator
 * normally.
 */
export function withStreamIdleTimeout<T>(
  source: AsyncIterable<T>,
  options: StreamIdleWatchdogOptions,
): AsyncGenerator<T> {
  const idleTimeoutMs = resolveStreamIdleTimeoutMs(options.idleTimeoutMs);
  const { label, signal, onIdleTimeout } = options;
  return (async function* idleWatchdog(): AsyncGenerator<T> {
    const iterator = source[Symbol.asyncIterator]();
    // The single live timer, owned by whichever `next()` is in flight. Node
    // keeps a referenced `setTimeout` on the event loop for its full budget,
    // so one left armed after the consumer walked away pins the Electron main
    // process open for minutes.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clearTimer = (): void => {
      if (timer === undefined) return;
      clearTimeout(timer);
      timer = undefined;
    };
    // True when a `next()` was abandoned mid-flight: on the timeout / abort
    // arms the source is parked inside its own `await`, and awaiting its
    // `return()` there would block behind the very socket we just left.
    let parked = false;

    const raceNext = (
      pending: Promise<IteratorResult<T>>,
    ): Promise<NextOutcome<T>> =>
      new Promise<NextOutcome<T>>((resolve) => {
        function onAbort(): void {
          settle({ kind: "aborted" });
        }
        function settle(outcome: NextOutcome<T>): void {
          clearTimer();
          signal?.removeEventListener("abort", onAbort);
          resolve(outcome);
        }
        timer = setTimeout(() => settle({ kind: "timeout" }), idleTimeoutMs);
        if (signal) {
          if (signal.aborted) {
            onAbort();
            return;
          }
          signal.addEventListener("abort", onAbort, { once: true });
        }
        pending.then(
          (result) => settle({ kind: "event", result }),
          // Not `reject`: the source's own failure must reach the adapter's
          // classifier untouched (a bare undici TypeError carries no code), and
          // a rejection reason is not required to be an Error here.
          (err: unknown) => settle({ kind: "error", err }),
        );
      });

    try {
      while (true) {
        if (signal?.aborted) return;
        parked = false;
        const pending = iterator.next();
        // The timeout / abort arms walk away from `pending`; whatever it does
        // next (usually the rejection the abort we just issued causes) must
        // not surface as an unhandled rejection.
        pending.catch(() => {});
        const outcome = await raceNext(pending);
        if (outcome.kind === "aborted") {
          parked = true;
          return;
        }
        if (outcome.kind === "timeout") {
          parked = true;
          onIdleTimeout?.();
          throw new LlmError(
            `${label}: idle timeout waiting for stream`,
            "TIMEOUT",
          );
        }
        if (outcome.kind === "error") {
          // The source failed on its own terms; rethrow it verbatim (a bare
          // undici TypeError must reach the adapter's classifier unrewritten)
          // and do not wait on `return()` for an iterator we no longer trust —
          // exactly the abandoned-read situation the timeout arm avoids.
          parked = true;
          throw outcome.err;
        }
        if (outcome.result.done) return;
        // Every event restarts the budget: the timer was cleared above and the
        // next loop iteration arms a fresh one.
        yield outcome.result.value;
      }
    } finally {
      clearTimer();
      if (!parked) await iterator.return?.();
    }
  })();
}

/**
 * Fold a watchdog-owned signal into a request without touching the caller's.
 * The idle watchdog aborts it to close the body read it gave up on; the
 * caller's own signal keeps driving cancellation.
 */
export function withExtraAbortSignal<T extends { readonly signal?: AbortSignal }>(
  request: T,
  extra: AbortSignal,
): T {
  return {
    ...request,
    signal: request.signal
      ? AbortSignal.any([request.signal, extra])
      : extra,
  };
}
