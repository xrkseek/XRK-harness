import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaultPluginsDir,
  loadHostConfig,
  resolveXrkHome,
} from "../src/index.js";

const temps: string[] = [];

function tempHome(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "xrk-cfg-"));
  temps.push(dir);
  return dir;
}

afterEach(() => {
  for (const d of temps.splice(0)) {
    rmSync(d, { recursive: true, force: true });
  }
});

describe("loadHostConfig pluginsDir", () => {
  it("reads XRK_PLUGINS_DIR", () => {
    const cfg = loadHostConfig({
      env: { XRK_PLUGINS_DIR: "  ./extensions  " },
    });
    expect(cfg.runtime.pluginsDir).toBe("./extensions");
  });

  it("patch.pluginsDir overrides env", () => {
    const cfg = loadHostConfig({
      env: { XRK_PLUGINS_DIR: "./a" },
      patch: { pluginsDir: "./b" },
    });
    expect(cfg.runtime.pluginsDir).toBe("./b");
  });

  it("omits pluginsDir when home plugins dir is absent", () => {
    const home = tempHome();
    const cfg = loadHostConfig({ env: { XRK_HOME: home } });
    expect(cfg.runtime.pluginsDir).toBeUndefined();
  });

  it("defaults pluginsDir to {XRK_HOME}/plugins when that dir exists", () => {
    const home = tempHome();
    const plugins = path.join(home, "plugins");
    mkdirSync(plugins, { recursive: true });
    const cfg = loadHostConfig({ env: { XRK_HOME: home } });
    expect(cfg.runtime.pluginsDir).toBe(plugins);
    expect(defaultPluginsDir({ XRK_HOME: home })).toBe(plugins);
  });

  it("XRK_PLUGINS_DIR wins over existing home plugins", () => {
    const home = tempHome();
    mkdirSync(path.join(home, "plugins"), { recursive: true });
    const cfg = loadHostConfig({
      env: { XRK_HOME: home, XRK_PLUGINS_DIR: "./ext" },
    });
    expect(cfg.runtime.pluginsDir).toBe("./ext");
  });
});

describe("resolveXrkHome", () => {
  it("honors XRK_HOME over default", () => {
    const home = resolveXrkHome({ XRK_HOME: "C:/tmp/xrk-home-test" });
    expect(home.replace(/\\/g, "/")).toMatch(/tmp\/xrk-home-test$/);
  });
});
