/**
 * Post-turn write path + session-end Phase1 consolidate into curated MEMORY.md.
 * Durable user notes only. Disk writes do not refresh the frozen prompt.
 * Not a vector store and not the Mnemon document library.
 */
import { redactSecrets } from "@xrkseek/secrets";
import type { CuratedMemoryStore } from "./store.js";

const MAX_NOTES_PER_TURN = 3;
const MAX_NOTES_PER_SESSION_END = 12;
const MAX_NOTE_CHARS = 280;

const EXPLICIT =
  /^(?:remember|memory|note|记住|备注)\s*[:：]\s*(.+)$/i;
const REMEMBER_THAT = /\bremember that\s+(.+)$/i;
const PREFERENCE =
  /(?:^|\s)(?:I always|I prefer|I never|please always|from now on|以后都|我习惯|我偏好|不要再|请始终|请一直)/i;

export interface TurnNoteInput {
  readonly userText: string;
  readonly assistantText?: string;
  /** This turn already called the `memory` tool, so do not write a second copy. */
  readonly memoryToolWrote?: boolean;
}

export interface TurnNoteWriteResult {
  readonly written: readonly string[];
}

/** Session-end Phase1: fold leftover user notes into MEMORY.md (Codex-style stage). */
export interface SessionEndConsolidateInput {
  /** Human user turn texts from the closing session (order preserved). */
  readonly userTexts: readonly string[];
  /** Cap new entries written in one consolidate pass (default 12). */
  readonly maxNotes?: number;
}

function usable(note: string): string | undefined {
  const cleaned = redactSecrets(note).replace(/\s+/g, " ").trim();
  if (cleaned.length < 12) return undefined;
  if (/^(?:\[REDACTED_SECRET\]|Bearer \[REDACTED_SECRET\])$/.test(cleaned)) {
    return undefined;
  }
  if (/[?？]\s*$/.test(cleaned)) return undefined;
  return cleaned.length > MAX_NOTE_CHARS
    ? cleaned.slice(0, MAX_NOTE_CHARS).trim()
    : cleaned;
}

function sentences(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?。！])\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function collectFromUserText(
  userText: string,
  found: string[],
  seen: Set<string>,
  max: number,
): void {
  const push = (raw: string) => {
    if (found.length >= max) return;
    const note = usable(raw);
    if (!note || seen.has(note)) return;
    seen.add(note);
    found.push(note);
  };

  for (const line of userText.split(/\n+/)) {
    const trimmed = line.trim();
    const explicit = EXPLICIT.exec(trimmed);
    if (explicit?.[1]) {
      push(explicit[1]);
      continue;
    }
    const remember = REMEMBER_THAT.exec(trimmed);
    if (remember?.[1]) push(remember[1]);
  }

  for (const sentence of sentences(userText)) {
    if (!PREFERENCE.test(sentence)) continue;
    push(sentence);
  }
}

/**
 * Evidence from the user's turn text only. Assistant prose is not promoted
 * into durable notes. Empty when the memory tool already wrote this turn.
 */
export function extractReusableNotes(input: TurnNoteInput): string[] {
  if (input.memoryToolWrote) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  collectFromUserText(input.userText, found, seen, MAX_NOTES_PER_TURN);
  return found;
}

/** True when `note` is already covered by an on-disk entry (exact or containment). */
export function noteCoveredByEntries(
  note: string,
  entries: readonly string[],
): boolean {
  const n = note.trim().toLowerCase();
  if (!n) return true;
  for (const entry of entries) {
    const e = entry.trim().toLowerCase();
    if (!e) continue;
    if (e === n || e.includes(n) || n.includes(e)) return true;
  }
  return false;
}

/**
 * Append extracted notes to MEMORY.md. Failures (char cap, drift) stop the
 * batch. The store snapshot from session start is left unchanged.
 */
export async function writeReusableNotesAfterTurn(
  store: CuratedMemoryStore,
  input: TurnNoteInput,
): Promise<TurnNoteWriteResult> {
  const written: string[] = [];
  for (const note of extractReusableNotes(input)) {
    const result = await Promise.resolve(store.add("memory", note));
    if (!result.success) break;
    if (result.message === "Entry added.") written.push(note);
  }
  return { written };
}

/**
 * Session-end Phase1: re-scan human user texts, skip notes already on disk
 * (exact / containment), append leftovers. Soft-trim the oldest entry once when
 * the char cap blocks a new note so one consolidate pass can still land facts
 * (Hermes-style room-making). Does not refresh the frozen system-prompt snapshot.
 */
export async function consolidateCuratedMemoryPhase1(
  store: CuratedMemoryStore,
  input: SessionEndConsolidateInput,
): Promise<TurnNoteWriteResult> {
  const max = Math.min(
    Math.max(1, input.maxNotes ?? MAX_NOTES_PER_SESSION_END),
    MAX_NOTES_PER_SESSION_END,
  );
  const found: string[] = [];
  const seen = new Set<string>();
  for (const text of input.userTexts) {
    if (found.length >= max) break;
    collectFromUserText(text, found, seen, max);
  }

  const written: string[] = [];
  for (const note of found) {
    const entries = await Promise.resolve(store.listEntries("memory"));
    if (noteCoveredByEntries(note, entries)) continue;

    let result = await Promise.resolve(store.add("memory", note));
    let softTrimAttempts = 0;
    while (
      !result.success &&
      typeof result.error === "string" &&
      /exceed the limit/i.test(result.error) &&
      softTrimAttempts < 3
    ) {
      softTrimAttempts += 1;
      const live = await Promise.resolve(store.listEntries("memory"));
      if (live.length === 0) break;
      const oldest = live[0]!;
      const removed = await Promise.resolve(store.remove("memory", oldest));
      if (!removed.success) break;
      result = await Promise.resolve(store.add("memory", note));
    }
    if (!result.success) break;
    if (result.message === "Entry added.") written.push(note);
  }
  return { written };
}
