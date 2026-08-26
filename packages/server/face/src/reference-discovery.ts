/**
 * Face-path discovery for `@file` and `@session` reference remotes.
 */
import type { FileReferenceCandidate } from "@xrkseek/xrk-file-reference/types";
import {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
  WorkspaceFileSearch,
} from "@xrkseek/xrk-file-reference-local/search";
import {
  listFaceSessionReferenceCandidates,
  type FaceSessionListProjections,
} from "@xrkseek/face-session-query";
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

function faceProjections(runtime: FaceRuntime): FaceSessionListProjections {
  return {
    titleOf(sessionId) {
      const title = runtime.projections.stateOf(sessionId, "title") as
        | string
        | null
        | undefined;
      return title;
    },
    lastPromptAtOf(sessionId) {
      const meta = runtime.projections.stateOf(
        sessionId,
        "sessionListMetadata",
      ) as { readonly lastPromptAt?: number | null } | undefined;
      return meta?.lastPromptAt ?? null;
    },
  };
}

/** List session mention candidates from Face session list metadata. */
export function listSessionReferenceCandidates(
  runtime: FaceRuntime,
  agentId: string,
  query: string,
  limit?: number,
): SessionReferenceMentionCandidate[] {
  return listFaceSessionReferenceCandidates(runtime.store, {
    agentId,
    query,
    ...(limit !== undefined ? { limit } : {}),
    resolveCwd: (sessionId) => resolveSessionCwd(runtime, sessionId),
    projections: faceProjections(runtime),
  });
}
