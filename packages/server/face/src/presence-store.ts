/**
 * Per-session Overview presence (emotion ball) — process-local sticky state.
 * Tool `presence_set` writes; `session.status` reads. Not a durable SessionEvent.
 */

export interface SessionPresenceState {
  readonly emotionId: string;
  readonly tips?: string;
  /** Who last wrote this row. */
  readonly source: "tool";
  readonly updatedAt: number;
}

export class FacePresenceStore {
  private readonly bySession = new Map<string, SessionPresenceState>();

  get(sessionId: string): SessionPresenceState | undefined {
    return this.bySession.get(sessionId);
  }

  set(
    sessionId: string,
    input: { readonly emotionId: string; readonly tips?: string },
  ): SessionPresenceState {
    const next: SessionPresenceState = {
      emotionId: input.emotionId,
      source: "tool",
      updatedAt: Date.now(),
      ...(input.tips !== undefined && input.tips.trim()
        ? { tips: input.tips.trim().slice(0, 200) }
        : {}),
    };
    this.bySession.set(sessionId, next);
    return next;
  }

  /** Clear sticky override so Overview falls back to activity-derived emotion. */
  clear(sessionId: string): boolean {
    return this.bySession.delete(sessionId);
  }

  /** Drop row on session eviction / delete (host heap hygiene). */
  forget(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  /** Test / diagnostics: how many sticky rows are retained. */
  size(): number {
    return this.bySession.size;
  }
}
