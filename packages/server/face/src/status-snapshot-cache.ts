/**
 * Revision-keyed cache for `session.status` / `/status` snapshots.
 *
 * Soft-poll from Overview hits this path every 1–3s. Finished heavy sessions
 * must not re-walk multi‑MB event logs (and every child log) on each tick —
 * only rebuild when the revision fingerprint moves.
 */

import { sessionEventCount } from "@xrkseek/core-session";
import type { FaceRuntime } from "./context.js";
import type { SessionStatusSnapshot } from "./session-status.js";

type CacheEntry = {
  readonly revision: string;
  readonly snapshot: SessionStatusSnapshot;
};

const cache = new Map<string, CacheEntry>();

/**
 * Cheap fingerprint of everything Status can change without appending events
 * (drain, jobs, presence, team graph, projection checkpoint, live children).
 */
export function statusSnapshotRevision(
  runtime: FaceRuntime,
  sessionId: string,
): string {
  const eventCount = Number(sessionEventCount(runtime.store, sessionId));
  const latch = runtime.drain.isActive(sessionId) ? "1" : "0";
  const turnIdle = runtime.isTurnUiIdle(sessionId) ? "1" : "0";
  const jobs = (runtime.jobViewsFor(sessionId) ?? [])
    .map((job) => `${job.id}:${job.status}`)
    .join(",");
  const presence = runtime.presence.get(sessionId);
  const tips = presence?.tips ?? "";
  const emotion = presence?.emotionId ?? "";
  const team = runtime.agentTeams.view(sessionId);
  const teamFp = `${team.nodes.length}:${team.edges.length}:${team.nodes
    .map((n) => n.id)
    .join(",")}`;
  const tasks = runtime.agentTeamTasks
    .list(sessionId)
    .map((t) => `${t.id}:${t.status}:${t.revision}`)
    .join(",");
  // Whole delegated subtree — a grandchild drain must bust the parent's cache.
  let childLive = "";
  const seen = new Set<string>([sessionId]);
  const queue = [sessionId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const link of runtime.subagents.listDelegated(id)) {
      const child = link.childSessionId;
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
      childLive += `${child}:${runtime.drain.isActive(child) ? "1" : "0"};`;
    }
  }
  // Child Status paints parent presence / delivery — include home fingerprints.
  const parentLink = runtime.subagents.getByChild(sessionId);
  const homeId = parentLink?.parentSessionId;
  const homePresence = homeId ? runtime.presence.get(homeId) : undefined;
  const homeFp = homeId
    ? [
        homeId,
        runtime.drain.isActive(homeId) ? "1" : "0",
        homePresence?.emotionId ?? "",
        homePresence?.tips ?? "",
        String(homePresence?.updatedAt ?? 0),
      ].join(":")
    : "";
  const badge = runtime.sessionAgentPresets.get(sessionId) ?? "";
  // eventCount covers projection cells that fold from the durable log.
  return [
    eventCount,
    latch,
    turnIdle,
    jobs,
    tips,
    emotion,
    teamFp,
    tasks,
    childLive,
    homeFp,
    badge,
  ].join("|");
}

/** Return a cached snapshot when the revision still matches. */
export function readStatusSnapshotCache(
  sessionId: string,
  revision: string,
): SessionStatusSnapshot | undefined {
  const hit = cache.get(sessionId);
  if (hit === undefined || hit.revision !== revision) return undefined;
  return hit.snapshot;
}

/** Store a freshly built snapshot under its revision. */
export function writeStatusSnapshotCache(
  sessionId: string,
  revision: string,
  snapshot: SessionStatusSnapshot,
): void {
  cache.set(sessionId, { revision, snapshot });
}

/** Drop one session (store eviction / delete). */
export function clearStatusSnapshotCache(sessionId: string): void {
  cache.delete(sessionId);
}

/** Test helper — wipe the process-local map. */
export function resetStatusSnapshotCacheForTests(): void {
  cache.clear();
}
