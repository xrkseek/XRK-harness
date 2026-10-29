/**
 * Codex-style cold list column: persist list-tier projection checkpoints so
 * `session.list` never folds a cold session log. Wired list keys
 * (`title` · `sessionListMetadata`) stay in {@link FaceListProjectionCache.cachedSnapshot};
 * optional history-tier rows (R9) ride the same file for cold `session.history`.
 *
 * Rows carry a lifecycle identity so a deleted/recreated/truncated session
 * never reuses another life’s title after restart (DSH projection-cache
 * header check). After a list-identity format bump, {@link cachedPredecessorTitle}
 * still serves a zero-I/O title hint from the older row (DSH
 * `cachedPredecessorTitle`); hydration / {@link peekCheckpoint} keep requiring
 * an exact identity match so predecessor folds never seed live cells.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { SessionListHints } from "@xrkseek/core-session";
import type {
  FaceProjectionRegistry,
  ProjectionCheckpoint,
  ProjectionSnapshot,
} from "./registry.js";
import {
  SESSION_HISTORY_CACHE_KEYS,
  SESSION_LIST_PROJECTION_KEYS,
} from "./snapshot-keys.js";

/**
 * Bump when identity fields / semantics change. Distinct from the on-disk
 * cache file `version` (currently 2).
 */
export const LIST_PROJECTION_IDENTITY_VERSION = 1;

/** On-disk / in-memory identity for one cold list row. */
export interface ListProjectionIdentity {
  readonly formatVersion: number;
  readonly eventCount: number;
  readonly lastEventTs: number | null;
}

export interface FaceListProjectionCache {
  /**
   * Capture list-tier (+ optional history-tier) rows from a live registry
   * checkpoint before eviction. History keys are ignored by cold list wire.
   */
  remember(
    sessionId: string,
    checkpoint: ProjectionCheckpoint,
    identity: ListProjectionIdentity,
  ): void;
  /** Wire block for a cold row, or undefined on miss / version / identity mismatch. */
  cachedSnapshot(
    sessionId: string,
    registry: FaceProjectionRegistry,
    expectedIdentity: ListProjectionIdentity,
  ): ProjectionSnapshot | undefined;
  /**
   * Title-only listing hint from a predecessor format generation (same
   * eventCount / lastEventTs, older `formatVersion`). Zero I/O; never seeds a
   * fold. `undefined` when the row is current, newer, unrelated, or title
   * incompatible with the live unit.
   */
  cachedPredecessorTitle(
    sessionId: string,
    registry: FaceProjectionRegistry,
    expectedIdentity: ListProjectionIdentity,
  ): ProjectionSnapshot | undefined;
  /**
   * Raw list-tier checkpoint for seeding live cells on open (identity must match).
   * Does not discard on miss — caller falls back to a full fold.
   */
  peekCheckpoint(
    sessionId: string,
    expectedIdentity: ListProjectionIdentity,
  ): ProjectionCheckpoint | undefined;
  /**
   * Raw history-tier checkpoint (R9). Identity must match; miss → caller folds.
   */
  peekHistoryCheckpoint(
    sessionId: string,
    expectedIdentity: ListProjectionIdentity,
  ): ProjectionCheckpoint | undefined;
  /** Drop one session (optional; eviction keeps the row). */
  forget(sessionId: string): void;
  /** Persist to disk when a path is configured. */
  flush(): void;
}

interface CacheFileV2 {
  readonly version: 2;
  readonly sessions: Record<
    string,
    {
      readonly asOfSeq: number;
      readonly identity: ListProjectionIdentity;
      readonly checkpoint: ProjectionCheckpoint;
      /** Optional R9 history-tier rows; older files omit this. */
      readonly historyCheckpoint?: ProjectionCheckpoint;
    }
  >;
}

type CacheRow = {
  asOfSeq: number;
  identity: ListProjectionIdentity;
  checkpoint: ProjectionCheckpoint;
  historyCheckpoint?: ProjectionCheckpoint;
};

function pickListCheckpoint(
  checkpoint: ProjectionCheckpoint,
): ProjectionCheckpoint {
  const out: ProjectionCheckpoint = {};
  for (const key of SESSION_LIST_PROJECTION_KEYS) {
    const row = checkpoint[key];
    if (row !== undefined) out[key] = row;
  }
  return out;
}

function pickHistoryCheckpoint(
  checkpoint: ProjectionCheckpoint,
): ProjectionCheckpoint {
  const out: ProjectionCheckpoint = {};
  for (const key of SESSION_HISTORY_CACHE_KEYS) {
    const row = checkpoint[key];
    if (row !== undefined) out[key] = row;
  }
  return out;
}

