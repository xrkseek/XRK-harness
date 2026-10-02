import { describe, expect, it } from "vitest";
import {
  AUTO_REVIEW_LEGAL_DECISION_SHAPES,
  AUTO_REVIEW_POLICY,
  buildAutoReviewReviewSnapshot,
  buildAutoReviewUserText,
  classificationFromClassifierBody,
  classifyAutoReview,
  createLlmStreamAutoReviewReviewer,
  createSessionLlmAutoReviewClassifier,
  describeAutoReviewAccess,
  parseAutoReviewDecision,
  parseAutoReviewDecisionRecord,
  probeAutoReviewClassifier,
  readAutoReviewStreamText,
  resolveAutoReviewClassifier,
} from "../src/dsh-compat/auto-review-classifier.js";
import type { LlmAdapter, LlmStreamEvent } from "@xrkseek/llm";

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
    expect(describeAutoReviewAccess({}).summary).toMatch(/heuristic \(active\)/);
    expect(describeAutoReviewAccess({}).summary).toMatch(/session-llm/);
    expect(describeAutoReviewAccess({}).summary).toMatch(/no sandbox/);
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
    expect(
      describeAutoReviewAccess({}, undefined, { hasSessionLlm: true }).kind,
    ).toBe("session-llm");
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
    expect(closed.classification.verdict).toBe("deny");
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

