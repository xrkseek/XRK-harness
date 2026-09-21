import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPluginLoader } from "../src/index.js";
import {
  canonicalizeDisabledPluginIdsAt,
  clearSoftDisabledIdsAt,
  isPluginSoftDisabledAt,
  lookupManagedPluginSourceAt,
  readDisabledPluginIdsAt,
  readManagedPackageIndexAt,
  readManagedPluginPackagesAt,
  reconcileManagedProcessPlugins,
  setSoftDisabledAt,
  writeDisabledPluginIdsAt,
} from "../src/managed-state.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function writeInventory(
  root: string,
  packages: Record<string, Record<string, unknown>>,
): void {
  writeFileSync(
    path.join(root, ".xrk-plugins.json"),
    JSON.stringify({ rev: 1, packages }),
  );
}

describe("managed-state soft-disable", () => {
  it("canonicalizes alias ids to inventory package names and drops orphans", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-loader-canon-"));
    temps.push(root);
    writeInventory(root, {
      "alias-key": {
        name: "xrkh-better-sidebar",
        version: "1.0.0",
        kind: "client",
      },
    });
    const disabled = new Set(["alias-key", "ghost", "xrkh-better-sidebar"]);
    const changed = canonicalizeDisabledPluginIdsAt(root, disabled);
    expect(changed).toBe(true);
    expect([...disabled]).toEqual(["xrkh-better-sidebar"]);
  });

  it("setSoftDisabledAt writes the durable name and strips aliases", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-loader-set-"));
    temps.push(root);
    writeInventory(root, {
      side: { name: "side", version: "1.0.0", kind: "client" },
    });
    writeDisabledPluginIdsAt(root, new Set(["stale-alias", "side"]));
    setSoftDisabledAt(root, {
      enabled: false,
      entryId: "side",
      aliases: ["stale-alias"],
    });
    expect([...readDisabledPluginIdsAt(root)]).toEqual(["side"]);

    setSoftDisabledAt(root, {
      enabled: true,
      entryId: "side",
      aliases: ["stale-alias"],
    });
    expect(readDisabledPluginIdsAt(root).size).toBe(0);
  });

  it("clearSoftDisabledIdsAt clears alias rows that resolve to the package", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-loader-clear-"));
    temps.push(root);
    writeInventory(root, {
      "pkg-key": { name: "pkg-name", version: "1.0.0", kind: "client" },
    });
    writeDisabledPluginIdsAt(root, new Set(["pkg-key"]));
    expect(clearSoftDisabledIdsAt(root, "pkg-name")).toBe(true);
    expect(readDisabledPluginIdsAt(root).size).toBe(0);
  });

  it("isPluginSoftDisabledAt matches loader id against package-name disable", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-loader-match-"));
    temps.push(root);
    writeInventory(root, {
      "loader-id": { name: "pkg-name", version: "1.0.0", kind: "process" },
    });
    const index = readManagedPackageIndexAt(root);
    const disabled = new Set(["pkg-name"]);
    expect(isPluginSoftDisabledAt("loader-id", disabled, index)).toBe(true);
    expect(isPluginSoftDisabledAt("pkg-name", disabled, index)).toBe(true);
    expect(isPluginSoftDisabledAt("other", disabled, index)).toBe(false);
  });

  it("reconcileManagedProcessPlugins matches soft-disable via inventory alias", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-loader-unload-"));
    temps.push(root);
    writeInventory(root, {
      "drop-tools": { name: "drop-tools", version: "1.0.0", kind: "process" },
    });
    mkdirSync(path.join(root, "drop-tools"), { recursive: true });
    writeFileSync(
      path.join(root, "drop-tools", "xrk.plugin.json"),
      JSON.stringify({
        id: "drop-tools",
        kind: "tools",
        entry: "./plugin.mjs",
      }),
    );
    writeFileSync(
      path.join(root, "drop-tools", "plugin.mjs"),
      `export function createPlugin() {
  return { id: "drop-tools", kind: "tools", tools: [] };
}
`,
    );
    mkdirSync(path.join(root, "keep-tools"), { recursive: true });
    writeFileSync(
      path.join(root, "keep-tools", "xrk.plugin.json"),
      JSON.stringify({
        id: "keep-tools",
        kind: "tools",
        entry: "./plugin.mjs",
      }),
    );
    writeFileSync(
      path.join(root, "keep-tools", "plugin.mjs"),
      `export function createPlugin() {
  return { id: "keep-tools", kind: "tools", tools: [] };
}
`,
    );
    writeDisabledPluginIdsAt(root, new Set(["drop-tools"]));
    const loader = createPluginLoader();
    const kept = await reconcileManagedProcessPlugins(loader, root);
    expect(kept.ids).toEqual(["keep-tools"]);
  });

  it("readManagedPluginPackagesAt + lookupManagedPluginSourceAt", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-loader-pkgs-"));
    temps.push(root);
    writeInventory(root, {
      "key-id": {
        name: "pretty",
        version: "2.0.0",
        kind: "client",
        source: "github:org/pretty",
        clientInject: ["@xrkseek/client-runtime"],
      },
    });
    const packages = readManagedPluginPackagesAt(root);
    expect(packages.get("pretty")?.version).toBe("2.0.0");
    expect(packages.get("pretty")?.clientInject).toEqual([
      "@xrkseek/client-runtime",
    ]);
    expect(lookupManagedPluginSourceAt(root, "key-id")).toBe(
      "github:org/pretty",
    );
    expect(lookupManagedPluginSourceAt(root, "pretty")).toBe(
      "github:org/pretty",
    );
  });

  it("writeDisabledPluginIdsAt is content-stable", () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-loader-stable-"));
    temps.push(root);
    writeDisabledPluginIdsAt(root, new Set(["a", "b"]));
    const file = path.join(root, ".xrk-plugins-disabled.json");
    const first = readFileSync(file, "utf8");
    writeDisabledPluginIdsAt(root, new Set(["b", "a"]));
    expect(readFileSync(file, "utf8")).toBe(first);
  });

  it("reconcileManagedProcessPlugins loads enabled and skips disabled", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-loader-reconcile-"));
    temps.push(root);
    for (const id of ["keep-tools", "drop-tools"]) {
      mkdirSync(path.join(root, id), { recursive: true });
      writeFileSync(
        path.join(root, id, "xrk.plugin.json"),
        JSON.stringify({ id, kind: "tools", entry: "./plugin.mjs" }),
      );
      writeFileSync(
        path.join(root, id, "plugin.mjs"),
        `export function createPlugin() {
  return { id: ${JSON.stringify(id)}, kind: "tools", tools: [] };
}
`,
      );
    }
    writeDisabledPluginIdsAt(root, new Set(["drop-tools"]));
    const loader = createPluginLoader();
    const kept = await reconcileManagedProcessPlugins(loader, root);
    expect(kept.ids).toEqual(["keep-tools"]);
  });

  it("optional load failure does not block siblings; required fails closed", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-loader-opt-"));
    temps.push(root);
    mkdirSync(path.join(root, "good"), { recursive: true });
    writeFileSync(
      path.join(root, "good", "xrk.plugin.json"),
      JSON.stringify({ id: "good", kind: "tools", entry: "./plugin.mjs" }),
    );
    writeFileSync(
      path.join(root, "good", "plugin.mjs"),
      `export function createPlugin() {
  return { id: "good", kind: "tools", tools: [] };
}
`,
    );
    mkdirSync(path.join(root, "broken"), { recursive: true });
    writeFileSync(
      path.join(root, "broken", "xrk.plugin.json"),
      JSON.stringify({
        id: "broken",
        kind: "tools",
        entry: "./missing.mjs",
      }),
    );

    const loader = createPluginLoader();
    const result = await reconcileManagedProcessPlugins(loader, root);
    expect(result.ids).toEqual(["good"]);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0]?.id).toBe("broken");
    expect(result.failures[0]?.required).toBe(false);

    mkdirSync(path.join(root, "must"), { recursive: true });
    writeFileSync(
      path.join(root, "must", "xrk.plugin.json"),
      JSON.stringify({
        id: "must",
        kind: "tools",
        entry: "./missing.mjs",
        required: true,
      }),
    );
    const { RequiredPluginLoadError } = await import("../src/index.js");
    await expect(reconcileManagedProcessPlugins(loader, root)).rejects.toThrow(
      RequiredPluginLoadError,
    );
  });

  it("soft-disable unload pairs dispose", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-loader-dispose-"));
    temps.push(root);
    mkdirSync(path.join(root, "drop-tools"), { recursive: true });
    writeFileSync(
      path.join(root, "drop-tools", "xrk.plugin.json"),
      JSON.stringify({
        id: "drop-tools",
        kind: "tools",
        entry: "./plugin.mjs",
      }),
    );
    writeFileSync(
      path.join(root, "drop-tools", "plugin.mjs"),
      `export function createPlugin() {
  return { id: "drop-tools", kind: "tools", tools: [] };
}
`,
    );
    const loader = createPluginLoader();
    await reconcileManagedProcessPlugins(loader, root);
    let disposed = false;
    const live = loader.list().find((p) => p.id === "drop-tools");
    expect(live).toBeDefined();
    // Replace with a dispose-instrumented registration of the same id.
    await loader.unregister("drop-tools");
    loader.register({
      id: "drop-tools",
      kind: "tools",
      tools: [],
      dispose: () => {
        disposed = true;
      },
    });
    writeDisabledPluginIdsAt(root, new Set(["drop-tools"]));
    const keptAfter = await reconcileManagedProcessPlugins(loader, root);
    expect(disposed).toBe(true);
    expect(loader.list().map((p) => p.id)).toEqual([]);
    expect(keptAfter.pairing?.paired).toBe(true);
    expect(keptAfter.pairing?.stillLoaded).toEqual([]);
  });

  it("loadAll skips soft-disabled ids (incl. skipLoad cordis stubs)", async () => {
    const root = mkdtempSync(path.join(tmpdir(), "xrk-loader-loadall-soft-"));
    temps.push(root);
    mkdirSync(path.join(root, "keep-tools"), { recursive: true });
    writeFileSync(
      path.join(root, "keep-tools", "xrk.plugin.json"),
      JSON.stringify({ id: "keep-tools", kind: "tools", entry: "./plugin.mjs" }),
    );
    writeFileSync(
      path.join(root, "keep-tools", "plugin.mjs"),
      `export function createPlugin() {
  return { id: "keep-tools", kind: "tools", tools: [] };
}
`,
    );
    mkdirSync(path.join(root, "ghost-cordis"), { recursive: true });
    writeFileSync(
      path.join(root, "ghost-cordis", "package.json"),
      JSON.stringify({
        name: "ghost-cordis",
        peerDependencies: { "@xrkseek/cordis": "*" },
        main: "./boom.mjs",
      }),
    );
    writeFileSync(
      path.join(root, "ghost-cordis", "boom.mjs"),
      `throw new Error("must not import");
`,
    );
    writeInventory(root, {
      "ghost-cordis": {
        name: "ghost-cordis",
        version: "1.0.0",
        kind: "process",
      },
    });
    writeDisabledPluginIdsAt(root, new Set(["ghost-cordis"]));
    const loader = createPluginLoader();
    const loaded = await loader.loadAll(root);
    expect(loaded.ids).toEqual(["keep-tools"]);
    expect(loader.list().map((p) => p.id)).toEqual(["keep-tools"]);
  });
});
