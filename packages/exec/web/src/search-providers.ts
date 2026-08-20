import type {
  FetchFn,
  WebSearch,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from "./types.js";
import { WebError } from "./types.js";
import { createDuckDuckGoSearch } from "./search-duckduckgo.js";
import { createParallelFreeSearch } from "./search-parallel-free.js";

export const SEARCH_TIMEOUT_MS = 30_000;

/** AGT-aligned keyless cascade order. */
export const KEYLESS_FALLBACKS = ["parallel-free", "duckduckgo"] as const;

export type SearchProviderId =
  | "tavily"
  | "brave"
  | "parallel-free"
  | "duckduckgo";

const TAVILY_URL = "https://api.tavily.com/search";
const BRAVE_URL = "https://api.search.brave.com/res/v1/web/search";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function projectSource(raw: Record<string, unknown>): WebSearchSource | undefined {
  const url = asString(raw.url);
  if (!url) return undefined;
  const title = asString(raw.title);
  const snippet = asString(raw.snippet) ?? asString(raw.content) ?? asString(raw.description);
  const publishedAt =
    asString(raw.publishedAt) ?? asString(raw.published_date) ?? asString(raw.age);
  return {
    url,
    ...(title ? { title } : {}),
    ...(snippet ? { snippet } : {}),
    ...(publishedAt ? { publishedAt } : {}),
  };
}

export function capSearchResult(
  result: WebSearchResult,
  maxResults: number,
): WebSearchResult {
  if (result.sources.length <= maxResults) return result;
  return {
    ...result,
    sources: result.sources.slice(0, maxResults),
    truncated: true,
  };
}

async function readJson(
  response: Response,
  label: string,
): Promise<Record<string, unknown>> {
  const text = await response.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text) as unknown;
  } catch {
    throw new WebError(
      `${label} returned non-JSON (HTTP ${response.status})`,
      "WEB_PROVIDER_ERROR",
    );
  }
  const record = asRecord(parsed);
  if (!record) {
    throw new WebError(
      `${label} returned a non-object JSON body`,
      "WEB_PROVIDER_ERROR",
    );
  }
  if (!response.ok) {
    const message =
      asString(record.error) ??
      asString(record.message) ??
      `${label} answered HTTP ${response.status}`;
    throw new WebError(message, "WEB_PROVIDER_ERROR");
  }
  return record;
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

function combineSignals(
  outer: AbortSignal | undefined,
  timeoutMs: number,
): { readonly timed: AbortSignal; readonly combined: AbortSignal } {
  const timed = AbortSignal.timeout(timeoutMs);
  return { timed, combined: outer ? AbortSignal.any([outer, timed]) : timed };
}

export function createTavilySearch(options: {
  readonly apiKey: string;
  readonly fetch?: FetchFn;
  readonly timeoutMs?: number;
}): WebSearch {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS;
  return {
    async search(request: WebSearchRequest, signal?: AbortSignal) {
      if (signal?.aborted) {
        throw new WebError("web search aborted", "WEB_ABORTED");
      }
      const { timed, combined } = combineSignals(signal, timeoutMs);
      let response: Response;
      try {
        response = await fetchFn(TAVILY_URL, {
          method: "POST",
          signal: combined,
          headers: { "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({
            api_key: options.apiKey,
            query: request.query,
            max_results: request.maxResults,
            include_answer: true,
          }),
        });
      } catch (err) {
        translateAbort(err, signal, timed);
      }
      const body = await readJson(response, "Tavily");
      const rows = Array.isArray(body.results) ? body.results : [];
      const sources = rows
        .map((row) => asRecord(row))
        .filter((row): row is Record<string, unknown> => row !== undefined)
        .map(projectSource)
        .filter((s): s is WebSearchSource => s !== undefined);
      const answer = asString(body.answer);
      return capSearchResult(
        {
          sources,
          truncated: false,
          ...(answer ? { content: answer } : {}),
        },
        request.maxResults,
      );
    },
  };
}

