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
    expect(
      mapFaceRpcError("agent-preset-read-only", "locked", {
        agentPreset: "minimal",
        reason: "authorable: false",
      }),
    ).toEqual({
      code: "agent-preset-read-only",
      message: "locked",
      details: { agentPreset: "minimal", reason: "authorable: false" },
    });
    expect(mapFaceRpcError("unsupported-modality", "text-only")).toEqual({
      code: "attachment-error",
      message: "unsupported-modality: text-only",
      details: { reason: "text-only" },
    });
    expect(
      mapFaceRpcError("directory-picker-unavailable", "no zenity"),
    ).toEqual({
      code: "directory-picker-unavailable",
      message: "no zenity",
      details: {},
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

  it("maps policy-denied / policy-ask without collapsing to model-unavailable", () => {
    expect(
      mapFaceRpcError("policy-denied", "provider.use denied", {
        kind: "provider.use",
        reason: "provider.use denied",
        ruleId: "deny-providers",
      }),
    ).toEqual({
      code: "policy-denied",
      message: "provider.use denied",
      details: {
        kind: "provider.use",
        reason: "provider.use denied",
        ruleId: "deny-providers",
      },
    });
    expect(
      mapFaceRpcError("policy-ask", "host.open requires approval", {
        kind: "host.open",
        reason: "host.open requires approval",
      }),
    ).toEqual({
      code: "policy-ask",
      message: "host.open requires approval",
      details: {
        kind: "host.open",
        reason: "host.open requires approval",
      },
    });
    expect(
      mapFaceRpcError("provider-not-found", "no adapter", {
        provider: "x",
        model: "y",
      }),
    ).toEqual({
      code: "model-unavailable",
      message: "provider-not-found: no adapter",
      details: { provider: "x", model: "y" },
    });
  });
});
