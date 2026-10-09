/**
 * Per-session expanded Deferred tools (progressive disclosure / tool_search).
 */

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
