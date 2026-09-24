/**
 * Golden track: session.search
 * Face session.search finds literal hits across sessions (FTS when available).
 */
import { describe, expect, it } from "vitest";
import {
  createMemorySessionStore,
  newSession,
} from "@xrkseek/core-session";
import { createProviderRegistry } from "@xrkseek/llm-registry";
import { createBareFaceRuntime } from "../../packages/server/face/tests/helpers/bare-runtime.js";
import { dispatchFaceMethod } from "@xrkseek/server-face";

describe("golden/session.search", () => {
  it("finds unique literals across sessions via Face RPC", async () => {
    const store = createMemorySessionStore();
    const a = newSession(store).id;
    const b = newSession(store).id;
    store.append(a, {
      type: "user/message",
      ts: 1,
      turnId: "t1",
      content: "eval-search-alpha needle in session A",
    });
    store.append(b, {
      type: "assistant/message",
      ts: 2,
      turnId: "t2",
      stepId: "s1",
      content: "eval-search-beta reply in session B",
    });

    const runtime = createBareFaceRuntime({
      store,
      registry: createProviderRegistry(),
    });

    const hitA = await dispatchFaceMethod(runtime, "session.search", "q1", {
      query: "eval-search-alpha",
    });
    expect(hitA.result.ok).toBe(true);
    if (hitA.result.ok) {
      const v = hitA.result.value as {
        items: { sessionId: string; snippet: string }[];
      };
      expect(v.items.map((i) => i.sessionId)).toEqual([a]);
      expect(v.items[0]!.snippet.toLowerCase()).toContain("eval-search-alpha");
    }

    const hitB = await dispatchFaceMethod(runtime, "session.search", "q2", {
      query: "eval-search-beta",
    });
    expect(hitB.result.ok).toBe(true);
    if (hitB.result.ok) {
      const v = hitB.result.value as { items: { sessionId: string }[] };
      expect(v.items.map((i) => i.sessionId)).toEqual([b]);
    }
  });
});
