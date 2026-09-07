import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pluginInventorySetEnabled } from "../src/handlers/remotes.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("pluginInventory/setEnabled", () => {
  it("writes soft-disable then awaits Host syncManagedProcessPlugins", async () => {
    const productDir = mkdtempSync(path.join(tmpdir(), "xrk-set-enabled-"));
    temps.push(productDir);
    const plugins = path.join(productDir, "plugins");
    mkdirSync(plugins, { recursive: true });
    writeFileSync(
      path.join(plugins, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "proc-tools": {
            name: "proc-tools",
            version: "1.0.0",
            kind: "process",
            source: "proc-tools@1.0.0",
            installedAt: new Date().toISOString(),
          },
        },
      }),
    );
    const syncManagedProcessPlugins = vi.fn(async () => undefined);
    const runtime = {
      productDir,
      plugins: [{ id: "proc-tools", kind: "tools" }],
      webPlugins: [],
      hostPublic: { pluginsDir: plugins },
      syncManagedProcessPlugins,
    } as never;

    const result = await pluginInventorySetEnabled(runtime, "rpc-1", {
      entryId: "proc-tools",
      enabled: false,
    });
    expect(result.ok).toBe(true);
    expect(syncManagedProcessPlugins).toHaveBeenCalledTimes(1);
  });
});
