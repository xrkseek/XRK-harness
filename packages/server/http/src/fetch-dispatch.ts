/**
 * Dispatch a Fetch `Request` through a Node `http.Server` without binding a port.
 * Used by Desktop Host pipe transport (ADR-0008).
 */

import { IncomingMessage, ServerResponse, type Server } from "node:http";
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

  return new Promise<Response>((resolve, reject) => {
    const res = new ServerResponse(req);
    const chunks: Buffer[] = [];
    let settled = false;
    let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;
    let responseOpened = false;

    const responseHeaders = new Headers();

    const openResponse = (): void => {
      if (responseOpened) return;
      responseOpened = true;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          streamController = controller;
          for (const chunk of chunks) controller.enqueue(chunk);
        },
      });
      resolve(
        new Response(body, {
          status: res.statusCode || 200,
          headers: responseHeaders,
        }),
      );
    };

    const captureHeaders = (): void => {
      const raw = res.getHeaders();
      for (const [key, value] of Object.entries(raw)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) responseHeaders.append(key, String(item));
        } else {
          responseHeaders.set(key, String(value));
        }
      }
    };

    const origWriteHead = res.writeHead.bind(res);
    res.writeHead = ((
      statusCode: number,
      reasonOrHeaders?: string | import("node:http").OutgoingHttpHeaders,
      maybeHeaders?: import("node:http").OutgoingHttpHeaders,
    ) => {
      res.statusCode = statusCode;
      const result = origWriteHead(
        statusCode,
        reasonOrHeaders as never,
        maybeHeaders as never,
      );
      captureHeaders();
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
      if (streamController) streamController.enqueue(buf);
      else chunks.push(buf);
    };

    res.write = ((chunk: unknown, encoding?: unknown, cb?: unknown) => {
      if (!responseOpened) {
        captureHeaders();
        openResponse();
      }
      pushChunk(chunk);
      if (typeof encoding === "function") encoding();
      else if (typeof cb === "function") cb();
      return true;
    }) as typeof res.write;

    res.end = ((chunk?: unknown, encoding?: unknown, cb?: unknown) => {
      if (!responseOpened) {
        captureHeaders();
        openResponse();
      }
      if (chunk !== undefined && typeof chunk !== "function") {
        pushChunk(chunk);
      }
      streamController?.close();
      settled = true;
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
      else streamController?.error(error);
    });

    try {
      server.emit("request", req, res);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
