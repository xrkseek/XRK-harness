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
    const updateUserPlugin = vi.fn(async () => ({
      ok: true as const,
      stdout: "Progress: done\n",
      stderr: "",
    }));
    const syncManagedProcessPlugins = vi.fn(async () => undefined);
    const runtime = {
      productDir: "/tmp/unused",
      plugins: [],
      webPlugins: [],
      updateUserPlugin,
      syncManagedProcessPlugins,
      hostPublic: { pluginsDir: "/tmp/unused-plugins" },
      bus: { publishHost: vi.fn() },
    };
    const result = await pluginInventoryInstall(runtime as never, "rpc-2", {
      args: { spec: "xrkh-better-sidebar@0.18.9" },
    });
    expect(result.ok).toBe(true);
    expect(updateUserPlugin).toHaveBeenCalledWith(
      "xrkh-better-sidebar@0.18.9",
      expect.objectContaining({ onChunk: expect.any(Function) }),
    );
    expect(syncManagedProcessPlugins).toHaveBeenCalledOnce();
    expect(syncManagedProcessPlugins).toHaveBeenCalledWith({
      reloadIds: expect.arrayContaining(["xrkh-better-sidebar"]),
    });
    if (!result.ok) return;
    expect(result.value).toEqual({
      spec: "xrkh-better-sidebar@0.18.9",
      installed: true,
      command: "xrkh plugin add xrkh-better-sidebar@0.18.9",
      output: "Progress: done",
      exitCode: 0,
    });
  });

  it("forwards registry to updateUserPlugin and command log", async () => {
    const updateUserPlugin = vi.fn(async () => ({
      ok: true as const,
      stdout: "ok\n",
      stderr: "",
    }));
    const syncManagedProcessPlugins = vi.fn(async () => undefined);
    const result = await pluginInventoryInstall(
      {
        productDir: "/tmp/unused",
        plugins: [],
        webPlugins: [],
        updateUserPlugin,
        syncManagedProcessPlugins,
        hostPublic: { pluginsDir: "/tmp/unused-plugins" },
        bus: { publishHost: vi.fn() },
      } as never,
      "rpc-reg",
      {
        args: {
          spec: "xrkh-better-sidebar",
          registry: "https://registry.npmmirror.com/",
        },
      },
    );
    expect(result.ok).toBe(true);
    expect(updateUserPlugin).toHaveBeenCalledWith(
      "xrkh-better-sidebar",
      expect.objectContaining({
        registry: "https://registry.npmmirror.com/",
        onChunk: expect.any(Function),
      }),
    );
    if (!result.ok) return;
    expect(result.value.command).toBe(
      "xrkh plugin add --registry https://registry.npmmirror.com/ xrkh-better-sidebar",
    );
  });

  it("publishes install-log chunks through Face bus", async () => {
    const publishHost = vi.fn();
    const updateUserPlugin = vi.fn(async (_spec, options?: {
      onChunk?: (chunk: { stream: "stdout" | "stderr"; text: string }) => void
    }) => {
      options?.onChunk?.({ stream: "stdout", text: "Progress\n" });
      return { ok: true as const, stdout: "Progress\n", stderr: "" };
    });
    const result = await pluginInventoryInstall(
      {
        productDir: "/tmp/unused",
        plugins: [],
        webPlugins: [],
        updateUserPlugin,
        syncManagedProcessPlugins: vi.fn(async () => undefined),
        hostPublic: { pluginsDir: "/tmp/unused-plugins" },
        bus: { publishHost },
      } as never,
      "rpc-stream",
      { args: { spec: "pkg", requestId: "req-1" } },
    );
    expect(result.ok).toBe(true);
    expect(publishHost).toHaveBeenCalledWith({
      type: "host/remote-event",
      event: "plugin-inventory/install-log",
      args: ["req-1", "stdout", "Progress\n"],
    });
  });

  it("surfaces Host mutate failures with CLI log details", async () => {
    const result = await pluginInventoryInstall(
      {
        updateUserPlugin: async () => ({
          ok: false as const,
          error: "npm pack failed",
          stdout: "",
          stderr: "ERR_PNPM_FETCH_404\n",
        }),
        bus: { publishHost: vi.fn() },
      } as never,
      "rpc-3",
      { args: { spec: "missing-pkg" } },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("failed");
    expect(result.error.message).toContain("npm pack failed");
    expect(result.error.details).toEqual({
      command: "xrkh plugin add missing-pkg",
      output: "ERR_PNPM_FETCH_404",
      exitCode: 1,
    });
  });
});
