/**
 * Model listing probe for Settings “fetch available models”.
 * Draft only — does not persist keys.
 *
 * Listable protocols: OpenAI-compatible (`GET {base}/models`) and
 * Anthropic Messages (`GET {root}/v1/models`). The parser accepts a standard
 * `data` array and the enriched `models` map some gateways expose.
 */

import type { AuthMode } from "./types.js";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

/** Stable API version required by Anthropic's model-listing endpoint. */
const ANTHROPIC_VERSION = "2023-06-01";

/** Largest model-list page accepted by Anthropic's public endpoint. */
const ANTHROPIC_MODEL_LIMIT = 1000;

const LISTABLE_APIS = new Set([
  "",
  "openai-chat",
  "openai-completions",
  "openai-compatible",
  "openai-responses",
  "anthropic-messages",
]);

export interface DiscoveredLlmModel {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
}

export interface DiscoverModelsRequest {
  readonly provider?: string;
  readonly baseUrl?: string;
  readonly api?: string;
  readonly apiKey?: string;
  readonly authMode?: AuthMode;
  readonly signal?: AbortSignal;
  readonly fetch?: typeof fetch;
}

export class ModelDiscoveryError extends Error {
  readonly code = "DISCOVERY_FAILED";
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ModelDiscoveryError";
  }
}

/**
 * Join the endpoint base with the protocol's listing path.
 * Anthropic lists at `{root}/v1/models` (strip one trailing `/v1` segment).
 */
function listingUrl(baseUrl: string, api: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (api !== "anthropic-messages") return `${base}/models`;
  const root = base.endsWith("/v1") ? base.slice(0, -3) : base;
  return `${root}/v1/models?limit=${String(ANTHROPIC_MODEL_LIMIT)}`;
}

function label(...candidates: readonly unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && c.trim()) return c.trim();
  }
  return undefined;
}

function capacity(...candidates: readonly unknown[]): number | undefined {
  for (const c of candidates) {
    if (typeof c === "number" && Number.isInteger(c) && c > 0) return c;
  }
  return undefined;
}

interface ListingLimit {
  readonly context?: unknown;
  readonly output?: unknown;
}

interface ListingTopProvider {
  readonly max_completion_tokens?: unknown;
}

interface ListingEntry {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly display_name?: unknown;
  readonly displayName?: unknown;
  readonly contextWindow?: unknown;
  readonly context_window?: unknown;
  readonly context_length?: unknown;
  readonly max_input_tokens?: unknown;
  readonly maxOutputTokens?: unknown;
  readonly max_tokens?: unknown;
  readonly max_output_tokens?: unknown;
  readonly maxTokens?: unknown;
  readonly limit?: ListingLimit | null;
  readonly top_provider?: ListingTopProvider | null;
}

/**
 * Read one supported model-listing reply. The standard `data` array takes
 * precedence when both formats are present. An enriched `models` map uses each
 * property key as the endpoint-facing id. Missing names fall back to the id.
 */
function readListing(body: unknown): DiscoveredLlmModel[] {
  const listing = body as { data?: unknown; models?: unknown } | null;
  const data = listing?.data;
  let listed: { readonly key?: string; readonly raw: unknown }[];
  if (Array.isArray(data)) {
    listed = (data as readonly unknown[]).map((raw) => ({ raw }));
  } else {
    const modelsMap = listing?.models;
    if (
      modelsMap === null ||
      typeof modelsMap !== "object" ||
      Array.isArray(modelsMap)
    ) {
      throw new ModelDiscoveryError(
        'the endpoint\'s model listing has neither a "data" array nor a "models" object; enter this provider\'s models by hand',
      );
    }
    listed = Object.entries(modelsMap as Record<string, unknown>)
      .filter(
        ([, raw]) =>
          raw !== null && typeof raw === "object" && !Array.isArray(raw),
      )
      .map(([key, raw]) => ({ key, raw }));
  }

  const seen = new Set<string>();
  const models: DiscoveredLlmModel[] = [];
  for (const { key, raw } of listed) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as ListingEntry;
    const id = label(key, entry.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name =
      label(entry.name, entry.display_name, entry.displayName) ?? id;
    const contextWindow = capacity(
      entry.contextWindow,
      entry.context_window,
      entry.context_length,
      entry.max_input_tokens,
      entry.limit?.context,
    );
    const maxTokens = capacity(
      entry.maxOutputTokens,
      entry.max_output_tokens,
      entry.maxTokens,
      entry.max_tokens,
      entry.limit?.output,
      entry.top_provider?.max_completion_tokens,
    );
    models.push({
      id,
      name,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    });
  }
  return models;
}

function authHeaders(
  api: string,
  apiKey: string | undefined,
  authMode: AuthMode | undefined,
): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (api === "anthropic-messages") {
    headers["anthropic-version"] = ANTHROPIC_VERSION;
    const key = apiKey?.trim();
    if (key) headers["x-api-key"] = key;
    return headers;
  }
  const key = apiKey?.trim();
  if (!key) return headers;
  if (authMode === "api-key") {
    headers["api-key"] = key;
  } else {
    headers.authorization = `Bearer ${key}`;
  }
  return headers;
}

/**
 * Probe a draft endpoint for advertised models (OpenAI-compatible or Anthropic).
 * Caller supplies draft baseUrl + one-shot key; nothing is persisted.
 */
export async function discoverOpenAiChatModels(
  request: DiscoverModelsRequest,
): Promise<readonly DiscoveredLlmModel[]> {
  const baseUrl = request.baseUrl?.trim();
  if (!baseUrl) {
    throw new ModelDiscoveryError(
      "model discovery needs a provider route or a baseURL",
    );
  }
  const api = (request.api ?? "").trim().toLowerCase();
  if (!LISTABLE_APIS.has(api)) {
    throw new ModelDiscoveryError(
      `protocol "${request.api}" has no model listing this build can read; enter this provider's models by hand`,
    );
  }
  const url = listingUrl(baseUrl, api);
  const doFetch = request.fetch ?? globalThis.fetch.bind(globalThis);
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "GET",
      headers: authHeaders(api, request.apiKey, request.authMode),
      ...(request.signal ? { signal: request.signal } : {}),
    });
  } catch (err) {
    if (request.signal?.aborted) {
      throw new ModelDiscoveryError("model discovery aborted by caller");
    }
    throw new ModelDiscoveryError(`could not reach ${url}`, { cause: err });
  }
  if (!res.ok) {
    const hint =
      res.status === 401 || res.status === 403 ? "; check the API key" : "";
    throw new ModelDiscoveryError(`${url} answered ${res.status}${hint}`);
  }
  const declared = Number(res.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) {
    throw new ModelDiscoveryError(
      `${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`,
    );
  }
  const text = await res.text();
  if (text.length > MAX_RESPONSE_BYTES) {
    throw new ModelDiscoveryError(
      `${url} answered with more than ${MAX_RESPONSE_BYTES} bytes`,
    );
  }
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch (err) {
    throw new ModelDiscoveryError(`${url} did not answer with JSON`, {
      cause: err,
    });
  }
  return readListing(json);
}
