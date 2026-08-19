import type { ChatMessage, SessionEvent } from "@xrkseek/protocol";
import { assertSessionEvent } from "@xrkseek/protocol";

export {
  SessionBusyError,
  createTurnLatch,
  createSessionDrainLatch,
  type TurnLatch,
  type SessionDrainLatch,
  type DrainFn,
} from "./latch.js";

export {
  createSessionDrainHub,
  type SessionDrainHub,
} from "./drain-hub.js";

export {
  NoPendingAdmitError,
  AdmitNotPendingError,
  admitPrompt,
  withdrawAdmit,
  listPendingAdmits,
  newSession,
  promoteNextAdmit,
  promoteAdmitsForTurn,
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
  DEFAULT_COMPACTION_BUFFER_TOKENS,
  DEFAULT_COMPACTION_KEEP_TOKENS,
  buildCompactionPrompt,
  deriveMessagesUnwindowed,
  estimateMessagesTokens,
  estimateTokens,
  findLatestCompaction,
  formatCompactionForModel,
  prepareCompactionPayload,
  selectHeadRecent,
  type CompactionOptions,
} from "./compaction.js";

import {
  deriveMessagesUnwindowed,
  findLatestCompaction,
  formatCompactionForModel,
} from "./compaction.js";

export {
  TOOL_INTERRUPTED_MESSAGE,
  ToolSettlementError,
  assertToolCallsSettled,
  listDanglingToolCalls,
  settleDanglingTools,
  type DanglingToolCall,
  type SettleDanglingOptions,
  type SettleDanglingResult,
} from "./dangling.js";

export {
  foldRequestHeader,
  llmConfigEquals,
  requestHeaderEquals,
  canonicalRequestHeader,
  type RequestHeaderSnapshot,
} from "./request-header.js";

export type { SessionRecord, SessionStore } from "./store.js";
import type { SessionRecord, SessionStore } from "./store.js";
import { deepFreeze, newSessionId } from "./freeze.js";

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
      return { id, events: [...events] };
    },

    has(id: string): boolean {
      return sessions.has(id);
    },

    append(id: string, event: SessionEvent): SessionEvent {
      const events = sessions.get(id);
      if (!events) {
        throw new Error(`session not found: ${id}`);
      }
      const parsed = assertSessionEvent(event);
      const frozen = deepFreeze(structuredClone(parsed));
      events.push(frozen);
      return frozen;
    },

    list(): readonly string[] {
      return [...sessions.keys()];
    },
  };
}

/** Project model-facing history from the append-only log. */
export function deriveMessages(events: readonly SessionEvent[]): ChatMessage[] {
  const compact = findLatestCompaction(events);
  if (compact) {
    const messages: ChatMessage[] = [
      {
        role: "user",
        content: formatCompactionForModel(compact.event),
      },
    ];
    return messages.concat(deriveMessagesUnwindowed(events.slice(compact.index + 1)));
  }
  return deriveMessagesUnwindowed(events);
}

export class ModelVisibleInvariantError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModelVisibleInvariantError";
  }
}

/**
 * Assert that every message in a model request can be reconstructed from the log.
 * M0: compare JSON of deriveMessages(events) with requestMessages.
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
  createPersistentSessionStore,
  ftsMatchQuery,
  SESSION_DB_FILENAME,
  SESSION_SCHEMA_VERSION,
  type PersistentSessionStore,
} from "./sqlite-store.js";
export {
  expandPackedStorageRecords,
  fromPackedJSONL,
  fromPackedJSONLZstd,
  isTextChunkRow,
  packChunkRunsForExport,
  parsePackedJSONL,
  toPackedJSONL,
  zstdCompressUtf8,
  zstdDecompressUtf8,
  type PackedStorageRecord,
  type ParsePackedJSONLResult,
  type TextChunkRow,
} from "./chunk-pack.js";
export { repairOpenTurnEvents } from "./repair-open-turn.js";
export {
  extractEventSearchText,
  extractSessionSearchTexts,
} from "./search-text.js";
export { writeTextFileAtomicSync } from "./atomic-write.js";

export function forkSession(
  store: SessionStore,
  sourceId: string,
  boundaryIndex?: number,
  childId?: string,
): SessionRecord {
  const source = store.get(sourceId);
  const end =
    boundaryIndex === undefined
      ? source.events.length
      : Math.max(0, Math.min(boundaryIndex, source.events.length));
  const child = store.create(childId);
  for (const ev of source.events.slice(0, end)) {
    store.append(child.id, ev);
  }
  return store.get(child.id);
}
