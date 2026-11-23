/**
 * Delegated-subagent subtree lifecycle helpers.
 *
 * Stop must not abort workers (sessionCancel ignores cascade). Archive and
 * permanent delete *are* lifecycle: tool-delegated children follow the parent
 * off the hot store. Fork children stay independent sidebar sessions.
 */

import { forgetSessionProcessCaches } from "@xrkseek/core-agent-loop";
import {
  sessionHintsBlank,
  sessionListHints,
} from "@xrkseek/core-session";
import { resolveXrkHome } from "@xrkseek/server-config";
import type { FaceRuntime } from "./context.js";
import { dispatchFaceMethod } from "./dispatch.js";
import { clearSessionModelSelection, sessionModelsPath } from "./session-model-store.js";
import { forgetSessionOpenerState } from "./session-opener.js";
import { unpinSessionAgentPreset } from "./session-agent-preset.js";
import { persistWorkspaceDoc } from "./workspace-store.js";

async function cancelSession(runtime: FaceRuntime, sessionId: string, tag: string): Promise<void> {
  // Idle sessions have nothing to join — skip the RPC so boot orphan wipe of
  // hundreds of cold ghosts does not serialize on noop cancels.
  if (!runtime.drain.isActive(sessionId)) return;
  try {
    await dispatchFaceMethod(runtime, "session.cancel", `${tag}-${sessionId}`, {
      sessionId,
    });
  } catch {
    /* best-effort teardown before wipe/archive */
  }
}

/** BFS of tool-delegated descendants (excludes `fork`). Parent-before-child. */
export function collectDelegatedDescendants(
  runtime: FaceRuntime,
  rootId: string,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const id = queue.shift()!;
    for (const link of runtime.subagents.listDelegated(id)) {
      const child = link.childSessionId;
      if (seen.has(child)) continue;
      seen.add(child);
      out.push(child);
      queue.push(child);
    }
  }
  return out;
}

export type WipeDurableSessionOptions = {
  /** Persist workspaces.json after forget (default true). */
  readonly persistWorkspace?: boolean;
  /** Call store.reclaimStorage after delete (default true). */
  readonly reclaim?: boolean;
  /** Publish archived/pinned set changes (default true). */
  readonly publishSets?: boolean;
};

/**
 * Permanently drop one session from store + registry + caches + subagent link.
 * Does **not** require the id to be archived (used for cascade children and
 * boot orphan repair).
 */
export async function wipeDurableSession(
  runtime: FaceRuntime,
  sessionId: string,
  options: WipeDurableSessionOptions = {},
): Promise<{ archivedSessionIds: string[]; pinnedSessionIds: string[] }> {
  const persistWorkspace = options.persistWorkspace !== false;
  const reclaim = options.reclaim !== false;
  const publishSets = options.publishSets !== false;

  if (runtime.store.has(sessionId) && typeof runtime.store.delete === "function") {
    await cancelSession(runtime, sessionId, "wipe");
    try {
      await runtime.onSessionFinalize?.(sessionId);
    } catch {
      /* Host Phase1 */
    }
    runtime.externalAgents.detach(sessionId);
    runtime.forkLineage.detach(sessionId);
    try {
      await runtime.invalidateAgent?.(sessionId);
    } catch {
      /* ignore */
    }
    runtime.store.delete(sessionId);
    if (reclaim) {
      try {
        runtime.store.reclaimStorage?.();
      } catch {
        /* reclaim optional */
      }
    }
  }

  runtime.subagents.detach(sessionId);
  runtime.agentTeams.removeNode(sessionId);
  runtime.agentTeamTasks.forgetByChild(sessionId);
  forgetSessionProcessCaches(sessionId);
  const sets = runtime.workspaces.forgetSession(sessionId);
  runtime.sessionIdentities.forget(sessionId);

  if (persistWorkspace) {
    await persistWorkspaceDoc(runtime, runtime.workspaces);
  }

  runtime.listProjectionCache.forget(sessionId);
  runtime.projections.evictSession(sessionId);
  runtime.wireIds.clear(sessionId);
  runtime.inboxWire.clear(sessionId);
  runtime.toolDisclosure.forget(sessionId);
  runtime.pathAllowlist.forget(sessionId);
  runtime.sessionModels.delete(sessionId);
  forgetSessionOpenerState(runtime, sessionId);
  try {
    clearSessionModelSelection(
      sessionModelsPath(runtime.productDir?.trim() || resolveXrkHome()),
      sessionId,
    );
  } catch {
    /* sidecar */
  }
  runtime.sessionCwds.delete(sessionId);
  runtime.sessionHasImage.delete(sessionId);
  runtime.sessionImageScanned.delete(sessionId);
  unpinSessionAgentPreset(runtime, sessionId);
  runtime.goals.forget(sessionId);

  runtime.bus.publishHost({
    type: "host/session-removed",
    sessionId,
    purged: true,
  });
  if (publishSets) {
    publishWorkspaceSetChanges(runtime, sets);
  }
  return sets;
}