describe("session-LLM reviewer skeleton", () => {
  it("ships REVIEW_POLICY with the closed risk/decision shapes", () => {
    expect(AUTO_REVIEW_POLICY.startsWith("REVIEW_POLICY\n")).toBe(true);
    expect(AUTO_REVIEW_POLICY).toContain('{"risk":"low","decision":"allow"}');
    expect(AUTO_REVIEW_POLICY).toContain(
      "Never return low with deny, high with allow, or a reason with allow.",
    );
  });

  it("parses only the six legal risk×decision forms", () => {
    expect(parseAutoReviewDecision('{"risk":"low","decision":"allow"}')).toEqual({
      risk: "low",
      decision: "allow",
    });
    expect(
      parseAutoReviewDecision('{"risk":"medium","decision":"allow"}'),
    ).toEqual({ risk: "medium", decision: "allow" });
    expect(
      parseAutoReviewDecision('{"risk":"medium","decision":"deny"}'),
    ).toEqual({ risk: "medium", decision: "deny" });
    expect(
      parseAutoReviewDecision(
        '{"risk":"medium","decision":"deny","reason":"not authorized"}',
      ),
    ).toEqual({
      risk: "medium",
      decision: "deny",
      reason: "not authorized",
    });
    expect(parseAutoReviewDecision('{"risk":"high","decision":"deny"}')).toEqual(
      { risk: "high", decision: "deny" },
    );
    expect(
      parseAutoReviewDecision(
        '{"risk":"high","decision":"deny","reason":"exfil"}',
      ),
    ).toEqual({ risk: "high", decision: "deny", reason: "exfil" });
  });

  it("rejects illegal risk×decision combinations", () => {
    const illegal = [
      '{"risk":"low","decision":"deny"}',
      '{"risk":"high","decision":"allow"}',
      '{"risk":"medium","decision":"allow","reason":"no"}',
      '{"decision":"allow"}',
      '{"risk":"medium","decision":"deny","reason":1}',
      '{"risk":"medium","decision":"deny","extra":true}',
      '{"risk":"medium","risk":"high","decision":"deny"}',
      "not json",
      "null",
      "[]",
    ];
    for (const text of illegal) {
      expect(() => parseAutoReviewDecision(text)).toThrow(/auto-review:/);
    }
  });

  it("names the three hard bans (low≠deny, high≠allow, allow≠reason)", () => {
    expect(AUTO_REVIEW_LEGAL_DECISION_SHAPES).toHaveLength(6);
    expect(() =>
      parseAutoReviewDecisionRecord({ risk: "low", decision: "deny" }),
    ).toThrow(/low forbids deny/);
    expect(() =>
      parseAutoReviewDecisionRecord({ risk: "high", decision: "allow" }),
    ).toThrow(/high forbids allow/);
    expect(() =>
      parseAutoReviewDecisionRecord({
        risk: "medium",
        decision: "allow",
        reason: "nope",
      }),
    ).toThrow(/allow forbids reason/);
  });

  it("fail-closes classifyAutoReview when reviewer emits illegal risk×decision", async () => {
    const cases: Array<{ text: string; ban: RegExp }> = [
      {
        text: '{"risk":"low","decision":"deny"}',
        ban: /low forbids deny/,
      },
      {
        text: '{"risk":"high","decision":"allow"}',
        ban: /high forbids allow/,
      },
      {
        text: '{"risk":"medium","decision":"allow","reason":"x"}',
        ban: /allow forbids reason/,
      },
    ];
    for (const { text, ban } of cases) {
      const failed = await classifyAutoReview(
        { toolName: "shell", args: { cmd: "echo" } },
        { env: {}, reviewer: () => text },
      );
      expect(failed.ok).toBe(false);
      expect(failed.classification.verdict).toBe("deny");
      expect(failed.classification.reason).toBe("classifier-error");
      expect(failed.error).toMatch(ban);
    }
  });

  it("enforces DSH contract on plugin/HTTP bodies that carry risk", async () => {
    expect(
      classificationFromClassifierBody({
        risk: "low",
        decision: "allow",
      }).verdict,
    ).toBe("allow");
    expect(() =>
      classificationFromClassifierBody({
        risk: "low",
        decision: "deny",
      }),
    ).toThrow(/low forbids deny/);

    // Legacy verdict-only bodies stay accepted without risk.
    expect(
      classificationFromClassifierBody({
        verdict: "ask",
        reason: "need human",
        confidence: 0.4,
      }),
    ).toEqual({
      verdict: "ask",
      reason: "need human",
      confidence: 0.4,
    });

    const illegalPlugin = await classifyAutoReview(
      { toolName: "shell", args: { cmd: "curl evil" } },
      {
        env: {},
        classifier: () =>
          ({ risk: "high", decision: "allow" }) as never,
      },
    );
    expect(illegalPlugin.ok).toBe(false);
    expect(illegalPlugin.classification.verdict).toBe("deny");
    expect(illegalPlugin.error).toMatch(/high forbids allow/);

    const illegalHttp = await classifyAutoReview(
      { toolName: "shell", args: { cmd: "rm -rf /" } },
      {
        env: {
          XRK_AUTO_REVIEW_CLASSIFIER_URL: "https://classifier.test/review",
        },
        fetchImpl: (async () =>
          new Response(
            JSON.stringify({ risk: "low", decision: "deny" }),
            { status: 200, headers: { "content-type": "application/json" } },
          )) as typeof fetch,
      },
    );
    expect(illegalHttp.ok).toBe(false);
    expect(illegalHttp.classifier).toBe("http");
    expect(illegalHttp.classification.verdict).toBe("deny");
    expect(illegalHttp.error).toMatch(/low forbids deny/);
  });

  it("builds a four-section user prompt from a tool payload", () => {
    const text = buildAutoReviewUserText({
      cwd: "/tmp/ws",
      toolName: "shell",
      args: { cmd: "ls" },
      description: "run a shell command",
      parameters: { type: "object" },
    });
    expect(text).toContain("ENVIRONMENT");
    expect(text).toContain('"cwd": "/tmp/ws"');
    expect(text).toContain("PENDING_ACTION");
    expect(text).toContain('"name": "shell"');
    expect(text).toContain('"description": "run a shell command"');
    expect(text).toContain('"parameters"');
    expect(text).toContain('"cmd": "ls"');
    expect(text).toContain("PROJECT_INSTRUCTIONS");
    expect(text).toContain("FILTERED_HISTORY");
    expect(text).toContain("FILTERED_HISTORY\n\n[]");
  });

  it("buildAutoReviewReviewSnapshot keeps cwd + schema without history", () => {
    const snap = buildAutoReviewReviewSnapshot({
      cwd: "/repo",
      name: "write_file",
      args: { path: "a.ts", content: "x" },
      description: "Write a file",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
      },
    });
    expect(snap).toEqual({
      cwd: "/repo",
      projectInstructions: [],
      history: [],
      action: {
        mode: "native",
        name: "write_file",
        description: "Write a file",
        parameters: {
          type: "object",
          properties: { path: { type: "string" } },
        },
        arguments: { path: "a.ts", content: "x" },
      },
    });
  });

  it("injects a reviewer and runs allow / deny; failures fail-closed deny", async () => {
    const allowed = await classifyAutoReview(
      { toolName: "read_file", args: { path: "a.ts" } },
      {
        env: {},
        reviewer: async (input) => {
          expect(input.policy).toBe(AUTO_REVIEW_POLICY);
          expect(input.userText).toContain("PENDING_ACTION");
          return '{"risk":"low","decision":"allow"}';
        },
      },
    );
    expect(allowed.ok).toBe(true);
    expect(allowed.classifier).toBe("session-llm");
    expect(allowed.classification.verdict).toBe("allow");
    expect(allowed.classification.reason).toBe("session-llm-allow");

    const denied = await classifyAutoReview(
      { toolName: "shell", args: { cmd: "rm -rf /" } },
      {
        env: {},
        classifierId: "fixture-llm",
        reviewer: () =>
          '{"risk":"high","decision":"deny","reason":"destructive"}',
      },
    );
    expect(denied.ok).toBe(true);
    expect(denied.classifier).toBe("fixture-llm");
    expect(denied.classification.verdict).toBe("deny");
    expect(denied.classification.reason).toBe("destructive");

    // Malformed reviewer JSON fail-closes to deny (DSH failed / Hermes hard deny).
    const failed = await classifyAutoReview(
      { toolName: "shell", args: { cmd: "echo hi" } },
      {
        env: {},
        reviewer: () => '{"risk":"low","decision":"deny"}',
      },
    );
    expect(failed.ok).toBe(false);
    expect(failed.classifier).toBe("session-llm");
    expect(failed.classification.verdict).toBe("deny");
    expect(failed.classification.reason).toBe("classifier-error");
    expect(failed.error).toMatch(/risk\/decision protocol/);
  });

  it("prefers HTTP URL over session LLM; session LLM over heuristic", () => {
    const httpWins = resolveAutoReviewClassifier({
      env: {},
      product: { classifierUrl: "http://product.test/review" },
      reviewer: () => '{"risk":"low","decision":"allow"}',
    });
    expect(httpWins.kind).toBe("http");

    const session = resolveAutoReviewClassifier({
      env: {},
      reviewer: () => '{"risk":"low","decision":"allow"}',
    });
    expect(session.kind).toBe("session-llm");

    const heuristic = resolveAutoReviewClassifier({ env: {} });
    expect(heuristic.kind).toBe("heuristic");
  });

  it("createSessionLlmAutoReviewClassifier parses via the injected reviewer", async () => {
    const run = createSessionLlmAutoReviewClassifier({
      reviewer: () => '{"risk":"medium","decision":"deny"}',
    });
    const classification = await run({ toolName: "write_file" });
    expect(classification.verdict).toBe("deny");
    expect(classification.reason).toBe("session-llm-deny");
  });

  it("createLlmStreamAutoReviewReviewer streams at temperature 0", async () => {
    const seen: unknown[] = [];
    const llm = {
      id: "fixture",
      async *stream(request: {
        readonly temperature?: number;
        readonly messages: readonly { role: string; content: string }[];
      }) {
        seen.push(request);
        yield { type: "text-delta" as const, index: 0, text: '{"risk":"low",' };
        yield {
          type: "text-delta" as const,
          index: 0,
          text: '"decision":"allow"}',
        };
        yield {
          type: "done" as const,
          content: '{"risk":"low","decision":"allow"}',
          finishReason: "stop" as const,
        };
      },
      async chat() {
        throw new Error("chat should not run when stream exists");
      },
    } as LlmAdapter;
    const reviewer = createLlmStreamAutoReviewReviewer(llm);
    const text = await reviewer({
      policy: AUTO_REVIEW_POLICY,
      userText: "PENDING_ACTION\n{}",
      payload: { toolName: "read_file" },
    });
    expect(text).toBe('{"risk":"low","decision":"allow"}');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ temperature: 0 });
    const messages = (seen[0] as { messages: { role: string }[] }).messages;
    expect(messages[0]?.role).toBe("system");
    expect(messages[1]?.role).toBe("user");

    const viaResolve = await classifyAutoReview(
      { toolName: "read_file" },
      { env: {}, resolveLlm: () => llm },
    );
    expect(viaResolve.ok).toBe(true);
    expect(viaResolve.classifier).toBe("session-llm");
    expect(viaResolve.classification.verdict).toBe("allow");
  });

  it("accepts reasoning then one JSON text block", async () => {
    const text = await readAutoReviewStreamText(
      (async function* (): AsyncIterable<LlmStreamEvent> {
        yield { type: "reasoning-delta", index: 0, text: "private" };
        yield { type: "reasoning-delta", index: 0, text: " thoughts" };
        yield {
          type: "text-delta",
          index: 1,
          text: '{"risk":"medium","decision":"deny"}',
        };
        yield {
          type: "done",
          content: '{"risk":"medium","decision":"deny"}',
          finishReason: "stop",
        };
      })(),
    );
    expect(text).toBe('{"risk":"medium","decision":"deny"}');
  });

  it("rejects late reasoning, tool-calls, and missing finish", async () => {
    await expect(
      readAutoReviewStreamText(
        (async function* (): AsyncIterable<LlmStreamEvent> {
          yield {
            type: "text-delta",
            index: 0,
            text: '{"risk":"low","decision":"allow"}',
          };
          yield { type: "reasoning-delta", index: 1, text: "late" };
          yield {
            type: "done",
            content: '{"risk":"low","decision":"allow"}',
            finishReason: "stop",
          };
        })(),
      ),
    ).rejects.toThrow(/reasoning blocks followed by exactly one text block/);

    await expect(
      readAutoReviewStreamText(
        (async function* (): AsyncIterable<LlmStreamEvent> {
          yield {
            type: "tool-call-delta",
            index: 0,
            id: "c1",
            name: "x",
            argumentsDelta: "{}",
          };
          yield { type: "done", content: "", finishReason: "stop" };
        })(),
      ),
    ).rejects.toThrow(/reasoning blocks followed by exactly one text block/);

    await expect(
      readAutoReviewStreamText(
        (async function* (): AsyncIterable<LlmStreamEvent> {
          yield {
            type: "text-delta",
            index: 0,
            text: '{"risk":"low","decision":"allow"}',
          };
        })(),
      ),
    ).rejects.toThrow(/no terminal finish/);
  });

  it("emits dedicated max-tokens and aborted failure messages", async () => {
    await expect(
      readAutoReviewStreamText(
        (async function* (): AsyncIterable<LlmStreamEvent> {
          yield {
            type: "text-delta",
            index: 0,
            text: '{"risk":"low","decision":"allow"}',
          };
          yield {
            type: "done",
            content: '{"risk":"low","decision":"allow"}',
            finishReason: "max-tokens",
          };
        })(),
      ),
    ).rejects.toThrow("auto-review: reviewer ended with max-tokens");

    const ac = new AbortController();
    ac.abort();
    await expect(
      readAutoReviewStreamText(
        (async function* (): AsyncIterable<LlmStreamEvent> {
          yield {
            type: "text-delta",
            index: 0,
            text: '{"risk":"low","decision":"allow"}',
          };
          yield {
            type: "done",
            content: '{"risk":"low","decision":"allow"}',
            finishReason: "stop",
          };
        })(),
        ac.signal,
      ),
    ).rejects.toThrow(/auto-review: reviewer ended with aborted UNKNOWN:/);

    await expect(
      readAutoReviewStreamText(
        (async function* (): AsyncIterable<LlmStreamEvent> {
          throw new DOMException("provider failed after cancellation", "AbortError");
        })(),
      ),
    ).rejects.toThrow(
      "auto-review: reviewer ended with aborted UNKNOWN: provider failed after cancellation",
    );
  });
});

