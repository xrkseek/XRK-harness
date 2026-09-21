/**
 * In-process Mnemon retrieval over stored documents.
 * Keyword search · mention graph · memory bodies. Not a vector DB.
 */
import type { MnemonDocument } from "./mnemon-store.js";

export interface MnemonHit {
  readonly id: string;
  readonly title: string;
  readonly score: number;
  readonly snippet: string;
}

export interface MnemonEntity {
  readonly id: string;
  readonly label: string;
  readonly kind: "wiki" | "tag";
}

export interface MnemonGraph {
  readonly nodes: ReadonlyArray<{
    readonly id: string;
    readonly label: string;
    readonly kind: "document" | "entity";
  }>;
  readonly edges: ReadonlyArray<{
    readonly from: string;
    readonly to: string;
    readonly kind: "mentions" | "related";
  }>;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

function wikiAndTags(body: string): MnemonEntity[] {
  const out: MnemonEntity[] = [];
  const seen = new Set<string>();
  for (const match of body.matchAll(/\[\[([^\]\n]{1,80})\]\]/g)) {
    const label = match[1]!.trim();
    if (!label) continue;
    const id = `wiki:${label.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, kind: "wiki" });
  }
  for (const match of body.matchAll(/(^|\s)#([\p{L}\p{N}_-]{2,40})/gu)) {
    const label = match[2]!;
    const id = `tag:${label.toLowerCase()}`;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, label, kind: "tag" });
  }
  return out;
}

function haystack(doc: MnemonDocument): string {
  return `${doc.title}\n${doc.body}`.toLowerCase();
}

export function searchMnemonDocuments(
  docs: readonly MnemonDocument[],
  query: string,
  limit = 20,
): MnemonHit[] {
  const tokens = tokenize(query);
  if (tokens.length === 0) return [];
  const hits: MnemonHit[] = [];
  for (const doc of docs) {
    if (doc.archived) continue;
    const hay = haystack(doc);
    let score = 0;
    for (const token of tokens) {
      if (hay.includes(token)) score += 1;
    }
    if (score === 0) continue;
    const idx = hay.indexOf(tokens[0]!);
    const start = Math.max(0, idx - 40);
    const snippet = `${doc.title}\n${doc.body}`.slice(start, start + 160);
    hits.push({ id: doc.id, title: doc.title, score, snippet });
  }
  hits.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));
  return hits.slice(0, limit);
}

export function collectMnemonEntities(
  docs: readonly MnemonDocument[],
): MnemonEntity[] {
  const map = new Map<string, MnemonEntity>();
  for (const doc of docs) {
    if (doc.archived) continue;
    for (const ent of wikiAndTags(`${doc.title}\n${doc.body}`)) {
      map.set(ent.id, ent);
    }
  }
  return [...map.values()];
}

export function buildMnemonGraph(docs: readonly MnemonDocument[]): MnemonGraph {
  const active = docs.filter((d) => !d.archived);
  const nodes: MnemonGraph["nodes"][number][] = active.map((d) => ({
    id: d.id,
    label: d.title || d.id,
    kind: "document" as const,
  }));
  const edges: MnemonGraph["edges"][number][] = [];
  const entityIds = new Set<string>();
  for (const doc of active) {
    for (const ent of wikiAndTags(`${doc.title}\n${doc.body}`)) {
      if (!entityIds.has(ent.id)) {
        entityIds.add(ent.id);
        nodes.push({ id: ent.id, label: ent.label, kind: "entity" });
      }
      edges.push({ from: doc.id, to: ent.id, kind: "mentions" });
    }
    for (const other of active) {
      if (other.id === doc.id || !other.title.trim()) continue;
      if (doc.body.toLowerCase().includes(other.title.toLowerCase())) {
        edges.push({ from: doc.id, to: other.id, kind: "related" });
      }
    }
  }
  return { nodes, edges };
}

export function relatedMnemonDocuments(
  docs: readonly MnemonDocument[],
  id: string,
  limit = 12,
): MnemonHit[] {
  const source = docs.find((d) => d.id === id && !d.archived);
  if (!source) return [];
  const ents = new Set(
    wikiAndTags(`${source.title}\n${source.body}`).map((e) => e.id),
  );
  const tokens = tokenize(`${source.title} ${source.body}`).slice(0, 24);
  const hits: MnemonHit[] = [];
  for (const doc of docs) {
    if (doc.archived || doc.id === id) continue;
    const theirs = new Set(
      wikiAndTags(`${doc.title}\n${doc.body}`).map((e) => e.id),
    );
    let score = 0;
    for (const ent of ents) {
      if (theirs.has(ent)) score += 2;
    }
    const hay = haystack(doc);
    for (const token of tokens) {
      if (hay.includes(token)) score += 1;
    }
    if (score === 0) continue;
    hits.push({
      id: doc.id,
      title: doc.title,
      score,
      snippet: doc.body.slice(0, 160),
    });
  }
  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

export function mnemonBodies(docs: readonly MnemonDocument[]) {
  return docs
    .filter((d) => !d.archived)
    .map((d) => ({
      id: d.id,
      title: d.title,
      body: d.body,
      bytes: Buffer.byteLength(d.body, "utf8"),
      updatedAt: d.updatedAt,
    }));
}
