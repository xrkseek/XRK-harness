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

export interface SessionRecord {
  readonly id: string;
  readonly events: readonly SessionEvent[];
}

export interface SessionStore {
  create(id?: string): SessionRecord;
  get(id: string): SessionRecord;
  append(id: string, event: SessionEvent): SessionEvent;
  list(): readonly string[];
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const v of Object.values(value as Record<string, unknown>)) {
    if (v && typeof v === "object" && !Object.isFrozen(v)) {
      deepFreeze(v);
    }
  }
  return value;
}

function newId(): string {
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function createMemorySessionStore(): SessionStore {
  const sessions = new Map<string, SessionEvent[]>();

  return {
    create(id = newId()): SessionRecord {
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

export function toJSONL(events: readonly SessionEvent[]): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : "");
}

export function fromJSONL(text: string): SessionEvent[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  return lines.map((line, i) => {
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`fromJSONL line ${i + 1}: invalid JSON (${msg})`, {
        cause: err,
      });
    }
    try {
      return assertSessionEvent(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`fromJSONL line ${i + 1}: ${msg}`, { cause: err });
    }
  });
}

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
