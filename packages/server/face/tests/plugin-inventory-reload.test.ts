import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginInventoryReload } from "../src/handlers/remotes.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("pluginInventory/reload", () => {
  it("force-remounts a managed entry via syncManagedProcessPlugins", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-inv-reload-"));
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

    const syncManagedProcessPlugins = vi.fn(async () => undefined);
    const result = await pluginInventoryReload(
      {
        productDir: home,
        plugins: [{ id: "side-tools", kind: "tools" }],
        webPlugins: [],
        syncManagedProcessPlugins,
        hostPublic: { pluginsDir },
      } as never,
      "rpc-1",
      { args: { entryId: "side-tools" } },
    );
    expect(result.ok).toBe(true);
    expect(syncManagedProcessPlugins).toHaveBeenCalledWith({
      reloadIds: expect.arrayContaining(["side-tools"]),
    });
  });
});
