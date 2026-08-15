import { describe, expect, it, vi } from "vitest";
import {
  addAdditionalContext,
  createPolicyToolCallGuard,
  createToolPipeline,
  createToolRegistry,
  createWriteIntentGuard,
  foldGuardVerdicts,
  freezeToolResult,
  runToolDetailed,
  transientError,
} from "../src/index.js";

describe("foldGuardVerdicts", () => {
  it("keeps deny over later allow", () => {
    expect(foldGuardVerdicts(["allow", "deny", "allow"])).toBe("deny");
  });

  it("abstain does not change", () => {
    expect(foldGuardVerdicts(["abstain", "allow", "abstain"])).toBe("allow");
  });
});

describe("tool pipeline", () => {
  it("rewrites args in pre", async () => {
    const reg = createToolRegistry();
    reg.register({
      name: "echo",
      description: "echo",
      parameters: { type: "object" },
      async execute(args) {
        return { content: String((args as { text: string }).text) };
      },
    });
    const pipeline = createToolPipeline();
    pipeline.onPre(async () => ({
      action: "continue",
      args: { text: "rewritten" },
    }));
    const out = await runToolDetailed({
      registry: reg,
      call: { id: "1", name: "echo", arguments: { text: "orig" } },
      pipeline,
    });
    expect(out.result.content).toBe("rewritten");
  });

  it("pre deny skips body and returns error result", async () => {
    const body = vi.fn(async () => ({ content: "nope" }));
    const reg = createToolRegistry();
    reg.register({
      name: "x",
      description: "x",
      parameters: {},
      execute: body,
    });
    const pipeline = createToolPipeline();
    pipeline.onPre(async () => ({ action: "deny", reason: "blocked" }));
    const out = await runToolDetailed({
      registry: reg,
      call: { id: "1", name: "x", arguments: {} },
      pipeline,
    });
    expect(body).not.toHaveBeenCalled();
    expect(out.skippedBody).toBe(true);
    expect(out.result.isError).toBe(true);
    expect(out.result.content).toBe("blocked");
  });

  it("pre ask uses approval hook", async () => {
    const body = vi.fn(async () => ({ content: "ok" }));
    const reg = createToolRegistry();
    reg.register({
      name: "x",
      description: "x",
      parameters: {},
      execute: body,
    });
    const pipeline = createToolPipeline();
    pipeline.onPre(async () => ({ action: "ask", reason: "sure?" }));
    pipeline.setApprovalHandler(async () => true);
    const out = await runToolDetailed({
      registry: reg,
      call: { id: "1", name: "x", arguments: {} },
      pipeline,
    });
    expect(body).toHaveBeenCalled();
    expect(out.result.content).toBe("ok");
  });

  it("guard deny means body zero calls", async () => {
    const body = vi.fn(async () => ({ content: "nope" }));
    const reg = createToolRegistry();
    reg.register({
      name: "danger",
      description: "d",
      parameters: {},
      execute: body,
    });
    const pipeline = createToolPipeline();
    pipeline.onGuard(createPolicyToolCallGuard(["danger"]));
    pipeline.onGuard(() => "allow"); // cannot upgrade deny
    const out = await runToolDetailed({
      registry: reg,
      call: { id: "1", name: "danger", arguments: {} },
      pipeline,
    });
    expect(body).not.toHaveBeenCalled();
    expect(out.skippedBody).toBe(true);
    expect(out.result.isError).toBe(true);
  });

  it("write-intent denies edit without prior read", async () => {
    const body = vi.fn(async () => ({ content: "wrote" }));
    const reg = createToolRegistry();
    reg.register({
      name: "apply_edit",
      description: "e",
      parameters: {},
      execute: body,
    });
    const pipeline = createToolPipeline();
    pipeline.onGuard(
      createWriteIntentGuard({
        hasRead: () => false,
      }),
    );
    const out = await runToolDetailed({
      registry: reg,
      call: {
        id: "1",
        name: "apply_edit",
        arguments: { path: "a.txt", content: "x" },
      },
      pipeline,
    });
    expect(body).not.toHaveBeenCalled();
    expect(out.result.isError).toBe(true);
  });

  it("retries transient errors up to maxRetries", async () => {
    let n = 0;
    const reg = createToolRegistry();
    reg.register({
      name: "flaky",
      description: "f",
      parameters: {},
      async execute() {
        n += 1;
        if (n < 3) throw transientError("again");
        return { content: "done" };
      },
    });
    const out = await runToolDetailed({
      registry: reg,
      call: { id: "1", name: "flaky", arguments: {} },
      maxRetries: 2,
    });
    expect(n).toBe(3);
    expect(out.result.content).toBe("done");
  });

  it("normalizes thrown errors to isError result", async () => {
    const reg = createToolRegistry();
    reg.register({
      name: "boom",
      description: "b",
      parameters: {},
      async execute() {
        throw new Error("kaboom");
      },
    });
    const out = await runToolDetailed({
      registry: reg,
      call: { id: "1", name: "boom", arguments: {} },
    });
    expect(out.result.isError).toBe(true);
    expect(out.result.content).toBe("kaboom");
  });

  it("post can replace and finalize only edits content", async () => {
    const reg = createToolRegistry();
    reg.register({
      name: "echo",
      description: "e",
      parameters: {},
      async execute() {
        return { content: "raw" };
      },
    });
    const pipeline = createToolPipeline();
    pipeline.onPost(async () => ({
      action: "replace",
      content: "replaced",
    }));
    pipeline.onFinalize(async () => "finalized");
    const out = await runToolDetailed({
      registry: reg,
      call: { id: "1", name: "echo", arguments: {} },
      pipeline,
    });
    expect(out.result.content).toBe("finalized");
    expect(out.result.isError).toBeUndefined();
  });

  it("freezes result outcome", () => {
    const frozen = freezeToolResult({
      toolCallId: "1",
      name: "x",
      content: "c",
    });
    expect(() => {
      (frozen as { content: string }).content = "mutate";
    }).toThrow();
  });

  it("records full stage order snapshot", async () => {
    const reg = createToolRegistry();
    reg.register({
      name: "echo",
      description: "e",
      parameters: {},
      async execute() {
        return { content: "ok" };
      },
    });
    const pipeline = createToolPipeline();
    const spy: string[] = [];
    pipeline.onPre(async (ctx) => {
      spy.push(`pre:${ctx.stage}`);
      return { action: "continue", args: ctx.args };
    });
    pipeline.onGuard(() => {
      spy.push("guard");
      return "abstain";
    });
    pipeline.onExecute(async (ctx, next) => {
      spy.push("exec-before");
      await next();
      spy.push("exec-after");
    });
    pipeline.onPost(async () => {
      spy.push("post");
      return { action: "accept" };
    });
    pipeline.onFinalize(async (ctx) => {
      spy.push("finalize");
      return ctx.result?.content ?? "";
    });
    const out = await runToolDetailed({
      registry: reg,
      call: { id: "1", name: "echo", arguments: {} },
      pipeline,
    });
    expect(out.stages).toEqual([
      "pre",
      "guards",
      "execute",
      "post",
      "finalize",
      "bound",
      "result",
    ]);
    expect(spy).toEqual([
      "pre:pre",
      "guard",
      "exec-before",
      "exec-after",
      "post",
      "finalize",
    ]);
  });

  it("collects additionalContexts FIFO for batch", async () => {
    const reg = createToolRegistry();
    reg.register({
      name: "echo",
      description: "e",
      parameters: {},
      async execute() {
        return { content: "ok" };
      },
    });
    const pipeline = createToolPipeline();
    pipeline.onPost(async (ctx) => {
      addAdditionalContext(ctx, "ctx-a");
      addAdditionalContext(ctx, "ctx-b");
      return { action: "accept" };
    });
    const out = await runToolDetailed({
      registry: reg,
      call: { id: "1", name: "echo", arguments: {} },
      pipeline,
    });
    expect(out.additionalContexts).toEqual(["ctx-a", "ctx-b"]);
  });
});
