import { describe, expect, it, vi } from "vitest";
import {
  bindDisposable,
  ComposeInjectError,
  ComposeStateError,
  createRootScope,
  openSubagentRealm,
  ScopeState,
} from "../src/index.js";

describe("createRootScope", () => {
  it("starts Active", () => {
    const root = createRootScope({ id: "r" });
    expect(root.id).toBe("r");
    expect(root.state).toBe(ScopeState.Active);
    expect(root.parent).toBeNull();
  });
});

describe("effect LIFO", () => {
  it("runs disposers in reverse order", async () => {
    const root = createRootScope();
    const order: number[] = [];
    root.effect(() => () => {
      order.push(1);
    });
    root.effect(() => () => {
      order.push(2);
    });
    await root.dispose();
    expect(order).toEqual([2, 1]);
    expect(root.state).toBe(ScopeState.Disposed);
  });

  it("rejects effect after dispose", async () => {
    const root = createRootScope();
    await root.dispose();
    expect(() => root.effect(() => () => undefined)).toThrow(ComposeStateError);
  });
});

describe("child + parent dispose", () => {
  it("disposes children before parent effects", async () => {
    const root = createRootScope();
    const order: string[] = [];
    root.effect(() => () => {
      order.push("root-effect");
    });
    const child = root.child({ id: "c" });
    await child.activate(() => {
      child.effect(() => () => {
        order.push("child-effect");
      });
    });
    await root.dispose();
    expect(order).toEqual(["child-effect", "root-effect"]);
    expect(child.state).toBe(ScopeState.Disposed);
  });
});

describe("provide / inject / depend", () => {
  it("resolves same-realm provide", async () => {
    const root = createRootScope();
    root.provide("db", { url: "x" });
    expect(root.inject<{ url: string }>("db").url).toBe("x");
  });

  it("Pending when depend missing; Active when provided", async () => {
    const root = createRootScope();
    const child = root.child({ id: "worker", depend: [{ name: "llm" }] });
    await child.activate();
    expect(child.state).toBe(ScopeState.Pending);

    root.provide("llm", { id: 1 });
    await child.activate(() => {
      expect(child.inject<{ id: number }>("llm").id).toBe(1);
    });
    expect(child.state).toBe(ScopeState.Active);
  });

  it("inject throws when missing while Active", () => {
    const root = createRootScope();
    expect(() => root.inject("nope")).toThrow(ComposeInjectError);
    expect(root.tryInject("nope")).toBeUndefined();
  });

  it("inject rejects before activate", async () => {
    const root = createRootScope();
    const child = root.child();
    expect(() => child.inject("x")).toThrow(ComposeStateError);
  });
});

describe("isolate realm", () => {
  it("hides parent provide under different label", async () => {
    const root = createRootScope();
    root.provide("fs", "host-fs");
    const sand = root.child({
      id: "sand",
      isolate: [{ name: "fs", label: "box" }],
    });
    await sand.activate(() => {
      sand.provide("fs", "sand-fs", { label: "box" });
    });
    expect(sand.inject<string>("fs")).toBe("sand-fs");
    expect(root.inject<string>("fs")).toBe("host-fs");
    // Explicit root realm still sees host provide.
    expect(sand.tryInject<string>("fs", { label: undefined })).toBe("host-fs");
  });
});

describe("Ordering", () => {
  it("consumer disposer can still inject while provider unloads", async () => {
    const root = createRootScope();
    root.provide("pool", { open: true });

    const consumer = root.child({ id: "conn", depend: [{ name: "pool" }] });
    const seen: boolean[] = [];
    await consumer.activate(() => {
      consumer.effect(() => () => {
        const pool = consumer.inject<{ open: boolean }>("pool");
        seen.push(pool.open);
      });
    });

    await root.dispose();
    expect(seen).toEqual([true]);
    expect(consumer.state).toBe(ScopeState.Disposed);
    expect(() => consumer.inject("pool")).toThrow(ComposeStateError);
  });

  it("disposes consumer before provider effect cleanup order", async () => {
    const root = createRootScope();
    const order: string[] = [];
    root.provide("svc", 1);
    root.effect(() => () => {
      order.push("provider-extra");
    });

    const consumer = root.child({ depend: [{ name: "svc" }] });
    await consumer.activate(() => {
      consumer.effect(() => () => {
        order.push("consumer");
        consumer.inject("svc");
      });
    });

    await root.dispose();
    expect(order[0]).toBe("consumer");
    expect(order).toContain("provider-extra");
  });
});

