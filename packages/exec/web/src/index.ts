import { createHttpFetchProvider } from "./fetch-http.js";
import {
  createSearchFromConfig,
  searchConfigFromEnv,
  searchUnavailableMessage,
  type SearchAccessConfig,
} from "./search-providers.js";
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
export {
  createOutboundAllowlist,
  outboundAllowlistFromEnv,
  parseOutboundAllowlistHosts,
  getOutboundAllowlistAuditLog,
  clearOutboundAllowlistAuditLog,
  setOutboundAllowlistAuditObserver,
  type OutboundAllowlist,
  type OutboundAllowlistAuditEvent,
  type OutboundAllowlistAuditObserver,
  type OutboundAllowlistConfig,
  type OutboundAllowlistDecision,
  type OutboundAllowlistSource,
} from "./outbound-allowlist.js";
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
  createSearchFromConfig,
  createSearchFromEnv,
  createTavilySearch,
  KEYLESS_FALLBACKS,
  resolveSearchProviderId,
  searchConfigFromEnv,
  searchUnavailableMessage,
  type SearchAccessConfig,
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
  formatWebFetchGuidance,
  formatWebSearchGuidance,
  formatBrowserGuidance,
  presentFetchCall,
  presentFetchResult,
  presentSearchCall,
  presentSearchResult,
  projectSource,
  searchMetaFromResult,
  searchMetaFromValue,
  type ToolNameSet as WebRoutingToolNameSet,
  type WebFetchMeta,
  type WebSearchMeta,
} from "./format.js";
export {
  createWebTools,
  type CreateWebToolsOptions,
} from "./tools.js";
export {
  createHttpBrowserSession,
  type BrowserActRequest,
  type BrowserActResult,
  type BrowserSession,
  type BrowserSnapshotResult,
} from "./browser-session.js";
export {
  browserCdpUrlFromEnv,
  connectCdpWebSocket,
  createBrowserSession,
  createCdpBrowserSession,
  resolveBrowserCdpUrl,
  resolveCdpDebuggerUrl,
  type BrowserProductConfig,
  type BrowserProductMode,
  type CdpCaller,
} from "./browser-cdp.js";
export {
  BROWSER_ERROR,
  createBrowserTools,
} from "./browser-tools.js";
export {
  createBrowserVaultTools,
  type BrowserVaultAccess,
  type BrowserVaultHandle,
} from "./browser-vault-tools.js";
export {
  createBrowserRuntimeRegistry,
  type BrowserRuntimeRegistry,
} from "./browser-runtime-registry.js";
export {
  extractBrowserElements,
  formatBrowserSnapshot,
  type BrowserElement,
} from "./browser-html.js";

export interface DefaultWebAccessOptions {
  /** Face/Host structured search (preferred). */
  readonly search?: SearchAccessConfig;
  /** Headless/CI overlay; ignored when `search` is set. */
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
  const searchConfig =
    options.search ?? searchConfigFromEnv(options.env ?? process.env);
  const fetchImpl = createHttpFetchProvider({
    ...(options.fetch ? { fetch: options.fetch } : {}),
    env: options.env ?? process.env,
  });
  const search = createSearchFromConfig({
    config: searchConfig,
    ...(options.fetch ? { fetch: options.fetch } : {}),
  });
  return {
    fetch: fetchImpl,
    ...(search ? { search } : {}),
    searchUnavailableMessage: searchUnavailableMessage(searchConfig),
  };
}
