import { describe, expect, it } from "vitest";
import {
  APP_IDENTITY,
  attributionHeaders,
  mergeOutboundAttributionHeaders,
  userAgent,
} from "../src/attribution.js";

describe("attribution", () => {
  it("builds a coding-agent User-Agent (OpenCode Go requirement)", () => {
    expect(APP_IDENTITY.product).toBe("xrk-harness");
    expect(userAgent()).toMatch(/^xrk-harness\/.+\s\(\+https:\/\/github\.com\/xrkseek\/XRK-harness\)$/);
    expect(attributionHeaders()["user-agent"]).toBe(userAgent());
  });

  it("overwrites a caller-supplied User-Agent so identity cannot be suppressed", () => {
    const headers = mergeOutboundAttributionHeaders({
      "user-agent": "undici",
      authorization: "Bearer x",
    });
    expect(headers["user-agent"]).toBe(userAgent());
    expect(headers.authorization).toBe("Bearer x");
  });
});
