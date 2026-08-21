import { describe, expect, it } from "vitest";
import { createMemorySessionStore, deriveMessages } from "@xrkseek/core-session";
import {
  createToolPipeline,
  createToolRegistry,
} from "@xrkseek/core-tools";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { runTurn } from "../src/index.js";

describe("runTurn beforeUserMessage + prompt cache", () => {
  it("injects durable context as user/message and keeps system equal across steps", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    const systems: string[] = [];
    const llm = createReplayAdapter([
      {
        content: "",
        toolCalls: [
          { id: "c1", name: "echo", arguments: { text: "x" } },
        ],
      },
      { content: "done" },
    ]);
    const orig = llm.chat.bind(llm);
    llm.chat = async (req) => {
      const sys = req.messages.find((m) => m.role === "system");
      systems.push(typeof sys?.content === "string" ? sys.content : "");
      return orig(req);
    };

    const tools = createToolRegistry();
    tools.register({
      name: "echo",
      description: "echo",
      parameters: { type: "object" },
      async execute(args) {
        return { content: String((args as { text?: string }).text ?? "") };
      },
    });

    await runTurn({
      sessionId: session.id,
      userText: "go",
      store,
      llm,
      tools,
      pipeline: createToolPipeline(),
      system: "PERSONA_SKELETON",
      assemble: { persona: "PERSONA_SKELETON" },
      beforeUserMessage: ({ store: s, sessionId, turnId, now }) => {
        s.append(sessionId, {
          type: "user/message",
          ts: now(),
          turnId,
          content:
            "<system-reminder>\n<available_skills>\n- `ping`: Ping\n</available_skills>\n</system-reminder>",
          source: {
            kind: "skill-catalog",
            form: "catalog",
            entries: [{ name: "ping", description: "Ping" }],
            digest: "fixed",
          },
        });
        s.append(sessionId, {
          type: "user/message",
          ts: now(),
          turnId,
          content: "## Assistant\nInjected instructions",
          source: {
            kind: "agent-instructions",
            form: "instructions",
            changes: [{ action: "set", path: "assistant.md" }],
            digest: "instr",
          },
        });
      },
    });

    expect(systems.length).toBe(2);
    expect(systems[0]).toContain("PERSONA_SKELETON");
    expect(systems[0]).not.toContain("Injected instructions");
    expect(systems[0]).not.toContain("available_skills");
    expect(systems[0]).toBe(systems[1]);

    const msgs = deriveMessages(store.get(session.id).events);
    expect(
      msgs.some(
        (m) =>
          m.role === "user" &&
          String(m.content).includes("available_skills"),
      ),
    ).toBe(true);
    expect(
      msgs.some(
        (m) =>
          m.role === "user" &&
          String(m.content).includes("Injected instructions"),
      ),
    ).toBe(true);
  });
});
