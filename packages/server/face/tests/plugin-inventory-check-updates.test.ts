import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildNpmViewVersionArgs,
  checkFacePluginUpdates,
  ensurePluginUpdateProbe,
  getPluginUpdateProbeCache,
  isNpmVersionNewer,
  planNpmViewSpawn,
  refreshPluginUpdateProbeAfterMutate,
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

describe("buildNpmViewVersionArgs", () => {
  it("forwards Settings registry/proxy like plugin add; drops non-http", () => {
    expect(buildNpmViewVersionArgs("xrkh-better-sidebar")).toEqual([
      "view",
      "xrkh-better-sidebar",
      "version",
    ]);
    expect(
      buildNpmViewVersionArgs("xrkh-better-sidebar", {
        registry: "https://registry.npmmirror.com/",
        proxy: "http://127.0.0.1:7897",
      }),
    ).toEqual([
      "view",
      "xrkh-better-sidebar",
      "version",
      "--registry",
      "https://registry.npmmirror.com/",
      "--proxy",
      "http://127.0.0.1:7897",
    ]);
    expect(
      buildNpmViewVersionArgs("pkg", {
        registry: "--registry=evil",
        proxy: "not-a-url",
      }),
    ).toEqual(["view", "pkg", "version"]);
  });
});

describe("planNpmViewSpawn", () => {
  it("routes Windows npm.cmd through ComSpec (never bare .cmd spawn)", () => {
    const plan = planNpmViewSpawn(["view", "xrkh-better-sidebar", "version"], {
      execPath: "C:\\fake\\node.exe",
      platform: "win32",
      env: { ComSpec: "C:\\Windows\\System32\\cmd.exe" },
    });
    expect(plan.file.toLowerCase()).toContain("cmd.exe");
    expect(plan.args[0]).toBe("/d");
    expect(plan.args[1]).toBe("/s");
    expect(plan.args[2]).toBe("/c");
    expect(plan.args[3]).toContain("npm.cmd");
    expect(plan.args[3]).toContain("view");
    expect(plan.args[3]).toContain("xrkh-better-sidebar");
    expect(plan.windowsVerbatimArguments).toBe(true);
  });

  it("uses node + npm-cli.js when vendored next to execPath", () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-npm-cli-"));
    temps.push(home);
    const cli = join(home, "node_modules", "npm", "bin", "npm-cli.js");
    mkdirSync(join(home, "node_modules", "npm", "bin"), { recursive: true });
    writeFileSync(cli, "/* npm */\n");
    const node = join(home, "node.exe");
    writeFileSync(node, "");
    const plan = planNpmViewSpawn(["view", "pkg", "version"], {
      execPath: node,
      platform: "win32",
      env: { ComSpec: "cmd.exe" },
    });
    expect(plan.file).toBe(node);
    expect(plan.args[0]).toBe(cli);
    expect(plan.args.slice(1)).toEqual(["view", "pkg", "version"]);
    expect(plan.windowsVerbatimArguments).toBeUndefined();
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
  it("marks registry updates, checkFailed, local advisory, and skips engine", async () => {
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
          "xrkh-better-sidebar-local": {
            name: "xrkh-better-sidebar-local",
            version: "0.20.10",
            kind: "client",
            source: "file:./extensions/xrkh-better-sidebar",
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
        viewVersion: async (name) => {
          if (name === "xrkh-better-sidebar") return "0.19.0";
          // Advisory local probe uses entryId as package name.
          if (name === "xrkh-better-sidebar-local") return "0.20.11";
          return undefined;
        },
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
    // Unpublished local id — quiet miss, not checkFailed.
    expect(rows.find((r) => r.entryId === "local-tools")).toMatchObject({
      sourceClass: "local",
      updateAvailable: false,
    });
    expect(rows.find((r) => r.entryId === "local-tools")?.checkFailed).toBeUndefined();
    // Published package installed via file: — advisory badge.
    expect(rows.find((r) => r.entryId === "xrkh-better-sidebar-local")).toMatchObject({
      sourceClass: "local",
      installed: "0.20.10",
      latest: "0.20.11",
      updateAvailable: true,
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

describe("ensurePluginUpdateProbe force supersedes warm", () => {
  it("does not let an older inflight overwrite a newer force result", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-check-race-"));
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
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    let calls = 0;
    const viewVersion = async () => {
      calls += 1;
      if (calls === 1) {
        await slowGate;
        return "1.0.0";
      }
      return "9.9.9";
    };
    const warm = ensurePluginUpdateProbe(runtime, { viewVersion });
    // Let warm start and park on the gate before force.
    await Promise.resolve();
    await Promise.resolve();
    const forced = await ensurePluginUpdateProbe(runtime, {
      force: true,
      viewVersion,
    });
    expect(forced.updates[0]?.latest).toBe("9.9.9");
    releaseSlow();
    await warm;
    const cached = getPluginUpdateProbeCache(runtime);
    expect(cached.updates[0]?.latest).toBe("9.9.9");
  });
});

describe("ensurePluginUpdateProbe registry cache isolation", () => {
  it("keeps default-registry and mirror caches apart", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-check-reg-"));
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
    const seen: string[] = [];
    const viewVersion = async (
      _name: string,
      net?: { registry?: string; proxy?: string },
    ) => {
      seen.push(net?.registry ?? "");
      return net?.registry?.includes("npmmirror") ? "9.9.9" : "1.0.1";
    };
    const defaultSnap = await ensurePluginUpdateProbe(runtime, { viewVersion });
    expect(defaultSnap.updates[0]?.latest).toBe("1.0.1");
    const mirrorSnap = await ensurePluginUpdateProbe(runtime, {
      viewVersion,
      registry: "https://registry.npmmirror.com/",
    });
    expect(mirrorSnap.updates[0]?.latest).toBe("9.9.9");
    // Default cache still intact after mirror probe.
    const cachedDefault = getPluginUpdateProbeCache(runtime);
    expect(cachedDefault.updates[0]?.latest).toBe("1.0.1");
    expect(seen).toContain("");
    expect(seen).toContain("https://registry.npmmirror.com/");
  });
});

describe("plugin-inventory/updates-changed", () => {
  it("publishes host/remote-event when a probe run settles", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-check-evt-"));
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
    const publishHost = vi.fn();
    const runtime = {
      productDir: home,
      plugins: [],
      webPlugins: [],
      hostPublic: { pluginsDir },
      bus: { publishHost },
    } as never;
    await ensurePluginUpdateProbe(runtime, {
      viewVersion: async () => "1.2.3",
    });
    expect(publishHost).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "host/remote-event",
        event: "plugin-inventory/updates-changed",
        args: expect.arrayContaining(["ready"]),
      }),
    );
  });
});

describe("refreshPluginUpdateProbeAfterMutate", () => {
  it("re-probes touched ids so equal versions clear updateAvailable", async () => {
    const home = mkdtempSync(join(tmpdir(), "xrk-check-refresh-"));
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
      viewVersion: async () => "1.1.0",
    });
    expect(getPluginUpdateProbeCache(runtime).updates[0]?.updateAvailable).toBe(true);

    writeFileSync(
      join(pluginsDir, ".xrk-plugins.json"),
      JSON.stringify({
        rev: 2,
        packages: {
          "side-tools": {
            name: "side-tools",
            version: "1.1.0",
            kind: "process",
            source: "side-tools@1.1.0",
            installedAt: new Date().toISOString(),
          },
        },
      }),
    );
    const publishHost = vi.fn();
    const runtimeWithBus = { ...runtime, bus: { publishHost } };
    await refreshPluginUpdateProbeAfterMutate(runtimeWithBus, {
      entryIds: ["side-tools"],
      viewVersion: async () => "1.1.0",
    });
    const row = getPluginUpdateProbeCache(runtimeWithBus).updates.find(
      (u) => u.entryId === "side-tools",
    );
    expect(row).toMatchObject({
      installed: "1.1.0",
      latest: "1.1.0",
      updateAvailable: false,
    });
    expect(publishHost).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "host/remote-event",
        event: "plugin-inventory/updates-changed",
        args: expect.arrayContaining(["ready"]),
      }),
    );
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
