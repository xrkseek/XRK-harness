/**
 * Thin A2A inbound HTTP surface (Hermes `plugins/platforms/a2a` Agent Card +
 * message/send subset). Opt-in via Host `XRK_A2A_INBOUND=1` — no Face session
 * injection yet; persists peer turns and returns a completed task echo.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  A2A_PROTOCOL_VERSION,
  ROLE_AGENT,
  ROLE_USER,
  STATE_COMPLETED,
  STATE_REJECTED,
  TurnTracker,
  extractText,
  maxPingpongTurns,
  newContextId,
  newTaskId,
  persistMessage,
  textMessage,
} from "./protocol.js";

export interface A2aInboundOptions {
  /** Public base URL advertised on the Agent Card (e.g. http://127.0.0.1:8787/a2a). */
  readonly url: string;
  readonly name?: string;
  readonly description?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Conversations root override (tests). */
  readonly conversationsRoot?: string;
  readonly turnTracker?: TurnTracker;
  /**
   * Optional Face admit hook. When absent, message/send persists + echoes.
   * Return agent reply text; throw to fail the task.
   */
  readonly onMessage?: (input: {
    readonly text: string;
    readonly contextId: string;
    readonly taskId: string;
    readonly peer: string;
  }) => Promise<string> | string;
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  const raw = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(raw);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function safeEqualToken(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  try {
    return timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
}

/** Parse `A2A_PEER_TOKENS=alice:tok1,bob:tok2` → name → token. */
export function parsePeerTokens(
  raw: string | undefined,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  if (!raw?.trim()) return out;
  for (const part of raw.split(",")) {
    const idx = part.indexOf(":");
    if (idx <= 0) continue;
    const name = part.slice(0, idx).trim();
    const token = part.slice(idx + 1).trim();
    if (name && token) out.set(name, token);
  }
  return out;
}

export function buildA2aAgentCard(options: {
  readonly name: string;
  readonly url: string;
  readonly description: string;
  readonly authRequired?: boolean;
}): Record<string, unknown> {
  const iface = {
    url: options.url,
    protocolBinding: "JSONRPC",
    protocolVersion: A2A_PROTOCOL_VERSION,
  };
  const card: Record<string, unknown> = {
    name: options.name,
    description: options.description,
    url: options.url,
    version: "1.0.0",
    provider: { organization: "XRK Harness", url: options.url },
    supportedInterfaces: [iface],
    capabilities: {
      streaming: false,
      pushNotifications: false,
      stateTransitionHistory: false,
      extendedAgentCard: false,
    },
    defaultInputModes: ["text/plain"],
    defaultOutputModes: ["text/plain"],
    skills: [
      {
        id: "chat",
        name: "chat",
        description: "Send a text task to this XRK Host (message/send).",
        tags: ["chat"],
      },
    ],
  };
  if (options.authRequired) {
    card.securitySchemes = { bearer: { type: "http", scheme: "bearer" } };
    card.security = [{ bearer: [] }];
  }
  return card;
}

function authorize(
  req: IncomingMessage,
  env: NodeJS.ProcessEnv,
): { ok: true; peer: string } | { ok: false; status: number; error: unknown } {
  const bearer = env.XRK_A2A_BEARER_TOKEN?.trim() || env.A2A_BEARER_TOKEN?.trim();
  const peers = parsePeerTokens(
    env.XRK_A2A_PEER_TOKENS?.trim() || env.A2A_PEER_TOKENS,
  );
  const authRequired = Boolean(bearer) || peers.size > 0;
  if (!authRequired) {
    return { ok: true, peer: `ip:${req.socket.remoteAddress ?? "local"}` };
  }
  const header = String(req.headers.authorization ?? "");
  const m = /^Bearer\s+(\S+)/i.exec(header);
  const token = m?.[1] ?? "";
  if (!token) {
    return {
      ok: false,
      status: 401,
      error: {
        jsonrpc: "2.0",
        error: { code: -32050, message: "unauthorized" },
        id: null,
      },
    };
  }
  for (const [name, peerTok] of peers) {
    if (safeEqualToken(token, peerTok)) {
      return { ok: true, peer: name };
    }
  }
  if (bearer && safeEqualToken(token, bearer)) {
    return { ok: true, peer: `ip:${req.socket.remoteAddress ?? "local"}` };
  }
  return {
    ok: false,
    status: 401,
    error: {
      jsonrpc: "2.0",
      error: { code: -32050, message: "unauthorized" },
      id: null,
    },
  };
}

async function handleMessageSend(
  params: Record<string, unknown>,
  peer: string,
  options: A2aInboundOptions,
  tracker: TurnTracker,
): Promise<Record<string, unknown>> {
  const message = (params.message ?? params) as Record<string, unknown>;
  const text = extractText(message).trim();
  const contextId =
    String(message.contextId ?? params.contextId ?? "").trim() ||
    newContextId();
  const taskId =
    String(params.taskId ?? message.taskId ?? "").trim() || newTaskId();
  const env = options.env ?? process.env;
  const turns = tracker.track(contextId);
  const cap = maxPingpongTurns(env);
  if (turns > cap) {
    return {
      task: {
        id: taskId,
        contextId,
        status: {
          state: STATE_REJECTED,
          message: textMessage(
            ROLE_AGENT,
            `rejected: pingpong turn cap ${cap} reached for context`,
            contextId,
          ),
        },
      },
    };
  }
  const persistOpts = options.conversationsRoot
    ? { root: options.conversationsRoot }
    : undefined;
  if (text) {
    persistMessage(contextId, ROLE_USER, text, taskId, persistOpts);
  }
  let reply: string;
  if (options.onMessage) {
    reply = String(
      await options.onMessage({ text, contextId, taskId, peer }),
    ).trim();
  } else {
    reply =
      text.length > 0
        ? `A2A inbound accepted from ${peer}: ${text.slice(0, 400)}`
        : `A2A inbound accepted from ${peer} (empty message)`;
  }
  persistMessage(contextId, ROLE_AGENT, reply, taskId, persistOpts);
  return {
    task: {
      id: taskId,
      contextId,
      status: {
        state: STATE_COMPLETED,
        message: textMessage(ROLE_AGENT, reply, contextId),
      },
    },
  };
}

/**
 * Claim A2A inbound paths. Returns true when the request was handled.
 * Paths: `GET /.well-known/agent-card.json` · `GET /.well-known/agent.json` ·
 * `POST /a2a` (JSON-RPC) · optional `GET /a2a/health`.
 */
export function createA2aInboundHandler(
  options: A2aInboundOptions,
): (
  req: IncomingMessage,
  res: ServerResponse,
) => boolean | Promise<boolean> {
  const env = options.env ?? process.env;
  const tracker = options.turnTracker ?? new TurnTracker();
  const name = options.name?.trim() || "XRK Harness";
  const description =
    options.description?.trim() ||
    "XRK Host A2A inbound (Agent Card + message/send). Face session injection optional.";
  const authRequired = Boolean(
    env.XRK_A2A_BEARER_TOKEN?.trim() ||
      env.A2A_BEARER_TOKEN?.trim() ||
      env.XRK_A2A_PEER_TOKENS?.trim() ||
      env.A2A_PEER_TOKENS?.trim(),
  );
  const card = buildA2aAgentCard({
    name,
    url: options.url,
    description,
    authRequired,
  });

  return async (req, res) => {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    const path = url.pathname;
    const method = (req.method ?? "GET").toUpperCase();

    if (
      method === "GET" &&
      (path === "/.well-known/agent-card.json" ||
        path === "/.well-known/agent.json")
    ) {
      sendJson(res, 200, card);
      return true;
    }

    if (method === "GET" && path === "/a2a/health") {
      sendJson(res, 200, {
        ok: true,
        protocol: A2A_PROTOCOL_VERSION,
        authRequired,
      });
      return true;
    }

    if (method === "POST" && (path === "/a2a" || path === "/a2a/")) {
      const auth = authorize(req, env);
      if (!auth.ok) {
        sendJson(res, auth.status, auth.error);
        return true;
      }
      let body: Record<string, unknown>;
      try {
        body = JSON.parse((await readBody(req)) || "{}") as Record<
          string,
          unknown
        >;
      } catch {
        sendJson(res, 400, {
          jsonrpc: "2.0",
          error: { code: -32700, message: "parse error" },
          id: null,
        });
        return true;
      }
      const id = body.id ?? null;
      const rpcMethod = String(body.method ?? "");
      if (rpcMethod !== "message/send") {
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32601,
            message: `method not found: ${rpcMethod || "(missing)"}`,
          },
        });
        return true;
      }
      const params =
        body.params && typeof body.params === "object"
          ? (body.params as Record<string, unknown>)
          : {};
      try {
        const result = await handleMessageSend(
          params,
          auth.peer,
          options,
          tracker,
        );
        sendJson(res, 200, { jsonrpc: "2.0", id, result });
      } catch (err) {
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id,
          error: {
            code: -32000,
            message: err instanceof Error ? err.message : String(err),
          },
        });
      }
      return true;
    }

    return false;
  };
}
