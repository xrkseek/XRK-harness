import { describe, expect, it } from "vitest";
import {
  errResponse,
  okResponse,
  parseFaceRpcRequest,
} from "../src/envelope.js";

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
      rpcId: "r1",
      result: { ok: true, value: { accepted: true } },
    });
    expect(errResponse("r1", "not-implemented", "x").result).toEqual({
      ok: false,
      error: { code: "not-implemented", message: "x" },
    });
  });
});
