/**
 * Second-opinion catalog for `GET /models` probes.
 *
 * A plain OpenAI-compatible listing answers with ids and little else — OpenCode
 * Zen/Go is the extreme case: `{id, object, created, owned_by}` per row, so a
 * probe learns no context window, no output cap, and no thinking menu. Those
 * facts live in [models.dev](https://models.dev), the public catalog the OpenCode
 * client itself reads. This module fetches it once per process (TTL-bounded,
 * single-flight) and fills only the blanks a listing left behind.
 *
 * Everything here is best-effort by construction: a slow, blocked, or broken
 * catalog costs the user nothing beyond the probe they already asked for, so
 * failures resolve to `undefined` instead of throwing.
 */

import type { DiscoveredLlmModel, DiscoveredLlmReasoning } from "./discover.js";

const CATALOG_URL = "https://models.dev/api.json";

/** How long one fetched catalog serves probes in this process. */
const TTL_MS = 6 * 60 * 60 * 1000;

/** A failed fetch is remembered briefly: probes must not re-pay a dead endpoint. */
const FAILURE_TTL_MS = 10 * 60 * 1000;

/** Catalog fetch budget. A probe is a UI action, not a batch job. */
const FETCH_TIMEOUT_MS = 4_000;

/** Ceiling for the decompressed body, matching the listing probe's own guard. */
const MAX_BODY_BYTES = 32 * 1024 * 1024;

interface CatalogModelRow {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly reasoning?: unknown;
  readonly reasoning_options?: unknown;
  readonly modalities?: unknown;
  readonly limit?: unknown;
}

interface CatalogProviderRow {
  readonly id?: unknown;
  readonly api?: unknown;
  readonly models?: unknown;
}

/** The slice of `api.json` this module reads: provider key → its models. */
export type ModelsDevCatalog = Readonly<Record<string, CatalogProviderRow>>;

export interface CatalogLookup {
  /** Provider key that answered, in the order it was tried. */
  readonly keys: readonly string[];
}

let cached: { readonly at: number; readonly value: ModelsDevCatalog | undefined } | undefined;
let inflight: Promise<ModelsDevCatalog | undefined> | undefined;

/**
 * Brand ids this harness ships that models.dev files under another key.
 * A missing alias costs the user their capacities, so the table is kept short
 * and explicit rather than grown by fuzzy matching.
 */
const PROVIDER_ALIASES: Readonly<Record<string, readonly string[]>> = {
  "github-models": ["github-copilot"],
  fireworks: ["fireworks-ai"],
  together: ["togetherai"],
  gemini: ["google", "google-vertex"],
  "openai-responses": ["openai"],
};

function hostOf(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).host.toLowerCase();
  } catch {
    return undefined;
  }
}

/**
 * Read the catalog, or `undefined` when this process could not get one.
 * @param fetchImpl - transport to use; injected by tests.
 * @returns the parsed catalog, shared by every probe in this process.
 */
