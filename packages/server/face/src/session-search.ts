import type { SessionEvent } from "@xrkseek/protocol";
import {
  extractSessionSearchTexts,
  readSessionEvents,
  releaseSessionResident,
  type SessionStore,
} from "@xrkseek/core-session";
import type { FaceRpcResult } from "./types.js";

/** Wire-compatible with deepseek-harness session.search. */
export const SESSION_SEARCH_RESULT_LIMIT = 20;
/**
 * Cap how many session logs we hydrate for snippetting. FTS may return far
 * more candidates; without a bound, a common query forces full-log loads into
 * the resident LRU (and thrashing). Matches DSH cold-observation discipline.
 */
export const SESSION_SEARCH_HYDRATE_LIMIT = 48;
export const SESSION_SEARCH_SNIPPET_MAX_CODE_POINTS = 240;
export const SESSION_SEARCH_QUERY_MAX_CHARS = 500;

export interface SessionSearchItem {
  readonly sessionId: string;
  readonly snippet: string;
}

export interface SessionSearchValue {
  readonly items: readonly SessionSearchItem[];
  readonly hasMore: boolean;
  /** Opaque continuation token when {@link hasMore} — pass back as request `cursor`. */
  readonly cursor?: string;
}

export interface SessionSearchRequest {
  readonly query: string;
  readonly cursor?: string;
}

interface SearchCursorPayload {
  readonly q: string;
  readonly t: number;
  readonly id: string;
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

function encodeSearchCursor(payload: SearchCursorPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

function decodeSearchCursor(raw: string): SearchCursorPayload | undefined {
  try {
    const text = Buffer.from(raw, "base64url").toString("utf8");
    const value: unknown = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return undefined;
    }
    const v = value as Record<string, unknown>;
    if (typeof v.q !== "string" || v.q === "") return undefined;
    if (typeof v.t !== "number" || !Number.isFinite(v.t)) return undefined;
    if (typeof v.id !== "string" || v.id === "") return undefined;
    return { q: v.q, t: v.t, id: v.id };
  } catch {
    return undefined;
  }
}

/** True when `row` sorts strictly after the cursor in newest-first order. */
function ranksAfterCursor(
  row: { readonly lastTs: number; readonly sessionId: string },
  cursor: SearchCursorPayload,
): boolean {
  if (row.lastTs < cursor.t) return true;
  if (row.lastTs > cursor.t) return false;
  return row.sessionId.localeCompare(cursor.id) > 0;
}

export function parseSearchQuery(
  payload: unknown,
): FaceRpcResult<SessionSearchRequest> {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "query required" },
    };
  }
  const body = payload as Record<string, unknown>;
  const raw = body.query;
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

  const cursorRaw = body.cursor;
  if (cursorRaw === undefined) {
    return { ok: true, value: { query } };
  }
  if (typeof cursorRaw !== "string" || cursorRaw === "") {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "cursor must be a non-empty string" },
    };
  }
  const cursor = decodeSearchCursor(cursorRaw);
  if (cursor === undefined) {
    return {
      ok: false,
      error: { code: "invalid-payload", message: "cursor is malformed" },
    };
  }
  if (cursor.q !== query) {
    return {
      ok: false,
      error: {
        code: "invalid-payload",
        message: "cursor query does not match request query",
      },
    };
  }
  return { ok: true, value: { query, cursor: cursorRaw } };
}

/**
 * Session search over user/assistant/admit/safety plus command text and
 * standing todos. One hit per session; newest activity first.
 * Persistent SQLite store uses FTS5 trigram for candidates; memory store
 * scans in process. Snippets always come from loaded events.
 *
 * Rank by `listHints.lastEventTs` first, then hydrate only the page window
 * (plus misses) so a `cursor` can continue past the first
 * {@link SESSION_SEARCH_RESULT_LIMIT} hits without re-folding earlier rows.
 */
export function searchSessions(
  store: SessionStore,
  query: string,
  options?: { readonly cursor?: string },
): SessionSearchValue {
  const cursorPayload =
    options?.cursor !== undefined
      ? decodeSearchCursor(options.cursor)
      : undefined;

  const candidateIds = hasFtsSearch(store)
    ? store.searchSessionIds(query)
    : store.list();

  const ranked: { sessionId: string; lastTs: number }[] = [];
  for (const sessionId of candidateIds) {
    if (!store.has(sessionId)) continue;
    const hintTs = store.listHints?.(sessionId)?.lastEventTs;
    ranked.push({
      sessionId,
      lastTs: hintTs ?? 0,
    });
  }
  ranked.sort(
    (a, b) => b.lastTs - a.lastTs || a.sessionId.localeCompare(b.sessionId),
  );

  let start = 0;
  if (cursorPayload !== undefined) {
    start = ranked.findIndex((row) => ranksAfterCursor(row, cursorPayload));
    if (start < 0) start = ranked.length;
  }

  const items: SessionSearchItem[] = [];
  let hydrated = 0;
  let index = start;
  let lastHit: { sessionId: string; lastTs: number } | undefined;

  while (
    index < ranked.length &&
    items.length < SESSION_SEARCH_RESULT_LIMIT
  ) {
    if (hydrated >= SESSION_SEARCH_HYDRATE_LIMIT) break;
    const row = ranked[index]!;
    index += 1;
    hydrated += 1;
    const events = readSessionEvents(store, row.sessionId);
    // Prefer live tip when hints were missing (memory path always has hints).
    const lastTs =
      row.lastTs > 0 ? row.lastTs : lastEventTs(events);
    const snippet = bestSnippet(extractSessionSearchTexts(events), query);
    // Drop the cold hydrate immediately so search does not monopolize the
    // resident LRU (open turns refuse release and stay pinned).
    releaseSessionResident(store, row.sessionId);
    if (snippet === undefined) continue;
    items.push({ sessionId: row.sessionId, snippet });
    lastHit = { sessionId: row.sessionId, lastTs };
  }

  const remaining = index < ranked.length;
  // Continue when this page is full or hydrate budget stopped the scan early,
  // and at least one hit can anchor the next cursor.
  const hasMore =
    remaining &&
    lastHit !== undefined &&
    (items.length >= SESSION_SEARCH_RESULT_LIMIT ||
      hydrated >= SESSION_SEARCH_HYDRATE_LIMIT);

  if (!hasMore || lastHit === undefined) {
    return { items, hasMore: false };
  }

  return {
    items,
    hasMore: true,
    cursor: encodeSearchCursor({
      q: query,
      t: lastHit.lastTs,
      id: lastHit.sessionId,
    }),
  };
}
