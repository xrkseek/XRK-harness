/**
 * Face unary / WS 信封（DSH 四象限 RPC）。
 */

import { mapFaceRpcError } from "./rpc-error.js";
import type { FaceRpcRequest, FaceRpcResponse, RpcId } from "../types.js";

/**
 * 解析 unary body。接受 DSH `{ type: client-request }` 与瘦形 `{ rpcId, payload }`。
 */
export function parseFaceRpcRequest(body: unknown): FaceRpcRequest {
  if (!body || typeof body !== "object") {
    throw new Error("face: request body must be an object");
  }
  const o = body as Record<string, unknown>;
  if (typeof o.rpcId !== "string" || !o.rpcId.trim()) {
    throw new Error("face: rpcId required");
  }
  if (o.type !== undefined && o.type !== "client-request") {
    throw new Error("face: expected type client-request");
  }
  return {
    rpcId: o.rpcId,
    payload: "payload" in o ? o.payload : {},
  };
}

/** DSH unary 成功信封。 */
export function okResponse<T>(rpcId: RpcId, value: T): FaceRpcResponse<T> {
  return {
    type: "server-response",
    rpcId,
    result: { ok: true, value },
  };
}

/** DSH unary 失败信封；必含 `details`。 */
export function errResponse(
  rpcId: RpcId,
  code: string,
  message: string,
  details?: unknown,
): FaceRpcResponse<never> {
  const error = mapFaceRpcError(code, message, details);
  return {
    type: "server-response",
    rpcId,
    result: { ok: false, error },
  };
}

/** DSH WS 下行：`server-request`，method = payload.type。 */
export function serverRequestFrame(
  rpcId: RpcId,
  payload: { readonly type: string } & Record<string, unknown>,
): {
  readonly type: "server-request";
  readonly rpcId: RpcId;
  readonly method: string;
  readonly payload: typeof payload;
} {
  return {
    type: "server-request",
    rpcId,
    method: payload.type,
    payload,
  };
}
