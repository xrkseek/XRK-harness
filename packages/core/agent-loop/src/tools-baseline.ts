/**
 * Cross-turn `tools[]` wire anchor for provider KV-cache prefix stability.
 *
 * Lexicographic re-sort after `tool_search` expand (or any Direct add) inserts
 * a new name into the middle of `tools[]` and busts the tools portion of the
 * prompt prefix — measured as a cache cliff on OpenCode / compat relays even
 * when conversation messages stay append-only.
 *
 * Process-local ordered wire rows + {@link stabilizeToolsForSeries}: survivors
 * keep their prior slots **and** prior description/parameters bytes; newcomers
 * append at the tail. Compaction / route change / session delete clears the
 * anchor (same posture as series-baseline).
 *
 * After Host restart, {@link hydrateToolsBaselineFromLog} recovers the latest
 * post-compaction `request/header.tools` order + schema.
 */

import type { LlmAdapter } from "@xrkseek/llm";
import type { SessionEvent } from "@xrkseek/protocol";
import type { ToolsWireBaseline } from "@xrkseek/core-system-prompt";
import { llmRouteKey } from "./series-baseline.js";

export type ToolsBaselineAnchor = {
  readonly tools: ToolsWireBaseline;
  readonly routeKey: string;
};

const anchors = new Map<string, ToolsBaselineAnchor>();

function asWireBaseline(
  tools: ToolsWireBaseline,
): ToolsWireBaseline {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

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
 * Ordered wire tools from the last wire of this route, or undefined when the
 * route changed or nothing was remembered yet.
 */
export function recallToolsBaseline(
  sessionId: string,
  llm: LlmAdapter,
): ToolsWireBaseline | undefined {
  const prior = anchors.get(sessionId);
  if (!prior) return undefined;
  if (prior.routeKey !== llmRouteKey(llm)) {
    anchors.delete(sessionId);
    return undefined;
  }
  return prior.tools;
}

/**
 * Remember the wire tools after a successful assemble. Unlike system series
 * baseline (keep first head), tools baseline **updates** so further expands
 * keep appending past the growing prefix.
 */
export function rememberToolsBaseline(
  sessionId: string,
  llm: LlmAdapter,
  tools: ToolsWireBaseline,
): void {
  if (tools.length === 0) {
    anchors.delete(sessionId);
    return;
  }
  anchors.set(sessionId, {
    tools: asWireBaseline(tools),
    routeKey: llmRouteKey(llm),
  });
}

/**
 * Recover tools wire after Host restart from durable `request/header` rows.
 * Uses the **latest** header with a non-empty tools list after the latest
 * compaction (compaction breaks the series — earlier orders are stale).
 */
export function hydrateToolsBaselineFromLog(
  sessionId: string,
  llm: LlmAdapter,
  events: readonly SessionEvent[],
): ToolsWireBaseline | undefined {
  const existing = recallToolsBaseline(sessionId, llm);
  if (existing !== undefined) return existing;

  let afterCompact = 0;
  for (let i = 0; i < events.length; i++) {
    if (events[i]?.type === "context/compaction") afterCompact = i + 1;
  }
  let latest: ToolsWireBaseline | undefined;
  for (let i = afterCompact; i < events.length; i++) {
    const ev = events[i];
    if (ev?.type !== "request/header") continue;
    const tools = ev.header.tools;
    if (!tools || tools.length === 0) continue;
    latest = tools
      .filter((t) => Boolean(t.name))
      .map((t) => ({
        name: t.name,
        description: typeof t.description === "string" ? t.description : "",
        parameters:
          t.parameters && typeof t.parameters === "object" ? t.parameters : {},
      }));
  }
  if (!latest || latest.length === 0) return undefined;
  rememberToolsBaseline(sessionId, llm, latest);
  return latest;
}
