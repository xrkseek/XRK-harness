/**
 * Model listing probe for Settings “fetch available models”.
 * Draft only — does not persist keys.
 *
 * Listable protocols: OpenAI-compatible (`GET {base}/models`) and
 * Anthropic Messages (`GET {root}/v1/models`). The parser accepts a standard
 * `data` array and the enriched `models` map some gateways expose.
 */

import type { AuthMode } from "./types.js";
import {
  enrichFromModelsDev,
  loadModelsDevCatalog,
} from "./models-dev-catalog.js";

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
  "gemini-generate",
]);

/**
 * Protocols whose adapter turns a chosen effort into a wire field
 * (`reasoning_effort`). Anthropic Messages and Gemini take a thinking budget
 * instead, and this build does not translate one into the other — so their
 * probes get capacities but stay out of the thinking-menu business.
 */
const EFFORT_WIRE_APIS = new Set([
  "",
  "openai-chat",
  "openai-completions",
  "openai-compatible",
]);

/** Selectable thinking intensity when the listing advertises one (OFM / DSH). */
export interface DiscoveredLlmReasoning {
  readonly efforts: readonly {
    readonly id: string;
    readonly name: string;
    readonly description?: string;
  }[];
  readonly defaultEffort?: string;
}

export interface DiscoveredLlmModel {
  readonly id: string;
  readonly name?: string;
  readonly contextWindow?: number;
  readonly maxTokens?: number;
  /** Inputs the model accepts, when the listing or the catalog discloses them. */
  readonly inputModalities?: readonly ("text" | "image")[];
  /** Thinking menu from OpenAI-compatible gateways that extend `/models`. */
  readonly reasoning?: DiscoveredLlmReasoning;
}

