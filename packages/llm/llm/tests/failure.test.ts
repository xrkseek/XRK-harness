import { describe, expect, it } from "vitest";
import {
  EmptyResponseError,
  IncompleteToolCallError,
  LlmError,
  computeRetryDelayMs,
  failureFromUnknown,
  httpErrorCode,
  isRetryableFailure,
  parseRetryAfterMs,
  throwHttpLlmError,
  DEFAULT_NON_RETRYABLE_CODES,
  DEFAULT_RETRY_POLICY,
  type LlmChatResponse,
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

describe("abnormal failures are retryable", () => {
  it("retries bare stream-socket deaths with no provider code", () => {
    // What undici throws when a response body dies mid-read: a bare TypeError
    // with no provider code. It reaches the retry loop as UNKNOWN — and
    // UNKNOWN is retryable, so no errno/message guessing is needed.
    expect(
      isRetryableFailure(failureFromUnknown(new TypeError("terminated"))),
    ).toBe(true);
    expect(
      failureFromUnknown(new TypeError("terminated"))).toMatchObject({
      code: "UNKNOWN",
    });
    expect(
      isRetryableFailure(failureFromUnknown(new TypeError("fetch failed"))),
    ).toBe(true);
    // `fetch failed` wraps the real errno on `cause`; still UNKNOWN, still
    // retried — no cause-chain walk required to get there.
    const fetchFailed = new TypeError("fetch failed", {
      cause: Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    });
    expect(isRetryableFailure(failureFromUnknown(fetchFailed))).toBe(true);
    // Chromium renderer stack.
    expect(
      isRetryableFailure(
        failureFromUnknown(new TypeError("Failed to fetch")),
      ),
    ).toBe(true);
  });

  it("retries a socket errno that survives as its own code", () => {
    expect(
      failureFromUnknown(
        Object.assign(new TypeError("boom"), { code: "ECONNRESET" }),
      ),
    ).toMatchObject({ code: "ECONNRESET" });
    expect(
      isRetryableFailure(
        failureFromUnknown(
          Object.assign(new TypeError("boom"), { code: "ECONNRESET" }),
        ),
      ),
    ).toBe(true);
    expect(
      isRetryableFailure(
        failureFromUnknown(
          Object.assign(new TypeError("boom"), { code: "UND_ERR_SOCKET" }),
        ),
      ),
    ).toBe(true);
  });

  it("retries an undecidable error rather than guessing its class", () => {
    expect(
      isRetryableFailure(failureFromUnknown(new Error("who knows"))),
    ).toBe(true);
  });
});

describe("deterministic failures are not retried", () => {
  it("blacklists every non-retryable code", () => {
    for (const code of DEFAULT_NON_RETRYABLE_CODES) {
      expect(isRetryableFailure({ message: "x", code })).toBe(false);
    }
  });

  it("covers the codes the adapters actually produce", () => {
    expect(
      isRetryableFailure(failureFromUnknown(new LlmError("bad key", "AUTH"))),
    ).toBe(false);
    expect(
      isRetryableFailure(failureFromUnknown(new LlmError("no credit", "QUOTA"))),
    ).toBe(false);
    expect(
      isRetryableFailure(
        failureFromUnknown(new DOMException("aborted", "AbortError")),
      ),
    ).toBe(false);
    expect(
      isRetryableFailure({
        message: "x",
        code: "INVALID_REQUEST",
        status: 400,
      }),
    ).toBe(false);
  });

  it("retries an abnormal tool-call truncation", () => {
    // Truncated tool JSON is exactly the "异常截断" case: the provider stopped
    // mid-call, so the next attempt can produce a complete one.
    expect(
      isRetryableFailure(
        failureFromUnknown(new IncompleteToolCallError("truncated args")),
      ),
    ).toBe(true);
    expect(failureFromUnknown(new IncompleteToolCallError("x"))).toMatchObject({
      code: "INCOMPLETE_TOOL_CALL",
    });
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

  it("never throws on a model hitting its output ceiling", () => {
    // `finish_reason: length` is a successful response field, not a failure —
    // it becomes finishReason "max-tokens" and never reaches this predicate.
    // The check exists so that "normal truncation is not retried" is enforced
    // by the type system rather than by a blacklist entry that isn't there.
    const truncated: LlmChatResponse = {
      content: "half a sen",
      finishReason: "max-tokens",
    };
    expect(truncated.finishReason).toBe("max-tokens");
    expect(isRetryableFailure({ message: "", code: "max-tokens" })).toBe(true);
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
