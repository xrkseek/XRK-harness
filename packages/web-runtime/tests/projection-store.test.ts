import { describe, expect, it, vi } from "vitest";
import { ProjectionStore } from "../src/projection-store.js";

describe("ProjectionStore", () => {
  it("higher-seq-wins; equal or lower seq is dropped", () => {
    const store = new ProjectionStore();
    expect(store.apply("title", "a", 1)).toBe(true);
    expect(store.apply("title", "b", 1)).toBe(false);
    expect(store.apply("title", "c", 0)).toBe(false);
    expect(store.get("title")).toBe("a");
    expect(store.apply("title", "d", 2)).toBe(true);
    expect(store.get("title")).toBe("d");
    expect(store.getRow("title")?.seq).toBe(2);
  });

  it("seed applies baseline and clears omitted keys at-or-before asOfSeq", () => {
    const store = new ProjectionStore();
    store.apply("keep", "old", 1);
    store.apply("drop", "x", 1);
    store.apply("newer", "y", 5);
    store.seed({ asOfSeq: 3, values: { keep: "fresh", added: 1 } });
    expect(store.get("keep")).toBe("fresh");
    expect(store.get("added")).toBe(1);
    expect(store.get("drop")).toBeUndefined();
    expect(store.get("newer")).toBe("y");
  });

  it("truncate drops rows beyond durable lastSeq", () => {
    const store = new ProjectionStore();
    store.apply("a", 1, 2);
    store.apply("b", 2, 9);
    store.truncate(5);
    expect(store.get("a")).toBe(1);
    expect(store.get("b")).toBeUndefined();
  });

  it("clear drops every row", () => {
    const store = new ProjectionStore();
    store.apply("k", 1, 1);
    store.clear();
    expect(store.get("k")).toBeUndefined();
  });
});
