import { describe, expect, it } from "vitest";
import {
  classifyAutoReview,
  describeAutoReviewAccess,
  probeAutoReviewClassifier,
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

  it("describeAutoReviewAccess reports source honestly", () => {
    expect(describeAutoReviewAccess({}).source).toBe("default");
    expect(describeAutoReviewAccess({}).kind).toBe("heuristic");
    expect(
      describeAutoReviewAccess(
        {},
        { classifierUrl: "https://classifier.example/review" },
      ).source,
    ).toBe("product");
    expect(
      describeAutoReviewAccess({
        XRK_AUTO_REVIEW_CLASSIFIER_URL: "https://env.example/review",
      }).source,
    ).toBe("env");
  });

  it("probeAutoReviewClassifier succeeds on heuristic sample", async () => {
    const probe = await probeAutoReviewClassifier({ env: {} });
    expect(probe.ok).toBe(true);
    expect(probe.detail).toMatch(/heuristic probe ok/);
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

  it("uses Face product URL when env host is unset", async () => {
    const result = await classifyAutoReview(
      { toolName: "read_file" },
      {
        env: {},
        product: {
          classifierUrl: "http://product.test/review",
          classifierToken: "product-tok",
        },
        fetchImpl: async (input, init) => {
          expect(String(input)).toBe("http://product.test/review");
          const headers = init?.headers as Record<string, string>;
          expect(headers.authorization).toBe("Bearer product-tok");
          return new Response(
            JSON.stringify({ verdict: "allow", reason: "product" }),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(result.classifier).toBe("http");
    expect(result.classification.verdict).toBe("allow");
  });

  it("lets env URL bypass product", async () => {
    const resolved = resolveAutoReviewClassifier({
      env: { XRK_AUTO_REVIEW_CLASSIFIER_URL: "http://env.test/review" },
      product: { classifierUrl: "http://product.test/review" },
    });
    expect(resolved.kind).toBe("http");
    expect(resolved.id).toBe("http");
  });
});
