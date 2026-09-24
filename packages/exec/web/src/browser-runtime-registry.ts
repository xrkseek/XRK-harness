/**
 * Session-scoped browser runtime registry (Hermes task_id → session map).
 * Survives Agent invalidate so open pages / CDP callers stay across Settings
 * rebuilds; Host stop or explicit drop closes them.
 */

import type { BrowserSession } from "./browser-session.js";

export interface BrowserRuntimeRegistry {
  /** Get or create the BrowserSession for one Host conversation session. */
  getOrCreate(
    sessionId: string,
    factory: () => BrowserSession,
  ): BrowserSession;
  /** Peek without creating. */
  get(sessionId: string): BrowserSession | undefined;
  /** Dispose one session's browser (CDP close / clear page). */
  drop(sessionId: string): void;
  /** Dispose every entry (Host stop). */
  dispose(): void;
  /** Test / diagnostics. */
  size(): number;
}

function tryDispose(session: BrowserSession): void {
  const disposable = session as BrowserSession & { dispose?: () => void };
  try {
    disposable.dispose?.();
  } catch {
    /* best-effort teardown */
  }
}

/** Create an empty session-keyed browser runtime registry. */
export function createBrowserRuntimeRegistry(): BrowserRuntimeRegistry {
  const sessions = new Map<string, BrowserSession>();
  return {
    getOrCreate(sessionId, factory) {
      const key = sessionId.trim();
      if (!key) throw new Error("browser runtime registry needs a sessionId");
      const existing = sessions.get(key);
      if (existing) return existing;
      const created = factory();
      sessions.set(key, created);
      return created;
    },
    get(sessionId) {
      return sessions.get(sessionId.trim());
    },
    drop(sessionId) {
      const key = sessionId.trim();
      const session = sessions.get(key);
      if (!session) return;
      sessions.delete(key);
      tryDispose(session);
    },
    dispose() {
      for (const [key, session] of sessions) {
        sessions.delete(key);
        tryDispose(session);
      }
    },
    size() {
      return sessions.size;
    },
  };
}
