/**
 * Framed-pipe runtime: request decoder → Fetch handler → response encoder (ADR-0008).
 */

import { createReadStream, createWriteStream } from "node:fs";
import type { Readable, Writable } from "node:stream";
import {
  DESKTOP_HOST_PROTOCOL_VERSION,
  DESKTOP_PIPE_CHUNK_BYTES,
  DESKTOP_REQUEST_PIPE_FD,
  DESKTOP_RESPONSE_PIPE_FD,
  DesktopHostRequestDecoder,
  encodeDesktopResponseData,
  encodeDesktopResponseEnd,
  encodeDesktopResponseError,
  encodeDesktopResponseStart,
  writeDesktopPipeFrame,
  type DesktopHostRequestFrame,
} from "./wire.js";

export interface DesktopHostPipeFetch {
  (request: Request): Promise<Response>;
}

interface OpenStream {
  readonly url: string;
  readonly method: string;
  readonly headers: readonly [string, string][];
  readonly hasBody: boolean;
  chunks: Buffer[];
  aborted: boolean;
}

export interface DesktopHostPipeRuntime {
  readonly protocolVersion: typeof DESKTOP_HOST_PROTOCOL_VERSION;
  dispose(): Promise<void>;
}

function toHttpUrl(raw: string): string {
  try {
    const url = new URL(raw);
    if (url.protocol === "xrk-app:" && url.hostname === "app") {
      return `http://desktop.local${url.pathname}${url.search}`;
    }
    return raw;
  } catch {
    return raw;
  }
}

async function writeResponse(
  pipe: Writable,
  streamId: number,
  response: Response,
): Promise<void> {
  const headers: [string, string][] = [];
  response.headers.forEach((value, key) => {
    headers.push([key, value]);
  });
  const hasBody = response.body !== null;
  await writeDesktopPipeFrame(
    pipe,
    encodeDesktopResponseStart(streamId, {
      status: response.status,
      headers,
      hasBody,
    }),
  );
  if (!hasBody || response.body === null) {
    await writeDesktopPipeFrame(pipe, encodeDesktopResponseEnd(streamId));
    return;
  }
  const reader = response.body.getReader();
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      for (
        let offset = 0;
        offset < next.value.byteLength;
        offset += DESKTOP_PIPE_CHUNK_BYTES
      ) {
        await writeDesktopPipeFrame(
          pipe,
          encodeDesktopResponseData(
            streamId,
            next.value.subarray(offset, offset + DESKTOP_PIPE_CHUNK_BYTES),
          ),
        );
      }
    }
    await writeDesktopPipeFrame(pipe, encodeDesktopResponseEnd(streamId));
  } finally {
    reader.releaseLock();
  }
}

/**
 * Attach framed pipes and dispatch each completed request stream through `fetch`.
 * Tests may pass in-memory streams; production uses fds 3/4 from Electron.
 */
export function startDesktopHostPipeRuntime(
  fetch: DesktopHostPipeFetch,
  options: {
    request?: Readable;
    response?: Writable;
    requestFd?: number;
    responseFd?: number;
  } = {},
): DesktopHostPipeRuntime {
  const requestPipe: Readable =
    options.request ??
    createReadStream("", {
      fd: options.requestFd ?? DESKTOP_REQUEST_PIPE_FD,
      autoClose: false,
    });
  const responsePipe: Writable =
    options.response ??
    createWriteStream("", {
      fd: options.responseFd ?? DESKTOP_RESPONSE_PIPE_FD,
      autoClose: false,
    });
  const decoder = new DesktopHostRequestDecoder();
  const open = new Map<number, OpenStream>();
  const inFlight = new Map<number, AbortController>();
  let writeTail: Promise<void> = Promise.resolve();
  let disposed = false;

  const enqueue = (task: () => Promise<void>): Promise<void> => {
    const next = writeTail.then(task, task);
    writeTail = next.catch(() => undefined);
    return next;
  };

  const abortStream = (streamId: number): void => {
    const stream = open.get(streamId);
    if (stream) {
      stream.aborted = true;
      open.delete(streamId);
    }
    const abort = inFlight.get(streamId);
    if (abort) {
      abort.abort();
      inFlight.delete(streamId);
    }
  };

  const completeRequest = (streamId: number): void => {
    const stream = open.get(streamId);
    if (stream === undefined || stream.aborted) return;
    open.delete(streamId);
    const abort = new AbortController();
    inFlight.set(streamId, abort);
    const body =
      stream.hasBody && stream.chunks.length > 0
        ? Buffer.concat(stream.chunks)
        : stream.hasBody
          ? Buffer.alloc(0)
          : null;
    const init: RequestInit & { duplex?: "half" } = {
      method: stream.method,
      headers: [...stream.headers],
      signal: abort.signal,
      ...(body
        ? {
            body,
            duplex: "half",
          }
        : {}),
    };
    void enqueue(async () => {
      try {
        const response = await fetch(
          new Request(toHttpUrl(stream.url), init),
        );
        if (abort.signal.aborted) return;
        await writeResponse(responsePipe, streamId, response);
      } catch (error) {
        if (abort.signal.aborted) return;
        const message = error instanceof Error ? error.message : String(error);
        await writeDesktopPipeFrame(
          responsePipe,
          encodeDesktopResponseError(streamId, message),
        );
      } finally {
        inFlight.delete(streamId);
      }
    });
  };

  const onFrame = (frame: DesktopHostRequestFrame): void => {
    switch (frame.type) {
      case "start":
        open.set(frame.streamId, {
          url: frame.url,
          method: frame.method,
          headers: frame.headers,
          hasBody: frame.hasBody,
          chunks: [],
          aborted: false,
        });
        if (!frame.hasBody) completeRequest(frame.streamId);
        return;
      case "data": {
        const stream = open.get(frame.streamId);
        if (stream && !stream.aborted) stream.chunks.push(frame.data);
        return;
      }
      case "end":
        completeRequest(frame.streamId);
        return;
      case "cancel":
        abortStream(frame.streamId);
        return;
      default:
        frame satisfies never;
    }
  };

  requestPipe.on("data", (chunk: Buffer | string) => {
    try {
      const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      for (const frame of decoder.push(bytes)) onFrame(frame);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `xrk desktop-host: request pipe decode failed: ${message}\n`,
      );
    }
  });

  return {
    protocolVersion: DESKTOP_HOST_PROTOCOL_VERSION,
    async dispose() {
      if (disposed) return;
      disposed = true;
      for (const stream of open.values()) stream.aborted = true;
      open.clear();
      for (const abort of inFlight.values()) abort.abort();
      inFlight.clear();
      requestPipe.destroy();
      await writeTail.catch(() => undefined);
      await new Promise<void>((resolve) => {
        if ("end" in responsePipe && typeof responsePipe.end === "function") {
          responsePipe.end(() => resolve());
        } else {
          resolve();
        }
      });
      responsePipe.destroy();
    },
  };
}
