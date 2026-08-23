/**
 * dsh-dream-skin host KV (`/dream-skin/api`).
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { sendDshOk, sendDshErr } from "./dsh-envelope.js";
import { createXrkDocStore } from "./underlying/doc-store.js";
import { parseJsonBody } from "./underlying/http-kit.js";

export interface DreamSkinOptions {
  readonly xrkHome?: string;
}

const DREAM_SKIN_STORE = createXrkDocStore<Record<string, string | null>>(
  ["dream-skin", "state.json"],
  {},
);

export async function handleDreamSkinHttp(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  options: DreamSkinOptions,
): Promise<boolean> {
  if (pathname !== "/dream-skin/api") return false;
  if ((req.method ?? "GET").toUpperCase() !== "POST") {
    sendDshErr(res, "POST required", "method", 405);
    return true;
  }
  const body = await parseJsonBody(req);
  const method = typeof body.method === "string" ? body.method : "get";
  const state = DREAM_SKIN_STORE.read(options.xrkHome).data;

  if (method === "get") {
    sendDshOk(res, state);
    return true;
  }

  if (method === "set") {
    const patch =
      body.patch && typeof body.patch === "object"
        ? (body.patch as Record<string, unknown>)
        : {};
    const next = { ...state };
    for (const [key, value] of Object.entries(patch)) {
      if (value === null) {
        next[key] = null;
      } else if (typeof value === "string") {
        next[key] = value;
      } else {
        next[key] = String(value);
      }
    }
    const saved = DREAM_SKIN_STORE.write(options.xrkHome, next);
    sendDshOk(res, { ...saved.data, revision: saved.revision });
    return true;
  }

  sendDshErr(res, `unknown method: ${method}`);
  return true;
}