export interface DiscoverModelsRequest {
  readonly provider?: string;
  readonly baseUrl?: string;
  readonly api?: string;
  readonly apiKey?: string;
  readonly authMode?: AuthMode;
  readonly signal?: AbortSignal;
  readonly fetch?: typeof fetch;
  /**
   * Transport for the second-opinion catalog (models.dev). Defaults to the
   * process fetch and is separate from {@link fetch} so a probe's own transport
   * — a proxy, a test double — never stands in for a public catalog read.
   */
  readonly catalogFetch?: typeof fetch;
  /** Set `false` to answer from the listing alone (no catalog round trip). */
  readonly enrichCatalog?: boolean;
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
 * Gemini lists at `{base}/models` where base already carries its version.
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

interface ListingArchitecture {
  readonly input_modalities?: unknown;
  readonly modality?: unknown;
}

interface ListingEntry {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly display_name?: unknown;
  readonly displayName?: unknown;
  /** Gemini's listing names models `models/<id>`. */
  readonly inputTokenLimit?: unknown;
  readonly outputTokenLimit?: unknown;
  readonly supportedGenerationMethods?: unknown;
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
  readonly input_modalities?: unknown;
  readonly modalities?: unknown;
  readonly architecture?: ListingArchitecture | null;
  readonly reasoning?: unknown;
  readonly reasoningEfforts?: unknown;
  readonly efforts?: unknown;
  readonly defaultEffort?: unknown;
  readonly defaultReasoningEffort?: unknown;
  readonly default?: unknown;
}

/**
 * Inputs a listing says the model takes. OpenRouter-style gateways put them in
 * `architecture.input_modalities` (or a `text+image->text` modality string).
 */
function modalitiesFromListing(entry: ListingEntry): ("text" | "image")[] | undefined {
  const direct = entry.input_modalities;
  const nested = entry.architecture?.input_modalities;
  const list = Array.isArray(direct) ? direct : Array.isArray(nested) ? nested : undefined;
  const kept: ("text" | "image")[] = [];
  const push = (value: unknown): void => {
    if (value !== "text" && value !== "image") return;
    if (!kept.includes(value)) kept.push(value);
  };
  if (list !== undefined) {
    for (const item of list) {
      if (typeof item !== "string") continue;
      // `file` / `pdf` are not separate intake modes here; text rides along.
      push(item.trim().toLowerCase());
    }
  } else if (typeof entry.architecture?.modality === "string") {
    for (const item of entry.architecture.modality.split(/[^a-z]+/i)) push(item.toLowerCase());
  }
  return kept.length > 0 ? kept : undefined;
}

/**
 * OFM openai-gateway and DSH pi-ai put thinking menus on listing rows.
 * Keep ids as the provider's wire values (`on`/`off`, not only OpenAI canonical).
 */
function reasoningFromListing(entry: ListingEntry): DiscoveredLlmReasoning | undefined {
  const nested = entry.reasoning;
  const source =
    nested && typeof nested === "object" && !Array.isArray(nested)
      ? (nested as Record<string, unknown>)
      : (entry as Record<string, unknown>);

  if (source.reasoningEfforts === false) return undefined;

  const list = Array.isArray(source.efforts)
    ? source.efforts
    : Array.isArray(source.reasoningEfforts)
      ? source.reasoningEfforts
      : undefined;
  if (!list || list.length === 0) return undefined;

  const efforts: DiscoveredLlmReasoning["efforts"][number][] = [];
  for (const item of list) {
    if (typeof item === "string" && item.trim()) {
      const id = item.trim();
      efforts.push({
        id,
        name: id.charAt(0).toUpperCase() + id.slice(1),
      });
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    if (!id) continue;
    const name =
      typeof row.name === "string" && row.name.trim()
        ? row.name.trim()
        : id.charAt(0).toUpperCase() + id.slice(1);
    const description =
      typeof row.description === "string" && row.description.trim()
        ? row.description.trim()
        : undefined;
    efforts.push({
      id,
      name,
      ...(description !== undefined ? { description } : {}),
    });
  }
  if (efforts.length === 0) return undefined;

  const defaultRaw =
    source.defaultEffort ?? source.defaultReasoningEffort ?? source.default;
  const defaultEffort =
    typeof defaultRaw === "string" &&
    defaultRaw.trim() &&
    efforts.some((effort) => effort.id === defaultRaw.trim())
      ? defaultRaw.trim()
      : undefined;
  return {
    efforts,
    ...(defaultEffort !== undefined ? { defaultEffort } : {}),
  };
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
  } else if (Array.isArray(listing?.models)) {
    // Gemini answers `{models: [...]}`; every other readable protocol answers
    // with `data`, and the enriched gateway shape uses an object here.
    listed = (listing.models as readonly unknown[]).map((raw) => ({ raw }));
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
    if (
      Array.isArray(entry.supportedGenerationMethods)
      && !(entry.supportedGenerationMethods as readonly unknown[]).includes("generateContent")
    ) {
      // Embedding-only rows (Gemini) are not chat models and cannot be routed.
      continue;
    }
    const rawId = label(key, entry.id, entry.name);
    const id = rawId?.startsWith("models/") ? rawId.slice("models/".length) : rawId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    // Gemini repeats the id in `name`; every other listing uses `name` as the
    // human label. A `models/` spelling is never a display name.
    const name =
      [entry.name, entry.display_name, entry.displayName]
        .map((value) => (typeof value === "string" ? value.trim() : ""))
        .find((value) => value.length > 0 && !value.startsWith("models/"))
      ?? id;
    const contextWindow = capacity(
      entry.contextWindow,
      entry.context_window,
      entry.context_length,
      entry.max_input_tokens,
      entry.inputTokenLimit,
      entry.limit?.context,
    );
    const maxTokens = capacity(
      entry.maxOutputTokens,
      entry.max_output_tokens,
      entry.maxTokens,
      entry.max_tokens,
      entry.outputTokenLimit,
      entry.limit?.output,
      entry.top_provider?.max_completion_tokens,
    );
    const reasoning = reasoningFromListing(entry);
    const inputModalities = modalitiesFromListing(entry);
    models.push({
      id,
      name,
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
      ...(inputModalities !== undefined ? { inputModalities } : {}),
      ...(reasoning !== undefined ? { reasoning } : {}),
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
  if (api === "gemini-generate") {
    // Google takes the key in a header; a query parameter would leak it into
    // every proxy log between here and the endpoint.
    const key = apiKey?.trim();
    if (key) headers["x-goog-api-key"] = key;
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
  const listed = readListing(json);
  // A standard listing carries ids and little else (OpenCode Zen/Go sends
  // `{id, object, created, owned_by}`), so capacities and thinking menus stay
  // blank forever unless the public catalog fills them. Only a probe that names
  // its provider can be looked up, and only rows with real blanks pay for it.
  if (
    request.enrichCatalog === false
    || request.provider === undefined
    || !needsCatalog(listed)
  ) {
    return listed;
  }
  const catalog = await loadModelsDevCatalog(request.catalogFetch);
  if (catalog === undefined) return listed;
  return enrichFromModelsDev(listed, catalog, {
    ...(request.provider === undefined ? {} : { provider: request.provider }),
    baseUrl,
    effortWire: EFFORT_WIRE_APIS.has(api),
    globalFallback: true,
  });
}

/** Whether any advertised row left a fact the catalog could supply. */
function needsCatalog(models: readonly DiscoveredLlmModel[]): boolean {
  return models.some(
    (model) =>
      model.contextWindow === undefined
      || model.maxTokens === undefined
      || model.reasoning === undefined
      || model.inputModalities === undefined,
  );
}
