/**
 * IM message send/receive + webhook ingress (local bridge — not vendor long-connection).
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendJson } from "./underlying/http-json.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { parseJsonBody } from "./underlying/http-kit.js";

export interface ImMessageRow {
  readonly id: string;
  readonly channel: string;
  readonly botId?: string;
  readonly direction: "inbound" | "outbound";
  readonly text: string;
  readonly raw?: Record<string, unknown>;
  readonly createdAt: string;
}

interface ImMessagingDoc {
  messages: ImMessageRow[];
}

const MESSAGING_STORE = createXrkDocStore<ImMessagingDoc>(
  ["im-messaging", "messages.json"],
  { messages: [] },
);

function readMessages(xrkHome: string | undefined): ImMessageRow[] {
  return MESSAGING_STORE.read(xrkHome).data.messages ?? [];
}

function writeMessages(
  xrkHome: string | undefined,
  messages: ImMessageRow[],
): void {
  MESSAGING_STORE.write(xrkHome, {
    messages: messages.slice(0, 512),
  });
}

function messageText(payload: Record<string, unknown>): string {
  const raw =
    payload.text ??
    payload.content ??
    payload.message ??
    payload.body ??
    payload.msg;
  if (typeof raw === "string") return raw;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const row = raw as Record<string, unknown>;
    if (typeof row.text === "string") return row.text;
    if (typeof row.content === "string") return row.content;
  }
  return "";
}

export function sendImMessage(
  xrkHome: string | undefined,
  channel: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const text = messageText(payload).trim();
  if (!text) {
    return { ok: false, code: "empty-message", channel };
  }
  const botId =
    typeof payload.botId === "string"
      ? payload.botId.trim()
      : typeof payload.id === "string"
        ? payload.id.trim()
        : undefined;
  const row: ImMessageRow = {
    id: randomUUID(),
    channel,
    ...(botId ? { botId } : {}),
    direction: "outbound",
    text,
    raw: payload,
    createdAt: new Date().toISOString(),
  };
  const messages = [row, ...readMessages(xrkHome)];
  writeMessages(xrkHome, messages);
  return {
    ok: true,
    sent: true,
    messageId: row.id,
    channel,
    botId,
    mode: "xrk-bridge",
    adapter: DSH_COMPAT_ADAPTER,
    note: "Message queued locally; vendor tunnel not required for bridge send ack.",
  };
}

export function listImMessages(
  xrkHome: string | undefined,
  channel: string,
  payload: Record<string, unknown> = {},
): Record<string, unknown> {
  const botId =
    typeof payload.botId === "string" ? payload.botId.trim() : undefined;
  const limit =
    typeof payload.limit === "number"
      ? Math.min(payload.limit, 100)
      : 32;
  let rows = readMessages(xrkHome).filter((m) => m.channel === channel);
  if (botId) rows = rows.filter((m) => m.botId === botId);
  return {
    ok: true,
    channel,
    messages: rows.slice(0, limit),
    count: rows.length,
    mode: "xrk-bridge",
    adapter: DSH_COMPAT_ADAPTER,
  };
}

export function ingestImWebhook(
  xrkHome: string | undefined,
  channel: string,
  body: Record<string, unknown>,
  botId?: string,
): ImMessageRow {
  const text = messageText(body).trim() || JSON.stringify(body).slice(0, 4000);
  const row: ImMessageRow = {
    id: randomUUID(),
    channel,
    ...(botId ? { botId } : {}),
    direction: "inbound",
    text,
    raw: body,
    createdAt: new Date().toISOString(),
  };
  writeMessages(xrkHome, [row, ...readMessages(xrkHome)]);
  return row;
}

export function handleImMessagingRpc(
  channel: string,
  endpoint: string,
  payload: Record<string, unknown>,
  xrkHome: string | undefined,
): Record<string, unknown> | null {
  if (
    endpoint === "message.send" ||
    endpoint === "messages.send" ||
    endpoint === "bot.send" ||
    endpoint === "send"
  ) {
    return sendImMessage(xrkHome, channel, payload);
  }
  if (
    endpoint === "message.list" ||
    endpoint === "messages.list" ||
    endpoint === "messages.recent" ||
    endpoint === "messages"
  ) {
    return listImMessages(xrkHome, channel, payload);
  }
  if (
    endpoint === "connection.keepalive" ||
    endpoint === "connection.ping" ||
    endpoint === "connection.stream"
  ) {
    return {
      ok: true,
      channel,
      mode: "xrk-bridge",
      transport: "http-poll",
      streamPath: `/api/im/${channel}/stream`,
      adapter: DSH_COMPAT_ADAPTER,
    };
  }
  if (endpoint === "webhook.status" || endpoint === "webhook.health") {
    const inbound = readMessages(xrkHome).filter(
      (m) => m.channel === channel && m.direction === "inbound",
    ).length;
    return {
      ok: true,
      channel,
      ingress: "xrk-bridge",
      inboundCount: inbound,
      adapter: DSH_COMPAT_ADAPTER,
    };
  }
  return null;
}

export async function handleImMessagingHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  xrkHome: string | undefined,
): Promise<boolean> {
  if (await handleImMessagingStream(req, res, pathname, xrkHome)) {
    return true;
  }
  const method = (req.method ?? "GET").toUpperCase();
  const webhookMatch = /^\/api\/im\/([^/]+)\/webhook$/.exec(pathname);
  if (webhookMatch && method === "POST") {
    const channel = decodeURIComponent(webhookMatch[1]!);
    const body = await parseJsonBody(req);
    const botId =
      typeof body.botId === "string" ? body.botId.trim() : undefined;
    const row = ingestImWebhook(xrkHome, channel, body, botId);
    sendJson(res, 200, {
      ok: true,
      received: true,
      messageId: row.id,
      channel,
      mode: "xrk-bridge",
      adapter: DSH_COMPAT_ADAPTER,
    });
    return true;
  }
  const listMatch = /^\/api\/im\/([^/]+)\/messages$/.exec(pathname);
  if (listMatch && (method === "GET" || method === "HEAD")) {
    const channel = decodeURIComponent(listMatch[1]!);
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const botId = url.searchParams.get("botId") ?? undefined;
    const limit = Number(url.searchParams.get("limit") ?? "32");
    const out = listImMessages(xrkHome, channel, {
      ...(botId ? { botId } : {}),
      limit: Number.isFinite(limit) ? limit : 32,
    });
    sendJson(res, 200, out);
    return true;
  }
  const sendMatch = /^\/api\/im\/([^/]+)\/send$/.exec(pathname);
  if (sendMatch && method === "POST") {
    const channel = decodeURIComponent(sendMatch[1]!);
    const body = await parseJsonBody(req);
    sendJson(res, 200, sendImMessage(xrkHome, channel, body));
    return true;
  }
  return false;
}

/** Long-poll / SSE message stream for IM bridge clients (no Cordis socket). */
export async function handleImMessagingStream(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  xrkHome: string | undefined,
): Promise<boolean> {
  const streamMatch = /^\/api\/im\/([^/]+)\/stream$/.exec(pathname);
  if (!streamMatch) return false;
  const method = (req.method ?? "GET").toUpperCase();
  if (method !== "GET") {
    sendJson(res, 405, { error: "method not allowed" });
    return true;
  }
  const channel = decodeURIComponent(streamMatch[1]!);
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  const since = url.searchParams.get("since") ?? "";
  const accept = String(req.headers.accept ?? "");
  const useSse = accept.includes("text/event-stream");
  const initial = listImMessages(xrkHome, channel, { limit: 32 });
  const messages = (initial.messages as ImMessageRow[]).filter(
    (m) => !since || m.createdAt > since,
  );
  if (useSse) {
    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      connection: "keep-alive",
    });
    res.write(
      `event: snapshot\ndata: ${JSON.stringify({ ok: true, channel, messages })}\n\n`,
    );
    res.write(`event: ping\ndata: ${JSON.stringify({ ts: Date.now() })}\n\n`);
    res.end();
    return true;
  }
  sendJson(res, 200, {
    ok: true,
    channel,
    messages,
    mode: "xrk-bridge-poll",
    adapter: DSH_COMPAT_ADAPTER,
  });
  return true;
}
