/**
 * Face HTTP 读写辅助（无业务）。
 */

import type { IncomingMessage, ServerResponse } from "node:http";

export function readHttpBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export function sendJson(
  res: ServerResponse,
  status: number,
  body: unknown,
): void {
  if (res.headersSent) return;
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(data),
  });
  res.end(data);
}
