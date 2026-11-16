/**
 * Cross-turn leading-system anchor for `systemPromptUpdate: 'in-history'`.
 *
 * DSH keeps system as session surface nodes so message 0 stays byte-stable across
 * turns; a rewrite of an unchanged (or merely appended) prompt was measured at
 * ~0.16% cache hit vs ~99.9% on adjacent steps
 * (`2026-10-22-series-start-unchanged-prompt-prefix`).
 *
 * XRK places system on the wire each request. Without a process-local anchor,
 * every new turn puts the *current* effective prompt at message 0 — so a mid-
 * session persona / workspaceBlocks change (tool_search expand guidance, slash
 * recipe, …) rewrites the head and misses the entire conversation prefix.
 *
 * Anchor is process-local (provider cache is too). Route/model change clears it.
 * Face must call `breakSeriesBaseline` / `forgetSessionProcessCaches` on session
 * delete and log cut — not on resident LRU eviction (session may remount).
 */

import type { LlmAdapter } from "@xrkseek/llm";

export type SeriesBaselineAnchor = {
  readonly baseline: string;
  readonly routeKey: string;
};

const anchors = new Map<string, SeriesBaselineAnchor>();

/** Test / dispose helper — clears one session or the whole table. */
export function clearSeriesBaselineAnchors(sessionId?: string): void {
  if (sessionId === undefined) anchors.clear();
  else anchors.delete(sessionId);
}

export function llmRouteKey(llm: LlmAdapter): string {
  const route = llm.ensureRoute?.() ?? llm.peekRoute?.();
  const provider =
    route && typeof route === "object" && "provider" in route
      ? String((route as { provider?: unknown }).provider ?? "")
      : "";
  const model =
    route && typeof route === "object" && "model" in route
      ? String((route as { model?: unknown }).model ?? "")
      : "";
  return `${llm.id}::${provider}::${model}::${llm.systemPromptUpdate ?? ""}`;
}

/**
 * Leading system text to pass into `placeSystemOnWire` for this turn, or
 * undefined when the route cannot append / has no prior anchor.
 */
export function recallSeriesBaseline(
  sessionId: string,
  llm: LlmAdapter,
): string | undefined {
  if (llm.systemPromptUpdate !== "in-history") return undefined;
  const prior = anchors.get(sessionId);
  if (!prior) return undefined;
  if (prior.routeKey !== llmRouteKey(llm)) {
    anchors.delete(sessionId);
    return undefined;
  }
  return prior.baseline;
}

/** Remember the wire head after a successful assemble (keep first baseline). */
export function rememberSeriesBaseline(
  sessionId: string,
  llm: LlmAdapter,
  baseline: string,
): void {
  if (llm.systemPromptUpdate !== "in-history") return;
  if (!baseline.trim()) {
    anchors.delete(sessionId);
    return;
  }
  const routeKey = llmRouteKey(llm);
  const prior = anchors.get(sessionId);
  // Keep the first head for this route so later appends do not promote the
  // trailing system text into message 0 on the next turn.
  if (prior && prior.routeKey === routeKey) return;
  anchors.set(sessionId, { baseline, routeKey });
}

/** Compaction / series break — next request re-baselines at the head. */
export function breakSeriesBaseline(sessionId: string): void {
  anchors.delete(sessionId);
}
