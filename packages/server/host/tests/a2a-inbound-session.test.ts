/** A2A inbound session id + product/env enable resolve. */
import { describe, expect, it } from "vitest";
import {
  a2aInboundSessionId,
  resolveA2aInboundEnabled,
} from "../src/a2a-inbound-public.js";

describe("a2aInboundSessionId", () => {
  it("derives a stable a2a-* id from contextId", () => {
    expect(a2aInboundSessionId("ctx/one")).toBe("a2a-ctx-one");
    expect(a2aInboundSessionId("  hello world  ")).toBe("a2a-hello-world");
  });

  it("honors XRK_A2A_INBOUND_SESSION pin over product", () => {
    expect(
      a2aInboundSessionId(
        "ctx/one",
        { XRK_A2A_INBOUND_SESSION: "sess-pinned" },
        { sessionId: "from-settings" },
      ),
    ).toBe("sess-pinned");
  });

  it("honors product sessionId when env pin unset", () => {
    expect(
      a2aInboundSessionId("ctx/one", {}, { sessionId: "from-settings" }),
    ).toBe("from-settings");
  });
});

describe("resolveA2aInboundEnabled", () => {
  it("defaults off without env or product", () => {
    expect(resolveA2aInboundEnabled({})).toBe(false);
  });

  it("reads product enabled when env empty", () => {
    expect(resolveA2aInboundEnabled({}, { enabled: true })).toBe(true);
    expect(resolveA2aInboundEnabled({}, { enabled: false })).toBe(false);
  });

  it("env CI bypass wins over product", () => {
    expect(
      resolveA2aInboundEnabled({ XRK_A2A_INBOUND: "0" }, { enabled: true }),
    ).toBe(false);
    expect(
      resolveA2aInboundEnabled({ XRK_A2A_INBOUND: "1" }, { enabled: false }),
    ).toBe(true);
  });
});
