/**
 * Cross-plugin focus for the Status-column Changes review tab.
 * Deliverables opens it from the turn-tail card; ui-plan listens and switches tabs.
 */

export type ChangesReviewFocus = {
  readonly sessionId: string
  readonly seq: number
  readonly index: number
  readonly revision: number
}

/** Mutable face provided on `ctx.changesReview`. */
export class ChangesReviewController {
  private focus: ChangesReviewFocus | null = null
  private revision = 0
  private readonly listeners = new Set<() => void>()

  /**
   * Focus the overview Changes tab on one turn's file.
   * @param input.sessionId - owning session.
   * @param input.seq - Face `workspace/changes` seq for fileDiff.
   * @param input.index - file index in that turn's summary (default 0).
   */
  open(input: {
    readonly sessionId: string
    readonly seq: number
    readonly index?: number
  }): void {
    this.revision += 1
    this.focus = {
      sessionId: input.sessionId,
      seq: input.seq,
      index: input.index ?? 0,
      revision: this.revision,
    }
    for (const listener of this.listeners) listener()
  }

  /** Current focus, or null when nothing has been requested. */
  getSnapshot = (): ChangesReviewFocus | null => this.focus

  /** Subscribe to focus changes (useSyncExternalStore). */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
}
