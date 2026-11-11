/**
 * Merge caller / timeout abort without throwing `AbortSignal.any is not a function`.
 * Node ≥26 LTS (and Chromium 116+) ship `AbortSignal.any`; an older runtime
 * gets a one-line requirement instead of a turn-time TypeError.
 */
export function combineAbortSignals(
  signals: readonly AbortSignal[],
): AbortSignal {
  const live = signals.filter((signal) => signal !== undefined);
  if (live.length === 0) {
    throw new Error("combineAbortSignals: no signals");
  }
  if (live.length === 1) return live[0]!;
  const AbortSignalWithAny = AbortSignal as typeof AbortSignal & {
    any?: (input: readonly AbortSignal[]) => AbortSignal;
  };
  if (typeof AbortSignalWithAny.any !== "function") {
    const version =
      typeof process !== "undefined" && process.versions?.node
        ? ` (Node ${process.versions.node})`
        : "";
    throw new Error(
      `AbortSignal.any is missing${version}; xrkh requires Node.js >= 26 LTS`,
    );
  }
  return AbortSignalWithAny.any(live);
}
