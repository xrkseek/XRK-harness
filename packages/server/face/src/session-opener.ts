/**
 * Who opened a session (委派方 provenance) + whether the human 老板 later spoke.
 * Overview uses this so workspace sessions opened by 经理 / 向日葵 do not
 * always paint 老板 as the sole left seat — and so two managers from different
 * source sessions stay distinguishable by `sourceSessionId`.
 *
 * Map is in-memory; after Host restart, {@link readSessionOpener} hydrates from
 * the first durable seat speech (`kind:seat`) in the session log.
 */

import { readSessionEvents } from "@xrkseek/core-session";
import { isHumanUserMessageSource } from "@xrkseek/protocol";
import type { FaceRuntime } from "./context.js";
import { sessionSeatMemberId } from "./agent-home-boundary.js";

/** Opener seat + the real source session (not a synthetic `:opener` id). */
export type SessionOpenerRecord = {
  readonly memberId: string;
  readonly sourceSessionId: string;
};

/** sessionId → roster member + source session that opened / dispatched. */
export type SessionOpenerMap = Map<string, SessionOpenerRecord>;

/** Sessions where the UI composer (human_face) has admitted at least once. */
export type SessionHumanSpokeSet = Set<string>;

function isOpenerRecord(value: unknown): value is SessionOpenerRecord {
  if (!value || typeof value !== "object") return false;
  const row = value as SessionOpenerRecord;
  return (
    typeof row.memberId === "string" &&
    row.memberId.trim() !== "" &&
    typeof row.sourceSessionId === "string" &&
    row.sourceSessionId.trim() !== ""
  );
}

/** Record opener from a source session (inheritFrom / parent / orch caller). */
export function rememberSessionOpener(
  runtime: FaceRuntime,
  sessionId: string,
  sourceSessionId: string,
): void {
  const id = sessionId.trim();
  const source = sourceSessionId.trim();
  if (!id || !source || id === source) return;
  // Ghost inheritFrom must not invent a 委派方 seat (Overview would paint air).
  if (!runtime.store.has(source)) return;
  const memberId = sessionSeatMemberId(runtime, source)?.trim();
  if (!memberId) return;
  runtime.sessionOpeners.set(id, {
    memberId,
    sourceSessionId: source,
  });
}

/** Mark that the human boss spoke into this session via the UI composer. */
export function markSessionHumanSpoke(
  runtime: FaceRuntime,
  sessionId: string,
): void {
  const id = sessionId.trim();
  if (!id) return;
  runtime.sessionHumanSpoke.add(id);
}

export function forgetSessionOpenerState(
  runtime: FaceRuntime,
  sessionId: string,
): void {
  const id = sessionId.trim();
  if (!id) return;
  runtime.sessionOpeners.delete(id);
  runtime.sessionHumanSpoke.delete(id);
}

function acceptOpenerRecord(
  runtime: FaceRuntime,
  sessionId: string,
  raw: unknown,
): SessionOpenerRecord | undefined {
  if (!isOpenerRecord(raw)) {
    runtime.sessionOpeners.delete(sessionId);
    return undefined;
  }
  const memberId = raw.memberId.trim();
  const sourceSessionId = raw.sourceSessionId.trim();
  if (!memberId || !sourceSessionId || !runtime.store.has(sourceSessionId)) {
    runtime.sessionOpeners.delete(sessionId);
    return undefined;
  }
  if (memberId !== raw.memberId || sourceSessionId !== raw.sourceSessionId) {
    const next = { memberId, sourceSessionId };
    runtime.sessionOpeners.set(sessionId, next);
    return next;
  }
  return raw;
}

/**
 * Recover opener from the first seat speech in the log (Host restart path).
 * Skips human_face / handoff / plugin — only `kind:seat` with fromSessionId.
 */
function hydrateOpenerFromLog(
  runtime: FaceRuntime,
  sessionId: string,
): SessionOpenerRecord | undefined {
  if (!runtime.store.has(sessionId)) return undefined;
  const events = readSessionEvents(runtime.store, sessionId);
  let openerFrom = "";
  for (const ev of events) {
    if (!ev || typeof ev !== "object") continue;
    const row = ev as { type?: unknown; source?: unknown };
    if (row.type !== "user/message") continue;
    const source = row.source;
    if (isHumanUserMessageSource(source as never)) {
      runtime.sessionHumanSpoke.add(sessionId);
      continue;
    }
    if (!source || typeof source !== "object") continue;
    if ((source as { kind?: unknown }).kind !== "seat") continue;
    if (openerFrom) continue;
    const from =
      typeof (source as { fromSessionId?: unknown }).fromSessionId === "string"
        ? (source as { fromSessionId: string }).fromSessionId.trim()
        : "";
    if (!from || from === sessionId || !runtime.store.has(from)) continue;
    openerFrom = from;
  }
  if (!openerFrom) return undefined;
  rememberSessionOpener(runtime, sessionId, openerFrom);
  return acceptOpenerRecord(
    runtime,
    sessionId,
    runtime.sessionOpeners.get(sessionId),
  );
}

/**
 * Read a validated opener record. Purges legacy / corrupt map values
 * (e.g. bare memberId strings from older runtimes) so Status never crashes
 * on `.memberId` / `.sourceSessionId`. Hydrates from the session log when the
 * in-memory map was cleared by a Host restart.
 */
export function readSessionOpener(
  runtime: FaceRuntime,
  sessionId: string,
): SessionOpenerRecord | undefined {
  const id = sessionId.trim();
  if (!id) return undefined;
  const raw = runtime.sessionOpeners.get(id);
  if (raw === undefined) {
    return hydrateOpenerFromLog(runtime, id);
  }
  return acceptOpenerRecord(runtime, id, raw) ?? hydrateOpenerFromLog(runtime, id);
}

/**
 * True when the human boss **created** this session (sidebar / composer).
 *
 * False for: delegated children, seat-opened peers (`workspace_session_prompt` /
 * inheritFrom — opener recorded), even after the boss later speaks and becomes
 * the ask target. Creator ≠ later 委派方.
 */
export function sessionCreatedByBoss(
  runtime: FaceRuntime,
  sessionId: string,
): boolean {
  const id = sessionId.trim();
  if (!id || !runtime.store.has(id)) return false;
  const child = runtime.subagents.getByChild(id);
  if (child && child.mode !== "fork") return false;
  return readSessionOpener(runtime, id) === undefined;
}

/** Voice tools only legal on boss-created seats (Host TTS bind + Face strip). */
export const BOSS_VOICE_TOOL_NAMES = [
  "text_to_speech",
  "voice_transcribe",
  "voice_session",
] as const;

/** Strip TTS/ASR when this seat was not boss-created. */
export function applyBossVoiceToolMask(
  runtime: FaceRuntime,
  sessionId: string,
  tools: {
    unregister(name: string): boolean;
  },
): string[] {
  if (sessionCreatedByBoss(runtime, sessionId)) return [];
  const removed: string[] = [];
  for (const name of BOSS_VOICE_TOOL_NAMES) {
    if (tools.unregister(name)) removed.push(name);
  }
  return removed;
}
