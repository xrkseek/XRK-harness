import { describe, expect, it } from "vitest";
import { mapFaceRpcError } from "../src/wire/rpc-error.js";

describe("mapFaceRpcError", () => {
  it("maps XRK-only codes to DSH closed set with details", () => {
    expect(mapFaceRpcError("invalid-payload", "x")).toEqual({
      code: "bad-request",
      message: "invalid-payload: x",
      details: { issues: [] },
    });
    expect(mapFaceRpcError("not-implemented", "nope")).toEqual({
      code: "internal",
      message: "nope",
      details: {},
    });
    expect(mapFaceRpcError("unsupported-modality", "text-only")).toEqual({
      code: "attachment-error",
      message: "unsupported-modality: text-only",
      details: { reason: "text-only" },
    });
  });

  it("keeps DSH codes and fills required details", () => {
    expect(mapFaceRpcError("session-not-found", "s1")).toEqual({
      code: "session-not-found",
      message: "s1",
      details: { sessionId: "s1" },
    });
    expect(
      mapFaceRpcError("internal", "boom", { extra: 1 }),
    ).toEqual({
      code: "internal",
      message: "boom",
      details: { extra: 1 },
    });
  });
});
