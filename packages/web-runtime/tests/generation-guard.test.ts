import { describe, expect, it } from "vitest";
import { GenerationGuard } from "../src/generation-guard.js";

describe("GenerationGuard", () => {
  it("bump advances and isCurrent gates stale tokens", () => {
    const g = new GenerationGuard();
    const t1 = g.bump();
    expect(g.isCurrent(t1)).toBe(true);
    const t2 = g.bump();
    expect(g.isCurrent(t1)).toBe(false);
    expect(g.isCurrent(t2)).toBe(true);
    expect(g.current()).toBe(t2);
  });

  it("run drops result when generation bumped mid-flight", async () => {
    const g = new GenerationGuard();
    let resolveInner!: (v: string) => void;
    const pending = new Promise<string>((r) => {
      resolveInner = r;
    });
    const p = g.run(async () => pending);
    g.bump();
    resolveInner("late");
    expect(await p).toBeUndefined();
  });

  it("run returns value when still current", async () => {
    const g = new GenerationGuard();
    const value = await g.run(async () => "ok");
    expect(value).toBe("ok");
  });
});
