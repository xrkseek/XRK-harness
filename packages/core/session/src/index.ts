import type { ChatMessage, SessionEvent } from "@xrkseek/protocol";

export {
  SessionBusyError,
  createTurnLatch,
  createSessionDrainLatch,
  type TurnLatch,
  type SessionDrainLatch,
  type SessionDrainCancelOptions,
  type DrainFn,
} from "./latch.js";

export { createSessionDrainHub, type SessionDrainHub } from "./drain-hub.js";

export {
  NoPendingAdmitError,
  AdmitNotPendingError,
  admitPrompt,
  withdrawAdmit,
  listPendingAdmits,
  listSessionsWithPendingAdmits,
  newSession,
  promoteNextAdmit,
  promoteAdmitsForTurn,
  promotePendingSteers,
  type AdmitReceipt,
  type AdmitPromptOptions,
  type PromoteForTurnResult,
} from "./admit.js";

export {
  SessionSafetyLimitError,
  checkRepeatedToolCall,
  createLoopDetectionTracker,
  createMistakeTracker,
  createSessionSafety,
  DEFAULT_LOOP_CONFIG,
  DEFAULT_MAX_CONSECUTIVE_MISTAKES,
  emptyLoopState,
  hardLoopNotice,
  mistakeLimitNotice,
  softLoopNotice,
  toolCallSignature,
  type LoopDetectionConfig,
  type LoopDetectionTracker,
  type LoopVerdict,
  type MistakeReason,
  type MistakeTracker,
  type SessionSafety,
  type SessionSafetyOptions,
} from "./safety/index.js";

export {
  COMPACTION_SUMMARY_TEMPLATE,
  COMPACT_RECENT_MAX_TOKENS,
  DEFAULT_COMPACTION_BUFFER_TOKENS,
  DEFAULT_COMPACTION_HEAD_TOKENS,
  DEFAULT_COMPACTION_KEEP_TOKENS,
  DEFAULT_SOFT_BUDGET_COMPACT_ATTEMPTS,
  DEFAULT_SOFT_BUDGET_PEEL_ATTEMPTS,
  SOFT_BUDGET_COMPACT_TRIGGER_RATIO,
  buildCompactionPrompt,
  deriveMessagesUnwindowed,
  estimateMessagesTokens,
  estimateRequestTokens,
  estimateTokens,
  findLatestCompaction,
  formatCompactionForModel,
  prepareCompactionPayload,
  resolveSoftBudgetCeiling,
  resolveSoftBudgetTokens,
  parseCompactionStrategy,
  resolveCompactionStrategy,
  COMPACTION_STRATEGIES,
  selectHeadRecent,
  type CompactionOptions,
  type CompactionStrategy,
  type ResolvedSoftBudget,
} from "./compaction.js";

export {
  DEFAULT_MAX_REQUEST_IMAGE_BYTES,
  describeShadowedImages,
  ensureDurableImageOffloads,
  foldImageOffloadMarks,
  messageHasImageBlocks,
  MAX_DESCRIBED_SHADOWED_IMAGES,
  planImageOffloadTargets,
  projectOffloadedImages,
} from "./image-offload.js";

import {
  deriveMessagesUnwindowed,
  findLatestCompaction,
  formatCompactionForModel,
} from "./compaction.js";
import { describeShadowedImages } from "./image-offload.js";

export {
  estimateAssistantSurface,
  estimateMessageContent,
  estimateSystemTokens,
  estimateToolsTokens,
  priceRouteImageTokens,
  type InputModality,
} from "./surface-estimate.js";

export {
  foldSurfaceTokens,
  priceCurrentSurfaceWindow,
  projectedInputPressureTokens,
} from "./surface-fold.js";

export {
  TOOL_NOT_STARTED,
  TOOL_NOT_STARTED_MESSAGE,
  TOOL_OUTCOME_UNKNOWN,
  TOOL_OUTCOME_UNKNOWN_MESSAGE,
  TOOL_ABORTED_BEFORE_DISPATCH,
  TOOL_ABORTED_BEFORE_DISPATCH_MESSAGE,
  TOOL_ABORTED,
  TOOL_ABORTED_MESSAGE,
  ToolSettlementError,
  ToolAdjacencyError,
  assertToolCallsSettled,
  assertAssistantToolCallAdjacency,
  abortedBeforeDispatchSettlement,
  danglingSettlement,
  listDanglingToolCalls,
  settleDanglingTools,
  type DanglingToolCall,
  type SettleDanglingOptions,
  type SettleDanglingResult,
} from "./dangling.js";

