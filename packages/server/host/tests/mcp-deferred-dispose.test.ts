import { describe, expect, it } from "vitest";
import { createMcpDeferredDispose } from "../src/mcp-deferred-dispose.js";
import type { RegisteredPlugin } from "@xrkseek/server-loader";

function stubPlugin(id: string): RegisteredPlugin & { disposed: boolean } {
  const p = {
    id,
    kind: "tools" as const,
    tools: [],
    disposed: false,
    async dispose() {
      p.disposed = true;
    },
  };
  return p;
}

describe("createMcpDeferredDispose", () => {
  it("hard-unregisters when idle", async () => {
    const unregistered: string[] = [];
    const deferred = createMcpDeferredDispose({
      detach: () => undefined,
      unregister: async (id) => {
        unregistered.push(id);
      },
      isBusy: () => false,
    });
    await deferred.remove("mcp:a");
    expect(unregistered).toEqual(["mcp:a"]);
    expect(deferred.retained()).toEqual([]);
  });

  it("soft-detaches while busy and disposes on flush after idle", async () => {
    let busy = true;
    const live = stubPlugin("mcp:a");
    const deferred = createMcpDeferredDispose({
      detach: (id) => (id === live.id ? live : undefined),
      unregister: async () => {
        throw new Error("must not hard-unregister while busy");
      },
      isBusy: () => busy,
    });

    await deferred.remove("mcp:a");
    expect(live.disposed).toBe(false);
    expect(deferred.retained()).toEqual([live]);

    await deferred.flush();
    expect(live.disposed).toBe(false);

    busy = false;
    await deferred.flush();
    expect(live.disposed).toBe(true);
    expect(deferred.retained()).toEqual([]);
  });

  it("keeps retained clients across multiple soft removes", async () => {
    const a = stubPlugin("mcp:a");
    const b = stubPlugin("mcp:b");
    const bag = new Map<string, RegisteredPlugin>([
      [a.id, a],
      [b.id, b],
    ]);
    const deferred = createMcpDeferredDispose({
      detach: (id) => {
        const p = bag.get(id);
        bag.delete(id);
        return p;
      },
      unregister: async () => {},
      isBusy: () => true,
    });
    await deferred.remove("mcp:a");
    await deferred.remove("mcp:b");
    expect(deferred.retained().map((p) => p.id).sort()).toEqual([
      "mcp:a",
      "mcp:b",
    ]);
  });
});
