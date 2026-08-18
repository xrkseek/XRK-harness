import { describe, expect, it } from "vitest";
import {
  faceMethodFromPath,
  isFaceRespondPath,
  parseClientResponse,
} from "../src/wire/index.js";

describe("face wire paths", () => {
  it("does not treat /api/respond as a dotted method", () => {
    expect(faceMethodFromPath("/api/respond")).toBeUndefined();
    expect(faceMethodFromPath("/api/face/respond")).toBeUndefined();
    expect(faceMethodFromPath("/api/commands/execute")).toBe("commands/execute");
    expect(isFaceRespondPath("/api/respond")).toBe(true);
    expect(isFaceRespondPath("/api/session.prompt")).toBe(false);
  });
});

describe("parseClientResponse", () => {
  it("accepts DSH client-response", () => {
    expect(
      parseClientResponse({
        type: "client-response",
        rpcId: "r1",
        result: { ok: true, value: { outcome: "allowed-once" } },
      }),
    ).toEqual({
      ok: true,
      rpcId: "r1",
      value: { outcome: "allowed-once" },
    });
  });

  it("rejects malformed bodies", () => {
    expect(parseClientResponse({})).toEqual({
      ok: false,
      reason: "bad-response",
    });
    expect(
      parseClientResponse({
        type: "client-response",
        rpcId: "r1",
        result: { ok: false, error: { code: "internal" } },
      }),
    ).toEqual({ ok: false, reason: "bad-response" });
  });
});