describe("inertia", () => {
  it("concurrent dispose shares one pass", async () => {
    const root = createRootScope();
    let runs = 0;
    root.effect(() => async () => {
      runs += 1;
      await Promise.resolve();
    });
    await Promise.all([root.dispose(), root.dispose(), root.dispose()]);
    expect(runs).toBe(1);
    await root.dispose();
    expect(runs).toBe(1);
  });
});

describe("sibling recovery", () => {
  it("disposing one child does not run the other child disposer twice", async () => {
    const root = createRootScope();
    const a = root.child({ id: "a" });
    const b = root.child({ id: "b" });
    let aRuns = 0;
    let bRuns = 0;
    await a.activate(() => {
      a.effect(() => () => {
        aRuns += 1;
      });
    });
    await b.activate(() => {
      b.effect(() => () => {
        bRuns += 1;
      });
    });
    await a.dispose();
    expect(aRuns).toBe(1);
    expect(bRuns).toBe(0);
    expect(b.state).toBe(ScopeState.Active);
    await root.dispose();
    expect(bRuns).toBe(1);
    expect(aRuns).toBe(1);
  });
});

describe("bindDisposable", () => {
  it("registers unsubscribe as effect", async () => {
    const root = createRootScope();
    let live = true;
    bindDisposable(root, () => () => {
      live = false;
    });
    await root.dispose();
    expect(live).toBe(false);
  });
});

describe("whenReady", () => {
  it("activates after late provide", async () => {
    const root = createRootScope();
    const child = root.child({ depend: [{ name: "llm" }] });
    let fired = false;
    child.whenReady(() => {
      fired = true;
    });
    expect(child.state).toBe(ScopeState.Pending);
    expect(fired).toBe(false);
    root.provide("llm", { ok: true });
    // whenReady kick is async after provide notify
    await vi.waitFor(() => {
      expect(child.state).toBe(ScopeState.Active);
      expect(fired).toBe(true);
    });
    await root.dispose();
  });
});

describe("C2 interceptInject", () => {
  it("wraps inject LIFO and disposer removes wrapper", async () => {
    const root = createRootScope();
    root.provide("svc", 1);
    const order: string[] = [];
    const stopOuter = root.interceptInject((ctx, next) => {
      order.push(`outer:${String(ctx.key)}`);
      return (next() as number) + 10;
    });
    root.interceptInject((_ctx, next) => {
      order.push("inner");
      return (next() as number) * 2;
    });
    expect(root.inject<number>("svc")).toBe(22);
    expect(order).toEqual(["inner", "outer:svc"]);
    stopOuter();
    order.length = 0;
    expect(root.inject<number>("svc")).toBe(2);
    expect(order).toEqual(["inner"]);
    await root.dispose();
  });
});

describe("C2 openSubagentRealm", () => {
  it("opens a child scope id under parent", async () => {
    const root = createRootScope();
    root.provide("host", { ok: true });
    const realm = openSubagentRealm(root, { sessionId: "s1" });
    expect(realm.id).toBe("subagent:s1");
    expect(realm.parent).toBe(root);
    await realm.activate();
    expect(realm.inject("host")).toEqual({ ok: true });
    await root.dispose();
    expect(realm.state).toBe(ScopeState.Disposed);
  });

  it("rejects empty sessionId", () => {
    const root = createRootScope();
    expect(() => openSubagentRealm(root, { sessionId: "  " })).toThrow(
      /sessionId required/,
    );
  });

  it("can isolate a parent provide", async () => {
    const root = createRootScope();
    root.provide("fs", "host-fs");
    const realm = openSubagentRealm(root, {
      sessionId: "iso",
      isolate: [{ name: "fs", label: "box" }],
    });
    await realm.activate(() => {
      realm.provide("fs", "child-fs", { label: "box" });
    });
    expect(realm.inject<string>("fs")).toBe("child-fs");
    expect(root.inject<string>("fs")).toBe("host-fs");
    await root.dispose();
  });
});

describe("activate failure", () => {
  it("moves to Failed and rethrows", async () => {
    const root = createRootScope();
    const child = root.child();
    await expect(
      child.activate(() => {
        throw new Error("boom");
      }),
    ).rejects.toThrow(/boom/);
    expect(child.state).toBe(ScopeState.Failed);
    expect((child.failReason as Error).message).toBe("boom");
  });
});
