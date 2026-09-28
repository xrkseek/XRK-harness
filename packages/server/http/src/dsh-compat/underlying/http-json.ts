/**
 * HTTP JSON helpers for dsh-compat (first-party; travels with `underlying/` on extract).
 */
import type { IncomingMessage, ServerResponse } from "node:http";

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { readonly [k: string]: Json };

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
  extra: Record<string, string> = {},
): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(data),
    ...extra,
  });
  res.end(data);
}

export function readBodyBuffer(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function readBody(req: IncomingMessage): Promise<string> {
  return readBodyBuffer(req).then((buf) => buf.toString("utf8"));
}

export function rpcOk(rpcId: string, value: unknown): unknown {
  return {
    type: "server-response",
    rpcId,
    result: { ok: true, value },
  };
}

export function rpcErr(
  rpcId: string,
  code: string,
  message: string,
  details?: Record<string, unknown>,
): unknown {
  return {
    type: "server-response",
    rpcId,
    result: {
      ok: false,
      error: {
        code,
        message,
        details: { adapter: "xrk-dsh-compat", ...details },
      },
    },
  };
}
