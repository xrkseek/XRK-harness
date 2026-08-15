/**
 * Consecutive-failure tracker across turns (pure class).
 * @see docs/learn/cline-mistake-loop-safety.md
 */

export type MistakeReason =
  | "api_error"
  | "invalid_tool_call"
  | "tool_execution_failed"
  | "tool_loop_hard";

export interface MistakeRecordInput {
  readonly reason: MistakeReason;
  readonly details?: string;
  /** Jump consecutive to max (loop hard escalation). */
  readonly forceAtLimit?: boolean;
}

export type MistakeLimitDecision = "continue" | "stop";

export interface MistakeRecordResult {
  readonly consecutive: number;
  readonly atLimit: boolean;
  readonly action: "continue" | MistakeLimitDecision;
  readonly message?: string;
}

export interface MistakeTrackerOptions {
  readonly maxConsecutiveMistakes?: number;
  /** When limit hit: stop turn (default) or continue after reset + notice. */
  readonly onLimit?: MistakeLimitDecision;
}

export const DEFAULT_MAX_CONSECUTIVE_MISTAKES = 6;

export function mistakeLimitNotice(reason: MistakeReason, consecutive: number): string {
  return (
    `[system] Consecutive mistake limit reached (${consecutive}, reason=${reason}). ` +
    `Stopping this turn. Session is kept — send a new message to continue.`
  );
}

export function createMistakeTracker(options: MistakeTrackerOptions = {}) {
  const max = options.maxConsecutiveMistakes ?? DEFAULT_MAX_CONSECUTIVE_MISTAKES;
  const onLimit = options.onLimit ?? "stop";
  let consecutive = 0;

  return {
    get consecutive() {
      return consecutive;
    },
    get max() {
      return max;
    },
    reset() {
      consecutive = 0;
    },
    record(input: MistakeRecordInput): MistakeRecordResult {
      consecutive = input.forceAtLimit ? max : consecutive + 1;
      if (consecutive < max) {
        return { consecutive, atLimit: false, action: "continue" };
      }
      if (onLimit === "continue") {
        consecutive = 0;
        return {
          consecutive: 0,
          atLimit: true,
          action: "continue",
          message: mistakeLimitNotice(input.reason, max),
        };
      }
      return {
        consecutive,
        atLimit: true,
        action: "stop",
        message: mistakeLimitNotice(input.reason, consecutive),
      };
    },
    /**
     * Turn-boundary feed: all tools failed → record; any success → reset.
     * No tools → no-op.
     */
    onTurnToolStats(stats: {
      readonly ok: number;
      readonly failed: number;
      readonly details?: string;
    }): MistakeRecordResult | undefined {
      if (stats.failed > 0 && stats.ok === 0) {
        return this.record({
          reason: "tool_execution_failed",
          ...(stats.details ? { details: stats.details } : {}),
        });
      }
      if (stats.ok > 0) {
        this.reset();
      }
      return undefined;
    },
  };
}

export type MistakeTracker = ReturnType<typeof createMistakeTracker>;
