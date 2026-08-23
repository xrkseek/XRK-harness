/**
 * 底层标准：HTTP 入参解析（只读一次 body，避免挂起）。
 */
import type { IncomingMessage } from "node:http";
import { readBody } from "../../http-json.js";

export function httpMethod(req: IncomingMessage): string {
  return (req.method ?? "GET").toUpperCase();
}

export function isMutatingMethod(method: string): boolean {
  return method === "POST" || method === "PUT" || method === "PATCH";
}

export async function parseJsonBody(
  req: IncomingMessage,
): Promise<Record<string, unknown>> {
  const raw = await readBody(req);
  try {
    return JSON.parse(raw || "{}") as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function drainMutatingBody(req: IncomingMessage): Promise<void> {
  if (isMutatingMethod(httpMethod(req))) {
    await readBody(req);
  }
}
