import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DESKTOP_APP_UPDATE_YML,
  isDesktopUpdateFeedEnabled,
  writeDesktopAppUpdateConfig,
} from "../src/app-update-config.js";
import {
  DESKTOP_AUTO_UPDATE_ENV,
  desktopElectronBuilderPublish,
  renderDesktopAppUpdateYml,
  resolveDesktopAutoUpdateConfig,
} from "../src/desktop-auto-update-environment.js";
import {
  DESKTOP_UNSIGNED_ENV,
  isDesktopMacOSNotarizationReady,
  isDesktopUnsignedRequested,
  resolveDesktopMacOSSigningEnvironment,
  resolveDesktopWindowsSigningEnvironment,
} from "../src/desktop-signing-environment.js";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("desktop signing environment", () => {
  it("parses unsigned flag and Windows certificate gate", () => {
    expect(isDesktopUnsignedRequested({})).toBe(false);
    expect(isDesktopUnsignedRequested({ [DESKTOP_UNSIGNED_ENV]: "1" })).toBe(
      true,
    );
    expect(() =>
      isDesktopUnsignedRequested({ [DESKTOP_UNSIGNED_ENV]: "maybe" }),
    ).toThrow(/0 or 1/);
    expect(resolveDesktopWindowsSigningEnvironment({})).toBeUndefined();
    expect(
      resolveDesktopWindowsSigningEnvironment({
        XRK_DESKTOP_WINDOWS_CER_FILE: "C:\\release\\server.cer",
        XRK_DESKTOP_WINDOWS_TOKEN_PIN: "pin",
      }),
    ).toEqual({
      certificateFile: "C:\\release\\server.cer",
      tokenPin: "pin",
    });
    expect(
      resolveDesktopWindowsSigningEnvironment({
        [DESKTOP_UNSIGNED_ENV]: "1",
        XRK_DESKTOP_WINDOWS_CER_FILE: "C:\\release\\server.cer",
      }),
    ).toBeUndefined();
  });

  it("rejects unsigned on macOS and detects notarization readiness", () => {
    expect(() =>
      resolveDesktopMacOSSigningEnvironment({ [DESKTOP_UNSIGNED_ENV]: "1" }),
    ).toThrow(/Windows-only/);
    const signing = resolveDesktopMacOSSigningEnvironment({
      XRK_DESKTOP_MACOS_IDENTITY: "Developer ID Application: Example",
      XRK_DESKTOP_MACOS_APPLE_ID: "a@example.com",
      XRK_DESKTOP_MACOS_APPLE_ID_PASSWORD: "@keychain:AC",
      XRK_DESKTOP_MACOS_TEAM_ID: "TEAMID",
    });
    expect(signing?.signingIdentity).toContain("Developer ID");
    expect(isDesktopMacOSNotarizationReady(signing)).toBe(true);
    expect(
      isDesktopMacOSNotarizationReady({
        signingIdentity: "Developer ID Application: Example",
      }),
    ).toBe(false);
  });
});

describe("desktop auto-update environment", () => {
  it("resolves generic feed URL for first-wave targets", () => {
    expect(
      resolveDesktopAutoUpdateConfig(
        { [DESKTOP_AUTO_UPDATE_ENV]: "test" },
        "win32",
        "x64",
      ),
    ).toBeUndefined();
    const update = resolveDesktopAutoUpdateConfig(
      {
        [DESKTOP_AUTO_UPDATE_ENV]: "test",
        XRK_DESKTOP_UPDATE_TEST_ORIGIN: "https://updates.example.test/",
      },
      "win32",
      "x64",
    );
    expect(update).toEqual({
      channel: "test",
      publicUrl: "https://updates.example.test/desktop/win-x64",
      metadataChannel: "nightly",
    });
    expect(desktopElectronBuilderPublish(update)).toEqual([
      {
        provider: "generic",
        url: "https://updates.example.test/desktop/win-x64",
        channel: "nightly",
      },
    ]);
    expect(desktopElectronBuilderPublish(undefined)).toBeNull();
    expect(renderDesktopAppUpdateYml(update!)).toContain("provider: generic");
  });

  it("writes app-update.yml and gates feed enablement", () => {
    const dir = mkdtempSync(join(tmpdir(), "xrk-desktop-update-"));
    tempDirs.push(dir);
    const update = {
      channel: "test" as const,
      publicUrl: "https://updates.example.test/desktop/mac-arm64",
      metadataChannel: "nightly" as const,
    };
    const written = writeDesktopAppUpdateConfig(dir, update);
    expect(written.endsWith(DESKTOP_APP_UPDATE_YML)).toBe(true);
    expect(readFileSync(written, "utf8")).toContain(update.publicUrl);
    expect(
      isDesktopUpdateFeedEnabled({
        isPackaged: true,
        resourcesPath: dir,
      }),
    ).toBe(true);
    expect(
      isDesktopUpdateFeedEnabled({
        isPackaged: false,
        resourcesPath: dir,
      }),
    ).toBe(false);
  });
});
