import { describe, expect, it } from "vitest";
import {
  DESKTOP_PLUGIN_INSTALL_BOUNDARY,
  DESKTOP_PLUGIN_INSTALL_OPERATIONS,
  assertDesktopPluginAddSpec,
  assertDesktopPluginMutation,
  assertDesktopPluginPackageName,
  assertDesktopPluginVersion,
  desktopPluginPnpmArgv,
  isDesktopPluginInstallReady,
} from "../src/plugin-install-surface.js";

describe("desktop plugin install surface", () => {
  it("names structured operations and keeps CLI / dsh-compat boundaries", () => {
    expect(DESKTOP_PLUGIN_INSTALL_OPERATIONS).toEqual([
      "list",
      "add",
      "remove",
      "update",
    ]);
    expect(DESKTOP_PLUGIN_INSTALL_BOUNDARY.owner).toBe("desktop-profile");
    expect(DESKTOP_PLUGIN_INSTALL_BOUNDARY.notCliPluginsDir).toBe(true);
    expect(DESKTOP_PLUGIN_INSTALL_BOUNDARY.notCliWebBootOverlay).toBe(true);
    expect(DESKTOP_PLUGIN_INSTALL_BOUNDARY.notDshCompatCapabilityTable).toBe(
      true,
    );
    expect(DESKTOP_PLUGIN_INSTALL_BOUNDARY.notHostSidebarSurface).toBe(true);
    expect(isDesktopPluginInstallReady()).toBe(false);
  });

  it("accepts registry names and name@version specs", () => {
    expect(assertDesktopPluginPackageName("@scope/pkg")).toBe("@scope/pkg");
    expect(assertDesktopPluginVersion("1.2.3")).toBe("1.2.3");
    expect(assertDesktopPluginAddSpec("@scope/pkg@1.0.0")).toBe("@scope/pkg");
    expect(assertDesktopPluginAddSpec("plain-pkg")).toBe("plain-pkg");
  });

  it("rejects specs that could smuggle paths, urls, or flags", () => {
    expect(() => assertDesktopPluginAddSpec("--store-dir=/tmp")).toThrow(
      /unsupported/,
    );
    expect(() => assertDesktopPluginAddSpec("file:./local")).toThrow(
      /unsupported/,
    );
    expect(() => assertDesktopPluginAddSpec("github:org/repo")).toThrow(
      /unsupported/,
    );
    expect(() => assertDesktopPluginAddSpec("pkg with space")).toThrow(
      /unsupported/,
    );
    expect(() => assertDesktopPluginPackageName("../evil")).toThrow(/invalid/);
    expect(() => assertDesktopPluginVersion("1.0.0;rm")).toThrow(/invalid/);
  });

  it("maps mutations to fixed pnpm argv without arbitrary extras", () => {
    expect(
      desktopPluginPnpmArgv({ type: "add", spec: "@scope/demo@2.0.0" }),
    ).toEqual(["add", "@scope/demo@2.0.0", "--save-exact"]);
    expect(
      desktopPluginPnpmArgv({ type: "remove", name: "@scope/demo" }),
    ).toEqual(["remove", "@scope/demo"]);
    expect(
      desktopPluginPnpmArgv({
        type: "update",
        name: "@scope/demo",
        version: "2.1.0",
      }),
    ).toEqual(["add", "@scope/demo@2.1.0", "--save-exact"]);
    expect(() =>
      assertDesktopPluginMutation({ type: "add", spec: "-C" }),
    ).toThrow(/unsupported/);
  });
});
