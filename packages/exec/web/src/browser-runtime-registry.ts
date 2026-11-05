/**
 * Session-scoped browser runtime registry (Hermes task_id → session map).
 * Survives Agent invalidate so open pages / CDP callers stay across Settings
 * rebuilds that do not change browser product config; Host stop or explicit
 * drop closes them. A changed `configKey` (Face browser product fingerprint)
 * disposes the old session so headed / profile / proxy / restore take effect.
 */

import type { BrowserSession } from "./browser-session.js";

export interface BrowserRuntimeGetOptions {
  /**
   * Fingerprint of the Face `browser` product (and any env that must recreate
   * the CLI session). Same key → reuse; different key → dispose + factory.
   */
  readonly configKey?: string;
}

export interface BrowserRuntimeRegistry {
  /** Get or create the BrowserSession for one Host conversation session. */
  getOrCreate(
    sessionId: string,
    factory: () => BrowserSession,
    options?: BrowserRuntimeGetOptions,
  ): BrowserSession;
  /** Peek without creating. */
  get(sessionId: string): BrowserSession | undefined;
  /** Dispose one session's browser (CDP close / clear page). */
  drop(sessionId: string): void;
  /** Dispose every entry (Host stop / browser Settings change). */
  dispose(): void;
  /** Test / diagnostics. */
  size(): number;
}

interface RegistryEntry {
  readonly session: BrowserSession;
  readonly configKey: string;
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
  const sessions = new Map<string, RegistryEntry>();
  return {
    getOrCreate(sessionId, factory, options) {
      const key = sessionId.trim();
      if (!key) throw new Error("browser runtime registry needs a sessionId");
      const configKey = options?.configKey ?? "";
      const existing = sessions.get(key);
      if (existing) {
        if (existing.configKey === configKey) return existing.session;
        sessions.delete(key);
        tryDispose(existing.session);
      }
      const created = factory();
      sessions.set(key, { session: created, configKey });
      return created;
    },
    get(sessionId) {
      return sessions.get(sessionId.trim())?.session;
    },
    drop(sessionId) {
      const key = sessionId.trim();
      const entry = sessions.get(key);
      if (!entry) return;
      sessions.delete(key);
      tryDispose(entry.session);
    },
    dispose() {
      for (const [key, entry] of sessions) {
        sessions.delete(key);
        tryDispose(entry.session);
      }
    },
    size() {
      return sessions.size;
    },
  };
}
