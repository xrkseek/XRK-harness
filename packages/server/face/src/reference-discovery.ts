/**
 * Face-path discovery for `@file` and `@session` reference remotes.
 * Reuses bounded workspace search and session-list metadata; does not require
 * Cordis `ctx.sessionQuery` or session-reference prepare.
 */
import type { FileReferenceCandidate } from "@xrkseek/xrk-file-reference/types";
import {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
  WorkspaceFileSearch,
} from "@xrkseek/xrk-file-reference-local/search";
import { DEFAULT_CANDIDATE_LIMIT } from "@xrkseek/xrk-session-reference/config";
import { formatSessionReferenceMention } from "@xrkseek/xrk-session-reference/uri";
import type { SessionReferenceMentionCandidate } from "@xrkseek/xrk-session-reference/types";
import type { FaceRuntime } from "./context.js";
import { resolveSessionCwd } from "./session-cwd.js";

interface FileSearchEntry {
  readonly cwd: string;
  readonly search: WorkspaceFileSearch;
}

const fileSearches = new Map<string, FileSearchEntry>();

function fileSearchFor(
  sessionId: string,
  cwd: string,
): WorkspaceFileSearch {
  const existing = fileSearches.get(sessionId);
  if (existing !== undefined && existing.cwd === cwd) {
    return existing.search;
  }
  existing?.search.dispose();
  const search = new WorkspaceFileSearch(cwd, {
    maxResults: DEFAULT_FILE_SEARCH_MAX_RESULTS,
    maxEntries: DEFAULT_FILE_SEARCH_MAX_ENTRIES,
    excludedDirectories: [...DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES],
  });
  fileSearches.set(sessionId, { cwd, search });
  return search;
}

/** List path-only file candidates for one session cwd. */
export async function listFileReferenceCandidates(
  sessionId: string,
  cwd: string,
  query: string,
  signal: AbortSignal,
): Promise<FileReferenceCandidate[]> {
  signal.throwIfAborted();
  return fileSearchFor(sessionId, cwd).list(query, signal);
}

function candidateRank(
  candidateCwd: string | undefined,
  targetCwd: string,
): number {
  if (candidateCwd !== undefined && candidateCwd === targetCwd) return 0;
  if (candidateCwd === undefined) return 1;
  return 2;
}

/** List session mention candidates from Face session list metadata. */
export function listSessionReferenceCandidates(
  runtime: FaceRuntime,
  agentId: string,
  query: string,
  limit: number = DEFAULT_CANDIDATE_LIMIT,
): SessionReferenceMentionCandidate[] {
  if (!Number.isSafeInteger(limit) || limit <= 0) {
    throw new Error("session-reference candidate limit must be a positive safe integer");
  }
  const targetCwd = resolveSessionCwd(runtime, agentId);
  const needle = query.toLocaleLowerCase();
  const records = runtime.store.list().flatMap((sessionId, index) => {
    if (sessionId === agentId) return [];
    const snap = runtime.projections.snapshot(sessionId);
    const cwd = resolveSessionCwd(runtime, sessionId);
    const title = snap.values.title ?? null;
    const label = title ?? sessionId;
    const meta = snap.values.sessionListMetadata;
    const lastPromptAt = meta?.lastPromptAt ?? null;
    const hints = runtime.store.listHints?.(sessionId);
    const createdAt = Math.max(
      hints?.lastEventTs ?? 0,
      lastPromptAt ?? 0,
    );
    return [{ sessionId, cwd, label, createdAt, index }];
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

  const filtered = inspected
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
    .slice(0, limit);

  return filtered.map(({ sessionId, cwd, label, createdAt }) => {
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
