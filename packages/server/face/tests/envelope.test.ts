import { describe, expect, it } from "vitest";
import {
  errResponse,
  okResponse,
  parseFaceRpcRequest,
} from "../src/wire/envelope.js";

describe("face envelope", () => {
  it("parses rpcId + payload", () => {
    expect(parseFaceRpcRequest({ rpcId: "r1", payload: { a: 1 } })).toEqual({
      rpcId: "r1",
      payload: { a: 1 },
    });
  });

  it("requires rpcId", () => {
    expect(() => parseFaceRpcRequest({})).toThrow(/rpcId/);
  });

  it("ok/err shapes", () => {
    expect(okResponse("r1", { accepted: true })).toEqual({
      type: "server-response",
      rpcId: "r1",
      result: { ok: true, value: { accepted: true } },
    });
    expect(errResponse("r1", "not-implemented", "x")).toEqual({
      type: "server-response",
      rpcId: "r1",
      result: {
        ok: false,
        error: { code: "internal", message: "x", details: {} },
      },
    });
    expect(errResponse("r2", "session-not-found", "sid")).toEqual({
      type: "server-response",
      rpcId: "r2",
      result: {
        ok: false,
        error: {
          code: "session-not-found",
          message: "sid",
          details: { sessionId: "sid" },
        },
      },
    });
  });

  it("accepts DeepSeek client-request wire", () => {
    expect(
      parseFaceRpcRequest({
        type: "client-request",
        rpcId: "r2",
        method: "session.list",
        payload: {},
      }),
    ).toEqual({ rpcId: "r2", payload: {} });
  });
});
