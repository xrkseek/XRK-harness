import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  admitPrompt,
  createMemorySessionStore,
  listPendingAdmits,
  newSession,
} from "@xrkseek/core-session";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";

describe("pending Inbox recover after Face restart", () => {
  it("wakes sessions with durable pending queue/steer on recreate", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    admitPrompt(store, session.id, "queued");
    admitPrompt(store, session.id, "steer-me", { delivery: "steer" });

    const wakes: string[] = [];
    createBareFaceRuntime({
      store,
      drain: {
        wake(sessionId) {
          wakes.push(sessionId);
        },
        async cancel() {},
        isActive() {
          return false;
        },
      },
    });

    expect(wakes).toContain(session.id);
    expect(
      listPendingAdmits(store.get(session.id).events, session.id).map((row) => ({
        content: row.content,
        delivery: row.delivery,
      })),
    ).toEqual([
      { content: "queued", delivery: "queue" },
      { content: "steer-me", delivery: "steer" },
    ]);
  });

  it("does not wake when a rehydrated goal was disarmed", async () => {
    const persist = path.join(
      mkdtempSync(path.join(tmpdir(), "xrk-inbox-goal-")),
      "goals.json",
    );
    const store = createMemorySessionStore();
    const session = newSession(store);
    const first = createBareFaceRuntime({ store, goalPersistPath: persist });
    const created = await dispatchFaceMethod(first, "goals/create", "g1", {
      args: { agentId: session.id, request: { objective: "hold for resume" } },
    });
    expect(created.result.ok).toBe(true);
    expect(
      listPendingAdmits(store.get(session.id).events, session.id).length,
    ).toBeGreaterThan(0);

    const wakes: string[] = [];
    const second = createBareFaceRuntime({
      store,
      goalPersistPath: persist,
      drain: {
        wake(sessionId) {
          wakes.push(sessionId);
        },
        async cancel() {},
        isActive() {
          return false;
        },
      },
    });
    expect(second.goals.get(session.id)?.activation).toBe("disarmed");
    expect(wakes).not.toContain(session.id);
    expect(
      listPendingAdmits(store.get(session.id).events, session.id).length,
    ).toBeGreaterThan(0);
  });

  it("cold updateQueue remove works after recreate without a live Agent", async () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const receipt = admitPrompt(store, session.id, "edit-or-drop");

    const runtime = createBareFaceRuntime({ store });
    const removed = await dispatchFaceMethod(
      runtime,
      "session.updateQueue",
      "uq1",
      {
        sessionId: session.id,
        itemId: receipt.admitId,
        action: { kind: "remove" },
      },
    );
    expect(removed.result.ok).toBe(true);
    expect(
      listPendingAdmits(store.get(session.id).events, session.id),
    ).toHaveLength(0);
  });

  it("restart wake republishes mux only (no second prompt/admitted)", () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    admitPrompt(store, session.id, "once");
    const before = store
      .get(session.id)
      .events.filter((e) => e.type === "prompt/admitted").length;

    createBareFaceRuntime({ store });
    const after = store
      .get(session.id)
      .events.filter((e) => e.type === "prompt/admitted").length;
    expect(after).toBe(before);
    expect(after).toBe(1);
  });
});
