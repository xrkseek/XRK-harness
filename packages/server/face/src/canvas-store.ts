/**
 * Workspace-scoped Canvas documents under `{XRK_HOME}/canvases/<workspaceId>/`.
 * Session create/delete does not touch these files.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { resolveXrkHome } from "@xrkseek/server-config";
import { tryWriteJsonSidecar } from "./json-sidecar.js";

/** Semantic color for KPI values, callouts, and series bars (report-board tones). */
export type CanvasTone = "neutral" | "good" | "warn" | "bad" | "accent";

const CANVAS_TONES = new Set<CanvasTone>([
  "neutral",
  "good",
  "warn",
  "bad",
  "accent",
]);

export function parseCanvasTone(raw: unknown): CanvasTone | undefined {
  if (typeof raw !== "string") return undefined;
  return CANVAS_TONES.has(raw as CanvasTone) ? (raw as CanvasTone) : undefined;
}

export type CanvasSection =
  | { readonly kind: "markdown"; readonly body: string }
  | {
      readonly kind: "table";
      readonly columns: readonly string[];
      readonly rows: readonly (readonly string[])[];
    }
  | {
      readonly kind: "kpi";
      readonly items: readonly {
        readonly label: string;
        readonly value: string;
        readonly tone?: CanvasTone;
      }[];
    }
  | {
      readonly kind: "callout";
      readonly body: string;
      readonly title?: string;
      readonly tone?: CanvasTone;
    }
  | {
      readonly kind: "series";
      readonly title: string;
      readonly points: readonly { readonly x: string; readonly y: number }[];
      readonly tone?: CanvasTone;
    };

export interface CanvasDocument {
  readonly id: string;
  readonly title: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly sections: readonly CanvasSection[];
}

export interface CanvasSummary {
  readonly id: string;
  readonly title: string;
  readonly revision: number;
  readonly updatedAt: string;
}

const ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/;
const TITLE_MAX = 200;
const SECTION_MAX = 64;
const MARKDOWN_MAX = 100_000;

export function canvasesRoot(productHome?: string): string {
  return path.join(path.resolve(productHome ?? resolveXrkHome()), "canvases");
}

export function workspaceCanvasDir(
  workspaceId: string,
  productHome?: string,
): string {
  return path.join(canvasesRoot(productHome), sanitizeWorkspaceId(workspaceId));
}

function sanitizeWorkspaceId(workspaceId: string): string {
  const trimmed = workspaceId.trim();
  if (!trimmed || trimmed.includes("..") || trimmed.includes("/") || trimmed.includes("\\")) {
    throw new Error(`invalid workspaceId: ${workspaceId}`);
  }
  return trimmed;
}

export function isValidCanvasId(id: string): boolean {
  return ID_RE.test(id);
}

function canvasPath(
  workspaceId: string,
  canvasId: string,
  productHome?: string,
): string {
  if (!isValidCanvasId(canvasId)) {
    throw new Error(`invalid canvas id: ${canvasId}`);
  }
  return path.join(workspaceCanvasDir(workspaceId, productHome), `${canvasId}.json`);
}

function parseSection(raw: unknown): CanvasSection | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  const kind = o.kind;
  if (kind === "markdown" || kind === "md") {
    if (typeof o.body !== "string") return undefined;
    return { kind: "markdown", body: o.body.slice(0, MARKDOWN_MAX) };
  }
  if (kind === "table") {
    if (!Array.isArray(o.columns) || !Array.isArray(o.rows)) return undefined;
    const columns = o.columns.filter((c): c is string => typeof c === "string").slice(0, 32);
    const rows = o.rows
      .filter((row): row is unknown[] => Array.isArray(row))
      .slice(0, 500)
      .map((row) =>
        row.filter((cell): cell is string => typeof cell === "string").slice(0, columns.length || 32),
      );
    return { kind: "table", columns, rows };
  }
  if (kind === "kpi") {
    if (!Array.isArray(o.items)) return undefined;
    const items = o.items
      .filter((item): item is Record<string, unknown> => !!item && typeof item === "object")
      .slice(0, 32)
      .map((item) => {
        const tone = parseCanvasTone(item.tone);
        return {
          label: String(item.label ?? "").slice(0, 80),
          value: String(item.value ?? "").slice(0, 120),
          ...(tone !== undefined ? { tone } : {}),
        };
      })
      .filter((item) => item.label.length > 0);
    return { kind: "kpi", items };
  }
  if (kind === "callout") {
    if (typeof o.body !== "string") return undefined;
    const body = o.body.slice(0, MARKDOWN_MAX);
    if (!body.trim()) return undefined;
    const tone = parseCanvasTone(o.tone);
    const title =
      typeof o.title === "string" ? o.title.trim().slice(0, 120) : "";
    return {
      kind: "callout",
      body,
      ...(title ? { title } : {}),
      ...(tone !== undefined ? { tone } : {}),
    };
  }
  if (kind === "series") {
    if (typeof o.title !== "string" || !Array.isArray(o.points)) return undefined;
    const points = o.points
      .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
      .slice(0, 500)
      .map((p) => ({
        x: String(p.x ?? "").slice(0, 64),
        y: typeof p.y === "number" && Number.isFinite(p.y) ? p.y : 0,
      }));
    const tone = parseCanvasTone(o.tone);
    return {
      kind: "series",
      title: o.title.slice(0, TITLE_MAX),
      points,
      ...(tone !== undefined ? { tone } : {}),
    };
  }
  return undefined;
}

