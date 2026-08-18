import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { dispatchFaceMethod } from "../src/dispatch.js";
import {
  createBareFaceRuntime,
  unusedAgentResolve,
} from "./helpers/bare-runtime.js";

describe("Face standing tool lookup (DSH preset layer)", () => {
  it("session.history presenters work with no live agent", async () => {
    const store = createMemorySessionStore();
    const tools = createToolRegistry();
    tools.register({
      name: "read_file",
      description: "read",
      parameters: { type: "object" },
      async execute() {
        return { content: "" };
      },
      presentCall: (args) => ({
        card: "generic",
        title: `Read ${String((args as { path?: string }).path ?? "")}`,
        kind: "read",
      }),
    });
    const runtime = createBareFaceRuntime({
      store,
      tools,
      resolveAgent: unusedAgentResolve(),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    store.append(sessionId, {
      type: "tool/call",
      ts: 1,
      turnId: "t",
      stepId: "s",
      call: { id: "c1", name: "read_file", arguments: { path: "src/a.ts" } },
    });
    const hist = await dispatchFaceMethod(runtime, "session.history", "h", {
      sessionId,
    });
    expect(hist.result.ok).toBe(true);
    if (!hist.result.ok) throw new Error("history");
    const events = (
      hist.result.value as {
        events: { view?: { for: string; view: { title?: string } } }[];
      }
    ).events;
    const row = events.find((e) => e.view?.for === "call");
    expect(row?.view).toMatchObject({
      for: "call",
      view: { title: "Read src/a.ts" },
    });
  });

  it("cold history prepends reasoning and standing bash/pty cards without resuming an agent", async () => {
    const store = createMemorySessionStore();
    const tools = createToolRegistry();
    tools.register({
      name: "bash",
      description: "run",
      parameters: { type: "object" },
      async execute() {
        return { content: "" };
      },
      presentCall: (args) => ({
        card: "terminal",
        title: String((args as { command?: string }).command ?? ""),
      }),
      presentResult: (_args, res) => ({
        card: "terminal",
        output: res.content,
        exit: 0,
      }),
    });
    tools.register({
      name: "terminal_send",
      description: "pty",
      parameters: { type: "object" },
      async execute() {
        return { content: "" };
      },
      presentCall: (args) => ({
        card: "terminal",
        title: String((args as { text?: string }).text ?? ""),
        description: `Terminal ${(args as { sessionId?: string }).sessionId ?? ""}`,
      }),
      presentResult: (_args, res) => ({
        card: "terminal",
        output: res.content,
      }),
    });
    const runtime = createBareFaceRuntime({
      store,
      tools,
      resolveAgent: unusedAgentResolve(),
    });
    const created = await dispatchFaceMethod(runtime, "session.create", "c", {});
    if (!created.result.ok) throw new Error("create");
    const sessionId = (created.result.value as { sessionId: string }).sessionId;
    store.append(sessionId, {
      type: "assistant/message",
      ts: 1,
      turnId: "t",
      stepId: "s",
      content: "done",
      reasoning: "plan the card",
    });
    store.append(sessionId, {
      type: "tool/call",
      ts: 2,
      turnId: "t",
      stepId: "s2",
      call: { id: "b1", name: "bash", arguments: { command: "ls" } },
    });
    store.append(sessionId, {
      type: "tool/result",
      ts: 3,
      turnId: "t",
      stepId: "s2",
      result: {
        toolCallId: "b1",
        name: "bash",
        content: "a.ts\n[exit code: 0]",
        isError: false,
      },
    });
    store.append(sessionId, {
      type: "tool/call",
      ts: 4,
      turnId: "t",
      stepId: "s3",
      call: {
        id: "p1",
        name: "terminal_send",
        arguments: { sessionId: "pty-1", text: "pwd" },
      },
    });
    store.append(sessionId, {
      type: "tool/result",
      ts: 5,
      turnId: "t",
      stepId: "s3",
      result: {
        toolCallId: "p1",
        name: "terminal_send",
        content: "/tmp",
        isError: false,
      },
    });
    const hist = await dispatchFaceMethod(runtime, "session.history", "h", {
      sessionId,
    });
    expect(hist.result.ok).toBe(true);
    if (!hist.result.ok) throw new Error("history");
    const events = (
      hist.result.value as {
        events: {
          event: {
            type: string;
            data: {
              message?: { content?: { type: string; text?: string }[] };
            };
          };
          view?: { for: string; view: { card?: string; title?: string } };
        }[];
      }
    ).events;

    const assistant = events.find((e) => e.event.type === "assistant/message");
    expect(assistant?.event.data.message?.content?.[0]).toEqual({
      type: "reasoning",
      text: "plan the card",
    });

    const bashCall = events.find(
      (e) => e.view?.for === "call" && e.view.view.title === "ls",
    );
    expect(bashCall?.view).toMatchObject({
      for: "call",
      view: { card: "terminal", title: "ls" },
    });
    const bashResult = events.find(
      (e) => e.view?.for === "result" && e.event.type === "tool/result",
    );
    expect(bashResult?.view).toMatchObject({
      for: "result",
      view: { card: "terminal" },
    });

    const ptyCall = events.find(
      (e) => e.view?.for === "call" && e.view.view.title === "pwd",
    );
    expect(ptyCall?.view).toMatchObject({
      for: "call",
      view: { card: "terminal", title: "pwd" },
    });
  });
});
