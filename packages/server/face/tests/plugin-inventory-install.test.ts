import { describe, expect, it, vi } from "vitest";
import { pluginInventoryInstall } from "../src/handlers/remotes.js";

describe("pluginInventory/install", () => {
  it("rejects empty spec", async () => {
    const result = await pluginInventoryInstall(
      { updateUserPlugin: vi.fn() } as never,
      "rpc-1",
      { args: { spec: "  " } },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid-payload");
  });

  it("calls updateUserPlugin then syncs process plugins", async () => {
    const updateUserPlugin = vi.fn(async () => ({ ok: true as const }));
    const syncManagedProcessPlugins = vi.fn(async () => undefined);
    const runtime = {
      productDir: "/tmp/unused",
      plugins: [],
      webPlugins: [],
      updateUserPlugin,
      syncManagedProcessPlugins,
      hostPublic: { pluginsDir: "/tmp/unused-plugins" },
    };
    const result = await pluginInventoryInstall(runtime as never, "rpc-2", {
      args: { spec: "xrkh-better-sidebar@0.18.9" },
    });
    expect(result.ok).toBe(true);
    expect(updateUserPlugin).toHaveBeenCalledWith("xrkh-better-sidebar@0.18.9");
    expect(syncManagedProcessPlugins).toHaveBeenCalledOnce();
    if (!result.ok) return;
    expect(result.value).toEqual({
      spec: "xrkh-better-sidebar@0.18.9",
      installed: true,
    });
  });

  it("surfaces Host mutate failures", async () => {
    const result = await pluginInventoryInstall(
      {
        updateUserPlugin: async () => ({
          ok: false as const,
          error: "npm pack failed",
        }),
      } as never,
      "rpc-3",
      { args: { spec: "missing-pkg" } },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("failed");
    expect(result.error.message).toContain("npm pack failed");
  });
});
