/**
 * Append `request/header` when the active LLM route changes (DSH reconstructable requests).
 */
import {
  foldRequestHeader,
  requestHeaderEquals,
  type RequestHeaderSnapshot,
  type SessionStore,
} from "@xrkseek/core-session";
import type { LlmAdapter } from "@xrkseek/llm";
import type { LlmRequestConfig, RequestHeaderReason } from "@xrkseek/protocol";

function peekRoute(llm: LlmAdapter): LlmRequestConfig | undefined {
  const fn = (llm as { peekRoute?: () => LlmRequestConfig | undefined }).peekRoute;
  return fn?.();
}

function resolveHeaderSnapshot(
  llm: LlmAdapter,
): RequestHeaderSnapshot | undefined {
  const ensure = (llm as { ensureRoute?: () => LlmRequestConfig }).ensureRoute;
  if (ensure) {
    return { config: ensure() };
  }
  const route = peekRoute(llm);
  if (!route) return undefined;
  return { config: route };
}

export function peekLlmRoute(llm: LlmAdapter): RequestHeaderSnapshot | undefined {
  return resolveHeaderSnapshot(llm);
}

export function maybeAppendRequestHeader(input: {
  readonly store: SessionStore;
  readonly sessionId: string;
  readonly turnId: string;
  readonly llm: LlmAdapter;
  readonly now: () => number;
  readonly reason?: RequestHeaderReason;
}): void {
  const snap = peekLlmRoute(input.llm);
  if (!snap) return;
  const events = input.store.get(input.sessionId).events;
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
