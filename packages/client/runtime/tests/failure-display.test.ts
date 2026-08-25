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
});