export function createBraveSearch(options: {
  readonly apiKey: string;
  readonly fetch?: FetchFn;
  readonly timeoutMs?: number;
}): WebSearch {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS;
  return {
    async search(request: WebSearchRequest, signal?: AbortSignal) {
      if (signal?.aborted) {
        throw new WebError("web search aborted", "WEB_ABORTED");
      }
      const { timed, combined } = combineSignals(signal, timeoutMs);
      const count = Math.min(Math.max(request.maxResults, 1), 20);
      const url = `${BRAVE_URL}?q=${encodeURIComponent(request.query)}&count=${count}`;
      let response: Response;
      try {
        response = await fetchFn(url, {
          method: "GET",
          signal: combined,
          headers: {
            accept: "application/json",
            "x-subscription-token": options.apiKey,
          },
        });
      } catch (err) {
        translateAbort(err, signal, timed);
      }
      const body = await readJson(response, "Brave Search");
      const web = asRecord(body.web);
      const rows = Array.isArray(web?.results) ? web.results : [];
      const sources = rows
        .map((row) => asRecord(row))
        .filter((row): row is Record<string, unknown> => row !== undefined)
        .map(projectSource)
        .filter((s): s is WebSearchSource => s !== undefined);
      return capSearchResult({ sources, truncated: false }, request.maxResults);
    },
  };
}

/** Structured search preference (Face Settings / Host), not an env bag. */
export type SearchAccessConfig = {
  /** `auto` / omit → keyed cascade; else pin one provider id. */
  readonly provider?: string;
  readonly region?: string;
  readonly tavilyApiKey?: string;
  readonly braveApiKey?: string;
  readonly parallelFreeMcpUrl?: string;
};

/** Map process/CI env into {@link SearchAccessConfig}. */
export function searchConfigFromEnv(
  env: NodeJS.ProcessEnv = process.env,
): SearchAccessConfig {
  return {
    ...(env.XRK_WEB_SEARCH_PROVIDER?.trim()
      ? { provider: env.XRK_WEB_SEARCH_PROVIDER.trim() }
      : {}),
    ...(env.XRK_WEB_SEARCH_REGION?.trim()
      ? { region: env.XRK_WEB_SEARCH_REGION.trim() }
      : {}),
    ...(env.XRK_TAVILY_API_KEY?.trim()
      ? { tavilyApiKey: env.XRK_TAVILY_API_KEY.trim() }
      : {}),
    ...(env.XRK_BRAVE_SEARCH_API_KEY?.trim()
      ? { braveApiKey: env.XRK_BRAVE_SEARCH_API_KEY.trim() }
      : {}),
    ...(env.XRK_PARALLEL_FREE_MCP_URL?.trim()
      ? { parallelFreeMcpUrl: env.XRK_PARALLEL_FREE_MCP_URL.trim() }
      : {}),
  };
}

export function searchUnavailableMessage(
  config: SearchAccessConfig | NodeJS.ProcessEnv,
): string {
  const cfg = normalizeSearchConfig(config);
  const pin = cfg.provider?.trim().toLowerCase();
  if (
    pin &&
    pin !== "auto" &&
    pin !== "tavily" &&
    pin !== "brave" &&
    pin !== "parallel-free" &&
    pin !== "duckduckgo"
  ) {
    return `Error: Unknown web search provider "${pin}". Use tavily, brave, parallel-free, or duckduckgo.`;
  }
  if (pin === "tavily" && !cfg.tavilyApiKey?.trim()) {
    return "Error: Web search is not configured. Add a Tavily key under Credentials.";
  }
  if (pin === "brave" && !cfg.braveApiKey?.trim()) {
    return "Error: Web search is not configured. Add a Brave Search key under Credentials.";
  }
  return "Error: Web search is not configured.";
}

function normalizeSearchConfig(
  value: SearchAccessConfig | NodeJS.ProcessEnv,
): SearchAccessConfig {
  if (
    "XRK_WEB_SEARCH_PROVIDER" in value ||
    "XRK_TAVILY_API_KEY" in value ||
    "XRK_BRAVE_SEARCH_API_KEY" in value ||
    "XRK_WEB_SEARCH_REGION" in value ||
    "XRK_PARALLEL_FREE_MCP_URL" in value
  ) {
    return searchConfigFromEnv(value as NodeJS.ProcessEnv);
  }
  return value as SearchAccessConfig;
}

