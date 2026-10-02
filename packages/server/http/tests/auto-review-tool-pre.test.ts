import { describe, expect, it } from "vitest";
import {
  AUTO_REVIEW_DENIED_CODE,
  AUTO_REVIEW_DENIED_ERROR_NAME,
  buildAutoReviewToolPayload,
  createAutoReviewToolPre,
  sessionPermissionPresetIsAuto,
} from "../src/dsh-compat/auto-review-tool-pre.js";
import type { ToolPipelineContext } from "@xrkseek/core-tools";
import type { SessionEvent, ToolCall } from "@xrkseek/protocol";

function ctx(
  name: string,
  args: Record<string, unknown> = {},
  definition?: {
    readonly description: string;
    readonly parameters: Record<string, unknown>;
  },
): ToolPipelineContext {
  const call = { id: "c1", name, arguments: args } as ToolCall;
  return {
    call,
    args,
    ...(definition
      ? {
          definition: {
            name,
            description: definition.description,
            parameters: definition.parameters,
          },
        }
      : {
          definition: {
            name,
            description: "",
            parameters: {},
          },
        }),
    stage: "pre",
    skippedBody: false,
    additionalContexts: [],
    safetyNotices: [],
    metrics: { calls: 0, retries: 0 },
    toolEvents: [],
  };
}

/** Unit tests that exercise the classifier assume Auto + Settings on. */
const autoSession = {
  isEnabled: () => true,
  resolvePermissionPreset: () => "auto" as const,
};

