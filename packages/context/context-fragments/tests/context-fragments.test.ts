import { describe, expect, it } from "vitest";
import {
  appendContextFragments,
  createAdditionalContextFragment,
  createContextFragmentPipeline,
  createGuardianReviewProvider,
  createRecapFragment,
  createStaticAdditionalContextProvider,
  formatAdditionalContextBody,
  fragmentsToPrepareContexts,
  truncateMiddle,
} from "../src/index.js";
import { createMemorySessionStore } from "@xrkseek/core-session";

describe("context-fragments", () => {
  it("formats marked additional_context bodies", () => {
    const body = formatAdditionalContextBody("env", "hello");
    expect(body.truncated).toBe(false);
    expect(body.text).toBe("<external_env>hello</external_env>");
  });

  it("truncateMiddle preserves head and tail", () => {
    const out = truncateMiddle("abcdefghij", 7);
    expect(out.truncated).toBe(true);
    expect(out.text.length).toBe(7);
    expect(out.text).toContain("…");
  });

  it("collects turn-start providers under budget by priority", async () => {
    const pipeline = createContextFragmentPipeline({ budgetChars: 40 });
    pipeline.register(
      createStaticAdditionalContextProvider({
        id: "low",
        phase: "turn-start",
        priority: 1,
        entries: [{ key: "a", value: "AAAAAAAAAA" }],
      }),
    );
    pipeline.register(
      createStaticAdditionalContextProvider({
        id: "high",
        phase: "turn-start",
        priority: 10,
        entries: [{ key: "b", value: "BBBBBBBBBB" }],
      }),
    );
    const out = await pipeline.collect("turn-start", {
      sessionId: "s1",
      turnId: "t1",
    });
    expect(out.fragments[0]?.id).toBe("additional_context.b");
    expect(out.totalChars).toBeLessThanOrEqual(40);
  });

  it("appendContextFragments writes user/message with context-fragment source", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const pipeline = createContextFragmentPipeline();
    pipeline.register(
      createStaticAdditionalContextProvider({
        id: "static",
        phase: "turn-start",
        entries: [{ key: "note", value: "ping" }],
      }),
    );
    const result = await appendContextFragments({
      store,
      sessionId: session.id,
      turnId: "turn-1",
      now: () => 1,
      pipeline,
      phase: "turn-start",
    });
    expect(result.fragments).toHaveLength(1);
    const events = store.get(session.id).events;
    const msg = events.find((e) => e.type === "user/message");
    expect(msg?.type).toBe("user/message");
    if (msg?.type !== "user/message") throw new Error("expected user/message");
    expect(msg.source).toMatchObject({
      kind: "context-fragment",
      form: "fragment",
      fragmentId: "additional_context.note",
      fragmentKind: "additional_context",
    });
    expect(String(msg.content)).toContain("<external_note>ping</external_note>");
  });

  it("fragmentsToPrepareContexts maps collect results", () => {
    const frag = createAdditionalContextFragment({
      key: "k",
      value: "v",
      phase: "user-message",
    });
    const contexts = fragmentsToPrepareContexts({
      fragments: [frag],
      truncations: [],
      totalChars: frag.text.length,
      budgetChars: 8000,
    });
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.source.kind).toBe("context-fragment");
  });

  it("createRecapFragment prefixes catch-up text", () => {
    const frag = createRecapFragment({ history: "did stuff" });
    expect(frag.kind).toBe("recap");
    expect(frag.text).toMatch(/Catch-up context/);
    expect(frag.text).toContain("did stuff");
  });

  it("createGuardianReviewProvider emits turn-start advisory fragment", async () => {
    const pipeline = createContextFragmentPipeline({ budgetChars: 4000 });
    pipeline.register(createGuardianReviewProvider());
    const out = await pipeline.collect("turn-start", {
      sessionId: "s1",
      turnId: "t1",
    });
    expect(out.fragments).toHaveLength(1);
    expect(out.fragments[0]?.id).toBe("additional_context.guardian_review");
    expect(out.fragments[0]?.text).toMatch(/Guardian review/);
    expect(out.fragments[0]?.text).toMatch(/untrusted/);
    const post = await pipeline.collect("post-tool", {
      sessionId: "s1",
      turnId: "t1",
    });
    expect(post.fragments).toHaveLength(0);
  });
});
