import type { SessionEvent } from "@xrkseek/protocol";
import type { FaceProjectionRegistry } from "./registry.js";
import {
  DEFAULT_FALLBACK_MAX_WORDS,
  DEFAULT_TITLE_MAX_BYTES,
  fallbackSessionTitle,
  normalizeSessionTitle,
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

  /** Explicit user rename — pins title. */
  rename(sessionId: string, raw: string): string {
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
    return title;
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
    const title = fallbackSessionTitle(
      content,
      this.fallbackMaxWords,
      this.fallbackMaxBytes,
    );
    if (!title) return;
    this.append(sessionId, {
      type: "session/title",
      ts: Date.now(),
      title,
      source: { kind: "fallback" },
      messageSeqs: [messageSeq],
    });
  }
}
