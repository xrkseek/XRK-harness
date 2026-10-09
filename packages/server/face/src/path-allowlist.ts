/**
 * Session object-path allowlist (workspace-write / read-only overreach).
 * Entries are absolute file or directory paths — never tool names.
 */

import path from "node:path";
import { readSessionEvents, type SessionStore } from "@xrkseek/core-session";

export class SessionPathAllowlist {
  private readonly permanent = new Map<string, Set<string>>();
  private readonly once = new Map<string, Set<string>>();
  /** Child → parent for inherited allowlist views. */
  private readonly parentOf = new Map<string, string>();

  /** Link child so {@link list} includes the parent's permanent paths. */
  inherit(childSessionId: string, parentSessionId: string): void {
    if (childSessionId === parentSessionId) return;
    this.parentOf.set(childSessionId, parentSessionId);
  }

  /** Hydrate permanent entries from durable `path/allowlisted` events. */
  hydrate(store: SessionStore, sessionId: string): void {
    if (!store.has(sessionId)) return;
    for (const event of readSessionEvents(store, sessionId)) {
      if (event.type !== "path/allowlisted") continue;
      this.addPermanent(sessionId, event.path, { persist: false });
    }
  }

  addPermanent(
    sessionId: string,
    userPath: string,
    options?: { readonly persist?: boolean; readonly store?: SessionStore },
  ): string {
    const abs = path.resolve(userPath);
    let set = this.permanent.get(sessionId);
    if (!set) {
      set = new Set();
      this.permanent.set(sessionId, set);
    }
    const already = set.has(abs);
    set.add(abs);
    if (!already && options?.persist !== false && options?.store) {
      options.store.append(sessionId, {
        type: "path/allowlisted",
        ts: Date.now(),
        path: abs,
      });
    }
    return abs;
  }

  addOnce(sessionId: string, userPath: string): string {
    const abs = path.resolve(userPath);
    let set = this.once.get(sessionId);
    if (!set) {
      set = new Set();
      this.once.set(sessionId, set);
    }
    set.add(abs);
    return abs;
  }

  /** Drop ephemeral once-grants after the tool call that used them. */
  clearOnce(sessionId: string): void {
    this.once.delete(sessionId);
  }

  /**
   * Live roots for fs / bash: parent permanent ∪ own permanent ∪ once.
   */
  list(sessionId: string): readonly string[] {
    const out = new Set<string>();
    const walk = (id: string, depth: number): void => {
      if (depth > 8) return;
      const parent = this.parentOf.get(id);
      if (parent) walk(parent, depth + 1);
      const perm = this.permanent.get(id);
      if (perm) for (const p of perm) out.add(p);
    };
    walk(sessionId, 0);
    const once = this.once.get(sessionId);
    if (once) for (const p of once) out.add(p);
    return [...out];
  }

  count(sessionId: string): number {
    return this.list(sessionId).length;
  }

  forget(sessionId: string): void {
    this.permanent.delete(sessionId);
    this.once.delete(sessionId);
    this.parentOf.delete(sessionId);
    for (const [child, parent] of this.parentOf) {
      if (parent === sessionId) this.parentOf.delete(child);
    }
  }
}
