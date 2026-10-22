import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMemorySessionStore, newSession } from "@xrkseek/core-session";
import { createLocalSubprocess } from "@xrkseek/exec-subprocess";
import { createLocalShell } from "@xrkseek/exec-shell";
import { createFaceRuntime } from "../src/runtime.js";
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

describe("job session journal", () => {
  it("appends job/registered then job/settled for owned jobs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-face-job-journal-"));
    const store = createMemorySessionStore();
    const session = newSession(store);
    const shell = createLocalShell({
      subprocess: createLocalSubprocess(),
      defaultCwd: root,
    });
    createFaceRuntime({
      store,
      workspaceRoot: root,
      productDir: path.join(root, ".xrk"),
      drain: drain(),
      shell,
      resolveAgent: async () =>
        ({
          admit: () => {
            throw new Error("unused");
          },
          pendingAdmits: () => [],
          continueTurn: async () => ({}) as never,
          run: async () => ({}) as never,
          isBusy: () => false,
          abort() {},
          setApprovalHandler() {},
        }) as never,
    });

    const { id } = await shell.startJob(
      process.platform === "win32" ? "echo ok" : "echo ok",
      root,
      { ownerSessionId: session.id },
    );
    expect(id).toMatch(/^bash-\d+$/);

    await shell.waitJob(id, 10_000);

    const events = store.get(session.id).events;
    const registered = events.filter((e) => e.type === "job/registered");
    const settled = events.filter((e) => e.type === "job/settled");
    expect(registered).toHaveLength(1);
    expect(settled).toHaveLength(1);
    if (registered[0]?.type !== "job/registered") return;
    if (settled[0]?.type !== "job/settled") return;
    expect(registered[0].liveId).toBe(id);
    expect(registered[0].jobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    expect(settled[0].jobId).toBe(registered[0].jobId);
    expect(settled[0].liveId).toBe(id);
    expect(settled[0].producerReported).toBe(true);
    expect(settled[0].status).toBe("exited");

    await shell.dispose();
  });

  it("does not invent settled rows for unowned jobs", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-face-job-unowned-"));
    const store = createMemorySessionStore();
    const session = newSession(store);
    const shell = createLocalShell({
      subprocess: createLocalSubprocess(),
      defaultCwd: root,
    });
    createFaceRuntime({
      store,
      workspaceRoot: root,
      productDir: path.join(root, ".xrk"),
      drain: drain(),
      shell,
      resolveAgent: async () =>
        ({
          admit: () => {
            throw new Error("unused");
          },
          pendingAdmits: () => [],
          continueTurn: async () => ({}) as never,
          run: async () => ({}) as never,
          isBusy: () => false,
          abort() {},
          setApprovalHandler() {},
        }) as never,
    });

    const { id } = await shell.startJob("echo orphan", root);
    await shell.waitJob(id, 10_000);
    const events = store.get(session.id).events;
    expect(events.some((e) => e.type === "job/registered")).toBe(false);
    expect(events.some((e) => e.type === "job/settled")).toBe(false);
    await shell.dispose();
  });
});
