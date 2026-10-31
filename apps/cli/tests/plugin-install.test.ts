import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  patchWorkBuddyClientProbeNull,
  pruneEmptyParents,
} from "../src/plugin/install-client.js";
import {
  addPlugin,
  listPlugins,
  reconcilePluginsDir,
  readInventory,
  removePlugin,
  resolvePluginsDir,
} from "../src/plugin/index.js";

const temps: string[] = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

function writeClientFixture(root: string, name: string): string {
  const dir = path.join(root, "client-fixture");
  mkdirSync(path.join(dir, "lib"), { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name,
        version: "1.2.3",
        dsh: {
          client: {
            inject: [
              "@deepseek-ai/dsh-client-runtime",
              "@deepseek-ai/dsh-client-locale",
              "@deepseek-ai/mystery",
            ],
            platform: "web",
          },
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(dir, "lib", "client.js"),
    `window.__ModuleLoader__.load({ id: ${JSON.stringify(name)}, factory: () => ({ apply() {} }) });\n`,
  );
  return dir;
}

function writeProcessFixture(root: string, name: string): string {
  const dir = path.join(root, "process-fixture");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    path.join(dir, "package.json"),
    JSON.stringify(
      {
        name,
        version: "0.4.0",
        xrkseek: {
          plugin: {
            id: name,
            kind: "tools",
            entry: "./plugin.mjs",
          },
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    path.join(dir, "plugin.mjs"),
    `export function createPlugin() {
  return { id: ${JSON.stringify(name)}, kind: "tools", tools: [] };
}
`,
  );
  return dir;
}

describe("plugin add/remove/list", () => {
  it("installs a client package into web overlay + inventory", () => {
    const home = tempDir("xrk-plug-");
    const env = { XRK_HOME: home };
    const pluginsDir = resolvePluginsDir(env);
    const fixture = writeClientFixture(home, "@acme/whip");

    const warnings: string[] = [];
    addPlugin(fixture, {
      env,
      pluginsDir,
      io: {
        log: () => {},
        warn: (l) => warnings.push(l),
      },
    });

    expect(warnings.some((w) => w.includes("mystery"))).toBe(true);
    const clientJs = path.join(
      pluginsDir,
      "web",
      "plugins",
      "@acme",
      "whip",
      "client.js",
    );
    expect(existsSync(clientJs)).toBe(true);
    const boot = JSON.parse(
      readFileSync(path.join(pluginsDir, "web", "boot.json"), "utf8"),
    ) as { entries: { id: string; inject: string[] }[] };
    expect(boot.entries).toHaveLength(1);
    expect(boot.entries[0]!.id).toBe("@acme/whip");
    expect(boot.entries[0]!.inject).toEqual([
      "@xrkseek/client-runtime",
      "@xrkseek/client-locale",
    ]);

    const listed = listPlugins({ pluginsDir });
    expect(listed).toHaveLength(1);
    expect(listed[0]!.kind).toBe("client");
    expect(listed[0]!.version).toBe("1.2.3");

    removePlugin("@acme/whip", {
      pluginsDir,
      io: { log: () => {}, warn: () => {} },
    });
    expect(listPlugins({ pluginsDir })).toHaveLength(0);
    expect(existsSync(clientJs)).toBe(false);
    expect(existsSync(path.join(pluginsDir, "web", "boot.json"))).toBe(false);
  });

  it("stages WorkBuddy Cordis lib/ beside client.js", () => {
    const home = tempDir("xrk-plug-wb-");
    const env = { XRK_HOME: home };
    const pluginsDir = resolvePluginsDir(env);
    const dir = path.join(home, "wb-fixture");
    mkdirSync(path.join(dir, "lib"), { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: "dsh-workbuddy-connect",
          version: "0.1.0",
          dsh: { client: { inject: [], platform: "web" } },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      path.join(dir, "lib", "client.js"),
      `window.__ModuleLoader__.load({ id: "dsh-workbuddy-connect", factory: () => ({ apply() {} }) });\n`,
    );
    writeFileSync(
      path.join(dir, "lib", "index.js"),
      "export function apply() {}\n",
    );
    writeFileSync(path.join(dir, "lib", "shim.js"), "export const ok = true;\n");

    addPlugin(dir, {
      env,
      pluginsDir,
      io: { log: () => {}, warn: () => {} },
    });

    const staged = path.join(
      pluginsDir,
      "web",
      "plugins",
      "dsh-workbuddy-connect",
    );
    expect(existsSync(path.join(staged, "client.js"))).toBe(true);
    expect(existsSync(path.join(staged, "lib", "index.js"))).toBe(true);
    expect(existsSync(path.join(staged, "lib", "shim.js"))).toBe(true);
  });

  it("stages Our Free Model host index.js + src beside client.js", () => {
    const home = tempDir("xrk-plug-ofm-");
    const env = { XRK_HOME: home };
    const pluginsDir = resolvePluginsDir(env);
    const dir = path.join(home, "ofm-fixture");
    mkdirSync(path.join(dir, "src"), { recursive: true });
    mkdirSync(path.join(dir, "adapter"), { recursive: true });
    mkdirSync(path.join(dir, "vendor", "channel-pack"), { recursive: true });
    mkdirSync(path.join(dir, "vendor", "magpie"), { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: "dsh-our-free-model",
          version: "2.1.0",
          dsh: { client: { inject: [], platform: "web", immediately: true } },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      path.join(dir, "client.js"),
      `window.__ModuleLoader__.load({ id: "dsh-our-free-model", factory: () => ({ apply() {} }) });\n`,
    );
    writeFileSync(path.join(dir, "index.js"), "export function apply() {}\n");
    writeFileSync(path.join(dir, "src", "store.js"), "export const ok = true;\n");
    writeFileSync(path.join(dir, "adapter", "kernel.js"), "export const ok = true;\n");
    writeFileSync(path.join(dir, "cordis.patch.yml"), "- insert: []\n");
    writeFileSync(
      path.join(dir, "vendor", "channel-pack", "pack.js"),
      "export default {};\n",
    );
    writeFileSync(
      path.join(dir, "vendor", "magpie", "engine.json"),
      "{}\n",
    );

    addPlugin(dir, {
      env,
      pluginsDir,
      io: { log: () => {}, warn: () => {} },
    });

    const staged = path.join(
      pluginsDir,
      "web",
      "plugins",
      "dsh-our-free-model",
    );
    expect(existsSync(path.join(staged, "client.js"))).toBe(true);
    expect(existsSync(path.join(staged, "index.js"))).toBe(true);
    expect(existsSync(path.join(staged, "src", "store.js"))).toBe(true);
    expect(existsSync(path.join(staged, "adapter", "kernel.js"))).toBe(true);
    expect(
      existsSync(path.join(staged, "vendor", "channel-pack", "pack.js")),
    ).toBe(true);
    expect(existsSync(path.join(staged, "vendor", "magpie", "engine.json"))).toBe(
      true,
    );
  });

  it("reconcile restages OFM Cordis host when only client.js was left on disk", () => {
    const home = tempDir("xrk-plug-ofm-heal-");
    const env = { XRK_HOME: home };
    const pluginsDir = resolvePluginsDir(env);
    const dir = path.join(home, "ofm-heal-src");
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: "@ebony-vinyl/dsh-our-free-model",
          version: "2.7.4",
          main: "./index.js",
          exports: { ".": "./index.js", "./client": "./client.js" },
          dsh: { client: { inject: [], platform: "web", immediately: true } },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      path.join(dir, "client.js"),
      `window.__ModuleLoader__.load({ id: "dsh-our-free-model", factory: () => ({}) });\n`,
    );
    writeFileSync(path.join(dir, "index.js"), "export function apply() {}\n");
    writeFileSync(path.join(dir, "src", "store.js"), "export const ok = true;\n");

    addPlugin(dir, {
      env,
      pluginsDir,
      io: { log: () => {}, warn: () => {} },
    });

    const staged = path.join(
      pluginsDir,
      "web",
      "plugins",
      "@ebony-vinyl",
      "dsh-our-free-model",
    );
    rmSync(path.join(staged, "index.js"), { force: true });
    rmSync(path.join(staged, "src"), { recursive: true, force: true });
    expect(existsSync(path.join(staged, "index.js"))).toBe(false);

    // Point inventory source at the local fixture so restage needs no registry.
    const invPath = path.join(pluginsDir, ".xrk-plugins.json");
    const inv = JSON.parse(readFileSync(invPath, "utf8")) as {
      rev: number;
      packages: Record<string, { source: string; name: string; version: string; kind: string; installedAt: string }>;
    };
    inv.packages["@ebony-vinyl/dsh-our-free-model"] = {
      ...inv.packages["@ebony-vinyl/dsh-our-free-model"]!,
      source: dir,
    };
    writeFileSync(invPath, `${JSON.stringify(inv, null, 2)}\n`);

    const logs: string[] = [];
    reconcilePluginsDir(pluginsDir, {
      log: (l) => logs.push(l),
      warn: () => {},
    });
    expect(existsSync(path.join(staged, "index.js"))).toBe(true);
    expect(existsSync(path.join(staged, "src", "store.js"))).toBe(true);
    expect(
      logs.some((l) =>
        l.includes("restaged Cordis host half for @ebony-vinyl/dsh-our-free-model"),
      ),
    ).toBe(true);
  });

  it("stages a scoped OFM family under the scoped path and aligns ModuleLoader id", () => {
    const home = tempDir("xrk-plug-ofm-scoped-");
    const env = { XRK_HOME: home };
    const pluginsDir = resolvePluginsDir(env);
    const dir = path.join(home, "ofm-scoped-fixture");
    mkdirSync(path.join(dir, "src"), { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: "@publisher/dsh-our-free-model",
          version: "2.7.4",
          dsh: { client: { inject: [], platform: "web", immediately: true } },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      path.join(dir, "client.js"),
      `window.__ModuleLoader__.load({ id: "dsh-our-free-model", factory: () => ({ apply() {} }) });\n`,
    );
    writeFileSync(path.join(dir, "index.js"), "export function apply() {}\n");
    writeFileSync(path.join(dir, "src", "store.js"), "export const ok = true;\n");

    addPlugin(dir, {
      env,
      pluginsDir,
      io: { log: () => {}, warn: () => {} },
    });

    const staged = path.join(
      pluginsDir,
      "web",
      "plugins",
      "@publisher",
      "dsh-our-free-model",
    );
    expect(existsSync(path.join(staged, "client.js"))).toBe(true);
    expect(existsSync(path.join(staged, "index.js"))).toBe(true);
    expect(existsSync(path.join(staged, "src", "store.js"))).toBe(true);
    expect(readFileSync(path.join(staged, "client.js"), "utf8")).toContain(
      'id: "@publisher/dsh-our-free-model"',
    );
  });

  it("aligns ModuleLoader id for any scoped community client republish", () => {
    const home = tempDir("xrk-plug-align-");
    const env = { XRK_HOME: home };
    const pluginsDir = resolvePluginsDir(env);
    const dir = path.join(home, "align-fixture");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: "@acme/dsh-widget",
          version: "1.0.0",
          dsh: { client: { inject: [], platform: "web", immediately: true } },
        },
        null,
        2,
      ),
    );
    writeFileSync(
      path.join(dir, "client.js"),
      `window.__ModuleLoader__.load({ id: 'dsh-widget', factory: () => ({ apply() {} }) });\n`,
    );

    addPlugin(dir, {
      env,
      pluginsDir,
      io: { log: () => {}, warn: () => {} },
    });

    const staged = path.join(
      pluginsDir,
      "web",
      "plugins",
      "@acme",
      "dsh-widget",
      "client.js",
    );
    expect(readFileSync(staged, "utf8")).toContain("id: '@acme/dsh-widget'");
  });

  it("aligns multiline ModuleLoader stamps and heals via reconcile", () => {
    const home = tempDir("xrk-plug-align-ml-");
    const env = { XRK_HOME: home };
    const pluginsDir = resolvePluginsDir(env);
    const dir = path.join(home, "ofm-ml-fixture");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: "@ebony-vinyl/dsh-our-free-model",
          version: "2.7.4",
          dsh: { client: { inject: [], platform: "web", immediately: true } },
        },
        null,
        2,
      ),
    );
    const multilineBare = [
      "window.__ModuleLoader__.load({",
      "  id: 'dsh-our-free-model',",
      "  factory: require => ({ apply() {} }),",
      "})",
      "",
    ].join("\n");
    writeFileSync(path.join(dir, "client.js"), multilineBare, "utf8");

    addPlugin(dir, {
      env,
      pluginsDir,
      io: { log: () => {}, warn: () => {} },
    });

    const staged = path.join(
      pluginsDir,
      "web",
      "plugins",
      "@ebony-vinyl",
      "dsh-our-free-model",
      "client.js",
    );
    expect(readFileSync(staged, "utf8")).toContain(
      "id: '@ebony-vinyl/dsh-our-free-model'",
    );

    // Simulate a pre-align / non-install copy left on disk.
    writeFileSync(staged, multilineBare, "utf8");
    const logs: string[] = [];
    reconcilePluginsDir(pluginsDir, {
      log: (l) => logs.push(l),
      warn: () => {},
    });
    expect(readFileSync(staged, "utf8")).toContain(
      "id: '@ebony-vinyl/dsh-our-free-model'",
    );
    expect(
      logs.some((l) =>
        l.includes("aligned ModuleLoader id for @ebony-vinyl/dsh-our-free-model"),
      ),
    ).toBe(true);
  });

  it("installs a process package under a discoverable path", () => {
    const home = tempDir("xrk-plug-p-");
    const env = { XRK_HOME: home };
    const pluginsDir = resolvePluginsDir(env);
    const fixture = writeProcessFixture(home, "example-tools");

    addPlugin(fixture, {
      env,
      pluginsDir,
      io: { log: () => {}, warn: () => {} },
    });

    const installed = path.join(pluginsDir, "example-tools", "plugin.mjs");
    expect(existsSync(installed)).toBe(true);
    const inv = readInventory(pluginsDir);
    expect(inv.packages["example-tools"]?.kind).toBe("process");

    removePlugin("example-tools", {
      pluginsDir,
      io: { log: () => {}, warn: () => {} },
    });
    expect(existsSync(path.join(pluginsDir, "example-tools"))).toBe(false);
  });

  it("stages xrk.host.json for client packages", () => {
    const home = tempDir("xrk-plug-host-");
    const env = { XRK_HOME: home };
    const pluginsDir = resolvePluginsDir(env);
    const dir = path.join(home, "host-fixture");
    mkdirSync(path.join(dir, "lib"), { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: "@acme/hosted",
          version: "2.0.0",
          dsh: { client: { inject: [] } },
        },
        null,
        2,
      ),
    );
    writeFileSync(path.join(dir, "lib", "client.js"), "export {};\n");
    writeFileSync(
      path.join(dir, "xrk.host.json"),
      JSON.stringify({
        http: [{ prefix: "/sidebar/", provider: "xrk-sidebar" }],
      }),
    );

    addPlugin(dir, {
      env,
      pluginsDir,
      io: { log: () => {}, warn: () => {} },
    });

    const staged = path.join(
      pluginsDir,
      "web",
      "plugins",
      "@acme",
      "hosted",
      "xrk.host.json",
    );
    expect(existsSync(staged)).toBe(true);
    const body = JSON.parse(readFileSync(staged, "utf8")) as {
      http: { prefix: string }[];
    };
    expect(body.http[0]!.prefix).toBe("/sidebar/");
  });

  it("stages kws/assets/static/skins/sounds dirs and skin.json next to client.js", () => {
    const home = tempDir("xrk-plug-kws-");
    const env = { XRK_HOME: home };
    const pluginsDir = resolvePluginsDir(env);
    const dir = path.join(home, "niulai-fixture");
    mkdirSync(path.join(dir, "lib"), { recursive: true });
    mkdirSync(path.join(dir, "kws"), { recursive: true });
    mkdirSync(path.join(dir, "assets"), { recursive: true });
    mkdirSync(path.join(dir, "skins", "demo"), { recursive: true });
    mkdirSync(path.join(dir, "sounds"), { recursive: true });
    writeFileSync(
      path.join(dir, "package.json"),
      JSON.stringify(
        {
          name: "dsh-niulai-pet",
          version: "1.0.0",
          dsh: { client: { inject: [] } },
        },
        null,
        2,
      ),
    );
    writeFileSync(path.join(dir, "lib", "client.js"), "export {};\n");
    writeFileSync(path.join(dir, "kws", "engine.wasm"), "wasm");
    writeFileSync(path.join(dir, "assets", "pet.png"), "png");
    writeFileSync(path.join(dir, "sounds", "boot.wav"), "wav");
    writeFileSync(
      path.join(dir, "skins", "demo", "skin.json"),
      JSON.stringify({ id: "demo", name: "Demo" }),
    );
    writeFileSync(
      path.join(dir, "skin.json"),
      JSON.stringify({ id: "niulai-pet" }),
    );

    addPlugin(dir, {
      env,
      pluginsDir,
      io: { log: () => {}, warn: () => {} },
    });

    const dest = path.join(pluginsDir, "web", "plugins", "dsh-niulai-pet");
    expect(existsSync(path.join(dest, "client.js"))).toBe(true);
    expect(existsSync(path.join(dest, "kws", "engine.wasm"))).toBe(true);
    expect(existsSync(path.join(dest, "assets", "pet.png"))).toBe(true);
    expect(existsSync(path.join(dest, "sounds", "boot.wav"))).toBe(true);
    expect(existsSync(path.join(dest, "skin.json"))).toBe(true);
    expect(existsSync(path.join(dest, "skins", "demo", "skin.json"))).toBe(
      true,
    );
  });

  it("pruneEmptyParents removes an empty scoped parent", () => {
    const root = tempDir("xrk-prune-");
    const pluginsRoot = path.join(root, "web", "plugins");
    const scope = path.join(pluginsRoot, "@acme");
    mkdirSync(path.join(scope, "whip"), { recursive: true });
    rmSync(path.join(scope, "whip"), { recursive: true, force: true });
    expect(readdirSync(scope)).toEqual([]);
    pruneEmptyParents(scope, pluginsRoot);
    expect(existsSync(scope)).toBe(false);
  });

  it("resolvePluginsDir honors XRK_PLUGINS_DIR", () => {
    const dir = tempDir("xrk-plug-ov-");
    expect(resolvePluginsDir({ XRK_PLUGINS_DIR: dir })).toBe(
      path.resolve(dir),
    );
  });

  it("reconcile prunes orphan client staging not in inventory", () => {
    const home = tempDir("xrk-plug-orphan-");
    const env = { XRK_HOME: home };
    const pluginsDir = resolvePluginsDir(env);
    const orphanDir = path.join(
      pluginsDir,
      "web",
      "plugins",
      "@ghost",
      "leftover",
    );
    mkdirSync(orphanDir, { recursive: true });
    writeFileSync(path.join(orphanDir, "client.js"), "export {};\n");
    writeFileSync(
      path.join(pluginsDir, "web", "boot.json"),
      JSON.stringify({
        rev: "stale",
        entries: [
          {
            id: "@ghost/leftover",
            url: "/plugins/@ghost/leftover/client.js",
            rev: "0",
            inject: [],
          },
        ],
      }),
    );

    reconcilePluginsDir(pluginsDir, { log: () => {}, warn: () => {} });

    expect(existsSync(orphanDir)).toBe(false);
    expect(existsSync(path.join(pluginsDir, "web", "plugins", "@ghost"))).toBe(
      false,
    );
    expect(existsSync(path.join(pluginsDir, "web", "boot.json"))).toBe(false);
  });

  it("remove scoped client prunes empty @scope directory", () => {
    const home = tempDir("xrk-plug-scope-");
    const env = { XRK_HOME: home };
    const pluginsDir = resolvePluginsDir(env);
    const fixture = writeClientFixture(home, "@acme/whip");

    addPlugin(fixture, {
      env,
      pluginsDir,
      io: { log: () => {}, warn: () => {} },
    });
    const scopeDir = path.join(pluginsDir, "web", "plugins", "@acme");
    expect(existsSync(scopeDir)).toBe(true);

    removePlugin("@acme/whip", {
      pluginsDir,
      io: { log: () => {}, warn: () => {} },
    });
    expect(existsSync(scopeDir)).toBe(false);
  });

  it("plugin add re-enables a soft-disabled client and rewrites boot.json", () => {
    const home = tempDir("xrk-plug-reenable-");
    const env = { XRK_HOME: home };
    const pluginsDir = resolvePluginsDir(env);
    const fixture = writeClientFixture(home, "side-whip");

    addPlugin(fixture, {
      env,
      pluginsDir,
      io: { log: () => {}, warn: () => {} },
    });
    writeFileSync(
      path.join(pluginsDir, ".xrk-plugins-disabled.json"),
      `${JSON.stringify({ ids: ["side-whip"] }, null, 2)}\n`,
    );
    reconcilePluginsDir(pluginsDir, { log: () => {}, warn: () => {} });
    expect(existsSync(path.join(pluginsDir, "web", "boot.json"))).toBe(false);

    const logs: string[] = [];
    addPlugin(fixture, {
      env,
      pluginsDir,
      io: {
        log: (l) => logs.push(l),
        warn: () => {},
      },
    });
    expect(logs.some((l) => l.includes("re-enabled side-whip"))).toBe(true);
    expect(existsSync(path.join(pluginsDir, ".xrk-plugins-disabled.json"))).toBe(
      false,
    );
    const boot = JSON.parse(
      readFileSync(path.join(pluginsDir, "web", "boot.json"), "utf8"),
    ) as { entries: { id: string }[] };
    expect(boot.entries.map((e) => e.id)).toEqual(["side-whip"]);
  });

  it("reconcile prunes orphan soft-disable ids not in inventory", () => {
    const home = tempDir("xrk-plug-orphan-dis-");
    const env = { XRK_HOME: home };
    const pluginsDir = resolvePluginsDir(env);
    const fixture = writeClientFixture(home, "alive");
    addPlugin(fixture, {
      env,
      pluginsDir,
      io: { log: () => {}, warn: () => {} },
    });
    writeFileSync(
      path.join(pluginsDir, ".xrk-plugins-disabled.json"),
      `${JSON.stringify({ ids: ["alive", "ghost"] }, null, 2)}\n`,
    );
    reconcilePluginsDir(pluginsDir, { log: () => {}, warn: () => {} });
    const disabled = JSON.parse(
      readFileSync(path.join(pluginsDir, ".xrk-plugins-disabled.json"), "utf8"),
    ) as { ids: string[] };
    expect(disabled.ids).toEqual(["alive"]);
    expect(existsSync(path.join(pluginsDir, "web", "boot.json"))).toBe(false);
  });

  it("patches WorkBuddy probe slot nullish selection checks", () => {
    const dir = tempDir("xrk-wb-probe-");
    const clientJs = path.join(dir, "client.js");
    writeFileSync(
      clientJs,
      [
        "const card = selection === void 0 ? void 0 : cardVariantFor(selection.provider);",
        "const key = card === void 0 || selection === void 0 ? void 0 : `${card.id}:${selection.model}`;",
        "return card === void 0 || selection === void 0 || key === void 0 ? null : ok;",
      ].join("\n"),
      "utf8",
    );
    expect(patchWorkBuddyClientProbeNull(clientJs)).toBe(true);
    const out = readFileSync(clientJs, "utf8");
    expect(out).toContain(
      "selection == null ? void 0 : cardVariantFor(selection.provider)",
    );
    expect(out).toContain("card == null || selection == null ? void 0 :");
    expect(out).toContain(
      "card == null || selection == null || key == null ? null",
    );
    expect(patchWorkBuddyClientProbeNull(clientJs)).toBe(false);
  });
});
