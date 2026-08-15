import { describe, expect, it } from "vitest";
import { SlotRegistry } from "../src/slot-registry.js";

describe("SlotRegistry", () => {
  it("requires declaration before register", () => {
    const slots = new SlotRegistry();
    expect(() =>
      slots.register({ name: "toolbar" }, "x"),
    ).toThrow(/not declared/);
  });

  it("single kind: one occupant per priority; shadowing by lower priority", () => {
    const slots = new SlotRegistry();
    slots.define("pane", { kind: "single", scope: "root" });
    const disposeA = slots.register(
      { name: "pane", priority: 10, registrant: "a" },
      "A",
    );
    slots.register({ name: "pane", priority: 0, registrant: "b" }, "B");
    expect(slots.entriesOfSlot("pane").map((e) => e.contribution)).toEqual([
      "B",
    ]);
    disposeA();
    expect(slots.entriesOfSlot("pane").map((e) => e.contribution)).toEqual([
      "B",
    ]);
    expect(() =>
      slots.register({ name: "pane", priority: 0 }, "C"),
    ).toThrow(/already has a registration/);
  });

  it("list kind: unique id, order sort, shadowing per id", () => {
    const slots = new SlotRegistry();
    slots.define("items", { kind: "list", scope: "root" });
    slots.register({ name: "items", id: "b", order: 20 }, "B");
    slots.register({ name: "items", id: "a", order: 10 }, "A");
    slots.register(
      { name: "items", id: "a", order: 10, priority: 5 },
      "A-shadow",
    );
    expect(slots.entriesOfSlot("items").map((e) => e.contribution)).toEqual([
      "A",
      "B",
    ]);
  });

  it("keyed kind: unique key per priority", () => {
    const slots = new SlotRegistry();
    slots.define("byType", { kind: "keyed", scope: "session" });
    slots.register({ name: "byType", key: "tool" }, "tool-view");
    slots.register({ name: "byType", key: "notice" }, "notice-view");
    expect(slots.entriesOfSlot("byType").map((e) => e.options.key)).toEqual([
      "tool",
      "notice",
    ]);
    expect(() =>
      slots.register({ name: "byType", key: "tool" }, "dup"),
    ).toThrow(/already has an entry/);
  });

  it("chain kind: elect by select", () => {
    const slots = new SlotRegistry();
    slots.define("router", { kind: "chain", scope: "session" });
    slots.register(
      {
        name: "router",
        select: (o: { kind: string }) =>
          o.kind === "a" ? "matched" : null,
        priority: 0,
      },
      "A",
    );
    slots.register(
      {
        name: "router",
        select: (o: { kind: string }) =>
          o.kind === "b" ? "matched" : null,
        priority: 1,
      },
      "B",
    );
    expect(slots.electChain("router", { kind: "b" })?.contribution).toBe("B");
    expect(slots.electChain("router", { kind: "z" })).toBeUndefined();
  });

  it("children declare + cascade dispose", () => {
    const slots = new SlotRegistry();
    const dispose = slots.register(
      {
        name: "root",
        children: {
          chrome: { kind: "list", scope: "root" },
        },
        registrant: "shell",
      },
      "shell",
    );
    expect(slots.spec("chrome")?.kind).toBe("list");
    slots.register({ name: "chrome", id: "nav" }, "nav");
    expect(slots.entries("chrome")).toHaveLength(1);
    dispose();
    expect(slots.spec("chrome")).toBeUndefined();
    expect(slots.entries("chrome")).toHaveLength(0);
  });

  it("abdicate retires cell winner", () => {
    const slots = new SlotRegistry();
    slots.define("pane", { kind: "single", scope: "root" });
    slots.register({ name: "pane", priority: 0 }, "primary");
    const shadow = slots.register({ name: "pane", priority: 10 }, "backup");
    void shadow;
    const [head] = slots.entriesOfSlot("pane");
    expect(head?.contribution).toBe("primary");
    slots.reportEntryError("pane", head!, new Error("boom"), {
      abdicate: true,
    });
    expect(slots.entriesOfSlot("pane").map((e) => e.contribution)).toEqual([
      "backup",
    ]);
    expect(slots.entries("pane")).toHaveLength(2);
  });

  it("store handle cannot cross scopes", () => {
    const slots = new SlotRegistry();
    slots.define("a", { kind: "single", scope: "root" });
    slots.define("b", { kind: "single", scope: "session" });
    const handle = {};
    slots.register({ name: "a", store: handle }, 1);
    expect(() =>
      slots.register({ name: "b", store: handle }, 2),
    ).toThrow(/one handle, one scope/);
  });
});
