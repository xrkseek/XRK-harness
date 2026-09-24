/**
 * Spill storage seam vocabulary (Cordis-free).
 * Learned from dsh `@deepseek-ai/dsh-spill` types: opaque locator + retrieval hint.
 */

/** Opaque model-facing handle for one spilled artifact (often a filesystem path). */
export type SpillLocator = string & { readonly __brand: "SpillLocator" };

export function SpillLocator(locator: string): SpillLocator {
  return locator as SpillLocator;
}

/** Session that owns the artifact at save time. */
export interface SpillOwner {
  readonly sessionId: string;
}

/** Producer of a spilled artifact (descriptive only — not access control). */
export type SpillSource =
  | {
      readonly kind: "tool";
      readonly toolName: string;
      readonly callId: string;
      readonly label: string;
    }
  | {
      readonly kind: "session-reference";
      readonly sessionId: string;
      readonly label: string;
    };

/** One request to persist text to a spill artifact. */
export interface SaveTextSpill {
  readonly owner: SpillOwner;
  readonly source: SpillSource;
  /** Caller-suggested base name (sanitized to one path segment). */
  readonly suggestedName: string;
  /** Full UTF-8 text to persist. */
  readonly content: string;
}

/** Saved spill artifact: locator, bytes, and model-facing retrieval guidance. */
export interface SpillRef {
  readonly locator: SpillLocator;
  readonly bytes: number;
  readonly retrievalHint: string;
}

/** Abstract spill storage — persist full text; return opaque locator + hint. */
export interface SpillStore {
  saveText(input: SaveTextSpill): Promise<SpillRef>;
  /** Sync path for agent-loop (no async turn boundary). */
  saveTextSync?(input: SaveTextSpill): SpillRef;
}
