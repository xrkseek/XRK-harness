/**
 * Parallel Search free MCP (keyless) — aligned with XRK-AGT parallel-free.
 * Default MCP URL: https://search.parallel.ai/mcp
 */

import { randomUUID } from "node:crypto";
import { callMcpTool } from "./search-mcp-client.js";
import type {
  FetchFn,
  WebSearch,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from "./types.js";
import { WebError } from "./types.js";

export const PARALLEL_MCP_SEARCH_URL = "https://search.parallel.ai/mcp";
const SEARCH_TIMEOUT_MS = 30_000;

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function mapParallelSources(payload: Record<string, unknown>): WebSearchSource[] {
  const rows = Array.isArray(payload.results) ? payload.results : [];
  const sources: WebSearchSource[] = [];
  for (const row of rows) {
    const entry = asRecord(row);
    if (!entry) continue;
    const url = asString(entry.url);
    if (!url) continue;
    const title = asString(entry.title);
    const excerpts = Array.isArray(entry.excerpts)
      ? entry.excerpts.filter((e): e is string => typeof e === "string")
      : [];
    const snippet =
      excerpts.join("\n\n") ||
      asString(entry.snippet) ||
      asString(entry.description);
    const publishedAt = asString(entry.publish_date) ?? asString(entry.publishedAt);
    sources.push({
      url,
      ...(title ? { title } : {}),
      ...(snippet ? { snippet } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    });
  }
  return sources;
}

function capSources(
  sources: readonly WebSearchSource[],
  maxResults: number,
): WebSearchResult {
  if (sources.length <= maxResults) {
    return { sources, truncated: false };
  }
  return {
    sources: sources.slice(0, maxResults),
    truncated: true,
  };
}

function translateAbort(
  err: unknown,
  outer: AbortSignal | undefined,
  timed: AbortSignal,
): never {
  if (timed.aborted && !outer?.aborted) {
    throw new WebError("web search timed out", "WEB_FETCH_TIMEOUT");
  }
  if (outer?.aborted || timed.aborted) {
    throw new WebError("web search aborted", "WEB_ABORTED");
  }
  throw new WebError(
    err instanceof Error ? err.message : String(err),
    "WEB_PROVIDER_ERROR",
  );
}

export function createParallelFreeSearch(options: {
  readonly mcpUrl?: string;
  readonly fetch?: FetchFn;
  readonly timeoutMs?: number;
}): WebSearch {
  const mcpUrl = options.mcpUrl?.trim() || PARALLEL_MCP_SEARCH_URL;
  const timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS;
  return {
    async search(
      request: WebSearchRequest,
      signal?: AbortSignal,
    ): Promise<WebSearchResult> {
      if (signal?.aborted) {
        throw new WebError("web search aborted", "WEB_ABORTED");
      }
      const timed = AbortSignal.timeout(timeoutMs);
      const combined = signal ? AbortSignal.any([signal, timed]) : timed;
      const query = request.query.trim();
      if (!query) {
        throw new WebError("query is required", "WEB_PROVIDER_ERROR");
      }
      try {
        const payload = await callMcpTool({
          url: mcpUrl,
          toolName: "web_search",
          toolArgs: {
            objective: query,
            search_queries: [query],
            session_id: randomUUID(),
          },
          ...(options.fetch ? { fetch: options.fetch } : {}),
          signal: combined,
          clientName: "xrk-harness-parallel-free",
        });
        return capSources(mapParallelSources(payload), request.maxResults);
      } catch (err) {
        if (err instanceof WebError) {
          if (timed.aborted && !signal?.aborted) {
            throw new WebError("web search timed out", "WEB_FETCH_TIMEOUT");
          }
          throw err;
        }
        translateAbort(err, signal, timed);
      }
    },
  };
}