export async function loadModelsDevCatalog(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<ModelsDevCatalog | undefined> {
  const now = Date.now();
  if (cached !== undefined && now - cached.at < (cached.value === undefined ? FAILURE_TTL_MS : TTL_MS)) {
    return cached.value;
  }
  if (inflight !== undefined) return inflight;
  inflight = (async () => {
    let value: ModelsDevCatalog | undefined;
    try {
      const res = await fetchImpl(CATALOG_URL, {
        method: "GET",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.ok) {
        const text = await res.text();
        if (text.length <= MAX_BODY_BYTES) {
          const parsed = JSON.parse(text) as unknown;
          if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
            value = parsed as ModelsDevCatalog;
          }
        }
      }
    } catch {
      /* unreachable / blocked / malformed: the probe still answers from the listing */
    }
    cached = { at: Date.now(), value };
    return value;
  })().finally(() => {
    inflight = undefined;
  });
  return inflight;
}

/** Drop the in-process copy (tests, and a Refresh that wants a fresh catalog). */
export function resetModelsDevCatalogCache(): void {
  cached = undefined;
  inflight = undefined;
}

function providerHost(row: CatalogProviderRow): string | undefined {
  return hostOf(typeof row.api === "string" ? row.api : undefined);
}

/**
 * Provider keys worth consulting, most exact first.
 *
 * The drafted route's own id wins; failing that, endpoints sharing its host
 * (OpenCode's `opencode-go` and `opencode` both serve `opencode.ai`, and a
 * hand-named profile can point at a directory-known host); failing that, a
 * `-go` sibling, because OpenCode lists some Go models only under Zen.
 */
export function catalogKeys(
  catalog: ModelsDevCatalog,
  selector: { readonly provider?: string; readonly baseUrl?: string },
): string[] {
  const keys: string[] = [];
  const provider = selector.provider?.trim();
  if (provider && catalog[provider] !== undefined) keys.push(provider);
  for (const alias of provider === undefined ? [] : PROVIDER_ALIASES[provider] ?? []) {
    if (catalog[alias] !== undefined && !keys.includes(alias)) keys.push(alias);
  }
  const host = hostOf(selector.baseUrl);
  if (host !== undefined) {
    for (const [key, row] of Object.entries(catalog)) {
      if (keys.includes(key)) continue;
      if (providerHost(row) === host) keys.push(key);
    }
  }
  if (provider?.endsWith("-go")) {
    const sibling = provider.slice(0, -3);
    if (catalog[sibling] !== undefined && !keys.includes(sibling)) keys.push(sibling);
  }
  return keys;
}

/**
 * Catalog keys a listing row may be filed under. Google lists
 * `models/gemini-3-pro`; the catalog says `gemini-3-pro`.
 */
function modelRowLookupKeys(id: string): string[] {
  const trimmed = id.trim();
  const bare = trimmed.startsWith("models/") ? trimmed.slice("models/".length) : trimmed;
  return bare === trimmed ? [trimmed] : [trimmed, bare];
}

/** One id's rows across the whole catalog, built once per fetched catalog. */
const globalIndexes = new WeakMap<ModelsDevCatalog, Map<string, CatalogModelRow[]>>();

/** One catalog entry, when the JSON value is shaped like one. */
function asRow(value: unknown): CatalogModelRow | undefined {
  return value !== null && typeof value === "object" ? value : undefined;
}

function globalIndex(catalog: ModelsDevCatalog): Map<string, CatalogModelRow[]> {
  const hit = globalIndexes.get(catalog);
  if (hit !== undefined) return hit;
  const index = new Map<string, CatalogModelRow[]>();
  for (const provider of Object.values(catalog)) {
    const rows = provider?.models;
    if (rows === null || typeof rows !== "object") continue;
    for (const [id, raw] of Object.entries(rows as Record<string, unknown>)) {
      const row = asRow(raw);
      if (row === undefined) continue;
      const bucket = index.get(id);
      if (bucket === undefined) index.set(id, [row]);
      else bucket.push(row);
    }
  }
  globalIndexes.set(catalog, index);
  return index;
}

/**
 * The numbers most providers agree on, or nothing.
 *
 * A relay that resells the same model under the same id usually keeps the
 * published window; when providers disagree, the caller keeps its blank field
 * rather than inherit a ceiling the endpoint it actually talks to may reject.
 */
function agreedLimit(rows: readonly CatalogModelRow[]): {
  readonly contextWindow?: number;
  readonly maxTokens?: number;
} | undefined {
  const tally = new Map<string, { count: number; context?: number; output?: number }>();
  for (const row of rows) {
    const limit = row.limit;
    const record = limit !== null && typeof limit === "object" ? (limit as Record<string, unknown>) : {};
    const context = positiveInt(record.context);
    const output = positiveInt(record.output);
    if (context === undefined && output === undefined) continue;
    const key = `${context ?? ""}|${output ?? ""}`;
    const seen = tally.get(key);
    if (seen === undefined) tally.set(key, { count: 1, ...(context === undefined ? {} : { context }), ...(output === undefined ? {} : { output }) });
    else seen.count += 1;
  }
  if (tally.size === 0) return undefined;
  const total = [...tally.values()].reduce((sum, entry) => sum + entry.count, 0);
  const [winner] = [...tally.entries()].sort((a, b) => b[1].count - a[1].count);
  if (winner === undefined || winner[1].count / total < 0.6) return undefined;
  return {
    ...(winner[1].context === undefined ? {} : { contextWindow: winner[1].context }),
    ...(winner[1].output === undefined ? {} : { maxTokens: winner[1].output }),
  };
}

/** Thinking levels most providers agree on, or nothing (same rule as {@link agreedLimit}). */
function agreedReasoning(rows: readonly CatalogModelRow[]): DiscoveredLlmReasoning | undefined {
  const tally = new Map<string, number>();
  for (const row of rows) {
    const reasoning = reasoningOf(row);
    if (reasoning === undefined) continue;
    const key = reasoning.efforts.map((effort) => effort.id).join(",");
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  if (tally.size === 0) return undefined;
  const total = [...tally.values()].reduce((sum, count) => sum + count, 0);
  const [winner] = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  if (winner === undefined || winner[1] / total < 0.6) return undefined;
  const ids = winner[0].split(",").filter(Boolean);
  if (ids.length === 0) return undefined;
  const defaultEffort = ["high", "medium", "low"].find((level) => ids.includes(level))
    ?? ids[Math.floor(ids.length / 2)];
  return {
    efforts: ids.map((id) => ({ id, name: titleOf(id) })),
    ...defaultEffort === undefined ? {} : { defaultEffort },
  };
}

/**
 * Intake modes most providers agree on.
 *
 * A wrong `image` costs a rejected request, so the vote has to be strict: an
 * id advertised as text by most gateways stays text even if one reseller
 * attaches a different modality list.
 */
function agreedModalities(rows: readonly CatalogModelRow[]): ("text" | "image")[] | undefined {
  const tally = new Map<string, number>();
  for (const row of rows) {
    const modalities = modalitiesOf(row);
    if (modalities === undefined) continue;
    const key = modalities.join(",");
    tally.set(key, (tally.get(key) ?? 0) + 1);
  }
  if (tally.size === 0) return undefined;
  const total = [...tally.values()].reduce((sum, count) => sum + count, 0);
  const [winner] = [...tally.entries()].sort((a, b) => b[1] - a[1]);
  if (winner === undefined || winner[1] / total < 0.6) return undefined;
  const kept = winner[0].split(",").filter((m): m is "text" | "image" => m === "text" || m === "image");
  return kept.length > 0 ? kept : undefined;
}

function positiveInt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function titleOf(id: string): string {
  return id.charAt(0).toUpperCase() + id.slice(1);
}

/**
 * Thinking menu from a catalog row.
 *
 * Only `effort`-style menus are adopted: the harness sends the chosen id as
 * `reasoning_effort`, so a `toggle` (`on`/`off`) or `budget_tokens` row that we
 * translated here would send a value the upstream does not accept. Those models
 * keep the plain default and stay hand-editable.
 */
function reasoningOf(row: CatalogModelRow): DiscoveredLlmReasoning | undefined {
  const options = Array.isArray(row.reasoning_options) ? row.reasoning_options : [];
  let values: readonly unknown[] | undefined;
  for (const option of options) {
    if (option === null || typeof option !== "object") continue;
    const o = option as Record<string, unknown>;
    if (o.type !== "effort" || !Array.isArray(o.values)) continue;
    values = o.values;
    break;
  }
  if (values === undefined) return undefined;
  const efforts: { id: string; name: string }[] = [];
  const seen = new Set<string>();
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    efforts.push({ id, name: titleOf(id) });
  }
  if (efforts.length === 0) return undefined;
  const defaultEffort =
    ["high", "medium", "low"].find((level) => seen.has(level)) ?? efforts[Math.floor(efforts.length / 2)]?.id;
  return {
    efforts,
    ...defaultEffort === undefined ? {} : { defaultEffort },
  };
}

function modalitiesOf(row: CatalogModelRow): ("text" | "image")[] | undefined {
  const modalities = row.modalities;
  if (modalities === null || typeof modalities !== "object") return undefined;
  const input = (modalities as Record<string, unknown>).input;
  if (!Array.isArray(input)) return undefined;
  const kept: ("text" | "image")[] = [];
  for (const raw of input) {
    if (raw === "text" || raw === "image") {
      if (!kept.includes(raw)) kept.push(raw);
    }
  }
  return kept.length > 0 ? kept : undefined;
}

export interface EnrichOptions {
  /** Provider id the draft is editing, when it has one. */
  readonly provider?: string;
  /** Endpoint as the form shows it. */
  readonly baseUrl?: string;
  /**
   * Whether this route's adapter puts a chosen effort on the wire.
   *
   * Anthropic Messages and Gemini take a thinking budget, not `reasoning_effort`;
   * offering levels those adapters ignore would be a menu that changes nothing,
   * so their rows get capacities but no thinking menu.
   */
  readonly effortWire?: boolean;
  /**
   * Whether a provider the catalog has never heard of (a private relay, a
   * self-hosted gateway) may be answered from model ids that other providers
   * file identically.
   *
   * Only whole-provider misses qualify, and only when the id's numbers agree
   * across providers: a relay that trims a 1M window to 128k would otherwise be
   * filled with a ceiling its own endpoint rejects.
   */
  readonly globalFallback?: boolean;
}

/**
 * Merge catalog facts into one probe result, never overwriting the listing.
 * @param models - rows the endpoint advertised.
 * @param catalog - catalog to consult, when one is available.
 * @param options - drafted provider id and endpoint, for key resolution.
 * @returns the same rows with blanks filled, or the input array untouched.
 */
export function enrichFromModelsDev(
  models: readonly DiscoveredLlmModel[],
  catalog: ModelsDevCatalog | undefined,
  options: EnrichOptions,
): readonly DiscoveredLlmModel[] {
  if (catalog === undefined || models.length === 0) return models;
  const keys = catalogKeys(catalog, options);
  const provider = options.provider?.trim();
  const known =
    provider !== undefined
    && (catalog[provider] !== undefined
      || (PROVIDER_ALIASES[provider] ?? []).some((alias) => catalog[alias] !== undefined));
  const useGlobal = !known && options.globalFallback === true;
  if (keys.length === 0 && !useGlobal) return models;
  const index = useGlobal ? globalIndex(catalog) : undefined;
  let changed = false;
  const next = models.map((model) => {
    const local = keys
      .map((key) => {
        const rows = catalog[key]?.models;
        if (rows === null || typeof rows !== "object") return undefined;
        for (const id of modelRowLookupKeys(model.id)) {
          const found = asRow((rows as Record<string, unknown>)[id]);
          if (found !== undefined) return found;
        }
        return undefined;
      })
      .find((candidate) => candidate !== undefined);
    const rows = local !== undefined
      ? [local]
      : index === undefined
        ? []
        : modelRowLookupKeys(model.id).flatMap((id) => index.get(id) ?? []);
    if (rows.length === 0) return model;
    const limit = local !== undefined
      ? {
          contextWindow: positiveInt((local.limit as Record<string, unknown> | undefined)?.context),
          maxTokens: positiveInt((local.limit as Record<string, unknown> | undefined)?.output),
        }
      : agreedLimit(rows);
    // When listing and catalog disagree, keep the tighter window / output cap.
    // An inflated catalog ceiling (256k route published as 1M) delays soft
    // compact until the provider already rejects the request.
    const listedWindow = model.contextWindow;
    const catalogWindow = limit?.contextWindow;
    const contextWindow =
      listedWindow !== undefined && catalogWindow !== undefined
        ? Math.min(listedWindow, catalogWindow)
        : (listedWindow ?? catalogWindow);
    const listedMax = model.maxTokens;
    const catalogMax = limit?.maxTokens;
    const maxTokens =
      listedMax !== undefined && catalogMax !== undefined
        ? Math.min(listedMax, catalogMax)
        : (listedMax ?? catalogMax);
    const reasoning =
      model.reasoning
      ?? (options.effortWire === false
        ? undefined
        : local !== undefined
          ? reasoningOf(local)
          : agreedReasoning(rows));
    const inputModalities =
      model.inputModalities
      ?? (local !== undefined ? modalitiesOf(local) : agreedModalities(rows));
    if (
      contextWindow === model.contextWindow
      && maxTokens === model.maxTokens
      && reasoning === model.reasoning
      && inputModalities === model.inputModalities
    ) {
      return model;
    }
    changed = true;
    return {
      ...model,
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(maxTokens === undefined ? {} : { maxTokens }),
      ...(reasoning === undefined ? {} : { reasoning }),
      ...(inputModalities === undefined ? {} : { inputModalities }),
    };
  });
  return changed ? next : models;
}
