import { describe, expect, it, vi } from "vitest";
import type { AgentHandle } from "@xrkseek/core-agent";
import { ScopeState } from "@xrkseek/compose";
import { createHostAgentCache, HOST_PLUGINS_KEY } from "../src/agent-cache.js";

function fakeAgent(): AgentHandle & { aborted: boolean } {
  const a = {
    aborted: false,
    abort() {
      a.aborted = true;
    },
    setApprovalHandler() {},
  };
  return a as unknown as AgentHandle & { aborted: boolean };
}

describe("createHostAgentCache", () => {
  it("caches agent and aborts on invalidate", async () => {
    const cache = createHostAgentCache([]);
    const first = fakeAgent();
    const create = vi.fn(async () => first);

    const a1 = await cache.resolve("s1", create);
    const a2 = await cache.resolve("s1", create);
    expect(a1).toBe(first);
    expect(a2).toBe(first);
    expect(create).toHaveBeenCalledTimes(1);

    await cache.invalidate("s1");
    expect(first.aborted).toBe(true);

    const second = fakeAgent();
    create.mockImplementation(async () => second);
    const a3 = await cache.resolve("s1", create);
    expect(a3).toBe(second);
    expect(create).toHaveBeenCalledTimes(2);

    await cache.dispose();
  });

  it("invalidateAll drops every cached agent", async () => {
    const cache = createHostAgentCache([]);
    const a = fakeAgent();
    const b = fakeAgent();
    await cache.resolve("s1", async () => a);
    await cache.resolve("s2", async () => b);
    const { invalidateAll } = cache;
    await invalidateAll();
    expect(a.aborted).toBe(true);
    expect(b.aborted).toBe(true);
    const create = vi.fn(async () => fakeAgent());
    await cache.resolve("s1", create);
    expect(create).toHaveBeenCalledTimes(1);
    await cache.dispose();
  });

  it("opens a nested subagent realm; invalidate parent aborts the child", async () => {
    const cache = createHostAgentCache([]);
    const parent = fakeAgent();
    const child = fakeAgent();
    await cache.resolve("p", async () => parent);
    await cache.resolve("c", async () => child, { parentSessionId: "p" });

    await cache.invalidate("p");
    expect(parent.aborted).toBe(true);
    expect(child.aborted).toBe(true);

    const create = vi.fn(async () => fakeAgent());
    await cache.resolve("c", create, { parentSessionId: "p" });
    expect(create).toHaveBeenCalledTimes(1);
    await cache.dispose();
  });

  it("dispose aborts agents before withdrawing host.plugins", async () => {
    const cache = createHostAgentCache([]);
    const agent = fakeAgent();
    const order: string[] = [];

    await cache.resolve("s1", async () => agent);

    // Spy: when abort runs, plugins provide must still be injectable.
    const originalAbort = agent.abort.bind(agent);
    agent.abort = () => {
      order.push("abort");
      const plugins = cache.hostScope.tryInject(HOST_PLUGINS_KEY);
      order.push(plugins ? "plugins-alive" : "plugins-gone");
      originalAbort();
    };

    await cache.dispose();
    expect(order).toEqual(["abort", "plugins-alive"]);
    expect(cache.hostScope.state).toBe(ScopeState.Disposed);
  });
});
