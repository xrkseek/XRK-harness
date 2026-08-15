/**
 * Long-lived session safety trackers (pure). Pipeline wiring lives in core-agent.
 * @see docs/learn/cline-mistake-loop-safety.md
 */

import type { SafetyNoticePayload } from "@xrkseek/protocol";
import {
  createLoopDetectionTracker,
  type LoopDetectionConfig,
  type LoopDetectionTracker,
} from "./loop.js";
import {
  createMistakeTracker,
  type MistakeRecordResult,
  type MistakeTracker,
  type MistakeTrackerOptions,
} from "./mistake.js";

export {
  checkRepeatedToolCall,
  createLoopDetectionTracker,
  DEFAULT_LOOP_CONFIG,
  emptyLoopState,
  hardLoopNotice,
  softLoopNotice,
  toolCallSignature,
  type LoopDetectionConfig,
  type LoopDetectionState,
  type LoopDetectionTracker,
  type LoopVerdict,
  type LoopVerdictKind,
} from "./loop.js";

export {
  createMistakeTracker,
  DEFAULT_MAX_CONSECUTIVE_MISTAKES,
  mistakeLimitNotice,
  type MistakeLimitDecision,
  type MistakeReason,
  type MistakeRecordInput,
  type MistakeRecordResult,
  type MistakeTracker,
  type MistakeTrackerOptions,
} from "./mistake.js";

export class SessionSafetyLimitError extends Error {
  readonly reason: string;

  constructor(message: string, reason = "mistake_limit") {
    super(message);
    this.name = "SessionSafetyLimitError";
    this.reason = reason;
  }
}

export interface SessionSafetyOptions {
  readonly loopDetection?: false | Partial<LoopDetectionConfig>;
  readonly mistake?: MistakeTrackerOptions;
}

export interface SessionSafety {
  readonly loop: LoopDetectionTracker;
  readonly mistake: MistakeTracker;
  /** Soft/hard notices queued for the next tool post → safetyNotices. */
  takeSoftNotices(): SafetyNoticePayload[];
  enqueueSoftNotice(notice: SafetyNoticePayload): void;
  afterTurn(stats: { ok: number; failed: number }): void;
  onApiError(details?: string): void;
  /** Record loop hard as forceAtLimit mistake; returns whether caller should abort turn. */
  onLoopHard(details: string): { abortTurn: boolean; message?: string };
  /**
   * Message set when hard abort was requested; cleared on read.
   * Prefer this over reconstructing from loop snapshot after AbortError.
   */
  consumeAbortMessage(): string | undefined;
}

export function createSessionSafety(
  options: SessionSafetyOptions = {},
): SessionSafety {
  const loop = createLoopDetectionTracker(
    options.loopDetection === false ? false : (options.loopDetection ?? {}),
  );
  const mistake = createMistakeTracker(options.mistake ?? {});
  let softQueue: SafetyNoticePayload[] = [];
  let abortMessage: string | undefined;

  const applyLimit = (result: MistakeRecordResult) => {
    if (result.action === "stop" && result.message) {
      throw new SessionSafetyLimitError(result.message);
    }
  };

  return {
    loop,
    mistake,
    takeSoftNotices() {
      const out = softQueue;
      softQueue = [];
      return out;
    },
    enqueueSoftNotice(notice) {
      softQueue.push(notice);
    },
    afterTurn(stats) {
      const result = mistake.onTurnToolStats(stats);
      if (result) applyLimit(result);
    },
    onApiError(details) {
      const result = mistake.record({
        reason: "api_error",
        ...(details ? { details } : {}),
      });
      applyLimit(result);
    },
    onLoopHard(details) {
      const result = mistake.record({
        reason: "tool_loop_hard",
        forceAtLimit: true,
        details,
      });
      if (result.action === "stop") {
        // Prefer the loop hard copy already flushed as safety/notice.
        abortMessage = details;
        return { abortTurn: true as const, message: details };
      }
      if (result.message) {
        softQueue.push({
          kind: "mistake_limit",
          content: result.message,
        });
      }
      return result.message
        ? { abortTurn: false as const, message: result.message }
        : { abortTurn: false as const };
    },
    consumeAbortMessage() {
      const m = abortMessage;
      abortMessage = undefined;
      return m;
    },
  };
}
