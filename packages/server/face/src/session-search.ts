import type { SessionEvent } from "@xrkseek/protocol";
import {
  extractSessionSearchTexts,
  readSessionEvents,
  type SessionStore,
} from "@xrkseek/core-session";
import type { FaceRpcResult } from "./types.js";

/** Wire-compatible with deepseek-harness session.search. */
export const SESSION_SEARCH_RESULT_LIMIT = 20;
export const SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS = 240;
export const SESSION_SEARCH_QUERY_MAX_CHARS = 500;

export interface SessionSearchItem {
  readonly sessionId: string;
  readonly snippet: string;
}

export interface SessionSearchValue {
  readonly items: readonly SessionSearchItem[];
  readonly hasMore: boolean;
}

function truncateCodePoints(text: string, max: number): string {
  const chars = [...text];
  if (chars.length <= max) return text;
  return chars.slice(0, max).join("");
}

function hasFtsSearch(
  store: SessionStore,
): store is SessionStore & {
  searchSessionIds(query: string): readonly string[];
} {
  return (
    "searchSessionIds" in store &&
    typeof (store as { searchSessionIds?: unknown }).searchSessionIds ===
      "function"
  );
}

function lastEventTs(events: readonly SessionEvent[]): number {
  let max = 0;
  for (const e of events) {
    if (e.ts > max) max = e.ts;
  }
  return max;
}

function bestSnippet(texts: readonly string[], needle: string): string | undefined {
  const lowerNeedle = needle.toLowerCase();
  for (const text of texts) {
    const idx = text.toLowerCase().indexOf(lowerNeedle);
    if (idx < 0) continue;
    const start = Math.max(0, idx - 40);
    const window = text.slice(start, idx + needle.length + 120);
    const prefix = start > 0 ? "…" : "";
    return truncateCodePoints(`${prefix}${window}`, SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS);
  }
  return undefined;
}

export function parseSearchQuery(payload: unknown): FaceRpcResult<string> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "query required" },
    };
  }
  const raw = (payload as Record<string, unknown>).query;
  if (typeof raw !== "string") {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "query required" },
    };
  }
  if (raw.includes("\0")) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "search query must not contain NUL",
      },
    };
  }
  const query = raw.trim();
  if (!query) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "query required" },
    };
  }
  if (query.length > SESSION_SEARCH_QUERY_MAX_CHARS) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: `query must be at most ${SESSION_SEARCH_QUERY_MAX_CHARS} characters`,
      },
    };
  }
  return { ok: true, value: query };
}

/**
 * Session search over user/assistant/admit/safety plus command text and
 * standing todos. One hit per session; newest activity first.
 * Persistent SQLite store uses FTS5 trigram for candidates; memory store
 * scans in process. Snippets always come from loaded events.
 */
export function searchSessions(
  store: SessionStore,
  query: string,
): SessionSearchValue {
  const hits: (SessionSearchItem & { readonly lastTs: number })[] = [];
  const candidateIds = hasFtsSearch(store)
    ? store.searchSessionIds(query)
    : store.list();

  for (const sessionId of candidateIds) {
    if (!store.has(sessionId)) continue;
    const events = readSessionEvents(store, sessionId);
    const snippet = bestSnippet(extractSessionSearchTexts(events), query);
    if (snippet === undefined) continue;
    const hintTs = store.listHints?.(sessionId)?.lastEventTs;
    hits.push({
      sessionId,
      snippet,
      lastTs: hintTs ?? lastEventTs(events),
    });
  }

  hits.sort((a, b) => b.lastTs - a.lastTs || 0);
  const hasMore = hits.length > SESSION_SEARCH_RESULT_LIMIT;
  return {
    items: hits.slice(0, SESSION_SEARCH_RESULT_LIMIT).map(({ sessionId, snippet }) => ({
      sessionId,
      snippet,
    })),
    hasMore,
  };
}
