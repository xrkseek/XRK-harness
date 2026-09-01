/**
 * Whole-log turn outline for the chat rail: every started turn's Face seq and
 * bounded previews, independent of a client's paged event window.
 *
 * `turn/start` anchors each entry — its seq is the loadThrough target so a
 * window paged back through that seq contains the whole turn. Turn numbers
 * follow Face wire id order (first-seen turnId → 1, 2, …). Previews match the
 * rail's loaded-turn clamps; the response commits at `turn/end` from a draft
 * of the newest text-bearing assistant message.
 */
import type { MessageContent, SessionEvent } from "@xrkseek/protocol";
import {
  asContentBlocks,
  isHumanUserMessageSource,
} from "@xrkseek/protocol";
import type { ProjectionDefinition } from "../registry.js";

/** Prompt budget: one rail-card line. */
const PROMPT_PREVIEW_LIMIT = 50;
/** Response budget: up to three rail-card lines. */
const RESPONSE_PREVIEW_LIMIT = 120;

/** One started turn's outline facts served on the wire. */
export interface TurnOutlineEntry {
  /** Face wire turn number (order of first-seen `turnId`). */
  readonly turn: number;
  /** Face seq of this turn's `turn/start` (loadThrough target). */
  readonly seq: number;
  /** Bounded first-human-prompt preview; `''` until an eligible prompt lands. */
  readonly prompt: string;
  /** Bounded final-response preview; `''` until turn/end commits assistant text. */
  readonly response: string;
}

/**
 * Fold state: served entries plus the open turn's response draft. Draft is
 * host-only until `turn/end` — mutate it in place and keep `Object.is` so the
 * change feed stays quiet between wire boundaries (see session-projection
 * "same reference = no downstream").
 */
export interface TurnOutlineState {
  readonly turns: readonly TurnOutlineEntry[];
  draft: string;
  /** Last `turn/start` turnId — retries keep the standing entry. */
  readonly lastTurnId: string | null;
}

const EMPTY_OUTLINE: TurnOutlineState = {
  turns: [],
  draft: "",
  lastTurnId: null,
};

/** Space-join text, collapse whitespace, cap at `limit` with a trailing ellipsis. */
function previewFromBlocks(content: MessageContent, limit: number): string {
  let text = "";
  let unread = false;
  for (const block of asContentBlocks(content)) {
    if (block.type !== "text") continue;
    if (text.length >= limit * 2) {
      unread = true;
      break;
    }
    const clipped = block.text.length > limit * 2;
    const chunk = clipped ? block.text.slice(0, limit * 2) : block.text;
    text += text === "" ? chunk : ` ${chunk}`;
    if (clipped) {
      unread = true;
      break;
    }
  }
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length > limit - 1) {
    return `${normalized.slice(0, limit - 1).trimEnd()}…`;
  }
  return unread ? `${normalized}…` : normalized;
}

function previewFromString(content: string, limit: number): string {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (normalized.length > limit - 1) {
    return `${normalized.slice(0, limit - 1).trimEnd()}…`;
  }
  return normalized;
}

function parseEntry(value: unknown): TurnOutlineEntry {
  if (!value || typeof value !== "object") {
    throw new Error("turnOutline entry must be an object");
  }
  const v = value as Record<string, unknown>;
  if (typeof v.turn !== "number" || !Number.isSafeInteger(v.turn) || v.turn < 0) {
    throw new Error("turnOutline.turn must be a non-negative integer");
  }
  if (typeof v.seq !== "number" || !Number.isSafeInteger(v.seq) || v.seq < 0) {
    throw new Error("turnOutline.seq must be a non-negative integer");
  }
  if (typeof v.prompt !== "string") {
    throw new Error("turnOutline.prompt must be a string");
  }
  if (typeof v.response !== "string") {
    throw new Error("turnOutline.response must be a string");
  }
  if (v.prompt.length > PROMPT_PREVIEW_LIMIT) {
    throw new Error("turnOutline.prompt exceeds preview budget");
  }
  if (v.response.length > RESPONSE_PREVIEW_LIMIT) {
    throw new Error("turnOutline.response exceeds preview budget");
  }
  return {
    turn: v.turn,
    seq: v.seq,
    prompt: v.prompt,
    response: v.response,
  };
}

/** The `turnOutline` unit registered on Face default projections. */
export function createTurnOutlineProjectionUnit(): ProjectionDefinition<
  "turnOutline",
  TurnOutlineState,
  readonly TurnOutlineEntry[]
> {
  return {
    key: "turnOutline",
    stateVersion: 1,
    init: () => EMPTY_OUTLINE,
    apply(state, event: SessionEvent, seq: number): TurnOutlineState {
      switch (event.type) {
        case "turn/start": {
          if (state.lastTurnId === event.turnId) return state;
          const turn = (state.turns.at(-1)?.turn ?? 0) + 1;
          return {
            turns: [
              ...state.turns,
              { turn, seq, prompt: "", response: "" },
            ],
            draft: "",
            lastTurnId: event.turnId,
          };
        }
        case "user/message": {
          if (!isHumanUserMessageSource(event.source)) return state;
          const last = state.turns.at(-1);
          if (last === undefined || last.prompt !== "") return state;
          const prompt = previewFromBlocks(event.content, PROMPT_PREVIEW_LIMIT);
          if (prompt === "") return state;
          return {
            turns: [...state.turns.slice(0, -1), { ...last, prompt }],
            draft: state.draft,
            lastTurnId: state.lastTurnId,
          };
        }
        case "assistant/message": {
          const draft = previewFromString(event.content, RESPONSE_PREVIEW_LIMIT);
          if (draft === "" || draft === state.draft) return state;
          // Host-only draft — same state reference so mux stays quiet.
          state.draft = draft;
          return state;
        }
        case "turn/end": {
          if (state.draft === "") return state;
          const last = state.turns.at(-1);
          if (last === undefined || last.response === state.draft) {
            state.draft = "";
            return state;
          }
          return {
            turns: [
              ...state.turns.slice(0, -1),
              { ...last, response: state.draft },
            ],
            draft: "",
            lastTurnId: state.lastTurnId,
          };
        }
        default:
          return state;
      }
    },
    wire: {
      view: (state) => state.turns,
      parse(value: unknown): readonly TurnOutlineEntry[] {
        if (!Array.isArray(value)) {
          throw new Error("turnOutline projection must be an array");
        }
        const out: TurnOutlineEntry[] = [];
        let previous = -1;
        for (const row of value) {
          const entry = parseEntry(row);
          if (entry.turn <= previous) {
            throw new Error(
              "turnOutline entries must be strictly increasing by turn",
            );
          }
          previous = entry.turn;
          out.push(entry);
        }
        return out;
      },
    },
  };
}
