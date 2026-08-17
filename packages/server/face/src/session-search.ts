import type { SessionEvent } from "@xrkseek/protocol";
import type { SessionStore } from "@xrkseek/core-session";
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

function extractSearchableTexts(events: readonly SessionEvent[]): string[] {
  const out: string[] = [];
  for (const e of events) {
    if (e.type === "user/message" && typeof e.content === "string") {
      out.push(e.content);
    } else if (e.type === "assistant/message" && typeof e.content === "string") {
      out.push(e.content);
    }
  }
  return out;
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
 * In-memory session search over `user/message` + `assistant/message`.
 * One hit per session; newest sessions first (store.list order preserved when possible).
 */
export function searchSessions(
  store: SessionStore,
  query: string,
): SessionSearchValue {
  const hits: SessionSearchItem[] = [];
  let overflow = false;

  for (const sessionId of store.list()) {
    const texts = extractSearchableTexts(store.get(sessionId).events);
    const snippet = bestSnippet(texts, query);
    if (snippet === undefined) continue;
    if (hits.length >= SESSION_SEARCH_RESULT_LIMIT) {
      overflow = true;
      break;
    }
    hits.push({ sessionId, snippet });
  }

  return { items: hits, hasMore: overflow };
}
