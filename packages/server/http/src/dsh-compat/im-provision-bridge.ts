/**
 * IM OAuth / provisioning bridge — local session store + manual authCode completion.
 * Does not open official vendor long connections; completes connector binding on XRK.
 */
import { randomUUID } from "node:crypto";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export interface ImProvisionSession {
  readonly id: string;
  readonly channel: string;
  readonly botId?: string;
  readonly status: "pending" | "completed" | "cancelled" | "expired";
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly authUrl?: string;
  readonly redirectUri?: string;
  readonly tokens?: Record<string, unknown>;
  readonly note?: string;
}

interface ImProvisionDoc {
  sessions: ImProvisionSession[];
}

const PROVISION_STORE = createXrkDocStore<ImProvisionDoc>(
  ["im-provision", "sessions.json"],
  { sessions: [] },
);

function nowIso(): string {
  return new Date().toISOString();
}

function readDoc(xrkHome: string | undefined): ImProvisionDoc {
  return PROVISION_STORE.read(xrkHome).data;
}

function writeDoc(xrkHome: string | undefined, doc: ImProvisionDoc): void {
  PROVISION_STORE.write(xrkHome, doc);
}

function findSession(
  doc: ImProvisionDoc,
  id: string,
): ImProvisionSession | undefined {
  return doc.sessions.find((row) => row.id === id);
}

function upsertSession(
  xrkHome: string | undefined,
  session: ImProvisionSession,
): ImProvisionSession {
  const doc = readDoc(xrkHome);
  const idx = doc.sessions.findIndex((row) => row.id === session.id);
  const next = [...doc.sessions];
  if (idx >= 0) next[idx] = session;
  else next.unshift(session);
  writeDoc(xrkHome, { sessions: next.slice(0, 64) });
  return session;
}

function buildAuthUrl(
  channel: string,
  appId: string,
  redirectUri: string,
  state: string,
): string | undefined {
  const app = encodeURIComponent(appId);
  const redirect = encodeURIComponent(redirectUri);
  const st = encodeURIComponent(state);
  if (channel === "weixin" || channel === "wecom") {
    return `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${app}&redirect_uri=${redirect}&response_type=code&scope=snsapi_base&state=${st}#wechat_redirect`;
  }
  if (channel === "dingtalk") {
    return `https://login.dingtalk.com/oauth2/auth?client_id=${app}&response_type=code&scope=openid&state=${st}&redirect_uri=${redirect}`;
  }
  if (channel === "feishu") {
    return `https://open.feishu.cn/open-apis/authen/v1/authorize?app_id=${app}&redirect_uri=${redirect}&state=${st}`;
  }
  return undefined;
}

export function beginImProvision(
  xrkHome: string | undefined,
  channel: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const botId =
    typeof payload.botId === "string"
      ? payload.botId.trim()
      : typeof payload.id === "string"
        ? payload.id.trim()
        : undefined;
  const connector =
    payload.connector && typeof payload.connector === "object"
      ? (payload.connector as Record<string, unknown>)
      : {};
  const appId = String(connector.appId ?? connector.clientId ?? "").trim();
  const redirectUri = String(
    payload.redirectUri ??
      connector.redirectUri ??
      "http://127.0.0.1:8787/xrk/im/oauth/callback",
  ).trim();
  const id = randomUUID();
  const createdAt = nowIso();
  const authUrl = appId
    ? buildAuthUrl(channel, appId, redirectUri, id)
    : undefined;
  const session: ImProvisionSession = {
    id,
    channel,
    ...(botId ? { botId } : {}),
    status: "pending",
    createdAt,
    updatedAt: createdAt,
    ...(authUrl ? { authUrl, redirectUri } : {}),
    note: appId
      ? "Complete OAuth in browser, then poll with authCode or tokens."
      : "Poll with authCode or connector tokens to complete binding.",
  };
  upsertSession(xrkHome, session);
  return {
    ok: true,
    provisionId: id,
    status: "pending",
    channel,
    ...(botId ? { botId } : {}),
    ...(authUrl ? { authUrl } : {}),
    redirectUri,
    pollAfterMs: 1500,
    mode: "xrk-bridge",
    adapter: DSH_COMPAT_ADAPTER,
  };
}

export function pollImProvision(
  xrkHome: string | undefined,
  channel: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const provisionId = String(
    payload.provisionId ?? payload.id ?? payload.state ?? "",
  ).trim();
  if (!provisionId) {
    return { ok: false, code: "provision-missing", channel };
  }
  const doc = readDoc(xrkHome);
  const session = findSession(doc, provisionId);
  if (!session || session.channel !== channel) {
    return { ok: false, code: "provision-not-found", provisionId, channel };
  }
  if (session.status === "cancelled") {
    return { ok: false, status: "cancelled", provisionId, channel };
  }
  if (session.status === "completed") {
    return {
      ok: true,
      status: "completed",
      provisionId,
      channel,
      tokens: session.tokens ?? {},
      botId: session.botId,
      mode: "xrk-bridge",
      adapter: DSH_COMPAT_ADAPTER,
    };
  }

  const authCode = String(
    payload.authCode ?? payload.code ?? payload.authorizationCode ?? "",
  ).trim();
  const tokenBag =
    payload.tokens && typeof payload.tokens === "object"
      ? (payload.tokens as Record<string, unknown>)
      : undefined;
  const connectorTokens =
    payload.connector && typeof payload.connector === "object"
      ? (payload.connector as Record<string, unknown>)
      : undefined;

  if (authCode || tokenBag || connectorTokens) {
    const tokens = {
      ...(tokenBag ?? {}),
      ...(connectorTokens ?? {}),
      ...(authCode ? { authCode, obtainedAt: nowIso() } : {}),
    };
    const completed: ImProvisionSession = {
      ...session,
      status: "completed",
      updatedAt: nowIso(),
      tokens,
    };
    upsertSession(xrkHome, completed);
    return {
      ok: true,
      status: "completed",
      provisionId,
      channel,
      tokens,
      botId: completed.botId,
      mode: "xrk-bridge",
      adapter: DSH_COMPAT_ADAPTER,
      note: "Credentials stored locally; live IM tunnel still requires vendor host.",
    };
  }

  return {
    ok: true,
    status: "pending",
    provisionId,
    channel,
    ...(session.authUrl ? { authUrl: session.authUrl } : {}),
    pollAfterMs: 1500,
    mode: "xrk-bridge",
    adapter: DSH_COMPAT_ADAPTER,
  };
}

export function cancelImProvision(
  xrkHome: string | undefined,
  channel: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const provisionId = String(
    payload.provisionId ?? payload.id ?? payload.state ?? "",
  ).trim();
  if (!provisionId) {
    return { ok: false, code: "provision-missing", channel };
  }
  const doc = readDoc(xrkHome);
  const session = findSession(doc, provisionId);
  if (!session || session.channel !== channel) {
    return { ok: false, code: "provision-not-found", provisionId, channel };
  }
  upsertSession(xrkHome, {
    ...session,
    status: "cancelled",
    updatedAt: nowIso(),
  });
  return { ok: true, status: "cancelled", provisionId, channel };
}

export function beginImCallbackRepair(
  channel: string,
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const botId =
    typeof payload.botId === "string" ? payload.botId.trim() : undefined;
  return {
    ok: true,
    status: "accepted",
    channel,
    ...(botId ? { botId } : {}),
    mode: "xrk-bridge",
    adapter: DSH_COMPAT_ADAPTER,
    note: "Callback repair queued locally; inbound messages use POST /api/im/:channel/webhook.",
  };
}
