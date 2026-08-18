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
});
