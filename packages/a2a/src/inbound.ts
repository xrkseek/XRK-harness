/**
 * Thin A2A inbound HTTP surface (Hermes `plugins/platforms/a2a` Agent Card +
 * message/send + tasks get/list/cancel subset). Opt-in via Host
 * `XRK_A2A_INBOUND=1`. With Face wired, admits framed peer text into a
 * session; otherwise persists + echoes.
 *
 * Method aliases match Hermes `_METHOD_TABLE`: PascalCase (v1.0 SDK) and
 * slash forms both resolve so XRK↔XRK and Hermes→XRK interop.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import {
  A2A_PROTOCOL_VERSION,
  ERR_TASK_NOT_CANCELABLE,
  ERR_TASK_NOT_FOUND,
  ROLE_AGENT,
  ROLE_USER,
  STATE_CANCELED,
  STATE_COMPLETED,
  STATE_REJECTED,
  STATE_WORKING,
  TERMINAL_STATES,
  TurnTracker,
  extractText,
  maxPingpongTurns,
  newContextId,
  newTaskId,
  persistMessage,
} from "./protocol.js";
import { TaskStore } from "./task-store.js";

export interface A2aInboundOptions {
  /** Public base URL advertised on the Agent Card (e.g. http://127.0.0.1:8787/a2a). */
  readonly url: string;
  readonly name?: string;
  readonly description?: string;
  readonly env?: NodeJS.ProcessEnv;
  /** Conversations root override (tests). */
  readonly conversationsRoot?: string;
  readonly turnTracker?: TurnTracker;
  /** In-memory task registry (tests / shared Host instance). */
  readonly taskStore?: TaskStore;
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

/** Hermes-shaped method aliases → canonical handler key. */
const METHOD_ALIASES: ReadonlyMap<string, string> = new Map([
  ["SendMessage", "message/send"],
  ["message/send", "message/send"],
  ["GetTask", "tasks/get"],
  ["tasks/get", "tasks/get"],
  ["ListTasks", "tasks/list"],
  ["tasks/list", "tasks/list"],
  ["CancelTask", "tasks/cancel"],
  ["tasks/cancel", "tasks/cancel"],
]);

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

function rpcOk(id: unknown, result: unknown): Record<string, unknown> {
  return { jsonrpc: "2.0", id, result };
}

function rpcErr(
  id: unknown,
  code: number,
  message: string,
): Record<string, unknown> {
  return { jsonrpc: "2.0", id, error: { code, message } };
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
        description:
          "Send a text task to this XRK Host (message/send · SendMessage).",
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
  store: TaskStore,
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
  store.create(taskId, contextId, peer);
  if (turns > cap) {
    const reason = `rejected: pingpong turn cap ${cap} reached for context`;
    store.complete(taskId, STATE_REJECTED, reason);
    return {
      task: TaskStore.toTask(store.get(taskId)!),
    };
  }
  store.setState(taskId, STATE_WORKING);
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
  store.complete(taskId, STATE_COMPLETED, reply);
  return { task: TaskStore.toTask(store.get(taskId)!) };
}

function handleTasksGet(
  id: unknown,
  params: Record<string, unknown>,
  store: TaskStore,
): Record<string, unknown> {
  const taskId = String(params.taskId ?? params.id ?? "").trim();
  const rec = store.get(taskId);
  if (!rec) {
    return rpcErr(id, ERR_TASK_NOT_FOUND, `task not found: ${taskId}`);
  }
  return rpcOk(id, TaskStore.toTask(rec));
}

function handleTasksList(
  id: unknown,
  params: Record<string, unknown>,
  store: TaskStore,
): Record<string, unknown> {
  const offset = Math.max(0, Number(params.pageToken ?? 0) || 0);
  const pageSize = Number(params.pageSize ?? 50) || 50;
  const includeArtifacts = Boolean(params.includeArtifacts);
  const { records, nextOffset, total } = store.list({
    contextId: String(params.contextId ?? ""),
    state: String(params.status ?? params.state ?? ""),
    pageSize,
    offset,
  });
  return rpcOk(id, {
    tasks: records.map((r) => TaskStore.toTask(r, includeArtifacts)),
    nextPageToken: nextOffset ? String(nextOffset) : "",
    pageSize: Math.max(1, Math.min(pageSize, 100)),
    totalSize: total,
  });
}

function handleTasksCancel(
  id: unknown,
  params: Record<string, unknown>,
  store: TaskStore,
  tracker: TurnTracker,
): Record<string, unknown> {
  const taskId = String(params.taskId ?? params.id ?? "").trim();
  const rec = store.get(taskId);
  if (!rec) {
    return rpcErr(id, ERR_TASK_NOT_FOUND, `task not found: ${taskId}`);
  }
  if (TERMINAL_STATES.has(rec.state)) {
    return rpcErr(
      id,
      ERR_TASK_NOT_CANCELABLE,
      `task ${taskId} already ${rec.state}`,
    );
  }
  store.complete(taskId, STATE_CANCELED, "");
  tracker.reset(rec.contextId);
  return rpcOk(id, TaskStore.toTask(store.get(taskId)!));
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
  const store = options.taskStore ?? new TaskStore();
  const name = options.name?.trim() || "XRK Harness";
  const description =
    options.description?.trim() ||
    "XRK Host A2A inbound (Agent Card + message/send · SendMessage + tasks get/list/cancel). Face session injection optional.";
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
        methods: [...new Set(METHOD_ALIASES.values())],
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
      const canonical = METHOD_ALIASES.get(rpcMethod);
      if (!canonical) {
        sendJson(
          res,
          200,
          rpcErr(id, -32601, `method not found: ${rpcMethod || "(missing)"}`),
        );
        return true;
      }
      const params =
        body.params && typeof body.params === "object"
          ? (body.params as Record<string, unknown>)
          : {};
      try {
        if (canonical === "message/send") {
          const result = await handleMessageSend(
            params,
            auth.peer,
            options,
            tracker,
            store,
          );
          sendJson(res, 200, rpcOk(id, result));
        } else if (canonical === "tasks/get") {
          sendJson(res, 200, handleTasksGet(id, params, store));
        } else if (canonical === "tasks/list") {
          sendJson(res, 200, handleTasksList(id, params, store));
        } else {
          sendJson(res, 200, handleTasksCancel(id, params, store, tracker));
        }
      } catch (err) {
        sendJson(
          res,
          200,
          rpcErr(
            id,
            -32000,
            err instanceof Error ? err.message : String(err),
          ),
        );
      }
      return true;
    }

    return false;
  };
}
