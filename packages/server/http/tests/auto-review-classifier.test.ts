import { describe, expect, it } from "vitest";
import {
  classifyAutoReview,
  resolveAutoReviewClassifier,
} from "../src/dsh-compat/auto-review-classifier.js";

describe("auto-review classifier seam", () => {
  it("defaults to the heuristic", async () => {
    const resolved = resolveAutoReviewClassifier({ env: {} });
    expect(resolved.kind).toBe("heuristic");
    const denied = await classifyAutoReview(
      { toolName: "shell", args: { cmd: "rm -rf /" } },
      { env: {} },
    );
    expect(denied.ok).toBe(true);
    expect(denied.classifier).toBe("xrk-heuristic");
    expect(denied.classification.verdict).toBe("deny");
  });

  it("prefers an injected classifier over the heuristic", async () => {
    const result = await classifyAutoReview(
      { toolName: "shell", args: { cmd: "rm -rf /" } },
      {
        env: {},
        classifierId: "fixture",
        classifier: () => ({
          verdict: "allow",
          reason: "fixture-allow",
          confidence: 0.2,
        }),
      },
    );
    expect(result.classifier).toBe("fixture");
    expect(result.classification.verdict).toBe("allow");
    expect(result.classification.reason).toBe("fixture-allow");
  });

  it("posts to the HTTP classifier and fails closed", async () => {
    const allowed = await classifyAutoReview(
      { toolName: "read_file" },
      {
        env: {
          XRK_AUTO_REVIEW_CLASSIFIER_URL: "http://classifier.test/review",
          XRK_AUTO_REVIEW_CLASSIFIER_TOKEN: "tok",
        },
        fetchImpl: async (input, init) => {
          expect(String(input)).toBe("http://classifier.test/review");
          expect(init?.method).toBe("POST");
          const headers = init?.headers as Record<string, string>;
          expect(headers.authorization).toBe("Bearer tok");
          return new Response(
            JSON.stringify({ decision: "deny", reason: "sidecar" }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      },
    );
    expect(allowed.ok).toBe(true);
    expect(allowed.classifier).toBe("http");
    expect(allowed.classification.verdict).toBe("deny");

    const closed = await classifyAutoReview(
      { toolName: "read_file" },
      {
        env: { XRK_AUTO_REVIEW_CLASSIFIER_URL: "http://classifier.test/review" },
        fetchImpl: async () => new Response("no", { status: 503 }),
      },
    );
    expect(closed.ok).toBe(false);
    expect(closed.classification.verdict).toBe("ask");
    expect(closed.classification.reason).toBe("classifier-error");
  });
});
