/**
 * Local embedding bridge for noema / mnemon memory search (bounded dims, keyword fallback).
 * External vector hosts (Qdrant, etc.) stay optional sidecars — not embedded in Host core.
 */
import { searchNoemaMemories } from "./host-feature-bridge.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import {
  embeddedVectorStoreStatus,
  rebuildEmbeddedVectorStore,
  searchEmbeddedVectorStore,
  upsertEmbeddedVectorRow,
  removeEmbeddedVectorRow,
} from "./embedded-vector-store.js";
import { adapterEcho } from "./honest-envelope.js";

export const MEMORY_EMBED_ENV_URL = "XRK_MEMORY_EMBED_URL";
export const MEMORY_EMBED_ENV_TOKEN = "XRK_MEMORY_EMBED_TOKEN";
export const MEMORY_EMBED_ENV_COLLECTION = "XRK_MEMORY_EMBED_COLLECTION";
/** OpenAI-compatible embeddings base (…/v1 or …/v1/embeddings). */
export const MEMORY_EMBEDDINGS_ENV_URL = "XRK_MEMORY_EMBEDDINGS_URL";
export const MEMORY_EMBEDDINGS_ENV_MODEL = "XRK_MEMORY_EMBEDDINGS_MODEL";
export const MEMORY_EMBEDDINGS_ENV_TOKEN = "XRK_MEMORY_EMBEDDINGS_TOKEN";
export const DEFAULT_MEMORY_EMBEDDINGS_MODEL = "text-embedding-3-small";

/** Face `memory-embed` product (Settings → Plugins → Advanced). */
export type MemoryEmbedProduct = {
  readonly url?: string;
  readonly token?: string;
  readonly collection?: string;
  /** Optional OpenAI-compatible embeddings endpoint for the embedded host. */
  readonly embeddingsUrl?: string;
  readonly embeddingsModel?: string;
};

/**
 * Resolve external vector sidecar.
 * Non-empty `XRK_MEMORY_EMBED_URL` wins (CI bypass); else Face product URL.
 */
export function readExternalMemoryEmbedConfig(
  env: NodeJS.ProcessEnv = process.env,
  product?: MemoryEmbedProduct,
): { url: string; token?: string; collection?: string } | undefined {
  const envUrl = env[MEMORY_EMBED_ENV_URL]?.trim();
  if (envUrl) {
    const token = env[MEMORY_EMBED_ENV_TOKEN]?.trim();
    const collection = env[MEMORY_EMBED_ENV_COLLECTION]?.trim();
    return {
      url: envUrl,
      ...(token ? { token } : {}),
      ...(collection ? { collection } : {}),
    };
  }
  const productUrl = product?.url?.trim();
  if (!productUrl) return undefined;
  const token =
    product?.token?.trim() || env[MEMORY_EMBED_ENV_TOKEN]?.trim() || undefined;
  const collection =
    product?.collection?.trim() ||
    env[MEMORY_EMBED_ENV_COLLECTION]?.trim() ||
    undefined;
  return {
    url: productUrl,
    ...(token ? { token } : {}),
    ...(collection ? { collection } : {}),
  };
}

export function externalMemoryEmbedStatus(
  env: NodeJS.ProcessEnv = process.env,
  product?: MemoryEmbedProduct,
): Record<string, unknown> {
  const external = readExternalMemoryEmbedConfig(env, product);
  if (!external) {
    return {
      external: null,
      env: [
        MEMORY_EMBED_ENV_URL,
        MEMORY_EMBED_ENV_TOKEN,
        MEMORY_EMBED_ENV_COLLECTION,
      ],
    };
  }
  return {
    external: {
      url: external.url,
      configured: true,
      embedded: false,
      sidecarSearchPath: "/search",
      note: "External vector sidecar configured; embedding.search POSTs to sidecar /search with local fallback.",
    },
    env: [
      MEMORY_EMBED_ENV_URL,
      MEMORY_EMBED_ENV_TOKEN,
      MEMORY_EMBED_ENV_COLLECTION,
    ],
  };
}

