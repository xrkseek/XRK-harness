/**
 * OpenAI-compatible GET /models probe. Draft only — does not persist keys.
 */

import type { AuthMode } from "./types.js";

const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

const LISTABLE_APIS = new Set([
  "",
  "openai-chat",
  "openai-completions",
  "openai-compatible",
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

function listingUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/models`;
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

function readListing(body: unknown): DiscoveredLlmModel[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) {
    throw new ModelDiscoveryError(
      'the endpoint\'s model listing has no "data" array; enter this provider\'s models by hand',
    );
  }
  const seen = new Set<string>();
  const models: DiscoveredLlmModel[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const id = label(entry.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const name = label(entry.name, entry.display_name);
    const contextWindow = capacity(entry.context_window, entry.context_length);
    const maxTokens = capacity(entry.max_output_tokens, entry.max_tokens);
    models.push({
      id,
      ...(name ? { name } : {}),
      ...(contextWindow !== undefined ? { contextWindow } : {}),
      ...(maxTokens !== undefined ? { maxTokens } : {}),
    });
  }
  return models;
}

function authHeaders(
  apiKey: string | undefined,
  authMode: AuthMode | undefined,
): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json" };
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
 * Probe GET `{baseUrl}/models`. Caller supplies a draft endpoint + one-shot key.
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
  const url = listingUrl(baseUrl);
  const doFetch = request.fetch ?? globalThis.fetch.bind(globalThis);
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "GET",
      headers: authHeaders(request.apiKey, request.authMode),
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
