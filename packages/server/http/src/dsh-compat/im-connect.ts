/**
 * @michengai/dsh-im-connect — persisted channel configs (offline until IM host).
 * Seat `sidebar.channels` remains a known DSH-only gap.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { httpMethod, parseJsonBody } from "./underlying/http-kit.js";
import { DSH_COMPAT_ADAPTER, tag } from "./meta.js";

export interface ImConnectOptions {
  readonly xrkHome?: string;
}

interface ChannelRow {
  id: string;
  kind: string;
  name: string;
  enabled: boolean;
  config: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

interface AssistantDoc {
  providers: unknown[];
  permissions: unknown[];
  agentPresets: unknown[];
  agentPreset: string;
  assistant: unknown;
  cwd: string;
  permission: string;
}

interface ImConnectDoc {
  channels: ChannelRow[];
  pending: unknown[];
  assistant: AssistantDoc;
}

const STORE = createXrkDocStore<ImConnectDoc>(
  ["dsh-im-connect", "state.json"],
  {
    channels: [],
    pending: [],
    assistant: {
      providers: [],
      permissions: [],
      agentPresets: [],
      agentPreset: "standard",
      assistant: null,
      cwd: "",
      permission: "",
    },
  },
);

export function isImConnectPath(pathname: string): boolean {
  return (
    pathname === "/api/dsh-im-connect" ||
    pathname.startsWith("/api/dsh-im-connect/") ||
    pathname === "/api/michengai/dsh-im-connect" ||
    pathname.startsWith("/api/michengai/dsh-im-connect/")
  );
}

export async function handleImConnectHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: ImConnectOptions = {},
): Promise<boolean> {
  if (!isImConnectPath(pathname)) return false;
  const method = httpMethod(req);
  const xrkHome = options.xrkHome;
  const base = pathname.startsWith("/api/michengai/dsh-im-connect")
    ? pathname.replace(/^\/api\/michengai\/dsh-im-connect/, "/api/dsh-im-connect")
    : pathname;
  const rel = base.replace(/^\/api\/dsh-im-connect\/?/, "/");

  if (rel === "/" || rel === "/channels" || rel === "/channels/") {
    if (method === "GET" || method === "HEAD") {
      const doc = STORE.read(xrkHome).data;
      sendJson(
        res,
        200,
        tag(
          {
            ok: true,
            channels: doc.channels,
            pending: doc.pending,
            adapter: DSH_COMPAT_ADAPTER,
            note: "Channels persist locally; live IM tunnel still needs vendor host.",
          },
          ["im-host"],
        ),
      );
      return true;
    }
    if (method === "POST") {
      const body = await parseJsonBody(req);
      const now = new Date().toISOString();
      const row: ChannelRow = {
        id: typeof body.id === "string" ? body.id : randomUUID(),
        kind: typeof body.kind === "string" ? body.kind : "custom",
        name: typeof body.name === "string" ? body.name : "Channel",
        enabled: body.enabled !== false,
        config:
          body.config && typeof body.config === "object"
            ? (body.config as Record<string, unknown>)
            : {},
        createdAt: now,
        updatedAt: now,
      };
      STORE.patch(xrkHome, (doc) => ({
        ...doc,
        channels: [...doc.channels.filter((c) => c.id !== row.id), row],
      }));
      sendJson(res, 200, {
        ok: true,
        channel: row,
        channels: STORE.read(xrkHome).data.channels,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
  }

  if (rel === "/assistant" || rel === "/assistant/") {
    if (method === "GET" || method === "HEAD") {
      const a = STORE.read(xrkHome).data.assistant;
      sendJson(
        res,
        200,
        tag({ ok: true, ...a, adapter: DSH_COMPAT_ADAPTER }, ["im-host"]),
      );
      return true;
    }
    if (method === "PUT" || method === "POST" || method === "PATCH") {
      const body = await parseJsonBody(req);
      STORE.patch(xrkHome, (doc) => ({
        ...doc,
        assistant: { ...doc.assistant, ...body },
      }));
      sendJson(res, 200, {
        ok: true,
        ...STORE.read(xrkHome).data.assistant,
        adapter: DSH_COMPAT_ADAPTER,
      });
      return true;
    }
  }

  if (rel === "/sessions/ensure" || rel.startsWith("/sessions/")) {
    if (method === "POST") await parseJsonBody(req).catch(() => ({}));
    sendJson(
      res,
      200,
      tag(
        {
          ok: false,
          error: "im-host-unavailable",
          path: pathname,
          adapter: DSH_COMPAT_ADAPTER,
        },
        ["im-host"],
      ),
    );
    return true;
  }

  if (rel.includes("/qr/") || rel.endsWith("/connect")) {
    if (method === "POST") await parseJsonBody(req).catch(() => ({}));
    sendJson(
      res,
      200,
      tag(
        {
          ok: false,
          pairing: false,
          error: "im-host-unavailable",
          adapter: DSH_COMPAT_ADAPTER,
        },
        ["im-host"],
      ),
    );
    return true;
  }

  if (rel.startsWith("/accounts/")) {
    if (method === "POST" || method === "DELETE") {
      await parseJsonBody(req).catch(() => ({}));
    }
    sendJson(
      res,
      200,
      tag(
        { ok: false, error: "im-host-unavailable", adapter: DSH_COMPAT_ADAPTER },
        ["im-host"],
      ),
    );
    return true;
  }

  if (method === "POST" || method === "PUT" || method === "PATCH") {
    await parseJsonBody(req).catch(() => ({}));
  }
  const doc = STORE.read(xrkHome).data;
  sendJson(
    res,
    200,
    tag(
      {
        ok: true,
        channels: doc.channels,
        pending: doc.pending,
        adapter: DSH_COMPAT_ADAPTER,
      },
      ["im-host"],
    ),
  );
  return true;
}
