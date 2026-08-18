import { describe, expect, it } from "vitest";
import { loadHostConfig } from "../src/index.js";

describe("loadHostConfig", () => {
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

  it("omits pluginsDir when unset", () => {
    const cfg = loadHostConfig({ env: {} });
    expect(cfg.runtime.pluginsDir).toBeUndefined();
  });

  it("reads XRK_WEB_DIST", () => {
    const cfg = loadHostConfig({
      env: { XRK_WEB_DIST: "  apps/web/dist  " },
    });
    expect(cfg.runtime.webDist).toBe("apps/web/dist");
  });

  it("reads XRK_SESSIONS_DIR", () => {
    const cfg = loadHostConfig({
      env: { XRK_SESSIONS_DIR: "  ./.xrk/sessions  " },
    });
    expect(cfg.runtime.sessionsDir).toBe("./.xrk/sessions");
  });
});
