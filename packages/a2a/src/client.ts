/**
 * Outbound A2A client: discover + SendMessage with persistence and anti-loop.
 */

import {
  extractText,
  listPersistedContexts,
  loadConversation,
  maxPingpongTurns,
  newContextId,
  newTaskId,
  persistMessage,
  ROLE_AGENT,
  ROLE_USER,
  STATE_INPUT_REQUIRED,
  STATE_REJECTED,
  textMessage,
  TurnTracker,
  unwrapSendMessageResponse,
  a2aConversationsDir,
} from "./protocol.js";
import {
  loadA2aPeers,
  resolveA2aPeer,
  type A2aPeer,
  type A2aPeerMap,
} from "./peers.js";

const DEFAULT_TIMEOUT_MS = 120_000;

export interface A2aClientOptions {
  readonly env?: NodeJS.ProcessEnv;
  readonly peers?: A2aPeerMap;
  readonly conversationsRoot?: string;
  readonly turnTracker?: TurnTracker;
  /** Inject HTTP for tests. */
  readonly fetch?: typeof fetch;
}

export interface A2aCallResult {
  readonly ok: boolean;
  readonly content: string;
  readonly contextId: string;
  readonly state: string;
}

function authHeaders(peer: A2aPeer): Record<string, string> {
  const token = peer.auth?.token?.trim();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function fetchJson(
  url: string,
  init: RequestInit,
  fetchImpl: typeof fetch,
): Promise<unknown> {
  const res = await fetchImpl(url, init);
  const text = await res.text();
  let body: unknown = {};
  if (text.trim()) {
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      body = { raw: text };
    }
  }
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status}`) as Error & {
      status: number;
      body: unknown;
    };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return body;
}

function cardUrl(base: string): string {
  return `${base.replace(/\/+$/, "")}/.well-known/agent-card.json`;
}

function rpcUrl(base: string, card: Record<string, unknown> | null): string {
  const ifaces = card?.supportedInterfaces;
  if (Array.isArray(ifaces)) {
    for (const iface of ifaces) {
      if (
        iface !== null &&
        typeof iface === "object" &&
        typeof (iface as { url?: unknown }).url === "string" &&
        (iface as { url: string }).url
      ) {
        return (iface as { url: string }).url.replace(/\/+$/, "");
      }
    }
  }
  if (typeof card?.url === "string" && card.url) {
    return String(card.url).replace(/\/+$/, "");
  }
  return base.replace(/\/+$/, "");
}

export class A2aClient {
  private readonly env: NodeJS.ProcessEnv;
  private readonly peers: A2aPeerMap;
  private readonly root: string;
  private readonly turns: TurnTracker;
  private readonly fetchImpl: typeof fetch;

  constructor(options: A2aClientOptions = {}) {
    this.env = options.env ?? process.env;
    this.peers = options.peers ?? loadA2aPeers(this.env);
    this.root = options.conversationsRoot ?? a2aConversationsDir(this.env);
    this.turns = options.turnTracker ?? new TurnTracker();
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  listPeers(): A2aPeerMap {
    return this.peers;
  }

  listConversations(): string[] {
    return listPersistedContexts({ root: this.root });
  }

  history(contextId: string, limit = 50) {
    return loadConversation(contextId, limit, { root: this.root });
  }

  async discover(url: string): Promise<string> {
    const base = url.trim();
    if (!base) return "Error: 'url' is required (e.g. http://localhost:9900).";
    try {
      const card = (await fetchJson(
        cardUrl(base),
        { headers: { Accept: "application/json" } },
        this.fetchImpl,
      )) as Record<string, unknown>;
      const caps =
        (card.capabilities as Record<string, unknown> | undefined) ?? {};
      const skills = Array.isArray(card.skills) ? card.skills : [];
      const auth = card.security ? "yes" : "no";
      const lines = [
        `Agent: ${String(card.name ?? "?")}`,
        `Description: ${String(card.description ?? "")}`,
        `URL: ${rpcUrl(base, card)}`,
        `Streaming: ${Boolean(caps.streaming)}  Push: ${Boolean(caps.pushNotifications)}  Auth required: ${auth}`,
        `Skills (${skills.length}):`,
      ];
      for (const s of skills.slice(0, 20)) {
        if (s !== null && typeof s === "object") {
          const sk = s as Record<string, unknown>;
          lines.push(
            `  - ${String(sk.name ?? sk.id ?? "?")}: ${String(sk.description ?? "")}`,
          );
        }
      }
      return lines.join("\n");
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status !== undefined) {
        return `Error: discovery failed — HTTP ${status} from ${base}.`;
      }
      return `Error: could not reach ${base} — ${err instanceof Error ? err.message : String(err)}.`;
    }
  }

  async call(
    agent: string,
    message: string,
    contextId = "",
  ): Promise<A2aCallResult> {
    const resolved = resolveA2aPeer(agent, this.peers);
    if (!resolved) {
      return {
        ok: false,
        content: `Error: unknown agent '${agent}'. Configure XRK_A2A_AGENTS / a2a_agents.json or pass a full http(s):// URL.`,
        contextId: contextId || "",
        state: "",
      };
    }
    const ctx = contextId.trim() || newContextId();
    const maxTurns = maxPingpongTurns(this.env);
    const turn = this.turns.track(ctx);
    if (turn > maxTurns) {
      return {
        ok: false,
        content: `Error: anti-loop protection: context ${ctx} exceeded ${maxTurns} turns. Start a new context_id or raise XRK_A2A_MAX_PINGPONG_TURNS.`,
        contextId: ctx,
        state: STATE_REJECTED,
      };
    }

    const { label, peer } = resolved;
    const taskId = newTaskId();
    const timeoutMs = Math.max(
      1_000,
      (peer.timeout ?? DEFAULT_TIMEOUT_MS / 1000) * 1000,
    );
    persistMessage(ctx, "user", message, taskId, { root: this.root });

    let card: Record<string, unknown> | null = null;
    try {
      card = (await fetchJson(
        cardUrl(peer.url),
        {
          headers: { Accept: "application/json", ...authHeaders(peer) },
          signal: AbortSignal.timeout(Math.min(timeoutMs, 30_000)),
        },
        this.fetchImpl,
      )) as Record<string, unknown>;
    } catch {
      card = null;
    }

    const rpcBody: Record<string, unknown> = {
      jsonrpc: "2.0",
      id: taskId,
      method: "SendMessage",
      params: {
        message: textMessage(ROLE_USER, message, ctx),
      },
    };
    if (peer.tenant) {
      (rpcBody.params as Record<string, unknown>).tenant = peer.tenant;
    }

    try {
      const resp = (await fetchJson(
        rpcUrl(peer.url, card),
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            ...authHeaders(peer),
          },
          body: JSON.stringify(rpcBody),
          signal: AbortSignal.timeout(timeoutMs),
        },
        this.fetchImpl,
      )) as Record<string, unknown>;

      if (resp.error && typeof resp.error === "object") {
        const msg = String(
          (resp.error as { message?: unknown }).message ?? resp.error,
        );
        return {
          ok: false,
          content: `Error: peer '${label}' returned an error: ${msg}`,
          contextId: ctx,
          state: "",
        };
      }

      const payload = unwrapSendMessageResponse(resp.result);
      let reply = extractText(payload);
      let replyCtx = ctx;
      let state = "";
      if (payload !== null && typeof payload === "object") {
        const rec = payload as Record<string, unknown>;
        if (typeof rec.contextId === "string" && rec.contextId) {
          replyCtx = rec.contextId;
        }
        const status = rec.status;
        if (status !== null && typeof status === "object") {
          state = String((status as { state?: unknown }).state ?? "");
        }
      }
      if (!reply) reply = "(empty peer reply)";
      persistMessage(replyCtx, "agent", reply, taskId, { root: this.root });

      let body = `Peer '${label}' replied (context_id=${replyCtx}):\n${reply}`;
      if (state === STATE_INPUT_REQUIRED) {
        body += `\n\n(The peer needs more input — call a2a_call again with context_id '${replyCtx}'.)`;
      }
      return { ok: true, content: body, contextId: replyCtx, state };
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 401 || status === 403) {
        return {
          ok: false,
          content: `Error: peer '${label}' rejected auth (HTTP ${status}). Check the configured token.`,
          contextId: ctx,
          state: "",
        };
      }
      if (status === 429) {
        return {
          ok: false,
          content: `Error: peer '${label}' rate limited us (HTTP 429). Retry later.`,
          contextId: ctx,
          state: "",
        };
      }
      return {
        ok: false,
        content: `Error: call to '${label}' failed — ${err instanceof Error ? err.message : String(err)}.`,
        contextId: ctx,
        state: "",
      };
    }
  }

  resetLoop(contextId: string): void {
    this.turns.reset(contextId);
  }
}

export function createA2aClient(options?: A2aClientOptions): A2aClient {
  return new A2aClient(options);
}
