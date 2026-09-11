import { describe, expect, it } from "vitest";
import {
  DESKTOP_BUILDER_DRAFT,
  DESKTOP_UPLOAD_CREDENTIAL_ENV_NAMES,
  DESKTOP_WINDOWS_SIGNING_ENV_PREFIX,
  assertDesktopPackageHostCompatible,
  desktopElectronBuilderDraftArguments,
  isDesktopFirstWavePackageTarget,
  listDesktopPackageTargets,
  resolveDesktopPackageTarget,
  withoutDesktopUploadCredentials,
  withoutDesktopWindowsSigningEnvironment,
} from "../src/package-targets.js";

describe("desktop package targets (draft matrix)", () => {
  it("lists first-wave win-x64 and mac-arm64 with matching builder selectors", () => {
    expect(listDesktopPackageTargets().map((t) => t.name)).toEqual([
      "win-x64",
      "mac-arm64",
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
  });

  it("refuses deferred Linux and other non-first-wave ids", () => {
    for (const name of ["linux-x64", "linux-arm64", "mac-x64", "win-arm64"]) {
      expect(isDesktopFirstWavePackageTarget(name)).toBe(false);
      expect(() => resolveDesktopPackageTarget(name)).toThrow(
        /deferred|unknown/u,
      );
    }
  });

  it("rejects incompatible packaging hosts before build (logic only)", () => {
    const win = resolveDesktopPackageTarget("win-x64");
    const mac = resolveDesktopPackageTarget("mac-arm64");
    expect(() =>
      assertDesktopPackageHostCompatible(win, "win32", "x64"),
    ).not.toThrow();
    expect(() =>
      assertDesktopPackageHostCompatible(mac, "darwin", "arm64"),
    ).not.toThrow();
    expect(() =>
      assertDesktopPackageHostCompatible(win, "darwin", "arm64"),
    ).toThrow(/Windows x64/u);
    expect(() =>
      assertDesktopPackageHostCompatible(mac, "darwin", "x64"),
    ).toThrow(/Apple Silicon/u);
    expect(() =>
      assertDesktopPackageHostCompatible(mac, "linux", "arm64"),
    ).toThrow(/macOS/u);
  });

  it("keeps electron-builder draft argv publish-disabled", () => {
    const target = resolveDesktopPackageTarget("mac-arm64");
    expect(desktopElectronBuilderDraftArguments(target)).toEqual([
      "exec",
      "electron-builder",
      "--config",
      DESKTOP_BUILDER_DRAFT.configFile,
      "--mac",
      "--arm64",
      "--publish",
      "never",
    ]);
    expect(
      desktopElectronBuilderDraftArguments(target, { directory: true }),
    ).toContain("--dir");
  });

  it("scrubs Windows signing env from prep subprocesses (no real signing)", () => {
    expect(DESKTOP_WINDOWS_SIGNING_ENV_PREFIX).toBe("XRK_DESKTOP_WINDOWS_");
    expect(
      withoutDesktopWindowsSigningEnvironment({
        XRK_DESKTOP_WINDOWS_CER_FILE: "C:\\release\\server.cer",
        XRK_DESKTOP_WINDOWS_TOKEN_PIN: "token-secret",
        XRK_DESKTOP_AUTO_UPDATE_ENV: "production",
      }),
    ).toEqual({ XRK_DESKTOP_AUTO_UPDATE_ENV: "production" });
  });

  it("scrubs upload credentials from packaging subprocesses (upload phase 2)", () => {
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

  it("carries draft electron-builder product identity (not shipping)", () => {
    expect(DESKTOP_BUILDER_DRAFT.productName).toBe("XRK Harness");
    expect(DESKTOP_BUILDER_DRAFT.nsis.oneClick).toBe(false);
  });
});
