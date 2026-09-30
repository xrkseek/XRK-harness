import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginInventoryUpdate } from "../src/handlers/remotes.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("pluginInventory/update", () => {
  it("rejects missing entryId", async () => {
    const result = await pluginInventoryUpdate(
      { plugins: [], webPlugins: [], productDir: "/tmp/unused" } as never,
      "rpc-1",
      { args: { entryId: "  " } },
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("invalid-payload");
  });

  it("calls updateUserPlugin then force-remounts via sync", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-inv-upd-"));
    temps.push(home);
    const pluginsDir = join(home, "plugins");
    mkdirSync(join(pluginsDir, "side-tools"), { recursive: true });
    writeFileSync(
      join(pluginsDir, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "side-tools": {
            name: "side-tools",
            version: "1.0.0",
            kind: "process",
            source: "side-tools@1.0.0",
            installedAt: new Date().toISOString(),
          },
        },
      }),
    );
    writeFileSync(
      join(pluginsDir, "side-tools", "xrk.plugin.json"),
      JSON.stringify({ id: "side-tools", kind: "tools", entry: "./plugin.mjs" }),
    );

    const updateUserPlugin = vi.fn(async () => ({ ok: true as const }));
    const syncManagedProcessPlugins = vi.fn(async () => undefined);
    const result = await pluginInventoryUpdate(
      {
        productDir: home,
        plugins: [{ id: "side-tools", kind: "tools" }],
        webPlugins: [],
        updateUserPlugin,
        syncManagedProcessPlugins,
        hostPublic: { pluginsDir },
      } as never,
      "rpc-2",
      { args: { entryId: "side-tools" } },
    );
    expect(result.ok).toBe(true);
    expect(updateUserPlugin).toHaveBeenCalledWith(
      "side-tools@latest",
      expect.objectContaining({ onChunk: expect.any(Function) }),
    );
    expect(syncManagedProcessPlugins).toHaveBeenCalledWith({
      reloadIds: expect.arrayContaining(["side-tools"]),
    });
  });
});