export async function probeExternalMemoryEmbedSidecar(
  config: { url: string; token?: string },
  timeoutMs = 3000,
): Promise<{ ok: boolean; error?: string }> {
  const base = config.url.replace(/\/+$/, "");
  const headers: Record<string, string> = { accept: "application/json" };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  try {
    const res = await fetch(`${base}/health`, {
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, error: `upstream ${res.status}` };
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function normalizeExternalHits(
  body: unknown,
): Array<{ id: string; text: string; score: number }> {
  if (!body || typeof body !== "object") return [];
  const raw =
    (body as { hits?: unknown }).hits ??
    (body as { results?: unknown }).results ??
    (body as { data?: unknown }).data;
  if (!Array.isArray(raw)) return [];
  const out: Array<{ id: string; text: string; score: number }> = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const id = String(
      (row as { id?: unknown }).id ??
        (row as { memoryId?: unknown }).memoryId ??
        "",
    );
    const text = String(
      (row as { text?: unknown }).text ??
        (row as { content?: unknown }).content ??
        "",
    );
    if (!id || !text) continue;
    const scoreRaw = (row as { score?: unknown }).score;
    const score =
      typeof scoreRaw === "number" && Number.isFinite(scoreRaw) ? scoreRaw : 1;
    out.push({ id, text, score });
  }
  return out;
}

export async function fetchExternalMemorySearch(
  config: { url: string; token?: string; collection?: string },
  query: string,
  limit = 16,
  timeoutMs = 10_000,
): Promise<Array<{ id: string; text: string; score: number }> | null> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const base = config.url.replace(/\/+$/, "");
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  try {
    const res = await fetch(`${base}/search`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: trimmed,
        limit,
        ...(config.collection ? { collection: config.collection } : {}),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return normalizeExternalHits(await res.json());
  } catch {
    return null;
  }
}

export const LOCAL_EMBED_DIMS = 32;
export const LOCAL_EMBED_MAX_ENTRIES = 256;

export interface MemoryEmbedRow {
  readonly id: string;
  readonly text: string;
  readonly tags?: readonly string[];
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

/** Deterministic bag-of-token hash embedding (local bridge — not a hosted model). */
export function embedTextLocal(text: string, dims = LOCAL_EMBED_DIMS): number[] {
  const vec = new Array<number>(dims).fill(0);
  for (const token of tokenize(text)) {
    let h = 2166136261;
    for (let i = 0; i < token.length; i++) {
      h ^= token.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    const idx = Math.abs(h) % dims;
    vec[idx] = (vec[idx] ?? 0) + 1;
  }
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map((v) => v / norm);
}

/**
 * Resolve OpenAI-compatible embeddings config.
 * `XRK_MEMORY_EMBEDDINGS_URL` wins; else Face `memory-embed.embeddingsUrl`.
 */
export function readMemoryEmbeddingsModelConfig(
  env: NodeJS.ProcessEnv = process.env,
  product?: MemoryEmbedProduct,
): { url: string; token?: string; model: string } | undefined {
  const envUrl = env[MEMORY_EMBEDDINGS_ENV_URL]?.trim();
  const productUrl = product?.embeddingsUrl?.trim();
  const url = envUrl || productUrl;
  if (!url) return undefined;
  const token =
    env[MEMORY_EMBEDDINGS_ENV_TOKEN]?.trim() ||
    product?.token?.trim() ||
    env[MEMORY_EMBED_ENV_TOKEN]?.trim() ||
    undefined;
  const model =
    env[MEMORY_EMBEDDINGS_ENV_MODEL]?.trim() ||
    product?.embeddingsModel?.trim() ||
    DEFAULT_MEMORY_EMBEDDINGS_MODEL;
  return { url, model, ...(token ? { token } : {}) };
}

function embeddingsEndpoint(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (/\/embeddings$/i.test(trimmed)) return trimmed;
  if (/\/v1$/i.test(trimmed)) return `${trimmed}/embeddings`;
  return `${trimmed}/embeddings`;
}

/**
 * OpenAI-compatible `/v1/embeddings` call. Returns undefined on transport /
 * shape failure so callers can fall back to {@link embedTextLocal}.
 */
export async function embedTextRemote(
  text: string,
  config: { url: string; token?: string; model: string },
  timeoutMs = 15_000,
): Promise<number[] | undefined> {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const headers: Record<string, string> = {
    accept: "application/json",
    "content-type": "application/json",
  };
  if (config.token) headers.authorization = `Bearer ${config.token}`;
  try {
    const res = await fetch(embeddingsEndpoint(config.url), {
      method: "POST",
      headers,
      body: JSON.stringify({
        model: config.model,
        input: trimmed,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const vec = body.data?.[0]?.embedding;
    if (!Array.isArray(vec) || vec.length === 0) return undefined;
    if (!vec.every((n) => typeof n === "number" && Number.isFinite(n))) {
      return undefined;
    }
    const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
    return vec.map((v) => v / norm);
  } catch {
    return undefined;
  }
}

/**
 * Prefer remote embeddings when configured; otherwise local hash.
 * Used by the embedded vector host for upsert / query.
 */
export async function embedTextPreferRemote(
  text: string,
  env: NodeJS.ProcessEnv = process.env,
  product?: MemoryEmbedProduct,
): Promise<{ vector: number[]; mode: "remote" | "local-hash" }> {
  const remoteCfg = readMemoryEmbeddingsModelConfig(env, product);
  if (remoteCfg) {
    const remote = await embedTextRemote(text, remoteCfg);
    if (remote) return { vector: remote, mode: "remote" };
  }
  return { vector: embedTextLocal(text), mode: "local-hash" };
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}

export function searchMemoryEmbeddings(
  memories: readonly MemoryEmbedRow[],
  query: string,
  limit = 16,
): Array<{ id: string; text: string; score: number }> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const keyword = searchNoemaMemories(
    memories.map((row) => ({ ...row, tags: row.tags ?? [] })),
    trimmed,
    limit,
  );
  if (keyword.length >= limit) return keyword;

  const qVec = embedTextLocal(trimmed);
  const scored = memories
    .map((row) => ({
      id: row.id,
      text: row.text,
      score: cosine(qVec, embedTextLocal(`${row.text} ${(row.tags ?? []).join(" ")}`)),
    }))
    .filter((row) => row.score > 0.01)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const merged = new Map<string, { id: string; text: string; score: number }>();
  for (const row of [...keyword, ...scored]) {
    const prev = merged.get(row.id);
    if (!prev || row.score > prev.score) merged.set(row.id, row);
  }
  return [...merged.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

export async function searchMemoryEmbeddingsAsync(
  memories: readonly MemoryEmbedRow[],
  query: string,
  limit = 16,
  env: NodeJS.ProcessEnv = process.env,
  xrkHome?: string,
  product?: MemoryEmbedProduct,
): Promise<{
  hits: Array<{ id: string; text: string; score: number }>;
  mode: "sidecar" | "embedded-host" | "embedded-remote" | "local-embedding-bridge";
}> {
  const external = readExternalMemoryEmbedConfig(env, product);
  if (external) {
    const sidecarHits = await fetchExternalMemorySearch(external, query, limit);
    if (sidecarHits && sidecarHits.length > 0) {
      return { hits: sidecarHits, mode: "sidecar" };
    }
  }
  const preferred = await embedTextPreferRemote(query, env, product);
  const embeddedHits = searchEmbeddedVectorStore(
    xrkHome,
    query,
    limit,
    preferred.vector,
  );
  if (embeddedHits.length > 0) {
    return {
      hits: embeddedHits,
      mode: preferred.mode === "remote" ? "embedded-remote" : "embedded-host",
    };
  }
  return {
    hits: searchMemoryEmbeddings(memories, query, limit),
    mode: "local-embedding-bridge",
  };
}

const NOEMA_MEMORY_DOC = createXrkDocStore<{ memories: MemoryEmbedRow[] }>(
  ["noema", "memories.json"],
  { memories: [] },
);

/** Rebuild ~/.xrk/memory-embeddings from noema memory index (idempotent boot). */
export function rebuildEmbeddedVectorIndex(xrkHome?: string): number {
  const doc = NOEMA_MEMORY_DOC.read(xrkHome).data;
  return rebuildEmbeddedVectorStore(
    xrkHome,
    doc.memories.map((m) => ({
      id: m.id,
      text: m.text,
      ...(m.tags?.length ? { tags: m.tags } : {}),
    })),
  );
}

export function syncEmbeddedVectorRow(
  xrkHome: string | undefined,
  row: MemoryEmbedRow,
): void {
  upsertEmbeddedVectorRow(xrkHome, row);
}

/** Upsert with optional remote embeddings (falls back to local hash). */
export async function syncEmbeddedVectorRowPreferRemote(
  xrkHome: string | undefined,
  row: MemoryEmbedRow,
  env: NodeJS.ProcessEnv = process.env,
  product?: MemoryEmbedProduct,
): Promise<"remote" | "local-hash"> {
  const preferred = await embedTextPreferRemote(
    `${row.text} ${(row.tags ?? []).join(" ")}`,
    env,
    product,
  );
  upsertEmbeddedVectorRow(xrkHome, row, preferred.vector);
  return preferred.mode;
}

export function dropEmbeddedVectorRow(
  xrkHome: string | undefined,
  id: string,
): void {
  removeEmbeddedVectorRow(xrkHome, id);
}

export function memoryEmbeddingsStatus(
  xrkHome?: string,
  env: NodeJS.ProcessEnv = process.env,
  product?: MemoryEmbedProduct,
): Record<string, unknown> {
  const external = readExternalMemoryEmbedConfig(env, product);
  const embeddingsModel = readMemoryEmbeddingsModelConfig(env, product);
  const embedded = embeddedVectorStoreStatus(xrkHome);
  const engines = [
    "keyword",
    "local-hash",
    "embedded-host",
    ...(embeddingsModel ? (["openai-embeddings"] as const) : []),
    ...(external ? (["sidecar-http"] as const) : []),
  ];
  return {
    ok: true,
    state: external
      ? "sidecar-or-embedded"
      : embeddingsModel
        ? "embedded-remote-or-hash"
        : "embedded-host",
    dimensions: LOCAL_EMBED_DIMS,
    maxEntries: LOCAL_EMBED_MAX_ENTRIES,
    engines,
    embeddingsModel: embeddingsModel
      ? {
          url: embeddingsModel.url,
          model: embeddingsModel.model,
          configured: true,
        }
      : null,
    ...externalMemoryEmbedStatus(env, product),
    store: embedded,
    note: embeddingsModel
      ? "OpenAI-compatible embeddings configured for the embedded host; hash fallback when remote fails."
      : external
        ? "Embedded vector host + optional XRK_MEMORY_EMBED_* / Settings memory-embed sidecar upgrade."
        : "Embedded vector host under ~/.xrk/memory-embeddings/; local hash fallback. Set XRK_MEMORY_EMBEDDINGS_URL for real vectors.",
    ...adapterEcho(),
  };
}
