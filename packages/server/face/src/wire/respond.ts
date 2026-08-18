/**
 * DSH `POST /api/respond`：解析 client-response，先审批后提问。
 */

import type { FaceRuntime } from "../context.js";
import type { FaceRpcReceipt } from "../types.js";

export type ParsedClientResponse =
  | { readonly ok: true; readonly rpcId: string; readonly value: unknown }
  | { readonly ok: false; readonly reason: "bad-response" };

/** 解析 `{ type: client-response, rpcId, result }`（ok:true 路径，审批用）。 */
export function parseClientResponse(body: unknown): ParsedClientResponse {
  if (!body || typeof body !== "object") {
    return { ok: false, reason: "bad-response" };
  }
  const o = body as Record<string, unknown>;
  if (o.type !== "client-response" || typeof o.rpcId !== "string") {
    return { ok: false, reason: "bad-response" };
  }
  const result = o.result;
  if (!result || typeof result !== "object") {
    return { ok: false, reason: "bad-response" };
  }
  const r = result as Record<string, unknown>;
  if (r.ok !== true) {
    return { ok: false, reason: "bad-response" };
  }
  return { ok: true, rpcId: o.rpcId, value: r.value };
}

/** 把 client-response 交给审批或提问 broker，返回 DSH 回执。 */
export function settleFaceRespond(
  runtime: FaceRuntime,
  body: unknown,
): FaceRpcReceipt {
  if (!body || typeof body !== "object") {
    return { accepted: false, reason: "bad-response" };
  }
  const o = body as Record<string, unknown>;
  if (o.type !== "client-response" || typeof o.rpcId !== "string") {
    return { accepted: false, reason: "bad-response" };
  }
  const result = o.result;
  if (!result || typeof result !== "object") {
    return { accepted: false, reason: "bad-response" };
  }
  const parsed = parseClientResponse(body);
  if (parsed.ok) {
    const approval = runtime.approvals.respondByRpcId(parsed.rpcId, parsed.value);
    if (approval.accepted || approval.reason === "bad-response") {
      return approval;
    }
  } else if (!runtime.questions.hasRpcId(o.rpcId)) {
    return { accepted: false, reason: parsed.reason };
  }
  return runtime.questions.respondByRpcId(o.rpcId, result);
}