export {
  TOOL_RESULT_PRUNE_HEAD_CHARS,
  TOOL_RESULT_PRUNE_META_PREV_TOKENS,
  TOOL_RESULT_PRUNE_TAIL_CHARS,
  TOOL_RESULT_PRUNE_THRESHOLD_CHARS,
  pruneOversizedToolResults,
  pruneToolResultText,
  type ToolResultPruneOptions,
  type ToolResultPruneResult,
} from "./tool-result-prune.js";

export {
  foldRequestHeader,
  llmConfigEquals,
  requestHeaderEquals,
  requestHeaderRouteEquals,
  canonicalRequestHeader,
  type RequestHeaderSnapshot,
} from "./request-header.js";

export {
  appendPluginRecord,
  pluginRecordsOf,
  type PluginRecordView,
} from "./plugin-records.js";

export type { SessionListHints, SessionRecord, SessionStore } from "./store.js";
export {
  SessionLogOffset,
  SessionSeq,
  SessionSeqCursor,
  eventAt,
  eventCount,
  lastSessionEvent,
  readSessionEvents,
  resolveHalfOpenEventRange,
  sessionEventAt,
  sessionEventCount,
  sessionEventsFrom,
  snapshotEvents,
  type SessionLogOffset as SessionLogOffsetType,
  type SessionLogReader,
  type SessionSeq as SessionSeqType,
  type SessionSeqCursor as SessionSeqCursorType,
} from "./seq.js";
export { computeListHints, sessionHintsBlank, sessionListHints } from "./list-hints.js";
import type { SessionListHints, SessionRecord, SessionStore } from "./store.js";
import {
  SessionLogOffset,
  readSessionEvents,
  sessionEventCount,
  snapshotEvents,
} from "./seq.js";
import { computeListHints } from "./list-hints.js";
import { freezeSessionEvent, newSessionId } from "./freeze.js";

export function createMemorySessionStore(): SessionStore {
  const sessions = new Map<string, SessionEvent[]>();

  return {
    create(id = newSessionId()): SessionRecord {
      if (sessions.has(id)) {
        throw new Error(`session already exists: ${id}`);
      }
      sessions.set(id, []);
      return { id, events: [] };
    },

    get(id: string): SessionRecord {
      const events = sessions.get(id);
      if (!events) {
        throw new Error(`session not found: ${id}`);
      }
      // Resident identity (events are deep-frozen); do not mutate.
      return { id, events };
    },

    has(id: string): boolean {
      return sessions.has(id);
    },

    delete(id: string): void {
      sessions.delete(id);
    },

    append(id: string, event: SessionEvent): SessionEvent {
      const events = sessions.get(id);
      if (!events) {
        throw new Error(`session not found: ${id}`);
      }
      const frozen = freezeSessionEvent(event);
      events.push(frozen);
      return frozen;
    },

    seed(id = newSessionId(), events = []): SessionRecord {
      if (sessions.has(id)) {
        throw new Error(`session already exists: ${id}`);
      }
      const frozen: SessionEvent[] = [];
      for (const event of events) {
        frozen.push(freezeSessionEvent(event));
      }
      sessions.set(id, frozen);
      return { id, events: frozen };
    },

    replacePrefix(id: string, events = []): SessionRecord {
      if (!sessions.has(id)) {
        throw new Error(`session not found: ${id}`);
      }
      const frozen: SessionEvent[] = [];
      for (const event of events) {
        frozen.push(freezeSessionEvent(event));
      }
      sessions.set(id, frozen);
      return { id, events: frozen };
    },

    list(): readonly string[] {
      return [...sessions.keys()];
    },

    readEvents(
      id: string,
      fromSeq = 0,
      toSeqExclusive?: number,
    ): readonly SessionEvent[] {
      const events = sessions.get(id);
      if (!events) {
        throw new Error(`session not found: ${id}`);
      }
      return snapshotEvents({ id, events }, fromSeq, toSeqExclusive);
    },

    listHints(id: string): SessionListHints {
      const events = sessions.get(id);
      if (!events) {
        throw new Error(`session not found: ${id}`);
      }
      return computeListHints(events);
    },

    isLoaded(id: string): boolean {
      return sessions.has(id);
    },
  };
}

