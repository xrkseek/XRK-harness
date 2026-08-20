import { createHttpFetchProvider } from "./fetch-http.js";
import { createSearchFromEnv, searchUnavailableMessage } from "./search-providers.js";
import type { FetchFn, WebAccess } from "./types.js";

export {
  WebError,
  isWebError,
  type FetchFn,
  type WebAccess,
  type WebFetch,
  type WebFetchBody,
  type WebFetchRequest,
  type WebFetchResult,
  type WebSearch,
  type WebSearchRequest,
  type WebSearchResult,
  type WebSearchSource,
} from "./types.js";
export {
  assertHttpUrl,
  isBlockedHost,
  isSameOrigin,
  mergeTimeout,
} from "./url-policy.js";
export { capText, htmlToText } from "./html-text.js";
export {
  DEFAULT_HTTP_FETCH_LIMITS,
  LOCAL_FETCH_PROVIDER_ID,
  classifyContentType,
  createHttpFetchProvider,
  type HttpFetchLimits,
} from "./fetch-http.js";
export {
  capSearchResult,
  createBraveSearch,
  createCascadingSearch,
  createSearchFromEnv,
  createTavilySearch,
  KEYLESS_FALLBACKS,
  resolveSearchProviderId,
  searchUnavailableMessage,
  type SearchProviderId,
} from "./search-providers.js";
export {
  createDuckDuckGoSearch,
  parseDuckDuckGoHtml,
} from "./search-duckduckgo.js";
export {
  createParallelFreeSearch,
  PARALLEL_MCP_SEARCH_URL,
} from "./search-parallel-free.js";
export {
  callMcpTool,
  extractMcpToolPayload,
  iterMcpMessages,
  selectMcpEnvelope,
} from "./search-mcp-client.js";
export {
  DEFAULT_FETCH_MAX_OUTPUT_CHARS,
  DEFAULT_WEB_TOOL_TIMEOUT_MS,
  WEB_FETCH_GUIDANCE,
  WEB_SEARCH_GUIDANCE,
  WEB_SEARCH_MAX_RESULTS,
  fetchMetaFromResult,
  fetchMetaFromValue,
  formatFetchOutput,
  formatSearchOutput,
  presentFetchCall,
  presentFetchResult,
  presentSearchCall,
  presentSearchResult,
  projectSource,
  searchMetaFromResult,
  searchMetaFromValue,
  type WebFetchMeta,
  type WebSearchMeta,
} from "./format.js";
export {
  createWebTools,
  type CreateWebToolsOptions,
} from "./tools.js";

export interface DefaultWebAccessOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly fetch?: FetchFn;
}

export interface DefaultWebAccess extends WebAccess {
  readonly searchUnavailableMessage: string;
}

/** Fetch is always HTTP. Search: keyed Tavily/Brave, else parallel-free → duckduckgo. */
export function createDefaultWebAccess(
  options: DefaultWebAccessOptions = {},
): DefaultWebAccess {
  const env = options.env ?? process.env;
  const fetchImpl = createHttpFetchProvider(
    options.fetch ? { fetch: options.fetch } : {},
  );
  const search = createSearchFromEnv({
    env,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    fetch: fetchImpl,
    ...(search ? { search } : {}),
    searchUnavailableMessage: searchUnavailableMessage(env),
  };
}
