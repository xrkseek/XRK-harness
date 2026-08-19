import type { SessionEvent } from "@xrkseek/protocol";
import type { ProjectionDefinition } from "../registry.js";

/** Whole-log conversation figures (DSH `sessionStats`; client StatsLine). */
export interface SessionStatsProjection {
  readonly turns: number;
  readonly steps: number;
  readonly llmMs: number;
  readonly toolMs: number;
  readonly ttftMs: number;
  readonly ttftSteps: number;
  readonly decodeMs: number;
  readonly decodeTokens: number;
}

interface SessionStatsState extends SessionStatsProjection {
  readonly lastTurnId: string | null;
  readonly openStep: {
    readonly turnId: string;
    readonly stepId: string;
    readonly startTime: number;
    readonly firstTokenTime: number | null;
  } | null;
  readonly pendingCalls: Readonly<Record<string, number>>;
}

const EMPTY_VIEW: SessionStatsProjection = {
  turns: 0,
  steps: 0,
  llmMs: 0,
  toolMs: 0,
  ttftMs: 0,
  ttftSteps: 0,
  decodeMs: 0,
  decodeTokens: 0,
};

function isNonEmptyTextChunk(event: SessionEvent): boolean {
  return (
    event.type === "assistant/chunk" &&
    event.kind !== "reasoning" &&
    event.text.trim().length > 0
  );
}

function asNonNegInt(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new Error(`sessionStats.${label} must be a non-negative integer`);
  }
  return value;
}

function asNonNeg(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`sessionStats.${label} must be a non-negative number`);
  }
  return value;
}

/**
 * DSH sessionStats fold over XRK events:
 * `step/end` counts steps; `step/start` → `assistant/message` is llmMs;
 * first non-empty text chunk is TTFT; `tool/call` → `tool/result` by call id.
 * Decode tokens stay 0 until `assistant/message` carries usage (not in protocol yet).
 */
export function createSessionStatsProjectionUnit(): ProjectionDefinition<
  "sessionStats",
  SessionStatsState,
  SessionStatsProjection
> {
  return {
    key: "sessionStats",
    stateVersion: 1,
    init: () => ({
      ...EMPTY_VIEW,
      lastTurnId: null,
      openStep: null,
      pendingCalls: {},
    }),
    apply(state, event: SessionEvent): SessionStatsState {
      switch (event.type) {
        case "step/start":
          return {
            ...state,
            openStep: {
              turnId: event.turnId,
              stepId: event.stepId,
              startTime: event.ts,
              firstTokenTime: null,
            },
          };
        case "assistant/chunk": {
          const open = state.openStep;
          if (
            open === null ||
            open.turnId !== event.turnId ||
            open.stepId !== event.stepId
          ) {
            return state;
          }
          if (open.firstTokenTime !== null || !isNonEmptyTextChunk(event)) {
            return state;
          }
          return {
            ...state,
            openStep: { ...open, firstTokenTime: event.ts },
          };
        }
        case "assistant/message": {
          const open = state.openStep;
          if (
            open === null ||
            open.turnId !== event.turnId ||
            open.stepId !== event.stepId
          ) {
            return state;
          }
          const next: SessionStatsState = {
            ...state,
            llmMs: state.llmMs + Math.max(0, event.ts - open.startTime),
            openStep: null,
          };
          if (open.firstTokenTime !== null) {
            return {
              ...next,
              ttftMs:
                next.ttftMs + Math.max(0, open.firstTokenTime - open.startTime),
              ttftSteps: next.ttftSteps + 1,
            };
          }
          return next;
        }
        case "tool/call":
          return {
            ...state,
            pendingCalls: {
              ...state.pendingCalls,
              [event.call.id]: event.ts,
            },
          };
        case "tool/result": {
          const callId = event.result.toolCallId;
          if (!Object.hasOwn(state.pendingCalls, callId)) return state;
          const dispatched = state.pendingCalls[callId]!;
          const pendingCalls = { ...state.pendingCalls };
          delete pendingCalls[callId];
          return {
            ...state,
            toolMs: state.toolMs + Math.max(0, event.ts - dispatched),
            pendingCalls,
          };
        }
        case "step/end":
          return {
            ...state,
            turns:
              state.lastTurnId === event.turnId
                ? state.turns
                : state.turns + 1,
            steps: state.steps + 1,
            lastTurnId: event.turnId,
            openStep: null,
          };
        case "turn/end":
          return Object.keys(state.pendingCalls).length === 0
            ? state
            : { ...state, pendingCalls: {} };
        default:
          return state;
      }
    },
    view: (state) => ({
      turns: state.turns,
      steps: state.steps,
      llmMs: state.llmMs,
      toolMs: state.toolMs,
      ttftMs: state.ttftMs,
      ttftSteps: state.ttftSteps,
      decodeMs: state.decodeMs,
      decodeTokens: state.decodeTokens,
    }),
    parse(value: unknown): SessionStatsProjection {
      if (!value || typeof value !== "object") {
        throw new Error("sessionStats projection must be an object");
      }
      const v = value as Record<string, unknown>;
      return {
        turns: asNonNegInt(v.turns, "turns"),
        steps: asNonNegInt(v.steps, "steps"),
        llmMs: asNonNeg(v.llmMs, "llmMs"),
        toolMs: asNonNeg(v.toolMs, "toolMs"),
        ttftMs: asNonNeg(v.ttftMs, "ttftMs"),
        ttftSteps: asNonNegInt(v.ttftSteps, "ttftSteps"),
        decodeMs: asNonNeg(v.decodeMs, "decodeMs"),
        decodeTokens: asNonNeg(v.decodeTokens, "decodeTokens"),
      };
    },
  };
}
