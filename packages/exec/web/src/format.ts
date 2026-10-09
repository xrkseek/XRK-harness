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
  if (result.body.kind === "binary") {
    const content = result.body.content.slice(0, maxInputChars);
    return {
      text: content,
      sourceTruncated: content.length !== result.body.content.length,
    };
  }
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

export type ToolNameSet = ReadonlySet<string> | Iterable<string>;

function asSet(available: ToolNameSet): ReadonlySet<string> {
  return available instanceof Set ? available : new Set(available);
}

/**
 * web_search-only guidance (orthogonal — no fetch/browser routing).
 * Cross-tool priority lives in {@link formatWebFamilyGuidance}.
 */
export function formatWebSearchGuidance(available: ToolNameSet): string {
  const names = asSet(available);
  if (!names.has("web_search")) return "";
  return (
    "web_search: discover current web facts. Returns an optional answer plus source URLs/snippets. " +
    "Cite used URLs as markdown links."
  );
}

/**
 * web_fetch-only guidance (orthogonal — binary/proxy/redirect are this tool's contracts).
 * Cross-tool priority lives in {@link formatWebFamilyGuidance}.
 */
export function formatWebFetchGuidance(available: ToolNameSet): string {
  const names = asSet(available);
  if (!names.has("web_fetch")) return "";
  return (
    "web_fetch: one HTTP(S) URL (~30s). Text/HTML/JSON → decoded text; images/other binaries → status, content-type, size only (no body). " +
    "Optional proxy (e.g. http://127.0.0.1:7897); else process HTTP_PROXY/HTTPS_PROXY when installed. " +
    "Prefer concrete page URLs. Cross-origin redirects are not followed — if the error names a Location URL, fetch that URL next. " +
    "Cite the URL as a markdown link when you use its content."
  );
}

/**
 * browser_*-only guidance (orthogonal — no web_* / computer_use routing).
 * Cross-tool priority lives in {@link formatWebFamilyGuidance}.
 */
export function formatBrowserGuidance(available: ToolNameSet): string {
  const names = asSet(available);
  if (!names.has("browser_open")) return "";
  return (
    "browser_open / browser_snapshot / browser_act: interactive page sessions " +
    "(element refs like @e1; browser_act also supports scroll/press/back — scroll/press need CDP). " +
    "browser_vision: screenshot for the vision model. " +
    "Default session is an HTTP snapshot; Settings → Plugins → Browser (or XRK_BROWSER_CDP_URL) selects Chrome DevTools."
  );
}

/**
 * Single cross-tool web routing block (register once). Empty when no web tools.
 * Sibling tool:* sections must not repeat this priority.
 */
export function formatWebFamilyGuidance(available: ToolNameSet): string {
  const names = asSet(available);
  const hasSearch = names.has("web_search");
  const hasFetch = names.has("web_fetch");
  const hasBrowser = names.has("browser_open");
  const hasComputer = names.has("computer_use");
  if (!hasSearch && !hasFetch && !hasBrowser) return "";

  const steps: string[] = [];
  if (hasSearch) steps.push("web_search to discover");
  if (hasFetch) steps.push("web_fetch for one-shot URL/body (incl. image URL verify via metadata)");
  if (hasBrowser) steps.push("browser_* for interactive sessions");
  const lines = [
    `Web family: ${steps.join(" → ")}.`,
  ];
  if (hasBrowser && hasComputer) {
    lines.push(
      "Pages → browser_*; native desktop apps outside the page session → computer_use.",
    );
  }
  return lines.join(" ");
}

/** Full-surface defaults. */
export const WEB_SEARCH_GUIDANCE = formatWebSearchGuidance([
  "web_search",
  "web_fetch",
]);

/** Full-surface defaults. */
export const WEB_FETCH_GUIDANCE = formatWebFetchGuidance([
  "web_search",
  "web_fetch",
]);

/** Full-surface web-family routing. */
export const WEB_FAMILY_GUIDANCE = formatWebFamilyGuidance([
  "web_search",
  "web_fetch",
  "browser_open",
  "computer_use",
]);
