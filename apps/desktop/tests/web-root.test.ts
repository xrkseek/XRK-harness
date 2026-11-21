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
  it("ships build/icon.png and build/icon.ico from the product plate", async () => {
    // Icons are gitignored under apps/desktop/build/; generate from logo-plate.
    const prepared = spawnSync(
      process.execPath,
      [path.join(DESKTOP_APP_ROOT, "scripts", "prepare-brand-icons.mjs")],
      { cwd: path.resolve(DESKTOP_APP_ROOT, "..", ".."), stdio: "pipe", encoding: "utf8" },
    );
    expect(prepared.status).toBe(0);
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
    // Rounded plate: keep transparent corners (do not flatten onto cream).
    // prepare:icons stdout + PNG magic; corner alpha via the same sharp loader
    // path as scripts/prepare-brand-icons.mjs (devDependency may be hoisted).
    expect(prepared.stdout ?? "").toContain("rounded alpha");
    const iconPng = path.join(build, "icon.png");
    expect(existsSync(iconPng)).toBe(true);
    const { createRequire } = await import("node:module");
    const { readdirSync } = await import("node:fs");
    const repoRoot = path.resolve(DESKTOP_APP_ROOT, "..", "..");
    let sharp: typeof import("sharp") | undefined;
    for (const pkg of [
      path.join(DESKTOP_APP_ROOT, "package.json"),
      path.join(repoRoot, "package.json"),
    ]) {
      try {
        sharp = createRequire(pkg)("sharp");
        break;
      } catch {
        // try next
      }
    }
    if (!sharp) {
      const pnpm = path.join(repoRoot, "node_modules", ".pnpm");
      for (const entry of readdirSync(pnpm)) {
        if (!entry.startsWith("sharp@")) continue;
        const mod = path.join(pnpm, entry, "node_modules", "sharp");
        if (existsSync(path.join(mod, "package.json"))) {
          sharp = createRequire(path.join(mod, "package.json"))(mod);
          break;
        }
      }
    }
    expect(sharp).toBeDefined();
    const { data, info } = await sharp!(iconPng)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect(info.width).toBeGreaterThan(0);
    expect(data[3]).toBeLessThan(16);
  });

  it("prefers app-root build/ (GRM) over resources/icons", () => {
    const resources = mkdtempSync(path.join(tmpdir(), "xrk-desktop-icons-"));
    const icons = path.join(resources, "icons");
    const asarBuild = path.join(resources, "app.asar", "build");
    mkdirSync(icons, { recursive: true });
    mkdirSync(asarBuild, { recursive: true });
    writeFileSync(path.join(icons, "icon.ico"), "packaged-ico");
    writeFileSync(path.join(asarBuild, "icon.ico"), "asar-ico");
    expect(
      resolveDesktopWindowIconPath({
        platform: "win32",
        resourcesPath: resources,
        appPath: path.join(resources, "app.asar"),
        desktopAppRoot: path.join(resources, "missing-monorepo"),
      }),
    ).toBe(path.join(asarBuild, "icon.ico"));
  });

  it("falls back to resources/icons when build/ missing", () => {
    const resources = mkdtempSync(path.join(tmpdir(), "xrk-desktop-icons-fb-"));
    const icons = path.join(resources, "icons");
    mkdirSync(icons, { recursive: true });
    writeFileSync(path.join(icons, "icon.ico"), "packaged-ico");
    expect(
      resolveDesktopWindowIconPath({
        platform: "win32",
        resourcesPath: resources,
        appPath: path.join(resources, "app.asar"),
        desktopAppRoot: path.join(resources, "missing-monorepo"),
      }),
    ).toBe(path.join(icons, "icon.ico"));
  });
});
