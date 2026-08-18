import type { RealmRef, Scope } from "./types.js";

/**
 * C2: open an isolated child Scope for a subagent session id.
 * Does not spawn agents or invent session events — Host / Face own that.
 */
export function openSubagentRealm(
  parent: Scope,
  opts: {
    readonly sessionId: string;
    readonly isolate?: readonly RealmRef[];
    readonly depend?: readonly RealmRef[];
  },
): Scope {
  const sessionId = opts.sessionId.trim();
  if (!sessionId) {
    throw new Error("openSubagentRealm: sessionId required");
  }
  return parent.child({
    id: `subagent:${sessionId}`,
    ...(opts.isolate !== undefined ? { isolate: [...opts.isolate] } : {}),
    ...(opts.depend !== undefined ? { depend: [...opts.depend] } : {}),
  });
}
