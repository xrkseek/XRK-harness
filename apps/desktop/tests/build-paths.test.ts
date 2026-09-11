import { join, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  desktopTargetBuildPaths,
  resolveDesktopBuildTarget,
  resolveDesktopTargetBuildPaths,
} from "../src/build-paths.js";

describe("desktop build paths (target matrix)", () => {
  it("isolates mutable prep directories by first-wave target", () => {
    const appRoot = join("C:", "repo", "apps", "desktop");
    const win = desktopTargetBuildPaths("win-x64", appRoot);
    const mac = desktopTargetBuildPaths("mac-arm64", appRoot);
    const mutableKeys = [
      "root",
      "runtime",
      "nodeExtract",
      "packageSet",
      "seed",
    ] as const;

    for (const key of mutableKeys) {
      expect(new Set([win[key], mac[key]]).size).toBe(2);
    }
    expect(win.runtime).toContain(join("targets", "win-x64", "runtime"));
    expect(mac.seed).toContain(join("targets", "mac-arm64", "seed"));
    expect(mac.packageSet).toContain(
      join("targets", "mac-arm64", "package-set"),
    );
    expect(win.root).toContain(join("targets", "win-x64"));
  });

  it("shares only the immutable upstream download cache", () => {
    const appRoot = join("C:", "repo", "apps", "desktop");
    const win = desktopTargetBuildPaths("win-x64", appRoot);
    const mac = desktopTargetBuildPaths("mac-arm64", appRoot);
    expect(win.downloads).toBe(mac.downloads);
    expect(win.downloads).toContain(join(".desktop-build", "downloads"));
    expect(win.downloads).not.toContain(`${sep}targets${sep}`);
  });

  it("resolves env overrides and rejects deferred / unsupported targets", () => {
    expect(
      resolveDesktopBuildTarget(
        { XRK_DESKTOP_TARGET: "mac-arm64" },
        "win32",
        "x64",
      ),
    ).toBe("mac-arm64");
    expect(
      resolveDesktopBuildTarget(
        {
          XRK_DESKTOP_TARGET_PLATFORM: "darwin",
          XRK_DESKTOP_TARGET_ARCH: "arm64",
        },
        "win32",
        "x64",
      ),
    ).toBe("mac-arm64");
    expect(resolveDesktopBuildTarget({}, "win32", "x64")).toBe("win-x64");
    expect(resolveDesktopBuildTarget({}, "darwin", "arm64")).toBe("mac-arm64");
    expect(() => resolveDesktopBuildTarget({}, "linux", "x64")).toThrow(
      /deferred|unknown/u,
    );
    expect(() => desktopTargetBuildPaths("linux-x64")).toThrow(/deferred/u);
    expect(() => desktopTargetBuildPaths("mac-x64")).toThrow(/deferred/u);
  });

  it("resolveDesktopTargetBuildPaths follows the selected target", () => {
    const appRoot = join("C:", "repo", "apps", "desktop");
    const paths = resolveDesktopTargetBuildPaths(
      { XRK_DESKTOP_TARGET: "win-x64" },
      appRoot,
      "darwin",
      "arm64",
    );
    expect(paths.target).toBe("win-x64");
    expect(paths.runtime).toContain(join("targets", "win-x64", "runtime"));
  });
});