/** Host mux: archived + pinned set snapshots after registry mutation. */
function publishWorkspaceSetChanges(
  runtime: FaceRuntime,
  sets: { archivedSessionIds: string[]; pinnedSessionIds: string[] },
): void {
  runtime.bus.publishHost({
    type: "host/archived-sessions-changed",
    archivedSessionIds: sets.archivedSessionIds,
  });
  runtime.bus.publishHost({
    type: "host/pinned-sessions-changed",
    pinnedSessionIds: sets.pinnedSessionIds,
  });
}

function publishListedWorkspaceSets(runtime: FaceRuntime): void {
  const listed = runtime.workspaces.list(runtime.store.list());
  publishWorkspaceSetChanges(runtime, listed);
}

/**
 * Wipe a root and every delegated descendant (children first). Used by
 * session.delete after the archived-gate on the user-facing root, and by
 * boot orphan repair (pass reclaim/persist/publish false and finish once).
 */
export async function wipeDurableSubtree(
  runtime: FaceRuntime,
  rootId: string,
  options: WipeDurableSessionOptions = {},
): Promise<{ archivedSessionIds: string[]; pinnedSessionIds: string[] }> {
  const descendants = collectDelegatedDescendants(runtime, rootId);
  for (const childId of [...descendants].reverse()) {
    await wipeDurableSession(runtime, childId, {
      persistWorkspace: false,
      reclaim: false,
      publishSets: false,
    });
  }
  return wipeDurableSession(runtime, rootId, {
    persistWorkspace: options.persistWorkspace !== false,
    reclaim: options.reclaim !== false,
    publishSets: options.publishSets !== false,
  });
}

/**
 * Archive+offload every delegated descendant of `rootId` (BFS order).
 * Parent archive itself stays at the call site.
 */
export async function archiveDelegatedDescendants(
  runtime: FaceRuntime,
  rootId: string,
): Promise<string[]> {
  const descendants = collectDelegatedDescendants(runtime, rootId);
  const archived: string[] = [];
  for (const sessionId of descendants) {
    if (runtime.workspaces.isArchived(sessionId)) {
      archived.push(sessionId);
      continue;
    }
    if (runtime.store.has(sessionId)) {
      await cancelSession(runtime, sessionId, "archive-child");
      try {
        await runtime.onSessionFinalize?.(sessionId);
      } catch {
        /* Host Phase1 */
      }
      try {
        runtime.store.offloadToArchive?.(sessionId);
      } catch {
        /* memory / missing */
      }
    }
    runtime.workspaces.archiveSession(sessionId);
    archived.push(sessionId);
  }
  return archived;
}

/**
 * Restore+unarchive delegated descendants that sit in the archive set.
 */
export function unarchiveDelegatedDescendants(
  runtime: FaceRuntime,
  rootId: string,
): string[] {
  const restored: string[] = [];
  for (const sessionId of collectDelegatedDescendants(runtime, rootId)) {
    if (!runtime.workspaces.isArchived(sessionId)) continue;
    try {
      runtime.store.restoreFromArchive?.(sessionId);
    } catch {
      /* memory / missing */
    }
    runtime.workspaces.unarchiveSession(sessionId);
    restored.push(sessionId);
  }
  return restored;
}

export type PruneStoreOptions = {
  /** Call store.reclaimStorage after work (default true). Boot chains false. */
  readonly reclaim?: boolean;
};

