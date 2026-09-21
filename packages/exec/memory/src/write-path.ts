/**
 * Post-turn write path into curated MEMORY.md.
 * Durable user notes only. Disk writes do not refresh the frozen prompt.
 * Not a vector store and not the Mnemon document library.
 */
import type { CuratedMemoryStore } from "./store.js";

const MAX_NOTES_PER_TURN = 3;
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

function redactSecrets(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_SECRET]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [REDACTED_SECRET]")
    .replace(
      /\b(?:api[_-]?key|token|password|secret)\b\s*[:=]\s*\S+/gi,
      "[REDACTED_SECRET]",
    );
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

/**
 * Evidence from the user's turn text only. Assistant prose is not promoted
 * into durable notes. Empty when the memory tool already wrote this turn.
 */
export function extractReusableNotes(input: TurnNoteInput): string[] {
  if (input.memoryToolWrote) return [];
  const found: string[] = [];
  const seen = new Set<string>();
  const push = (raw: string) => {
    if (found.length >= MAX_NOTES_PER_TURN) return;
    const note = usable(raw);
    if (!note || seen.has(note)) return;
    seen.add(note);
    found.push(note);
  };

  for (const line of input.userText.split(/\n+/)) {
    const trimmed = line.trim();
    const explicit = EXPLICIT.exec(trimmed);
    if (explicit?.[1]) {
      push(explicit[1]);
      continue;
    }
    const remember = REMEMBER_THAT.exec(trimmed);
    if (remember?.[1]) push(remember[1]);
  }

  for (const sentence of sentences(input.userText)) {
    if (!PREFERENCE.test(sentence)) continue;
    push(sentence);
  }

  return found;
}

/**
 * Append extracted notes to MEMORY.md. Failures (char cap, drift) stop the
 * batch. The store snapshot from session start is left unchanged.
 */
export function writeReusableNotesAfterTurn(
  store: CuratedMemoryStore,
  input: TurnNoteInput,
): TurnNoteWriteResult {
  const written: string[] = [];
  for (const note of extractReusableNotes(input)) {
    const result = store.add("memory", note);
    if (!result.success) break;
    if (result.message === "Entry added.") written.push(note);
  }
  return { written };
}
