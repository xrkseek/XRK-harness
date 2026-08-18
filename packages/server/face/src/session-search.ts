import type { SessionEvent } from "@xrkseek/protocol";
import { flattenText } from "@xrkseek/protocol";
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
    if (e.type === "user/message") {
      const text = flattenText(e.content);
      if (text) out.push(text);
    } else if (e.type === "assistant/message" && typeof e.content === "string") {
      out.push(e.content);
    } else if (e.type === "prompt/admitted") {
      const text = flattenText(e.content);
      if (text) out.push(text);
    } else if (e.type === "safety/notice" && typeof e.content === "string") {
      out.push(e.content);
    } else if (e.type === "command/run") {
      out.push(e.name);
      if (e.args) out.push(e.args);
    } else if (e.type === "command/done" && typeof e.text === "string") {
      out.push(e.text);
    } else if (e.type === "todo/write") {
      for (const item of e.todos) {
        if (item.content) out.push(item.content);
      }
    }
  }
  return out;
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
 * standing todos. One hit per session; newest activity first. JSONL Host
 * store is already eager-loaded, so persisted sessions are in the same scan.
 * Not SQLite FTS.
export function searchSessions(
  store: SessionStore,
  query: string,
): SessionSearchValue {
  const hits: (SessionSearchItem & { readonly lastTs: number })[] = [];

  for (const sessionId of store.list()) {
    const events = store.get(sessionId).events;
    const snippet = bestSnippet(extractSearchableTexts(events), query);
    if (snippet === undefined) continue;
    hits.push({ sessionId, snippet, lastTs: lastEventTs(events) });
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
