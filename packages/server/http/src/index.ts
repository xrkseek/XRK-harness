import {
  createServer as createNodeServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { SessionEvent, PromptDelivery } from "@xrkseek/protocol";
import { parsePromptDelivery } from "@xrkseek/protocol";
import type { AgentHandle } from "@xrkseek/core-agent";
import {
  NoPendingAdmitError,
  SessionBusyError,
  SessionSafetyLimitError,
  type SessionStore,
} from "@xrkseek/core-session";
import { tryServeWebStatic, type WebStaticOptions } from "./static.js";

export interface HttpChatRequest {
  readonly sessionId?: string;
  readonly message: string;
}

export interface HttpAdmitRequest {
  readonly message: string;
  /**
   * Inbox delivery (`steer` | `queue`). Omitted ⇒ queue.
   * See docs/session-delivery.md.
   */
  readonly delivery?: PromptDelivery;
  /**
   * When true: admit then **await** drain (promote + run pending).
   * Uses SessionDrainHub join semantics when `drain` is configured.
   */
  readonly resume?: boolean;
  /**
   * When true (and resume≠true): admit then **wake** drain without waiting.
   * Returns 202 `{ scheduled: true }`. Coalesces if a drain is already active.
   */
  readonly wake?: boolean;
}

export interface HttpTurnRequest {
  /** Omit or empty to promote next pending admit (steer preferred, else FIFO queue). */
  readonly message?: string;
}

export interface HttpChatResponse {
  readonly sessionId: string;
  readonly turnId: string;
  readonly text: string;
  readonly steps: number;
  readonly admitId?: string;
}

/** Optional host drain (OpenCode wake/run without Effect). */
export interface HttpDrainControl {
  run(sessionId: string): Promise<
    | {
        readonly turnId: string;
        readonly text: string;
        readonly steps: number;
        readonly admitId?: string;
      }
    | undefined
  >;
  wake(sessionId: string): void;
}

export interface HttpServerOptions {
  readonly host: string;
  readonly port: number;
  readonly apiKey: string;
  readonly corsOrigin: string | "*";
  readonly rateLimitPerMinute: number;
  readonly store: SessionStore;
  /** Create or return an agent bound to a session. */
  resolveAgent(sessionId: string): Promise<AgentHandle>;
  ensureSession(id?: string): string;
  /** When set, admit resume/wake go through the drain hub. */
  readonly drain?: HttpDrainControl;
  /**
   * Optional Face / extra API hook. Return true if the request was claimed
   * (response owned by the hook). Called after auth for `/api/*`.
   */
  tryHandleExtraApi?: (
    req: IncomingMessage,
    res: ServerResponse,
  ) => boolean;
  /** Optional upgrade attach (e.g. Face WS). Called once after server create. */
  attachExtras?: (server: Server) => { close(): void };
  /**
   * Optional SPA dist root. Public GET/HEAD (no API key).
   * `transformIndex` typically injects `__XRK_BOOT__`.
   */
  readonly webStatic?: WebStaticOptions;
}

export interface HarnessHttpServer {
  readonly server: Server;
  listen(): Promise<{ host: string; port: number }>;
  close(): Promise<void>;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extraHeaders?: Record<string, string>,
): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
    ...extraHeaders,
  });
  res.end(data);
}

function corsHeaders(origin: string | "*"): Record<string, string> {
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-headers":
      "content-type, authorization, x-api-key",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };
}

