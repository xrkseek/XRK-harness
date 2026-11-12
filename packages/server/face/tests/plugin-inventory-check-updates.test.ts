import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  checkFacePluginUpdates,
  ensurePluginUpdateProbe,
  getPluginUpdateProbeCache,
  isNpmVersionNewer,
  resetPluginUpdateProbeCacheForTests,
} from "../src/plugin-check-updates.js";
import {
  classifyManagedPluginSource,
  registryPackageNameFromSource,
} from "../src/plugin-inventory.js";
import { pluginInventoryCheckUpdates } from "../src/handlers/remotes.js";

const temps: string[] = [];

afterEach(() => {
  resetPluginUpdateProbeCacheForTests();
  for (const dir of temps.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("classifyManagedPluginSource", () => {
  it("classifies engine / local / registry / vcs", () => {
    expect(classifyManagedPluginSource("phone-guest", "xrk-mobile")).toBe("engine");
    expect(classifyManagedPluginSource(undefined, "xrk-mobile-ui")).toBe("engine");
    expect(classifyManagedPluginSource("file:./ext", "p")).toBe("local");
    expect(classifyManagedPluginSource("./extensions/p", "p")).toBe("local");
    expect(classifyManagedPluginSource(undefined, "side-tools")).toBe("local");
    expect(classifyManagedPluginSource("xrkh-better-sidebar@0.18.2", "x")).toBe(
      "registry",
    );
    expect(classifyManagedPluginSource("xrkh-better-sidebar", "x")).toBe("registry");
    expect(classifyManagedPluginSource("github:owner/repo", "x")).toBe("vcs");
  });

  it("strips registry pins for npm view", () => {
    expect(registryPackageNameFromSource("xrkh-better-sidebar@0.18.2")).toBe(
      "xrkh-better-sidebar",
    );
    expect(registryPackageNameFromSource("@scope/pkg@1.0.0")).toBe("@scope/pkg");
    expect(registryPackageNameFromSource("phone-guest", "xrk-mobile")).toBe(
      undefined,
    );
  });
});

describe("isNpmVersionNewer", () => {
  it("compares semver cores", () => {
    expect(isNpmVersionNewer("0.19.0", "0.18.2")).toBe(true);
    expect(isNpmVersionNewer("0.18.2", "0.18.2")).toBe(false);
    expect(isNpmVersionNewer("0.18.1", "0.18.2")).toBe(false);
    expect(isNpmVersionNewer("v1.2.3-beta", "1.2.2")).toBe(true);
  });

  it("does not invent updates from unparseable strings", () => {
    expect(isNpmVersionNewer("latest", "0.1.0")).toBe(false);
    expect(isNpmVersionNewer("1.0.0", "workspace:*")).toBe(false);
    expect(isNpmVersionNewer("", "1.0.0")).toBe(false);
  });
});

describe("registryPackageNameFromSource hygiene", () => {
  it("drops CLI-option shaped registry names", () => {
    expect(registryPackageNameFromSource("--registry=http://evil")).toBe(
      undefined,
    );
    expect(registryPackageNameFromSource("../../evil")).toBe(undefined);
    expect(registryPackageNameFromSource("xrkh-better-sidebar@0.20.7")).toBe(
      "xrkh-better-sidebar",
    );
  });
});

describe("checkFacePluginUpdates", () => {
  it("marks registry updates, checkFailed, and skips local / engine", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-check-upd-"));
    temps.push(home);
    const pluginsDir = join(home, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(
      join(pluginsDir, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 1,
        packages: {
          "xrkh-better-sidebar": {
            name: "xrkh-better-sidebar",
            version: "0.18.2",
            kind: "client",
            source: "xrkh-better-sidebar@0.18.2",
            installedAt: new Date().toISOString(),
          },
          "broken-pkg": {
            name: "broken-pkg",
            version: "1.0.0",
            kind: "client",
            source: "broken-pkg@1.0.0",
            installedAt: new Date().toISOString(),
          },
          "local-tools": {
            name: "local-tools",
            version: "1.0.0",
            kind: "process",
            source: "file:./extensions/local-tools",
            installedAt: new Date().toISOString(),
          },
          "xrk-mobile": {
            name: "xrk-mobile",
            version: "1",
            kind: "tools",
            source: "phone-guest",
            installedAt: new Date().toISOString(),
          },
        },
      }),
    );
    const rows = await checkFacePluginUpdates(
      {
        productDir: home,
        plugins: [],
        webPlugins: [],
        hostPublic: { pluginsDir },
      } as never,
      {
        viewVersion: async (name) =>
          name === "xrkh-better-sidebar" ? "0.19.0" : undefined,
      },
    );
    const sidebar = rows.find((r) => r.entryId === "xrkh-better-sidebar");
    expect(sidebar).toMatchObject({
      sourceClass: "registry",
      installed: "0.18.2",
      latest: "0.19.0",
      updateAvailable: true,
    });
    expect(sidebar?.checkFailed).toBeUndefined();
    expect(rows.find((r) => r.entryId === "broken-pkg")).toMatchObject({
      sourceClass: "registry",
      checkFailed: true,
      updateAvailable: false,
    });
    expect(rows.find((r) => r.entryId === "local-tools")).toMatchObject({
      sourceClass: "local",
      updateAvailable: false,
    });
    expect(rows.find((r) => r.entryId === "xrk-mobile")).toBeUndefined();
  });
});

describe("ensurePluginUpdateProbe cache", () => {
  it("warms cache and serves ready without re-probe", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-check-cache-"));
    temps.push(home);
    const pluginsDir = join(home, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
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
    const runtime = {
      productDir: home,
      plugins: [],
      webPlugins: [],
      hostPublic: { pluginsDir },
    } as never;
    let calls = 0;
    const first = await ensurePluginUpdateProbe(runtime, {
      viewVersion: async () => {
        calls += 1;
        return "1.0.1";
      },
    });
    expect(first.status).toBe("ready");
    const side = first.updates.find((u) => u.entryId === "side-tools");
    expect(side).toMatchObject({
      sourceClass: "registry",
      latest: "1.0.1",
      updateAvailable: true,
    });
    expect(calls).toBeGreaterThanOrEqual(1);
    const callsAfterFirst = calls;
    const cached = getPluginUpdateProbeCache(runtime);
    expect(cached.status).toBe("ready");
    const second = await ensurePluginUpdateProbe(runtime, {
      viewVersion: async () => {
        calls += 1;
        return "9.9.9";
      },
    });
    expect(second.updates.find((u) => u.entryId === "side-tools")?.latest).toBe(
      "1.0.1",
    );
    expect(calls).toBe(callsAfterFirst);
  });
});

describe("pluginInventory/checkUpdates", () => {
  it("returns warm cache snapshot without re-forcing", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-check-rpc-"));
    temps.push(home);
    const pluginsDir = join(home, "plugins");
    mkdirSync(pluginsDir, { recursive: true });
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
    const runtime = {
      productDir: home,
      plugins: [],
      webPlugins: [],
      hostPublic: { pluginsDir },
    } as never;
    await ensurePluginUpdateProbe(runtime, {
      viewVersion: async () => "1.2.3",
    });
    const result = await pluginInventoryCheckUpdates(runtime, "rpc-1", {
      args: {},
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const value = result.value as {
      status: string;
      updates: { entryId: string; sourceClass: string; latest?: string }[];
    };
    expect(value.status).toBe("ready");
    expect(value.updates.find((u) => u.entryId === "side-tools")).toMatchObject({
      sourceClass: "registry",
      latest: "1.2.3",
    });
  });
});