export function parseCanvasDocument(raw: unknown): CanvasDocument | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (typeof o.id !== "string" || !isValidCanvasId(o.id)) return undefined;
  if (typeof o.title !== "string") return undefined;
  if (typeof o.revision !== "number" || !Number.isInteger(o.revision) || o.revision < 1) {
    return undefined;
  }
  if (typeof o.createdAt !== "string" || typeof o.updatedAt !== "string") return undefined;
  if (!Array.isArray(o.sections)) return undefined;
  const sections: CanvasSection[] = [];
  for (const row of o.sections.slice(0, SECTION_MAX)) {
    const section = parseSection(row);
    if (section) sections.push(section);
  }
  return {
    id: o.id,
    title: o.title.slice(0, TITLE_MAX),
    revision: o.revision,
    createdAt: o.createdAt,
    updatedAt: o.updatedAt,
    sections,
  };
}

export function normalizeSections(raw: unknown): CanvasSection[] {
  if (!Array.isArray(raw)) return [];
  const out: CanvasSection[] = [];
  for (const row of raw.slice(0, SECTION_MAX)) {
    const section = parseSection(row);
    if (section) out.push(section);
  }
  return out;
}

export class FaceCanvasStore {
  private readonly productHome: string;
  private generation = 0;
  private readonly listeners = new Set<() => void>();

  constructor(productHome?: string) {
    this.productHome = path.resolve(productHome ?? resolveXrkHome());
  }

  /** Bumps when any canvas in any workspace changes (Overview refresh). */
  getGeneration(): number {
    return this.generation;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    this.generation += 1;
    for (const listener of this.listeners) {
      try {
        listener();
      } catch {
        /* contain */
      }
    }
  }

  list(workspaceId: string): readonly CanvasSummary[] {
    const dir = workspaceCanvasDir(workspaceId, this.productHome);
    if (!existsSync(dir)) return [];
    const out: CanvasSummary[] = [];
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".json")) continue;
      const id = name.slice(0, -".json".length);
      if (!isValidCanvasId(id)) continue;
      const doc = this.get(workspaceId, id);
      if (!doc) continue;
      out.push({
        id: doc.id,
        title: doc.title,
        revision: doc.revision,
        updatedAt: doc.updatedAt,
      });
    }
    out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id));
    return out;
  }

  get(workspaceId: string, canvasId: string): CanvasDocument | undefined {
    if (!isValidCanvasId(canvasId)) return undefined;
    const file = canvasPath(workspaceId, canvasId, this.productHome);
    if (!existsSync(file)) return undefined;
    try {
      const raw = JSON.parse(readFileSync(file, "utf8")) as unknown;
      const doc = parseCanvasDocument(raw);
      if (!doc || doc.id !== canvasId) return undefined;
      return doc;
    } catch {
      return undefined;
    }
  }

  upsert(
    workspaceId: string,
    input: {
      readonly id: string;
      readonly title: string;
      readonly sections: readonly CanvasSection[];
    },
  ): CanvasDocument {
    if (!isValidCanvasId(input.id)) {
      throw new Error(`invalid canvas id: ${input.id}`);
    }
    const title = input.title.trim().slice(0, TITLE_MAX) || input.id;
    const sections = [...input.sections].slice(0, SECTION_MAX);
    const now = new Date().toISOString();
    const prev = this.get(workspaceId, input.id);
    const doc: CanvasDocument = {
      id: input.id,
      title,
      revision: prev ? prev.revision + 1 : 1,
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,
      sections,
    };
    const dir = workspaceCanvasDir(workspaceId, this.productHome);
    mkdirSync(dir, { recursive: true });
    tryWriteJsonSidecar(canvasPath(workspaceId, input.id, this.productHome), doc);
    this.notify();
    return doc;
  }

  patch(
    workspaceId: string,
    canvasId: string,
    patch: {
      readonly title?: string;
      readonly sections?: readonly CanvasSection[];
    },
  ): CanvasDocument {
    const prev = this.get(workspaceId, canvasId);
    if (!prev) throw new Error(`canvas not found: ${canvasId}`);
    return this.upsert(workspaceId, {
      id: canvasId,
      title: patch.title !== undefined ? patch.title : prev.title,
      sections: patch.sections !== undefined ? patch.sections : prev.sections,
    });
  }

  delete(workspaceId: string, canvasId: string): boolean {
    if (!isValidCanvasId(canvasId)) return false;
    const file = canvasPath(workspaceId, canvasId, this.productHome);
    if (!existsSync(file)) return false;
    rmSync(file, { force: true });
    this.notify();
    return true;
  }
}