/**
 * The standing plan — latest `todo/write` snapshot, re-projected into
 * model-visible history.
 *
 * `foldChat` has no `todo/write` case, so the list never becomes a message:
 * the model only ever sees that one call's result summary ("Updated todo
 * list: 1 pending…"), and once a compaction moves the event before the
 * window it is gone entirely — even though it stays durable in the log,
 * which the client proves by recovering it via a full back-scan. The
 * asymmetry is the bug: the panel keeps the plan, the agent loses it.
 *
 * Emitted as a leading user message, never mid-history, so
 * assistant/tool-call adjacency (and therefore `assertModelVisible` against
 * the assembled request) is untouched. A fully settled plan projects
 * nothing: a finished list is noise, not standing state.
 */
export function standingPlanMessage(
  events: readonly SessionEvent[],
): ChatMessage | undefined {
  for (let i = events.length - 1; i >= 0; i--) {
    const ev = events[i]!;
    if (ev.type !== "todo/write") continue;
    const settled = new Set(["completed", "cancelled", "done", "removed"]);
    const open = ev.todos.filter((item) => !settled.has(item.status));
    if (open.length === 0) return undefined;
    const lines = ev.todos.map((item) => `- [${item.status}] ${item.content}`);
    return {
      role: "user",
      content:
        "Standing plan (re-projected while open items remain; omitted when settled). " +
        "Own the open items: todo_write in the same turn you finish a step " +
        "(mark completed — never leave stale in_progress for the next user message); " +
        "advance the next pending to in_progress when you continue; rewrite when the " +
        "latest user ask replaces the goal. Not a new user message — latest user wins:\n" +
        lines.join("\n"),
    };
  }
  return undefined;
}

/** Project model-facing history from the append-only log. */
export function deriveMessages(events: readonly SessionEvent[]): ChatMessage[] {
  const plan = standingPlanMessage(events);
  const compact = findLatestCompaction(events);
  if (compact) {
    const messages: ChatMessage[] = [
      ...(plan ? [plan] : []),
      {
        role: "user",
        content: formatCompactionForModel(compact.event),
      },
      // The shadowed prefix is gone from the wire. Name the images it held so
      // the model can re-read one on demand — re-attaching the bytes would
      // charge vision tokens every turn and read as a fresh user paste.
      ...describeShadowedImages(events, compact.index),
    ];
    // `image/offload.targets.seq` is absolute durable-log index — fold marks
    // from the full log and remap slice-local indices.
    const sliceStart = compact.index + 1;
    return messages.concat(
      deriveMessagesUnwindowed(events.slice(sliceStart), {
        indexOffset: sliceStart,
        markSource: events,
      }),
    );
  }
  return plan
    ? [plan, ...deriveMessagesUnwindowed(events)]
    : deriveMessagesUnwindowed(events);
}

export class ModelVisibleInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelVisibleInvariantError";
  }
}

/**
 * History portion of a wire LLM request (drop `system` roles).
 * DSH keeps system on the header / `system` slot; our non-assemble path may
 * also prepend a system message — durable history must still equal
 * {@link deriveMessages}.
 */
export function durableModelHistory(messages: readonly ChatMessage[]): ChatMessage[] {
  return messages.filter((m) => m.role !== "system");
}

/**
 * Assert that durable model-visible history reconstructs from the log.
 * Pass {@link durableModelHistory} of the wire request (not a tautological
 * re-derive). Assemble's ephemeral volatile user is outside this check.
 */
export function assertModelVisible(
  events: readonly SessionEvent[],
  requestMessages: readonly ChatMessage[],
): void {
  const derived = deriveMessages(events);
  const a = JSON.stringify(derived);
  const b = JSON.stringify(requestMessages);
  if (a !== b) {
    throw new ModelVisibleInvariantError(
      "model-visible messages are not reconstructible from session log",
    );
  }
}

