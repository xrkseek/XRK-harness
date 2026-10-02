import { describe, expect, it } from "vitest";
import { createMemorySessionStore } from "@xrkseek/core-session";
import { createToolRegistry } from "@xrkseek/core-tools";
import type { LlmAdapter, LlmChatRequest } from "@xrkseek/llm";
import { contentHasImage } from "@xrkseek/protocol";
import { runTurn } from "../src/index.js";

const png = new Uint8Array([1, 2, 3, 4]);
const imageAttachment = {
  attachmentId: "sha256:ab",
  mediaType: "image/png" as const,
  bytes: 4,
  width: 1,
  height: 1,
};

describe("runTurn assemble + vision", () => {
  it("keeps image blocks on the wire when assemble is enabled", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    let sawImage = false;
    let resolveCalled = false;
    const llm: LlmAdapter = {
      id: "vision-assemble",
      inputModalities: ["text", "image"],
      async chat(req: LlmChatRequest) {
        const users = req.messages.filter((m) => m.role === "user");
        expect(users.some((m) => contentHasImage(m.content))).toBe(true);
        sawImage = true;
        if (req.resolveImage) {
          resolveCalled = true;
          const stored = await req.resolveImage("sha256:ab");
          expect(stored.data).toEqual(png);
        }
        return { content: "saw-image" };
      },
    };

    const result = await runTurn({
      sessionId: session.id,
      userText: "看这张图",
      userContent: [
        { type: "text", text: "看这张图" },
        { type: "image", attachment: imageAttachment },
      ],
      store,
      llm,
      tools: createToolRegistry(),
      assemble: { persona: "PersonaZ", owner: "xrk" },
      resolveImage: async () => ({ mediaType: "image/png", data: png }),
      now: () => Date.parse("2026-08-15T00:00:00.000Z"),
    });

    expect(result.assistantText).toBe("saw-image");
    expect(sawImage).toBe(true);
    expect(resolveCalled).toBe(true);
  });

  it("does not lift offloaded image turns into skeleton text", async () => {
    const store = createMemorySessionStore();
    const session = store.create();
    // Prior turn left an offloaded image in history (long-session budget path).
    store.append(session.id, {
      type: "user/message",
      ts: 1,
      turnId: "t0",
      content: [
        { type: "text", text: "earlier pic" },
        { type: "image", attachment: imageAttachment },
      ],
    });
    store.append(session.id, {
      type: "image/offload",
      ts: 2,
      targets: [{ seq: 0, imageIndexes: [0] }],
    });
    store.append(session.id, {
      type: "assistant/message",
      ts: 3,
      turnId: "t0",
      stepId: "s0",
      content: "ok",
    });

    let sawImageBlock = false;
    const llm: LlmAdapter = {
      id: "vision-offload-assemble",
      inputModalities: ["text", "image"],
      async chat(req: LlmChatRequest) {
        for (const m of req.messages) {
          if (m.role !== "user" || typeof m.content === "string") continue;
          if (m.content.some((b) => b.type === "image")) sawImageBlock = true;
        }
        return { content: "noted" };
      },
    };

    await runTurn({
      sessionId: session.id,
      userText: "那张图里有什么",
      store,
      llm,
      tools: createToolRegistry(),
      assemble: { persona: "PersonaZ", owner: "xrk" },
      resolveImage: async () => ({ mediaType: "image/png", data: png }),
      now: () => Date.parse("2026-08-15T00:00:00.000Z"),
    });

    // Offloaded images stay as blocks (wire may placeholder them) — must not be
    // stringified away by first-step skeleton lift.
    expect(sawImageBlock).toBe(true);
  });
});
