/**
 * Cross-turn `tools[]` name-order anchor for provider KV-cache prefix stability.
 *
 * Lexicographic re-sort after `tool_search` expand (or any Direct add) inserts
 * a new name into the middle of `tools[]` and busts the tools portion of the
 * prompt prefix — measured as a cache cliff on OpenCode / compat relays even
 * when conversation messages stay append-only.
 *
 * Process-local ordered names + {@link stabilizeToolsForSeries}: survivors keep
 * their prior slots; newcomers append at the tail. Compaction / route change /
 * session delete clears the anchor (same posture as series-baseline).
 *
 * After Host restart, {@link hydrateToolsBaselineFromLog} recovers the latest
 * post-compaction `request/header.tools` name order.
 */

import type { LlmAdapter } from "@xrkseek/llm";
import type { SessionEvent } from "@xrkseek/protocol";
import { llmRouteKey } from "./series-baseline.js";

export type ToolsBaselineAnchor = {
  readonly names: readonly string[];
  readonly routeKey: string;
};

const anchors = new Map<string, ToolsBaselineAnchor>();

/** Test / dispose helper — clears one session or the whole table. */
export function clearToolsBaselineAnchors(sessionId?: string): void {
  if (sessionId === undefined) anchors.clear();
  else anchors.delete(sessionId);
}

/** Compaction / series break — next request re-baselines tools order. */
export function breakToolsBaseline(sessionId: string): void {
  anchors.delete(sessionId);
}

/**
 * Ordered tool names from the last wire of this route, or undefined when the
 * route changed or nothing was remembered yet.
 */
export function recallToolsBaseline(
  sessionId: string,
  llm: LlmAdapter,
): readonly string[] | undefined {
  const prior = anchors.get(sessionId);
  if (!prior) return undefined;
  if (prior.routeKey !== llmRouteKey(llm)) {
    anchors.delete(sessionId);
    return undefined;
  }
  return prior.names;
}

/**
 * Remember the wire order after a successful assemble. Unlike system series
 * baseline (keep first head), tools baseline **updates** so further expands
 * keep appending past the growing prefix.
 */
export function rememberToolsBaseline(
  sessionId: string,
  llm: LlmAdapter,
  names: readonly string[],
): void {
  if (names.length === 0) {
    anchors.delete(sessionId);
    return;
  }
  anchors.set(sessionId, {
    names: [...names],
    routeKey: llmRouteKey(llm),
  });
}

/**
 * Recover tools order after Host restart from durable `request/header` rows.
 * Uses the **latest** header with a non-empty tools list after the latest
 * compaction (compaction breaks the series — earlier orders are stale).
 */
export function hydrateToolsBaselineFromLog(
  sessionId: string,
  llm: LlmAdapter,
  events: readonly SessionEvent[],
): readonly string[] | undefined {
  const existing = recallToolsBaseline(sessionId, llm);
  if (existing !== undefined) return existing;

  let afterCompact = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i]?.type === "context/compaction") afterCompact = i + 1;
  }
  let latestNames: string[] | undefined;
  for (let i = afterCompact; i < events.length; i++) {
    const ev = events[i];
    if (ev?.type !== "request/header") continue;
    const tools = ev.header.tools;
    if (!tools || tools.length === 0) continue;
    latestNames = tools.map((t) => t.name).filter((n) => Boolean(n));
  }
  if (!latestNames || latestNames.length === 0) return undefined;
  rememberToolsBaseline(sessionId, llm, latestNames);
  return latestNames;
}