describe("createAutoReviewToolPre", () => {
  it("no-ops when Settings master switch is off (even on Auto)", async () => {
    const pre = createAutoReviewToolPre({
      ...autoSession,
      isEnabled: () => false,
      classifier: () => ({
        verdict: "deny",
        reason: "should-not-run",
        confidence: 1,
      }),
    });
    const outcome = await pre(ctx("bash", { command: "rm -rf /" }));
    expect(outcome).toEqual({ action: "continue", args: { command: "rm -rf /" } });
  });

  it("no-ops when session preset is not auto (Settings on is not enough)", async () => {
    let classified = 0;
    const pre = createAutoReviewToolPre({
      isEnabled: () => true,
      resolvePermissionPreset: () => "workspace-write",
      classifier: () => {
        classified += 1;
        return { verdict: "deny", reason: "nope", confidence: 1 };
      },
    });
    expect(await pre(ctx("bash", { command: "rm -rf /" }))).toEqual({
      action: "continue",
      args: { command: "rm -rf /" },
    });
    expect(classified).toBe(0);

    const fromEvents = createAutoReviewToolPre({
      isEnabled: () => true,
      resolveSessionEvents: () =>
        [
          {
            type: "permission/preset",
            seq: 1,
            time: 1,
            preset: "danger-full-access",
          },
        ] as SessionEvent[],
      classifier: () => {
        classified += 1;
        return { verdict: "deny", reason: "nope", confidence: 1 };
      },
    });
    expect(await fromEvents(ctx("bash"))).toMatchObject({ action: "continue" });
    expect(classified).toBe(0);
  });

  it("runs only when folded permission/preset is auto", async () => {
    const pre = createAutoReviewToolPre({
      isEnabled: () => true,
      resolveSessionEvents: () =>
        [
          {
            type: "permission/preset",
            seq: 1,
            time: 1,
            preset: "auto",
          },
        ] as SessionEvent[],
      classifier: () => ({
        verdict: "allow",
        reason: "ok",
        confidence: 1,
      }),
    });
    expect(await pre(ctx("read_file", { path: "a.ts" }))).toEqual({
      action: "continue",
      args: { path: "a.ts" },
    });
    expect(
      sessionPermissionPresetIsAuto([
        {
          type: "permission/preset",
          seq: 1,
          time: 1,
          preset: "auto",
        } as SessionEvent,
      ]),
    ).toBe(true);
    expect(sessionPermissionPresetIsAuto(undefined)).toBe(false);
  });

  it("maps deny to ask by default with English audit + localized displayReason", async () => {
    const deny = createAutoReviewToolPre({
      ...autoSession,
      classifier: () => ({
        verdict: "deny",
        reason: "destructive-pattern",
        confidence: 0.9,
      }),
      locale: () => "zh",
    });
    expect(await deny(ctx("bash", { command: "x" }))).toEqual({
      action: "defer-ask",
      reason: 'Auto review denied tool "bash": destructive-pattern',
      displayReason: {
        en: "Auto review denied this call: destructive-pattern",
        zh: "Auto review 拒绝了此调用：匹配到破坏性命令模式",
      },
      error: {
        name: AUTO_REVIEW_DENIED_ERROR_NAME,
        code: AUTO_REVIEW_DENIED_CODE,
        reason: "destructive-pattern",
      },
    });
  });

  it("auto preset + default heuristic deny → ask (Face approval)", async () => {
    // Real heuristic (no injected classifier): rm -rf matches destructive-pattern.
    // Auto preset keeps approval ask → defer-ask, not final deny.
    const pre = createAutoReviewToolPre({
      ...autoSession,
      env: {},
    });
    const outcome = await pre(ctx("bash", { command: "rm -rf /tmp/demo" }));
    expect(outcome).toMatchObject({
      action: "defer-ask",
      error: {
        name: AUTO_REVIEW_DENIED_ERROR_NAME,
        code: AUTO_REVIEW_DENIED_CODE,
        reason: "destructive-pattern",
      },
    });
    if (outcome.action !== "defer-ask") throw new Error("expected defer-ask");
    expect(outcome.reason).toContain("destructive-pattern");
    expect(outcome.displayReason?.en).toContain("destructive-pattern");
  });

  it("approval never (resolveDenyAction deny) → final AUTO_REVIEW_DENIED", async () => {
    // Host wires resolveDenyAction from effectiveApprovalPolicy === never.
    const pre = createAutoReviewToolPre({
      ...autoSession,
      env: {},
      resolveDenyAction: () => "deny",
    });
    const outcome = await pre(ctx("bash", { command: "rm -rf /" }));
    expect(outcome).toEqual({
      action: "deny",
      reason: 'Auto review rejected tool "bash"; its body was not executed',
      error: {
        name: AUTO_REVIEW_DENIED_ERROR_NAME,
        code: AUTO_REVIEW_DENIED_CODE,
        reason: "destructive-pattern",
      },
    });
  });

  it("keeps final deny when resolveDenyAction returns deny", async () => {
    const deny = createAutoReviewToolPre({
      ...autoSession,
      resolveDenyAction: () => "deny",
      classifier: () => ({
        verdict: "deny",
        reason: "destructive-pattern",
        confidence: 0.9,
      }),
      locale: () => "zh",
    });
    expect(await deny(ctx("bash", { command: "x" }))).toEqual({
      action: "deny",
      reason: 'Auto review rejected tool "bash"; its body was not executed',
      error: {
        name: AUTO_REVIEW_DENIED_ERROR_NAME,
        code: AUTO_REVIEW_DENIED_CODE,
        reason: "destructive-pattern",
      },
    });
  });

  it("maps ask / allow when Auto + Settings on", async () => {
    const ask = createAutoReviewToolPre({
      ...autoSession,
      classifier: () => ({
        verdict: "ask",
        reason: "sensitive-tool",
        confidence: 0.7,
      }),
    });
    expect(await ask(ctx("bash"))).toEqual({
      action: "defer-ask",
      reason: 'Auto review denied tool "bash": sensitive-tool',
      displayReason: {
        en: "Auto review denied this call: sensitive-tool",
        zh: "Auto review 拒绝了此调用：敏感工具，需确认",
      },
      error: {
        name: AUTO_REVIEW_DENIED_ERROR_NAME,
        code: AUTO_REVIEW_DENIED_CODE,
        reason: "sensitive-tool",
      },
    });

    const allow = createAutoReviewToolPre({
      ...autoSession,
      classifier: () => ({
        verdict: "allow",
        reason: "heuristic-pass",
        confidence: 0.5,
      }),
    });
    const args = { path: "a.ts" };
    expect(await allow(ctx("read_file", args))).toEqual({
      action: "continue",
      args,
    });
  });

  it("skips outer run_code transport; reviews PTC inner once with ptc-inner mode", async () => {
    let seen: Record<string, unknown> | undefined;
    const pre = createAutoReviewToolPre({
      ...autoSession,
      classifier: (payload) => {
        seen = payload;
        return { verdict: "allow", reason: "ok", confidence: 1 };
      },
    });

    // Outer Code Mode / PTC transport — DSH does not review run_code itself.
    expect(
      await pre(ctx("run_code", { source: "await tools.echo({ text: 'x' })" })),
    ).toEqual({
      action: "continue",
      args: { source: "await tools.echo({ text: 'x' })" },
    });
    expect(seen).toBeUndefined();

    // Nested tools.* re-entry under run_code (parentCallId set by code-runtime).
    const inner = ctx("echo_tool", { text: "x" });
    (inner as { parentCallId?: string }).parentCallId = "outer-run-code";
    expect(await pre(inner)).toEqual({
      action: "continue",
      args: { text: "x" },
    });
    expect(seen?.mode).toBe("ptc-inner");
    expect(seen?.toolName).toBe("echo_tool");
  });

  it("asks (default) when the classifier fails technically", async () => {
    // Illegal risk×decision (low+deny) → !ok / classifier-error.
    const pre = createAutoReviewToolPre({
      ...autoSession,
      resolveDenyAction: () => "deny", // must not apply to technical failures
      reviewer: () => '{"risk":"low","decision":"deny"}',
    });
    const outcome = await pre(ctx("bash", { command: "echo" }));
    expect(outcome.action).toBe("defer-ask");
    if (outcome.action !== "defer-ask") throw new Error("expected defer-ask");
    expect(outcome.error?.code).toBe(AUTO_REVIEW_DENIED_CODE);
    expect(outcome.reason).toMatch(/Auto review denied tool "bash"/);
    expect(outcome.reason).toMatch(/classifier-error/);
    expect(outcome.displayReason?.en).toMatch(/classifier-error/);
  });

  it("hard-denies on classifier failure when onClassifierError is deny", async () => {
    const pre = createAutoReviewToolPre({
      ...autoSession,
      onClassifierError: "deny",
      resolveDenyAction: () => "ask",
      reviewer: () => '{"risk":"low","decision":"deny"}',
    });
    const outcome = await pre(ctx("bash", { command: "echo" }));
    expect(outcome.action).toBe("deny");
    if (outcome.action !== "deny") throw new Error("expected deny");
    expect(outcome.error?.code).toBe(AUTO_REVIEW_DENIED_CODE);
    expect(outcome.reason).toMatch(/Auto review rejected tool "bash"/);
    expect(outcome.error?.reason).toMatch(/classifier-error/);
  });

  it("passes cwd + schema + filtered history into the reviewer prompt", async () => {
    let seenPayload: Record<string, unknown> | undefined;
    let seenUserText = "";
    const pre = createAutoReviewToolPre({
      ...autoSession,
      resolveCwd: () => "/workspace/demo",
      resolveSessionEvents: () =>
        [
          {
            type: "permission/preset",
            seq: 0,
            time: 0,
            preset: "auto",
          },
          {
            type: "user/message",
            seq: 1,
            time: 1,
            turnId: "t1",
            content: "Ship it",
            source: { kind: "user" },
          },
          {
            type: "user/message",
            seq: 2,
            time: 2,
            turnId: "t1",
            content: "Follow AGENTS.md",
            source: {
              kind: "agent-instructions",
              form: "instructions",
              changes: [{ action: "set" }],
            },
          },
          {
            type: "assistant/message",
            seq: 3,
            time: 3,
            turnId: "t1",
            stepId: "s1",
            content: "assistant prose excluded",
            reasoning: "reasoning excluded",
          },
          {
            type: "tool/result",
            seq: 4,
            time: 4,
            turnId: "t1",
            stepId: "s1",
            result: {
              toolCallId: "c1",
              name: "shell",
              content: "tool result excluded",
            },
          },
        ] as SessionEvent[],
      reviewer: async (input) => {
        seenPayload = input.payload;
        seenUserText = input.userText;
        return '{"risk":"low","decision":"allow"}';
      },
    });
    const outcome = await pre(
      ctx(
        "shell",
        { command: "ls" },
        {
          description: "Run a shell command",
          parameters: {
            type: "object",
            properties: { command: { type: "string" } },
          },
        },
      ),
    );
    expect(outcome.action).toBe("continue");
    expect(seenPayload?.history).toEqual([
      {
        kind: "user-message",
        role: "human-instruction",
        sourceKind: "user",
        content: [{ type: "text", text: "Ship it" }],
      },
    ]);
    expect(seenPayload?.projectInstructions).toEqual([
      {
        kind: "user-message",
        role: "constraint",
        sourceKind: "agent-instructions",
        content: [{ type: "text", text: "Follow AGENTS.md" }],
      },
    ]);
    expect(seenUserText).toContain("PROJECT_INSTRUCTIONS");
    expect(seenUserText).toContain("Follow AGENTS.md");
    expect(seenUserText).toContain("FILTERED_HISTORY");
    expect(seenUserText).toContain("Ship it");
    expect(seenUserText).not.toContain("assistant prose excluded");
    expect(seenUserText).not.toContain("reasoning excluded");
    expect(seenUserText).not.toContain("tool result excluded");
  });
  it("cancels review when lifecycle is not accepting (dispose)", async () => {
    const lifeAbort = new AbortController();
    lifeAbort.abort(new Error("disposed"));
    const pre = createAutoReviewToolPre({
      ...autoSession,
      lifecycle: {
        signal: lifeAbort.signal,
        isAccepting: () => false,
        track() {},
      },
      classifier: () => ({
        verdict: "allow",
        reason: "should-not-run",
        confidence: 1,
      }),
    });
    expect(await pre(ctx("bash", { command: "x" }))).toMatchObject({
      action: "deny",
      error: { name: "AbortError", code: "ABORTED_BEFORE_DISPATCH" },
    });
    expect((await pre(ctx("bash", { command: "x" }))).error).not.toMatchObject({
      code: AUTO_REVIEW_DENIED_CODE,
    });
  });

  it("caller abort mid-classify returns ABORTED_BEFORE_DISPATCH, not deny/ask", async () => {
    const caller = new AbortController();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const pre = createAutoReviewToolPre({
      ...autoSession,
      classifier: async () => {
        entered.resolve();
        await release.promise;
        return {
          verdict: "deny",
          reason: "should-become-cancel",
          confidence: 1,
        };
      },
    });
    const pending = pre({
      ...ctx("bash", { command: "x" }),
      signal: caller.signal,
    });
    await entered.promise;
    caller.abort(new Error("caller stopped"));
    release.resolve();
    const outcome = await pending;
    expect(outcome).toMatchObject({
      action: "deny",
      error: { name: "AbortError", code: "ABORTED_BEFORE_DISPATCH" },
    });
    expect(outcome.error).not.toMatchObject({ code: AUTO_REVIEW_DENIED_CODE });
    expect(outcome).not.toMatchObject({ action: "ask" });
  });

  it("lifecycle abort after classifier allow still cancels (DSH dispose race)", async () => {
    const lifeAbort = new AbortController();
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const pre = createAutoReviewToolPre({
      ...autoSession,
      lifecycle: {
        signal: lifeAbort.signal,
        isAccepting: () => !lifeAbort.signal.aborted,
        track() {},
      },
      classifier: async () => {
        entered.resolve();
        await release.promise;
        return {
          verdict: "allow",
          reason: "too-late",
          confidence: 1,
        };
      },
    });
    const pending = pre(ctx("bash", { command: "x" }));
    await entered.promise;
    lifeAbort.abort(new Error("disposed"));
    release.resolve();
    expect(await pending).toMatchObject({
      action: "deny",
      error: { name: "AbortError", code: "ABORTED_BEFORE_DISPATCH" },
    });
  });
});

describe("buildAutoReviewToolPayload", () => {
  it("packs tool name, args, and optional cwd", () => {
    expect(
      buildAutoReviewToolPayload(
        {
          call: { name: "shell" },
          args: { command: "ls" },
          definition: {
            name: "shell",
            description: "Run",
            parameters: { type: "object" },
          },
        },
        { cwd: "/tmp" },
      ),
    ).toMatchObject({
      toolName: "shell",
      name: "shell",
      args: { command: "ls" },
      cwd: "/tmp",
    });
  });
});