/**
 * Boot repair: delegated children whose parent is gone from the store are
 * permanent ghosts (hidden from sidebar, inflate sessions.db). Wipe them.
 * @returns how many child sessions were wiped.
 */
export async function pruneOrphanDelegatedSessions(
  runtime: FaceRuntime,
  options: PruneStoreOptions = {},
): Promise<number> {
  const reclaim = options.reclaim !== false;
  const orphans: string[] = [];
  const seen = new Set<string>();
  for (const link of runtime.subagents.entries()) {
    if (link.mode === "fork") continue;
    if (runtime.store.has(link.parentSessionId)) continue;
    const child = link.childSessionId;
    if (seen.has(child)) continue;
    seen.add(child);
    orphans.push(child);
  }
  // Only wipe roots whose parent is not itself an orphan — subtree wipe
  // clears nested delegated children in the same pass (else grandchildren
  // whose parent is also an orphan lingered until the next Host boot).
  const orphanSet = new Set(orphans);
  const roots = orphans.filter((id) => {
    const link = runtime.subagents.getByChild(id);
    if (!link) return true;
    return !orphanSet.has(link.parentSessionId);
  });
  roots.sort((a, b) => {
    const da = collectDelegatedDescendants(runtime, a).length;
    const db = collectDelegatedDescendants(runtime, b).length;
    return db - da;
  });
  let wiped = 0;
  for (const childId of roots) {
    if (!runtime.store.has(childId) && !runtime.workspaces.isArchived(childId)) {
      // Link-only ghost: detach the whole delegated subtree of links.
      for (const id of [...collectDelegatedDescendants(runtime, childId)].reverse()) {
        runtime.subagents.detach(id);
        runtime.workspaces.forgetSession(id);
        wiped += 1;
      }
      runtime.subagents.detach(childId);
      runtime.workspaces.forgetSession(childId);
      wiped += 1;
      continue;
    }
    const before = collectDelegatedDescendants(runtime, childId).length;
    await wipeDurableSubtree(runtime, childId, {
      persistWorkspace: false,
      reclaim: false,
      publishSets: false,
    });
    wiped += 1 + before;
  }
  if (wiped > 0) {
    if (reclaim) {
      try {
        runtime.store.reclaimStorage?.();
      } catch {
        /* reclaim optional */
      }
    }
    await persistWorkspaceDoc(runtime, runtime.workspaces);
    publishListedWorkspaceSets(runtime);
  }
  // Drop stale links whose child is fully gone (parent may still be live).
  for (const link of [...runtime.subagents.entries()]) {
    if (runtime.store.has(link.childSessionId)) continue;
    runtime.subagents.detach(link.childSessionId);
  }
  return wiped;
}

/**
 * Bring an archived / offloaded session back to the hot store before a write
 * path (prompt, fork, truncate, …). Opening an archived sidebar row used to
 * leave the log cold — `assertHotMutable` then threw on the first prompt.
 *
 * @returns true when a restore or unarchive ran.
 */
export async function ensureSessionHotWritable(
  runtime: FaceRuntime,
  sessionId: string,
): Promise<boolean> {
  if (!runtime.store.has(sessionId)) return false;
  const offloaded = runtime.store.isOffloaded?.(sessionId) === true;
  const archived = runtime.workspaces.isArchived(sessionId);
  if (!offloaded && !archived) return false;

  try {
    runtime.store.restoreFromArchive?.(sessionId);
  } catch {
    /* memory / missing archive row */
  }
  if (archived) {
    runtime.workspaces.unarchiveSession(sessionId);
    unarchiveDelegatedDescendants(runtime, sessionId);
    await persistWorkspaceDoc(runtime, runtime.workspaces);
    publishListedWorkspaceSets(runtime);
  }
  return true;
}

export type PruneExcessBlankOptions = PruneStoreOptions & {
  /**
   * Prefer this blank when several share a workspace (New Session just minted
   * it with inheritFrom). When omitted, keep the lexicographically newest id
   * (`sess_${Date.now().toString(36)}_…`).
   */
  readonly keepSessionId?: string;
  /** Limit the scan to one workspace; boot passes nothing (all workspaces). */
  readonly workspaceId?: string;
};

