import { describe, expect, it } from "vitest";
import {
  EmptyResponseError,
  LlmError,
  computeRetryDelayMs,
  failureFromUnknown,
  httpErrorCode,
  isRetryableFailure,
  parseRetryAfterMs,
  throwHttpLlmError,
  DEFAULT_RETRY_POLICY,
} from "../src/index.js";

describe("httpErrorCode", () => {
  it("maps status and quota body", () => {
    expect(httpErrorCode(401)).toBe("AUTH");
    expect(httpErrorCode(429)).toBe("RATE_LIMIT");
    expect(httpErrorCode(500)).toBe("SERVER");
    expect(httpErrorCode(400, "insufficient_quota")).toBe("QUOTA");
    expect(httpErrorCode(400, "bad json")).toBe("INVALID_REQUEST");
  });
});

describe("throwHttpLlmError", () => {
  it("throws LlmError with Retry-After", () => {
    const headers = new Headers({ "retry-after": "2" });
    try {
      throwHttpLlmError("openai-compatible", 429, "slow down", headers);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(LlmError);
      const e = err as LlmError;
      expect(e.code).toBe("RATE_LIMIT");
      expect(e.status).toBe(429);
      expect(e.providerRetryAfterMs).toBe(2000);
    }
  });
});

describe("parseRetryAfterMs", () => {
  it("parses seconds and HTTP-date", () => {
    expect(parseRetryAfterMs("3")).toBe(3000);
    expect(parseRetryAfterMs("nope")).toBeUndefined();
  });
});

describe("retry policy", () => {
  it("retries EMPTY_RESPONSE and RATE_LIMIT", () => {
    expect(
      isRetryableFailure(failureFromUnknown(new EmptyResponseError())),
    ).toBe(true);
    expect(
      isRetryableFailure({ message: "x", code: "RATE_LIMIT", status: 429 }),
    ).toBe(true);
    expect(
      isRetryableFailure({ message: "x", code: "AUTH", status: 401 }),
    ).toBe(false);
  });

  it("honors providerRetryAfterMs capped by maxDelay", () => {
    const ms = computeRetryDelayMs(
      DEFAULT_RETRY_POLICY,
      1,
      { message: "x", code: "RATE_LIMIT", providerRetryAfterMs: 120_000 },
      () => 0.5,
    );
    expect(ms).toBe(DEFAULT_RETRY_POLICY.maxDelayMs);
  });
});
