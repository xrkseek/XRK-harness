/**
 * Session feedback: independent `sessionFeedback/record`, slash `/feedback`,
 * and conversation-slice sidecars.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  FEEDBACK_CATEGORIES,
  recordSessionFeedback,
  sessionFeedbackRecord,
} from "../src/session-feedback.js";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

function bareRuntime(extra?: { feedbackSlicesDir?: string }) {
  return createBareFaceRuntime({
    store: createMemorySessionStore(),
    ...extra,
  });
}

describe("sessionFeedback/record", () => {
  it("records category + text without command bookkeeping and writes a slice", async () => {
    const slicesDir = mkdtempSync(path.join(tmpdir(), "xrk-fb-"));
    temps.push(slicesDir);
    const runtime = bareRuntime({ feedbackSlicesDir: slicesDir });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    runtime.store.append(sessionId, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "hello",
    });

    const res = await dispatchFaceMethod(runtime, "sessionFeedback/record", "r", {
      args: {
        sessionId,
        category: "task-result",
        text: "  the diff is wrong  ",
      },
    });
    expect(res.result.ok).toBe(true);
    if (!res.result.ok) return;
    expect(res.result.value).toMatchObject({
      ok: true,
      value: { recorded: true },
    });
    const value = (res.result.value as { ok: true; value: { sliceId?: string } })
      .value;
    expect(value.sliceId).toMatch(/^slice-/);

    const events = runtime.store.get(sessionId).events;
    expect(events.filter((e) => e.type === "command/run")).toEqual([]);
    const record = events.find((e) => e.type === "feedback/record");
    expect(record).toMatchObject({
      type: "feedback/record",
      text: "the diff is wrong",
      category: "task-result",
      sliceId: value.sliceId,
    });
    const slicePath = path.join(
      slicesDir,
      sessionId,
      `${value.sliceId}.json`,
    );
    const slice = JSON.parse(readFileSync(slicePath, "utf8")) as {
      eventCount: number;
      events: unknown[];
    };
    expect(slice.eventCount).toBeGreaterThanOrEqual(1);
    expect(slice.events.length).toBe(slice.eventCount);
  });

  it("allows empty draft and rejects unknown session", async () => {
    const runtime = bareRuntime();
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;

    const empty = await dispatchFaceMethod(runtime, "sessionFeedback/record", "e", {
      args: { sessionId },
    });
    expect(empty.result.ok).toBe(true);
    if (!empty.result.ok) return;
    expect(empty.result.value).toMatchObject({
      ok: true,
      value: { recorded: true },
    });
    const record = runtime.store
      .get(sessionId)
      .events.find((e) => e.type === "feedback/record");
    expect(record).toMatchObject({ type: "feedback/record" });
    expect(record && Object.hasOwn(record, "text")).toBe(false);
    expect(record && Object.hasOwn(record, "category")).toBe(false);

    const missing = await dispatchFaceMethod(
      runtime,
      "sessionFeedback/record",
      "m",
      { args: { sessionId: "missing-session" } },
    );
    expect(missing.result.ok).toBe(true);
    if (!missing.result.ok) return;
    expect(missing.result.value).toMatchObject({
      ok: false,
      error: { code: "session-not-found", sessionId: "missing-session" },
    });
  });

  it("rejects invalid category on the Face path", () => {
    const store = createMemorySessionStore();
    const sessionId = store.create().id;
    const bad = sessionFeedbackRecord(store, {
      sessionId,
      category: "not-a-category",
    });
    expect(bad.ok).toBe(false);
  });

  it("exposes the fixed taxonomy", () => {
    expect(FEEDBACK_CATEGORIES).toHaveLength(7);
    expect(FEEDBACK_CATEGORIES[0]).toBe("task-result");
  });
});

describe("recordSessionFeedback producer", () => {
  it("writes sliceId when slicesDir is set", () => {
    const slicesDir = mkdtempSync(path.join(tmpdir(), "xrk-fb-prod-"));
    temps.push(slicesDir);
    const store = createMemorySessionStore();
    const sessionId = store.create().id;
    const out = recordSessionFeedback(
      store,
      sessionId,
      { category: "other" },
      { slicesDir },
    );
    expect(out.recorded).toBe(true);
    expect(out.sliceId).toBeDefined();
    const record = store.get(sessionId).events.find((e) => e.type === "feedback/record");
    expect(record).toMatchObject({
      category: "other",
      sliceId: out.sliceId,
    });
  });
});
