import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  newSession,
} from "@xrkseek/core-session";
import { createFaceRuntime } from "../src/runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { MESSAGE_FEEDBACK_NOTE_MAX_BYTES } from "../src/message-feedback.js";
import { faceMethodFromPath } from "../src/wire/index.js";

function bareRuntime(store = createMemorySessionStore()) {
  return createFaceRuntime({
    store,
    workspaceRoot: process.cwd(),
    version: "test",
    drain: {
      wake() {},
      async cancel() {},
      isActive() {
        return false;
      },
    },
    resolveAgent: async () => {
      throw new Error("unused");
    },
  });
}

function appendAssistant(
  store: ReturnType<typeof createMemorySessionStore>,
  sessionId: string,
  turnId = "t1",
  stepId = "s1",
) {
  store.append(sessionId, {
    type: "assistant/message",
    ts: 1,
    turnId,
    stepId,
    content: "hello",
  });
  return `${turnId}:${stepId}`;
}

describe("messageFeedback paths", () => {
  it("claims Typert remotes", () => {
    expect(faceMethodFromPath("/api/messageFeedback/list")).toBe(
      "messageFeedback/list",
    );
    expect(faceMethodFromPath("/api/messageFeedback/put")).toBe(
      "messageFeedback/put",
    );
    expect(faceMethodFromPath("/api/messageFeedback/delete")).toBe(
      "messageFeedback/delete",
    );
  });
});

describe("messageFeedback CAS", () => {
  it("lists empty, puts, conflicts, deletes", async () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const messageId = appendAssistant(store, session.id);
    const runtime = bareRuntime(store);

    const missing = await dispatchFaceMethod(
      runtime,
      "messageFeedback/list",
      "l0",
      { args: { sessionId: "nope" } },
    );
    expect(missing.result.ok).toBe(true);
    if (missing.result.ok) {
      expect(missing.result.value).toEqual({
        ok: false,
        error: { code: "session-not-found", sessionId: "nope" },
      });
    }

    const empty = await dispatchFaceMethod(
      runtime,
      "messageFeedback/list",
      "l1",
      { args: { sessionId: session.id } },
    );
    expect(empty.result).toEqual({
      ok: true,
      value: { ok: true, value: { items: [] } },
    });

    const ghost = await dispatchFaceMethod(
      runtime,
      "messageFeedback/put",
      "p0",
      {
        args: {
          sessionId: session.id,
          messageId: "missing:id",
          rating: "positive",
          ifVersion: null,
        },
      },
    );
    expect(ghost.result.ok).toBe(true);
    if (ghost.result.ok) {
      expect(ghost.result.value).toEqual({
        ok: false,
        error: {
          code: "target-not-found",
          sessionId: session.id,
          messageId: "missing:id",
        },
      });
    }

    const created = await dispatchFaceMethod(
      runtime,
      "messageFeedback/put",
      "p1",
      {
        args: {
          sessionId: session.id,
          messageId,
          rating: "positive",
          note: "good turn",
          ifVersion: null,
        },
      },
    );
    expect(created.result.ok).toBe(true);
    if (!created.result.ok) return;
    const createdInner = created.result.value as {
      ok: true;
      value: { version: string; rating: string; note?: string };
    };
    expect(createdInner.ok).toBe(true);
    expect(createdInner.value.rating).toBe("positive");
    expect(createdInner.value.note).toBe("good turn");
    const version = createdInner.value.version;

    const replayCreate = await dispatchFaceMethod(
      runtime,
      "messageFeedback/put",
      "p2",
      {
        args: {
          sessionId: session.id,
          messageId,
          rating: "negative",
          ifVersion: null,
        },
      },
    );
    expect(replayCreate.result.ok).toBe(true);
    if (replayCreate.result.ok) {
      const inner = replayCreate.result.value as {
        ok: false;
        error: { code: string; current: { version: string } };
      };
      expect(inner.ok).toBe(false);
      expect(inner.error.code).toBe("version-conflict");
      expect(inner.error.current.version).toBe(version);
    }

    const listed = await dispatchFaceMethod(
      runtime,
      "messageFeedback/list",
      "l2",
      { sessionId: session.id },
    );
    expect(listed.result.ok).toBe(true);
    if (listed.result.ok) {
      const inner = listed.result.value as {
        ok: true;
        value: { items: { messageId: string }[] };
      };
      expect(inner.value.items).toHaveLength(1);
      expect(inner.value.items[0]!.messageId).toBe(messageId);
    }

    const updated = await dispatchFaceMethod(
      runtime,
      "messageFeedback/put",
      "p3",
      {
        args: {
          sessionId: session.id,
          messageId,
          rating: "negative",
          ifVersion: version,
        },
      },
    );
    expect(updated.result.ok).toBe(true);
    if (!updated.result.ok) return;
    const updatedInner = updated.result.value as {
      ok: true;
      value: { version: string; rating: string; note?: string };
    };
    expect(updatedInner.value.rating).toBe("negative");
    expect(updatedInner.value.note).toBeUndefined();
    expect(updatedInner.value.version).not.toBe(version);

    const deleted = await dispatchFaceMethod(
      runtime,
      "messageFeedback/delete",
      "d1",
      {
        args: {
          sessionId: session.id,
          messageId,
          ifVersion: updatedInner.value.version,
        },
      },
    );
    expect(deleted.result).toEqual({
      ok: true,
      value: { ok: true, value: { absent: true } },
    });
  });

  it("rejects blank and oversized notes", async () => {
    const store = createMemorySessionStore();
    const session = newSession(store);
    const messageId = appendAssistant(store, session.id);
    const runtime = bareRuntime(store);

    const blank = await dispatchFaceMethod(runtime, "messageFeedback/put", "n1", {
      args: {
        sessionId: session.id,
        messageId,
        rating: "positive",
        note: "   ",
        ifVersion: null,
      },
    });
    expect(blank.result.ok).toBe(true);
    if (blank.result.ok) {
      expect(blank.result.value).toEqual({
        ok: false,
        error: { code: "note-blank" },
      });
    }

    const tooBig = "x".repeat(MESSAGE_FEEDBACK_NOTE_MAX_BYTES + 1);
    const large = await dispatchFaceMethod(runtime, "messageFeedback/put", "n2", {
      args: {
        sessionId: session.id,
        messageId,
        rating: "positive",
        note: tooBig,
        ifVersion: null,
      },
    });
    expect(large.result.ok).toBe(true);
    if (large.result.ok) {
      const inner = large.result.value as {
        ok: false;
        error: { code: string; maxBytes: number; actualBytes: number };
      };
      expect(inner.error.code).toBe("note-too-large");
      expect(inner.error.maxBytes).toBe(MESSAGE_FEEDBACK_NOTE_MAX_BYTES);
      expect(inner.error.actualBytes).toBe(MESSAGE_FEEDBACK_NOTE_MAX_BYTES + 1);
    }
  });
});
