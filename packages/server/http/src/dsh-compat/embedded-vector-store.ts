/**
 * File-backed in-process vector index (~/.xrk/memory-embeddings/store.json).
 */
import { createXrkDocStore } from "./underlying/doc-store.js";

export const EMBEDDED_VECTOR_DIMS = 32;
export const EMBEDDED_VECTOR_MAX_ENTRIES = 256;

interface EmbeddedVectorRow {
  readonly id: string;
  readonly text: string;
  readonly tags: readonly string[];
  readonly vector: readonly number[];
  readonly createdAt: string;
}

interface EmbeddedVectorDoc {
  readonly rows: readonly EmbeddedVectorRow[];
}

export interface EmbeddedVectorInput {
  readonly id: string;
  readonly text: string;
  readonly tags?: readonly string[];
}

const STORE = createXrkDocStore<EmbeddedVectorDoc>(
  ["memory-embeddings", "store.json"],
  { rows: [] },
);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

function embedText(text: string, dims = EMBEDDED_VECTOR_DIMS): number[] {
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

function cosine(a: readonly number[], b: readonly number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0);
  }
  return dot;
}

export function upsertEmbeddedVectorRow(
  xrkHome: string | undefined,
  row: EmbeddedVectorInput,
): void {
  const text = row.text.trim();
  if (!text) return;
  const vector = embedText(`${text} ${(row.tags ?? []).join(" ")}`);
  STORE.patch(xrkHome, (current) => {
    const without = current.rows.filter((r) => r.id !== row.id);
    const next: EmbeddedVectorRow = {
      id: row.id,
      text,
      tags: row.tags ?? [],
      vector,
      createdAt: new Date().toISOString(),
    };
    return { rows: [next, ...without].slice(0, EMBEDDED_VECTOR_MAX_ENTRIES) };
  });
}

export function removeEmbeddedVectorRow(
  xrkHome: string | undefined,
  id: string,
): void {
  STORE.patch(xrkHome, (current) => ({
    rows: current.rows.filter((r) => r.id !== id),
  }));
}

export function searchEmbeddedVectorStore(
  xrkHome: string | undefined,
  query: string,
  limit = 16,
): Array<{ id: string; text: string; score: number }> {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const doc = STORE.read(xrkHome).data;
  if (doc.rows.length === 0) return [];
  const qVec = embedText(trimmed);
  return doc.rows
    .map((row) => ({
      id: row.id,
      text: row.text,
      score: cosine(qVec, row.vector),
    }))
    .filter((row) => row.score > 0.01)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

/** Replace the embedded index from noema rows (Host boot / reindex). */
export function rebuildEmbeddedVectorStore(
  xrkHome: string | undefined,
  rows: readonly EmbeddedVectorInput[],
): number {
  const next: EmbeddedVectorRow[] = [];
  for (const row of rows.slice(0, EMBEDDED_VECTOR_MAX_ENTRIES)) {
    const text = row.text.trim();
    if (!text) continue;
    next.push({
      id: row.id,
      text,
      tags: row.tags ?? [],
      vector: embedText(`${text} ${(row.tags ?? []).join(" ")}`),
      createdAt: new Date().toISOString(),
    });
  }
  STORE.write(xrkHome, { rows: next });
  return next.length;
}

export function embeddedVectorStoreStatus(
  xrkHome: string | undefined,
): Record<string, unknown> {
  const doc = STORE.read(xrkHome).data;
  return {
    embedded: true,
    path: STORE.parts.join("/"),
    dimensions: EMBEDDED_VECTOR_DIMS,
    maxEntries: EMBEDDED_VECTOR_MAX_ENTRIES,
    rowCount: doc.rows.length,
  };
}
