/**
 * Mirrors Host spawn + Settings soft-disable: reconcileManagedProcessPlugins.
 */
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { rmSync } from "node:fs";
import { createPluginLoader } from "@xrkseek/server-loader";
import {
  reconcileManagedProcessPlugins,
  writeDisabledPluginIdsAt,
} from "@xrkseek/server-loader";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

async function writeToolsPlugin(root: string, id: string): Promise<void> {
  const dir = path.join(root, id);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "xrk.plugin.json"),
    JSON.stringify({ id, kind: "tools", entry: "./plugin.mjs" }),
    "utf8",
  );
  await writeFile(
    path.join(dir, "plugin.mjs"),
    `export function createPlugin() {
  return { id: ${JSON.stringify(id)}, kind: "tools", tools: [] };
}
`,
    "utf8",
  );
}

describe("Host soft-disabled process plugins", () => {
  it("skips soft-disabled ids on reconcile (spawn path)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-host-soft-"));
    temps.push(root);
    await writeToolsPlugin(root, "keep-tools");
    await writeToolsPlugin(root, "drop-tools");
    writeDisabledPluginIdsAt(root, new Set(["drop-tools"]));

    const loader = createPluginLoader();
    const kept = await reconcileManagedProcessPlugins(loader, root);
    expect(kept).toEqual(["keep-tools"]);
    expect(loader.list().map((p) => p.id)).toEqual(["keep-tools"]);
  });

  it("never unregisters mcp:* ids even if present in the disabled file", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-host-mcp-soft-"));
    temps.push(root);
    await writeToolsPlugin(root, "keep-tools");
    writeDisabledPluginIdsAt(
      root,
      new Set(["mcp:playwright", "keep-tools"]),
    );

    const loader = createPluginLoader();
    loader.register({
      id: "mcp:playwright",
      kind: "tools",
      tools: [],
    } as never);
    const kept = await reconcileManagedProcessPlugins(loader, root);
    expect([...kept].sort()).toEqual(["mcp:playwright"]);
  });

  it("live-toggles: unload on disable then reload on enable", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-host-live-"));
    temps.push(root);
    await writeToolsPlugin(root, "toggle-tools");
    await writeFile(
      path.join(root, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "toggle-tools": {
            name: "toggle-tools",
            version: "1.0.0",
            kind: "process",
            source: "toggle-tools@1.0.0",
            installedAt: new Date().toISOString(),
          },
        },
      }),
      "utf8",
    );

    const loader = createPluginLoader();
    expect(await reconcileManagedProcessPlugins(loader, root)).toEqual([
      "toggle-tools",
    ]);

    writeDisabledPluginIdsAt(root, new Set(["toggle-tools"]));
    expect(await reconcileManagedProcessPlugins(loader, root)).toEqual([]);

    writeDisabledPluginIdsAt(root, new Set());
    expect(await reconcileManagedProcessPlugins(loader, root)).toEqual([
      "toggle-tools",
    ]);
  });

  it("unregisters process plugins removed from disk (CLI remove)", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "xrk-host-rm-"));
    temps.push(root);
    await writeToolsPlugin(root, "gone-tools");
    const loader = createPluginLoader();
    expect(await reconcileManagedProcessPlugins(loader, root)).toEqual([
      "gone-tools",
    ]);

    rmSync(path.join(root, "gone-tools"), { recursive: true, force: true });
    expect(await reconcileManagedProcessPlugins(loader, root)).toEqual([]);
  });
});
