import { describe, expect, it } from "vitest";
import { createAgent } from "@xrkseek/core-agent";
import {
  createMemorySessionStore,
  deriveMessages,
} from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { prepareFaceSessionReferences } from "@xrkseek/xrk-session-reference/prepare-face";
import { SessionId } from "@xrkseek/xrk-session-reference/types";
import { formatSessionReferenceMention } from "@xrkseek/xrk-session-reference/uri";

describe("Face session-reference prepare (B-4)", () => {
  it("injects ## Referenced sessions on continueTurn via prepareUserContent", async () => {
    const store = createMemorySessionStore();
    const source = store.create("src-a");
    store.append(source.id, {
      type: "turn/start",
      ts: 1,
      turnId: "t0",
    });
    store.append(source.id, {
      type: "user/message",
      ts: 2,
      turnId: "t0",
      content: "prior fact ALPHA",
      source: { kind: "user" },
    });
    store.append(source.id, {
      type: "assistant/message",
      ts: 3,
      turnId: "t0",
      stepId: "s0",
      content: "noted ALPHA",
    });

    const target = store.create("tgt-a");
    const mention = formatSessionReferenceMention({
      sessionId: SessionId(source.id),
      label: "Alpha",
    });
    const tools = createToolRegistry();
    const llm = createReplayAdapter([{ content: "done with recall" }]);
    const agent = createAgent({
      sessionId: target.id,
      store,
      llm,
      tools,
      prepareUserContent: ({ content, text, signal }) =>
        prepareFaceSessionReferences({
          targetSessionId: target.id,
          content,
          text,
          readEvents: (id) => store.get(id).events,
          ...(signal ? { signal } : {}),
        }),
    });

    await agent.continueTurn({ text: `use ${mention}` });

    const events = store.get(target.id).events;
    const users = events.filter((e) => e.type === "user/message");
    expect(users.length).toBeGreaterThanOrEqual(2);
    expect(users[0]).toMatchObject({
      content: "use @Alpha",
      source: { kind: "user" },
    });
    expect(users[1]?.source).toMatchObject({
      kind: "session-reference",
      form: "recall",
    });
    expect(String(users[1]?.content)).toContain("## Referenced sessions");
    expect(String(users[1]?.content)).toContain("prior fact ALPHA");

    const msgs = deriveMessages(events);
    expect(msgs[0]?.content).toBe("use @Alpha");
    expect(String(msgs[1]?.content)).toContain("Referenced sessions");
  });
});
