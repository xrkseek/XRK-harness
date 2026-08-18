import type {
  GenericCallView,
  PresentableToolResult,
  WebFetchResultView,
  WebSearchResultView,
  WebSource,
} from "@xrkseek/core-tools";
import { htmlToText } from "./html-text.js";
import type { WebFetchResult, WebSearchResult, WebSearchSource } from "./types.js";

export const WEB_SEARCH_MAX_RESULTS = 8;
export const DEFAULT_FETCH_MAX_OUTPUT_CHARS = 200_000;
export const DEFAULT_WEB_TOOL_TIMEOUT_MS = 30_000;

const TRUNCATION_FOOTER =
  "\n\n(Content truncated. Fetch a more specific URL or section for the full text.)";

function sourceLabel(url: string, title: string | undefined): string {
  if (title !== undefined && title.length > 0) return title;
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function projectSource(source: WebSearchSource): WebSource {
  return {
    url: source.url,
    ...(source.title !== undefined ? { title: source.title } : {}),
    ...(source.snippet !== undefined ? { snippet: source.snippet } : {}),
    ...(source.publishedAt !== undefined
      ? { publishedAt: source.publishedAt }
      : {}),
  };
}

export function formatSearchOutput(result: WebSearchResult): string {
  const parts: string[] = [];
  if (result.content !== undefined && result.content.length > 0) {
    parts.push(result.content);
  }
  if (result.sources.length > 0) {
    const lines = result.sources.map((source) => {
      const label = sourceLabel(source.url, source.title);
      const meta: string[] = [];
      if (source.snippet !== undefined && source.snippet.length > 0) {
        meta.push(source.snippet);
      }
      if (source.publishedAt !== undefined && source.publishedAt.length > 0) {
        meta.push(`(${source.publishedAt})`);
      }
      const suffix = meta.length > 0 ? ` — ${meta.join(" ")}` : "";
      return `- [${label}](${source.url})${suffix}`;
    });
    parts.push(`Sources:\n${lines.join("\n")}`);
  } else if (result.content === undefined || result.content.length === 0) {
    parts.push("No results found.");
  }
  if (result.truncated) {
    parts.push(
      `(Showing the first ${result.sources.length} sources. Refine the query for more.)`,
    );
  }
  parts.push("Cite the relevant URLs above as markdown links in your answer.");
  return parts.join("\n\n");
}

export function presentSearchCall(args: { query: string }): GenericCallView {
  return {
    card: "generic",
    title: args.query,
    kind: "search",
    rawInput: args.query,
  };
}

export interface WebSearchMeta {
  readonly sources: readonly WebSource[];
  readonly truncated: boolean;
  readonly answer?: string;
}

export function searchMetaFromValue(
  value: WebSearchResult,
): Record<string, unknown> {
  return {
    sources: value.sources.map(projectSource),
    truncated: value.truncated,
    ...(value.content !== undefined ? { answer: value.content } : {}),
  };
}

function isWebSource(value: unknown): value is WebSource {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const { url, title, snippet, publishedAt } = value as Record<string, unknown>;
  return (
    typeof url === "string" &&
    (title === undefined || typeof title === "string") &&
    (snippet === undefined || typeof snippet === "string") &&
    (publishedAt === undefined || typeof publishedAt === "string")
  );
}

export function searchMetaFromResult(meta: unknown): WebSearchMeta | undefined {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    return undefined;
  }
  const { sources, truncated, answer } = meta as Record<string, unknown>;
  if (!Array.isArray(sources) || !sources.every(isWebSource)) return undefined;
  if (typeof truncated !== "boolean") return undefined;
  if (answer !== undefined && typeof answer !== "string") return undefined;
  return {
    sources,
    truncated,
    ...(answer !== undefined ? { answer } : {}),
  };
}

