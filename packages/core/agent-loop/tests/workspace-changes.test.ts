import { describe, expect, it } from "vitest";
import { createMemorySessionStore, deriveMessages } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import type { LlmAdapter, LlmChatRequest, LlmStreamEvent } from "@xrkseek/llm";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { runTurn } from "../src/index.js";
import {
  appendWorkspaceChangesFromDiffs,
  fileDiffsFromToolPresenters,
} from "../src/workspace-changes-emit.js";

describe("runTurn workspace/changes", () => {
  it("appends workspace/changes from successful diff-card tools before turn/end", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
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
    const llm = createReplayAdapter([
      {
        content: "wrote",
        toolCalls: [
          {
            id: "c1",
            name: "write_file",
            arguments: { path: "notes/a.txt", content: "hello\nworld\n" },
          },
        ],
      },
      { content: "done" },
    ]);

    await runTurn({
      sessionId: session.id,
      userText: "write",
      store,
      llm,
      tools,
      cwd: "/work",
      now: (() => {
        let t = 0;
        return () => {
          t += 1;
          return t;
        };
      })(),
    });

    const events = store.get(session.id).events;
    const changes = events.filter((e) => e.type === "workspace/changes");
    expect(changes).toHaveLength(1);
    const ev = changes[0]!;
    expect(ev.type).toBe("workspace/changes");
    if (ev.type !== "workspace/changes") return;
    expect(ev.summary.cwd).toBe("/work");
    expect(ev.summary.total).toBe(1);
    expect(ev.summary.files[0]?.path).toBe("notes/a.txt");
    expect(ev.summary.added).toBeGreaterThan(0);

    const endAt = events.findIndex((e) => e.type === "turn/end");
    const changesAt = events.findIndex((e) => e.type === "workspace/changes");
    expect(changesAt).toBeGreaterThan(-1);
    expect(changesAt).toBeLessThan(endAt);

    // Log-only — not model-visible.
    const msgs = deriveMessages(events);
    expect(msgs.every((m) => m.role !== "tool" || m.name === "write_file")).toBe(
      true,
    );
    expect(JSON.stringify(msgs)).not.toContain("workspace/changes");
  });

  it("skips workspace/changes when no FileDiff tools ran", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    const llm = createReplayAdapter([{ content: "pong" }]);

    await runTurn({
      sessionId: session.id,
      userText: "ping",
      store,
      llm,
      tools,
      cwd: "/work",
    });

    expect(
      store.get(session.id).events.some((e) => e.type === "workspace/changes"),
    ).toBe(false);
  });

  it("does not accumulate FileDiffs from errored diff tools", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    tools.register({
      name: "write_file",
      description: "w",
      parameters: { type: "object" },
      presentCall: (args) => {
        const a = args as { path?: string; content?: string };
        return {
          card: "diff",
          title: "Write",
          diffs: [
            {
              path: String(a.path ?? "x.txt"),
              oldText: null,
              newText: String(a.content ?? ""),
            },
          ],
        };
      },
      presentResult: (_args, result) => {
        if (result.isError) return undefined;
        return { card: "diff", title: "Write", diffs: [] };
      },
      async execute() {
        return { content: "denied", isError: true };
      },
    });
    const llm = createReplayAdapter([
      {
        content: "try",
        toolCalls: [
          {
            id: "c1",
            name: "write_file",
            arguments: { path: "fail.txt", content: "x" },
          },
        ],
      },
      { content: "ok" },
    ]);

    await runTurn({
      sessionId: session.id,
      userText: "write",
      store,
      llm,
      tools,
      cwd: "/work",
    });

    expect(
      store.get(session.id).events.some((e) => e.type === "workspace/changes"),
    ).toBe(false);
  });

  it("coalesces several successful diffs into one workspace/changes", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    tools.register({
      name: "write_file",
      description: "w",
      parameters: { type: "object" },
      presentResult: (args, result) => {
        if (result.isError) return undefined;
        const a = args as { path?: string; content?: string };
        return {
          card: "diff",
          title: "Write",
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
    const llm = createReplayAdapter([
      {
        content: "wrote",
        toolCalls: [
          { id: "c1", name: "write_file", arguments: { path: "b.txt", content: "b\n" } },
          { id: "c2", name: "write_file", arguments: { path: "a.txt", content: "a\n" } },
        ],
      },
      { content: "done" },
    ]);

    await runTurn({
      sessionId: session.id,
      userText: "write both",
      store,
      llm,
      tools,
      cwd: "/work",
    });

    const events = store.get(session.id).events;
    const changes = events.filter((e) => e.type === "workspace/changes");
    expect(changes).toHaveLength(1);
    const ev = changes[0]!;
    if (ev.type !== "workspace/changes") return;
    expect(ev.summary.total).toBe(2);
    expect(ev.summary.files.map((f) => f.path)).toEqual(["a.txt", "b.txt"]);
  });

  it("still emits workspace/changes when the turn aborts after a diff tool", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const tools = createToolRegistry();
    tools.register({
      name: "write_file",
      description: "w",
      parameters: { type: "object" },
      presentResult: (args) => {
        const a = args as { path?: string; content?: string };
        return {
          card: "diff",
          title: "Write",
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
    let step = 0;
    const llm: LlmAdapter = {
      id: "tool-then-hang",
      async chat() {
        throw new Error("stream-only fixture");
      },
      async *stream(request: LlmChatRequest): AsyncIterable<LlmStreamEvent> {
        step += 1;
        if (step === 1) {
          yield {
            type: "done",
            content: "wrote",
            toolCalls: [
              {
                id: "c1",
                name: "write_file",
                arguments: { path: "kept.txt", content: "hi\n" },
              },
            ],
          };
          return;
        }
        await new Promise<void>((_resolve, reject) => {
          const onAbort = () => reject(new DOMException("aborted", "AbortError"));
          if (request.signal?.aborted) {
            onAbort();
            return;
          }
          request.signal?.addEventListener("abort", onAbort, { once: true });
        });
      },
    };
    const ac = new AbortController();
    const turnP = runTurn({
      sessionId: session.id,
      userText: "write",
      store,
      llm,
      tools,
      cwd: "/work",
      signal: ac.signal,
    });
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline) {
      if (store.get(session.id).events.some((e) => e.type === "tool/result")) break;
      await new Promise((r) => setTimeout(r, 10));
    }
    ac.abort();
    await expect(turnP).rejects.toMatchObject({ name: "AbortError" });

    const events = store.get(session.id).events;
    const changesAt = events.findIndex((e) => e.type === "workspace/changes");
    const endAt = events.findIndex((e) => e.type === "turn/end");
    expect(changesAt).toBeGreaterThan(-1);
    expect(changesAt).toBeLessThan(endAt);
    const ev = events[changesAt]!;
    if (ev.type === "workspace/changes") {
      expect(ev.summary.files[0]?.path).toBe("kept.txt");
    }
  });
});

describe("workspace/changes emit helpers", () => {
  it("drops presenter throws and errored results", () => {
    expect(
      fileDiffsFromToolPresenters({
        name: "write_file",
        args: { path: "a.txt" },
        result: { toolCallId: "c1", name: "write_file", content: "ok" },
        getTool: () => ({
          presentResult() {
            throw new Error("presenter boom");
          },
        }),
      }),
    ).toEqual([]);

    expect(
      fileDiffsFromToolPresenters({
        name: "write_file",
        args: { path: "a.txt", content: "x" },
        result: {
          toolCallId: "c1",
          name: "write_file",
          content: "denied",
          isError: true,
        },
        getTool: () => ({
          presentCall: () => ({
            card: "diff",
            title: "Write",
            diffs: [{ path: "a.txt", oldText: null, newText: "x" }],
          }),
        }),
      }),
    ).toEqual([]);
  });

  it("falls back to presentCall when presentResult is absent", () => {
    const diffs = fileDiffsFromToolPresenters({
      name: "write_file",
      args: { path: "a.txt", content: "x" },
      result: { toolCallId: "c1", name: "write_file", content: "ok" },
      getTool: () => ({
        presentCall: () => ({
          card: "diff",
          title: "Write",
          diffs: [{ path: "a.txt", oldText: null, newText: "x" }],
        }),
      }),
    });
    expect(diffs).toEqual([{ path: "a.txt", oldText: null, newText: "x" }]);
  });

  it("does not append when there are no diffs", () => {
    const store = createMemorySessionStore();
    const session = store.create();
    expect(
      appendWorkspaceChangesFromDiffs({
        store,
        sessionId: session.id,
        turnId: "t1",
        cwd: "/work",
        diffs: [],
        now: () => 1,
      }),
    ).toBe(false);
    expect(store.get(session.id).events).toEqual([]);
  });
});
