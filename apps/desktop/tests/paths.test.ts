import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DESKTOP_PROFILE_NAME } from "../src/desktop-bootstrap.js";
import {
  DESKTOP_BUILD_DIR_NAME,
  resolveDesktopDevelopmentLayout,
  resolveDesktopHarnessHome,
  resolveDesktopPaths,
} from "../src/paths.js";

/** Absolute fixture root (Linux CI must not treat drive-letter joins as relative). */
function fixtureRoot(...parts: string[]): string {
  return path.resolve(path.sep, "xrk-desktop-fixture", ...parts);
}

describe("resolveDesktopPaths", () => {
  it("places profile and desktop roots under the given harness home", () => {
    const home = fixtureRoot("tmp", "xrk-desktop-paths-home");
    const paths = resolveDesktopPaths(home);
    expect(paths.profile).toBe(path.join(home, "profiles", DESKTOP_PROFILE_NAME));
    expect(paths.root).toBe(path.join(home, "desktop"));
    expect(paths.lock).toBe(path.join(home, "desktop", "lock"));
    expect(paths.pnpm.store).toBe(path.join(home, "desktop", "pnpm", "store"));
  });
});

describe("development home isolation", () => {
  it("defaults unpackaged home under .desktop-build, not the OS user ~/.xrk", () => {
    const appRoot = fixtureRoot("repo", "apps", "desktop");
    const layout = resolveDesktopDevelopmentLayout(appRoot, {});
    const userXrk = path.join(os.homedir(), ".xrk");
    expect(layout.home).toBe(
      path.join(appRoot, DESKTOP_BUILD_DIR_NAME, "development", "home"),
    );
    expect(layout.home).not.toBe(userXrk);
    expect(layout.electronUserData).toBe(
      path.join(appRoot, DESKTOP_BUILD_DIR_NAME, "development", "electron-user-data"),
    );
    expect(layout.project).toBe(
      path.join(appRoot, DESKTOP_BUILD_DIR_NAME, "development", "project"),
    );
  });

  it("honors explicit XRK_HOME in development without using ~/.xrk", () => {
    const appRoot = fixtureRoot("repo", "apps", "desktop");
    const override = fixtureRoot("tmp", "xrk-dev-override");
    const layout = resolveDesktopDevelopmentLayout(appRoot, {
      XRK_HOME: override,
    });
    expect(layout.home).toBe(path.resolve(override));
  });

  it("uses resolveXrkHome only when packaged", () => {
    const appRoot = fixtureRoot("repo", "apps", "desktop");
    const packagedHome = fixtureRoot("tmp", "xrk-packaged-home");
    expect(
      resolveDesktopHarnessHome({
        isPackaged: true,
        desktopAppRoot: appRoot,
        env: { XRK_HOME: packagedHome },
      }),
    ).toBe(path.resolve(packagedHome));
    expect(
      resolveDesktopHarnessHome({
        isPackaged: false,
        desktopAppRoot: appRoot,
        env: {},
      }),
    ).toBe(path.join(appRoot, DESKTOP_BUILD_DIR_NAME, "development", "home"));
  });
});
