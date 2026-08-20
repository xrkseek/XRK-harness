/**
 * Keyless DuckDuckGo HTML search (ported from XRK-AGT web-search-duckduckgo).
 * No API key; scrapes https://html.duckduckgo.com/html.
 */

import type {
  FetchFn,
  WebSearch,
  WebSearchRequest,
  WebSearchResult,
  WebSearchSource,
} from "./types.js";
import { WebError } from "./types.js";

const SEARCH_TIMEOUT_MS = 30_000;
const DDG_HTML_ENDPOINT = "https://html.duckduckgo.com/html";
const DDG_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

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

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ")
    .replace(/&ndash;/g, "-")
    .replace(/&mdash;/g, "--")
    .replace(/&hellip;/g, "...")
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code)),
    )
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) =>
      String.fromCodePoint(Number.parseInt(code, 16)),
    );
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeDuckDuckGoUrl(rawUrl: string): string {
  try {
    const normalized = rawUrl.startsWith("//") ? `https:${rawUrl}` : rawUrl;
    const parsed = new URL(normalized);
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) return uddg;
  } catch {
    /* keep original */
  }
  return rawUrl;
}

function readHrefAttribute(tagAttributes: string): string {
  return /\bhref="([^"]*)"/i.exec(tagAttributes)?.[1] ?? "";
}

function isBotChallenge(html: string): boolean {
  if (/class="[^"]*\bresult__a\b[^"]*"/i.test(html)) return false;
  return /g-recaptcha|are you a human|id="challenge-form"|name="challenge"/i.test(
    html,
  );
}

/** Parse DuckDuckGo HTML result page into sources (exported for tests). */
export function parseDuckDuckGoHtml(html: string): WebSearchSource[] {
  const results: WebSearchSource[] = [];
  const resultRegex =
    /<a\b(?=[^>]*\bclass="[^"]*\bresult__a\b[^"]*")([^>]*)>([\s\S]*?)<\/a>/gi;
  const nextResultRegex =
    /<a\b(?=[^>]*\bclass="[^"]*\bresult__a\b[^"]*")[^>]*>/i;
  const snippetRegex =
    /<a\b(?=[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*")[^>]*>([\s\S]*?)<\/a>/i;

  for (const match of html.matchAll(resultRegex)) {
    const rawAttributes = match[1] ?? "";
    const rawTitle = match[2] ?? "";
    const rawUrl = readHrefAttribute(rawAttributes);
    const matchEnd = (match.index ?? 0) + match[0].length;
    const trailingHtml = html.slice(matchEnd);
    const nextResultIndex = trailingHtml.search(nextResultRegex);
    const scopedTrailingHtml =
      nextResultIndex >= 0
        ? trailingHtml.slice(0, nextResultIndex)
        : trailingHtml;
    const rawSnippet = snippetRegex.exec(scopedTrailingHtml)?.[1] ?? "";
    const title = stripHtml(decodeHtmlEntities(rawTitle));
    const url = decodeDuckDuckGoUrl(decodeHtmlEntities(rawUrl));
    const snippet = stripHtml(decodeHtmlEntities(rawSnippet));
    if (title && url) {
      results.push({
        url,
        title,
        ...(snippet ? { snippet } : {}),
      });
    }
  }
  return results;
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

export function createDuckDuckGoSearch(options: {
  readonly fetch?: FetchFn;
  readonly timeoutMs?: number;
  /** DuckDuckGo `kl` region, e.g. `wt-wt` / `us-en`. */
  readonly region?: string;
}): WebSearch {
  const fetchFn = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS;
  const region = options.region?.trim() ?? "";
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
      const url = new URL(DDG_HTML_ENDPOINT);
      url.searchParams.set("q", request.query);
      if (region) url.searchParams.set("kl", region);
      url.searchParams.set("kp", "-1"); // moderate safe search

      let response: Response;
      try {
        response = await fetchFn(url.toString(), {
          method: "GET",
          signal: combined,
          headers: {
            "User-Agent": DDG_USER_AGENT,
            Accept: "text/html",
          },
        });
      } catch (err) {
        translateAbort(err, signal, timed);
      }

      const html = await response.text();
      if (!response.ok) {
        throw new WebError(
          `DuckDuckGo answered HTTP ${response.status}`,
          "WEB_PROVIDER_ERROR",
        );
      }
      if (isBotChallenge(html)) {
        throw new WebError(
          "DuckDuckGo returned a bot challenge; try again later or set XRK_TAVILY_API_KEY / XRK_BRAVE_SEARCH_API_KEY",
          "WEB_PROVIDER_ERROR",
        );
      }
      return capSources(parseDuckDuckGoHtml(html), request.maxResults);
    },
  };
}
