import { describe, expect, it } from "vitest";
import { BootGate } from "../src/boot-gate.js";

describe("BootGate", () => {
  it("settles only when every entry is active", () => {
    const gate = new BootGate();
    gate.register("a");
    gate.register("b");
    gate.mark("a", "active");
    expect(gate.getSnapshot().phase).toBe("booting");
    gate.mark("b", "active");
    expect(gate.getSnapshot().phase).toBe("settled");
  });

  it("fails loud when any entry fails", () => {
    const gate = new BootGate();
    gate.register("a");
    gate.register("b");
    gate.mark("a", "failed");
    expect(gate.getSnapshot().phase).toBe("failed");
    expect(gate.getSnapshot().report).toContain("a");
    gate.mark("b", "active");
    expect(gate.getSnapshot().phase).toBe("failed");
  });

  it("settles when register(id, active) completes the set", () => {
    const gate = new BootGate();
    gate.register("only", "active");
    expect(gate.getSnapshot().phase).toBe("settled");
  });

  it("getSnapshot returns the same reference until the next mutation", () => {
    const gate = new BootGate();
    gate.register("a", "loading");
    const a = gate.getSnapshot();
    const b = gate.getSnapshot();
    expect(a).toBe(b);
    gate.mark("a", "active");
    expect(gate.getSnapshot()).not.toBe(a);
  });
});
