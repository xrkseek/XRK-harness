import type { FaceRpcRequest, FaceRpcResponse, RpcId } from "./types.js";

/**
 * Parse Face unary body. Accepts DeepSeek wire (`type: client-request`) and
 * the thinner XRK shape (`rpcId` + `payload` only).
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

/** DeepSeek-compatible unary success envelope. */
export function okResponse<T>(rpcId: RpcId, value: T): FaceRpcResponse<T> {
  return {
    type: "server-response",
    rpcId,
    result: { ok: true, value },
  };
}

/** DeepSeek-compatible unary error envelope. */
export function errResponse(
  rpcId: RpcId,
  code: string,
  message: string,
): FaceRpcResponse<never> {
  return {
    type: "server-response",
    rpcId,
    result: { ok: false, error: { code, message } },
  };
}

/** DeepSeek WS downlink frame (`server-request` + method = payload.type). */
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
