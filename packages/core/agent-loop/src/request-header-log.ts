/**
 * Append `request/header` when the active LLM route changes (DSH reconstructable requests).
 *
 * Extreme sessions: each tool step used to `readSessionEvents` + full-log fold
 * even when the auto path would no-op. Cache the last folded snapshot per
 * session so the hot path is O(1); cold miss still uses tail-fold.
 *
 * When standing tool **names** change vs the prior header, also append a
 * model-visible `user/message` with `source.kind: "tool-registry"` (DSH
 * dynamic-tool-updates). Schema-only tweaks still rewrite the header but do
 * not emit the inject.
 */
import {
  foldRequestHeader,
  requestHeaderEquals,
  requestHeaderRouteEquals,
  type RequestHeaderSnapshot,
  type SessionStore,
  readSessionEvents,
} from "@xrkseek/core-session";
import type { LlmAdapter } from "@xrkseek/llm";
import {
  newUserMessageId,
  type RequestHeaderReason,
  type RequestHeaderToolSchema,
  type SessionEvent,
} from "@xrkseek/protocol";

/** Last appended/folded header per session (Host process lifetime). */
const lastHeaderBySession = new Map<string, RequestHeaderSnapshot>();

/**
 * Drop cached header snapshot(s). Call on session delete and from tests.
 * Host restart clears the Map. Do not clear on resident eviction — the log
 * still owns the header and the next cold miss re-folds once.
 */
export function forgetRequestHeaderCache(sessionId?: string): void {
  if (sessionId === undefined) {
    lastHeaderBySession.clear();
    return;
  }
  lastHeaderBySession.delete(sessionId);
}

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

/** True when the log already has a closed turn (resume vs first-ever header). */
function logHasTurnEnd(events: readonly SessionEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i]?.type === "turn/end") return true;
  }
  return false;
}

function toolNameSet(
  tools: readonly RequestHeaderToolSchema[] | undefined,
): Set<string> {
  const names = new Set<string>();
  for (const t of tools ?? []) {
    if (t.name) names.add(t.name);
  }
  return names;
}

/** Sorted name deltas for standing tools (schema-only changes → empty). */
export function diffToolRegistryNames(
  prev: readonly RequestHeaderToolSchema[] | undefined,
  next: readonly RequestHeaderToolSchema[] | undefined,
): { readonly added: string[]; readonly removed: string[] } {
  const before = toolNameSet(prev);
  const after = toolNameSet(next);
  const added: string[] = [];
  const removed: string[] = [];
  for (const name of after) {
    if (!before.has(name)) added.push(name);
  }
  for (const name of before) {
    if (!after.has(name)) removed.push(name);
  }
  added.sort();
  removed.sort();
  return { added, removed };
}

function formatToolRegistryUpdate(input: {
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly headerSeq: number;
}): string {
  const lines = ["# Tool registry update", ""];
  if (input.added.length > 0) {
    lines.push(`Added: ${input.added.join(", ")}`);
  }
  if (input.removed.length > 0) {
    lines.push(`Removed: ${input.removed.join(", ")}`);
  }
  lines.push("");
  lines.push(
    `Full schemas for the current standing set are on request/header seq ${input.headerSeq}.`,
  );
  return lines.join("\n");
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

  let prev = lastHeaderBySession.get(input.sessionId);
  let coldEvents: readonly SessionEvent[] | undefined;
  if (prev === undefined) {
    coldEvents = readSessionEvents(input.store, input.sessionId);
    prev = foldRequestHeader(coldEvents);
    if (prev) lastHeaderBySession.set(input.sessionId, prev);
  }

  let slimSystemOnly = false;
  if (prev) {
    // Explicit `reason` (overflow compact · resume) compares the full snapshot.
    // Auto path: skip only when route+tools+system are unchanged. System-only
    // deltas used to be swallowed to avoid re-writing ~100KB tools[] every step
    // — that also hid prefix-cache cliffs. Log a slim header (config+system,
    // no tools); foldRequestHeader merges standing schemas from the prior row.
    if (input.reason !== undefined) {
      if (requestHeaderEquals(prev, snap)) return;
    } else {
      const routeSame = requestHeaderRouteEquals(prev, snap);
      const systemSame = (prev.system ?? "") === (snap.system ?? "");
      if (routeSame && systemSame) return;
      slimSystemOnly = routeSame && !systemSame;
    }
  }

  // coldEvents is set whenever prev was missing after the cache probe (fold
  // miss ⇒ first header of this Host view of the session).
  const reason: RequestHeaderReason =
    input.reason
    ?? (prev
      ? "change"
      : logHasTurnEnd(coldEvents ?? [])
        ? "resume"
        : "initial");
  const header = slimSystemOnly
    ? {
        config: snap.config,
        ...(snap.system?.trim() ? { system: snap.system } : {}),
        ...(snap.adapterDefaults
          ? { adapterDefaults: snap.adapterDefaults }
          : {}),
      }
    : snap;
  input.store.append(input.sessionId, {
    type: "request/header",
    ts: input.now(),
    turnId: input.turnId,
    reason,
    header,
  });
  lastHeaderBySession.set(input.sessionId, {
    config: snap.config,
    ...(snap.system !== undefined
      ? { system: snap.system }
      : prev?.system !== undefined
        ? { system: prev.system }
        : {}),
    ...(snap.tools !== undefined
      ? { tools: snap.tools }
      : prev?.tools !== undefined
        ? { tools: prev.tools }
        : {}),
    ...(snap.adapterDefaults !== undefined
      ? { adapterDefaults: snap.adapterDefaults }
      : prev?.adapterDefaults !== undefined
        ? { adapterDefaults: prev.adapterDefaults }
        : {}),
  });

  // Name-set delta only (not schema-only). Skip the first header of a session
  // view — there is no prior standing set for the model to reconcile against.
  // Slim system-only rows omit tools — do not treat that as a full remove.
  if (!prev || slimSystemOnly || snap.tools === undefined) return;
  const { added, removed } = diffToolRegistryNames(prev.tools, snap.tools);
  if (added.length === 0 && removed.length === 0) return;
  const headerSeq = input.store.get(input.sessionId).events.length - 1;
  input.store.append(input.sessionId, {
    type: "user/message",
    ts: input.now(),
    turnId: input.turnId,
    messageId: newUserMessageId(),
    content: formatToolRegistryUpdate({ added, removed, headerSeq }),
    source: {
      kind: "tool-registry",
      form: "update",
      added,
      removed,
      headerSeq,
    },
  });
}
