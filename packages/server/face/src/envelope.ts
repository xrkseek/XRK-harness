import type { FaceRpcRequest, FaceRpcResponse, RpcId } from "./types.js";

export function parseFaceRpcRequest(body: unknown): FaceRpcRequest {
  if (!body || typeof body !== "object") {
    throw new Error("face: request body must be an object");
  }
  const o = body as Record<string, unknown>;
  if (typeof o.rpcId !== "string" || !o.rpcId.trim()) {
    throw new Error("face: rpcId required");
  }
  return {
    rpcId: o.rpcId,
    payload: "payload" in o ? o.payload : {},
  };
}

export function okResponse<T>(rpcId: RpcId, value: T): FaceRpcResponse<T> {
  return { rpcId, result: { ok: true, value } };
}

export function errResponse(
  rpcId: RpcId,
  code: string,
  message: string,
): FaceRpcResponse<never> {
  return { rpcId, result: { ok: false, error: { code, message } } };
}
