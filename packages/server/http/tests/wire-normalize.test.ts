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

  it("preserves Desktop LAN share hooks for mobile-access control", () => {
    const resolveLoopbackOrigin = () => "http://127.0.0.1:9";
    const getThemePreference = () => "dark" as const;
    const out = normalizeDshCompatWireCtx({
      xrkHome: "/home",
      lanShareEnabled: true,
      trustProxy: true,
      resolveLoopbackOrigin,
      ownLanHosts: ["10.0.0.2"],
      getThemePreference,
    });
    expect(out.lanShareEnabled).toBe(true);
    expect(out.trustProxy).toBe(true);
    expect(out.resolveLoopbackOrigin).toBe(resolveLoopbackOrigin);
    expect(out.ownLanHosts).toEqual(["10.0.0.2"]);
    expect(out.getThemePreference).toBe(getThemePreference);
  });
});
