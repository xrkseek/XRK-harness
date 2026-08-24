/**
 * dsh-memento — file-backed memory entries under ~/.xrk/memento.
 * Wire shape matches community client (`text` / `track` / `scope` / budgets[]).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { parseJsonBody } from "./underlying/http-kit.js";

export interface MementoOptions {
  readonly xrkHome?: string;
}

interface MementoEntry {
  id: string;
  title: string;
  body: string;
  language: string;
  tags: string[];
  track?: string;
  scope?: string;
  source?: string;
  agentKey?: string;
  createdAt: string;
  updatedAt: string;
}

interface MementoBudgetRow {
  track: string;
  scope: string;
  used: number;
  limit: number;
}

interface MementoStore {
  language: string;
  entries: MementoEntry[];
  budgets: MementoBudgetRow[] | Record<string, number>;
}

const EMPTY_STORE: MementoStore = {
  language: "zh",
  entries: [],
  budgets: [],
};

const MEMENTO_STORE = createXrkDocStore(
  ["memento", "entries.json"],
  EMPTY_STORE,
);

function normalizeBudgets(
  budgets: MementoStore["budgets"],
): MementoBudgetRow[] {
  if (Array.isArray(budgets)) {
    return budgets.filter(
      (row): row is MementoBudgetRow =>
        !!row &&
        typeof row === "object" &&
        typeof (row).track === "string" &&
        typeof (row).scope === "string",
    );
  }
  if (budgets && typeof budgets === "object") {
    return Object.entries(budgets).map(([key, limit]) => {
      const [track = "default", scope = "global"] = key.split("/");
      return {
        track,
        scope,
        used: 0,
        limit: typeof limit === "number" ? limit : 0,
      };
    });
  }
  return [];
}

function wireEntry(entry: MementoEntry): Record<string, unknown> {
  const text = entry.body.trim() || entry.title.trim();
  return {
    id: entry.id,
    text,
    track: entry.track ?? "default",
    scope: entry.scope ?? "global",
    source: entry.source ?? "manual",
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    ...(entry.agentKey ? { agentKey: entry.agentKey } : {}),
    ...(entry.tags.length > 0 ? { tags: entry.tags } : {}),
  };
}

function listPayload(store: MementoStore, limit: number) {
  const entries = store.entries
    .slice()
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, limit)
    .map(wireEntry);
  return {
    language: store.language,
    entries,
    total: store.entries.length,
    truncated: entries.length < store.entries.length,
    budgets: normalizeBudgets(store.budgets),
  };
}

export async function handleMementoHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: MementoOptions,
): Promise<boolean> {
  if (!pathname.startsWith("/api/memento")) return false;
  const method = (req.method ?? "GET").toUpperCase();
  const store = MEMENTO_STORE.read(options.xrkHome).data;
  const url = new URL(req.url ?? "/", "http://127.0.0.1");

  if (pathname === "/api/memento/audit") {
    sendJson(res, 200, { rows: [] });
    return true;
  }

  if (pathname === "/api/memento/proposals") {
    sendJson(res, 200, { proposals: [] });
    return true;
  }

  if (pathname === "/api/memento/entries" || pathname.startsWith("/api/memento/entries")) {
    if (method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? "100");
      sendJson(
        res,
        200,
        listPayload(store, Number.isFinite(limit) ? limit : 100),
      );
      return true;
    }
    if (method === "POST") {
      const body = await parseJsonBody(req);
      const now = new Date().toISOString();
      const text =
        typeof body.text === "string"
          ? body.text
          : typeof body.body === "string"
            ? body.body
            : "";
      const entry: MementoEntry = {
        id: randomUUID(),
        title: typeof body.title === "string" ? body.title : text.slice(0, 80),
        body: text,
        language:
          typeof body.language === "string" ? body.language : store.language,
        tags: Array.isArray(body.tags)
          ? body.tags.filter((t): t is string => typeof t === "string")
          : [],
        track: typeof body.track === "string" ? body.track : "default",
        scope: typeof body.scope === "string" ? body.scope : "global",
        source: typeof body.source === "string" ? body.source : "manual",
        ...(typeof body.agentKey === "string" ? { agentKey: body.agentKey } : {}),
        createdAt: now,
        updatedAt: now,
      };
      const saved = MEMENTO_STORE.patch(options.xrkHome, (current) => ({
        ...current,
        entries: [...current.entries, entry],
      }));
      sendJson(res, 201, {
        ok: true,
        entry: wireEntry(entry),
        revision: saved.revision,
      });
      return true;
    }
  }

  const entryMatch = /^\/api\/memento\/entries\/([^/]+)$/.exec(pathname);
  if (entryMatch && method === "DELETE") {
    const id = decodeURIComponent(entryMatch[1]!);
    const saved = MEMENTO_STORE.patch(options.xrkHome, (current) => ({
      ...current,
      entries: current.entries.filter((e) => e.id !== id),
    }));
    sendJson(res, 200, { ok: true, revision: saved.revision });
    return true;
  }

  if (method === "GET") {
    sendJson(res, 200, listPayload(store, store.entries.length));
    return true;
  }

  sendJson(res, 405, { ok: false, error: "method not allowed" });
  return true;
}

export function isMementoPath(pathname: string): boolean {
  return pathname.startsWith("/api/memento");
}
