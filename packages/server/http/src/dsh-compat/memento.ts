/**
 * dsh-memento — file-backed memory entries under ~/.xrk/memento.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { sendJson } from "../http-json.js";
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
  createdAt: string;
  updatedAt: string;
}

interface MementoStore {
  language: string;
  entries: MementoEntry[];
  budgets: Record<string, number>;
}

const EMPTY_STORE: MementoStore = {
  language: "zh",
  entries: [],
  budgets: {},
};

const MEMENTO_STORE = createXrkDocStore(
  ["memento", "entries.json"],
  EMPTY_STORE,
);

export async function handleMementoHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: MementoOptions,
): Promise<boolean> {
  if (!pathname.startsWith("/api/memento")) return false;
  const method = (req.method ?? "GET").toUpperCase();
  const store = MEMENTO_STORE.read(options.xrkHome).data;
  const url = new URL(pathname, "http://127.0.0.1");

  if (pathname === "/api/memento/entries" || pathname.startsWith("/api/memento/entries")) {
    if (method === "GET") {
      const limit = Number(url.searchParams.get("limit") ?? "100");
      const entries = store.entries
        .slice()
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, Number.isFinite(limit) ? limit : 100);
      sendJson(res, 200, {
        language: store.language,
        entries,
        total: store.entries.length,
        truncated: entries.length < store.entries.length,
        budgets: store.budgets,
      });
      return true;
    }
    if (method === "POST") {
      const body = await parseJsonBody(req);
      const now = new Date().toISOString();
      const entry: MementoEntry = {
        id: randomUUID(),
        title: typeof body.title === "string" ? body.title : "",
        body: typeof body.body === "string" ? body.body : "",
        language:
          typeof body.language === "string" ? body.language : store.language,
        tags: Array.isArray(body.tags)
          ? body.tags.filter((t): t is string => typeof t === "string")
          : [],
        createdAt: now,
        updatedAt: now,
      };
      const saved = MEMENTO_STORE.patch(options.xrkHome, (current) => ({
        ...current,
        entries: [...current.entries, entry],
      }));
      sendJson(res, 201, { ok: true, entry, revision: saved.revision });
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
    sendJson(res, 200, {
      language: store.language,
      entries: store.entries,
      total: store.entries.length,
      truncated: false,
      budgets: store.budgets,
    });
    return true;
  }

  sendJson(res, 405, { ok: false, error: "method not allowed" });
  return true;
}

export function isMementoPath(pathname: string): boolean {
  return pathname.startsWith("/api/memento");
}