function identityEquals(
  a: ListProjectionIdentity,
  b: ListProjectionIdentity,
): boolean {
  return (
    a.formatVersion === b.formatVersion
    && a.eventCount === b.eventCount
    && a.lastEventTs === b.lastEventTs
  );
}

/** Format-independent fields that distinguish one Session lifecycle. */
function lifecycleIdentityMatches(
  stored: ListProjectionIdentity,
  expected: ListProjectionIdentity,
): boolean {
  return (
    stored.eventCount === expected.eventCount
    && stored.lastEventTs === expected.lastEventTs
  );
}

/**
 * Older list-identity format for the same lifecycle — title may still be a
 * genuine (possibly stale) fact; other keys stay rejected.
 */
function predecessorIdentityMatches(
  stored: ListProjectionIdentity,
  expected: ListProjectionIdentity,
): boolean {
  return (
    stored.formatVersion < expected.formatVersion
    && lifecycleIdentityMatches(stored, expected)
  );
}

/** Build identity from store list hints (no hydrate). */
export function listProjectionIdentityFromHints(
  hints: SessionListHints,
): ListProjectionIdentity {
  return {
    formatVersion: LIST_PROJECTION_IDENTITY_VERSION,
    eventCount: hints.eventCount,
    lastEventTs: hints.lastEventTs,
  };
}

/**
 * @param filePath - optional JSON path (`{sessionsDir}/projection-list-cache.json`).
 */
