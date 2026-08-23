/**
 * Same-origin DSH plugin JSON envelope: `{ ok: true, value }` / `{ ok: false, error }`.
 * Most community clients do `if (!response.ok || !body.ok) throw`.
 */
import type { ServerResponse } from "node:http";
import { sendJson } from "../http-json.js";
import { DSH_COMPAT_ADAPTER } from "./meta.js";

export function sendDshOk(
  res: ServerResponse,
  value: unknown,
  status = 200,
): void {
  sendJson(res, status, { ok: true, value });
}

export function sendDshErr(
  res: ServerResponse,
  message: string,
  code = "compat",
  status = 200,
): void {
  sendJson(res, status, {
    ok: false,
    error: { code, message, details: { adapter: DSH_COMPAT_ADAPTER } },
  });
}
