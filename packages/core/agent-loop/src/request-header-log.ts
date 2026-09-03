/**
 * Append `request/header` when the active LLM route changes (DSH reconstructable requests).
 */
import { foldRequestHeader, requestHeaderEquals, type RequestHeaderSnapshot, type SessionStore, readSessionEvents } from "@xrkseek/core-session";
import type { LlmAdapter } from "@xrkseek/llm";
import type {
  RequestHeaderReason,
  RequestHeaderToolSchema,
} from "@xrkseek/protocol";

function resolveHeaderSnapshot(
  llm: LlmAdapter,
): RequestHeaderSnapshot | undefined {
  if (llm.ensureRoute) {
    return { config: llm.ensureRoute() };
  }
  const route = llm.peekRoute?.();
  if (!route) return undefined;
  return { config: route };
}

export function maybeAppendRequestHeader(input: {
  readonly store: SessionStore;
  readonly sessionId: string;
  readonly turnId: string;
  readonly llm: LlmAdapter;
  readonly now: () => number;
  readonly reason?: RequestHeaderReason;
  /** Assembled system prompt for this step (Face contextBreakdown). */
  readonly system?: string;
  /** Standing tool schemas for this step. */
  readonly tools?: readonly RequestHeaderToolSchema[];
}): void {
  const route = resolveHeaderSnapshot(input.llm);
  if (!route) return;
  const snap: RequestHeaderSnapshot = {
    config: route.config,
    ...(input.system?.trim() ? { system: input.system } : {}),
    ...(input.tools && input.tools.length > 0 ? { tools: input.tools } : {}),
    ...(route.adapterDefaults ? { adapterDefaults: route.adapterDefaults } : {}),
  };
  const events = readSessionEvents(input.store, input.sessionId);
  const prev = foldRequestHeader(events);
  if (prev && requestHeaderEquals(prev, snap)) return;
  const reason: RequestHeaderReason =
    input.reason ??
    (prev ? "change" : events.some((e) => e.type === "turn/end") ? "resume" : "initial");
  input.store.append(input.sessionId, {
    type: "request/header",
    ts: input.now(),
    turnId: input.turnId,
    reason,
    header: snap,
  });
}
