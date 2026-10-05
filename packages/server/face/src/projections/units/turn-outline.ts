/**
 * Whole-log turn outline for the chat rail: every started turn's Face seq and
 * bounded previews, independent of a client's paged event window.
 *
 * Fold keeps empty Host turns; the published view drops `prompt===''` and
 * assigns gapless `round` (1-based 轮次). `turn/start` seq is the loadThrough
 * target. Wire numbers follow first-seen turnId → 1, 2, …. Response commits
 * at `turn/end` from a draft of the newest text-bearing assistant message.
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

/** Fold row: every started Host turn, including those with no 轮次 prompt yet. */
interface TurnOutlineFoldEntry {
  readonly turn: number;
  readonly seq: number;
  readonly prompt: string;
  readonly response: string;
}

/** One 轮次 on the wire: a started turn that already has a human opener. */
export interface TurnOutlineEntry {
  /** Face wire turn number (order of first-seen `turnId`). */
  readonly turn: number;
  /** Gapless 轮次 (1-based) among published openers. Not Host `turn`. */
  readonly round: number;
  /** Face seq of this turn's `turn/start` (loadThrough target). */
  readonly seq: number;
  /** Bounded first-human-prompt preview. */
  readonly prompt: string;
  /** Bounded final-response preview; `''` until turn/end commits assistant text. */
  readonly response: string;
}

/** Published ladder: drop Host turns with no opener, then number 轮次. */
export function publishedTurnOutline(
  turns: readonly TurnOutlineFoldEntry[],
): readonly TurnOutlineEntry[] {
  const out: TurnOutlineEntry[] = [];
  for (const row of turns) {
    if (row.prompt === "") continue;
    out.push({
      turn: row.turn,
      seq: row.seq,
      prompt: row.prompt,
      response: row.response,
      round: out.length + 1,
    });
  }
  return out;
}

/**
 * Fold state: served entries plus the open turn's response draft. Draft is
 * host-only until `turn/end` — mutate it in place and keep `Object.is` so the
 * change feed stays quiet between wire boundaries (see session-projection
 * "same reference = no downstream").
 */
export interface TurnOutlineState {
  readonly turns: readonly TurnOutlineFoldEntry[];
  draft: string;
  /**
   * Every `turnId` that already anchored an entry, in first-seen order. This
   * must mirror {@link FaceWireIdMaps.turn}'s dedup scope — the whole log, not
   * just the previous event — or the outline's numbering drifts off the wire
   * numbers the client timeline is keyed by, and the rail grows marks for
   * turns the transcript does not have.
   */
  readonly seenTurnIds: readonly string[];
}

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

function parseFoldEntry(value: unknown): TurnOutlineFoldEntry {
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
    stateVersion: 3,
    // A fresh object per session, never a module-level singleton: `apply`
    // mutates `draft` in place, and every session's fold starts from this.
    // Sharing one instance lets a streaming session's draft bleed into the
    // next session's first `user/message`, which forwards the field.
    init: () => ({ turns: [], draft: "", seenTurnIds: [] }),
    apply(state, event: SessionEvent, seq: number): TurnOutlineState {
      switch (event.type) {
        case "turn/start": {
          // Whole-log dedup, matching FaceWireIdMaps.turn(): a turnId that
          // already anchored an entry keeps it, so numbering stays "first seen
          // wins" however far apart the repeats are.
          if (state.seenTurnIds.includes(event.turnId)) return state;
          const turn = state.turns.length + 1;
          return {
            turns: [
              ...state.turns,
              { turn, seq, prompt: "", response: "" },
            ],
            draft: "",
            seenTurnIds: [...state.seenTurnIds, event.turnId],
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
            seenTurnIds: state.seenTurnIds,
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
            seenTurnIds: state.seenTurnIds,
          };
        }
        default:
          return state;
      }
    },
    wire: {
      view: (state) => publishedTurnOutline(state.turns),
      parse(value: unknown): readonly TurnOutlineEntry[] {
        if (!Array.isArray(value)) {
          throw new Error("turnOutline projection must be an array");
        }
        const folded: TurnOutlineFoldEntry[] = [];
        let previous = -1;
        for (const row of value) {
          const entry = parseFoldEntry(row);
          if (entry.turn <= previous) {
            throw new Error(
              "turnOutline entries must be strictly increasing by turn",
            );
          }
          previous = entry.turn;
          folded.push(entry);
        }
        return publishedTurnOutline(folded);
      },
    },
  };
}
