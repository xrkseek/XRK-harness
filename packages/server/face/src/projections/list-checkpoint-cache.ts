/**
 * Codex-style cold list column: persist list-tier projection checkpoints so
 * `session.list` never folds a cold session log. Wired keys only
 * (`title` · `sessionListMetadata`); heavy keys stay out.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type {
  FaceProjectionRegistry,
  ProjectionCheckpoint,
  ProjectionSnapshot,
} from "./registry.js";
import { SESSION_LIST_PROJECTION_KEYS } from "./snapshot-keys.js";

export interface FaceListProjectionCache {
  /** Capture list-tier rows from a live registry checkpoint before eviction. */
  remember(sessionId: string, checkpoint: ProjectionCheckpoint): void;
  /** Wire block for a cold row, or undefined on miss / version mismatch. */
  cachedSnapshot(
    sessionId: string,
    registry: FaceProjectionRegistry,
  ): ProjectionSnapshot | undefined;
  /** Drop one session (optional; eviction keeps the row). */
  forget(sessionId: string): void;
  /** Persist to disk when a path is configured. */
  flush(): void;
}

interface CacheFile {
  readonly version: 1;
  readonly sessions: Record<
    string,
    { readonly asOfSeq: number; readonly checkpoint: ProjectionCheckpoint }
  >;
}

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

function asOfSeqOf(checkpoint: ProjectionCheckpoint): number {
  let max = -1;
  for (const row of Object.values(checkpoint)) {
    if (row !== undefined && row.seq > max) max = row.seq;
  }
  return max;
}

/**
 * @param filePath - optional JSON path (`{sessionsDir}/projection-list-cache.json`).
 */
export function createFaceListProjectionCache(
  filePath?: string,
): FaceListProjectionCache {
  const sessions = new Map<
    string,
    { asOfSeq: number; checkpoint: ProjectionCheckpoint }
  >();
  let dirty = false;

  if (filePath) {
    try {
      const raw = JSON.parse(readFileSync(filePath, "utf8")) as CacheFile;
      if (raw?.version === 1 && raw.sessions && typeof raw.sessions === "object") {
        for (const [id, row] of Object.entries(raw.sessions)) {
          if (!row?.checkpoint || typeof row.asOfSeq !== "number") continue;
          sessions.set(id, {
            asOfSeq: row.asOfSeq,
            checkpoint: row.checkpoint,
          });
        }
      }
    } catch {
      /* missing / corrupt → empty cold column */
    }
  }

  const flush = (): void => {
    if (!filePath || !dirty) return;
    const payload: CacheFile = {
      version: 1,
      sessions: Object.fromEntries(
        [...sessions.entries()].map(([id, row]) => [
          id,
          { asOfSeq: row.asOfSeq, checkpoint: row.checkpoint },
        ]),
      ),
    };
    mkdirSync(path.dirname(filePath), { recursive: true });
    const tmp = `${filePath}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(payload)}\n`, "utf8");
    renameSync(tmp, filePath);
    dirty = false;
  };

  return {
    remember(sessionId, checkpoint) {
      const picked = pickListCheckpoint(checkpoint);
      if (Object.keys(picked).length === 0) return;
      sessions.set(sessionId, {
        asOfSeq: asOfSeqOf(picked),
        checkpoint: structuredClone(picked),
      });
      dirty = true;
      flush();
    },

    cachedSnapshot(sessionId, registry) {
      const row = sessions.get(sessionId);
      if (row === undefined) return undefined;
      const values = registry.viewCheckpoint(row.checkpoint);
      const filtered: Record<string, unknown> = {};
      for (const key of SESSION_LIST_PROJECTION_KEYS) {
        if (key in values) filtered[key] = values[key];
      }
      if (Object.keys(filtered).length === 0) return undefined;
      return { asOfSeq: row.asOfSeq, values: filtered };
    },

    forget(sessionId) {
      if (!sessions.delete(sessionId)) return;
      dirty = true;
      flush();
    },

    flush,
  };
}
