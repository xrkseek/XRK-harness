/**
 * Join a session drain until idle, with Host `drain.run` and poll paths
 * sharing one timeout / abort race. Ending the wait never cancels the
 * target session — callers that need cancel must do it explicitly.
 */
import type { FaceRuntime } from "./context.js";

export const SESSION_DRAIN_WAIT_MS = 10 * 60 * 1000;
export const SESSION_DRAIN_POLL_MS = 50;

export type WaitSessionDrainIdleOptions = {
  readonly signal?: AbortSignal;
  /** Default {@link SESSION_DRAIN_WAIT_MS}. */
  readonly timeoutMs?: number;
  /**
   * Timeout Error prefix: `${kind} timed out waiting for session ${id}`.
   * Default `"session"`.
   */
  readonly kind?: string;
  /** Optional AbortError message formatter (Face cancel causes → readable). */
  readonly formatAbortReason?: (reason: unknown) => string;
};

/**
 * Short join used by multi-target / peer poll loops: race `drain.run` against
 * a slice budget (and optional abort). Settling or slice expiry returns;
 * AbortError always propagates. Never cancels the target session.
 */
export async function raceDrainRunSlice(input: {
  readonly run: () => Promise<unknown>;
  readonly sliceMs: number;
  readonly signal?: AbortSignal;
}): Promise<void> {
  const sliceMs = Math.max(1, Math.floor(input.sliceMs));
  const formatAbort = defaultFormatAbortReason;
  if (input.signal?.aborted) {
    throw abortError(input.signal.reason, formatAbort);
  }
  let sliceTimer: ReturnType<typeof setTimeout> | undefined;
  const slice = new Promise<void>((resolve) => {
    sliceTimer = setTimeout(resolve, sliceMs);
  });
  let onAbort: (() => void) | undefined;
  const abortWait =
    input.signal === undefined
      ? undefined
      : new Promise<never>((_, reject) => {
          onAbort = () => {
            reject(abortError(input.signal!.reason, formatAbort));
          };
          input.signal!.addEventListener("abort", onAbort, { once: true });
        });
  try {
    await Promise.race([
      input.run().then(() => undefined),
      slice,
      ...(abortWait ? [abortWait] : []),
    ]);
  } finally {
    if (sliceTimer !== undefined) clearTimeout(sliceTimer);
    if (onAbort && input.signal) {
      input.signal.removeEventListener("abort", onAbort);
    }
  }
}

export async function waitSessionDrainIdle(
  runtime: Pick<FaceRuntime, "drain">,
  sessionId: string,
  options?: WaitSessionDrainIdleOptions,
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? SESSION_DRAIN_WAIT_MS;
  const kind = options?.kind?.trim() || "session";
  const formatAbort =
    options?.formatAbortReason ?? defaultFormatAbortReason;
  const run = runtime.drain.run?.bind(runtime.drain);
  const work = run
    ? abortable(run(sessionId), options?.signal, formatAbort)
    : (async () => {
        while (runtime.drain.isActive(sessionId)) {
          if (options?.signal?.aborted) {
            throw abortError(options.signal.reason, formatAbort);
          }
          await new Promise((r) => setTimeout(r, SESSION_DRAIN_POLL_MS));
        }
      })();
  await raceDeadline(work, timeoutMs, sessionId, kind);
}

function raceDeadline<T>(
  promise: Promise<T>,
  timeoutMs: number,
  sessionId: string,
  kind: string,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(
          new Error(`${kind} timed out waiting for session ${sessionId}`),
        ),
      timeoutMs,
    );
  });
  return Promise.race([
    promise.finally(() => {
      if (timer !== undefined) clearTimeout(timer);
    }),
    timedOut,
  ]);
}

function abortable<T>(
  promise: Promise<T>,
  signal: AbortSignal | undefined,
  formatAbort: (reason: unknown) => string,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) {
    return Promise.reject(abortError(signal.reason, formatAbort));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      reject(abortError(signal.reason, formatAbort));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

function abortError(
  reason: unknown,
  formatAbort: (reason: unknown) => string,
): Error {
  const err = new Error(formatAbort(reason));
  err.name = "AbortError";
  return err;
}

function defaultFormatAbortReason(reason: unknown): string {
  if (reason === undefined || reason === null) return "aborted";
  if (reason instanceof Error) {
    const message = reason.message.trim();
    return message.length > 0 ? message : reason.name || "aborted";
  }
  if (reason !== null && typeof reason === "object" && "kind" in reason) {
    const kind = (reason as { kind?: unknown }).kind;
    if (kind === "user") return "aborted by user";
    if (kind === "parent") return "aborted by parent";
    if (kind === "disposed") return "aborted: session disposed";
    if (kind === "legacy") return "aborted";
    if (kind === "hook") {
      const hookReason = (reason as { reason?: unknown }).reason;
      if (typeof hookReason === "string") {
        return `aborted by hook: ${hookReason}`;
      }
    }
  }
  if (typeof reason === "string") {
    const trimmed = reason.trim();
    return trimmed.length > 0 ? trimmed : "aborted";
  }
  try {
    const json = JSON.stringify(reason);
    if (typeof json === "string" && json.length > 0 && json !== "{}") {
      return json;
    }
  } catch {
    /* ignore */
  }
  return "aborted";
}