export function presentSearchResult(
  args: { query: string },
  result: PresentableToolResult,
): WebSearchResultView | undefined {
  if (result.isError) return undefined;
  const meta = searchMetaFromResult(result.meta);
  if (meta === undefined) return undefined;
  return {
    card: "web",
    kind: "search",
    title: args.query,
    sources: meta.sources,
    truncated: meta.truncated,
    ...(meta.answer !== undefined ? { answer: meta.answer } : {}),
  };
}

function renderBody(result: WebFetchResult, maxInputChars: number): {
  readonly text: string;
  readonly sourceTruncated: boolean;
} {
  const content = result.body.content.slice(0, maxInputChars);
  const sourceTruncated = content.length !== result.body.content.length;
  if (result.body.kind === "html") {
    const converted = htmlToText(content, maxInputChars);
    return {
      text: converted.text,
      sourceTruncated: sourceTruncated || converted.truncated,
    };
  }
  return { text: content, sourceTruncated };
}

function renderFetchOutput(
  result: WebFetchResult,
  maxOutputChars: number,
): { readonly text: string; readonly truncated: boolean } {
  const header = `Fetched ${result.url} (HTTP ${result.statusCode})\n\n`;
  const rendered = renderBody(result, maxOutputChars);
  const prefix = `${header}${rendered.text}`;
  const truncated =
    result.truncated || rendered.sourceTruncated || prefix.length > maxOutputChars;
  const full = `${prefix}${truncated ? TRUNCATION_FOOTER : ""}`;
  if (full.length <= maxOutputChars) return { text: full, truncated };
  if (maxOutputChars < TRUNCATION_FOOTER.length) {
    return { text: full.slice(0, maxOutputChars), truncated };
  }
  return {
    text: `${prefix.slice(0, maxOutputChars - TRUNCATION_FOOTER.length)}${TRUNCATION_FOOTER}`,
    truncated,
  };
}

export function formatFetchOutput(
  result: WebFetchResult,
  maxOutputChars: number,
): string {
  return renderFetchOutput(result, maxOutputChars).text;
}

export function presentFetchCall(args: { url: string }): GenericCallView {
  return {
    card: "generic",
    title: args.url,
    kind: "fetch",
    rawInput: args.url,
  };
}

export interface WebFetchMeta {
  readonly url: string;
  readonly statusCode: number;
  readonly truncated: boolean;
}

export function fetchMetaFromValue(
  value: WebFetchResult,
  maxOutputChars: number,
): Record<string, unknown> {
  return {
    url: value.url,
    statusCode: value.statusCode,
    truncated: renderFetchOutput(value, maxOutputChars).truncated,
  };
}

export function fetchMetaFromResult(meta: unknown): WebFetchMeta | undefined {
  if (typeof meta !== "object" || meta === null || Array.isArray(meta)) {
    return undefined;
  }
  const { url, statusCode, truncated } = meta as Record<string, unknown>;
  if (
    typeof url !== "string" ||
    typeof statusCode !== "number" ||
    typeof truncated !== "boolean"
  ) {
    return undefined;
  }
  return { url, statusCode, truncated };
}

export function presentFetchResult(
  args: { url: string },
  result: PresentableToolResult,
): WebFetchResultView | undefined {
  if (result.isError) return undefined;
  const meta = fetchMetaFromResult(result.meta);
  if (meta === undefined) return undefined;
  return {
    card: "web",
    kind: "fetch",
    title: args.url,
    url: meta.url,
    statusCode: meta.statusCode,
    truncated: meta.truncated,
  };
}

export const WEB_SEARCH_GUIDANCE =
  "Use the web_search tool to discover current information on the web. It returns an optional answer plus a list of source URLs. Follow up with web_fetch when you need the full content of a specific result, and cite the relevant URLs as markdown links.";

export const WEB_FETCH_GUIDANCE =
  "Use the web_fetch tool to retrieve the content of a specific HTTP(S) URL (for example a result from web_search). It returns the page content decoded to text. Cite the URL as a markdown link when you use its content.";