function isNewSessionBlank(runtime: FaceRuntime, sessionId: string): boolean {
  if (!runtime.store.has(sessionId)) return false;
  if (runtime.workspaces.isArchived(sessionId)) return false;
  // Catalog / fork children are not Hero blanks — never auto-wipe them here.
  if (runtime.subagents.getByChild(sessionId)) return false;
  return sessionHintsBlank(sessionListHints(runtime.store, sessionId));
}

/**
 * Cap New Session blanks at one per workspace.
 *
 * Client `connectWorkspace` skips reuse while the user is on a live chat so
 * inheritFrom can pin the route — but historically left the abandoned blanks
 * in the hot store (hidden from the sidebar, still in `sessionOrder` /
 * `sessions.db`). Wipe every surplus blank; also wipe membership-less blanks
 * (no workspace to reuse them under).
 *
 * @returns how many blank sessions were wiped.
 */
export async function pruneExcessBlankSessions(
  runtime: FaceRuntime,
  options: PruneExcessBlankOptions = {},
): Promise<number> {
  const keepId = options.keepSessionId?.trim() || "";
  const onlyWs = options.workspaceId?.trim() || "";
  const reclaim = options.reclaim !== false;

  const byWorkspace = new Map<string, string[]>();
  const noMembership: string[] = [];

  for (const sessionId of runtime.store.list()) {
    if (!isNewSessionBlank(runtime, sessionId)) continue;
    const ws = runtime.workspaces.workspaceIdOf(sessionId);
    if (!ws) {
      noMembership.push(sessionId);
      continue;
    }
    if (onlyWs && ws !== onlyWs) continue;
    const bucket = byWorkspace.get(ws) ?? [];
    bucket.push(sessionId);
    byWorkspace.set(ws, bucket);
  }

  const victims: string[] = [...noMembership];
  for (const ids of byWorkspace.values()) {
    if (ids.length <= 1) continue;
    const keeper =
      keepId && ids.includes(keepId)
        ? keepId
        : [...ids].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))[0]!;
    for (const id of ids) {
      if (id === keeper) continue;
      victims.push(id);
    }
  }

  if (victims.length === 0) return 0;

  let wiped = 0;
  for (const sessionId of victims) {
    await wipeDurableSession(runtime, sessionId, {
      persistWorkspace: false,
      reclaim: false,
      publishSets: false,
    });
    wiped += 1;
  }
  if (wiped > 0) {
    if (reclaim) {
      try {
        runtime.store.reclaimStorage?.();
      } catch {
        /* reclaim optional */
      }
    }
    await persistWorkspaceDoc(runtime, runtime.workspaces);
    publishListedWorkspaceSets(runtime);
  }
  return wiped;
}

export type BootStoreRepairStats = {
  readonly orphansWiped: number;
  readonly blanksWiped: number;
  readonly archivedOffloaded: number;
};

/**
 * One ordered boot repair for the durable session store.
 *
 * Previously orphan wipe (async) raced archived offload + VACUUM on the same
 * SQLite handle — reclaim could no-op under lock, and a mid-wipe throw aborted
 * blank prune via a single swallowed `.catch`. Run serially: orphans → blanks
 * → offload registry-archived rows still hot → reclaim.
 */
export async function repairSessionStoreOnBoot(
  runtime: FaceRuntime,
): Promise<BootStoreRepairStats> {
  // One VACUUM at the end — orphan/blank wipes defer reclaim.
  const orphansWiped = await pruneOrphanDelegatedSessions(runtime, {
    reclaim: false,
  });
  const blanksWiped = await pruneExcessBlankSessions(runtime, {
    reclaim: false,
  });

  let archivedOffloaded = 0;
  if (typeof runtime.store.offloadToArchive === "function") {
    for (const sessionId of runtime.workspaces.list(runtime.store.list())
      .archivedSessionIds) {
      if (!runtime.store.has(sessionId)) continue;
      if (runtime.store.isOffloaded?.(sessionId)) continue;
      try {
        runtime.store.offloadToArchive(sessionId);
        archivedOffloaded += 1;
      } catch {
        /* per-id */
      }
    }
  }

  if (orphansWiped > 0 || blanksWiped > 0 || archivedOffloaded > 0) {
    try {
      runtime.store.reclaimStorage?.();
    } catch {
      /* reclaim optional */
    }
  }

  return { orphansWiped, blanksWiped, archivedOffloaded };
}
