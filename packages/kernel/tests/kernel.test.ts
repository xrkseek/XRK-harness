import { describe, expect, it } from "vitest";
import {
  applyPatches,
  createContext,
  createEventBus,
  createPluginRegistry,
  definePlugin,
  getPatchedConfig,
  pluginId,
} from "../src/index.js";

describe("createContext", () => {
  it("sets and gets services", () => {
    const ctx = createContext("t");
    ctx.set("n", 42);
    expect(ctx.get<number>("n")).toBe(42);
    expect(ctx.has("n")).toBe(true);
    expect(ctx.has("missing")).toBe(false);
    expect(ctx.getOptional<string>("missing")).toBeUndefined();
  });

  it("throws on missing get (string and symbol keys)", () => {
    const ctx = createContext();
    expect(() => ctx.get("x")).toThrow(/not found/);
    const sym = Symbol("svc");
    expect(() => ctx.get(sym)).toThrow(/Symbol\(svc\)/);
  });

  it("runs disposers in reverse order", async () => {
    const ctx = createContext();
    const order: number[] = [];
    ctx.onDispose(() => {
      order.push(1);
    });
    ctx.onDispose(async () => {
      order.push(2);
    });
    await ctx.dispose();
    expect(order).toEqual([2, 1]);
    expect(() => ctx.set("a", 1)).toThrow(/disposed/);
    expect(() => ctx.has("a")).toThrow(/disposed/);
    expect(() => ctx.getOptional("a")).toThrow(/disposed/);
    expect(() => ctx.onDispose(() => undefined)).toThrow(/disposed/);
    await ctx.dispose();
  });
});

describe("definePlugin + registry", () => {
  it("rejects empty id", () => {
    expect(() => definePlugin({ id: "  ", setup: () => undefined })).toThrow();
  });

  it("registers and tears down", async () => {
    const ctx = createContext();
    const registry = createPluginRegistry(ctx);
    let live = false;
    const plugin = definePlugin({
      id: "demo",
      setup: () => {
        live = true;
        ctx.set("demo", true);
      },
      teardown: () => {
        live = false;
      },
    });
    await registry.register(plugin);
    expect(registry.has("demo")).toBe(true);
    expect(registry.list()).toEqual([pluginId("demo")]);
    expect(live).toBe(true);
    await registry.unregister(pluginId("demo"));
    expect(registry.has("demo")).toBe(false);
    expect(live).toBe(false);
  });

  it("rejects duplicate id and missing unregister", async () => {
    const ctx = createContext();
    const registry = createPluginRegistry(ctx);
    const p = definePlugin({ id: "x", setup: () => undefined });
    await registry.register(p);
    await expect(registry.register(p)).rejects.toThrow(/already registered/);
    await expect(registry.unregister("missing")).rejects.toThrow(
      /not registered/,
    );
  });

  it("context dispose tears down still-registered plugins", async () => {
    const ctx = createContext();
    const registry = createPluginRegistry(ctx);
    let torn = false;
    await registry.register(
      definePlugin({
        id: "linger",
        setup: () => undefined,
        teardown: () => {
          torn = true;
        },
      }),
    );
    expect(registry.has("linger")).toBe(true);
    await ctx.dispose();
    expect(torn).toBe(true);
    expect(registry.has("linger")).toBe(false);
  });

  it("definePlugin omits teardown when absent", () => {
    const p = definePlugin({ id: "bare", setup: () => undefined });
    expect(p.teardown).toBeUndefined();
  });
});

describe("event bus", () => {
  it("emit invokes listeners and no-ops when empty", async () => {
    const bus = createEventBus();
    await bus.emit("none", 1);
    const seen: number[] = [];
    const off = bus.on<number>("n", (n) => {
      seen.push(n);
    });
    await bus.emit("n", 7);
    off();
    await bus.emit("n", 8);
    expect(seen).toEqual([7]);
  });

  it("waterfall requires next()", async () => {
    const bus = createEventBus();
    bus.onWaterfall<number>("w", async () => 1);
    await expect(bus.waterfall("w", 0)).rejects.toThrow(/must call next/);
  });

  it("waterfall transforms through next", async () => {
    const bus = createEventBus();
    bus.onWaterfall<number>("w", async (n, next) => next(n + 1));
    bus.onWaterfall<number>("w", async (n, next) => next(n * 10));
    expect(await bus.waterfall("w", 2)).toBe(30);
  });

  it("waterfall rejects double next()", async () => {
    const bus = createEventBus();
    bus.onWaterfall<number>("w", async (n, next) => {
      await next(n + 1);
      await next(n + 2);
      return n;
    });
    await expect(bus.waterfall("w", 0)).rejects.toThrow(/more than once/);
  });

  it("waterfall with no handlers returns payload", async () => {
    const bus = createEventBus();
    expect(await bus.waterfall("empty", 9)).toBe(9);
  });

  it("waterfall unsubscribe removes handler", async () => {
    const bus = createEventBus();
    const off = bus.onWaterfall<number>("w", async (n, next) => next(n + 1));
    bus.onWaterfall<number>("w", async (n, next) => next(n * 10));
    off();
    expect(await bus.waterfall("w", 2)).toBe(20);
  });

  it("serial runs in order and supports unsubscribe", async () => {
    const bus = createEventBus();
    const order: string[] = [];
    bus.onSerial("s", async () => {
      order.push("a");
    });
    const offB = bus.onSerial("s", async () => {
      order.push("b");
    });
    await bus.serial("s", null);
    offB();
    await bus.serial("none", null);
    await bus.serial("s", null);
    expect(order).toEqual(["a", "b", "a"]);
  });
});

describe("applyPatches", () => {
  it("later layer replaces by id wholesale", () => {
    const base = [
      { id: "llm", config: { model: "a", nested: { k: 1 } } },
      { id: "tools", config: { list: ["r"] } },
    ];
    const home = [{ id: "llm", config: { model: "b", nested: { k: 9 } } }];
    const out = applyPatches(base, home);
    expect(out.find((e) => e.id === "llm")?.config).toEqual({
      model: "b",
      nested: { k: 9 },
    });
    expect(out.find((e) => e.id === "tools")?.config).toEqual({ list: ["r"] });
    expect(getPatchedConfig("llm", base, home)).toEqual({
      model: "b",
      nested: { k: 9 },
    });
    expect(getPatchedConfig("missing", base)).toBeUndefined();
  });

  it("does not deep-merge nested objects", () => {
    const base = [{ id: "x", config: { a: 1, b: { c: 1, d: 1 } } }];
    const patch = [{ id: "x", config: { b: { c: 2 } } }];
    const cfg = applyPatches(base, patch).find((e) => e.id === "x")?.config as {
      a?: number;
      b: { c: number; d?: number };
    };
    expect(cfg.a).toBeUndefined();
    expect(cfg.b).toEqual({ c: 2 });
  });

  it("rejects empty patch ids", () => {
    expect(() => applyPatches([{ id: "", config: {} }])).toThrow(/non-empty/);
    expect(() =>
      applyPatches([{ id: "ok", config: 1 }], [{ id: "", config: 2 }]),
    ).toThrow(/non-empty/);
  });
});
