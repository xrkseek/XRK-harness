/**
 * Privileged-method elevation via XRK_API_KEY (Bearer / x-api-key).
 */
import { afterEach, describe, expect, it } from "vitest";
import { apiKeyElevatesRequest } from "../src/operator-elevation.ts";

describe("apiKeyElevatesRequest", () => {
  const previous = process.env.XRK_API_KEY;

  afterEach(() => {
    if (previous === undefined) delete process.env.XRK_API_KEY;
    else process.env.XRK_API_KEY = previous;
  });

  it("rejects when XRK_API_KEY is unset", () => {
    delete process.env.XRK_API_KEY;
    const request = new Request("http://harness.example/api/settings.describe", {
      headers: { authorization: "Bearer anything" },
    });
    expect(apiKeyElevatesRequest(request)).toBe(false);
  });

  it("accepts matching Bearer and x-api-key", () => {
    process.env.XRK_API_KEY = "test-elev-key";
    expect(
      apiKeyElevatesRequest(
        new Request("http://harness.example/api/x", {
          headers: { authorization: "Bearer test-elev-key" },
        }),
      ),
    ).toBe(true);
    expect(
      apiKeyElevatesRequest(
        new Request("http://harness.example/api/x", {
          headers: { "x-api-key": "test-elev-key" },
        }),
      ),
    ).toBe(true);
  });

  it("rejects missing or mismatched keys", () => {
    process.env.XRK_API_KEY = "test-elev-key";
    expect(
      apiKeyElevatesRequest(new Request("http://harness.example/api/x")),
    ).toBe(false);
    expect(
      apiKeyElevatesRequest(
        new Request("http://harness.example/api/x", {
          headers: { authorization: "Bearer wrong-key-!!" },
        }),
      ),
    ).toBe(false);
  });
});
