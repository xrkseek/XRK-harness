import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createMemorySessionStore } from "@xrkseek/core-session";
import {
  createToolPipeline,
  createToolRegistry,
  runToolDetailed,
} from "@xrkseek/core-tools";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { executeFaceCommand } from "../src/slash.js";
import type { FaceDrain } from "../src/context.js";
import {
  approvePendingAutoReview,
  isAutoReviewPendingApproval,
} from "../src/auto-review-approve.js";

function drain(): FaceDrain {
  return {
    wake() {},
    async cancel() {},
    isActive() {
      return false;
    },
  };
}

async function isolatedRuntime(store = createMemorySessionStore()) {
  const root = await mkdtemp(path.join(tmpdir(), "xrk-face-ar-approve-"));
  return createFaceRuntime({
    store,
    workspaceRoot: root,
    productDir: root,
    drain: drain(),
    resolveAgent: async () => {
      throw new Error("unused");
    },
  });
}

describe("auto-review approve pending", () => {
  it("recognizes Auto review audit reasons", () => {
    expect(
      isAutoReviewPendingApproval({
        reason: 'Auto review denied tool "bash": destructive-pattern',
      }),
    ).toBe(true);
    expect(isAutoReviewPendingApproval({ reason: "need human" })).toBe(false);
  });

  it("/auto-review approve 1 responds allow on pending Auto-review ask", async () => {
    const store = createMemorySessionStore();
    const runtime = await isolatedRuntime(store);
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      agentPreset: "minimal",
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const pipeline = createToolPipeline();
    pipeline.setApprovalHandler(runtime.approvals.handlerFor(sessionId));
    const reg = createToolRegistry();
    const body = vi.fn(async () => ({ content: "ran" }));
    reg.register({
      name: "bash",
      description: "d",
      parameters: {},
      execute: body,
    });
    pipeline.onPre(async () => ({
      action: "ask",
      reason: 'Auto review denied tool "bash": destructive-pattern',
      error: {
        name: "AutoReviewDeniedError",
        code: "AUTO_REVIEW_DENIED",
        reason: "destructive-pattern",
      },
    }));

    const runPromise = runToolDetailed({
      registry: reg,
      call: { id: "call_ar", name: "bash", arguments: { command: "rm -rf /" } },
      pipeline,
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(runtime.approvals.listPending(sessionId)).toHaveLength(1);

    const execution = await executeFaceCommand(
      runtime,
      sessionId,
      "/auto-review approve 1",
    );
    expect(execution?.result.kind).toBe("success");
    expect(execution?.result.text).toMatch(
      /allowed pending auto-review for tool "bash"/,
    );

    const detailed = await runPromise;
    expect(body).toHaveBeenCalled();
    expect(detailed.result.content).toBe("ran");
    expect(runtime.approvals.listPending(sessionId)).toHaveLength(0);
  });

  it("notes when no pending Auto-review approval exists", async () => {
    const store = createMemorySessionStore();
    const runtime = await isolatedRuntime(store);
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      agentPreset: "minimal",
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const outcome = approvePendingAutoReview(runtime.approvals, sessionId, 0);
    expect(outcome.kind).toBe("missing");
    expect(outcome.note).toMatch(/no pending auto-review approval/);

    const execution = await executeFaceCommand(
      runtime,
      sessionId,
      "/auto-review approve",
    );
    expect(execution?.result.text).toMatch(/no pending auto-review approval/);
  });
});
