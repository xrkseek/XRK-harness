/**
 * IM message send/receive + webhook ingress (local bridge — not vendor long-connection).
 * Media is normalized as {@link ImAttachment} on the row; vendor SDKs stay out of Host.
 */
import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { handleImGatewaySidecarHttp } from "./im-gateway-sidecar.js";
import { sendJson } from "./underlying/http-json.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { parseJsonBody } from "./underlying/http-kit.js";

/** Bridge-normalized media kinds (video/audio ride here; Face maps to image/file). */
export type ImAttachmentKind = "image" | "video" | "file" | "audio";

export interface ImAttachment {
  readonly kind: ImAttachmentKind;
  readonly name?: string;
  readonly mediaType?: string;
  /** Remote URL the sidecar / vendor can fetch. */
  readonly url?: string;
  /** Absolute local path (Desktop / Host-side). */
  readonly path?: string;
  /** Face AttachmentStore id when bytes already live in-process. */
  readonly attachmentId?: string;
  readonly bytes?: number;
  readonly caption?: string;
}

export interface ImMessageRow {
  readonly id: string;
  readonly channel: string;
  readonly botId?: string;
  readonly direction: "inbound" | "outbound";
  readonly text: string;
  readonly attachments?: readonly ImAttachment[];
  readonly raw?: Record<string, unknown>;
  readonly createdAt: string;
}

const IM_ATTACHMENT_KINDS = new Set<ImAttachmentKind>([
  "image",
  "video",
  "file",
  "audio",
]);

function asNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = value.trim();
  return t || undefined;
}

function coerceAttachmentKind(value: unknown): ImAttachmentKind | undefined {
  if (typeof value !== "string") return undefined;
  const k = value.trim().toLowerCase();
  if (IM_ATTACHMENT_KINDS.has(k as ImAttachmentKind)) {
    return k as ImAttachmentKind;
  }
  if (k === "photo" || k === "img" || k === "picture") return "image";
  if (k === "voice" || k === "sound") return "audio";
  if (k === "document" || k === "doc" || k === "attachment") return "file";
  return undefined;
}

function coerceOneAttachment(raw: unknown): ImAttachment | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const row = raw as Record<string, unknown>;
  const kind =
    coerceAttachmentKind(row.kind) ??
    coerceAttachmentKind(row.type) ??
    coerceAttachmentKind(row.mediaType) ??
    (asNonEmptyString(row.url) || asNonEmptyString(row.path)
      ? "file"
      : undefined);
  if (!kind) return undefined;
  const name = asNonEmptyString(row.name) ?? asNonEmptyString(row.filename);
  const mediaType =
    asNonEmptyString(row.mediaType) ?? asNonEmptyString(row.mimeType);
  const url =
    asNonEmptyString(row.url) ??
    asNonEmptyString(row.href) ??
    asNonEmptyString(row.src);
  const path =
    asNonEmptyString(row.path) ??
    asNonEmptyString(row.filePath) ??
    asNonEmptyString(row.localPath);
  const attachmentId = asNonEmptyString(row.attachmentId);
  const caption = asNonEmptyString(row.caption);
  const bytes =
    typeof row.bytes === "number" && Number.isFinite(row.bytes)
      ? Math.max(0, Math.floor(row.bytes))
      : typeof row.size === "number" && Number.isFinite(row.size)
        ? Math.max(0, Math.floor(row.size))
        : undefined;
  if (!url && !path && !attachmentId && !name) return undefined;
  return {
    kind,
    ...(name ? { name } : {}),
    ...(mediaType ? { mediaType } : {}),
    ...(url ? { url } : {}),
    ...(path ? { path } : {}),
    ...(attachmentId ? { attachmentId } : {}),
    ...(bytes !== undefined ? { bytes } : {}),
    ...(caption ? { caption } : {}),
  };
}

/**
 * Normalize `attachments` (or common single-media vendor keys) from a send /
 * relay / webhook payload.
 */
export function normalizeImAttachments(
  payload: Record<string, unknown>,
): ImAttachment[] {
  const out: ImAttachment[] = [];
  const seen = new Set<string>();
  const push = (att: ImAttachment | undefined): void => {
    if (!att) return;
    const key = [
      att.kind,
      att.attachmentId ?? "",
      att.url ?? "",
      att.path ?? "",
      att.name ?? "",
    ].join("|");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(att);
  };

  const list = payload.attachments;
  if (Array.isArray(list)) {
    for (const item of list) push(coerceOneAttachment(item));
  } else if (list && typeof list === "object") {
    push(coerceOneAttachment(list));
  }

  const singles: Array<{ kind: ImAttachmentKind; keys: string[] }> = [
    { kind: "image", keys: ["imageUrl", "image_url", "image", "photo"] },
    { kind: "video", keys: ["videoUrl", "video_url", "video"] },
    { kind: "audio", keys: ["audioUrl", "audio_url", "audio", "voice"] },
    { kind: "file", keys: ["fileUrl", "file_url", "file", "document"] },
  ];
  for (const { kind, keys } of singles) {
    for (const key of keys) {
      const v = payload[key];
      if (typeof v === "string" && v.trim()) {
        push({ kind, url: v.trim() });
      } else if (v && typeof v === "object" && !Array.isArray(v)) {
        push(
          coerceOneAttachment({
            kind,
            ...(v as Record<string, unknown>),
          }),
        );
      }
    }
  }
  return out;
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
  const attachments = normalizeImAttachments(payload);
  if (!text && attachments.length === 0) {
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
    ...(attachments.length ? { attachments } : {}),
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
    ...(attachments.length ? { attachmentCount: attachments.length } : {}),
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

/** Optional Face admit after inbound persist (Host wires; no Face → messages only). */
export type ImFaceAdmitHook = (row: ImMessageRow) => void | Promise<void>;

let imFaceAdmitHook: ImFaceAdmitHook | undefined;

export function setImFaceAdmitHook(hook: ImFaceAdmitHook | undefined): void {
  imFaceAdmitHook = hook;
}

function scheduleImFaceAdmit(row: ImMessageRow): void {
  if (!imFaceAdmitHook) return;
  void Promise.resolve(imFaceAdmitHook(row)).catch((err: unknown) => {
    console.warn(
      "[im-messaging] Face admit failed:",
      err instanceof Error ? err.message : err,
    );
  });
}

export function ingestImWebhook(
  xrkHome: string | undefined,
  channel: string,
  body: Record<string, unknown>,
  botId?: string,
): ImMessageRow {
  const attachments = normalizeImAttachments(body);
  const text =
    messageText(body).trim() ||
    (attachments.length
      ? attachments
          .map((a) => a.caption || a.name || `${a.kind}`)
          .filter(Boolean)
          .join(" · ") || `[${attachments.length} attachment(s)]`
      : JSON.stringify(body).slice(0, 4000));
  const row: ImMessageRow = {
    id: randomUUID(),
    channel,
    ...(botId ? { botId } : {}),
    direction: "inbound",
    text,
    ...(attachments.length ? { attachments } : {}),
    raw: body,
    createdAt: new Date().toISOString(),
  };
  writeMessages(xrkHome, [row, ...readMessages(xrkHome)]);
  scheduleImFaceAdmit(row);
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
  if (await handleImGatewaySidecarHttp(req, res, pathname, xrkHome)) {
    return true;
  }
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
