import { describe, expect, it } from "vitest";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createReplayAdapter } from "@xrkseek/llm-replay";
import { createHarnessComposition } from "../preset.js";

describe("harness autoContinueOnMaxTokens forward", () => {
  it("forwards Face auto-continue into createAgent so max-tokens resumes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-ac-"));
    const store = createMemorySessionStore();
    const session = store.create();
    const llm = createReplayAdapter([
      { content: "first-half", finishReason: "max-tokens" },
      { content: "second-half" },
    ]);
    const composition = createHarnessComposition({
      workspaceRoot: root,
      sessionStore: store,
      sessionId: session.id,
      llm,
      assemble: false,
      workspaceInject: false,
      slashRecipes: false,
      autoContinueOnMaxTokens: true,
      autoContinueMaxRounds: 2,
    });
    const agent = await composition.createAgent();
    const result = await agent.run({ text: "hi" });
    expect(result.text).toBe("second-half");
    const events = store.get(session.id).events;
    const end = events.find((e) => e.type === "turn/end");
    expect(end).toMatchObject({ type: "turn/end", reason: { kind: "completed" } });
    const auto = events.filter(
      (e) =>
        e.type === "user/message" &&
        (e as { source?: { kind?: string } }).source?.kind === "auto-continue",
    );
    expect(auto).toHaveLength(1);
    expect(auto[0]).toMatchObject({
      content: "继续",
      source: { kind: "auto-continue", round: 1 },
    });
  });

  it("leaves max-tokens sticky when auto-continue is off (default)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-ac-off-"));
    const store = createMemorySessionStore();
    const session = store.create();
    const llm = createReplayAdapter([
      { content: "truncated", finishReason: "max-tokens" },
      { content: "should-not-run" },
    ]);
    const composition = createHarnessComposition({
      workspaceRoot: root,
      sessionStore: store,
      sessionId: session.id,
      llm,
      assemble: false,
      workspaceInject: false,
      slashRecipes: false,
    });
    const agent = await composition.createAgent();
    const result = await agent.run({ text: "hi" });
    expect(result.text).toBe("truncated");
    const end = store.get(session.id).events.find((e) => e.type === "turn/end");
    expect(end).toMatchObject({ type: "turn/end", reason: { kind: "max-tokens" } });
  });
});