export function createHttpServer(
  options: HttpServerOptions,
): HarnessHttpServer {
  const hits = new Map<string, { count: number; resetAt: number }>();
  const eventSubs = new Map<string, Set<ServerResponse>>();

  const publish = (sessionId: string, event: SessionEvent) => {
    const set = eventSubs.get(sessionId);
    if (!set) return;
    const line = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of set) {
      res.write(line);
    }
  };

  const checkAuth = (req: IncomingMessage): boolean => {
    if (!options.apiKey) return true;
    const auth = req.headers.authorization;
    const headerKey = req.headers["x-api-key"];
    const bearer =
      typeof auth === "string" && auth.startsWith("Bearer ")
        ? auth.slice("Bearer ".length)
        : undefined;
    const key =
      bearer ?? (typeof headerKey === "string" ? headerKey : undefined);
    return key === options.apiKey;
  };

  const checkRate = (req: IncomingMessage): boolean => {
    const ip = req.socket.remoteAddress ?? "unknown";
    const now = Date.now();
    let bucket = hits.get(ip);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + 60_000 };
      hits.set(ip, bucket);
    }
    bucket.count += 1;
    return bucket.count <= options.rateLimitPerMinute;
  };

  const server = createNodeServer((req, res) => {
    void (async () => {
    const cors = corsHeaders(options.corsOrigin);
    if (req.method === "OPTIONS") {
      res.writeHead(204, cors);
      res.end();
      return;
    }

    const url = new URL(req.url ?? "/", `http://${options.host}`);
    const path = url.pathname;

    // Public health
    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, { ok: true }, cors);
      return;
    }

    // Public SPA (before /api auth). No HTML fallback.
    if (options.webStatic) {
      const served = await tryServeWebStatic(req, res, options.webStatic, cors);
      if (served) return;
    }

    const needsAuth = path.startsWith("/api/");
    // Face claims its own paths (including loopback product-shell auth).
    if (options.tryHandleExtraApi?.(req, res)) {
      return;
    }

    if (needsAuth && !checkAuth(req)) {
      sendJson(res, 401, { error: "unauthorized" }, cors);
      return;
    }

    try {
      // newSession
      if (req.method === "POST" && path === "/api/sessions") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as { sessionId?: string };
        const sessionId = options.ensureSession(body.sessionId);
        sendJson(res, 201, { sessionId }, cors);
        return;
      }

      if (req.method === "POST" && path === "/api/chat") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as HttpChatRequest;
        if (!body.message || typeof body.message !== "string") {
          sendJson(res, 400, { error: "message required" }, cors);
          return;
        }
        const sessionId = options.ensureSession(body.sessionId);
        const agent = await options.resolveAgent(sessionId);
        const before = options.store.get(sessionId).events.length;
        const result = await agent.continueTurn({ text: body.message });
        const events = options.store.get(sessionId).events;
        for (const ev of events.slice(before)) {
          publish(sessionId, ev);
        }
        const out: HttpChatResponse = {
          sessionId,
          turnId: result.turnId,
          text: result.text,
          steps: result.steps,
          ...(result.admitId ? { admitId: result.admitId } : {}),
        };
        sendJson(res, 200, out, cors);
        return;
      }

      if (req.method === "POST" && path === "/api/chat/stream") {
        const raw = await readBody(req);
        const body = JSON.parse(raw || "{}") as HttpChatRequest;
        if (!body.message || typeof body.message !== "string") {
          sendJson(res, 400, { error: "message required" }, cors);
          return;
        }
        const sessionId = options.ensureSession(body.sessionId);
        res.writeHead(200, {
          ...cors,
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        const write = (event: string, data: unknown) => {
          res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        };
        write("session", { sessionId });
        const agent = await options.resolveAgent(sessionId);
        const before = options.store.get(sessionId).events.length;
        const result = await agent.continueTurn({ text: body.message });
        const events = options.store.get(sessionId).events;
        for (const ev of events.slice(before)) {
          write("session_event", ev);
          publish(sessionId, ev);
        }
        write("done", {
          sessionId,
          turnId: result.turnId,
          text: result.text,
          steps: result.steps,
          ...(result.admitId ? { admitId: result.admitId } : {}),
        });
        res.end();
        return;
      }

      if (path.startsWith("/api/sessions/")) {
        const parts = path.split("/");
        const sessionId = parts[3];
        const rest = parts[4];
        if (!sessionId) {
          sendJson(res, 400, { error: "session id required" }, cors);
          return;
        }

        if (req.method === "POST" && rest === "admit") {
          const raw = await readBody(req);
          const body = JSON.parse(raw || "{}") as HttpAdmitRequest;
          if (!body.message || typeof body.message !== "string") {
            sendJson(res, 400, { error: "message required" }, cors);
            return;
          }
          const parsedDelivery = parsePromptDelivery(body.delivery);
          if (!parsedDelivery.ok) {
            sendJson(
              res,
              400,
              { error: "invalid delivery", message: 'expected "steer" | "queue"' },
              cors,
            );
            return;
          }
          try {
            options.store.get(sessionId);
          } catch {
            sendJson(res, 404, { error: "session not found" }, cors);
            return;
          }
          const agent = await options.resolveAgent(sessionId);
          const receipt = agent.admit(
            body.message,
            parsedDelivery.delivery
              ? { delivery: parsedDelivery.delivery }
              : undefined,
          );

          if (body.resume) {
            const before = options.store.get(sessionId).events.length;
            let result:
              | {
                  turnId: string;
                  text: string;
                  steps: number;
                  admitId?: string;
                }
              | undefined;
            if (options.drain) {
              result = await options.drain.run(sessionId);
            } else {
              result = await agent.continueTurn();
            }
            if (!result) {
              sendJson(
                res,
                500,
                { error: "drain produced no turn result" },
                cors,
              );
              return;
            }
            const events = options.store.get(sessionId).events;
            for (const ev of events.slice(before)) {
              publish(sessionId, ev);
            }
            sendJson(
              res,
              200,
              {
                sessionId,
                admitId: receipt.admitId,
                delivery: receipt.delivery,
                turnId: result.turnId,
                text: result.text,
                steps: result.steps,
              } satisfies HttpChatResponse & {
                admitId: string;
                delivery: PromptDelivery;
              },
              cors,
            );
            return;
          }

          if (body.wake) {
            options.drain?.wake(sessionId);
            publish(sessionId, options.store.get(sessionId).events.at(-1)!);
            sendJson(
              res,
              202,
              {
                sessionId,
                admitId: receipt.admitId,
                delivery: receipt.delivery,
                pending: agent.pendingAdmits().length,
                scheduled: true,
              },
              cors,
            );
            return;
          }

          publish(sessionId, options.store.get(sessionId).events.at(-1)!);
          sendJson(
            res,
            202,
            {
              sessionId,
              admitId: receipt.admitId,
              delivery: receipt.delivery,
              pending: agent.pendingAdmits().length,
            },
            cors,
          );
          return;
        }

        if (req.method === "POST" && rest === "turn") {
          const raw = await readBody(req);
          const body = JSON.parse(raw || "{}") as HttpTurnRequest;
          try {
            options.store.get(sessionId);
          } catch {
            sendJson(res, 404, { error: "session not found" }, cors);
            return;
          }
          const agent = await options.resolveAgent(sessionId);
          const before = options.store.get(sessionId).events.length;
          const result = await agent.continueTurn(
            body.message?.trim()
              ? { text: body.message }
              : {},
          );
          const events = options.store.get(sessionId).events;
          for (const ev of events.slice(before)) {
            publish(sessionId, ev);
          }
          sendJson(
            res,
            200,
            {
              sessionId,
              turnId: result.turnId,
              text: result.text,
              steps: result.steps,
              ...(result.admitId ? { admitId: result.admitId } : {}),
            } satisfies HttpChatResponse,
            cors,
          );
          return;
        }

        if (req.method === "GET" && rest === "events" && url.searchParams.get("stream") === "1") {
          res.writeHead(200, {
            ...cors,
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          let set = eventSubs.get(sessionId);
          if (!set) {
            set = new Set();
            eventSubs.set(sessionId, set);
          }
          set.add(res);
          try {
            for (const ev of options.store.get(sessionId).events) {
              res.write(`data: ${JSON.stringify(ev)}\n\n`);
            }
          } catch {
            // new empty session ok
          }
          req.on("close", () => {
            set?.delete(res);
          });
          return;
        }
        if (req.method === "GET" && !rest) {
          try {
            const events = options.store.get(sessionId).events;
            sendJson(res, 200, { sessionId, events }, cors);
          } catch {
            sendJson(res, 404, { error: "session not found" }, cors);
          }
          return;
        }
      }

      sendJson(res, 404, { error: "not found" }, cors);
    } catch (err) {
      if (err instanceof SessionBusyError) {
        sendJson(
          res,
          409,
          {
            error: "session busy",
            message: err.message,
            ...(err.sessionId ? { sessionId: err.sessionId } : {}),
          },
          cors,
        );
        return;
      }
      if (err instanceof SessionSafetyLimitError) {
        sendJson(
          res,
          409,
          {
            error: "safety limit",
            message: err.message,
            reason: err.reason,
          },
          cors,
        );
        return;
      }
      if (err instanceof NoPendingAdmitError) {
        sendJson(res, 400, { error: "no pending admit", message: err.message }, cors);
        return;
      }
      const message = err instanceof Error ? err.message : String(err);
      sendJson(res, 500, { error: message }, cors);
    }
    })();
  });

  const extrasCloser = options.attachExtras?.(server);

  return {
    server,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(options.port, options.host, () => {
          const addr = server.address();
          if (addr && typeof addr === "object") {
            resolve({ host: options.host, port: addr.port });
          } else {
            resolve({ host: options.host, port: options.port });
          }
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        for (const set of eventSubs.values()) {
          for (const res of set) res.end();
        }
        eventSubs.clear();
        extrasCloser?.close();
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}

export {
  XRK_OMIT_CLIENT_PLUGIN_IDS,
  applyXrkProductBootPolicy,
  loadBootManifestFromWebDist,
  resolveWebBootManifest,
  mergeWebBootManifests,
  bootInjectScript,
  injectBootIntoHtml,
  type WebBootEntry,
  type WebBootManifest,
} from "./boot-inject.js";
export {
  resolveStaticPath,
  tryServeWebStatic,
  type WebStaticOptions,
} from "./static.js";
