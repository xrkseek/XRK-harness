/**
 * Live curated-memory body for the fragment channel.
 *
 * Session-start freeze stays on the system prompt; this gate emits a last-wins
 * `<external_curated_memory>` row only when disk has moved past that freeze
 * (same-session `memory` writes, or another seat writing a shared zone).
 */
import { createHash } from "node:crypto";
import type { CuratedMemoryStore } from "./store.js";

export const CURATED_MEMORY_FRAGMENT_ID = "additional_context.curated_memory";

/** Char ceiling for the live body (four zones × configurable caps). */
export const CURATED_MEMORY_FRAGMENT_MAX_CHARS = 24_000;

/** Inner body (host wraps `<external_curated_memory>`). */
export function formatCuratedMemoryLiveBody(store: CuratedMemoryStore): string {
  // Live read when the provider can answer synchronously; async providers
  // (http) keep the construct-time snapshot rather than blocking a turn.
  const block = (store.liveSystemBlock?.() ?? store.frozenSystemBlock()).trim();
  if (!block) return "";
  return `LIVE curated memory (prefer over older memory text):\n${block}`;
}

export function curatedMemoryBodyFingerprint(body: string): string {
  return createHash("sha256").update(body).digest("hex");
}

/**
 * Emit only when the live disk body differs from the last emitted (or the
 * session-start freeze). Avoids duplicating the system freeze every turn.
 */
export function createCuratedMemoryLiveGate(store: CuratedMemoryStore): {
  turnStart(): string | undefined;
  postTool(): string | undefined;
} {
  const baseline = (store.frozenSystemBlock() ?? "").trim();
  let lastFp = curatedMemoryBodyFingerprint(baseline);

  const emitIfMoved = (): string | undefined => {
    const body = formatCuratedMemoryLiveBody(store);
    if (!body) return undefined;
    // Fingerprint the raw live block (not the LIVE prefix) so freeze ↔ live
    // equality is stable across formatting.
    const live = (store.liveSystemBlock?.() ?? store.frozenSystemBlock()).trim();
    const fp = curatedMemoryBodyFingerprint(live);
    if (fp === lastFp) return undefined;
    lastFp = fp;
    return body;
  };

  return {
    turnStart: emitIfMoved,
    postTool: emitIfMoved,
  };
}
