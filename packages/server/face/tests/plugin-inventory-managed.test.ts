import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  listFacePluginInventory,
  reconcileManagedClientBoot,
  resolveManagedPluginDir,
  resolveManagedPluginUpdateSpec,
  resolveManagedPluginsDir,
  setFacePluginInventoryEnabled,
  writeDisabledPluginIds,
} from "../src/plugin-inventory.js";

const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function runtimeAt(
  productDir: string,
  extra: {
    plugins?: readonly { id: string; kind: string }[];
    webPlugins?: readonly { id: string; moduleName?: string }[];
    hostPublic?: { pluginsDir?: string };
  } = {},
) {
  return {
    productDir,
    plugins: extra.plugins ?? [],
    webPlugins: extra.webPlugins ?? [],
    ...(extra.hostPublic ? { hostPublic: extra.hostPublic } : {}),
  } as never;
}

describe("managed plugin inventory paths", () => {
  it("resolves client halves under web/plugins", () => {
    const productDir = mkdtempSync(path.join(tmpdir(), "xrk-inv-"));
    temps.push(productDir);
    const staged = path.join(
      productDir,
      "plugins",
      "web",
      "plugins",
      "xrkh-better-sidebar",
    );
    mkdirSync(staged, { recursive: true });
    writeFileSync(path.join(staged, "client.js"), "export {}\n");
    expect(
      resolveManagedPluginDir(
        runtimeAt(productDir),
        "xrkh-better-sidebar",
        "xrkh-better-sidebar",
      ),
    ).toBe(staged);
  });

  it("drops soft-disabled client packages from web/boot.json", () => {
    const productDir = mkdtempSync(path.join(tmpdir(), "xrk-boot-"));
    temps.push(productDir);
    const plugins = path.join(productDir, "plugins");
    mkdirSync(path.join(plugins, "web", "plugins", "keep-me"), {
      recursive: true,
    });
    writeFileSync(
      path.join(plugins, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "keep-me": {
            name: "keep-me",
            version: "1.0.0",
            kind: "client",
            source: "keep-me@1.0.0",
            installedAt: new Date().toISOString(),
            clientInject: [],
          },
          "drop-me": {
            name: "drop-me",
            version: "1.0.0",
            kind: "client",
            source: "drop-me@1.0.0",
            installedAt: new Date().toISOString(),
            clientInject: [],
          },
        },
      }),
    );
    writeDisabledPluginIds(runtimeAt(productDir), new Set(["drop-me"]));
    reconcileManagedClientBoot(runtimeAt(productDir));
    const boot = JSON.parse(
      readFileSync(path.join(plugins, "web", "boot.json"), "utf8"),
    ) as { entries: { id: string }[] };
    expect(boot.entries.map((e) => e.id)).toEqual(["keep-me"]);
  });

  it("lists soft-disabled client packages from inventory when absent from webPlugins", () => {
    const productDir = mkdtempSync(path.join(tmpdir(), "xrk-list-"));
    temps.push(productDir);
    const plugins = path.join(productDir, "plugins");
    mkdirSync(plugins, { recursive: true });
    writeFileSync(
      path.join(plugins, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "xrkh-better-sidebar": {
            name: "xrkh-better-sidebar",
            version: "0.18.2",
            kind: "client",
            source: "xrkh-better-sidebar@0.18.2",
            installedAt: new Date().toISOString(),
            clientInject: [],
          },
        },
      }),
    );
    writeDisabledPluginIds(
      runtimeAt(productDir),
      new Set(["xrkh-better-sidebar"]),
    );
    // Host boot filtered the overlay — Settings only sees live webPlugins + inventory.
    const listed = listFacePluginInventory(
      runtimeAt(productDir, {
        webPlugins: [{ id: "@xrkseek/client-runtime" }],
      }),
    );
    const row = listed.find((e) => e.entryId === "xrkh-better-sidebar");
    expect(row).toMatchObject({
      entryId: "xrkh-better-sidebar",
      moduleName: "xrkh-better-sidebar",
      enabled: false,
      fiberPhase: null,
      managed: true,
      version: "0.18.2",
      kind: "client",
    });
    expect(row?.needsRestart).toBeUndefined();
  });

  it("marks needsRestart when enabled inventory row is not live in Host", () => {
    const productDir = mkdtempSync(path.join(tmpdir(), "xrk-restart-"));
    temps.push(productDir);
    const plugins = path.join(productDir, "plugins");
    mkdirSync(plugins, { recursive: true });
    writeFileSync(
      path.join(plugins, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "fresh-side": {
            name: "fresh-side",
            version: "2.0.0",
            kind: "client",
            source: "fresh-side@2.0.0",
            installedAt: new Date().toISOString(),
          },
        },
      }),
    );
    const listed = listFacePluginInventory(
      runtimeAt(productDir, { webPlugins: [] }),
    );
    expect(listed.find((e) => e.entryId === "fresh-side")).toMatchObject({
      enabled: true,
      managed: true,
      version: "2.0.0",
      kind: "client",
      source: "fresh-side@2.0.0",
      needsRestart: true,
    });
  });

  it("re-enable restores web/boot.json so the next Host start can load the client", () => {
    const productDir = mkdtempSync(path.join(tmpdir(), "xrk-reenable-"));
    temps.push(productDir);
    const plugins = path.join(productDir, "plugins");
    mkdirSync(path.join(plugins, "web", "plugins", "xrkh-better-sidebar"), {
      recursive: true,
    });
    writeFileSync(
      path.join(plugins, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "xrkh-better-sidebar": {
            name: "xrkh-better-sidebar",
            version: "0.18.2",
            kind: "client",
            source: "xrkh-better-sidebar@0.18.2",
            installedAt: new Date().toISOString(),
            clientInject: ["@xrkseek/client-runtime"],
          },
        },
      }),
    );
    const runtime = runtimeAt(productDir, { webPlugins: [] });
    writeDisabledPluginIds(runtime, new Set(["xrkh-better-sidebar"]));
    reconcileManagedClientBoot(runtime);
    expect(existsSync(path.join(plugins, "web", "boot.json"))).toBe(false);

    const result = setFacePluginInventoryEnabled(
      runtime,
      "xrkh-better-sidebar",
      true,
    );
    expect(result).toEqual({ ok: true });
    const boot = JSON.parse(
      readFileSync(path.join(plugins, "web", "boot.json"), "utf8"),
    ) as { entries: { id: string }[] };
    expect(boot.entries.map((e) => e.id)).toEqual(["xrkh-better-sidebar"]);
    expect(
      listFacePluginInventory(runtime).find(
        (e) => e.entryId === "xrkh-better-sidebar",
      )?.enabled,
    ).toBe(true);
  });

  it("prefers hostPublic.pluginsDir over {productDir}/plugins", () => {
    const productDir = mkdtempSync(path.join(tmpdir(), "xrk-home-"));
    const altRoot = mkdtempSync(path.join(tmpdir(), "xrk-alt-plugins-"));
    temps.push(productDir, altRoot);
    // Wrong place (would be used if Face ignored Host pluginsDir).
    mkdirSync(path.join(productDir, "plugins"), { recursive: true });
    writeFileSync(
      path.join(productDir, "plugins", ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          decoy: {
            name: "decoy",
            version: "0.0.1",
            kind: "client",
            source: "decoy@0.0.1",
            installedAt: new Date().toISOString(),
          },
        },
      }),
    );
    writeFileSync(
      path.join(altRoot, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "real-plugin": {
            name: "real-plugin",
            version: "1.0.0",
            kind: "client",
            source: "real-plugin@1.0.0",
            installedAt: new Date().toISOString(),
            clientInject: [],
          },
        },
      }),
    );
    const runtime = runtimeAt(productDir, {
      hostPublic: { pluginsDir: altRoot },
    });
    expect(resolveManagedPluginsDir(runtime)).toBe(path.resolve(altRoot));
    expect(
      listFacePluginInventory(runtime).map((e) => e.entryId),
    ).toEqual(["real-plugin"]);
    setFacePluginInventoryEnabled(runtime, "real-plugin", false);
    expect(existsSync(path.join(altRoot, "web", "boot.json"))).toBe(false);
    expect(
      existsSync(path.join(productDir, "plugins", "web", "boot.json")),
    ).toBe(false);
  });

  it("resolveManagedPluginUpdateSpec drops cwd-sensitive local sources", () => {
    expect(resolveManagedPluginUpdateSpec("side", "side@1.2.3")).toBe(
      "side@1.2.3",
    );
    expect(resolveManagedPluginUpdateSpec("side", "github:acme/side")).toBe(
      "github:acme/side",
    );
    expect(resolveManagedPluginUpdateSpec("side", "file:./side")).toBe(
      "side@latest",
    );
    expect(resolveManagedPluginUpdateSpec("side", "./extensions/side")).toBe(
      "side@latest",
    );
    expect(resolveManagedPluginUpdateSpec("side", undefined)).toBe(
      "side@latest",
    );
  });

  it("does not mark product-shell cordis as managed without staged client", () => {
    const productDir = mkdtempSync(path.join(tmpdir(), "xrk-cordis-m-"));
    temps.push(productDir);
    mkdirSync(path.join(productDir, "plugins"), { recursive: true });
    const listed = listFacePluginInventory(
      runtimeAt(productDir, {
        plugins: [{ id: "@xrkseek/cordis-plugin-hmr", kind: "cordis" }],
        webPlugins: [],
        hostPublic: { pluginsDir: path.join(productDir, "plugins") },
      }),
    );
    expect(
      listed.find((e) => e.entryId === "@xrkseek/cordis-plugin-hmr"),
    ).toMatchObject({
      managed: false,
      kind: "cordis",
    });
  });

  it("prunes orphan soft-disable ids when reconciling boot", () => {
    const productDir = mkdtempSync(path.join(tmpdir(), "xrk-orphan-dis-"));
    temps.push(productDir);
    const plugins = path.join(productDir, "plugins");
    mkdirSync(plugins, { recursive: true });
    writeFileSync(
      path.join(plugins, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          keep: {
            name: "keep",
            version: "1.0.0",
            kind: "client",
            source: "keep@1.0.0",
            installedAt: new Date().toISOString(),
            clientInject: [],
          },
        },
      }),
    );
    writeDisabledPluginIds(
      runtimeAt(productDir),
      new Set(["keep", "ghost-removed"]),
    );
    reconcileManagedClientBoot(runtimeAt(productDir));
    const disabledRaw = readFileSync(
      path.join(plugins, ".xrk-plugins-disabled.json"),
      "utf8",
    );
    expect(JSON.parse(disabledRaw).ids).toEqual(["keep"]);
    expect(existsSync(path.join(plugins, "web", "boot.json"))).toBe(false);
  });

  it("reconciles boot using inventory key when name field is missing", () => {
    const productDir = mkdtempSync(path.join(tmpdir(), "xrk-key-name-"));
    temps.push(productDir);
    const plugins = path.join(productDir, "plugins");
    mkdirSync(plugins, { recursive: true });
    writeFileSync(
      path.join(plugins, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "key-only-side": {
            version: "3.0.0",
            kind: "client",
            clientInject: [],
          },
        },
      }),
    );
    reconcileManagedClientBoot(runtimeAt(productDir));
    const boot = JSON.parse(
      readFileSync(path.join(plugins, "web", "boot.json"), "utf8"),
    ) as { entries: { id: string }[] };
    expect(boot.entries.map((e) => e.id)).toEqual(["key-only-side"]);
  });

  it("canonicalizes soft-disable to inventory package name and clears aliases on enable", () => {
    const productDir = mkdtempSync(path.join(tmpdir(), "xrk-canon-dis-"));
    temps.push(productDir);
    const plugins = path.join(productDir, "plugins");
    mkdirSync(plugins, { recursive: true });
    writeFileSync(
      path.join(plugins, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "xrkh-better-sidebar": {
            name: "xrkh-better-sidebar",
            version: "0.18.2",
            kind: "client",
            source: "xrkh-better-sidebar@0.18.2",
            installedAt: new Date().toISOString(),
            clientInject: [],
          },
        },
      }),
    );
    const runtime = runtimeAt(productDir, {
      webPlugins: [
        {
          id: "xrkh-better-sidebar",
          moduleName: "xrkh-better-sidebar",
        },
      ],
      hostPublic: { pluginsDir: plugins },
    });
    writeDisabledPluginIds(runtime, new Set(["alias-stale"]));
    expect(
      setFacePluginInventoryEnabled(runtime, "xrkh-better-sidebar", false),
    ).toEqual({ ok: true });
    // Disable replaces the whole set with the canonical inventory id (drops stale aliases).
    expect(
      JSON.parse(
        readFileSync(path.join(plugins, ".xrk-plugins-disabled.json"), "utf8"),
      ).ids,
    ).toEqual(["xrkh-better-sidebar"]);

    expect(
      setFacePluginInventoryEnabled(runtime, "xrkh-better-sidebar", true),
    ).toEqual({ ok: true });
    expect(existsSync(path.join(plugins, ".xrk-plugins-disabled.json"))).toBe(
      false,
    );
  });
});
