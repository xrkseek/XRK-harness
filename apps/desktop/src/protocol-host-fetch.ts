/**
 * Adapt Electron `protocol.handle` Requests to the Desktop Host pipe Fetch.
 *
 * Electron custom-protocol Request body streams are unreliable as a direct
 * `host.fetch` input (POST can hang in `body.getReader()`). Buffer the upload,
 * omit the protocol AbortSignal, and for non-SSE responses buffer the download
 * so Chromium does not have to pump a pipe-built ReadableStream.
 */

import type { DesktopHostProcess } from "./host-process.js";

/** True when Face wants a long-lived event-stream body. */
export function isDesktopFaceEventStream(response: Response): boolean {
  const ct = response.headers.get("content-type") ?? "";
  return ct.includes("text/event-stream");
}

/**
 * Forward one renderer protocol Request through {@link DesktopHostProcess.fetch}.
 */
export async function fetchDesktopHostFromProtocol(
  host: DesktopHostProcess,
  request: Request,
): Promise<Response> {
  const method = request.method.toUpperCase();
  const headers = new Headers(request.headers);
  const init: RequestInit = { method, headers };
  if (method !== "GET" && method !== "HEAD" && request.body !== null) {
    const bytes = await request.arrayBuffer();
    if (bytes.byteLength > 0) init.body = bytes;
  }
  // Omit Electron's Request.signal — forwarding it has wedged pipe uploads on
  // Electron 44 custom schemes. Build a plain Request for the Host carrier.
  const response = await host.fetch(new Request(request.url, init));
  if (isDesktopFaceEventStream(response)) return response;
  const body = await response.arrayBuffer();
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}
