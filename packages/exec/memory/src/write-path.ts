/**
 * Post-turn write path + session-end Phase1/Phase2 consolidate into curated MEMORY.md.
 * Durable user notes only. Disk writes do not refresh the frozen prompt.
 * Not a vector store and not the Mnemon document library.
 */
import { redactSecrets } from "@xrkseek/secrets";
import type { CuratedMemoryStore } from "./store.js";

const MAX_NOTES_PER_TURN = 3;
const MAX_NOTES_PER_SESSION_END = 12;
const MAX_NOTES_PHASE2 = 8;
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

/** Injected one-shot completion for Phase2 LLM extract (Host supplies session LLM). */
export type Phase2CompleteFn = (
  prompt: string,
) => Promise<string> | string;

export interface SessionEndPhase2Input extends SessionEndConsolidateInput {
  readonly complete: Phase2CompleteFn;
  /** Optional assistant texts for context (truncated; never written verbatim). */
  readonly assistantTexts?: readonly string[];
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

async function appendNotesWithSoftTrim(
  store: CuratedMemoryStore,
  notes: readonly string[],
): Promise<string[]> {
  const written: string[] = [];
  for (const note of notes) {
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
  return written;
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
  return { written: await appendNotesWithSoftTrim(store, found) };
}

/** Prompt for Phase2 extract — short facts only, JSON array reply. */
export function buildPhase2ExtractPrompt(input: {
  readonly userTexts: readonly string[];
  readonly assistantTexts?: readonly string[];
  readonly existingEntries: readonly string[];
}): string {
  const users = input.userTexts
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(-20)
    .map((t, i) => `${i + 1}. ${t.slice(0, 400)}`)
    .join("\n");
  const assistants = (input.assistantTexts ?? [])
    .map((t) => t.trim())
    .filter(Boolean)
    .slice(-8)
    .map((t, i) => `${i + 1}. ${t.slice(0, 240)}`)
    .join("\n");
  const existing = input.existingEntries
    .slice(0, 40)
    .map((e) => `- ${e.slice(0, 200)}`)
    .join("\n");
  return [
    "Extract durable cross-session facts from this chat for MEMORY.md.",
    "Return ONLY a JSON array of short strings (max 8). No markdown fences.",
    "Rules: user preferences and lasting conventions only; no secrets, todos,",
    "one-off task status, or assistant speculation. Skip anything already listed.",
    "",
    "Existing MEMORY entries:",
    existing || "(none)",
    "",
    "User turns:",
    users || "(none)",
    "",
    "Assistant turns (context only — do not copy):",
    assistants || "(none)",
  ].join("\n");
}

/** Parse a model reply into note strings (JSON array, or line bullets). */
export function parsePhase2Notes(raw: string): string[] {
  const text = raw.replace(/^\uFEFF/, "").trim();
  if (!text) return [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = (fenced?.[1] ?? text).trim();
  try {
    const start = body.indexOf("[");
    const end = body.lastIndexOf("]");
    if (start >= 0 && end > start) {
      const parsed = JSON.parse(body.slice(start, end + 1)) as unknown;
      if (Array.isArray(parsed)) {
        return parsed
          .filter((row): row is string => typeof row === "string")
          .map((row) => usable(row))
          .filter((row): row is string => row !== undefined)
          .slice(0, MAX_NOTES_PHASE2);
      }
    }
  } catch {
    /* fall through to line parse */
  }
  const lines: string[] = [];
  for (const line of body.split(/\n+/)) {
    const cleaned = line.replace(/^[-*•\d.\)\s]+/, "").trim();
    const note = usable(cleaned);
    if (note) lines.push(note);
    if (lines.length >= MAX_NOTES_PHASE2) break;
  }
  return lines;
}

/**
 * Session-end Phase2: optional LLM extract of short facts into MEMORY.md.
 * Failures (complete throws / empty parse) return `{ written: [] }` — callers
 * should still run Phase1. Does not refresh the frozen prompt snapshot.
 */
export async function consolidateCuratedMemoryPhase2(
  store: CuratedMemoryStore,
  input: SessionEndPhase2Input,
): Promise<TurnNoteWriteResult> {
  if (input.userTexts.length === 0) return { written: [] };
  const existing = await Promise.resolve(store.listEntries("memory"));
  let raw: string;
  try {
    raw = await Promise.resolve(
      input.complete(
        buildPhase2ExtractPrompt({
          userTexts: input.userTexts,
          ...(input.assistantTexts
            ? { assistantTexts: input.assistantTexts }
            : {}),
          existingEntries: existing,
        }),
      ),
    );
  } catch {
    return { written: [] };
  }
  const notes = parsePhase2Notes(String(raw ?? ""));
  if (notes.length === 0) return { written: [] };
  const max = Math.min(
    Math.max(1, input.maxNotes ?? MAX_NOTES_PHASE2),
    MAX_NOTES_PHASE2,
  );
  return {
    written: await appendNotesWithSoftTrim(store, notes.slice(0, max)),
  };
}
