import type { SessionEvent } from "@xrkseek/protocol";
import {
  isHumanUserMessageSource,
  looksLikeAttachmentHandleCaption,
} from "@xrkseek/protocol";
import type { FaceProjectionRegistry } from "./registry.js";
import {
  DEFAULT_FALLBACK_MAX_WORDS,
  DEFAULT_TITLE_MAX_BYTES,
  fallbackSessionTitle,
  humanTitleSourceText,
  normalizeSessionTitle,
  softAttachmentTitleSource,
} from "./title-normalize.js";

export class SessionTitleInvalidError extends Error {
  override readonly name = "SessionTitleInvalidError";
}

export interface TitleControllerOptions {
  readonly maxTitleBytes?: number;
  readonly fallbackMaxWords?: number;
  readonly fallbackMaxBytes?: number;
  append(sessionId: string, event: SessionEvent): SessionEvent;
  getEvents(sessionId: string): readonly SessionEvent[];
  readonly projections: FaceProjectionRegistry;
}

/**
 * Appends log-only `session/title` events (rename + first-prompt fallback).
 * Projection units fold those events; this controller never mutates projection cells directly.
 */
export class FaceTitleController {
  private readonly maxTitleBytes: number;
  private readonly fallbackMaxWords: number;
  private readonly fallbackMaxBytes: number;
  private readonly append: TitleControllerOptions["append"];
  private readonly getEvents: TitleControllerOptions["getEvents"];
  private readonly projections: FaceProjectionRegistry;

  constructor(options: TitleControllerOptions) {
    this.maxTitleBytes = options.maxTitleBytes ?? DEFAULT_TITLE_MAX_BYTES;
    this.fallbackMaxWords =
      options.fallbackMaxWords ?? DEFAULT_FALLBACK_MAX_WORDS;
    this.fallbackMaxBytes = options.fallbackMaxBytes ?? DEFAULT_TITLE_MAX_BYTES;
    this.append = (sessionId, event) => options.append(sessionId, event);
    this.getEvents = (sessionId) => options.getEvents(sessionId);
    this.projections = options.projections;
  }

  /** Explicit user rename — pins title; returns accepted title + Face seq. */
  rename(sessionId: string, raw: string): { title: string; seq: number } {
    const title = normalizeSessionTitle(raw, this.maxTitleBytes);
    if (!title) {
      throw new SessionTitleInvalidError("title normalizes to empty");
    }
    this.append(sessionId, {
      type: "session/title",
      ts: Date.now(),
      title,
      source: { kind: "user" },
      messageSeqs: [],
    });
    // Face seq = 1-based index in full log (same clock as session.history).
    return { title, seq: this.getEvents(sessionId).length };
  }

  /**
   * After a committed `user/message` at `messageSeq`, append fallback title
   * iff the session still has no title event and projection title is null.
   */
  maybeFallbackFromUserMessage(
    sessionId: string,
    messageSeq: number,
    content: string,
  ): void {
    const events = this.getEvents(sessionId);
    if (events.some((e) => e.type === "session/title")) return;
    const snap = this.projections.snapshot(sessionId);
    if (snap.values.title) return;
    const title = this.deriveFallbackTitle(content);
    if (!title) return;
    this.append(sessionId, {
      type: "session/title",
      ts: Date.now(),
      title,
      source: { kind: "fallback" },
      messageSeqs: [messageSeq],
    });
  }

  /**
   * Repair / hydrate titles from the durable log:
   * - no title yet → first human prose, else soft attachment filename
   * - leaked handle-caption fallback → rewrite from prose / filename
   * Compaction can leave the opener off-transcript while the log still holds it.
   */
  ensureFallbackFromLog(sessionId: string): void {
    const events = this.getEvents(sessionId);
    let lastTitle: Extract<SessionEvent, { type: "session/title" }> | undefined;
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]!;
      if (event.type === "session/title") {
        lastTitle = event;
        break;
      }
    }
    if (lastTitle !== undefined) {
      if (
        lastTitle.source.kind === "fallback" &&
        looksLikeAttachmentHandleCaption(lastTitle.title)
      ) {
        this.repairLeakedCaptionTitle(sessionId, events);
      }
      return;
    }
    const snap = this.projections.snapshot(sessionId);
    if (snap.values.title) return;
    for (let i = 0; i < events.length; i++) {
      const event = events[i]!;
      if (event.type !== "user/message") continue;
      if (!isHumanUserMessageSource(event.source)) continue;
      const prose = humanTitleSourceText(event.content);
      if (prose.trim() !== "") {
        this.maybeFallbackFromUserMessage(sessionId, i + 1, prose);
        return;
      }
      const soft = softAttachmentTitleSource(event.content);
      if (soft.trim() !== "") {
        this.maybeFallbackFromUserMessage(sessionId, i + 1, soft);
        return;
      }
    }
  }

  /** Normalize + reject handle-caption leftovers after word/byte caps. */
  private deriveFallbackTitle(content: string): string {
    if (looksLikeAttachmentHandleCaption(content)) return "";
    const title = fallbackSessionTitle(
      content,
      this.fallbackMaxWords,
      this.fallbackMaxBytes,
    );
    if (!title || looksLikeAttachmentHandleCaption(title)) return "";
    return title;
  }

  /**
   * Replace a fallback title that is still a handle caption when reader prose
   * or a filename is available (older logs / lost `modelOnly`).
   */
  private repairLeakedCaptionTitle(
    sessionId: string,
    events: readonly SessionEvent[],
  ): void {
    for (let i = 0; i < events.length; i++) {
      const event = events[i]!;
      if (event.type !== "user/message") continue;
      if (!isHumanUserMessageSource(event.source)) continue;
      const prose = humanTitleSourceText(event.content);
      const soft =
        prose.trim() !== "" ? prose : softAttachmentTitleSource(event.content);
      const title = this.deriveFallbackTitle(soft);
      if (!title) continue;
      this.append(sessionId, {
        type: "session/title",
        ts: Date.now(),
        title,
        source: { kind: "fallback" },
        messageSeqs: [i + 1],
      });
      return;
    }
  }
}
