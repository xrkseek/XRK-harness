import { describe, expect, it } from "vitest";
import { normalizeDshCompatWireCtx } from "../src/dsh-compat/wire-normalize.js";

describe("normalizeDshCompatWireCtx", () => {
  it("preserves syncCommunityLlmProvider for WorkBuddy Face sync", () => {
    const syncCommunityLlmProvider = async () => undefined;
    const out = normalizeDshCompatWireCtx({
      pluginsDir: "/plugins",
      xrkHome: "/home",
      syncCommunityLlmProvider,
    });
    expect(out.syncCommunityLlmProvider).toBe(syncCommunityLlmProvider);
    expect(out.pluginsDir).toBe("/plugins");
    expect(out.xrkHome).toBe("/home");
  });
});
