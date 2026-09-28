/**
 * `dsh-context` — `/api/dsh-context/*` detail/balance/backfill.
 * Detail wire is `{ ok: true, value: detail }` (client `detailOf(r.value)`).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, parseJsonBody } from "./underlying/http-kit.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export interface DshContextOptions {
  readonly xrkHome?: string;
}

interface SessionDetail {
  rev: number;
  requests: unknown[];
  events: unknown[];
  nodes: unknown[];
  droppedNodes: number;
  archive: unknown[];
  images: number;
  toolCalls: number;
  humanInputs: number;
  counts: Record<string, number>;
}

interface ContextDoc {
  sessions: Record<string, SessionDetail>;
  warmed: number;
}

const STORE = createXrkDocStore<ContextDoc>(["dsh-context", "state.json"], {
  sessions: {},
  warmed: 0,
});

export function isDshContextPath(pathname: string): boolean {
  return (
    pathname === "/api/dsh-context" || pathname.startsWith("/api/dsh-context/")
  );
}

function emptyDetail(rev: number): SessionDetail {
  return {
    rev,
    requests: [],
    events: [],
    nodes: [],
    droppedNodes: 0,
    archive: [],
    images: 0,
    toolCalls: 0,
    humanInputs: 0,
    counts: {
      requests: 0,
      events: 0,
      nodes: 0,
      archive: 0,
    },
  };
}

function detailFor(
  xrkHome: string | undefined,
  sessionId: string,
): SessionDetail {
  const doc = STORE.read(xrkHome).data;
  const key = sessionId || "_default";
  return doc.sessions[key] ?? emptyDetail(0);
}

export async function handleDshContextHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: DshContextOptions = {},
): Promise<boolean> {
  if (!isDshContextPath(pathname)) return false;
  const method = httpMethod(req);
  const xrkHome = options.xrkHome;

  if (pathname === "/api/dsh-context/detail") {
    let sessionId = "";
    if (method === "POST" || method === "PUT") {
      const body = await parseJsonBody(req);
      sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
      // Optional client push of partial detail for offline inspection.
      if (body.value && typeof body.value === "object") {
        const incoming = body.value as Record<string, unknown>;
        const key = sessionId || "_default";
        STORE.patch(xrkHome, (doc) => {
          const prev = doc.sessions[key] ?? emptyDetail(0);
          const next: SessionDetail = {
            ...prev,
            rev: prev.rev + 1,
            ...(Array.isArray(incoming.requests)
              ? { requests: incoming.requests }
              : {}),
            ...(Array.isArray(incoming.events)
              ? { events: incoming.events }
              : {}),
            ...(Array.isArray(incoming.nodes) ? { nodes: incoming.nodes } : {}),
            ...(Array.isArray(incoming.archive)
              ? { archive: incoming.archive }
              : {}),
            ...(typeof incoming.droppedNodes === "number"
              ? { droppedNodes: incoming.droppedNodes }
              : {}),
          };
          return {
            ...doc,
            sessions: { ...doc.sessions, [key]: next },
          };
        });
      }
    }
    const detail = detailFor(xrkHome, sessionId);
    sendJson(res, 200, {
      ok: true,
      value: { ...detail, adapter: DSH_COMPAT_ADAPTER },
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/api/dsh-context/balance") {
    sendJson(res, 200, {
      isAvailable: false,
      balances: [],
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (pathname === "/api/dsh-context/backfill") {
    if (method === "POST" || method === "PUT") {
      await parseJsonBody(req).catch(() => ({}));
    }
    const doc = STORE.patch(xrkHome, (current) => ({
      ...current,
      warmed: current.warmed + 1,
    }));
    sendJson(res, 200, {
      ok: true,
      warmed: doc.data.warmed,
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    await parseJsonBody(req).catch(() => ({}));
  }
  sendJson(res, 200, {
    ok: true,
    path: pathname,
    adapter: DSH_COMPAT_ADAPTER,
  });
  return true;
}
