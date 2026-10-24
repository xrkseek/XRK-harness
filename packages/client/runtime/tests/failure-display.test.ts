import { describe, expect, it } from "vitest";
import { displayFailureMessage } from "../src/client/sessions/failure-display.ts";

describe("displayFailureMessage", () => {
  it("redacts AUTH provider copy that may echo a key", () => {
    expect(
      displayFailureMessage({
        code: "AUTH",
        message:
          "Authentication Fails, Your api key: sk-preview-secret is invalid",
      }),
    ).toBe("API key is invalid");
  });

  it("passes through non-AUTH messages", () => {
    expect(
      displayFailureMessage({ code: "RATE_LIMIT", message: "slow down" }),
    ).toBe("slow down");
  });

  it("strips adapter prefixes and keeps region / free-tier detail", () => {
    expect(
      displayFailureMessage({
        code: "REGION",
        message:
          "openai-compatible HTTP 403: This model is not available in your country",
      }),
    ).toBe("This model is not available in your country");
    expect(
      displayFailureMessage({
        code: "PROVIDER_DENIED",
        message:
          "openai-compatible HTTP 403: OpenCode's free tier can only be used from within OpenCode.",
      }),
    ).toBe(
      "OpenCode's free tier can only be used from within OpenCode.",
    );
  });

  it("falls back to stable copy when the message is empty", () => {
    expect(displayFailureMessage({ code: "REGION", message: "" })).toBe(
      "This model is not available in your region",
    );
    expect(displayFailureMessage({ code: "FORBIDDEN" })).toBe(
      "Provider refused this request",
    );
  });
});
