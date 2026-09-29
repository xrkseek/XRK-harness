import { mkdirSync, mkdtempSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DESKTOP_WEB_ROOT_ENV,
  resolveDesktopBuildResourcesDir,
  resolveDesktopWebRoot,
  resolveDesktopWindowIconPath,
} from "../src/web-root.js";

const DESKTOP_APP_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function tempWebRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), "xrk-desktop-web-"));
  writeFileSync(path.join(root, "index.html"), "<html></html>\n", "utf8");
  return root;
}

describe("resolveDesktopWebRoot", () => {
  it("honors XRK_DESKTOP_WEB_ROOT over packaged / unpackaged defaults", () => {
    const webRoot = tempWebRoot();
    expect(
      resolveDesktopWebRoot({
        isPackaged: true,
        appPath: path.join(webRoot, "missing-app"),
        env: { [DESKTOP_WEB_ROOT_ENV]: webRoot },
      }),
    ).toBe(path.resolve(webRoot));
  });

  it("uses {resourcesPath}/web when packaged (Host-readable extraResources)", () => {
    const resources = mkdtempSync(path.join(tmpdir(), "xrk-desktop-res-web-"));
    const web = path.join(resources, "web");
    mkdirSync(web);
    writeFileSync(path.join(web, "index.html"), "<html></html>\n", "utf8");
    expect(
      resolveDesktopWebRoot({
        isPackaged: true,
        appPath: path.join(resources, "app.asar"),
        resourcesPath: resources,
        env: {},
      }),
    ).toBe(path.resolve(web));
  });

  it("uses {appPath}/web when packaged", () => {
    const appPath = mkdtempSync(path.join(tmpdir(), "xrk-desktop-app-"));
    const web = path.join(appPath, "web");
    mkdirSync(web);
    writeFileSync(path.join(web, "index.html"), "<html></html>\n", "utf8");
    expect(
      resolveDesktopWebRoot({
        isPackaged: true,
        appPath,
        env: {},
      }),
    ).toBe(path.resolve(web));
  });

  it("refuses packaged resolution without appPath or index.html", () => {
    expect(() =>
      resolveDesktopWebRoot({ isPackaged: true, env: {} }),
    ).toThrow(/app\.getAppPath/u);
    const appPath = mkdtempSync(path.join(tmpdir(), "xrk-desktop-empty-"));
    expect(() =>
      resolveDesktopWebRoot({ isPackaged: true, appPath, env: {} }),
    ).toThrow(/index\.html/u);
  });

  it("defaults unpackaged to apps/web/dist when present", () => {
    const monorepoWeb = path.resolve(DESKTOP_APP_ROOT, "..", "web", "dist");
    const index = path.join(monorepoWeb, "index.html");
    // `apps/web/dist` is gitignored; CI `check` does not assemble product Web.
    if (!existsSync(index)) {
      expect(() =>
        resolveDesktopWebRoot({
          isPackaged: false,
          desktopAppRoot: DESKTOP_APP_ROOT,
          env: {},
        }),
      ).toThrow(/index\.html/u);
      return;
    }
    expect(
      resolveDesktopWebRoot({
        isPackaged: false,
        desktopAppRoot: DESKTOP_APP_ROOT,
        env: {},
      }),
    ).toBe(monorepoWeb);
  });
});

describe("desktop brand icons", () => {
  it("ships build/icon.png and build/icon.ico from the product plate", () => {
    // Icons are gitignored under apps/desktop/build/; generate from logo-plate.
    spawnSync(
      process.execPath,
      [path.join(DESKTOP_APP_ROOT, "scripts", "prepare-brand-icons.mjs")],
      { cwd: path.resolve(DESKTOP_APP_ROOT, "..", ".."), stdio: "pipe" },
    );
    const build = resolveDesktopBuildResourcesDir(DESKTOP_APP_ROOT);
    expect(resolveDesktopWindowIconPath({ platform: "win32", desktopAppRoot: DESKTOP_APP_ROOT })).toBe(
      path.join(build, "icon.ico"),
    );
    expect(resolveDesktopWindowIconPath({ platform: "darwin", desktopAppRoot: DESKTOP_APP_ROOT })).toBe(
      path.join(build, "icon.png"),
    );
    expect(resolveDesktopWindowIconPath({ platform: "linux", desktopAppRoot: DESKTOP_APP_ROOT })).toBe(
      path.join(build, "icon.png"),
    );
  });
});