export function createFaceListProjectionCache(
  filePath?: string,
): FaceListProjectionCache {
  const sessions = new Map<string, CacheRow>();
  let dirty = false;

  if (filePath) {
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf8")) as {
        version?: number;
        sessions?: CacheFileV2["sessions"];
      };
      // v1 rows had no identity — drop them rather than risk a wrong title.
      if (raw?.version === 2 && raw.sessions && typeof raw.sessions === "object") {
        for (const [id, row] of Object.entries(raw.sessions)) {
          if (!row?.checkpoint || typeof row.asOfSeq !== "number") continue;
          if (!row.identity || typeof row.identity.eventCount !== "number") {
            continue;
          }
          const entry: CacheRow = {
            asOfSeq: row.asOfSeq,
            identity: {
              formatVersion: row.identity.formatVersion,
              eventCount: row.identity.eventCount,
              lastEventTs: row.identity.lastEventTs,
            },
            checkpoint: row.checkpoint,
          };
          if (
            row.historyCheckpoint
            && typeof row.historyCheckpoint === "object"
          ) {
            entry.historyCheckpoint = row.historyCheckpoint;
          }
          sessions.set(id, entry);
        }
      }
    } catch {
      /* missing / corrupt → empty cold column */
    }
  }

  /**
   * Persist dirty rows. I/O failures keep the in-memory column + dirty flag
   * so eviction can still serve cold `session.list` in-process and a later
   * flush can retry — never clear live cells without a remember.
   */
  const flush = (): void => {
    if (!filePath || !dirty) return;
    const payload: CacheFileV2 = {
      version: 2,
      sessions: Object.fromEntries(
        [...sessions.entries()].map(([id, row]) => [
          id,
          {
            asOfSeq: row.asOfSeq,
            identity: row.identity,
            checkpoint: row.checkpoint,
            ...(row.historyCheckpoint !== undefined
              ? { historyCheckpoint: row.historyCheckpoint }
              : {}),
          },
        ]),
      ),
    };
    try {
      mkdirSync(path.dirname(filePath), { recursive: true });
      const tmp = `${filePath}.${process.pid}.tmp`;
      writeFileSync(tmp, `${JSON.stringify(payload)}\n`, "utf8");
      renameSync(tmp, filePath);
      dirty = false;
    } catch {
      /* cold column stays in memory until a later successful flush */
    }
  };

  // Cache writes used to run synchronously inside `remember`, i.e. on the open
  // RPC's tail — one full JSON rewrite of every session per open. Debounce it;
  // a crash only loses the last few hundred ms and cold list falls back to
  // `listHints` (never wrong, just slower).
  let flushTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleFlush = (): void => {
    if (flushTimer !== undefined) return;
    flushTimer = setTimeout(() => {
      flushTimer = undefined;
      flush();
    }, 500);
    (flushTimer as { unref?: () => void }).unref?.();
  };
  const flushNow = (): void => {
    if (flushTimer !== undefined) {
      clearTimeout(flushTimer);
      flushTimer = undefined;
    }
    flush();
  };

  /** Drop a corrupt/unusable row so cold list falls back to listHints. */
  const discard = (sessionId: string): void => {
    if (!sessions.delete(sessionId)) return;
    dirty = true;
    scheduleFlush();
  };

  return {
    remember(sessionId, checkpoint, identity) {
      const picked = pickListCheckpoint(checkpoint);
      const history = pickHistoryCheckpoint(checkpoint);
      const prev = sessions.get(sessionId);
      const nextList =
        Object.keys(picked).length > 0
          ? structuredClone(picked)
          : prev?.checkpoint;
      if (nextList === undefined || Object.keys(nextList).length === 0) {
        discard(sessionId);
        return;
      }
      // Keep prior history only when identity still matches (same lifecycle).
      const nextHistory =
        Object.keys(history).length > 0
          ? structuredClone(history)
          : prev !== undefined && identityEquals(prev.identity, identity)
            ? prev.historyCheckpoint
            : undefined;
      sessions.set(sessionId, {
        asOfSeq: lowestCheckpointSeq(nextList),
        identity: { ...identity },
        checkpoint: nextList,
        ...(nextHistory !== undefined
          ? { historyCheckpoint: nextHistory }
          : {}),
      });
      dirty = true;
      scheduleFlush();
    },

    cachedSnapshot(sessionId, registry, expectedIdentity) {
      const row = sessions.get(sessionId);
      if (row === undefined) return undefined;
      if (!identityEquals(row.identity, expectedIdentity)) {
        // Keep a usable predecessor row for {@link cachedPredecessorTitle};
        // only drop when the lifecycle clearly diverged (or the cache is ahead).
        if (!predecessorIdentityMatches(row.identity, expectedIdentity)) {
          discard(sessionId);
        }
        return undefined;
      }
      let values: Record<string, unknown>;
      try {
        values = registry.viewCheckpoint(row.checkpoint);
      } catch {
        discard(sessionId);
        return undefined;
      }
      const filtered: Record<string, unknown> = {};
      for (const key of SESSION_LIST_PROJECTION_KEYS) {
        if (key in values) filtered[key] = values[key];
      }
      // viewCheckpoint omits malformed wired rows ("consumer refolds"). Face
      // cold list does not refold — any stored list key that failed parse is a
      // miss (honest listHints), never a silent partial untitled/wrong snap.
      for (const key of SESSION_LIST_PROJECTION_KEYS) {
        if (row.checkpoint[key] !== undefined && !(key in filtered)) {
          discard(sessionId);
          return undefined;
        }
      }
      if (Object.keys(filtered).length === 0) {
        discard(sessionId);
        return undefined;
      }
      return { asOfSeq: row.asOfSeq, values: filtered };
    },

    cachedPredecessorTitle(sessionId, registry, expectedIdentity) {
      const row = sessions.get(sessionId);
      if (row === undefined) return undefined;
      if (!predecessorIdentityMatches(row.identity, expectedIdentity)) {
        return undefined;
      }
      const titleRow = row.checkpoint.title;
      if (titleRow === undefined) return undefined;
      let values: Record<string, unknown>;
      try {
        values = registry.viewCheckpoint({ title: titleRow });
      } catch {
        return undefined;
      }
      if (!("title" in values)) return undefined;
      const title = values.title;
      if (title !== null && typeof title !== "string") return undefined;
      return {
        asOfSeq: titleRow.seq,
        values: { title },
      };
    },

    peekCheckpoint(sessionId, expectedIdentity) {
      const row = sessions.get(sessionId);
      if (row === undefined) return undefined;
      if (!identityEquals(row.identity, expectedIdentity)) return undefined;
      return structuredClone(row.checkpoint);
    },

    peekHistoryCheckpoint(sessionId, expectedIdentity) {
      const row = sessions.get(sessionId);
      if (row === undefined || row.historyCheckpoint === undefined) {
        return undefined;
      }
      if (!identityEquals(row.identity, expectedIdentity)) return undefined;
      return structuredClone(row.historyCheckpoint);
    },

    forget(sessionId) {
      discard(sessionId);
    },

    flush: flushNow,
  };
}
/**
 * Lowest checkpoint watermark: the seq that **every** cached value is current
 * as of.
 *
 * The client seeds its incremental baseline from this number and drops rows at
 * or below it (`projection-store` skips `row.seq > asOfSeq`). Taking the
 * highest row seq would advertise the freshest key's position for the whole
 * map, so the rows between the true watermark and the claimed one are skipped
 * and the lagging key stays frozen on its cached value.
 * @param checkpoint - stored rows, one per projection key.
 * @returns the lowest row seq, or -1 when the checkpoint is empty.
 */
export function lowestCheckpointSeq(checkpoint: ProjectionCheckpoint): number {
  let min = Number.POSITIVE_INFINITY;
  for (const row of Object.values(checkpoint)) {
    if (row !== undefined && row.seq < min) min = row.seq;
  }
  return min === Number.POSITIVE_INFINITY ? -1 : min;
}
