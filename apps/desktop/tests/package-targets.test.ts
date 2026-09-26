import { describe, expect, it } from "vitest";
import {
  DESKTOP_BUILDER_CONFIG,
  DESKTOP_UPLOAD_CREDENTIAL_ENV_NAMES,
  DESKTOP_WINDOWS_SIGNING_ENV_PREFIX,
  assertDesktopPackageHostCompatible,
  desktopElectronBuilderArguments,
  desktopElectronBuilderEnvironment,
  isDesktopFirstWavePackageTarget,
  listDesktopPackageTargets,
  resolveDesktopPackageTarget,
  withoutDesktopUploadCredentials,
  withoutDesktopWindowsSigningEnvironment,
} from "../src/package-targets.js";

describe("desktop package targets (release matrix)", () => {
  it("lists win-x64, mac-arm64, and mac-x64 with matching builder selectors", () => {
    expect(listDesktopPackageTargets().map((t) => t.name)).toEqual([
      "win-x64",
      "mac-arm64",
      "mac-x64",
    ]);
    expect(resolveDesktopPackageTarget("win-x64")).toMatchObject({
      platform: "win32",
      arch: "x64",
      builderPlatform: "--win",
      builderArch: "--x64",
      builderTargets: ["nsis"],
    });
    expect(resolveDesktopPackageTarget("mac-arm64")).toMatchObject({
      platform: "darwin",
      arch: "arm64",
      builderPlatform: "--mac",
      builderArch: "--arm64",
      builderTargets: ["dmg", "zip"],
    });
    expect(resolveDesktopPackageTarget("mac-x64")).toMatchObject({
      platform: "darwin",
      arch: "x64",
      builderPlatform: "--mac",
      builderArch: "--x64",
      builderTargets: ["dmg", "zip"],
    });
  });

  it("refuses deferred Linux and win-arm64 ids", () => {
    for (const name of ["linux-x64", "linux-arm64", "win-arm64"]) {
      expect(isDesktopFirstWavePackageTarget(name)).toBe(false);
      expect(() => resolveDesktopPackageTarget(name)).toThrow(
        /deferred|unknown/u,
      );
    }
  });

  it("rejects incompatible packaging hosts before build (logic only)", () => {
    const win = resolveDesktopPackageTarget("win-x64");
    const macArm = resolveDesktopPackageTarget("mac-arm64");
    const macX64 = resolveDesktopPackageTarget("mac-x64");
    expect(() =>
      assertDesktopPackageHostCompatible(win, "win32", "x64"),
    ).not.toThrow();
    expect(() =>
      assertDesktopPackageHostCompatible(macArm, "darwin", "arm64"),
    ).not.toThrow();
    expect(() =>
      assertDesktopPackageHostCompatible(macX64, "darwin", "arm64"),
    ).not.toThrow();
    expect(() =>
      assertDesktopPackageHostCompatible(macX64, "darwin", "x64"),
    ).not.toThrow();
    expect(() =>
      assertDesktopPackageHostCompatible(win, "darwin", "arm64"),
    ).toThrow(/Windows x64/u);
    expect(() =>
      assertDesktopPackageHostCompatible(macArm, "darwin", "x64"),
    ).toThrow(/Apple Silicon/u);
    expect(() =>
      assertDesktopPackageHostCompatible(macArm, "linux", "arm64"),
    ).toThrow(/macOS/u);
  });

  it("keeps electron-builder argv publish-disabled (upload is separate)", () => {
    const target = resolveDesktopPackageTarget("mac-arm64");
    expect(desktopElectronBuilderArguments(target)).toEqual([
      "exec",
      "electron-builder",
      "--config",
      DESKTOP_BUILDER_CONFIG.configFile,
      "--mac",
      "--arm64",
      "--publish",
      "never",
    ]);
    expect(
      desktopElectronBuilderArguments(target, { directory: true }),
    ).toContain("--dir");
  });

  it("scrubs Windows signing env from prep subprocesses", () => {
    expect(DESKTOP_WINDOWS_SIGNING_ENV_PREFIX).toBe("XRK_DESKTOP_WINDOWS_");
    expect(
      withoutDesktopWindowsSigningEnvironment({
        XRK_DESKTOP_WINDOWS_CER_FILE: "C:\\release\\server.cer",
        XRK_DESKTOP_WINDOWS_TOKEN_PIN: "token-secret",
        XRK_DESKTOP_AUTO_UPDATE_ENV: "production",
      }),
    ).toEqual({ XRK_DESKTOP_AUTO_UPDATE_ENV: "production" });
  });

  it("scrubs upload credentials from packaging subprocesses", () => {
    expect(DESKTOP_UPLOAD_CREDENTIAL_ENV_NAMES.length).toBeGreaterThan(0);
    expect(
      withoutDesktopUploadCredentials({
        XRK_DESKTOP_UPLOAD_SECRET_ID: "id",
        XRK_DESKTOP_UPLOAD_SECRET_KEY: "key",
        XRK_DESKTOP_UPLOAD_TEST_SECRET_ID: "test-id",
        XRK_DESKTOP_AUTO_UPDATE_ENV: "production",
        PATH: "/usr/bin",
      }),
    ).toEqual({
      XRK_DESKTOP_AUTO_UPDATE_ENV: "production",
      PATH: "/usr/bin",
    });
  });

  it("scrubs CSC_* and forces UNSIGNED for unsigned builder env", () => {
    expect(
      desktopElectronBuilderEnvironment(
        {
          XRK_DESKTOP_TARGET: "win-x64",
          XRK_DESKTOP_WINDOWS_TOKEN_PIN: "pin",
          CSC_LINK: "should-drop",
          PATH: "/usr/bin",
        },
        true,
      ),
    ).toEqual({
      XRK_DESKTOP_TARGET: "win-x64",
      PATH: "/usr/bin",
      ELECTRON_BUILDER_7Z_FILTER: "BCJ",
      CSC_IDENTITY_AUTO_DISCOVERY: "false",
      XRK_DESKTOP_UNSIGNED: "1",
    });
  });
});
