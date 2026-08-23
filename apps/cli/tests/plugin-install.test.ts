import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  addPlugin,
  listPlugins,
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

  it("resolvePluginsDir honors XRK_PLUGINS_DIR", () => {
    const dir = tempDir("xrk-plug-ov-");
    expect(resolvePluginsDir({ XRK_PLUGINS_DIR: dir })).toBe(
      path.resolve(dir),
    );
  });
});
