/**
 * Live curated-memory body for the fragment channel: leading system stays
 * policy-only; MEMORY.md / USER.md ride a last-wins additional_context row.
 */
import { createHash } from "node:crypto";
import type { CuratedMemoryStore } from "./store.js";

export const CURATED_MEMORY_FRAGMENT_ID = "additional_context.curated_memory";

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

/** turn-start always (if non-empty); post-tool only when the body fingerprint moved. */
export function createCuratedMemoryLiveGate(store: CuratedMemoryStore): {
  turnStart(): string | undefined;
  postTool(): string | undefined;
} {
  let lastFp = "";
  return {
    turnStart() {
      const body = formatCuratedMemoryLiveBody(store);
      if (!body) return undefined;
      lastFp = curatedMemoryBodyFingerprint(body);
      return body;
    },
    postTool() {
      const body = formatCuratedMemoryLiveBody(store);
      if (!body) return undefined;
      const fp = curatedMemoryBodyFingerprint(body);
      if (fp === lastFp) return undefined;
      lastFp = fp;
      return body;
    },
  };
}
