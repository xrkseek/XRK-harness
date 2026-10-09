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
import { PATH_OVERREACH_TIMEOUT_MS } from "../src/approvals.js";
import { SessionPathAllowlist } from "../src/path-allowlist.js";
import type { FaceDrain } from "../src/context.js";

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
  const root = await mkdtemp(path.join(tmpdir(), "xrk-face-path-al-"));
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

describe("SessionPathAllowlist", () => {
  it("lists parent permanent paths for inherited children", () => {
    const al = new SessionPathAllowlist();
    al.addPermanent("parent", "/tmp/shared.txt", { persist: false });
    al.inherit("child", "parent");
    al.addOnce("child", "/tmp/once.txt");
    expect(al.list("child")).toEqual(
      expect.arrayContaining([
        path.resolve("/tmp/shared.txt"),
        path.resolve("/tmp/once.txt"),
      ]),
    );
    expect(al.list("parent")).toEqual([path.resolve("/tmp/shared.txt")]);
  });

  it("persists whitelist to path/allowlisted events", () => {
    const store = createMemorySessionStore();
    store.create("s1");
    const al = new SessionPathAllowlist();
    al.addPermanent("s1", "/tmp/w.txt", { persist: true, store });
    expect(
      store.get("s1").events.some(
        (e) => e.type === "path/allowlisted" && e.path === path.resolve("/tmp/w.txt"),
      ),
    ).toBe(true);
  });
});

describe("path-overreach approval", () => {
  it("whitelist outcome grants permanent path and allows tool", async () => {
    const store = createMemorySessionStore();
    const runtime = await isolatedRuntime(store);
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {
      agentPreset: "minimal",
    });
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    const outside = path.resolve(tmpdir(), "xrk-overreach-wl.txt");

    const pipeline = createToolPipeline();
    pipeline.setApprovalHandler(runtime.approvals.handlerFor(sessionId));
    const reg = createToolRegistry();
    const body = vi.fn(async () => ({ content: "wrote" }));
    reg.register({
      name: "write_file",
      description: "w",
      parameters: {},
      execute: body,
    });
    pipeline.onPre(async () => ({
      action: "ask",
      reason: `path-overreach: write ${outside}`,
    }));

    const runPromise = runToolDetailed({
      registry: reg,
      call: {
        id: "call_wl",
        name: "write_file",
        arguments: { path: outside },
      },
      pipeline,
    });

    await new Promise((r) => setTimeout(r, 20));
    const pending = runtime.approvals.listPending(sessionId)[0]!;
    expect(pending.category).toBe("path-overreach");
    expect(pending.overreachPath).toBe(outside);

    const responded = await dispatchFaceMethod(
      runtime,
      "session.respondApproval",
      "r1",
      { sessionId, approvalId: pending.approvalId, decision: "whitelist" },
    );
    expect(responded.result.ok).toBe(true);

    const out = await runPromise;
    expect(body).toHaveBeenCalled();
    expect(out.result.content).toBe("wrote");
    expect(runtime.pathAllowlist.list(sessionId)).toContain(outside);
    expect(
      store.get(sessionId).events.some((e) => e.type === "path/allowlisted"),
    ).toBe(true);
  });

  it("times out path-overreach fail-closed", async () => {
    vi.useFakeTimers();
    try {
      const store = createMemorySessionStore();
      const runtime = await isolatedRuntime(store);
      const created = await dispatchFaceMethod(runtime, "session.create", "c", {
        agentPreset: "minimal",
      });
      expect(created.result.ok).toBe(true);
      if (!created.result.ok) return;
      const sessionId = (created.result.value as { sessionId: string })
        .sessionId;
      const outside = path.resolve(tmpdir(), "xrk-overreach-to.txt");

      const pipeline = createToolPipeline();
      pipeline.setApprovalHandler(runtime.approvals.handlerFor(sessionId));
      const reg = createToolRegistry();
      const body = vi.fn(async () => ({ content: "nope" }));
      reg.register({
        name: "write_file",
        description: "w",
        parameters: {},
        execute: body,
      });
      pipeline.onPre(async () => ({
        action: "ask",
        reason: `path-overreach: write ${outside}`,
        error: {
          name: "PathEscapeError",
          code: "path-escape",
          reason: "escaped",
        },
      }));

      const runPromise = runToolDetailed({
        registry: reg,
        call: {
          id: "call_to",
          name: "write_file",
          arguments: { path: outside },
        },
        pipeline,
      });

      await vi.advanceTimersByTimeAsync(PATH_OVERREACH_TIMEOUT_MS + 50);
      const out = await runPromise;
      expect(body).not.toHaveBeenCalled();
      expect(out.result.isError).toBe(true);
      expect(runtime.approvals.listPending(sessionId)).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