export { fromJSONL, parseJSONL, toJSONL, type ParseJSONLResult } from "./jsonl.js";
export {
  exportSessionInterchange,
  importSessionInterchange,
  readSessionInterchange,
  SESSION_INTERCHANGE_VERSION,
  type InterchangeMessage,
} from "./session-interchange.js";
  export {
    createPersistentSessionStore,
    ftsMatchQuery,
    planFtsQuery,
    SessionLogUnreadableError,
    isLikelyRemoteSessionsPath,
    type FtsQueryPlan,
    resolveSqliteJournalMode,
  SESSION_ARCHIVE_DB_FILENAME,
  SESSION_DB_FILENAME,
  SESSION_SCHEMA_VERSION,
  SessionsDirInUseError,
  SESSIONS_WRITE_LOCK_FILENAME,
  type PersistentSessionStore,
  type PersistentSessionStoreOptions,
  type SqliteJournalMode,
} from "./sqlite-store.js";
export {
  expandPackedStorageRecords,
  fromPackedJSONL,
  fromPackedJSONLZstd,
  isPackedChunkRow,
  isTextChunkRow,
  isToolCallChunkRow,
  packChunkRunsForExport,
  parsePackedJSONL,
  toPackedJSONL,
  zstdCompressUtf8,
  zstdDecompressUtf8,
  type PackedStorageRecord,
  type ParsePackedJSONLResult,
  type TextChunkRow,
  type ToolCallChunkRow,
} from "./chunk-pack.js";
import {
  closeOpenTurns,
  FORKED_TURN_END,
  listOpenTurnIds,
  repairOpenTurnEvents,
  sessionHasOpenTurn,
} from "./repair-open-turn.js";
export {
  closeOpenTurns,
  FORKED_TURN_END,
  listOpenTurnIds,
  repairOpenTurnEvents,
  sessionHasOpenTurn,
};
export { extractEventSearchText, extractSessionSearchTexts } from "./search-text.js";
export { writeTextFileAtomicSync } from "./atomic-write.js";

/**
 * Durability checkpoint for one session (or every session when `sessionId`
 * is omitted). No-op on stores without {@link SessionStore.flush}.
 */
export function flushSession(
  store: SessionStore,
  sessionId?: string,
): void {
  store.flush?.(sessionId);
}

/**
 * Release a cold-observed session from the resident LRU when it has no open
 * turn. No-op / false on memory stores or pinned open turns.
 */
export function releaseSessionResident(
  store: SessionStore,
  sessionId: string,
): boolean {
  return store.releaseResident?.(sessionId) ?? false;
}

/**
 * Build a fork child seed: parent prefix + forked closers for any open turn +
 * durable `session/end-seed` inheritance marker (DSH).
 */
export function buildForkSeed(
  prefix: readonly SessionEvent[],
  now: () => number = Date.now,
): SessionEvent[] {
  const closers = closeOpenTurns(prefix, FORKED_TURN_END, now);
  const seed: SessionEvent[] = [...prefix, ...closers];
  seed.push({
    type: "session/end-seed",
    ts: now(),
    inherited: true,
  });
  return seed;
}

export function forkSession(
  store: SessionStore,
  sourceId: string,
  boundaryIndex?: number,
  childId?: string,
): SessionRecord {
  const total = sessionEventCount(store, sourceId);
  const end = SessionLogOffset(
    boundaryIndex === undefined ? total : Math.max(0, Math.min(boundaryIndex, total)),
  );
  const prefix = readSessionEvents(store, sourceId, SessionLogOffset(0), end);
  const closers = closeOpenTurns(prefix, FORKED_TURN_END);
  const suffix: SessionEvent[] = [
    ...closers,
    {
      type: "session/end-seed",
      ts: Date.now(),
      inherited: true,
    },
  ];
  // Prefer SQL prefix copy (R6) when the durable store can; else one-shot seed.
  if (typeof store.seedFromSession === "function") {
    const hit = store.seedFromSession(sourceId, end, childId, suffix);
    if (hit) return hit;
  }
  const seed = [...prefix, ...suffix];
  if (typeof store.seed === "function") {
    return store.seed(childId, seed);
  }
  const child = store.create(childId);
  for (const ev of seed) {
    store.append(child.id, ev);
  }
  return store.get(child.id);
}

/**
 * Cursor-style in-place truncate: keep `[0, boundaryIndex)` on the same
 * session id. Requires {@link SessionStore.replacePrefix} (or delete+seed).
 */
export function truncateSession(
  store: SessionStore,
  sessionId: string,
  boundaryIndex: number,
): SessionRecord {
  const total = sessionEventCount(store, sessionId);
  const end = SessionLogOffset(
    Math.max(0, Math.min(Math.floor(boundaryIndex), total)),
  );
  const prefix = readSessionEvents(store, sessionId, SessionLogOffset(0), end);
  if (typeof store.replacePrefix === "function") {
    return store.replacePrefix(sessionId, prefix);
  }
  // Fallback for sparse test doubles: wipe + re-seed when both exist.
  if (typeof store.delete === "function" && typeof store.seed === "function") {
    store.delete(sessionId);
    return store.seed(sessionId, prefix);
  }
  throw new Error("session store does not support replacePrefix");
}