/**
 * Prefer keyed providers when present; otherwise parallel-free (AGT).
 * Unknown pinned provider → `undefined` (caller shows unavailable).
 */
export function resolveSearchProviderId(
  config: SearchAccessConfig | NodeJS.ProcessEnv,
): SearchProviderId | undefined {
  const cfg = normalizeSearchConfig(config);
  const pin = cfg.provider?.trim().toLowerCase();
  const tavily = Boolean(cfg.tavilyApiKey?.trim());
  const brave = Boolean(cfg.braveApiKey?.trim());
  if (pin === "tavily") return tavily ? "tavily" : undefined;
  if (pin === "brave") return brave ? "brave" : undefined;
  if (pin === "parallel-free") return "parallel-free";
  if (pin === "duckduckgo") return "duckduckgo";
  if (pin && pin !== "auto") return undefined;
  if (tavily) return "tavily";
  if (brave) return "brave";
  return "parallel-free";
}

function createProvider(
  id: SearchProviderId,
  config: SearchAccessConfig,
  fetch?: FetchFn,
): WebSearch | undefined {
  if (id === "tavily") {
    const key = config.tavilyApiKey?.trim();
    if (!key) return undefined;
    return createTavilySearch({
      apiKey: key,
      ...(fetch ? { fetch } : {}),
    });
  }
  if (id === "brave") {
    const key = config.braveApiKey?.trim();
    if (!key) return undefined;
    return createBraveSearch({
      apiKey: key,
      ...(fetch ? { fetch } : {}),
    });
  }
  if (id === "parallel-free") {
    return createParallelFreeSearch({
      ...(fetch ? { fetch } : {}),
      ...(config.parallelFreeMcpUrl?.trim()
        ? { mcpUrl: config.parallelFreeMcpUrl.trim() }
        : {}),
    });
  }
  return createDuckDuckGoSearch({
    ...(fetch ? { fetch } : {}),
    ...(config.region?.trim() ? { region: config.region.trim() } : {}),
  });
}

/** Try primary; on throw or empty sources, walk remaining keyless providers (AGT). */
export function createCascadingSearch(
  primary: WebSearch,
  fallbacks: readonly WebSearch[],
): WebSearch {
  return {
    async search(request, signal) {
      try {
        const result = await primary.search(request, signal);
        if (result.sources.length > 0) return result;
      } catch {
        /* fall through */
      }
      let lastError: unknown;
      for (const fb of fallbacks) {
        try {
          const result = await fb.search(request, signal);
          if (result.sources.length > 0) return result;
        } catch (err) {
          lastError = err;
        }
      }
      if (lastError !== undefined) {
        if (lastError instanceof WebError) throw lastError;
        throw new WebError(
          lastError instanceof Error ? lastError.message : String(lastError),
          "WEB_PROVIDER_ERROR",
        );
      }
      return { sources: [], truncated: false };
    },
  };
}

/** Build search from structured Face/Host config (preferred product path). */
export function createSearchFromConfig(options: {
  readonly config?: SearchAccessConfig;
  readonly fetch?: FetchFn;
}): WebSearch | undefined {
  const config = options.config ?? {};
  const id = resolveSearchProviderId(config);
  if (!id) return undefined;
  const primary = createProvider(id, config, options.fetch);
  if (!primary) return undefined;

  const pin = config.provider?.trim().toLowerCase();
  if (pin && pin !== "auto") return primary;

  const fallbacks: WebSearch[] = [];
  for (const fbId of KEYLESS_FALLBACKS) {
    if (fbId === id) continue;
    const fb = createProvider(fbId, config, options.fetch);
    if (fb) fallbacks.push(fb);
  }
  if (fallbacks.length === 0) return primary;
  return createCascadingSearch(primary, fallbacks);
}

/** Headless/CI: map env → {@link createSearchFromConfig}. */
export function createSearchFromEnv(options: {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetch?: FetchFn;
}): WebSearch | undefined {
  return createSearchFromConfig({
    config: searchConfigFromEnv(options.env ?? process.env),
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
}
