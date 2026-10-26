import { describe, expect, it, vi } from "vitest";
import type { AgentHandle } from "@xrkseek/core-agent";
import { ScopeState } from "@xrkseek/compose";
import {
  createHostAgentCache,
  deferBusyAgentInvalidate,
  HOST_PLUGINS_KEY,
} from "../src/agent-cache.js";

function fakeAgent(opts?: {
  busy?: boolean;
}): AgentHandle & { aborted: boolean; busy: boolean } {
  const a = {
    aborted: false,
    busy: opts?.busy === true,
    abort() {
      a.aborted = true;
    },
    isBusy() {
      return a.busy;
    },
    setApprovalHandler() {},
  };
  return a as unknown as AgentHandle & { aborted: boolean; busy: boolean };
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

  it("isBusy reports latch state for cached agents", async () => {
    const cache = createHostAgentCache([]);
    const busy = fakeAgent({ busy: true });
    const idle = fakeAgent({ busy: false });
    await cache.resolve("busy", async () => busy);
    await cache.resolve("idle", async () => idle);
    expect(cache.isBusy("busy")).toBe(true);
    expect(cache.isBusy("idle")).toBe(false);
    expect(cache.isBusy("missing")).toBe(false);
    await cache.dispose();
  });

  it("invalidateAll skip leaves matching agents running", async () => {
    const cache = createHostAgentCache([]);
    const active = fakeAgent();
    const idle = fakeAgent();
    await cache.resolve("active", async () => active);
    await cache.resolve("idle", async () => idle);

    await cache.invalidateAll({
      skip: (id) => id === "active",
    });
    expect(active.aborted).toBe(false);
    expect(idle.aborted).toBe(true);

    const create = vi.fn(async () => fakeAgent());
    await cache.resolve("active", create);
    expect(create).toHaveBeenCalledTimes(0);
    await cache.resolve("idle", create);
    expect(create).toHaveBeenCalledTimes(1);

    await cache.invalidate("active");
    expect(active.aborted).toBe(true);
    await cache.dispose();
  });

  it("invalidate parent does not abort an independently resolved worker", async () => {
    const cache = createHostAgentCache([]);
    const parent = fakeAgent();
    const child = fakeAgent();
    await cache.resolve("p", async () => parent);
    await cache.resolve("c", async () => child, { parentSessionId: "p" });

    await cache.invalidate("p");
    expect(parent.aborted).toBe(true);
    expect(child.aborted).toBe(false);

    const create = vi.fn(async () => fakeAgent());
    await cache.resolve("c", create, { parentSessionId: "p" });
    expect(create).toHaveBeenCalledTimes(0);
    await cache.dispose();
  });

  it("invalidateAll skip on a worker does not require holding its summoner", async () => {
    const cache = createHostAgentCache([]);
    const parent = fakeAgent({ busy: false });
    const child = fakeAgent({ busy: true });
    const other = fakeAgent({ busy: false });
    const held: string[] = [];
    await cache.resolve("p", async () => parent);
    await cache.resolve("c", async () => child, { parentSessionId: "p" });
    await cache.resolve("other", async () => other);

    await cache.invalidateAll({
      skip: (id) => id === "c",
      onHold: (id) => held.push(id),
    });
    expect(child.aborted).toBe(false);
    expect(parent.aborted).toBe(true);
    expect(other.aborted).toBe(true);
    expect(held).toEqual([]);
    expect(cache.hasProtectedNestedChild("p", () => true)).toBe(false);

    await cache.invalidate("c");
    expect(child.aborted).toBe(true);
    await cache.dispose();
  });

  it("recreates after a disposed scope instead of returning a stale agent", async () => {
    const cache = createHostAgentCache([]);
    const first = fakeAgent();
    await cache.resolve("c", async () => first, { parentSessionId: "p" });
    // Parent was never resolved — child opened under hostScope. Invalidate drops it.
    await cache.invalidate("c");
    expect(first.aborted).toBe(true);

    const second = fakeAgent();
    const create = vi.fn(async () => second);
    const again = await cache.resolve("c", create, { parentSessionId: "p" });
    expect(again).toBe(second);
    expect(create).toHaveBeenCalledTimes(1);
    await cache.dispose();
  });

  it("falls back to hostScope when the parent is already disposed", async () => {
    const cache = createHostAgentCache([]);
    const parent = fakeAgent();
    await cache.resolve("p", async () => parent);
    await cache.invalidate("p");
    expect(parent.aborted).toBe(true);

    const child = fakeAgent();
    const create = vi.fn(async () => child);
    const resolved = await cache.resolve("c", create, { parentSessionId: "p" });
    expect(resolved).toBe(child);
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

describe("deferBusyAgentInvalidate", () => {
  it("defers badge rebuilds for busy, draining, or materializing sessions and rebuilds idle ones", async () => {
    const deferred: string[] = [];
    const invalidated: string[] = [];
    const sessions = [
      { id: "busy-turn", drainActive: false, busy: true, materializing: false },
      { id: "draining", drainActive: true, busy: false, materializing: false },
      { id: "building", drainActive: false, busy: false, materializing: true },
      { id: "idle", drainActive: false, busy: false, materializing: false },
      { id: "both", drainActive: true, busy: true, materializing: false },
    ];
    for (const row of sessions) {
      await deferBusyAgentInvalidate({
        sessionId: row.id,
        drainActive: row.drainActive,
        busy: row.busy,
        materializing: row.materializing,
        defer: (id) => deferred.push(id),
        invalidate: async (id) => {
          invalidated.push(id);
        },
      });
    }
    expect(deferred).toEqual(["busy-turn", "draining", "building", "both"]);
    expect(invalidated).toEqual(["idle"]);
  });

  it("force tears down even while materializing", async () => {
    const deferred: string[] = [];
    const invalidated: string[] = [];
    await deferBusyAgentInvalidate({
      sessionId: "building",
      drainActive: false,
      busy: false,
      materializing: true,
      force: true,
      defer: (id) => deferred.push(id),
      invalidate: async (id) => {
        invalidated.push(id);
      },
    });
    expect(deferred).toEqual([]);
    expect(invalidated).toEqual(["building"]);
  });
});

describe("createHostAgentCache concurrent resolve", () => {
  it("shares one materialize when two callers resolve the same fresh session", async () => {
    const cache = createHostAgentCache([]);
    const agent = fakeAgent();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const create = vi.fn(async () => {
      await gate;
      return agent;
    });

    const first = cache.resolve("fresh", create);
    const second = cache.resolve("fresh", create);
    // Both callers park inside one build instead of racing to rebuild: the
    // second used to see "scope present, handle absent" and dispose the first.
    expect(cache.isMaterializing("fresh")).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    release();
    const [a1, a2] = await Promise.all([first, second]);
    expect(a1).toBe(agent);
    expect(a2).toBe(agent);
    expect(create).toHaveBeenCalledTimes(1);
    expect(agent.aborted).toBe(false);
    expect(cache.isMaterializing("fresh")).toBe(false);
    await cache.dispose();
  });

  it("keeps a materializing session out of an invalidate-all sweep", async () => {
    const cache = createHostAgentCache([]);
    const agent = fakeAgent();
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const building = cache.resolve("fresh", async () => {
      await gate;
      return agent;
    });
    expect(cache.isMaterializing("fresh")).toBe(true);

    // Mirrors Host's skip: a session mid-build is protected, so a cache-wide
    // invalidate (settings ns change / MCP remount) leaves it alone.
    await cache.invalidateAll({
      skip: (id) => cache.isMaterializing(id),
    });
    release();
    await expect(building).resolves.toBe(agent);
    expect(agent.aborted).toBe(false);
    await cache.dispose();
  });

  it("reports isMaterializing false once a session is cached", async () => {
    const cache = createHostAgentCache([]);
    const agent = fakeAgent();
    await cache.resolve("cached", async () => agent);
    expect(cache.isMaterializing("cached")).toBe(false);
    expect(cache.isBusy("cached")).toBe(false);
    await cache.dispose();
  });
});