/**
 * Loop checklist: one allow + one deny per live tier (HTTP · session-LLM),
 * plus illegal JSON / max-tokens fail-closed through {@link classifyAutoReview}.
 */
describe("HTTP / session-LLM allow·deny + fail-closed", () => {
  it("HTTP classifier: allow and deny", async () => {
    const allowed = await classifyAutoReview(
      { toolName: "read_file", args: { path: "ok.ts" } },
      {
        env: { XRK_AUTO_REVIEW_CLASSIFIER_URL: "http://classifier.test/review" },
        fetchImpl: async () =>
          new Response(
            JSON.stringify({ verdict: "allow", reason: "http-allow", confidence: 0.9 }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
    );
    expect(allowed).toMatchObject({
      ok: true,
      classifier: "http",
      classification: { verdict: "allow", reason: "http-allow" },
    });

    const denied = await classifyAutoReview(
      { toolName: "bash", args: { command: "rm -rf /" } },
      {
        env: { XRK_AUTO_REVIEW_CLASSIFIER_URL: "http://classifier.test/review" },
        fetchImpl: async () =>
          new Response(
            JSON.stringify({
              risk: "high",
              decision: "deny",
              reason: "http-deny",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
      },
    );
    expect(denied).toMatchObject({
      ok: true,
      classifier: "http",
      classification: { verdict: "deny", reason: "http-deny" },
    });
  });

  it("session-LLM: allow and deny", async () => {
    const allowed = await classifyAutoReview(
      { toolName: "read_file", args: { path: "a.ts" } },
      {
        env: {},
        reviewer: () => '{"risk":"low","decision":"allow"}',
      },
    );
    expect(allowed).toMatchObject({
      ok: true,
      classifier: "session-llm",
      classification: { verdict: "allow", reason: "session-llm-allow" },
    });

    const denied = await classifyAutoReview(
      { toolName: "bash", args: { command: "rm -rf /" } },
      {
        env: {},
        reviewer: () =>
          '{"risk":"high","decision":"deny","reason":"llm-deny"}',
      },
    );
    expect(denied).toMatchObject({
      ok: true,
      classifier: "session-llm",
      classification: { verdict: "deny", reason: "llm-deny" },
    });
  });

  it("illegal JSON fail-closes deny for HTTP and session-LLM", async () => {
    const httpBad = await classifyAutoReview(
      { toolName: "read_file" },
      {
        env: { XRK_AUTO_REVIEW_CLASSIFIER_URL: "http://classifier.test/review" },
        fetchImpl: async () =>
          new Response("not-json{{{", {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      },
    );
    expect(httpBad.ok).toBe(false);
    expect(httpBad.classifier).toBe("http");
    expect(httpBad.classification.verdict).toBe("deny");
    expect(httpBad.classification.reason).toBe("classifier-error");

    const llmBad = await classifyAutoReview(
      { toolName: "bash", args: { command: "echo" } },
      {
        env: {},
        reviewer: () => "definitely not json",
      },
    );
    expect(llmBad.ok).toBe(false);
    expect(llmBad.classifier).toBe("session-llm");
    expect(llmBad.classification.verdict).toBe("deny");
    expect(llmBad.classification.reason).toBe("classifier-error");
    expect(llmBad.error).toMatch(/not valid JSON/);
  });

  it("max-tokens from session LLM stream fail-closes deny via classifyAutoReview", async () => {
    const llm = {
      id: "fixture-max-tokens",
      async *stream() {
        yield {
          type: "text-delta" as const,
          index: 0,
          text: '{"risk":"low","decision":"allow"}',
        };
        yield {
          type: "done" as const,
          content: '{"risk":"low","decision":"allow"}',
          finishReason: "max-tokens" as const,
        };
      },
      async chat() {
        throw new Error("chat unused");
      },
    } as LlmAdapter;

    const failed = await classifyAutoReview(
      { toolName: "read_file", args: { path: "a.ts" } },
      {
        env: {},
        resolveLlm: () => llm,
      },
    );
    expect(failed.ok).toBe(false);
    expect(failed.classifier).toBe("session-llm");
    expect(failed.classification.verdict).toBe("deny");
    expect(failed.classification.reason).toBe("classifier-error");
    expect(failed.error).toMatch(/max-tokens/);
  });
});
