import { describe, expect, it } from "vitest";
import { createBareFaceRuntime } from "./helpers/bare-runtime.js";
import { dispatchFaceMethod } from "../src/dispatch.js";
import type { FaceRuntime } from "../src/context.js";
import { resolveSessionModelSelection, type FaceModelSelection } from "../src/model-catalog.js";

const SOURCE_MODEL: FaceModelSelection = {
  provider: "openrouter",
  model: "anthropic/claude-sonnet-5",
  reasoningEffort: "high",
};

async function create(
  runtime: FaceRuntime,
  payload: Record<string, unknown>,
): Promise<string> {
  const response = await dispatchFaceMethod(runtime, "session.create", "c", payload);
  if (!response.result.ok) throw new Error("session.create failed");
  return (response.result.value as { sessionId: string }).sessionId;
}

describe("session.create model inheritance", () => {
  it("copies the source session's pinned selection onto the new session", async () => {
    const runtime = createBareFaceRuntime();
    runtime.store.create("sess-src");
    runtime.sessionModels.set("sess-src", { ...SOURCE_MODEL });

    const sessionId = await create(runtime, { inheritFrom: "sess-src" });

    const inherited = runtime.sessionModels.get(sessionId);
    expect(inherited).toEqual(SOURCE_MODEL);
    // A copy, not an alias: later edits on either side stay its own.
    expect(inherited).not.toBe(runtime.sessionModels.get("sess-src"));
  });

  it("copies the source session's effective route when nothing was pinned", async () => {
    const runtime = createBareFaceRuntime();
    runtime.store.create("sess-plain");

    const fromGhost = await create(runtime, { inheritFrom: "sess-ghost" });
    const fromPlain = await create(runtime, { inheritFrom: "sess-plain" });

    expect(runtime.sessionModels.has(fromGhost)).toBe(false);
    expect(runtime.sessionModels.get(fromPlain)).toEqual(
      resolveSessionModelSelection(runtime, "sess-plain"),
    );
  });

  it("keeps the subagent parent's selection when both name a source", async () => {
    const runtime = createBareFaceRuntime();
    runtime.store.create("sess-parent");
    runtime.sessionModels.set("sess-parent", { provider: "deepseek", model: "deepseek-chat" });
    runtime.sessionModels.set("sess-other", { ...SOURCE_MODEL });

    const sessionId = await create(runtime, {
      parentSessionId: "sess-parent",
      inheritFrom: "sess-other",
    });

    expect(runtime.sessionModels.get(sessionId)).toEqual({
      provider: "deepseek",
      model: "deepseek-chat",
    });
  });
});