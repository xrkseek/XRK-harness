import type { ToolDefinition, ToolResultContent } from "@xrkseek/core-tools";
import {
  DEFAULT_FETCH_MAX_OUTPUT_CHARS,
  WEB_SEARCH_MAX_RESULTS,
  fetchMetaFromValue,
  formatFetchOutput,
  formatSearchOutput,
  presentFetchCall,
  presentFetchResult,
  presentSearchCall,
  presentSearchResult,
  projectSource,
  searchMetaFromValue,
} from "./format.js";
import { searchUnavailableMessage } from "./search-providers.js";
import type { WebAccess, WebFetch, WebSearch } from "./types.js";
import { isWebError } from "./types.js";

export {
  DEFAULT_FETCH_MAX_OUTPUT_CHARS,
  DEFAULT_WEB_TOOL_TIMEOUT_MS,
  WEB_SEARCH_MAX_RESULTS,
} from "./format.js";

export interface CreateWebToolsOptions {
  readonly search?: WebSearch;
  readonly fetch?: WebFetch;
  /** Override the honest search-unavailable execute text. */
  readonly searchUnavailableMessage?: string;
  readonly searchMaxResults?: number;
  readonly fetchMaxOutputChars?: number;
  readonly env?: NodeJS.ProcessEnv;
}

function fail(err: unknown): ToolResultContent {
  const message = isWebError(err)
    ? `Error: ${err.message}`
    : `Error: ${err instanceof Error ? err.message : String(err)}`;
  return { content: message, isError: true };
}

export function createWebTools(
  options: CreateWebToolsOptions | WebAccess = {},
): ToolDefinition[] {
  const search = "search" in options ? options.search : undefined;
  const fetch = "fetch" in options ? options.fetch : undefined;
  const searchMaxResults =
    "searchMaxResults" in options && options.searchMaxResults !== undefined
      ? options.searchMaxResults
      : WEB_SEARCH_MAX_RESULTS;
  const fetchMaxOutputChars =
    "fetchMaxOutputChars" in options && options.fetchMaxOutputChars !== undefined
      ? options.fetchMaxOutputChars
      : DEFAULT_FETCH_MAX_OUTPUT_CHARS;
  const missingSearch =
    ("searchUnavailableMessage" in options &&
      options.searchUnavailableMessage) ||
    searchUnavailableMessage(
      ("env" in options && options.env) || process.env,
    );

  const searchTool: ToolDefinition<{ query: string }> = {
    name: "web_search",
    description:
      "Search the web for current information. Returns an optional summary answer and a list of source URLs.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The search query." },
      },
      required: ["query"],
    },
    async execute(args, signal) {
      const query = String(args?.query ?? "").trim();
      if (!query) {
        return { content: "Error: query must be a non-empty string", isError: true };
      }
      if (!search) {
        return { content: missingSearch, isError: true };
      }
      try {
        const result = await search.search(
          { query, maxResults: searchMaxResults },
          signal,
        );
        const projected = {
          ...result,
          sources: result.sources.map(projectSource),
        };
        return {
          content: formatSearchOutput(projected),
          meta: searchMetaFromValue(projected),
        };
      } catch (err) {
        return fail(err);
      }
    },
    presentCall: presentSearchCall,
    presentResult: presentSearchResult,
  };

  const fetchTool: ToolDefinition<{ url: string }> = {
    name: "web_fetch",
    description:
      "Fetch the content of a specific HTTP(S) URL and return it decoded to text.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The HTTP(S) URL to fetch." },
      },
      required: ["url"],
    },
    async execute(args, signal) {
      const url = String(args?.url ?? "").trim();
      if (!url) {
        return { content: "Error: url must be a non-empty string", isError: true };
      }
      if (!fetch) {
        return {
          content: "Error: Web fetch is not configured.",
          isError: true,
        };
      }
      try {
        const result = await fetch.fetch({ url }, signal);
        return {
          content: formatFetchOutput(result, fetchMaxOutputChars),
          meta: fetchMetaFromValue(result, fetchMaxOutputChars),
        };
      } catch (err) {
        return fail(err);
      }
    },
    presentCall: presentFetchCall,
    presentResult: presentFetchResult,
  };

  return [searchTool, fetchTool];
}
