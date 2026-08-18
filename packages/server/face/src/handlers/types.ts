import type { FaceRpcResult } from "../types.js";
import type { FaceRuntime } from "../context.js";

export type FaceHandler = (
  runtime: FaceRuntime,
  rpcId: string,
  payload: unknown,
) => Promise<FaceRpcResult<unknown>>;

export function asRecord(payload: unknown): Record<string, unknown> {
  return payload && typeof payload === "object"
    ? (payload as Record<string, unknown>)
    : {};
}

/** Typert Remote 载荷：`{ args: { … } }`；验证台可直接传扁平对象。 */
export function remoteArgs(payload: unknown): Record<string, unknown> {
  const p = asRecord(payload);
  const args = p.args;
  if (args && typeof args === "object" && !Array.isArray(args)) {
    return args as Record<string, unknown>;
  }
  return p;
}

export const notImplemented: FaceHandler = async () => ({
  ok: false,
  error: { code: "not-implemented", message: "not implemented in Face" },
});
