/**
 * Pure types of the session-stats domain: the ONE home of the `sessionStats`
 * projection-key declaration, free of this package's host-side value imports
 * (cordis context, zod, the llm chunk predicate). Two namespace projections
 * serve it — `./types` for host consumers, `./client` for client aggregates —
 * with zero content duplication.
 *
 * @module @xrkseek/xrk-session-stats/types
 */

// Marks this file a module so the declaration below AUGMENTS the projection
// table instead of declaring an ambient module.
export {}

/**
 * Whole-log conversation figures, independent of how much history a client
 * has paged in. Counts and wall times all fold from the complete durable log;
 * every field is 0 until its first contributing event lands. Field names
 * mirror the client window fold so an assembly without this unit can fall
 * back to it wholesale.
 */
export interface SessionStatsProjection {
  /**
   * Distinct turns with a closed step (`step/end`), plus the in-flight turn
   * while `step/start` is open and that turn is not yet counted.
   */
  turns: number
  /**
   * Closed steps (`step/end`) plus one while a step is open — so the composer
   * gauge advances as soon as the model starts, not only after `step/end`.
   */
  steps: number
  /** Summed model wall time (`step/start` → `assistant/message`) over steps that assembled a message. */
  llmMs: number
  /** Summed tool wall time over `tool/call` → `tool/result` pairs matched by callId. */
  toolMs: number
  /** Summed first-token latency (`step/start` → first non-empty delta chunk) over `ttftSteps`. */
  ttftMs: number
  /** Steps carrying a recorded first token. */
  ttftSteps: number
  /** Summed decode wall time (first token → `assistant/message`) over steps that also report output tokens. */
  decodeMs: number
  /** Summed provider output tokens over the same decode-timed steps. */
  decodeTokens: number
}

declare module '@xrkseek/xrk-session-projection/types' {
  interface SessionProjectionMap {
    /** Whole-log turn/step counts and wall times; see {@link SessionStatsProjection}. */
    sessionStats: SessionStatsProjection
  }
}
