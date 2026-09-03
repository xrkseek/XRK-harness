/**
 * Face-path session reads for cross-session references and discovery.
 * Replaces Cordis `ctx.sessionQuery` on the Host main path.
 *
 * @module @xrkseek/face-session-query
 */

import { readSessionEvents, type SessionStore } from "@xrkseek/core-session";
import type { SessionReferenceMentionCandidate } from "@xrkseek/xrk-session-reference/types";
import { DEFAULT_CANDIDATE_LIMIT } from "@xrkseek/xrk-session-reference/config";
import { formatSessionReferenceMention } from "@xrkseek/xrk-session-reference/uri";
import {
  buildFaceSessionSurface,
  projectFaceSessionConversation,
  type FaceSessionSurface,
} from "@xrkseek/xrk-session-reference/surface";
import {
  retainProjectedConversation,
  type ReferencedSessionData,
  type ReferenceRetentionStats,
} from "@xrkseek/xrk-session-reference/retention";

export type {
  FaceSessionSurface,
  ReferencedSessionData,
  ReferenceRetentionStats,
};

/** Optional Face projection hooks for session list labels. */
export interface FaceSessionListProjections {
  titleOf(sessionId: string): string | null | undefined;
  lastPromptAtOf(sessionId: string): number | null | undefined;
}

export interface FaceSessionRecord {
  readonly sessionId: string;
  readonly cwd: string;
  readonly label: string;
  readonly createdAt: number;
  readonly index: number;
}

function candidateRank(
  candidateCwd: string | undefined,
  targetCwd: string,
): number {
  if (candidateCwd !== undefined && candidateCwd === targetCwd) return 0;
  if (candidateCwd === undefined) return 1;
  return 2;
}

/** List session ids with cwd/title metadata from Face store + projections. */
export function listFaceSessionRecords(
  store: SessionStore,
  options: {
    readonly excludeSessionId?: string;
    readonly resolveCwd: (sessionId: string) => string;
    readonly projections?: FaceSessionListProjections;
  },
): FaceSessionRecord[] {
  return store.list().flatMap((sessionId, index) => {
    if (sessionId === options.excludeSessionId) return [];
    const cwd = options.resolveCwd(sessionId);
    const hints = store.listHints?.(sessionId);
    const loaded = store.isLoaded?.(sessionId) ?? false;
    let label = sessionId;
    let lastPromptAt: number | null = null;
    if (loaded && options.projections) {
      const title = options.projections.titleOf(sessionId);
      if (typeof title === "string" && title.trim()) label = title;
      lastPromptAt = options.projections.lastPromptAtOf(sessionId) ?? null;
    }
    const createdAt = Math.max(hints?.lastEventTs ?? 0, lastPromptAt ?? 0);
    return [{ sessionId, cwd, label, createdAt, index }];
  });
}

/** Session mention candidates for Face `sessionReferenceResolver/candidates`. */
export function listFaceSessionReferenceCandidates(
  store: SessionStore,
  options: {
    readonly agentId: string;
    readonly query?: string;
    readonly limit?: number;
    readonly resolveCwd: (sessionId: string) => string;
    readonly projections?: FaceSessionListProjections;
  },
): SessionReferenceMentionCandidate[] {
  const limit = options.limit ?? DEFAULT_CANDIDATE_LIMIT;
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error(
      "session-reference candidate limit must be a positive safe integer",
    );
  }
  const targetCwd = options.resolveCwd(options.agentId);
  const needle = (options.query ?? "").toLocaleLowerCase();
  const records = listFaceSessionRecords(store, {
    excludeSessionId: options.agentId,
    resolveCwd: options.resolveCwd,
    ...(options.projections ? { projections: options.projections } : {}),
  });

  const inspected =
    needle === ""
      ? [...records]
          .sort(
            (a, b) =>
              candidateRank(a.cwd, targetCwd) -
                candidateRank(b.cwd, targetCwd) || a.index - b.index,
          )
          .slice(0, limit)
      : records;

  return inspected
    .filter(({ sessionId, cwd, label }) => {
      if (needle === "") return true;
      return (
        sessionId.toLocaleLowerCase().includes(needle) ||
        cwd.toLocaleLowerCase().includes(needle) ||
        label.toLocaleLowerCase().includes(needle)
      );
    })
    .sort(
      (a, b) =>
        candidateRank(a.cwd, targetCwd) - candidateRank(b.cwd, targetCwd) ||
        a.index - b.index,
    )
    .slice(0, limit)
    .map(({ sessionId, cwd, label, createdAt }) => {
      const id = sessionId as SessionReferenceMentionCandidate["sessionId"];
      return {
        sessionId: id,
        label,
        createdAt,
        ...(cwd.length > 0 ? { cwd } : {}),
        mention: formatSessionReferenceMention({ sessionId: id, label }),
      };
    });
}

/** Read one session surface from Face {@link SessionStore}. */
export function readFaceSessionSurface(
  store: SessionStore,
  sessionId: string,
  cwd?: string,
): FaceSessionSurface {
  return buildFaceSessionSurface(sessionId, readSessionEvents(store, sessionId), cwd);
}

/** Project + retain one referenced session under a byte budget. */
export function retainFaceReferencedSession(
  store: SessionStore,
  input: {
    readonly sessionId: string;
    readonly label: string;
    readonly cwd?: string;
    readonly maxBytes: number;
  },
):
  | { data: ReferencedSessionData; stats: ReferenceRetentionStats }
  | undefined {
  const surface = readFaceSessionSurface(
    store,
    input.sessionId,
    input.cwd,
  );
  const projected = projectFaceSessionConversation(surface);
  const capturedThroughSeq =
    surface.events.length > 0 ? surface.events.length : null;
  return retainProjectedConversation(
    {
      sessionId: surface.sessionId,
      label: input.label,
      cwd: surface.cwd,
      capturedThroughSeq,
    },
    projected,
    input.maxBytes,
  );
}
