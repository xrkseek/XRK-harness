/**
 * Per-session expanded Deferred tools (progressive disclosure / tool_search).
 *
 * Process-local for the hot path; hydrate from the last `request/header.tools`
 * after Host restart (DSH recovers activation from logged headers). Direct
 * names in the header are harmless — {@link listForModel} only gates Deferred.
 */

import {
  foldRequestHeader,
  readSessionEvents,
  type SessionStore,
} from "@xrkseek/core-session";

export class SessionToolDisclosure {
  private readonly bySession = new Map<string, Set<string>>();

  listExpanded(sessionId: string): ReadonlySet<string> {
    return this.bySession.get(sessionId) ?? new Set();
  }

  expand(sessionId: string, names: readonly string[]): void {
    let set = this.bySession.get(sessionId);
    if (!set) {
      set = new Set();
      this.bySession.set(sessionId, set);
    }
    for (const name of names) {
      const n = name.trim();
      if (n) set.add(n);
    }
  }

  count(sessionId: string): number {
    return this.bySession.get(sessionId)?.size ?? 0;
  }

  forget(sessionId: string): void {
    this.bySession.delete(sessionId);
  }

  /**
   * Seed expand names from the latest standing `request/header` tools.
   * Idempotent merge — safe on every agent bind (mirror pathAllowlist.hydrate).
   */
  hydrate(store: SessionStore, sessionId: string): void {
    if (!store.has(sessionId)) return;
    const header = foldRequestHeader(readSessionEvents(store, sessionId));
    const tools = header?.tools;
    if (!tools || tools.length === 0) return;
    this.expand(
      sessionId,
      tools.map((t) => t.name).filter((n) => n.trim().length > 0),
    );
  }

  /** ToolSearchState bound to one session. */
  stateFor(sessionId: string): {
    readonly listExpanded: () => ReadonlySet<string>;
    readonly expand: (names: readonly string[]) => void;
  } {
    return {
      listExpanded: () => this.listExpanded(sessionId),
      expand: (names) => this.expand(sessionId, names),
    };
  }
}
