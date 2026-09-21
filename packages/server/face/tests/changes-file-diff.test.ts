import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { dispatchFaceMethod } from "../src/dispatch.js";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";

function registerWriteTool() {
  const tools = createToolRegistry();
  tools.register({
    name: "write_file",
    description: "w",
    parameters: { type: "object" },
    presentCall: (args) => {
      const a = args as { path?: string; content?: string };
      return {
        card: "diff",
        title: `Write ${a.path ?? "?"}`,
        diffs: [
          {
            path: String(a.path ?? "x.txt"),
            oldText: null,
            newText: String(a.content ?? ""),
          },
        ],
      };
    },
    presentResult: (args, result) => {
      if (result.isError) return undefined;
      const a = args as { path?: string; content?: string };
      return {
        card: "diff",
        title: `Write ${a.path ?? "?"}`,
        diffs: [
          {
            path: String(a.path ?? "x.txt"),
            oldText: null,
            newText: String(a.content ?? ""),
          },
        ],
      };
    },
    async execute() {
      return { content: "ok" };
    },
  });
  return tools;
}

describe("changes.fileDiff", () => {
  it("returns WorkspaceFileDiff for a listed file on workspace/changes", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const turnId = "turn_1";
    store.append(session.id, { type: "turn/start", ts: 1, turnId });
    store.append(session.id, {
      type: "tool/call",
      ts: 2,
      turnId,
      stepId: "s1",
      call: {
        id: "c1",
        name: "write_file",
        arguments: { path: "notes/a.txt", content: "hello\n" },
      },
    });
    store.append(session.id, {
      type: "tool/result",
      ts: 3,
      turnId,
      stepId: "s1",
      result: {
        toolCallId: "c1",
        name: "write_file",
        content: "ok",
      },
    });
    store.append(session.id, {
      type: "workspace/changes",
      ts: 4,
      turnId,
      summary: {
        turnId,
        cwd: "/work",
        files: [
          { path: "notes/a.txt", display: "notes/a.txt", added: 1, deleted: 0 },
        ],
        total: 1,
        added: 1,
        deleted: 0,
      },
    });
    store.append(session.id, {
      type: "turn/end",
      ts: 5,
      turnId,
      reason: { kind: "completed" },
    });

    const runtime = createBareFaceRuntime({
      store,
      tools: registerWriteTool(),
    });

    const events = store.get(session.id).events;
    const seq = events.findIndex((e) => e.type === "workspace/changes") + 1;
    expect(seq).toBeGreaterThan(0);

    const res = await dispatchFaceMethod(runtime, "changes.fileDiff", "r1", {
      sessionId: session.id,
      seq,
      index: 0,
    });
    expect(res).toMatchObject({
      type: "server-response",
      result: { ok: true },
    });
    if (res.type !== "server-response" || !("ok" in res.result) || !res.result.ok) {
      return;
    }
    const value = res.result.value as {
      diff: {
        kind: string;
        path: string;
        coarse?: boolean;
        hunks?: { lines: string[] }[];
      } | null;
    };
    expect(value.diff).toMatchObject({
      kind: "text",
      path: "notes/a.txt",
      coarse: true,
    });
    expect(value.diff?.hunks?.[0]?.lines).toEqual(["+hello"]);
  });

  it("returns null for unknown seq or index", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    store.append(session.id, {
      type: "turn/start",
      ts: 1,
      turnId: "t1",
    });
    const runtime = createBareFaceRuntime({ store });
    const missing = await dispatchFaceMethod(
      runtime,
      "changes.fileDiff",
      "r2",
      { sessionId: session.id, seq: 1, index: 0 },
    );
    expect(missing).toMatchObject({
      result: { ok: true, value: { diff: null } },
    });
  });

  it("rejects a missing session, a bad seq, and an out-of-range index", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const runtime = createBareFaceRuntime({ store });

    const noSession = await dispatchFaceMethod(runtime, "changes.fileDiff", "r-s", {});
    expect(noSession).toMatchObject({
      result: { ok: false, error: { code: "bad-request" } },
    });

    const missingSession = await dispatchFaceMethod(
      runtime,
      "changes.fileDiff",
      "r-m",
      { sessionId: "nope", seq: 1, index: 0 },
    );
    expect(missingSession).toMatchObject({
      result: { ok: false, error: { code: "session-not-found" } },
    });

    const badSeq = await dispatchFaceMethod(runtime, "changes.fileDiff", "r-q", {
      sessionId: session.id,
      seq: 0,
      index: 0,
    });
    expect(badSeq).toMatchObject({
      result: { ok: false, error: { code: "bad-request" } },
    });
    const badIndex = await dispatchFaceMethod(runtime, "changes.fileDiff", "r-n", {
      sessionId: session.id,
      seq: 1,
      index: -1,
    });
    expect(badIndex).toMatchObject({
      result: { ok: false, error: { code: "bad-request" } },
    });

    store.append(session.id, {
      type: "workspace/changes",
      ts: 1,
      turnId: "t1",
      summary: {
        turnId: "t1",
        cwd: "/work",
        files: [{ path: "only.txt", display: "only.txt", added: 1, deleted: 0 }],
        total: 1,
        added: 1,
        deleted: 0,
      },
    });
    const seq = store.get(session.id).events.length;
    const oob = await dispatchFaceMethod(runtime, "changes.fileDiff", "r-i", {
      sessionId: session.id,
      seq,
      index: 3,
    });
    expect(oob).toMatchObject({
      result: { ok: true, value: { diff: null } },
    });
  });

  it("resolves the listed index and a binary flag without tool captures", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const turnId = "turn_2";
    store.append(session.id, {
      type: "tool/call",
      ts: 1,
      turnId,
      stepId: "s1",
      call: {
        id: "c1",
        name: "write_file",
        arguments: { path: "a.txt", content: "A\n" },
      },
    });
    store.append(session.id, {
      type: "tool/result",
      ts: 2,
      turnId,
      stepId: "s1",
      result: { toolCallId: "c1", name: "write_file", content: "ok" },
    });
    store.append(session.id, {
      type: "tool/call",
      ts: 3,
      turnId,
      stepId: "s1",
      call: {
        id: "c2",
        name: "write_file",
        arguments: { path: "b.txt", content: "B\n" },
      },
    });
    store.append(session.id, {
      type: "tool/result",
      ts: 4,
      turnId,
      stepId: "s1",
      result: { toolCallId: "c2", name: "write_file", content: "ok" },
    });
    store.append(session.id, {
      type: "workspace/changes",
      ts: 5,
      turnId,
      summary: {
        turnId,
        cwd: "/work",
        files: [
          { path: "a.txt", display: "a.txt", added: 1, deleted: 0 },
          { path: "b.txt", display: "b.txt", added: 1, deleted: 0 },
          {
            path: "pic.bin",
            display: "pic.bin",
            added: 0,
            deleted: 0,
            binary: true,
          },
        ],
        total: 3,
        added: 2,
        deleted: 0,
      },
    });
    const runtime = createBareFaceRuntime({
      store,
      tools: registerWriteTool(),
    });
    const seq = store.get(session.id).events.length;

    const second = await dispatchFaceMethod(runtime, "changes.fileDiff", "r-b", {
      sessionId: session.id,
      seq,
      index: 1,
    });
    expect(second).toMatchObject({
      result: {
        ok: true,
        value: { diff: { kind: "text", path: "b.txt", coarse: true } },
      },
    });

    const binary = await dispatchFaceMethod(runtime, "changes.fileDiff", "r-bin", {
      sessionId: session.id,
      seq,
      index: 2,
    });
    expect(binary).toMatchObject({
      result: {
        ok: true,
        value: { diff: { kind: "binary", path: "pic.bin" } },
      },
    });
  });
});
