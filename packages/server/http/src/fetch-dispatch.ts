/**
 * Dispatch a Fetch `Request` through a Node `http.Server` without binding a port.
 * Used by Desktop Host pipe transport (ADR-0008).
 */

import {
  IncomingMessage,
  ServerResponse,
  type OutgoingHttpHeaders,
  type Server,
} from "node:http";
import { Socket } from "node:net";

function headerRecord(
  headers: Headers,
): IncomingHttpHeaders {
  const out: IncomingHttpHeaders = {};
  headers.forEach((value, key) => {
    const existing = out[key];
    if (existing === undefined) out[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else out[key] = [existing, value];
  });
  return out;
}

type IncomingHttpHeaders = NodeJS.Dict<string | string[]>;

function mergeOutgoingHeaders(
  target: Headers,
  headers: OutgoingHttpHeaders | undefined,
): void {
  if (headers === undefined) return;
  for (const [key, value] of Object.entries(headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const item of value) target.append(key, String(item));
    } else {
      target.set(key, String(value));
    }
  }
}

function isStreamClosedError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    /Controller is already closed|Invalid state/u.test(error.message)
  );
}

/**
 * Emit `request` on `server` and return a Fetch `Response`.
 * Body is buffered for the Node IncomingMessage (streaming request bodies later).
 */
export async function dispatchHttpServerFetch(
  server: Server,
  request: Request,
): Promise<Response> {
  const url = new URL(request.url);
  const socket = new Socket();
  // Pipe / no-listen dispatch is local; Face auth treats loopback as trusted
  // when the product API key is set but the browser omits Authorization.
  Object.defineProperty(socket, "remoteAddress", {
    value: "127.0.0.1",
    configurable: true,
  });
  const req = new IncomingMessage(socket);
  req.method = request.method;
  req.url = `${url.pathname}${url.search}`;
  req.headers = headerRecord(request.headers);
  req.httpVersion = "1.1";
  req.httpVersionMajor = 1;
  req.httpVersionMinor = 1;

  const bodyBytes =
    request.method === "GET" || request.method === "HEAD" || request.body === null
      ? null
      : Buffer.from(await request.arrayBuffer());

  queueMicrotask(() => {
    if (bodyBytes !== null && bodyBytes.byteLength > 0) {
      req.push(bodyBytes);
    }
    req.push(null);
  });

  // When the pipe / renderer cancels the Fetch body (mux reconnect), tear down
  // the synthetic Node request so Face SSE `req.on("close")` unsubscribes.
  // Otherwise Face keeps `res.write` → enqueue on a closed controller and the
  // throw surfaces as `session.prompt` `internal: Controller is already closed`.
  const tearDownNodeRequest = (): void => {
    if (!req.destroyed) req.destroy();
    if (!socket.destroyed) socket.destroy();
  };
  if (request.signal.aborted) {
    queueMicrotask(tearDownNodeRequest);
  } else {
    request.signal.addEventListener("abort", tearDownNodeRequest, {
      once: true,
    });
  }

  return new Promise<Response>((resolve, reject) => {
    const res = new ServerResponse(req);
    const chunks: Buffer[] = [];
    let settled = false;
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let responseOpened = false;

    const responseHeaders = new Headers();

    const dropController = (): void => {
      streamController = undefined;
      settled = true;
    };

    const openResponse = (): void => {
      if (responseOpened) return;
      responseOpened = true;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          for (const chunk of chunks) {
            try {
              controller.enqueue(chunk);
            } catch (error) {
              if (isStreamClosedError(error)) {
                dropController();
                return;
              }
              throw error;
            }
          }
        },
        cancel() {
          dropController();
          tearDownNodeRequest();
        },
      });
      resolve(
        new Response(body, {
          status: res.statusCode || 200,
          headers: responseHeaders,
        }),
      );
    };

    /** Copy headers still held in `kOutHeaders` (before `writeHead` flushes them). */
    const capturePendingHeaders = (): void => {
      mergeOutgoingHeaders(responseHeaders, res.getHeaders());
    };

    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = ((
      statusCode: number,
      reasonOrHeaders?: string | OutgoingHttpHeaders,
      maybeHeaders?: OutgoingHttpHeaders,
    ) => {
      res.statusCode = statusCode;
      // Node clears getHeaders() once writeHead serializes into `_header`.
      // Capture setHeader() values and the writeHead() object form first.
      capturePendingHeaders();
      const fromArgs =
        typeof reasonOrHeaders === "string" ? maybeHeaders : reasonOrHeaders;
      mergeOutgoingHeaders(responseHeaders, fromArgs);
      const result = origWriteHead(
        statusCode,
        reasonOrHeaders as never,
        maybeHeaders as never,
      );
      openResponse();
      return result;
    }) as typeof res.writeHead;

    const pushChunk = (chunk: unknown): void => {
      if (chunk === undefined || chunk === null) return;
      const buf = Buffer.isBuffer(chunk)
        ? chunk
        : Buffer.from(
            typeof chunk === "string" ? chunk : String(chunk),
          );
      if (streamController === undefined) {
        if (!settled) chunks.push(buf);
        return;
      }
      try {
        streamController.enqueue(buf);
      } catch (error) {
        if (isStreamClosedError(error)) {
          dropController();
          tearDownNodeRequest();
          return;
        }
        throw error;
      }
    };

    res.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
      if (!responseOpened) {
        capturePendingHeaders();
        openResponse();
      }
      pushChunk(chunk);
      if (typeof encoding === "function") encoding();
      else if (typeof cb === "function") cb();
      return true;
    }) as typeof res.write;

    res.end = ((chunk?: unknown, encoding?: unknown, cb?: unknown) => {
      if (!responseOpened) {
        capturePendingHeaders();
        openResponse();
      }
      if (chunk !== undefined && typeof chunk !== "function") {
        pushChunk(chunk);
      }
      if (streamController !== undefined) {
        try {
          streamController.close();
        } catch (error) {
          if (!isStreamClosedError(error)) throw error;
        }
        dropController();
      } else {
        settled = true;
      }
      const done =
        typeof chunk === "function"
          ? chunk
          : typeof encoding === "function"
            ? encoding
            : typeof cb === "function"
              ? cb
              : undefined;
      if (typeof done === "function") done();
      return res;
    }) as typeof res.end;

    res.on("error", (error) => {
      if (!settled) reject(error);
      else if (streamController !== undefined) {
        try {
          streamController.error(error);
        } catch {
          /* already closed */
        }
        dropController();
      }
    });

    try {
      server.emit("request", req, res);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
